-- A5/CP4 (0138): additive nullable column so the focused Case graph preview can
-- rebind a proposed SELECT_OFFER's SERVICE_BOOKING card to the exact service the
-- recommendation proposes, before any execution has run.
--
-- WHY: `offer_execution_bindings` (0128) already carries the itinerary summary
-- needed to render the proposed booking, but not the deterministic prospective
-- transport-service id the planning proposer minted for that offer
-- (`prospectiveTransportServiceId` — a `svc:<hash>` SubjectId, never a `transport_services`
-- uuid row; no row exists for it until/unless execution actually materialises one).
-- Storing it here lets the read model key a synthetic preview node without
-- guessing or fuzzy-matching a `transport_services` row.
--
-- Nullable: existing bindings, and any effect whose resolved offer/service could
-- not be correlated at persist time, simply carry no preview (never fabricated).

ALTER TABLE offer_execution_bindings
  ADD COLUMN proposed_transport_service_id text;
