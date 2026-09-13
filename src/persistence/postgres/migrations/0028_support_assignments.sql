-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §3 line "support_assignments" and
-- DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §14: an assignment "owns selected
-- fulfilment, not mandatory coverage or eligibility". Concretely that means:
--   * this table has no coverage requirement, no minimum-count and no
--     eligibility column - the columns that would let an edit quietly weaken
--     the requirement are simply absent;
--   * the pinned requirement version is reached by a composite foreign key into
--     the append-only 0027 key (workspace_id, id, version), so an assignment can
--     only ever name a requirement edition that actually exists;
--   * assigning a supporter the pinned requirement does not consider eligible
--     fails at COMMIT in this database, independently of the application-level
--     check in src/domain/v2/trip/support.ts.
--
-- There is no boolean "is_supported" column anywhere in M2: support is always a
-- named requirement plus named people over named intervals.
--
-- Scope intervals for one assignment MAY overlap. minimumSimultaneousSupporters
-- is permitted to exceed 1, so non-overlap exclusion constraints belong to the
-- requirement's own coverage arithmetic and to M6's assessment, not here.

CREATE TABLE support_assignments (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  constraint_definition_id uuid NOT NULL,
  constraint_definition_version integer NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'PROPOSED'
    CHECK (lifecycle_status IN ('PROPOSED', 'ACTIVE', 'SUPERSEDED', 'WITHDRAWN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT support_assignments_requirement_fk
    FOREIGN KEY (workspace_id, constraint_definition_id, constraint_definition_version)
    REFERENCES accompaniment_requirements (workspace_id, id, version)
);

CREATE INDEX idx_support_assignments_requirement
  ON support_assignments (workspace_id, constraint_definition_id, constraint_definition_version);
CREATE INDEX idx_support_assignments_lifecycle
  ON support_assignments (workspace_id, lifecycle_status);

CREATE TABLE support_assignment_assignees (
  workspace_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  supporter_traveller_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, assignment_id, supporter_traveller_id),
  CONSTRAINT support_assignment_assignees_assignment_fk
    FOREIGN KEY (workspace_id, assignment_id)
    REFERENCES support_assignments (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT support_assignment_assignees_traveller_fk
    FOREIGN KEY (workspace_id, supporter_traveller_id)
    REFERENCES travellers (workspace_id, id)
);

CREATE INDEX idx_support_assignment_assignees_traveller
  ON support_assignment_assignees (workspace_id, supporter_traveller_id);

-- One row per assigned segment: a supporter can hold several disjoint partial
-- segments of the same journey, which is what "partial-route support" means.
CREATE TABLE support_assignment_scopes (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  supporter_traveller_id uuid NOT NULL,
  scope_start timestamptz NOT NULL,
  scope_end timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT support_assignment_scopes_assignee_fk
    FOREIGN KEY (workspace_id, assignment_id, supporter_traveller_id)
    REFERENCES support_assignment_assignees (workspace_id, assignment_id, supporter_traveller_id)
    ON DELETE CASCADE,
  CONSTRAINT support_assignment_scopes_ordered CHECK (scope_end > scope_start)
);

CREATE INDEX idx_support_assignment_scopes_assignment
  ON support_assignment_scopes (workspace_id, assignment_id, supporter_traveller_id, scope_start);
CREATE INDEX idx_support_assignment_scopes_traveller_window
  ON support_assignment_scopes (workspace_id, supporter_traveller_id, scope_start, scope_end);

-- A handoff is an explicit observed transition between two assigned supporters;
-- the permitted-gap arithmetic against the requirement stays in the domain
-- check and in M6's assessment. Both sides must be assignees of this same
-- assignment, enforced by two composite foreign keys.
CREATE TABLE support_assignment_handoffs (
  workspace_id uuid NOT NULL,
  assignment_id uuid NOT NULL,
  from_supporter_traveller_id uuid NOT NULL,
  to_supporter_traveller_id uuid NOT NULL,
  handoff_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, assignment_id, from_supporter_traveller_id, to_supporter_traveller_id, handoff_at),
  CONSTRAINT support_assignment_handoffs_assignment_fk
    FOREIGN KEY (workspace_id, assignment_id)
    REFERENCES support_assignments (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT support_assignment_handoffs_from_assignee_fk
    FOREIGN KEY (workspace_id, assignment_id, from_supporter_traveller_id)
    REFERENCES support_assignment_assignees (workspace_id, assignment_id, supporter_traveller_id)
    ON DELETE CASCADE,
  CONSTRAINT support_assignment_handoffs_to_assignee_fk
    FOREIGN KEY (workspace_id, assignment_id, to_supporter_traveller_id)
    REFERENCES support_assignment_assignees (workspace_id, assignment_id, supporter_traveller_id)
    ON DELETE CASCADE,
  CONSTRAINT support_assignment_handoffs_not_self CHECK (from_supporter_traveller_id <> to_supporter_traveller_id)
);

CREATE INDEX idx_support_assignment_handoffs_to
  ON support_assignment_handoffs (workspace_id, to_supporter_traveller_id, handoff_at);

-- Contract: assignedSupporterTravellerIds min(1), and eligibility is inherited
-- from the pinned requirement edition and can never be widened by this row.
CREATE FUNCTION assert_support_assignment_consistency() RETURNS trigger AS $$
DECLARE
  v_assignees integer;
  v_ineligible integer;
BEGIN
  SELECT COUNT(*) INTO v_assignees
    FROM support_assignment_assignees a
   WHERE a.workspace_id = NEW.workspace_id AND a.assignment_id = NEW.id;
  IF v_assignees = 0 THEN
    RAISE EXCEPTION 'support_assignments % assigns no supporter', NEW.id;
  END IF;

  SELECT COUNT(*) INTO v_ineligible
    FROM support_assignment_assignees a
   WHERE a.workspace_id = NEW.workspace_id
     AND a.assignment_id = NEW.id
     AND NOT EXISTS (
       SELECT 1 FROM accompaniment_eligible_supporters e
        WHERE e.workspace_id = NEW.workspace_id
          AND e.requirement_id = NEW.constraint_definition_id
          AND e.requirement_version = NEW.constraint_definition_version
          AND e.supporter_traveller_id = a.supporter_traveller_id
     );
  IF v_ineligible > 0 THEN
    RAISE EXCEPTION
      'support_assignments % assigns % supporter(s) outside the eligible set of requirement % v% - an assignment cannot widen its governing requirement',
      NEW.id, v_ineligible, NEW.constraint_definition_id, NEW.constraint_definition_version;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER support_assignments_consistency_assert
  AFTER INSERT OR UPDATE ON support_assignments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_support_assignment_consistency();

CREATE FUNCTION enforce_subject_subtype_support_assignment(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: SUPPORT_ASSIGNMENT subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM support_assignments a
     WHERE a.workspace_id = p_workspace_id AND a.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: SUPPORT_ASSIGNMENT subject % has no support_assignments row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('SUPPORT_ASSIGNMENT', 'enforce_subject_subtype_support_assignment', 'M2');
