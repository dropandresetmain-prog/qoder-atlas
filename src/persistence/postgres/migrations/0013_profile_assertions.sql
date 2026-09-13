-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §2: profile_assertions are immutable
-- assertion editions under the Traveller's aggregate revision. "Profile updates
-- must say whether they correct an assertion, accept an observed edition or
-- change an intention" — an accepted edition is therefore a new row, never an
-- in-place overwrite, and supersession is an explicit sourced link.
--
-- JSON policy §10: `value` is exactly the frozen contract field
-- ProfileAssertionSchema.value (an opaque schema-bound record), so it is
-- persisted as bounded, version-tagged JSON rather than a per-type table zoo
-- that M5's registered-schema work would later have to reconcile. The width and
-- version are checked here; queried/related fields are lifted into columns by
-- whichever lane actually filters on them (recorded as an open item in
-- docs/refactor/evidence/M2.md).

CREATE TABLE profile_assertions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  traveller_id uuid NOT NULL,
  assertion_type text NOT NULL CHECK (
    assertion_type IN ('CITIZENSHIP', 'RESIDENCY', 'ACCESSIBILITY_NEED', 'SUPPORT_NEED', 'CONTACT_PREFERENCE')
  ),
  effective_from date NOT NULL,
  effective_to date,
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  value_schema_version text NOT NULL CHECK (length(btrim(value_schema_version)) > 0),
  evidence_id uuid NOT NULL,
  supersedes_assertion_id uuid,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT profile_assertions_traveller_fk
    FOREIGN KEY (workspace_id, traveller_id) REFERENCES travellers (workspace_id, id),
  CONSTRAINT profile_assertions_effective_range CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  CONSTRAINT profile_assertions_not_self_superseding CHECK (
    supersedes_assertion_id IS NULL OR supersedes_assertion_id <> id
  ),
  -- §10 "validate schema, size and version at every boundary": an unbounded
  -- record bag is exactly the extensibility bucket this design forbids.
  CONSTRAINT profile_assertions_value_size CHECK (pg_column_size(value) <= 8192)
);

CREATE INDEX idx_profile_assertions_traveller
  ON profile_assertions (workspace_id, traveller_id, assertion_type, effective_from);
CREATE INDEX idx_profile_assertions_supersedes ON profile_assertions (workspace_id, supersedes_assertion_id)
  WHERE supersedes_assertion_id IS NOT NULL;

CREATE TRIGGER profile_assertions_immutable
  BEFORE UPDATE OR DELETE ON profile_assertions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- A supersession chain may only replace the same assertion of the same person;
-- anything else is two unrelated facts, not a correction.
CREATE FUNCTION assert_profile_assertion_supersession_matches() RETURNS trigger AS $$
DECLARE
  v_prev_traveller uuid;
  v_prev_type text;
BEGIN
  IF NEW.supersedes_assertion_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT p.traveller_id, p.assertion_type INTO v_prev_traveller, v_prev_type
    FROM profile_assertions p
   WHERE p.workspace_id = NEW.workspace_id AND p.id = NEW.supersedes_assertion_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'profile_assertions supersession violation: % supersedes unknown assertion %',
      NEW.id, NEW.supersedes_assertion_id;
  END IF;
  IF v_prev_traveller <> NEW.traveller_id OR v_prev_type <> NEW.assertion_type THEN
    RAISE EXCEPTION
      'profile_assertions supersession violation: % supersedes a different traveller or type (%)',
      NEW.id, NEW.supersedes_assertion_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Deferred: the superseded edition is inserted in the same command
-- transaction when a correction chain is seeded at once.
CREATE CONSTRAINT TRIGGER profile_assertions_supersession_check
  AFTER INSERT ON profile_assertions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_profile_assertion_supersession_matches();
