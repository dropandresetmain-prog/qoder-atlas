# ACTIVE TASK — PG FIXTURE CLONE FEASIBILITY SPIKE

Live ledger for the bounded PostgreSQL AiT fixture-clone feasibility spike.
Companion to `docs/work/ACTIVE_TASK.md` (R3 ledger left untouched).

## Identity

- Branch: `spike/pg-fixture-clone`
- Base: `feat/r3-local-acceptance` @ `d9bb9a5f03785db60b6657ca7dfe7c182b07dbd3`
  (newer than accepted fast-tier `codex/postgres-fast-tier` @ `d1762f0`, which is
  **not** an ancestor of this line; tiering decision is not reopened)
- Role: PRIMARY PostgreSQL test-fixture performance engineer
- Date: 2026-09-19
- Scope: evidence only; test-only prototype; no product code changes

## Goal

Prove whether canonical AiT baseline can be built once and cheaply cloned into
isolated databases (`CREATE DATABASE … TEMPLATE`) so heavyweight PG tests keep
database-per-test isolation without repeated materialization.

## Chosen mechanism

**Option A — PostgreSQL TEMPLATE cloning** (preferred). Option C dump/restore
not needed. Option B physical snapshots not pursued.

## Checklist

- [x] Phase 1: AiT world-creation map (A/B/C/D classification)
- [x] Checkpoint 1+2: clone primitive + equivalence + isolation proofs
- [ ] Checkpoint 3: F3/F5/F7 A/B pilot timings
- [ ] Phase 6–7: suitability + gate impact estimate
- [ ] Final report + recommendation

## Benchmark results (Checkpoint 1+2)

- Fixture construction (migrate + materialize + baseline 67 journeys): **72.6s**
- Clone trials (n=8): min **761.7ms**, median **817.1ms**, max **907.4ms**
- Fresh↔clone logical fingerprint: **MATCH** (`f6e11807014eba0d…`)
- Isolation (mutate A, B+fixture unchanged; drop A; new clone C matches): **PASS**
- Empty TEMPLATE probe earlier: median ~768ms (toy table)

## Current blocker

None. Proceeding to F3/F5/F7 A/B pilot.

## Next action

Minimal setup seam on F3/F5/F7; measure fresh vs clone.

## Critical safety assumptions

1. Clone accelerates setup only — never bypasses behaviour under test.
2. `productBaselineWorld` / migration / provisioning proofs stay on fresh path.
3. Each heavyweight test receives its own database.
4. Suite-scoped fixture rebuild preferred over cross-session cache.
5. No PG parallelism in this spike (Park for Later).
6. Test role is superuser: REVOKE CONNECT is soft; primary guard is never using
   the fixture DB name as the working pool (asserted in proof test).
