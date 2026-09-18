# R1 / C10 — B1 & B2 Acceptance ↔ Test Coverage Map

Owner: PRIMARY (cross-lane reconciliation). Scope: map every B1 and B2
acceptance criterion to the test(s) that cover it, or to an honest gap classified
as **CLOUD-NOW** (should be closed in Cloud this lane), **DEFERRED-LANGGRAPH**
(blocked by the deliberate C4 outer-runner architecture hold), or **LOCAL-RUNTIME**
(requires PostgreSQL / LIVE / RECORD that Cloud cannot run).

This is a MAPPING deliverable (direction item 5). It does not itself author the
paused concrete lifecycle runner, and it does not start LangGraph work.

Sources of truth (verbatim, by line):
- B1 behavioural path — `docs/RECOVERY_PLANNING_CONTRACT_FREEZE.md` §13 lines 537-568.
- B1 minimum acceptance (18) — `docs/PRODUCT_PARITY_TRUTH_REBASE_2026-09-18.md` §12 lines 1013-1030.
- B2 adds (12) — rebase §13 lines 1058-1069.
- B2 structural — freeze §14 lines 570-600.

---

## 1. B1 minimum acceptance (rebase §12, 18 criteria)

| # | Criterion (paraphrased from the verbatim line) | Covering test(s) — real titles | Class |
|---|---|---|---|
| B1-1 | provider reprotection/change enters canonical state | `providerDisruptionValidation.test.ts` ("valid minimal event passes validation", replacement-service field validation); `ingestion.test.ts` | LOCAL-RUNTIME (canonical PG write) |
| B1-2 | targeted dependency propagation occurs | `northstar-v2-m6-closure.test.ts`; `northstar-v2-m6-l3/l4-evaluators.test.ts` (dependency/applicability closure) | CLOUD-NOW (pure M6) — PG-trigger propagation LOCAL |
| B1-3 | whole-trip viability shows the traveller's actual failure | `northstar-v2-m6-acceptance.test.ts`; `m9-product-readmodels.test.ts` ("recovery case keeps booking health separate from trip failure") | CLOUD-NOW (pure) |
| B1-4 | planner identifies plausible recovery domains from STATE, not scenario id | `r1-planning-foundations.test.ts` ("registry: connection_feasibility activates TRANSPORT and TRANSFER…", "overnight_accommodation activates STAY; programme_participation activates PROGRAMME", "no blocking dimension match leaves every domain NOT_APPLICABLE"); `r1-planning-contracts.test.ts` ("domains: deterministic activation selects relevant domains without hardcoded order") | CLOUD-NOW |
| B1-5 | planner gathers relevant travel evidence (read-only) | `r1-planning-foundations.test.ts` ("dispatcher: …dedupe…", "a request type cannot represent a consequential operation"); `r1-evidence-seam.test.ts` ("a DomainStrategyProposer receives…raw normalized tool results") | CLOUD-NOW |
| B1-6 | travel candidates generated from real/replayed provider evidence | `r1-transport-proposer.test.ts` ("replays checked-in evidence into ranked, bounded, SubjectId-safe SELECT_OFFER candidates") | CLOUD-NOW (REPLAY) |
| B1-7 | deterministic evaluation tests candidates against trip objectives (RC-6) | `r1-transport-proposer.test.ts` ("transport domain end-to-end…flips the journey FAIL→PASS"); `r1-decision-evidence.test.ts` (real RC-6 output → projections) | CLOUD-NOW |
| B1-8 | evidence shows whether travel-only recovery is sufficient | `r1-transport-proposer.test.ts` ("anti-fabrication: an uncaptured selected offer…honest NO_RECOVERY_FOUND"); `r1-decision-evidence.test.ts` ("a rejected candidate keeps honest rejection codes") | CLOUD-NOW |
| B1-9 | if inadequate, programme-side possibilities investigated | `r1-coordinator-generality.test.ts` ("generality A: PROGRAMME domain via the real time-swap proposer yields a VIABLE, RECOMMENDED attempt"); `r1-planning-foundations.test.ts` (PROGRAMME activation) | CLOUD-NOW |
| B1-10 | programme candidates evaluated with blast radius / reassessment closure / outcome delta SEPARATED | `r1-decision-evidence.test.ts` ("three projections stay distinct: blast radius is not the closure", "immediateBlastRadiusOf…", "reassessmentClosureOf…", "outcomeDeltaOf…"); `r1-planning-contracts.test.ts` ("blast radius: changed refs are separated from directly-affected refs", "outcome delta…") | CLOUD-NOW |
| B1-11 | viable approaches compared | `r1-comparator.test.ts` ("fewer regressions outranks every later fact", "ties fall through improvements, blast radius, then declared cost", "ranking never depends on input order") | CLOUD-NOW |
| B1-12 | NORTHSTAR identifies + explains the preferred recovery | `r1-comparator.test.ts` ("a lone usable candidate is recommended…", "tradeoffs are per-candidate in rank order, recommended first", "semantic notes explain but never change the ranking"); `r1-coordinator-generality.test.ts` (VIABLE/RECOMMENDED) | CLOUD-NOW |
| B1-13 | operator sees meaningful alternatives/rejections | `r1-case-projection.test.ts` ("material candidates keep rejection reasons…", "every primary explanation is a human label, never a bare uuid"); freeze §13 line 545 explainability | CLOUD-NOW (projection) — PG-loaded view LOCAL |
| B1-14 | operator approves the programme change | `northstar-v2-m8-checkpoint0-authority-gates.test.ts`; `northstar-v2-m8-authority-execution.test.ts` ("envelope fingerprint binds plan/intent/scope/limits") | CLOUD-NOW (authority gate) |
| B1-15 | existing internal execution machinery acts | **PIECES only**: `northstar-v2-m8-authority-execution.test.ts` ("execution transitions and unknown-outcome semantics"), `wave3r-dr2-provider-execution.test.ts` (internal gates). **NOT composed through the coordinator.** | **DEFERRED-LANGGRAPH** + LOCAL-RUNTIME (see §3) |
| B1-16 | observations update canonical state | `wave3r-dr2-provider-execution.test.ts` ("1D-6: PAID without observed ticketing never becomes SUCCESS", "1D-10b: …only after CONFIRMED + CANCELLED observations"). Canonical PG write + composed-with-coordinator NOT covered. | LOCAL-RUNTIME + DEFERRED-LANGGRAPH |
| B1-17 | reassessment proves the traveller recovered | `r1-progression-facts.test.ts` ("gate PASSED → RESOLVE"); composed reassessment-through-lifecycle NOT covered | CLOUD-NOW (pure C8) + DEFERRED-LANGGRAPH (composed) |
| B1-18 | case resolves | `r1-progression-facts.test.ts` (RESOLVE decision). The ACT of resolving through the owner (`resolveRecoveryCase`) is the paused runner. | DEFERRED-LANGGRAPH + LOCAL-RUNTIME |

