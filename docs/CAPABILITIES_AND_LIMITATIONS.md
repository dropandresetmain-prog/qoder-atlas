# Capabilities and limitations

This is the technical truth sheet for the **currently implemented NORTHSTAR runtime**.

`IMPLEMENTED` means an executable runtime path exists. It does not imply every provider path is live in every environment, every source has production-grade coverage, or every product surface is polished.

## Current runtime truth

- **PostgreSQL + PostGIS is the sole normal Northstar runtime.**
- SQLite is retired as an application runtime and survives only as explicit offline,
  read-only migration input plus historical test/code evidence.
- The M0-M10 data/state refactor is accepted through C5.
- The post-C5 operational runtime closure is implemented through R0/T3/T4/B1.
- Current implementation candidate:
  `feature/sarah-provider-disruption` @
  `82ae9b80f62a26d8b7e8e6277aa5bf6183ff44f0`.
- The first complete generalized **internal** recovery loop is proven on the real AiT/Sarah
  world through normal application/runtime paths. **The engine is complete; the product
  surface over it is not.**
- **Founder B1 was physically tested on 2026-09-18 and is NOT ACCEPTED.** The engine
  completed the Sarah recovery in the background (Sarah READY, case RESOLVED, Overview back
  to 50 / 2 / 15, Farah + Mei still truthfully disrupted), but the founder could not open,
  read or operate the focused recovery surface. See
  [`work/FOUNDER_B1_PHYSICAL_FINDINGS.md`](work/FOUNDER_B1_PHYSICAL_FINDINGS.md).
- Current milestone: **B1 Product Acceptance Repair**.
  Current blocker: **focused recovery product UI / product navigation**.
- **B2 generalized external recovery / Jordan is BLOCKED** until a Founder B1 physical
  retest passes.

Latest evidence on this code line:

- CURRENT suite: **811/811**, `npm test` ~13.8s as measured by the H1-H4 lane (~15.9s wall
  re-verified on the integration machine, boundary gate included);
- clean `npm run test:postgres`: **522/522** in ~21.4 min — historical **B1 checkpoint**
  evidence; **not** rerun for the H1-H4 lane or the product repair;
- `b1SarahWorldRecovery.pgtest.ts`: PASS, ~117-155s across recorded runs;
- `b1RecoveryLoop.pgtest.ts`: PASS;
- typecheck, build, lint, boundary and anti-hardcoding checks clean at B1 closure;
- historical SQLite runtime tests remain deliberately excluded from acceptance.

## Current runtime capability matrix

