# Capabilities and limitations

**Post-R4 status (2026-09-20):** R4 is accepted at
`2baf1f6df484319e131590d37a0b026222324d03`. It proves physical Sarah programme
recovery on normal PostgreSQL boot with LIVE Atlas research/Qwen and separate
protected Atlas sandbox flight execution. It does not yet prove physical Jordan,
complete V5.6/V7.2 fidelity or every historical provider capability.
Older R3-era status below is superseded only where final R4 proves more.
Current triage/scope: [A0](work/ASTRA_A0_CONVERGENCE.md), [roadmap](ROADMAP.md).

This is the technical truth sheet for the **currently implemented NORTHSTAR runtime** after
the 2026-09-18 product-parity truth rebase.

`IMPLEMENTED` means an executable runtime path exists. It does not mean the full generalized
product loop is already integrated.

## Current runtime truth

- PostgreSQL + PostGIS is the sole normal runtime.
- SQLite is offline/read-only migration input plus historical evidence only.
- M0-M10/C5 architecture remains accepted.
- **R1, R2 and R3 are accepted.** R3 was locally proven on real PostgreSQL, normal
  `main.ts` boot and Chromium at `d9bb9a5f03785db60b6657ca7dfe7c182b07dbd3`.
- Normal boot has one RecoveryPlanningCoordinator shared by C4 progression and the product planning endpoint.
- Normal boot proves provider-neutral read-only Atlas `flight.search` in REPLAY.
- The founder Sarah dataset lacks a matching checked-in Atlas recording, so its search honestly returns `recording_not_found`.
- Consequential external execution and full historical-provider runtime parity are not yet restored/accepted.

## Current capability matrix

| Capability | Current truth | Forward boundary |
|---|---|---|
| Persistence / canonical ownership | **IMPLEMENTED / ACCEPTED.** | Preserve. |
| ChangeSignal / mutation / invalidation | **IMPLEMENTED / ACCEPTED.** | Preserve. |
| M6 whole-trip assessment / RC-6 | **IMPLEMENTED / ACCEPTED.** | Preserve. |
| RecoveryCase lifecycle / progression | **IMPLEMENTED / ACCEPTED.** | Preserve one C4 owner. |
| Recovery-domain planning | **IMPLEMENTED / ACCEPTED.** Generalized coordinator + domains + proposers. | Extend by adapters/proposers, not scenario branches. |
| Read-only planning research | **IMPLEMENTED / ACCEPTED FOR ATLAS FLIGHT SEARCH.** | Restore other provider operations/families deliberately. |
| Transport candidate generation | **IMPLEMENTED / ACCEPTED.** Second non-programme case proven. | Preserve. |
| Material considered/rejected evidence | **IMPLEMENTED / ACCEPTED.** Durable PlanningAttempt evidence. | Preserve. |
| Strategy comparison/recommendation | **IMPLEMENTED / ACCEPTED.** VIABLE-only. | Preserve deterministic veto. |
| Three impact semantics | **IMPLEMENTED / ACCEPTED.** | Preserve separation. |
| Authority / approvals | **IMPLEMENTED / ACCEPTED FOR CURRENT INTERNAL PATH.** | Close operation-specific gaps before B2. |
| Internal programme execution | **IMPLEMENTED / ACCEPTED.** | Preserve. |
| Continued/sequential recovery | **IMPLEMENTED / ACCEPTED.** | Preserve. |
| Case resolution | **IMPLEMENTED / ACCEPTED.** | Preserve. |
| Focused Case decision workspace | **IMPLEMENTED / ACCEPTED CORE.** | Remaining UUID/copy debt is non-core. |
| Operator Overview population + queue | **IMPLEMENTED DIRECTION IS CORRECT.** | V7.2 is separate accepted design input. |
| Traveller surface | **PARTIAL.** | Revisit after provider restoration/B2 as needed. |
| External provider execution | **FOUNDATION EXISTS; NOT YET ACCEPTED IN NORMAL CONSEQUENTIAL LOOP.** | B2 after provider restoration. |
| Semantic operational history | **NOT YET PRODUCT-COMPOSED.** | Post-E2E. |

