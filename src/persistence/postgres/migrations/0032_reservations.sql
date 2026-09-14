-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §4 line "reservations" / closure §4.3: a
-- Reservation is the supplier's canonical booking/order. It is a root subject;
-- a shared booking serves every Traveller/Journey/Trip through its lines and
-- allocations (0033) — it is never copied per traveller (G5).
--
-- responsible_organisation_id / responsible_traveller_id: who the business
-- counterparty is. Organisation is M2-owned; the traveller column is nullable —
-- a corporate booking may name only the organisation, an import may name only
-- the person — and at most one party is required, never both.
--
-- observed status/ledger: the reservation-level lifecycle is *observed*
-- supplier state (HELD/CONFIRMED/...), never written by a requested internal
-- change (F06). line-level differences live per line (0032): a group
-- confirmation can coexist with per-line differences.
--
-- external identity: connection/record live on the external-record family
-- (0040-0042) as verified links; this table keeps no locator column, because
-- "same PNR text" is not identity (F08).

CREATE TABLE reservations (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  reservation_type text NOT NULL CHECK (reservation_type IN ('TRANSPORT', 'STAY', 'RESOURCE_USE', 'MIXED')),
  observed_status text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (observed_status IN ('HELD', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'UNKNOWN')),
  observed_status_at timestamptz,
  responsible_organisation_id uuid,
  responsible_traveller_id uuid,
  -- Bounded observed context (seat/room notes, supplier remarks) that nothing
  -- reverse-looks-up. Any field a reader filters on must become a column.
  observed_context jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT reservations_responsible_organisation_fk
    FOREIGN KEY (workspace_id, responsible_organisation_id)
    REFERENCES organisations (workspace_id, id),
  CONSTRAINT reservations_responsible_traveller_fk
    FOREIGN KEY (workspace_id, responsible_traveller_id)
    REFERENCES travellers (workspace_id, id),
  CONSTRAINT reservations_party_required CHECK (
    responsible_organisation_id IS NOT NULL OR responsible_traveller_id IS NOT NULL
  ),
  CONSTRAINT reservations_status_time_shape CHECK (
    (observed_status = 'UNKNOWN') = (observed_status_at IS NULL)
  ),
  CONSTRAINT reservations_context_shape CHECK (
    observed_context IS NULL OR (jsonb_typeof(observed_context) = 'object'
                                 AND pg_column_size(observed_context) <= 8192)
  )
);

CREATE INDEX idx_reservations_organisation ON reservations (workspace_id, responsible_organisation_id)
  WHERE responsible_organisation_id IS NOT NULL;
CREATE INDEX idx_reservations_traveller ON reservations (workspace_id, responsible_traveller_id)
  WHERE responsible_traveller_id IS NOT NULL;
CREATE INDEX idx_reservations_status ON reservations (workspace_id, observed_status);

CREATE FUNCTION enforce_subject_subtype_reservation(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: RESERVATION subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM reservations r WHERE r.workspace_id = p_workspace_id AND r.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: RESERVATION subject % has no reservations row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('RESERVATION', 'enforce_subject_subtype_reservation', 'M3');