| Capability | Current status | Provider / modes | Current limitation / direction |
|---|---|---|---|
| Persistence / state ownership | **IMPLEMENTED.** PostgreSQL + PostGIS with typed ownership, revisions, durable work and migrations. | PostgreSQL target composition. | M11 is operational activation/retirement, not a future database cutover. |
| People / Trip / Journey | **IMPLEMENTED CORE.** Stable Traveller, shared Trip, per-person Journey, support/coordination. | Internal PostgreSQL domain. | No known B1 blocker. |
| Services / reservations / allocations | **IMPLEMENTED CORE.** Independent service/reservation/allocation/entitlement ownership and provider references. | Internal + provider adapters. | Broad provider-reference auto-correlation remains deferred. |
| Programme / participation | **IMPLEMENTED CORE.** Mutable Event -> Programme -> ProgrammeItem + Participation independent of travel. | Internal programme state. | B1 uses generalized programme recovery; broader no-Journey cases remain covered by domain tests and should stay regression-protected. |
| Change signals / canonical mutation | **IMPLEMENTED.** Provider-shaped changes create durable ChangeSignals linked to canonical commands, invalidated subjects and cases. | Internal inputs + provider normalization. | External inbox orchestration remains deferred (RC-10). |
| Impact / reassessment | **IMPLEMENTED.** Subject-bound manifests, targeted invalidation, deterministic PASS/FAIL/UNKNOWN and clock expiry. | Internal evaluator registry. | R0 reduced Sarah incident fan-out 67 -> 5; do not broaden manifests for batching convenience. |
| Escalation / case lifecycle | **IMPLEMENTED.** Deterministic idempotent OPEN/ATTACH/NONE with authoritative cause/causalPath. | Internal application/domain. | Backend correct; Founder B1 failed on the product surface over it. |
| Recovery planning | **IMPLEMENTED FOR INTERNAL LOOP.** Generic StrategyProposer port + deterministic programme recovery proposer; validated ScenarioChange candidates persist only after deterministic viability. | Internal deterministic proposer. | Optional Qwen/LLM proposer remains future; B2 needs a flight-recovery proposer on the same port. |
| Counterfactual viability | **IMPLEMENTED / RC-6 CLOSED.** Overlay compares against current world: blocking subjects must heal; no regression/new critical UNKNOWN; unchanged unrelated FAIL/UNKNOWN does not veto. | Internal deterministic evaluator. | Older preview rollup still needs reconciliation if it can present stricter truth than planning. |
| Authority / approvals | **IMPLEMENTED FOR B1.** Request-scoped principal, reviewed basis, authority decision and approval gate on normal HTTP path. | Internal authority engine. | RC-7 coverage snapshot and RC-8 budget holds remain parked/revisit for B2 money actions. |
| Internal execution | **IMPLEMENTED.** Durable internal programme action execution through runtime services, observations, canonical updates and reassessment. | Internal programme executor. | B1 has no external provider side effect. |
| External execution / reconciliation | **FOUNDATION EXISTS; NORMAL B2 LOOP NOT YET COMPOSED.** | Atlas/provider adapters + execution contracts. | B2 must add provider-neutral dispatcher, partial/unknown outcome reconciliation and same-engine recovery. |
| Resolution | **IMPLEMENTED.** Case resolves only after completed/reconciled execution and fresh PASS for required case subjects. | Internal resolution gate. | Provider/API success alone never resolves. |
| Live read models | **IMPLEMENTED / ACCEPTED FOUNDATION.** Stable identity/authority, change cursor, evaluation lifecycle, cause/causalPath. | PostgreSQL projections. | Event Overview final design remains unresolved. |
| Flight context | **IMPLEMENTED.** Search, verify, fare rules and provider-state observation. | Atlas LIVE/RECORD/REPLAY. | B2 must compose the relevant read capabilities into the normal recovery loop. |
| Flight transactions | **IMPLEMENTED ADAPTER/SANDBOX SEAMS; NOT YET B2-COMPOSED.** | Atlas sandbox LIVE/REPLAY where supported. | Production servicing breadth remains provider-limited; consequential calls remain authority-gated. |
| Hotel lifecycle | **IMPLEMENTED PROVIDER SEAMS.** Search, quote/prebook, book, retrieve and cancel. | Nuitée/liteAPI LIVE/RECORD/REPLAY. | Not required for B1; only pull into B2 if the generalized recovery actually needs it. |
| Ground routing | **PARTIAL / NON-BLOCKING.** | Google Routes LIVE-capable / replay. | Context only; no transactional ground provider. |
| FX / cost evidence | **IMPLEMENTED FOUNDATION.** | Frankfurter + internal evidence. | Not a payment FX service. |
| Entry/advisory/conditions | **IMPLEMENTED ARCHITECTURE + PARTIAL SOURCE COVERAGE.** | Internal/supplied sources. | Missing/stale coverage remains UNKNOWN; no legal-grade universal claim. |
| Frontend semantic layer | **FOUNDATION IMPLEMENTED; FOCUSED RECOVERY SURFACE NOT FOUNDER-ACCEPTED.** | Internal UI adapter/grammar. | Founder B1 stopped here on 2026-09-18: Overview rows were not navigation, the focused case rendered outside the product shell, and options were unreadable. Current milestone repairs exactly this boundary. Final Event Overview still pending design acceptance. |
| Focused Sarah graph | **DESIGN REFERENCE ACCEPTED + BACKEND CAUSAL INPUTS IMPLEMENTED.** | UI/design + authoritative read model. | V5.6 mock facts are not runtime truth. |
| Event Overview | **DESIGN UNRESOLVED.** | Future post-E2E product work. | Do not shape backend semantics around rejected concepts. |

## Provider evidence matrix## Provider evidence matrix

| Provider / service | Purpose | Implemented | LIVE proven | RECORD proven | REPLAY | Important limitation |
|---|---|:---:|:---:|:---:|:---:|---|
| Atlas | Flight search/verify/rules/state + sandbox transaction seams | Yes | Yes, sandbox | Yes | Yes | Not production airline/GDS servicing; sandbox/refund limits. |
| Alibaba Cloud Model Studio / Qwen | Extraction/programme mapping/strategy proposals | Yes | Yes when configured | N/A | Deterministic/fixture fallback | Model output remains schema-validated proposal data and cannot bypass deterministic gates. |
| Nuitée / liteAPI | Hotel lifecycle | Yes | Yes, sandbox | Yes | Yes | Provider constraints; cancel/rebook may be required for changes. |
| Google Routes | Ground-context estimation | Yes | Bounded/optional | Yes | Yes | No booking action. |
| Frankfurter | Dated ECB-reference FX | Yes | Yes | Yes | Yes | Comparison evidence, not payment FX. |
| Railway | Hosted runtime | Operational evidence | Deployment-dependent | N/A | N/A | Hosting, not a domain capability. |

