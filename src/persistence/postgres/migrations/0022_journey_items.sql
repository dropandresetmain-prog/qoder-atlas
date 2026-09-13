-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §3 line "journey_items": a Journey child
-- with kind, order key, lifecycle, flexibility and intended interval; unique
-- stable identity; typed detail mandatory (0023_journey_item_details.sql).
--
-- Two decisions worth stating because they shape how later lanes extend this:
--
-- 1. Aggregate ownership. A JourneyItem is registered in domain_subjects with
--    aggregate_id = its Journey's id: the Journey head is the single revision
--    counter for the itinerary, so adding or re-slotting an item advances one
--    head rather than creating N concurrently-versioned roots. The item still
--    has its own registry identity, so a TypedRef(JOURNEY_ITEM, id) resolves
--    and M3 allocations / M6 assessments can name it. The subtype checker
--    below is what makes that ownership structural instead of conventional.
--
-- 2. Order is not dependency. order_key is a deterministic sort key only;
--    §3 forbids reading it as an executable dependency, and ties are allowed
--    (resolved by id). No unique index is placed on it for that reason.
--    Executable propagation is M6's registered-dependency engine's job.
--
-- No supplier, reservation, service or price column exists here: M3 owns that
-- truth and links it by its own typed FKs.

CREATE TABLE journey_items (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  journey_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('TRANSPORT', 'STAY', 'ENGAGEMENT', 'RESOURCE_USE')),
  order_key text NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'PLANNED'
    CHECK (lifecycle_status IN ('PLANNED', 'ACTIVE', 'COMPLETED', 'DROPPED')),
  flexible boolean NOT NULL DEFAULT false,
  intended_window_start timestamptz,
  intended_window_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT journey_items_journey_fk
    FOREIGN KEY (workspace_id, journey_id) REFERENCES journeys (workspace_id, id),
  CONSTRAINT journey_items_intended_window_shape CHECK (
    (intended_window_start IS NULL AND intended_window_end IS NULL)
    OR (intended_window_start IS NOT NULL AND intended_window_end IS NOT NULL
        AND intended_window_end > intended_window_start)
  ),
  -- Referable target for the discriminating per-kind detail FKs in 0023, so a
  -- STAY detail row cannot be attached to a TRANSPORT item.
  CONSTRAINT journey_items_id_kind_uidx UNIQUE (workspace_id, id, kind)
);

CREATE INDEX idx_journey_items_journey_order
  ON journey_items (workspace_id, journey_id, order_key, id);
CREATE INDEX idx_journey_items_workspace_window
  ON journey_items (workspace_id, intended_window_start)
  WHERE intended_window_start IS NOT NULL;

CREATE FUNCTION enforce_subject_subtype_journey_item(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_journey_id uuid;
BEGIN
  SELECT i.journey_id INTO v_journey_id
    FROM journey_items i
   WHERE i.workspace_id = p_workspace_id AND i.id = p_id;
  IF v_journey_id IS NULL THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: JOURNEY_ITEM subject % has no journey_items row',
      p_id;
  END IF;
  IF p_aggregate_id <> v_journey_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: JOURNEY_ITEM % must aggregate under its Journey % (aggregate_id=%)',
      p_id, v_journey_id, p_aggregate_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('JOURNEY_ITEM', 'enforce_subject_subtype_journey_item', 'M2');
