-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §3 lines "coordination_groups" /
-- "group_memberships": a coordination group is an independent root that may
-- span Trips, and a membership is a Journey's participation in it with its own
-- effective range and optional item-level scope. Deliberately absent:
--   * any Trip foreign key on the group - §3 says a group may span Trips;
--   * any primary/main/lead column - the same line forbids a duplicate
--     identity hierarchy inside a group;
--   * any authority or responsibility meaning - F05 keeps those in 0018/0019.
--
-- `purpose` is nullable because §3 names it while the C0-frozen
-- CoordinationGroupSchema does not carry it. The repository leaves it NULL
-- until an additive (F16) contract field introduces it; it is present so the
-- target schema is not silently missing a documented column. Recorded as a
-- schema/contract divergence in docs/refactor/evidence/M2.md.
--
-- Membership item scope is an association table (§10: no JSON for anything a
-- later lane joins), and "range/item scope permits partial-route coordination"
-- is exactly why the scope is per-item rather than all-or-nothing.

CREATE TABLE coordination_groups (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  name text NOT NULL CHECK (name <> ''),
  purpose text,
  lifecycle_status text NOT NULL DEFAULT 'DRAFT'
    CHECK (lifecycle_status IN ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  effective_start timestamptz,
  effective_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT coordination_groups_effective_shape CHECK (
    (effective_start IS NULL AND effective_end IS NULL)
    OR (effective_start IS NOT NULL AND effective_end IS NOT NULL
        AND effective_end > effective_start)
  )
);

CREATE INDEX idx_coordination_groups_workspace_lifecycle
  ON coordination_groups (workspace_id, lifecycle_status);

CREATE TABLE group_memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  coordination_group_id uuid NOT NULL,
  journey_id uuid NOT NULL,
  effective_start timestamptz,
  effective_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT group_memberships_group_fk
    FOREIGN KEY (workspace_id, coordination_group_id)
    REFERENCES coordination_groups (workspace_id, id),
  CONSTRAINT group_memberships_journey_fk
    FOREIGN KEY (workspace_id, journey_id) REFERENCES journeys (workspace_id, id),
  CONSTRAINT group_memberships_effective_shape CHECK (
    (effective_start IS NULL AND effective_end IS NULL)
    OR (effective_start IS NOT NULL AND effective_end IS NOT NULL
        AND effective_end > effective_start)
  ),
  CONSTRAINT group_memberships_one_per_journey_uidx UNIQUE (workspace_id, coordination_group_id, journey_id)
);

CREATE INDEX idx_group_memberships_journey ON group_memberships (workspace_id, journey_id);

CREATE TABLE group_membership_items (
  workspace_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  journey_item_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, membership_id, journey_item_id),
  CONSTRAINT group_membership_items_membership_fk
    FOREIGN KEY (workspace_id, membership_id)
    REFERENCES group_memberships (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT group_membership_items_item_fk
    FOREIGN KEY (workspace_id, journey_item_id) REFERENCES journey_items (workspace_id, id)
);

CREATE INDEX idx_group_membership_items_item
  ON group_membership_items (workspace_id, journey_item_id);

-- An item-scope link may not reach into another traveller's itinerary: the
-- scoped item must belong to the Journey this membership names. Evaluated at
-- COMMIT so a command can add items and scope them in the same transaction.
CREATE FUNCTION assert_group_membership_item_scope_ownership() RETURNS trigger AS $$
DECLARE
  v_journey_id uuid;
  v_item_journey_id uuid;
BEGIN
  SELECT m.journey_id INTO v_journey_id
    FROM group_memberships m
   WHERE m.workspace_id = NEW.workspace_id AND m.id = NEW.membership_id;
  SELECT i.journey_id INTO v_item_journey_id
    FROM journey_items i
   WHERE i.workspace_id = NEW.workspace_id AND i.id = NEW.journey_item_id;
  IF v_item_journey_id IS DISTINCT FROM v_journey_id THEN
    RAISE EXCEPTION
      'group_membership_items: item % belongs to journey %, not the membership journey %',
      NEW.journey_item_id, v_item_journey_id, v_journey_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER group_membership_items_ownership_assert
  AFTER INSERT OR UPDATE ON group_membership_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_group_membership_item_scope_ownership();

CREATE FUNCTION enforce_subject_subtype_coordination_group(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: COORDINATION_GROUP subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM coordination_groups g
     WHERE g.workspace_id = p_workspace_id AND g.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: COORDINATION_GROUP subject % has no coordination_groups row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('COORDINATION_GROUP', 'enforce_subject_subtype_coordination_group', 'M2');