### B1 structural constraints (freeze §13 lines 564-568)

| Constraint | Covering test(s) | Class |
|---|---|---|
| Selected strategy emerges from generalized planning/evidence/evaluation/comparison (line 564) | `r1-coordinator-generality.test.ts` (3 materially different situations, one coordinator) | CLOUD-NOW |
| No traveller branch / no fixed "flight then programme" pipeline / no fixture ids in app logic (line 564) | `anti-hardcoding-gate.mjs` (418 files CLEAN); `r1-planning-foundations.test.ts` (activation from dimension codes only); `r1-coordinator-generality.test.ts` (no scenario branch) | CLOUD-NOW |
| B1 does not require consequential external booking/payment execution (line 566) | `r1-planning-foundations.test.ts` ("a request type cannot represent a consequential operation"); planningTool closed vocabulary | CLOUD-NOW |
| One second materially different planning situation through the same coordinator before B1 acceptance (line 568) | `r1-coordinator-generality.test.ts` (A PROGRAMME / B STAY / C honest NO_RECOVERY) + `r1-transport-proposer.test.ts` (TRANSPORT end-to-end) | CLOUD-NOW |

**B1 verdict:** every planning/reasoning criterion (B1-3 … B1-14 and all four
structural constraints) is covered by real Cloud-passing tests. The uncovered
tail (B1-15 → B1-18) is the post-approval EXECUTION-and-progression composition
— see §3 for why it is not a plain Cloud test gap.

---

## 2. B2 acceptance (rebase §13, 12 items + freeze §14 structure)