## Provider evidence matrix

| Provider / operation | Current normal-target status | Evidence / limitation |
|---|---|---|
| Atlas `flight.search` | **COMPOSED / R3 ACCEPTED (read-only)** | Normal `main.ts` boot; REPLAY provenance proven. Founder corridor recording coverage missing. |
| Atlas verify / rules / provider-state reads | **ADAPTER CAPABILITY EXISTS; NORMAL-TARGET PARITY NOT YET RE-PROVEN** | Restore/reachability-test in all-Atlas milestone. |
| Atlas event normalization / state reader | **HISTORICAL IMPLEMENTATION EXISTS; CURRENT REACHABILITY UNDER PARITY AUDIT** | File existence is not runtime parity. |
| Atlas transactions | **FOUNDATION EXISTS; NOT NORMAL B2 COMPOSITION** | Consequential use remains authority/execution gated. |
| Model Studio / Qwen | **CLIENT EXISTS; TARGET-RUNTIME COMPOSITION NOT YET RESTORED** | AI never owns hard viability/authority/execution. |
| Nuitée / liteAPI | **ADAPTER EXISTS; TARGET NORMAL-BOOT COMPOSITION NOT YET RESTORED** | Audit operations separately. |
| Google Routes | **ADAPTER EXISTS; TARGET NORMAL-BOOT COMPOSITION NOT YET RESTORED** | Optional read context. |
| Frankfurter | **ADAPTER EXISTS; TARGET NORMAL-BOOT COMPOSITION NOT YET RESTORED** | Reference FX evidence only. |
| OpenRouter | **OPTIONAL HISTORICAL ROUTE; TARGET COMPOSITION NOT RESTORED** | Alibaba/Qwen remains hackathon priority. |

## Current delivery gaps

### Act Now

- finish the exhaustive pre-refactor -> current runtime parity audit;
- restore/reachability-test **all Atlas capability operations** from accepted R3;
- add matching REPLAY evidence or LIVE coverage for founder-demo flight corridors;
- then restore every remaining historical adapter the parity audit classifies as required.

### Investigate Now

- backend causal path is thinner than the desired full graph story;
- replacement service currently renders `Unknown / unconfirmed`;
- any additional zombie capabilities surfaced by the parity audit.

### Park for Later

- B2 consequential provider dispatch until provider restoration is ready;
- raw UUIDs / repeated low-value lines in older Case blocks;
- stale `m10RuntimePurgeBoot` expectation that still assumes `/operator` is 404;
- semantic Activity/operational-history implementation;
- Event Overview implementation (V7.2 design accepted separately);
- SSE/WebSockets, semantic zoom and broad presenter polish;
- physical deletion of historical SQLite code.

### Ignore / Accept Risk

- rewriting the PostgreSQL ontology;
- resurrecting SQLite;
- replacing RC-6;
- creating a second recovery engine;
- treating REPLAY as LIVE.

## B1 / B2 capability boundary

**B1/R3 is accepted.** It proves generalized planning, read-only Atlas evidence where
recordings exist, deterministic material rejection, programme recovery where relevant,
three impact semantics, viable-only recommendation, operator approval, internal execution,
observation, reassessment, resolution and a second non-programme proof.

**B2 is not yet accepted.** It reuses the same R3 contracts and adds externally owned
consequential dispatch, durable attempt-before-network, uncertain/partial outcomes,
reconciliation-before-retry, provider observation, reassessment and continued recovery.

## M11 readiness

M11 remains operational activation/retirement, not a database migration back to/from an
active SQLite runtime. Any bounded external legacy-source inventory remains a final
activation concern.

## Truthfulness rule

Provider success is not recovered-trip proof. A recovery claim requires internally
committed or externally observed canonical state, reconciliation, and current deterministic
assessment. Unsupported/stale/incomplete evidence remains UNKNOWN.
