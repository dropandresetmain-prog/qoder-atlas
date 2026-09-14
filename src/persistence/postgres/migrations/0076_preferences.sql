-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §6: `preferences` — "Traveller/scoped owner:
-- kind, explicit/inferred source, value, precedence, validity. Explicit
-- instructions outrank inferred preferences; schema-bound values."
--
-- Precedence is NOT a stored rank (M0 migration-mapping note: "keep precedence
-- computed rather than stored"). The source column is the only precedence
-- input a reader needs: EXPLICIT outranks INFERRED by rule, and an INFERRED
-- preference can never be an obligation — there is no obligation/hardness
-- column here at all.

CREATE TABLE preferences (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  owner_kind text NOT NULL REFERENCES subject_kinds (kind),
  owner_id uuid NOT NULL,
  preference_kind text NOT NULL CHECK (length(btrim(preference_kind)) > 0),
  source text NOT NULL CHECK (source IN ('EXPLICIT', 'INFERRED')),
  -- Schema-bound value: a bounded, version-tagged record — never a free-form
  -- bag (§10). The version names the writer's contract, like
  -- profile_assertions.value_schema_version (0013).
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  value_schema_version text NOT NULL CHECK (length(btrim(value_schema_version)) > 0),
  -- Where this preference came from: an explicit instruction cites its
  -- evidence; an inference cites the evidence it was derived from. Inference
  -- provenance is mandatory so a reader can always tell why it exists.
  evidence_id uuid NOT NULL,
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  supersedes_preference_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT preferences_owner_fk
    FOREIGN KEY (workspace_id, owner_kind, owner_id)
    REFERENCES domain_subjects (workspace_id, id, kind),
  CONSTRAINT preferences_evidence_fk
    FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id),
  CONSTRAINT preferences_effective_ordered CHECK (
    effective_until IS NULL OR effective_until > effective_from
  ),
  CONSTRAINT preferences_not_self_superseding CHECK (
    supersedes_preference_id IS NULL OR supersedes_preference_id <> id
  ),
  CONSTRAINT preferences_value_size CHECK (pg_column_size(value) <= 8192)
);

CREATE INDEX idx_preferences_owner
  ON preferences (workspace_id, owner_kind, owner_id, preference_kind, effective_from);
CREATE INDEX idx_preferences_supersedes
  ON preferences (workspace_id, supersedes_preference_id)
  WHERE supersedes_preference_id IS NOT NULL;

-- Append-only: correcting a preference is a new edition that cites the old one.
CREATE TRIGGER preferences_immutable
  BEFORE UPDATE OR DELETE ON preferences
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- A supersession chain may only replace the same preference kind of the same
-- owner (0013's assertion pattern).
CREATE FUNCTION assert_preference_supersession_matches() RETURNS trigger AS $$
DECLARE
  v_prev_owner_kind text;
  v_prev_owner_id uuid;
  v_prev_kind text;
BEGIN
  IF NEW.supersedes_preference_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT p.owner_kind, p.owner_id, p.preference_kind
    INTO v_prev_owner_kind, v_prev_owner_id, v_prev_kind
    FROM preferences p
   WHERE p.workspace_id = NEW.workspace_id AND p.id = NEW.supersedes_preference_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'preferences supersession violation: % supersedes unknown preference %',
      NEW.id, NEW.supersedes_preference_id;
  END IF;
  IF v_prev_owner_kind <> NEW.owner_kind OR v_prev_owner_id <> NEW.owner_id OR v_prev_kind <> NEW.preference_kind THEN
    RAISE EXCEPTION
      'preferences supersession violation: % supersedes a different owner or kind (%)',
      NEW.id, v_prev_kind;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER preferences_supersession_assert
  AFTER INSERT ON preferences
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_preference_supersession_matches();

-- ---------------------------------------------------------------------------
-- Subtype checker for PREFERENCE (0010 extension contract).
-- ---------------------------------------------------------------------------
CREATE FUNCTION enforce_subject_subtype_preference(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: PREFERENCE subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM preferences p
     WHERE p.workspace_id = p_workspace_id AND p.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: PREFERENCE subject % has no preferences row', p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('PREFERENCE', 'enforce_subject_subtype_preference', 'M5');