B2 reuses the B1 planner/evidence/recommendation/strategy/authority stack (all
CLOUD-NOW above) and ADDS consequential externally-owned execution.

| # | B2 addition (rebase lines 1058-1069) | Covering test(s) | Class |
|---|---|---|---|
| B2-1 | provider-bound external ActionIntent | `northstar-v2-m8-authority-execution.test.ts` ("capability separation — observe ≠ service") | CLOUD-NOW (intent) |
| B2-2 | deterministic authority immediately before action | `northstar-v2-m8-checkpoint0-authority-gates.test.ts`; `wave3r-dr2-provider-execution.test.ts` ("1D: payment gate verdicts fail closed…", "1D-2: payable above authorised ceiling → payOrder is never called") | CLOUD-NOW |
| B2-3 | actual/simulated transactional provider dispatcher | `wave3r-dr2-provider-execution.test.ts` ("1D-16: REPLAY transaction normalization is identical to the LIVE path") | CLOUD-NOW (REPLAY); LIVE LOCAL |
| B2-4 | uncertain network/provider outcomes | `wave3r-dr2-provider-execution.test.ts` ("1D-5: ambiguous pay reconciles via retrieve before any retry", "1D-7: provider-unsupported cancellation is structured data, not a crash") | CLOUD-NOW |
| B2-5 | durable OUTCOME_UNKNOWN | `northstar-v2-m8-authority-execution.test.ts` ("execution transitions and unknown-outcome semantics"); `wave3r-dr2-provider-execution.test.ts` ("1D-8: REQUEST_ACCEPTED/PROCESSING never becomes an observed CANCELLED outcome") | CLOUD-NOW |
| B2-6 | lookup/reconciliation before any retry | `wave3r-dr2-provider-execution.test.ts` ("1D-9: ambiguous cancellation submission retrieves state before any resubmit", "1D-4b: create without payable observes it via retrieve before the gate") | CLOUD-NOW |
| B2-7 | partial failure | `m9-jordan-partial-failure-acceptance.test.ts` ("replacement CONFIRMED + cancel FAILED → duplicate exposure, unresolved") | CLOUD-NOW (RECORD) |
| B2-8 | preserved duplicate/cost exposure | `wave3r-dr2-provider-execution.test.ts` ("1D-10: replacement confirmed but displaced cancellation fails preserves duplicate exposure"); `m9-jordan-partial-failure-acceptance.test.ts` | CLOUD-NOW |
| B2-9 | canonical provider observation | `wave3r-dr2-provider-execution.test.ts` ("1D-6: PAID without observed ticketing never becomes SUCCESS", "1D-10b: …only after CONFIRMED + CANCELLED observations") | LOCAL-RUNTIME (canonical PG) |
| B2-10 | reassessment | `r1-progression-facts.test.ts` (BLOCKING_FAIL + recovery possible → REPLAN bound to the NEW basis) | CLOUD-NOW (pure C8) |
| B2-11 | continued recovery if still failing | `wave3r-dr2-provider-execution.test.ts` ("1D-11: provider repair success + another hard constraint FAILing keeps the case unresolved", "1D-12: …another hard condition UNKNOWN keeps the case unresolved"); `r1-progression-facts.test.ts` (REPLAN/ESCALATE) | CLOUD-NOW (pieces) |
| B2-12 | final observed resolution OR explicit escalation | `r1-progression-facts.test.ts` (RESOLVE; ESCALATE no_safe_recovery_remaining; ESCALATE human_evidence_or_decision_required). Composed-through-lifecycle + the ESCALATE case surface remain open. | DEFERRED-LANGGRAPH + LOCAL-RUNTIME + ESCALATE contract gap |

### B2 structural constraints (freeze §14 lines 570-600)

| Constraint | Covering test(s) | Class |
|---|---|---|
| Reuses coordinator / evidence model / proposer port / RC-6 / recommendation / strategy / authority (lines 574-582) | `r1-coordinator-generality`, `r1-comparator`, `r1-transport-proposer`, `r1-evidence-seam`, `northstar-v2-m8-*` | CLOUD-NOW (units) |
| Full lifecycle composed: intent → gate → durable attempt → dispatch → outcome → observation → reconciliation → canonical → reassessment → continued recovery → resolution/escalation (lines 586-597) | **NOT composed in one test.** Individual stages tested in isolation (see rows above). | **DEFERRED-LANGGRAPH** + LOCAL-RUNTIME (see §3) |
| Jordan is a proof case, not an architecture branch (line 600) | `m9-jordan-partial-failure-acceptance.test.ts` (fixture-driven, no Jordan branch); `anti-hardcoding-gate.mjs` CLEAN | CLOUD-NOW |