## Runtime/read-model contract that frontend must respect

Frontend/business logic must not independently calculate:

- viability;
- blast radius;
- causal failure;
- readiness/buffer pass/fail;
- policy;
- authority;
- recovery correctness.

Frontend applies complete authoritative snapshots. `changedVisibleRefs` / changed-edge metadata may drive emphasis/animation but must not be treated as the sole state payload.

Proposed state must remain visually and semantically distinct from current authoritative state.

## Current delivery gaps

### Current — B1 Product Acceptance Repair (Founder B1 NOT ACCEPTED)

Implementation evidence is green; **founder acceptance was withheld on 2026-09-18**. The
gap is the product boundary, not the engine:

| Finding | Gap |
|---|---|
| FB1-2 | Overview affected rows were not usable navigation into the case, although the v2 Overview read model already carries an authoritative `caseRef`. |
| FB1-3 | The focused case rendered as bare HTML because the API HTML branch skipped `renderInShell(...)`. |
| FB1-4 | The normal PostgreSQL runtime exposed no `/operator` product alias and no clean focused-case route. |
| FB1-5 | Candidate summaries persist `subjectRef` / `assessmentId` / `overallVerdict`, but the focused fact assembler read `personLabel` / `verdict` and fell back to `Traveller UNKNOWN`. |
| FB1-6 | Multiple VIABLE strategies were opaque v1/v2 entries with no explanation of how they differ. |

Once repaired, verify the normal product path:

1. baseline 50 PASS / 2 FAIL / 15 UNKNOWN;
2. disclosed provider-shaped disruption -> 49 / 3 / 15;
3. incident-linked case with authoritative cause/causalPath;
4. generic programme recovery proposal with at least one VIABLE candidate;
5. workspace-operator approval;
6. internal programme execution + observation;
7. reassessment makes the blocking subject PASS;
8. incident case becomes RESOLVED;
9. unrelated baseline FAIL/UNKNOWN remains truthful;
10. the whole path is reachable and readable in the product shell — click Sarah from
    Overview, read the cause, understand each option in plain language, approve.

### Blocked — B2 external recovery / Jordan

**Do not start B2 until a Founder B1 physical retest is accepted.** B2 must use the same
lifecycle. Missing composition is primarily:

- flight-recovery StrategyProposer implementation;
- Atlas Search/Verify or REPLAY evidence where materially useful;
- external ActionIntent -> provider-neutral dispatcher;
- external observation/reconciliation, including OUTCOME_UNKNOWN/partial-failure truth;
- same reassessment and resolution gates.

No Jordan-specific domain/application logic.

### Investigate Now

- preview `previewAccepted` still uses the older all-PASS participant rollup and may look
  stricter than the B1 planning contract;
- final demo date/config versus scheduled assessment expiry;
- whether the two VIABLE strategies the founder saw are legitimate alternative programme
  swaps, repeated proposal versions or exact semantic duplicates (FB1-6);
- duplicate heavy AiT setup I1-I4 as a parallel engineering lane (H1-H4 are **DONE** and
  reconciled onto the active branch);
- bounded external legacy-source inventory before M11 activation.

### Park for Later

- RC-7 authority coverage refresh semantics;
- RC-8 budget holds until a money-moving B2 path needs them;
- RC-9 normal-runtime outbox publication;
- RC-10 inbox-based provider ingress;
- progressive per-person evaluation telemetry;
- rich rejected-option history / semantic activity until after B2;
- whole-event graph, semantic zoom, SSE/WebSockets;
- physical deletion of historical SQLite code/files until after M11/submission;
- in-product reset UX (FB1-1) — dev ergonomics, handled for now by the sticky `.env.local`
  workspace workflow plus a fresh workspace UUID for a clean physical test.

## M11 readiness## M11 readiness

Repository evidence classifies M11 readiness as **A — no meaningful legacy state identified**.

That means Slice A/B development proceeds on PostgreSQL immediately. Before final M11 activation, perform one bounded external read-only inventory for any ignored/deployed `data/app.sqlite` / `SQLITE_PATH` source. If none contains unique state, record "no migration source" and close the data-migration question. If a meaningful source is found, freeze/copy/hash it and use the retained read-only exporter -> PostgreSQL importer -> reconciliation path.

M11 must never reactivate SQLite as rollback.

## Truthfulness rule

Provider success is not recovered-trip proof. A recovery claim requires the relevant internally committed or externally observed state, reconciliation, and a current deterministic assessment of mandatory requirements.

Unsupported, stale, missing or incomplete information remains `UNKNOWN`/unresolved rather than being promoted into a confident PASS or product claim.
