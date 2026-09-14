-- RECOVERY NOTE: pasted section is incomplete/interleaved; do not repair during salvage.
-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §6: `rule_sets` / `rule_set_versions` /
-- `rules`. Closure §4.5: "RuleSet root owns editions; assignments define
-- applicability. Draft/published/superseded/withdrawn editions; effective dates
-- separate. Published rule expressions cannot be edited by scenario."
--
-- Bounded expression grammar (closure §8): "Use a bounded typed predicate
-- language with registered operators and all/any composition ... No eval,
-- arbitrary script or unreviewed AI-produced executable rule." The expression
-- is stored as jsonb CHECKed by rule_expression_is_bounded() below — a
-- recursive shape check over ALL/ANY/NOT/PREDICATE with a depth bound and no
-- allowance for extra keys — mirroring the frozen RuleExpressionSchema
-- (src/domain/v2/knowledge/information.ts). The zod schema validates the same
-- shape at the command boundary; the database is the second, independent gate.
--
-- Edition numbering follows §1: unique (workspace_id, rule_set_id,
-- edition_number), sequential editions controlled internally (derived in SQL,
-- never supplied).

CREATE TABLE rule_sets (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  issuer_kind text NOT NULL REFERENCES subject_kinds (kind),
  issuer_id uuid NOT NULL,
  -- Which policy family this set governs; selection semantics live on
  -- rule_assignments (0075), not on the set.
  policy_family text NOT NULL CHECK (length(btrim(policy_family)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT rule_sets_issuer_fk
    FOREIGN KEY (workspace_id, issuer_kind, issuer_id)
    REFERENCES domain_subjects (workspace_id, id, kind),
  CONSTRAINT rule_sets_issuer_restricted CHECK (issuer_kind IN ('ORGANISATION', 'PRINCIPAL'))
);

CREATE INDEX idx_rule_sets_issuer ON rule_sets (workspace_id, issuer_kind, issuer_id);
CREATE INDEX idx_rule_sets_family ON rule_sets (workspace_id, policy_family);

-- Bounded-expression shape check (recursive). depth is decremented from
-- BOUNDED_RULE_EXPRESSION_MAX_DEPTH; exhausted depth means the expression is
-- too large to be a bounded policy, not a value judgment.
CREATE FUNCTION rule_expression_is_bounded(p_expression jsonb, p_depth integer) RETURNS boolean LANGUAGE plpgsql AS $$
CREATE FUNCTION assert_rule_set_version_immutable_but_publishable() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED' THEN
    -- The publish transition: status plus exactly the publication/effective
    -- columns it stamps. Anything else moving is a rejected rewrite.
    IF NEW.expression IS DISTINCT FROM OLD.expression
       OR NEW.edition_number IS DISTINCT FROM OLD.edition_number
       OR NEW.rule_set_id IS DISTINCT FROM OLD.rule_set_id
       OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
  IF p_depth <= 0 THEN
       OR NEW.published_at IS NULL
    RETURN false;
       OR NEW.published_by_actor_id IS NULL THEN
      RAISE EXCEPTION 'rule_set_versions violation: publishing may only stamp status and publication facts';
  END IF;
    END IF;
  IF jsonb_typeof(p_expression) <> 'object' THEN
    RETURN false;
    RETURN NEW;
  END IF;
  IF NOT (p_expression ? 'operator') THEN
    RETURN false;
  END IF;
  CASE p_expression ->> 'operator'
    WHEN 'ALL', 'ANY' THEN
      -- composition: operands array, each bounded
      RETURN jsonb_typeof(p_expression -> 'operands') = 'array'
        AND jsonb_array_length(p_expression -> 'operands') >= 1
        AND (SELECT bool_and(rule_expression_is_bounded(o, p_depth - 1))
             FROM jsonb_array_elements(p_expression -> 'operands') AS o)
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_expression) k
           WHERE k NOT IN ('operator', 'operands')
        );
    WHEN 'NOT' THEN
      RETURN rule_expression_is_bounded(p_expression -> 'operand', p_depth - 1)
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_expression) k
           WHERE k NOT IN ('operator', 'operand')
        );
    WHEN 'PREDICATE' THEN
      -- leaf: a registered predicate id + bounded parameters object
      RETURN jsonb_typeof(p_expression -> 'predicateId') = 'string'
        AND length(p_expression ->> 'predicateId') >= 1
        AND jsonb_typeof(p_expression -> 'parameters') = 'object'
        AND pg_column_size(p_expression -> 'parameters') <= 8192
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_expression) k
           WHERE k NOT IN ('operator', 'predicateId', 'parameters')
        );
    ELSE
      -- Unknown operator: reject. There is no eval-shaped escape hatch here.
      RETURN false;
  END CASE;
END;
$$;