---

## 3. PRIMARY reconciliation of the composed-lifecycle gap

The C10 recon correctly reports the factual finding: **no single test composes
the lifecycle through the Recovery Planning Coordinator**
(coordinator → authority → external dispatch → observation → reconciliation →
reassessment → resolution). It then asserts this is "Cloud-testable (REPLAY/stubs
suffice); no PG/LIVE required." As PRIMARY I reconcile that assertion against the
binding direction, and the assertion is only half-true:

1. **The individual deterministic units ARE Cloud-tested.** Authority/gate
   (m8), provider dispatch + reconciliation + observation semantics
   (wave3r-dr2, REPLAY), partial failure (m9-jordan, RECORD), the pure C8
   progression decision (r1-progression-facts), and the coordinator planning
   itself (r1-coordinator-generality) all pass in Cloud today. Nothing here is a
   missing unit test.

2. **The COMPOSITION is the concrete C4 outer runner — which is deliberately
   PAUSED.** Direction item 1 forbids implementing "the concrete C4 Recovery
   Lifecycle Progression service (the `runtimeServices`/`composeTargetBoot`
   long-running WAIT/REPLAN/RESOLVE/ESCALATE runner)", and states LangGraph may
   replace ONLY that outer durable runner. A hand-stitched Cloud test that wires
   coordinator → authority → dispatch → observation → progression → resolution
   *is* a de-facto reference orchestration: it would pre-commit the exact
   sequencing/loop-ownership the LangGraph spike exists to decide, and item 6
   says "Do NOT start LangGraph work on this branch." So this composition is
   **DEFERRED-LANGGRAPH**, not a plain Cloud test I should add now.

3. **The canonical-state stages also need PostgreSQL at runtime.** B1-1/16, B2-9
   and the final RESOLVE/ESCALATE *acts* mutate canonical PG through existing
   owners (`resolveRecoveryCase`, provider observation writes). Those are
   **LOCAL-RUNTIME** regardless of the orchestration decision.

4. **The ESCALATE surface is an open CONTRACT GAP.** The existing case lifecycle
   has no dedicated escalated/needs-human state or command (freeze §11 line 502
   + ACTIVE_TASK ledger). B2-12's "explicit escalation" cannot be *acted* until
   local integration decides the truthful surface. Reported, not fabricated.

**Therefore:** the composed-lifecycle gap is correctly classified
DEFERRED-LANGGRAPH + LOCAL-RUNTIME (+ ESCALATE contract gap). It is NOT silently
downgraded to optional, and it is NOT built on this branch. This is recorded in
the ACTIVE_TASK handoff ledger.

---

## 4. Summary

- **CLOUD-NOW (covered):** all B1 planning/reasoning criteria B1-3 … B1-14 and
  all four B1 structural constraints; B2 items B2-1 … B2-8, B2-10, B2-11 and the
  Jordan-proof structural constraint — every one mapped to a real, passing test
  title above. Full `current` suite 929/929.
- **DEFERRED-LANGGRAPH:** the composed lifecycle runner (B1-15 → B1-18 tail,
  B2 full-lifecycle structural constraint, B2-12 resolution/escalation act).
  Blocked by the deliberate C4 architecture hold, not by a Cloud limitation.
- **LOCAL-RUNTIME (PG/LIVE/RECORD):** canonical ingest/propagation writes
  (B1-1), canonical provider observation (B2-9), PG-loaded Case view (B1-13),
  the coordinator PG adapter, and the migration-0125 attempt round-trip.
- **CONTRACT GAP:** the ESCALATE case surface (B2-12) — reported for local
  decision per freeze §11 / §14.

No criterion is left unclassified. The planning parity R1 Cloud lane is
complete; the remaining items are the paused outer runner, PostgreSQL/LIVE
runtime, and the ESCALATE surface decision — all LOCAL integration-acceptance
work.
