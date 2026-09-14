# C2 targeted fix ledger

Base: `d2999fb6b2dc1f9ae3db7ffd04ae44987458dc51`
Branch: `fix/c2-m6-invalidation-gaps`
Worktree: `C:/Dev/qoder-atlas-c2-fix`

## Status

- [x] AN-1 resource capture completeness + RESOURCE invalidation + PG proofs
- [x] AN-2 budget → ORGANISATION_RULES invalidation + PG proofs
- [x] AN-3 RuleSet-without-edition manifest hook + PG proofs
- [x] Migration 0092
- [x] Evidence + canonical gates + push

## Gate evidence

- c2InvalidationGaps: 5/5
- test:postgres: 368/368
- M6 units: 140/140
- typecheck / build / lint / anti-hardcoding / diff --check: clean

## Do not touch (carry-forward)

Parked C2 items, M7/M8, jurisdiction-at-encounter, entitlement-link invalidation, I-10 FX, etc.
