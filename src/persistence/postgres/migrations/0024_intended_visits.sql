-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §3: intended_visits record what a Journey
-- intends to do in a jurisdiction, independently of any purchased transport.
-- This is the table M6's entry/transit/advisory applicability lookups read
-- first ("which travellers intend to be in jurisdiction J in window W"), which
-- is why the jurisdiction reverse-lookup index exists here rather than waiting
-- for a query to appear: the acceptance case for a mid-route rule publication
-- is impossible without it.
--
-- jurisdiction_id has no foreign key in this range (jurisdictions are M4-owned)
-- and is recorded in the MIGRATION_MAPPING.md deferral ledger. transit_intent is
-- kept explicit because a transit-only intent changes which rules apply and
-- must never be inferred from the absence of an engagement.

CREATE TABLE intended_visits (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  journey_id uuid NOT NULL,
  jurisdiction_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose <> ''),
  intended_start timestamptz NOT NULL,
  intended_end timestamptz NOT NULL,
  transit_intent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT intended_visits_journey_fk
    FOREIGN KEY (workspace_id, journey_id) REFERENCES journeys (workspace_id, id),
  -- Half-open [start, end) per InstantIntervalSchema; an instantaneous visit is
  -- not expressible, which matches the contract's strict start < end refine.
  CONSTRAINT intended_visits_window_ordered CHECK (intended_end > intended_start)
);

-- M6 reverse lookup: jurisdiction -> intending journeys, narrowed by window.
CREATE INDEX idx_intended_visits_jurisdiction_window
  ON intended_visits (workspace_id, jurisdiction_id, intended_start, intended_end);
CREATE INDEX idx_intended_visits_journey ON intended_visits (workspace_id, journey_id);
