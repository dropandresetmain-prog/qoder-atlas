-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §5: ResourceAssignment "references the
-- schedule owner's window rather than copying it as truth" (matches the frozen
-- `ResourceAssignmentSchema`, src/domain/v2/programmes/programme.ts) — there is
-- deliberately no start/end column here.
--
-- `activity_id` is kind-checked at command time (per the frozen schema's own
-- comment) against exactly the two owners the M4 brief allows: a M4-owned
-- `programme_items` row or a M2-owned `journey_items` row. This is not a
-- domain_subjects TypedRef (RESOURCE_ASSIGNMENT is not a registered
-- SubjectKind — like `participation_roles`, it is a plain association, not an
-- aggregate root), so the deferred trigger below is the cross-table guard.
--
-- `resource_id` stays a **deferred FK for M3** per the parallel-lane discipline
-- (M3's `resources` table does not exist on this branch): typed uuid column,
-- indexed, no FK — the exact integration ALTER TABLE is recorded in
-- docs/refactor/evidence/M4.md for M3/the integrator to run, mirroring how M2
-- left `transport_item_details.selected_service_id` for M3 to close.

CREATE TABLE resource_assignments (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  activity_kind text NOT NULL CHECK (activity_kind IN ('PROGRAMME_ITEM', 'JOURNEY_ITEM')),
  activity_id uuid NOT NULL,
  resource_id uuid NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  lifecycle_status text NOT NULL DEFAULT 'PROPOSED' CHECK (lifecycle_status IN ('PROPOSED', 'CONFIRMED', 'RELEASED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX idx_resource_assignments_activity ON resource_assignments (workspace_id, activity_kind, activity_id);
-- §11 "resource to line and JourneyItem reverse lookup for shared disruption",
-- extended here to ProgrammeItem: "which resources are assigned to this item?"
CREATE INDEX idx_resource_assignments_resource ON resource_assignments (workspace_id, resource_id, lifecycle_status);

CREATE FUNCTION assert_resource_assignment_activity_exists() RETURNS trigger AS $$
BEGIN
  IF NEW.activity_kind = 'PROGRAMME_ITEM' THEN
    IF NOT EXISTS (
      SELECT 1 FROM programme_items pi WHERE pi.workspace_id = NEW.workspace_id AND pi.id = NEW.activity_id
    ) THEN
      RAISE EXCEPTION 'resource_assignments % references missing programme_items %', NEW.id, NEW.activity_id;
    END IF;
  ELSIF NEW.activity_kind = 'JOURNEY_ITEM' THEN
    IF NOT EXISTS (
      SELECT 1 FROM journey_items ji WHERE ji.workspace_id = NEW.workspace_id AND ji.id = NEW.activity_id
    ) THEN
      RAISE EXCEPTION 'resource_assignments % references missing journey_items %', NEW.id, NEW.activity_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER resource_assignments_activity_assert
  AFTER INSERT OR UPDATE ON resource_assignments
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_resource_assignment_activity_exists();
