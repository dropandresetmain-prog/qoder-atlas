-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §1: registry kind/subtype and aggregate-owner
-- consistency is enforced by the deferred constraint trigger installed in 0003.
--
-- M1 shipped that trigger with one hard-coded WORKSPACE branch and told each
-- later lane to `CREATE OR REPLACE` the whole function. Parallel M3/M4/M5 lanes
-- doing that would each delete the other lanes' branches at integration, so
-- M2 converts the same rule into a data-driven dispatcher: this file owns the
-- dispatcher, every lane owns only its own checker function plus one registry
-- row inside its own migration. Semantics are unchanged — a kind with no
-- registry row still fails closed.
--
-- Extension contract for later lanes (also recorded in
-- docs/refactor/evidence/M2.md and docs/refactor/MIGRATION_MAPPING.md §5):
--   1. CREATE FUNCTION enforce_subject_subtype_<kind>(
--        p_workspace_id uuid, p_id uuid, p_kind text, p_aggregate_id uuid
--      ) RETURNS void LANGUAGE plpgsql AS $$ ... $$;
--      Raise an exception whose message starts
--      'domain_subjects subtype violation:' for every rejection.
--   2. INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by)
--      VALUES ('<KIND>', 'enforce_subject_subtype_<kind>', '<MILESTONE>');
--   Never modify this file, the dispatcher, or another lane's checker.

CREATE TABLE subject_subtype_checkers (
  kind text PRIMARY KEY REFERENCES subject_kinds (kind),
  -- Bare identifier only: it is interpolated with %I by the dispatcher, and the
  -- CHECK is what keeps that interpolation from ever receiving a qualified or
  -- expression-valued name.
  checker_function text NOT NULL CHECK (checker_function ~ '^[a-z_][a-z0-9_]*$'),
  installed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- M1's WORKSPACE rule, moved verbatim from 0003 so no accepted-C1 semantics change.
CREATE FUNCTION enforce_subject_subtype_workspace(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_workspace_id <> p_id OR p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: WORKSPACE subject % must have workspace_id = id = aggregate_id',
      p_id;
  END IF;
  -- Defense-in-depth only: for this kind, workspace_id = id by the check above,
  -- and aggregate_heads/domain_subjects's own `workspace_id REFERENCES
  -- workspaces (id)` FK already makes this branch unreachable in practice (a
  -- WORKSPACE subject cannot be inserted at all without a workspaces row
  -- existing first). Kept in case a future migration ever relaxes that FK; do
  -- not treat this branch as the primary guarantee.
  IF NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = p_id) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: no workspaces row for WORKSPACE subject %', p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('WORKSPACE', 'enforce_subject_subtype_workspace', 'M1');

CREATE OR REPLACE FUNCTION enforce_domain_subject_subtype() RETURNS trigger AS $$
DECLARE
  v_checker text;
BEGIN
  SELECT checker_function INTO v_checker
    FROM subject_subtype_checkers
   WHERE kind = NEW.kind;

  IF v_checker IS NULL THEN
    -- Kinds are pre-registered in subject_kinds long before their typed tables
    -- exist. Fail closed rather than letting an untyped registry/head pair
    -- become authoritative.
    RAISE EXCEPTION
      'domain_subjects subtype violation: kind % has no installed typed-table enforcement',
      NEW.kind;
  END IF;

  BEGIN
    EXECUTE format('SELECT %I($1, $2, $3, $4)', v_checker)
      USING NEW.workspace_id, NEW.id, NEW.kind, NEW.aggregate_id;
  EXCEPTION WHEN undefined_function THEN
    -- A registry row can only be written by a migration, so this means a lane
    -- shipped a row without its checker (or dropped the checker): still closed.
    RAISE EXCEPTION
      'domain_subjects subtype violation: checker % registered for kind % is not installed',
      v_checker, NEW.kind;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
