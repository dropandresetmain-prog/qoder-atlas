# PG Fixture Clone Spike — Evidence (2026-09-19)

Branch: `spike/pg-fixture-clone`
Base: `feat/r3-local-acceptance` @ `d9bb9a5`
Checkpoint 1+2: `c5d4100`
Mechanism: **Option A — `CREATE DATABASE … TEMPLATE`**

## Proof suite (`aitFixtureClone.pgtest.ts`)

| Metric | Value |
|---|---|
| Fixture build (migrate + AiT materialize + baseline 67) | **72.6s** (later rebuild 84.1s) |
| Clone n=8 min / median / max | **761.7 / 817.1 / 907.4 ms** |
| Fresh↔clone logical fingerprint | **MATCH** |
| Clone A mutate / B+fixture unchanged / drop A / new C | **PASS** |

## F3 / F5 / F7 A/B

| File | Fresh setup | Fresh total | Clone setup | Clone total | Setup Δ | Total Δ |
|---|---:|---:|---:|---:|---:|---:|
| F3 | 66.6s | 70.6s | 1.14s | 4.70s | −65.4s (−98%) | −65.9s (−93%) |
| F5 | 64.9s | 69.2s | 0.99s | 4.01s | −63.9s (−98%) | −65.2s (−94%) |
| F7 | 66.4s | 69.1s | 0.91s | 1.90s | −65.5s (−99%) | −67.2s (−97%) |

All assertions PASS on both paths. Each clone run used a **separate database**.

Default remains `NORTHSTAR_PG_AIT_WORLD=fresh` (unchanged CI behaviour).
Clone path requires `NORTHSTAR_PG_AIT_WORLD=clone` + `NORTHSTAR_AIT_FIXTURE_DB`.

## Suitability (static)

| Candidate | Class |
|---|---|
| F3 / F5 / F7 | SAFE NEXT CANDIDATE (piloted) |
| F1 | SAFE NEXT CANDIDATE — one clean clone per crash world; never reuse mutated crash DB |
| N1 | SAFE NEXT CANDIDATE — clone covers provision+baseline only |
| B1 Sarah | NEEDS ADDITIONAL PROOF — clone can skip provision+baseline; authority/compose/recovery remain |
| T2 provider reprotection | NEEDS ADDITIONAL PROOF — step 1 proves baseline construction; do not wholesale switch |
| productBaselineWorld | NOT SUITABLE — asserts materialization/idempotency/replay |
| migrate.pgtest | NOT SUITABLE — must migrate empty DBs |

## Gate impact (relative to ~1,433s canonical)

One suite-scoped fixture (~75s) amortized across adopters.

| Estimate | Runtime | Basis |
|---|---:|---|
| Conservative | ~1,240s | Only F3/F5/F7 (−~190s setup) +75s fixture ≈ −115s net |
| Likely | ~900–950s | + F1 (3 clones) + N1 (2) + B1 setup (−~350–400s more) |
| Optimistic | ~800–850s | + T2 after step-1 split + other post-baseline AiT consumers |

Irreducible: materialization/migration proofs, non-AiT foundation PG, assertion/recovery wall time, per-file harness tax.

## Parallelism

Database-per-test isolation is a prerequisite for bounded 2–3 worker PG parallelism later.
**Park for Later** — not enabled in this spike.

## Recommendation

**IMPLEMENT WITH CONDITIONS** — suite-scoped fixture rebuild (no cross-session cache);
keep fresh default; adopt clone only for post-baseline consumers; never switch
`productBaselineWorld` / migration / provisioning proofs.
