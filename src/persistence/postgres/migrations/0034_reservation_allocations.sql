-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §4 line "reservation_allocations" /
-- closure §4.3 / F05: an allocation records which Traveller benefits from a
-- line, optionally satisfying which JourneyItem. One canonical reservation
-- serves many allocations; the booking is never copied per traveller (G5).
--
-- Enforced here rather than by handlers:
--   * the allocation's Traveller exists (FK to travellers);
--   * when a JourneyItem is named, that item's Journey belongs to the same
--     Traveller (deferred assertion — no single-column FK can express it);
--   * the allocation role/quantity are typed;
--   * equivalent duplicate allocations are prevented (unique tuple).
--
-- The allocation is a Reservation child (mutates under the Reservation head);
-- it is deliberately NOT a registry subject: it has no identity any other kind
-- references (case subjects/assessment inputs name Travellers, JourneyItems,
-- lines), and §1 keeps domain_subjects to objects, not association rows.

CREATE TABLE reservation_allocations (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  line_id uuid NOT NULL,
  traveller_id uuid NOT NULL,
  -- Optional only before itinerary assignment or where no Journey exists.
  journey_item_id uuid,
  allocation_role text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT reservation_allocations_reservation_fk
    FOREIGN KEY (workspace_id, reservation_id) REFERENCES reservations (workspace_id, id),
  CONSTRAINT reservation_allocations_line_fk
    FOREIGN KEY (workspace_id, line_id) REFERENCES reservation_lines (workspace_id, id),
  CONSTRAINT reservation_allocations_traveller_fk
    FOREIGN KEY (workspace_id, traveller_id) REFERENCES travellers (workspace_id, id),
  -- The JourneyItem must exist and, by the deferred assertion below, belong to
  -- a Journey of the SAME Traveller in the SAME workspace.
  CONSTRAINT reservation_allocations_journey_item_fk
    FOREIGN KEY (workspace_id, journey_item_id)
    REFERENCES journey_items (workspace_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  -- The line must belong to the allocation's reservation: an allocation can
  -- never attach a traveller to another booking's line.
  CONSTRAINT reservation_allocations_line_of_reservation
    FOREIGN KEY (workspace_id, line_id, reservation_id)
    REFERENCES reservation_lines (workspace_id, id, reservation_id),
  -- "Equivalent" = same line, traveller, item and role. Two allocations may
  -- still differ by role (e.g. lead passenger + companion).
  CONSTRAINT reservation_allocations_equivalent_uidx
    UNIQUE (workspace_id, line_id, traveller_id, journey_item_id, allocation_role),
  -- One allocation per traveller+item per line regardless of role: the same
  -- person cannot hold the same item twice on one line in different roles.
  CONSTRAINT reservation_allocations_item_once_uidx
    UNIQUE (workspace_id, line_id, traveller_id, journey_item_id)
);

CREATE INDEX idx_reservation_allocations_traveller
  ON reservation_allocations (workspace_id, traveller_id);
CREATE INDEX idx_reservation_allocations_journey_item
  ON reservation_allocations (workspace_id, journey_item_id)
  WHERE journey_item_id IS NOT NULL;
CREATE INDEX idx_reservation_allocations_line
  ON reservation_allocations (workspace_id, line_id);

-- PostgreSQL treats NULL as distinct in a normal UNIQUE constraint. These
-- partial indexes close that hole for allocations that have not yet been
-- attached to a JourneyItem while retaining the two documented equivalence
-- rules above.
CREATE UNIQUE INDEX reservation_allocations_equivalent_no_item_uidx
  ON reservation_allocations (workspace_id, line_id, traveller_id, allocation_role)
  WHERE journey_item_id IS NULL;
CREATE UNIQUE INDEX reservation_allocations_item_once_no_item_uidx
  ON reservation_allocations (workspace_id, line_id, traveller_id)
  WHERE journey_item_id IS NULL;

-- Constraint checklist #5 / closure §4.3: "Linked item must belong to that
-- person." journey_items has no traveller column (it hangs off journeys), so
-- the rule joins through journeys. Deferred, so the allocation and any
-- imported itinerary may commit in either order within one transaction.
CREATE FUNCTION assert_allocation_item_belongs_to_traveller() RETURNS trigger AS $$
DECLARE
  v_traveller_id uuid;
BEGIN
  IF NEW.journey_item_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT j.traveller_id INTO v_traveller_id
    FROM journey_items i
    JOIN journeys j ON j.workspace_id = i.workspace_id AND j.id = i.journey_id
   WHERE i.workspace_id = NEW.workspace_id AND i.id = NEW.journey_item_id;
  IF v_traveller_id IS NULL THEN
    RAISE EXCEPTION
      'reservation_allocations %: journey_item % does not exist or has no journey',
      NEW.id, NEW.journey_item_id;
  END IF;
  IF v_traveller_id <> NEW.traveller_id THEN
    RAISE EXCEPTION
      'reservation_allocations %: journey_item % belongs to traveller %, not allocation traveller % (F05)',
      NEW.id, NEW.journey_item_id, v_traveller_id, NEW.traveller_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER reservation_allocations_item_traveller_assert
  AFTER INSERT OR UPDATE OF journey_item_id, traveller_id ON reservation_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_allocation_item_belongs_to_traveller();
