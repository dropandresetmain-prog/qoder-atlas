-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §4 lines "reservation_lines, typed line
-- details": a ReservationLine is one booked product with its own observed
-- status/terms. Group confirmation can coexist with line-level differences, so
-- the line carries its own status and evidence, never inheriting the
-- reservation's.
--
-- The line is a child subject: registered in domain_subjects under its
-- Reservation's aggregate, no head of its own (same policy as JOURNEY_ITEM).
--
-- product-specific truth is typed per line kind (transport reference, stay
-- dates, resource use) — the stay dates/room status live HERE, never in a
-- JourneyItem's intent (F06).
--
-- transport_service_id / resource_id reference M3's own tables (0030/0031).
-- place references stay opaque uuids (M4 deferral).

CREATE TABLE reservation_lines (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  reservation_id uuid NOT NULL,
  product_type text NOT NULL CHECK (product_type IN ('TRANSPORT', 'STAY', 'RESOURCE_USE')),
  observed_status text NOT NULL
    CHECK (observed_status IN ('HELD', 'CONFIRMED', 'CANCELLED', 'FULFILLED', 'UNKNOWN')),
  observed_status_at timestamptz,
  observed_terms jsonb,
  -- Provenance: the observation that established this state (evidence-backed).
  observation_evidence_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT reservation_lines_reservation_fk
    FOREIGN KEY (workspace_id, reservation_id) REFERENCES reservations (workspace_id, id),
  -- A line's status may be UNKNOWN, but "when did we observe it" is still
  -- recorded when it is known; UNKNOWN with a time means "checked, found stateless".
  CONSTRAINT reservation_lines_status_time_shape CHECK (
    (observed_status = 'UNKNOWN' AND observed_status_at IS NULL)
    OR (observed_status <> 'UNKNOWN' AND observed_status_at IS NOT NULL)
  ),
  CONSTRAINT reservation_lines_terms_shape CHECK (
    observed_terms IS NULL OR (jsonb_typeof(observed_terms) = 'object'
                               AND pg_column_size(observed_terms) <= 8192)
  ),
  -- Referable target for the kind-discriminating detail FKs below.
  CONSTRAINT reservation_lines_id_product_uidx UNIQUE (workspace_id, id, product_type)
);

CREATE INDEX idx_reservation_lines_reservation ON reservation_lines (workspace_id, reservation_id);
CREATE INDEX idx_reservation_lines_status ON reservation_lines (workspace_id, observed_status);
-- Supporting unique constraint for 0034's "allocation line must belong to the
-- allocation's reservation" composite FK (workspace_id, line_id, reservation_id).
CREATE UNIQUE INDEX reservation_lines_id_reservation_uidx
  ON reservation_lines (workspace_id, id, reservation_id);

CREATE TABLE transport_line_details (
  workspace_id uuid NOT NULL,
  line_id uuid NOT NULL,
  product_type text NOT NULL CHECK (product_type = 'TRANSPORT'),
  transport_service_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, line_id),
  CONSTRAINT transport_line_details_line_fk
    FOREIGN KEY (workspace_id, line_id, product_type)
    REFERENCES reservation_lines (workspace_id, id, product_type),
  CONSTRAINT transport_line_details_service_fk
    FOREIGN KEY (workspace_id, transport_service_id)
    REFERENCES transport_services (workspace_id, id)
);

-- §9 reverse lookup: "which reservations reference this TransportService" and
-- (with allocations) "what changes if this service is delayed/cancelled".
CREATE INDEX idx_transport_line_details_service
  ON transport_line_details (workspace_id, transport_service_id);

CREATE TABLE stay_line_details (
  workspace_id uuid NOT NULL,
  line_id uuid NOT NULL,
  product_type text NOT NULL CHECK (product_type = 'STAY'),
  -- Booked dates/occupancy are supplier truth here (never copied to intent).
  stay_interval_start timestamptz,
  stay_interval_end timestamptz,
  resource_id uuid,
  place_id uuid,
  occupancy jsonb,
  PRIMARY KEY (workspace_id, line_id),
  CONSTRAINT stay_line_details_line_fk
    FOREIGN KEY (workspace_id, line_id, product_type)
    REFERENCES reservation_lines (workspace_id, id, product_type),
  CONSTRAINT stay_line_details_interval_shape CHECK (
    (stay_interval_start IS NULL AND stay_interval_end IS NULL)
    OR (stay_interval_start IS NOT NULL AND stay_interval_end IS NOT NULL
        AND stay_interval_end > stay_interval_start)
  ),
  CONSTRAINT stay_line_details_occupancy_shape CHECK (
    occupancy IS NULL OR (jsonb_typeof(occupancy) = 'object'
                          AND pg_column_size(occupancy) <= 8192)
  ),
  CONSTRAINT stay_line_details_resource_fk
    FOREIGN KEY (workspace_id, resource_id) REFERENCES resources (workspace_id, id)
);

CREATE INDEX idx_stay_line_details_resource ON stay_line_details (workspace_id, resource_id)
  WHERE resource_id IS NOT NULL;
CREATE INDEX idx_stay_line_details_place ON stay_line_details (workspace_id, place_id)
  WHERE place_id IS NOT NULL;
CREATE INDEX idx_stay_line_details_interval ON stay_line_details (workspace_id, stay_interval_start)
  WHERE stay_interval_start IS NOT NULL;

CREATE TABLE resource_use_line_details (
  workspace_id uuid NOT NULL,
  line_id uuid NOT NULL,
  product_type text NOT NULL CHECK (product_type = 'RESOURCE_USE'),
  resource_id uuid NOT NULL,
  use_interval_start timestamptz,
  use_interval_end timestamptz,
  place_id uuid,
  PRIMARY KEY (workspace_id, line_id),
  CONSTRAINT resource_use_line_details_line_fk
    FOREIGN KEY (workspace_id, line_id, product_type)
    REFERENCES reservation_lines (workspace_id, id, product_type),
  CONSTRAINT resource_use_line_details_resource_fk
    FOREIGN KEY (workspace_id, resource_id) REFERENCES resources (workspace_id, id),
  CONSTRAINT resource_use_line_details_interval_shape CHECK (
    (use_interval_start IS NULL AND use_interval_end IS NULL)
    OR (use_interval_start IS NOT NULL AND use_interval_end IS NOT NULL
        AND use_interval_end > use_interval_start)
  )
);

CREATE INDEX idx_resource_use_line_details_resource
  ON resource_use_line_details (workspace_id, resource_id);

CREATE FUNCTION enforce_subject_subtype_reservation_line(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_reservation_id uuid;
BEGIN
  SELECT l.reservation_id INTO v_reservation_id
    FROM reservation_lines l
   WHERE l.workspace_id = p_workspace_id AND l.id = p_id;
  IF v_reservation_id IS NULL THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: RESERVATION_LINE subject % has no reservation_lines row',
      p_id;
  END IF;
  IF p_aggregate_id <> v_reservation_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: RESERVATION_LINE % must aggregate under its Reservation % (aggregate_id=%)',
      p_id, v_reservation_id, p_aggregate_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('RESERVATION_LINE', 'enforce_subject_subtype_reservation_line', 'M3');