CREATE TABLE rule_set_versions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  rule_set_id uuid NOT NULL,
  edition_number integer NOT NULL CHECK (edition_number >= 1),
  status text NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'WITHDRAWN')),
  effective_from timestamptz,
  effective_until timestamptz,
  expression jsonb NOT NULL
    CHECK (rule_expression_is_bounded(expression, 32) AND pg_column_size(expression) <= 65536),
  published_at timestamptz,
  published_by_actor_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT rule_set_versions_set_fk
    FOREIGN KEY (workspace_id, rule_set_id) REFERENCES rule_sets (workspace_id, id),
  CONSTRAINT rule_set_versions_edition_unique UNIQUE (workspace_id, rule_set_id, edition_number),
  CONSTRAINT rule_set_versions_effective_ordered CHECK (
    effective_until IS NULL OR (effective_from IS NOT NULL AND effective_until > effective_from)
  ),
  CONSTRAINT rule_set_versions_published_shape CHECK (
    (status IN ('PUBLISHED', 'SUPERSEDED', 'WITHDRAWN')) = (published_at IS NOT NULL AND published_by_actor_id IS NOT NULL)
  IF OLD.status IN ('PUBLISHED', 'SUPERSEDED', 'WITHDRAWN') AND NEW.status IN ('SUPERSEDED', 'WITHDRAWN') THEN
  )
);

-- Published/superseded/withdrawn editions are content-frozen: expression,
-- edition number and effective dates cannot change. Drafts stay editable
    -- Status-only move of an accepted edition; content stays frozen.
-- (authoring is a real activity); PUBLISH is the explicit transition, and
-- withdrawal/supersession change ONLY status/published_* columns.
CREATE FUNCTION assert_rule_set_version_publication_freeze() RETURNS trigger AS $$
BEGIN
  IF OLD.status <> 'DRAFT' THEN
    IF NEW.expression IS DISTINCT FROM OLD.expression
       OR NEW.edition_number IS DISTINCT FROM OLD.edition_number
       OR NEW.rule_set_id IS DISTINCT FROM OLD.rule_set_id
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.effective_until IS DISTINCT FROM OLD.effective_until THEN
       OR NEW.effective_until IS DISTINCT FROM OLD.effective_until
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.published_by_actor_id IS DISTINCT FROM OLD.published_by_actor_id
       OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION
        'rule_set_versions violation: edition % of rule set % is %; its expression is immutable — publish a new edition',
        OLD.edition_number, OLD.rule_set_id, OLD.status;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'PUBLISHED' AND NEW.status = 'DRAFT' THEN
    RAISE EXCEPTION
      'rule_set_versions violation: a PUBLISHED edition cannot return to DRAFT';
    RAISE EXCEPTION 'rule_set_versions violation: a PUBLISHED edition cannot return to DRAFT';
  END IF;
  RETURN NEW;
  RAISE EXCEPTION
    'rule_set_versions violation: % status cannot move to %; editions are append-only with one publish transition',
    OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rule_set_versions_publication_freeze
DROP TRIGGER IF EXISTS rule_set_versions_immutable ON rule_set_versions;
  BEFORE UPDATE ON rule_set_versions
  FOR EACH ROW EXECUTE FUNCTION assert_rule_set_version_publication_freeze();

-- An accepted published edition can never be deleted; withdrawal is a status.
CREATE TRIGGER rule_set_versions_immutable
  BEFORE UPDATE OR DELETE ON rule_set_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
  FOR EACH ROW EXECUTE FUNCTION assert_rule_set_version_immutable_but_publishable();

-- §6 `rules`: named individual rules inside an edition. Same bounded grammar;
-- a rule belongs to exactly one edition (edition-owned, not set-floating), so
-- a new edition restates its rules and nothing mutates under a published one.
CREATE TABLE rules (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  rule_set_version_id uuid NOT NULL,
  rule_key text NOT NULL CHECK (rule_key ~ '^[a-z][a-z0-9_]*$'),
  statement text NOT NULL CHECK (length(btrim(statement)) > 0),
  expression jsonb NOT NULL
    CHECK (rule_expression_is_bounded(expression, 32) AND pg_column_size(expression) <= 65536),
  severity text NOT NULL DEFAULT 'INFORMATIONAL'
    CHECK (severity IN ('INFORMATIONAL', 'ADVISORY', 'MANDATORY', 'PROHIBITIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT rules_edition_fk
    FOREIGN KEY (workspace_id, rule_set_version_id) REFERENCES rule_set_versions (workspace_id, id),
  CONSTRAINT rules_edition_key_unique UNIQUE (workspace_id, rule_set_version_id, rule_key)
);

-- Rules are edition content: immutable once written (draft edits happen by
-- rewriting the edition's rule set before publication).
CREATE TRIGGER rules_immutable
  BEFORE UPDATE OR DELETE ON rules
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE INDEX idx_rules_edition ON rules (workspace_id, rule_set_version_id, rule_key);

-- ---------------------------------------------------------------------------
-- Subtype checker for RULE_SET (0010 extension contract).
-- ---------------------------------------------------------------------------
CREATE FUNCTION enforce_subject_subtype_rule_set(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: RULE_SET subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM rule_sets r WHERE r.workspace_id = p_workspace_id AND r.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: RULE_SET subject % has no rule_sets row', p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('RULE_SET', 'enforce_subject_subtype_rule_set', 'M5');
