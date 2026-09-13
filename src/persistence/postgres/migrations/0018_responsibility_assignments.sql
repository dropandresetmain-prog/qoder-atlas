-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §2: responsibility_assignments records who
-- is responsible for what, in which role. F05 keeps this separate from
-- authority: being the payer or the duty-of-care party does not make you able
-- to act. §9 constraint 3 and the C1 typed-identity amendment both land here:
-- the referenced subject is a TypedRef validated against the identity registry,
-- so an existing UUID presented under the wrong kind is rejected.

CREATE TABLE responsibility_assignments (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  organisation_id uuid NOT NULL,
  subject_ref_kind text NOT NULL REFERENCES subject_kinds (kind),
  subject_ref_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('OPERATOR', 'ARRANGER', 'SERVICER', 'PAYER', 'DUTY_OF_CARE')),
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT responsibility_assignments_organisation_fk
    FOREIGN KEY (workspace_id, organisation_id) REFERENCES organisations (workspace_id, id),
  CONSTRAINT responsibility_assignments_effective_range CHECK (
    effective_to IS NULL OR effective_to > effective_from
  )
);

CREATE INDEX idx_responsibility_assignments_subject
  ON responsibility_assignments (workspace_id, subject_ref_kind, subject_ref_id);
CREATE INDEX idx_responsibility_assignments_organisation
  ON responsibility_assignments (workspace_id, organisation_id, role);

-- §2: "Subject kind whitelist for each role". Kept as data so a later lane
-- extends the roles it owns with an INSERT instead of editing this lane's rule.
CREATE TABLE responsibility_role_subject_kinds (
  role text NOT NULL CHECK (role IN ('OPERATOR', 'ARRANGER', 'SERVICER', 'PAYER', 'DUTY_OF_CARE')),
  subject_kind text NOT NULL REFERENCES subject_kinds (kind) ON DELETE RESTRICT,
  installed_by text NOT NULL,
  PRIMARY KEY (role, subject_kind)
);

INSERT INTO responsibility_role_subject_kinds (role, subject_kind, installed_by) VALUES
  ('OPERATOR', 'TRIP', 'M2'),
  ('OPERATOR', 'JOURNEY', 'M2'),
  ('ARRANGER', 'TRIP', 'M2'),
  ('ARRANGER', 'JOURNEY', 'M2'),
  ('SERVICER', 'JOURNEY', 'M2'),
  ('PAYER', 'TRIP', 'M2'),
  ('PAYER', 'JOURNEY', 'M2'),
  ('DUTY_OF_CARE', 'TRAVELLER', 'M2'),
  ('DUTY_OF_CARE', 'TRIP', 'M2'),
  ('DUTY_OF_CARE', 'JOURNEY', 'M2');

-- Two half-rules that ordinary constraints cannot express, both checked at
-- COMMIT so a single command may create the referenced subject and the
-- assignment together:
--   1. the TypedRef must name a real registry subject of that exact kind in
--      this workspace (wrong kind or another workspace's id fails);
--   2. the referenced kind must be whitelisted for the role.
CREATE FUNCTION assert_responsibility_assignment_subject() RETURNS trigger AS $$
DECLARE
  v_registry boolean;
  v_allowed boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM domain_subjects s
     WHERE s.workspace_id = NEW.workspace_id
       AND s.id = NEW.subject_ref_id
       AND s.kind = NEW.subject_ref_kind
  ) INTO v_registry;
  IF NOT v_registry THEN
    RAISE EXCEPTION
      'responsibility_assignments %: no % subject % in this workspace (a matching id under another kind is not a valid TypedRef)',
      NEW.id, NEW.subject_ref_kind, NEW.subject_ref_id;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM responsibility_role_subject_kinds w
     WHERE w.role = NEW.role AND w.subject_kind = NEW.subject_ref_kind
  ) INTO v_allowed;
  IF NOT v_allowed THEN
    RAISE EXCEPTION
      'responsibility_assignments %: role % does not accept subject kind %',
      NEW.id, NEW.role, NEW.subject_ref_kind;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER responsibility_assignments_subject_assert
  AFTER INSERT OR UPDATE ON responsibility_assignments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_responsibility_assignment_subject();

CREATE FUNCTION enforce_subject_subtype_responsibility_assignment(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: RESPONSIBILITY_ASSIGNMENT subject % must be its own aggregate root (aggregate_id=% )',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM responsibility_assignments a
     WHERE a.workspace_id = p_workspace_id AND a.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: RESPONSIBILITY_ASSIGNMENT subject % has no responsibility_assignments row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('RESPONSIBILITY_ASSIGNMENT', 'enforce_subject_subtype_responsibility_assignment', 'M2');
