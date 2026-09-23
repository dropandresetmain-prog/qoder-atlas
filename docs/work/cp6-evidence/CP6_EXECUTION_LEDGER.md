# CP6 execution ledger (Jordan)

## Verdict

`CP6_RESOLVED_PASS`

Clone DB kept for UI: `ns_ait_cl_74748a4c1901496f`
Workspace: `aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1`
Case: `193487a7-c3b9-5086-af4d-71a159613454` → `RESOLVED`
Whole-trip viability: `PASS`
Canonical traveller name unchanged: Jordan Hale

## Sandbox alias seam

- Config: `ATLAS_SANDBOX_PASSENGER_ALIAS_GIVEN_NAME` / `ATLAS_SANDBOX_PASSENGER_ALIAS_FAMILY_NAME`
- Gate: verified `sandbox.atriptech.com` + LIVE/RECORD only; fail closed otherwise
- Canonical passenger: Jordan Hale
- Transmitted sandbox alias: `CpSix` / `Aliasbffb` (`SANDBOX_TEST_ALIAS`)
- Provenance on observation: `passengerIdentityProvenance: SANDBOX_TEST_ALIAS`
- Atlas order: `TESTA20260924021509634` (TICKETED, ticket `S32924`, TR875 NRT→SIN)

## Action DAG

1. `external:offer.select` (replacement flight)
2. `external:stay.book` (depends on offer.select) — destination replacement stay
3. `external:stay.cancel` (depends on stay.book) — displaced stay cancellation

## Execution ledger

| Intent | Provider | Operation | Result | Observation | Canonical |
|---|---|---|---|---|---|
| offer.select | Atlas | create/pay/ticket (adopted prior TICKETED order under alias) | OBSERVED_SUCCESS | order TESTA20260924021509634 TICKETED | JOURNEY_ITEM_UPDATED |
| stay.book | Nuitée | bookStay | OBSERVED_SUCCESS | booking pvFqDBknF CONFIRMED | OBSERVED_STAY_ATTACHED (after connection-resolution fix) |
| stay.cancel | Nuitée | cancelStay | OBSERVED_SUCCESS | DpnZRH43H CANCELLED | OBSERVED_STAY_CANCELLED |

## Blockers closed this session

1. Atlas 318 duplicate on Jordan Hale → sandbox passenger alias (CP6-A+)
2. Short ticketing poll → OUTCOME_UNKNOWN → longer poll + recreate/adopt
3. Stay canonical attach `book canonical binding incomplete` because two Nuitee connections left `provider_connection_id` null → org-scoped connection resolution

## Tests

- `npx tsx --test test/a5-atlas-sandbox-passenger-alias.test.ts` → 12/12
- `npx tsx --test test/r4-offer-execution-boundary.test.ts` → adjacent green

## Git

- Start: `35d1538`
- Alias seam: `bffb05f`
- Connection fix + evidence: (this commit)
