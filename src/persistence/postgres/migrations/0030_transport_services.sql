-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §4 line "transport_services" / F06: a
-- TransportService is a shared occurrence of transport whose *observed supplier
-- schedule* is authoritative for the service, never for a Journey. The three
-- time fields (published / estimated / actual) are separate column groups and
-- are never copied into one another; every observed group carries its own
-- observed_at and evidence reference so "when did the supplier tell us this"
-- stays queryable.
--
-- The service is a root subject: it owns an aggregate_heads row. Its subtype
-- checker follows the 0010 registry contract.
--
-- No JourneyItem, traveller, reservation or price column exists here: intent is
-- M2's, bookings are the reservation family's (0032+), quotes are offers
-- (0037). Place identity is stored as an opaque uuid + reverse-lookup index
-- with no FK: places are M4-owned (0050-0069) and the exact FK is a documented
-- deferral, not an omission.

CREATE TABLE transport_services (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('AIR', 'RAIL', 'ROAD', 'SEA')),
  operator text NOT NULL,
  origin_place_id uuid NOT NULL,
  destination_place_id uuid NOT NULL,

  -- Published supplier schedule (the contracted occurrence).
  published_departure timestamptz,
  published_arrival timestamptz,
  published_observed_at timestamptz,
  published_evidence_id uuid,
  -- Estimated (disruption/forecast) observation.
  estimated_departure timestamptz,
  estimated_arrival timestamptz,
  estimated_observed_at timestamptz,
  estimated_evidence_id uuid,
  -- Actual (post-hoc) observation.
  actual_departure timestamptz,
  actual_arrival timestamptz,
  actual_observed_at timestamptz,
  actual_evidence_id uuid,

  -- Origin ≠ destination: a service occurrence with one endpoint is not
  -- representable, and no CHECK can express "corridor" without a place owner.
  CONSTRAINT transport_services_endpoints_distinct CHECK (origin_place_id <> destination_place_id),
  -- A time field may only exist with its provenance: no value without "when the
  -- supplier said so", and no provenance without a value.
  CONSTRAINT transport_services_departure_group CHECK (
    (published_departure IS NULL) = (published_observed_at IS NULL)
    AND (estimated_departure IS NULL) = (estimated_observed_at IS NULL)
    AND (actual_departure IS NULL) = (actual_observed_at IS NULL)
  ),
  CONSTRAINT transport_services_arrival_group CHECK (
    (published_arrival IS NULL) = (published_observed_at IS NULL)
    AND (estimated_arrival IS NULL) = (estimated_observed_at IS NULL)
    AND (actual_arrival IS NULL) = (actual_observed_at IS NULL)
  ),
  -- A service must be observable: at least the published schedule exists.
  CONSTRAINT transport_services_published_required CHECK (published_departure IS NOT NULL),
  -- Estimated/actual are later observations of the same occurrence; they may
  -- deviate, but never predate the published instant.
  CONSTRAINT transport_services_estimated_after_published CHECK (
    estimated_departure IS NULL OR published_departure IS NULL
    OR estimated_departure >= published_departure - interval '0 seconds'
  ),
  CONSTRAINT transport_services_actual_after_published CHECK (
    actual_departure IS NULL OR published_departure IS NULL
    OR actual_departure >= published_departure - interval '0 seconds'
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX idx_transport_services_window
  ON transport_services (workspace_id, published_departure)
  WHERE published_departure IS NOT NULL;
-- Reverse lookup (§9): "which reservations reference this TransportService" is
-- served by reservation_lines; this index serves "which services operate a
-- route/corridor near a window" for evaluator candidate sets (M6).
CREATE INDEX idx_transport_services_route
  ON transport_services (workspace_id, origin_place_id, destination_place_id, published_departure);

CREATE FUNCTION enforce_subject_subtype_transport_service(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: TRANSPORT_SERVICE subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM transport_services s
     WHERE s.workspace_id = p_workspace_id AND s.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: TRANSPORT_SERVICE subject % has no transport_services row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('TRANSPORT_SERVICE', 'enforce_subject_subtype_transport_service', 'M3');

