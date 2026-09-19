-- R4-F2 (0128): the smallest PG-native PROTECTED provider-execution input
-- contract for `external:offer.select` (Atlas sandbox transport booking).
--
-- WHY: PostgreSQL truth carried NEITHER (a) the raw provider offer identity a
-- selected transport option was researched under (it lived only in the
-- ephemeral planning world; `SELECT_OFFER.offerId` is a SubjectId-safe hash)
-- NOR (b) the passenger attributes a provider order needs that the Traveller
-- aggregate does not hold (gender is mandatory for Atlas; date of birth /
-- nationality optional). Contact channel VALUES are protected refs with no
-- resolver, and Atlas needs only a contact NAME, which is derived from the
-- LEGAL/DISPLAY traveller name already in `traveller_names`.
--
-- Neither table is canonical trip truth, assessment input, or a planning
-- input. They are read ONLY by the external execution boundary, after the
-- stored authority gate has passed. Neither is written by an LLM or a
-- planner proposal.
--
--  1. offer_execution_bindings: written by the planning coordinator (application
--     composition) in the SAME wake that persists a viable SELECT_OFFER
--     strategy; immutable evidence of "this offer key means this provider
--     offer, researched at this time, at this price".
--  2. traveller_booking_identities: operator/authoritative supplied booking
--     attributes per Traveller. Absence => execution refuses (never guessed).

CREATE TABLE offer_execution_bindings (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  recovery_case_id uuid,
  recovery_strategy_id uuid NOT NULL,
  journey_item_id uuid NOT NULL,
  -- The SELECT_OFFER.offerId (SubjectId-safe deterministic key).
  offer_key text NOT NULL CHECK (length(btrim(offer_key)) > 0),
  provider_id text NOT NULL CHECK (length(btrim(provider_id)) > 0),
  -- Raw provider offer identity. Protected execution input: never rendered.
  provider_offer_ref text NOT NULL CHECK (length(btrim(provider_offer_ref)) > 0),
  -- Provenance of the research that produced the offer (LIVE/RECORD/REPLAY).
  research_mode text NOT NULL CHECK (research_mode IN ('LIVE', 'RECORD', 'REPLAY', 'SIMULATED')),
  observed_at timestamptz NOT NULL,
  quoted_amount numeric NOT NULL CHECK (quoted_amount >= 0),
  quoted_currency text NOT NULL CHECK (quoted_currency ~ '^[A-Z]{3}$'),
  -- Bounded itinerary summary needed to materialise the canonical service on
  -- success: {originPlaceId, destinationPlaceId, departure, arrival, operator, mode}.
  itinerary jsonb NOT NULL CHECK (jsonb_typeof(itinerary) = 'object' AND pg_column_size(itinerary) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT offer_execution_bindings_identity_uidx
    UNIQUE (workspace_id, recovery_strategy_id, journey_item_id, offer_key)
);

CREATE INDEX idx_offer_execution_bindings_strategy
  ON offer_execution_bindings (workspace_id, recovery_strategy_id);

CREATE TRIGGER offer_execution_bindings_immutable
  BEFORE UPDATE OR DELETE ON offer_execution_bindings
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE traveller_booking_identities (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  traveller_id uuid NOT NULL,
  -- Provider-mappable gender; never inferred from a name.
  gender text NOT NULL CHECK (gender IN ('MALE', 'FEMALE')),
  date_of_birth date,
  -- ISO 3166-1 alpha-2.
  nationality char(2) CHECK (nationality IS NULL OR nationality ~ '^[A-Z]{2}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, traveller_id),
  CONSTRAINT traveller_booking_identities_traveller_fk
    FOREIGN KEY (workspace_id, traveller_id) REFERENCES travellers (workspace_id, id)
);
