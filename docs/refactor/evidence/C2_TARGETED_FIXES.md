# C2 targeted fixes — pointer

Full write-up lives in `docs/refactor/evidence/M6.md` §13.

**State:** C2 TARGETED FIX CANDIDATE — READY FOR REVIEWER CONFIRMATION  
**Base:** `d2999fb6b2dc1f9ae3db7ffd04ae44987458dc51`  
**Branch:** `fix/c2-m6-invalidation-gaps`  
**Migration:** `0092_resource_budget_ruleset_invalidation.sql`  
**Regression:** `postgres-integration/c2InvalidationGaps.pgtest.ts`

Closed here: AN-1, AN-2, AN-3 only. Do not treat this document as C2 PASS.
