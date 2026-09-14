# ACTIVE TASK — M3 Services, reservations and enterprise context

## Goal

Materialize the M3 target domain (TransportService, Resource, Reservation/
ReservationLine/ReservationAllocation, ServiceEntitlement + components/links,
immutable Offers, CommercialAgreement editions, external connections/records/
identity links/ownership bindings, provider capability descriptors, accounting
dimensions/assignments, cost allocations, budgets/commitments/entries, FX
observations) on top of the accepted M2 base. Isolated: no production runtime
wiring, no M4 programme/geography semantics, no M5 knowledge semantics, no M8
authority dispatch, no M6 consequence propagation.

## Base

- Branch `milestone-m3`, worktree `/data/workspace/qoder-atlas-m3`.
- Exact base SHA `71f638ed30d01e65981bdd9e5e6128ad067fbf1d`
  (== `origin/data-structure-refactor` at dispatch, verified via
  `git ls-remote` + explicit fetch; clean tree).
- Migration range: **`0030`–`0049` only**. M2 owns `0010`–`0029`; M4 `0050`–`0069`;
  M5 `0070`–`0089`. Do not edit any of those files.

## Locked design decisions

1. **UUID persistence-boundary rule (M2 integration decisions, G12).** Every M3
   command payload validates target domain IDs with a shared `UuidSchema`
   before `uow.execute`. The frozen `SubjectIdSchema` regex is NOT narrowed
   globally; legacy/source/provider ids remain external identifiers.
2. **SubjectKinds activated by M3** (fail-closed checkers per 0010 contract):
   `TRANSPORT_SERVICE`, `RESOURCE`, `RESERVATION`, `RESERVATION_LINE` (child of
   Reservation), `SERVICE_ENTITLEMENT`, `OFFER`, `COMMERCIAL_AGREEMENT`,
   `EXTERNAL_CONNECTION`, `EXTERNAL_RECORD` (child of ExternalConnection),
   `OWNERSHIP_BINDING` (child of the bound subject's root aggregate).
   Kinds allocated to M4/M5/M6/M7/M8 stay unregistered.
3. **Aggregate policy.** TRANSPORT_SERVICE, RESOURCE, RESERVATION,
   SERVICE_ENTITLEMENT, OFFER, COMMERCIAL_AGREEMENT, EXTERNAL_CONNECTION are
   roots (own head). RESERVATION_LINE is a Reservation child (Reservation head
   is the only counter). OWNERSHIP_BINDING is a child registered under the
   owning subject's aggregate (bindings mutate under the owner).
4. **Supplier truth vs journey intent.** `transport_services` carries
   published/estimated/actual instants as separate column groups, each with its
   own `observed_at` + provenance. Journey intent stays in M2's
   `journey_items` + detail tables; M3 links fulfilment via
   `transport_item_details.selected_service_id` and
   `resource_use_item_details.resource_id` (the two M2 deferred FKs M3 closes).
5. **Shared canonical bookings.** One reservation row + N lines + N allocations.
   Allocation validation ( Traveller exists; JourneyItem belongs to that
   Traveller; unique equivalent tuple) is enforced by DB assertions +
   command pre-checks. G5 resolves here: no per-Traveller booking copies.
6. **Confirmation ≠ issuance.** `service_entitlements.observed_status` carries
   issuer truth with explicit UNKNOWN; nothing derives ticketed state from a
   reservation line's CONFIRMED status.
7. **External identity.** `external_records` unique on
   `(connection, record_type, external_id)`; merging requires a verified
   `external_record_links` row (evidence-backed). Unknown identity → structured
   quarantine rows on the same tables with `identity_state IN
   ('UNVERIFIED','QUARANTINED_UNKNOWN','QUARANTINED_AMBIGUOUS')` + reason; no
   auto-merge. Locator equality alone is never a merge rule.
8. **Capability ≠ authority ≠ observation.** `provider_capabilities` rows are
   explicit per (connection, capability kind, record type); `supported=false`
   is stored truth, not absence. Unsupported split/cancel/service returns typed
   `CAPABILITY_UNSUPPORTED`. M8 owns authority; M3 stores capability facts only.
9. **Money.** Exact decimal strings; sums compared via `compareExactMoney` on
   integer minor units. FX observations are immutable dated evidence rows; no
   mutable global rate table. Budget holds use exact amounts; unknown outcome
   cannot release a hold (status machine).
10. **Offers immutable.** INSERT-only with `forbid_mutation` trigger; expiry is
    derived by query, never mutated. Eligibility requires an explicit
    agreement/eligibility row, never bare Trip membership.
11. **Retry safety.** All ids/timestamps minted before `uow.execute`; handler
    callbacks contain no provider/network/irreversible work.
12. **M2 deferred FKs closed (additively, in `0049`):**
    `transport_item_details.selected_service_id → transport_services`,
    `resource_use_item_details.resource_id → resources`.

## Issue triage ledger (update as found)

| ID | Finding | Triage |
|---|---|---|
| M3-1 | Local sandbox has no Docker; PG16+PostGIS installed locally (port 55432) and Node 20 cannot run the canonical `node --test` type-stripping script, so `npm run test:postgres` is executed via `npx tsx --test --test-concurrency=1` (same suites, same order). | Ignore / Accept Risk (environment, not repo) |

## Checklist

- [ ] Read-first docs (done at start)
- [ ] Migrations 0030–0049
- [ ] Domain command layer (`src/persistence/postgres/commands/arrangementsCommands.ts`)
- [ ] Repository port (`src/contracts/v2/repository/arrangements.ts`) + queries port
- [ ] Pg repositories + read queries
- [ ] Unit tests (`test/northstar-v2-m3-invariants.test.ts`)
- [ ] PostgreSQL suites (`postgres-integration/m3Arrangements.pgtest.ts`, `m3IdentityMoney.pgtest.ts`)
- [ ] M2 deferred FK closures + tests
- [ ] Evidence `docs/refactor/evidence/M3.md`
- [ ] typecheck / build / lint / anti-hardcoding / postgres gate
- [ ] Commit + push `milestone-m3`

