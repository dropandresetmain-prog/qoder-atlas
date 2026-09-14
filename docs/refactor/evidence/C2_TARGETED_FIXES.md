# C2 targeted fixes — pointer

Full write-up lives in `docs/refactor/evidence/M6.md` §13.

**State:** C2 PASS / ACCEPTED\
**Accepted SHA:** `82fa96827fc8d517145498a0ee258f5cdf34c30b`\
**Base:** `d2999fb6b2dc1f9ae3db7ffd04ae44987458dc51`  
**Branch:** `fix/c2-m6-invalidation-gaps`  
**Migration:** `0092_resource_budget_ruleset_invalidation.sql`  
**Regression:** `postgres-integration/c2InvalidationGaps.pgtest.ts`

Closed here: AN-1, AN-2, AN-3. C2 acceptance, promotion and pre-M8 conditions are recorded in `docs/refactor/evidence/M6.md` §14.
