# NORTHSTAR M3 active task

## Recovery identity

- Repository: `dropandresetmain-prog/qoder-atlas`
- Worktree: `C:\Dev\qoder-atlas\.worktrees\m3-recovered`
- Branch: `milestone-m3-recovered`
- Recovery head: `4b1bd35d432874ab5acf0c96086c0b806fcfc477`
- Accepted common base: `71f638ed30d01e65981bdd9e5e6128ad067fbf1d`

## Objective

Complete M3 services, reservations, entitlements, enterprise arrangements,
external identity/capability observations, offers, and exact commercial data
against the frozen F05/F06/F08/F11/F14/F15/F18 contracts. The current runtime
remains unchanged; this lane owns only migrations 0030–0049 and M3 seams/tests.

## Work checklist

- [x] Create an isolated continuation worktree from the exact recovery SHA.
- [x] Read the approved architecture, schema, plan, contracts, M2 evidence,
      and recovery notes.
- [x] Audit recovered migrations for ordering, FK, provenance, and invariant
      defects.
- [x] Complete typed M3 repository contracts and PostgreSQL repositories.
- [x] Complete read/query seams and typed command handlers with UUID boundary,
      receipt replay, expected revisions, and retry-safe callbacks.
- [x] Recreate M3 seed and focused PostgreSQL tests.
- [x] Close M2 deferred M3-owned foreign keys additively.
- [x] Run focused tests, canonical PostgreSQL tests, typecheck, build, lint,
      and anti-hardcoding gate.
- [x] Write `docs/refactor/evidence/M3.md` with actual results and issue triage.
- [x] Commit and push a clean final branch; do not merge to
      `data-structure-refactor`.

## Frozen decisions carried into implementation

- Supplier service/reservation truth is distinct from Journey intent.
- A shared reservation is stored once; lines and allocations identify every
  Traveller/JourneyItem/Trip consequence. A JourneyItem allocation must belong
  to the same Traveller.
- Reservation confirmation never implies ticket, coupon, or voucher issuance.
- Published, estimated, and actual service times are separate observed fields.
- External identity is evidence-driven. Unknown and ambiguous records remain
  quarantined, and observation, servicing, and authority are separate.
- Offers are immutable, expiring, and eligibility-scoped. Money is exact and
  FX is dated, sourced evidence.
- Retryable unit-of-work callbacks contain no provider/model side effects or
  nondeterministic IDs/timestamps.

## Recovered material and known repairs

Recovered source consisted of migrations 0030–0038 and 0040–0049 only. The
recovered 0046 was malformed and is being repaired from the logical schema.
Migration 0039 was absent and is present only if required to close the
M3-owned offer-to-agreement-scope foreign key; it is not a numbering filler.
Missing M3 implementation files are recreated from current M2 repository,
command, query, and integration-test conventions.

## Explicit exclusions

No M4 programme/geography, M5 knowledge/rules, M6 evaluation implementation,
runtime cutover, provider booking calls, or migration edits outside 0030–0049.

## Verification evidence

Recorded commands and results are in `docs/refactor/evidence/M3.md`. Every
issue is triaged as Act Now, Investigate Now, Park for Later, or Ignore /
Accept Risk. No check is marked passed without a successful run.
