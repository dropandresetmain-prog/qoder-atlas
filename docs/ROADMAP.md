# Northstar roadmap

## Implemented

- Live Dependency Graph persisted in SQLite, with typed relationships, impact
  propagation, recovery overlays and deterministic viability.
- Supplier, traveller and organiser-side change flows through one recovery engine.
- Atlas flight search, verify, fare rules, state observation and sandbox transaction
  seams; sanitized provider recordings for the default demo.
- Nuitée/liteAPI hotel context, search, quote/prebook, book, retrieve and cancellation.
- Dated Frankfurter/ECB FX evidence for deterministic cost and authority comparison.
- Optional Google Routes context with REPLAY/deterministic fallback.
- Model Studio/Qwen schema-bound extraction and planning, plus deterministic fallback.
- Programme intake, shared commitment fan-out, policy/authority gates and observed
  state reconciliation.

## Next

- Deepen airline servicing/exchange, cancellation and observation with provider access
  beyond the Atlas sandbox.
- Harden the hotel path for production supplier lifecycle, changes and reconciliation.
- Define production FX source/freshness/cache policy for financial comparisons.
- Correct and prove live Google Routes usage; add dynamic ground context where it
  changes a recovery verdict.
- Improve supplied email/document ingestion and add narrow, verified connectors.
- Add licensed/official entry data and explicitly scoped legal-review safeguards.
- Add event/calendar, policy, approval and notification integrations for enterprise
  deployments.
- Connect TMC, HR, EA and organiser systems through the existing provider-neutral
  boundary.

## Stretch

- Booking.com or another hotel provider when reliable partner access is available.
- Transactional ground transport with quote, booking, cancellation and observation.
- Broader airline/GDS/TMC adapters.
- Insurance carrier and claims workflows.
- Richer programme/CMS collaboration and supplier event feeds.

## Deferred / not currently required

| Item | Reason | Revisit when |
|---|---|---|
| Consumer super-app | The submission proves the resolution engine, not a consumer marketplace. | A validated direct-traveller distribution need appears. |
| Dedicated graph database | Typed SQLite aggregates meet current graph and consistency needs. | Query scale or multi-writer patterns exceed the repository design. |
| Microservices, Kafka, Kubernetes | They add operations without evidence of a current requirement. | Independent scaling, durable event-streaming or deployment evidence requires them. |
| Fully autonomous refunds/post-ticket servicing | Provider and legal/financial risk remain high. | End-to-end provider capability, authority and observation controls are proven. |
| Legal or immigration advice | The product must not manufacture legal certainty. | Licensed/official sources and appropriate review are integrated. |
