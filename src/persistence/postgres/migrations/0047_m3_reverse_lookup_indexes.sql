-- and JourneyItem reverse lookup for shared disruption." The tables are M3's,
-- but the operations that decide these access paths belong to M6 (applicability,
-- reassessment, blast radius) and M9 (authority/execution) — same rationale as
-- M2's 0029. Each index names the lookup it exists for; access paths already
-- implied by a PK or created with its table stay there.

-- "Which Journeys/JourneyItems are allocated to this reservation line?" (a
-- line's blast radius starts with its allocations, then the items' Journeys.)
CREATE INDEX idx_reservation_allocations_line_item
  ON reservation_allocations (workspace_id, line_id, journey_item_id);

-- "Which Travellers are affected by this reservation/service?" — through the
-- reservation (any line) rather than a single line.
CREATE INDEX idx_reservation_allocations_reservation_traveller
  ON reservation_allocations (workspace_id, reservation_id, traveller_id);

-- "What changes if this service is delayed/cancelled?" — services to their
-- lines (already indexed in 0033), lines to their allocations (above), and
-- lines to the JourneyItems whose Journeys evaluate the disruption.
-- This index covers allocation lookups by item directly.
CREATE INDEX idx_reservation_allocations_journey_traveller
  ON reservation_allocations (workspace_id, traveller_id, journey_item_id)
  WHERE journey_item_id IS NOT NULL;

-- "Which entitlements cover a Traveller/line?" — person links by traveller and
-- line links by line are the two directions; the traveller-side of line links
-- goes through allocations, so this covers the line side directly.
CREATE INDEX idx_entitlement_line_links_line_traveller_path
  ON entitlement_line_links (workspace_id, line_id);

-- "Which offers are applicable to this party/context?" — offers by account and
-- expiry (0037), plus eligibility by organisation for the agreement-gated path.
CREATE INDEX idx_offer_eligibility_any_party
  ON offer_eligibility (workspace_id, COALESCE(eligible_organisation_id, eligible_traveller_id));

-- "Which external records own/observe this target?" — live links by subject and
-- record type, so an ownership question never scans superseded history.
CREATE INDEX idx_external_record_links_live_subject
  ON external_record_links (workspace_id, canonical_subject_kind, canonical_subject_id)
  WHERE superseded_at IS NULL;

-- "Which subjects share this Resource?" — resource-consuming lines across the
-- stay and resource-use detail tables (each already carries its resource index;
-- this one answers the question across both kinds in one pass via the
-- reservation_lines product-agnostic side).
CREATE INDEX idx_reservation_lines_created_window
  ON reservation_lines (workspace_id, created_at);

-- Budget/hold admission serializes on the budget root (§9 item 10): an
-- admission check must find open holds without scanning settled history.
CREATE INDEX idx_budget_commitments_open
  ON budget_commitments (workspace_id, budget_id)
  WHERE status = 'HELD';

-- Capability checks are read per (connection, record type) before any
-- servicing action; keep the negative facts reachable.
CREATE INDEX idx_provider_capabilities_record_type
  ON provider_capabilities (workspace_id, connection_id, record_type, capability_kind);

-- Quarantined identity is worked down by connection; unknown/ambiguous rows
-- must be enumerable without scanning LINKED history.
CREATE INDEX idx_external_records_quarantined
  ON external_records (workspace_id, connection_id, identity_state)
  WHERE identity_state IN ('QUARANTINED_UNKNOWN', 'QUARANTINED_AMBIGUOUS');

