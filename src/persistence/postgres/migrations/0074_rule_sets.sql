-- M5: immutable published rule-set editions and bounded executable rules.
-- A rule edition is a source/policy publication, not an assessment. Its
-- expression is a closed data language; it is never evaluated as SQL, JS or a
-- script. Draft authoring and publication are explicit state transitions.

CREATE TABLE rule_sets (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  issuer_kind text NOT NULL REFERENCES subject_kinds (kind),
  issuer_id uuid NOT NULL,
  policy_family text NOT NULL CHECK (length(btrim(policy_family)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT rule_sets_issuer_fk
    FOREIGN KEY (workspace_id, issuer_id, issuer_kind)
    REFERENCES domain_subjects (workspace_id, id, kind),
  CONSTRAINT rule_sets_issuer_restricted
    CHECK (issuer_kind IN ('ORGANISATION', 'PRINCIPAL'))
);

CREATE INDEX idx_rule_sets_issuer ON rule_sets (workspace_id, issuer_kind, issuer_id);
CREATE INDEX idx_rule_sets_family ON rule_sets (workspace_id, policy_family);

-- The database repeats the application boundary check so direct SQL cannot
-- smuggle in an unbounded expression. Object keys are deliberately closed.
CREATE FUNCTION rule_expression_is_bounded(p_expression jsonb, p_depth integer)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_depth <= 0 OR jsonb_typeof(p_expression) <> 'object' THEN
    RETURN false;
  END IF;

  CASE p_expression ->> 'operator'
    WHEN 'ALL', 'ANY' THEN
      RETURN jsonb_typeof(p_expression -> 'operands') = 'array'
        AND jsonb_array_length(p_expression -> 'operands') BETWEEN 1 AND 32
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_expression) AS k
          WHERE k NOT IN ('operator', 'operands')
        )
        AND (
          SELECT bool_and(rule_expression_is_bounded(value, p_depth - 1))
          FROM jsonb_array_elements(p_expression -> 'operands')
        );
    WHEN 'NOT' THEN
      RETURN jsonb_typeof(p_expression -> 'operand') = 'object'
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_expression) AS k
          WHERE k NOT IN ('operator', 'operand')
        )
        AND rule_expression_is_bounded(p_expression -> 'operand', p_depth - 1);
    WHEN 'PREDICATE' THEN
      RETURN jsonb_typeof(p_expression -> 'predicateId') = 'string'
        AND length(btrim(p_expression ->> 'predicateId')) > 0
        AND jsonb_typeof(p_expression -> 'parameters') = 'object'
        AND pg_column_size(p_expression -> 'parameters') <= 8192
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_object_keys(p_expression) AS k
          WHERE k NOT IN ('operator', 'predicateId', 'parameters')
        );
    ELSE
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
  CONSTRAINT rule_set_versions_edition_unique
    UNIQUE (workspace_id, rule_set_id, edition_number),
  CONSTRAINT rule_set_versions_published_identity_unique
    UNIQUE (workspace_id, id, rule_set_id, published_at, published_by_actor_id),
  CONSTRAINT rule_set_versions_effective_ordered CHECK (
    effective_until IS NULL OR (effective_from IS NOT NULL AND effective_until > effective_from)
  ),
  CONSTRAINT rule_set_versions_published_shape CHECK (
    (status = 'DRAFT') = (published_at IS NULL AND published_by_actor_id IS NULL)
  )
);

-- A published edition may only be moved to a terminal publication state. Its
-- content/effective interval/identity never changes. DRAFT publication stamps
-- publication facts but cannot rewrite the edition in the same statement.
CREATE FUNCTION assert_rule_set_version_immutable_but_publishable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED' THEN
    IF NEW.expression IS DISTINCT FROM OLD.expression
       OR NEW.edition_number IS DISTINCT FROM OLD.edition_number
       OR NEW.rule_set_id IS DISTINCT FROM OLD.rule_set_id
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.effective_until IS DISTINCT FROM OLD.effective_until
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id
       OR NEW.published_at IS NULL
       OR NEW.published_by_actor_id IS NULL THEN
      RAISE EXCEPTION 'rule_set_versions violation: publishing may only stamp publication facts';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('PUBLISHED', 'SUPERSEDED', 'WITHDRAWN') THEN
    IF NEW.status NOT IN ('SUPERSEDED', 'WITHDRAWN')
       OR NEW.expression IS DISTINCT FROM OLD.expression
       OR NEW.edition_number IS DISTINCT FROM OLD.edition_number
       OR NEW.rule_set_id IS DISTINCT FROM OLD.rule_set_id
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.effective_until IS DISTINCT FROM OLD.effective_until
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.published_by_actor_id IS DISTINCT FROM OLD.published_by_actor_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id THEN
      RAISE EXCEPTION
        'rule_set_versions violation: published content is immutable; publish a new edition';
    END IF;
    RETURN NEW;
  END IF;

  -- Drafts are append-only rows too. A caller edits by submitting a new draft
  -- edition; this avoids mutable rule content being observed by an evaluator.
  IF NEW.status <> OLD.status
     OR NEW.expression IS DISTINCT FROM OLD.expression
     OR NEW.edition_number IS DISTINCT FROM OLD.edition_number
     OR NEW.rule_set_id IS DISTINCT FROM OLD.rule_set_id
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.effective_until IS DISTINCT FROM OLD.effective_until
     OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.published_by_actor_id IS DISTINCT FROM OLD.published_by_actor_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id THEN
    RAISE EXCEPTION 'rule_set_versions violation: edition rows are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rule_set_versions_publication_freeze
  BEFORE UPDATE ON rule_set_versions
  FOR EACH ROW EXECUTE FUNCTION assert_rule_set_version_immutable_but_publishable();
CREATE TRIGGER rule_set_versions_no_delete
  BEFORE DELETE ON rule_set_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

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
  CONSTRAINT rules_edition_key_unique
    UNIQUE (workspace_id, rule_set_version_id, rule_key)
);

CREATE TRIGGER rules_immutable
  BEFORE UPDATE OR DELETE ON rules
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE INDEX idx_rules_edition ON rules (workspace_id, rule_set_version_id, rule_key);

CREATE FUNCTION enforce_subject_subtype_rule_set(
  p_workspace_id uuid, p_id uuid, p_kind text, p_aggregate_id uuid
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

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by)
VALUES ('RULE_SET', 'enforce_subject_subtype_rule_set', 'M5');
