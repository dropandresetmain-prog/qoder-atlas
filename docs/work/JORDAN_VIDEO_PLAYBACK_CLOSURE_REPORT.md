# Jordan video playback — closure report (worktree `a5-backend-closure`)

Branch: `demo/jordan-video-playback`  
Audience: integrator / main chat handoff after founder recording.

## What was delivered

- **Demo playback** composes REPLAY Atlas + Nuitée execution with `NORTHSTAR_DEMO_PLAYBACK=1`, CP6 staging corpus, and helper scripts (`demo:playback`, `prepare-jordan-d3-recording.mjs`, `jordan-one-shot-e2e.mjs`, corpus augment script).
- **Execution fixes** for founder Approve → Execute → RESOLVED: zero cancel penalty / ceiling, REPLAY dispatch gates, synthetic per-intent stay booking ids for shared replay corpus, idempotent observed-stay attach, cancel intent without positive `cost_amount`.
- **Founder recording** completed on case `2948b19e-8652-51e4-825d-8b0997037d00`; runtime reached **RESOLVED**.

## Checks run (this lane)

| Check | Result |
|--------|--------|
| `node scripts/jordan-one-shot-e2e.mjs` (playback speed 12) | **PASS** → RESOLVED |
| `node scripts/prepare-jordan-d3-recording.mjs` (speed 1) | **PASS** → AWAITING_AUTHORITY |
| Founder manual record Approve → Execute | **Recorded** (user confirmed) |
| Focused unit tests (`demo-playback`, `action-intent-cost-shape`) | Run locally; one pre-existing env-pollution flake when `NORTHSTAR_DEMO_PLAYBACK=1` leaks into “normal REPLAY” assertion |

## Recorded recovery route (product issue)

Full log and analysis:

- [`docs/work/cp6-evidence/JORDAN_VIDEO_PLAYBACK_RECORDED_RECOVERY_ROUTE.md`](./cp6-evidence/JORDAN_VIDEO_PLAYBACK_RECORDED_RECOVERY_ROUTE.md)
- [`docs/work/cp6-evidence/jordan-recorded-recovery-route-log.json`](./cp6-evidence/jordan-recorded-recovery-route-log.json)

**Headline:** Execution is **technically coherent** (flight → Narita stay → Singapore replacement stay → cancel original) but the **recommended strategy’s programme projection** shows **Bootcamp Opening Cocktails as PASS** despite arrival **after** the published deadline — while non-recommended flight variants correctly FAIL `arrives_after_deadline`. Treat as **Act Now** for programme/RC-6 evaluation on stay-replacement bundles.

Secondary: empty `causalPath` on Case JSON vs rich `originalFocusedGraph`; LDG `MUST_HAPPEN_BEFORE` from cancelled stay to replacement stay (presentation).

## Key code touched

- `src/app/target/externalStayExecution.ts` — demo synthetic booking id, cancel ceiling, reconcile
- `src/app/target/externalOfferExecution.ts` — playback dispatch / stable client ref
- `src/persistence/postgres/commands/observedStayCommands.ts` — idempotent attach when link exists
- `src/persistence/postgres/repositories/pgArrangementRepositories.ts` — LINKED preservation on re-observe
- `src/resolution/planning/compiler.ts` — zero cancel penalty (prior commit on branch)
- `scripts/augment-jordan-cp6-atlas-replay-recordings.mjs`, `prepare-jordan-d3-recording.mjs`, `jordan-one-shot-e2e.mjs`
- CP6 staging corpus recordings (Atlas verify/order_create/order_pay, Nuitée book/cancel/retrieve)

## Intentionally not claimed

- LIVE provider calls on founder corridor
- Programme evaluator fix (documented only)
- Full `npm run test:postgres` gate on this push

## Next dependency (main chat)

1. Fix programme participation evaluation for **recommended stay-replacement + TR arrival** candidate (Bootcamp deadline vs 14:35 arrival).
2. Optionally align execution DAG presentation order with operator narrative (cancel displaced stay before or without implying replacement depends on duplicate book ordering).
3. Surface `causalPath` / first breakpoint on Case from `originalFocusedGraph` projection.
