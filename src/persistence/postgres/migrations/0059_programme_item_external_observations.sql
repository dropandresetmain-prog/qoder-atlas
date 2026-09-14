-- M4 brief §F / F06: "observed external schedule and internally controlled
-- schedule have distinct admission semantics." `programme_items` is intent/
-- authoritative truth for an INTERNAL-authority item; this table is the
-- separate, immutable capture of what an external system reported, so a
-- disputed or divergent external report never silently overwrites
-- `programme_items` as though NORTHSTAR controlled the external publisher
-- (DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md "Externally owned state is not
-- changed merely because Northstar submitted a request").
--
-- `conflicts_with_current` is computed once, at acceptance time, by the
-- command handler comparing the observation to the item's current window/place
-- — it is evidence the observation disagreed with current truth, not a live
-- assessment (M6 owns assessments).

CREATE TABLE programme_item_external_observations (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  programme_item_id uuid NOT NULL,
  observed_window_start timestamptz,
  observed_window_end timestamptz,
  observed_place_id uuid,
  observed_lifecycle_status text CHECK (observed_lifecycle_status IN ('SCHEDULED', 'COMPLETED', 'CANCELLED')),
  source_ref text NOT NULL CHECK (source_ref <> ''),
  observed_at timestamptz NOT NULL,
  conflicts_with_current boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT programme_item_external_observations_item_fk
    FOREIGN KEY (workspace_id, programme_item_id) REFERENCES programme_items (workspace_id, id),
  CONSTRAINT programme_item_external_observations_place_fk
    FOREIGN KEY (workspace_id, observed_place_id) REFERENCES places (workspace_id, id),
  CONSTRAINT programme_item_external_observations_window_shape CHECK (
    (observed_window_start IS NULL AND observed_window_end IS NULL)
    OR (observed_window_start IS NOT NULL AND observed_window_end IS NOT NULL
        AND observed_window_end > observed_window_start)
  )
);

CREATE INDEX idx_programme_item_external_observations_item
  ON programme_item_external_observations (workspace_id, programme_item_id, observed_at DESC);

-- Reuses the shared `forbid_mutation()` (0003) every M2 immutable table already uses.
CREATE TRIGGER programme_item_external_observations_immutable
  BEFORE UPDATE OR DELETE ON programme_item_external_observations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
