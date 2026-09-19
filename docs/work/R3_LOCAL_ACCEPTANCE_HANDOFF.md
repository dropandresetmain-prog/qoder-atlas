# R3 Local Acceptance Handoff — Full Rebased B1

Status: **R3 CLOUD IMPLEMENTATION COMPLETE — REQUIRES LOCAL B1 ACCEPTANCE** (see ACTIVE_TASK
R3 ledger for checkpoint SHAs). This file lists the exact local commands and required
evidence. Local acceptance must prove the **normal product runtime** (composeTargetBoot),
not test-only injection.

Environment: PostgreSQL 16 + PostGIS on localhost (migrations apply through **0127**),
Node >= 24 for `--test` type-stripping, a Chromium browser for the Case workspace.

```bash
npm ci
npm run db:postgres:up            # or your disposable PGTEST_* container per the R1 notes
npm run typecheck && npm run lint
npm run gate:test-boundary && npm run gate:anti-hardcoding
npm test                          # CURRENT_TARGET (pure)
```

## Required local proofs

Boot NORTHSTAR normally against PostgreSQL (ADAPTER_MODE default REPLAY; boot log must show
`[atlas] transport research composed (mode=REPLAY, read-only)`):

1. PostgreSQL boot of `composeTargetBoot` (no test harness).
2. Provider disruption/reprotection ingress through the normal intake.
3. M6 reassessment runs; whole trip becomes FAIL.
4. RecoveryCase opens/attaches.
5. Immutable Original graph captured (`recovery_case_graph_snapshots`, migration 0127).
6. C4 progression invokes the runtime coordinator.
7. Transport REPLAY research runs **from the normal boot composition** — no injected
   coordinator. Boot log line above + flight.search evidence with provenance REPLAY on the
   Case page.
8. Programme proposer participated in the SAME planning attempt.
9. At least one material travel alternative is rejected/inferior for a deterministic reason
   and remains inspectable in decision evidence.
10. Recommendation is viable-only.
11. Case page shows planning evidence (domains, tools+provenance, candidates, three separate
    impact concepts, recommendation).
12. Operator approval through the product endpoint/UI — `POST /api/v2/cases/:id/strategies`
    must now return `{ ok, result }` from the shared coordinator (never the legacy
    `{ ok, report }` shape).
13. Internal execution runs (existing execution pass).
14. Canonical programme update observed.
15. Reassessment after execution.
16. C4 resolution; case RESOLVED via the deterministic gate.
17. Current graph becomes healthy only after reassessment.
18. Immutable Original remains byte-identical through approve/execute/resolve/refresh.

Focused PostgreSQL tests (run individually, `--test-concurrency=1` when sharing one DB):

```bash
node --test postgres-integration/r3ComposedB1Full.pgtest.ts
node --test postgres-integration/b1ProductPlanningCoordinator.pgtest.ts
node --test postgres-integration/b1RecoveryLoop.pgtest.ts
node --test postgres-integration/b1SarahWorldRecovery.pgtest.ts
node --test postgres-integration/r1ComposedB1.pgtest.ts
node --test postgres-integration/r1ConnectionRecovery.pgtest.ts   # second generality, same composition shape
```

19. Second non-programme case (connection world) through the same runtime coordinator —
    `r1ConnectionRecovery.pgtest.ts` proves the coordinator path; also drive one through the
    normal boot to prove the composed research seam is domain-agnostic.
20. Browser causal-spine presentation (physical, see below).

## Static guarantee to re-verify locally

`POST /cases/:id/strategies` uses the accepted coordinator and cannot reach the legacy
proposer seam — guarded by `node --test test/r3-import-guard.test.ts` (pure, runs anywhere).

## Physical browser acceptance

DISRUPTED: green/recovered booking may coexist with the failed trip; causal chain readable
in seconds; Original preserved; Current shows the failure.

PLANNING: graph remains current-world truth; NORTHSTAR-working state appears around the
graph; researched alternatives visible in the decision section; rejection reasons and the
recommendation understandable.

APPROVAL: the exact proposed programme change is visible; affected people clear; approving
invokes the current persisted strategy (not the stale planner).

EXECUTION: action progress truthful; no fake success before observation.

RECOVERY: Current graph healthy only after reassessment; case resolves only through the
deterministic gate; Original still shows the original failing graph. Causal spine reads
predominantly left-to-right with context hanging off the spine.

## Cloud limits (what was NOT proven here)

No PostgreSQL (PG tests authored + typechecked only), no Docker, no physical browser, no
LIVE provider credentials. REPLAY composition was probed end-to-end in Cloud; LIVE/RECORD
provenance is proven by code identity, not execution. Full PostgreSQL suite must run ONCE
locally at milestone acceptance.
