# ACTIVE TASK — Jordan final closure (fresh baseline → protected execution → RESOLVED)

## Identity

- Repo: `dropandresetmain-prog/qoder-atlas`
- Worktree: `C:\Dev\qoder-atlas\.worktrees\a5-jordan-transaction-recording`
- Branch: `fix/a5-jordan-transaction-recording`
- Starting SHA: `b67d0d7a54b04f6918064dea0d1a01ec406edf95`
- Sarah is frozen on `finish/sarah-programme-recovery` @ `3e35c6c` — do not touch.

## Scenario truth (recording world)

- TODAY 2026-09-23; original lyf Bugis 29 Sep → 3 Oct (4 nights) booked TODAY as a
  fresh Nuitée sandbox booking. Disruption on 29 Sep.
- Indicative LIVE: original 4n USD 976.04, replacement 3n USD 698.83, Narita USD 35.18,
  TR885 USD 116.96. The CONFIRMED booking amount overrides 976.04.
- `z-xdzAxcv` / USD 670.77 is historical and cancelled — never the active baseline.

## Semantics decided (CP1)

- `cancellationPenalty` = current fee at planning now (0 inside the free window).
- `scheduledCancellationPenalty` = post-deadline exposure. Never a refund.
- `recoverableStayCredit` (+ basis `CONFIRMED_BOOKING_TOTAL_LESS_CURRENT_FEE`) = the
  existing booking's provider-confirmed `bookedTotal` less the current fee. The only
  source of `DISPLACED_STAY_CREDIT`.
- `stay_arrival_date_aligned`: arrival after check-in date needs evidence
  (`late_arrival_retained` / `no_show_cutoff` operands, dataset `lateArrivalEvidence`).
  None → UNKNOWN. Nuitée exposes no machine-readable no-show terms.

## Provider baseline model (CP2)

- Dataset stay carries only a source reference (`source-booking-ref: ait-draft-09-destination-stay`);
  `recovery-research.json` binds `sourceBookingReference`, never a provider booking id.
- `POST /api/v2/demo/provider-baseline` (demo gate) → `bootstrapProviderStayBaseline`: attached-link
  check → provider lookup by deterministic `ns-baseline-…` clientReference → else search/quote/book
  → `getStayContext` → observed `HOTEL_BOOKING` record linked to the RESERVATION on the (created)
  `nuitee` connection. REPLAY replays the recorded chain. Never on boot/Reset.
- `completeStayBinding` uses the attached booking as the stay element; none attached → no stay
  replacement economics (honest unavailability).
- Found gap: nothing in normal runtime created the `nuitee` external connection stay execution needs;
  the bootstrap creates it.

## Checkpoint ledger

- [x] CP1 — hotel contract + no-show/refund semantics (`1a19749`)
- [x] CP2 — fresh sandbox baseline booking + canonical binding (explicit bootstrap), completed
  - Fresh booking `DpnZRH43H` (Nuitée sandbox, lyf Bugis 2026-09-29→10-03, 1 adult), confirmed USD 955.69,
    RFN, free cancel until 2026-09-26T10:00:00Z, then USD 955.69 (full).
  - Fixed real bug found while wiring REPLAY into the D3 planning test: `bootstrapProviderStayBaseline`'s
    deterministic `ns-baseline-…` clientReference was keyed on the internal `reservation_id` uuid, which
    is only stable within one seed lineage — the actual sandbox RECORD run (clone
    `ns_demo_cl_c1e467c8ce574a92`, reservation `39e6f1f7-…`) used a different reservation uuid than the
    canonical `aitFixtureClone.ts` PG test fixture (`bfb1eaa9-…`), so REPLAY of `book` always missed.
    Re-keyed on the stable dataset-level `sourceBookingReference` + stay dates instead; renamed the two
    affected recordings (`nuitee/book`, `nuitee/booking_lookup`) to their corrected content hash —
    same real sandbox response payloads, corrected addressing only.
  - Stale `z-xdzAxcv` tests fixed: `test/a5-hero-seed-truth.test.ts` now asserts the source-binding model
    against the fresh REPLAY stay-context recording; `postgres-integration/a5JordanD3Planning.pgtest.ts`
    now calls `bootstrapProviderStayBaseline` in REPLAY before composing recovery research, resolves the
    stay via `sourceBookingReference` (never asserts the provider booking id), and asserts the corrected
    D3 economics (see below).
  - Repaired local scratch `postgres-integration/a5ProviderStayBaseline.pgtest.ts` (stub HotelCapability,
    5 focused cases: RECORD attach+idempotent, client-reference-lookup recovery, REPLAY never looks up by
    client reference, PROVIDER_CONTEXT_FAILED attaches nothing, unknown source ref fails STAY_NOT_FOUND)
    and registered it in `test/suites.json` (`current` + `postgresFast` + `aitFixtureCloneConsumers`).
  - Point 9 (reset never auto-bootstraps) verified structurally: `src/app/demo/demoReset.ts` has zero
    references to `providerStayBaseline`/`runProviderStayBaseline`; every fixture-clone test in the suite
    starts with no attached `HOTEL_BOOKING` unless it explicitly bootstraps, which is exercised by every
    test above. No dedicated `resetDemoWorkspace` test added — low marginal value over the structural
    guarantee given remaining CP3-CP6 scope.
- [x] CP3 economics fix (accounting double-count, fixed **before** CP3 proper) —
  `src/resolution/planning/recoveryCostComparison.ts`: a CANCEL_STAY effect's current-fee
  (`POLICY_PENALTY_ESTIMATE`) line no longer also lands in `totalHomeAmount` once
  `recoverableStayCredit` is established (even when it nets to exactly zero under full forfeiture) —
  it stays visible in `potentialLossHomeAmount`/`lines` for operator transparency, but the credit line
  alone carries the net effect now. Regression test added in `test/a5-stay-recovery-economics.test.ts`
  proving the exact D3 case (bookedTotal = fee = 955.69) nets to `newSpend` alone, not `newSpend + 955.69`.
  Proven end-to-end at the PG planning level too: the D3 planning pgtest now asserts
  `cancellationPenalty=955.69`, `freeCancellationUntil=undefined`, `scheduledCancellationPenalty=undefined`,
  `recoverableStayCredit=0.00` on the recommended strategy's CANCEL_STAY effect.
  All 22 focused economics/seed-truth unit tests + both PG tests pass; `gate:test-boundary` and full
  `tsc --noEmit` are clean.
- [x] CP3 complete (`2856a6e` + Case-cost-UX/Path-A-B durable-assertion commit).
  - Case cost UX (`4ff2efe`'s follow-up, `2856a6e`): reimplemented `lane/a5-cp3-case-cost-ux` cleanly
    (not merged) on `caseDecisionPresentation.ts`/`product-recovery-case.ts`/`projectPlanningEvidence.ts`.
    Fixed a real display bug: the CANCEL_STAY compact summary rendered `scheduledCancellationPenalty`
    (future exposure, never a refund) labelled as the cancelled stay's value — now uses
    `recoverableStayCredit`. Current fee / future penalty / recoverable value stay visually and
    textually separate everywhere (note block, cost lines, net-cost line, glance cell, cancelled-stay
    article). Net cost can render negative (a saving) with a correctly-placed leading minus. Regression
    test `test/a5-cancel-stay-case-copy.test.ts`.
  - Path A/B ranking confirmed end-to-end on the real Jordan D3 planning run (no new engine code needed
    — CP1's `stayArrivalDateAligned` evaluator already gates this correctly): the AWAITING_AUTHORITY
    planning attempt's `material_candidates` show exactly one `TRANSPORT:RECOMMENDED` candidate (Path A:
    TR885 + Narita overnight + new Singapore stay + cancel original) and Path B (keep the original
    booking after late arrival) present as `REJECTED_DETERMINISTIC` with blocker reason
    `original_stay_late_arrival_survival_unknown` — never silently viable. Added as a durable assertion
    in `postgres-integration/a5JordanD3Planning.pgtest.ts` (not just observed via a throwaway debug log).
  - Checks: 16 operator-ui-convergence + 2 new UI regression tests pass; full D3 planning PG test passes
    with the new Path A/B structural assertions; `gate:test-boundary` and full `tsc --noEmit` clean.
- [x] CP4 — focused graph spine + proposed-service preview (CP4 commit(s) on top of `162a47a`)
  - Start state note: the worktree was NOT clean at `162a47a` — the pre-CP4 prep (migration `0138`
    + `providerExecutionInputs.ts` `proposedTransportServiceId`/`loadProposedOfferBindingsForStrategy`,
    staged; the traveller-kind suppression fixes in `projectFocusedGraph.ts` + A1 test update, unstaged)
    was uncommitted. It is committed as part of CP4.
  - Empirical D3 truth (real AiT clone, D1→D2→D3 + REPLAY planning, throwaway diag dump): `causalPath` is
    exactly ONE step (`connection_feasibility/connection_broken`, cause = inbound item, related = inbound +
    onward items). `stay_arrival_date_aligned` and both `programme_participation` explanations are PASS at
    D3 (canonical onward still lands on the check-in date) — so they can never enter `causalPath` (blocking
    FAIL explanations only, correctly). Before CP4, `causalNodeRefs` = signal, inbound booking, arrival
    timing, traveller, onward booking; the stay and both commitments sat in the dimmed context band under
    the spine ("floating"). Found a real generic bug: the `TRANSFER_STAY` card carried NO `subjectRefs`, so
    no evaluator explanation naming the stay's `JOURNEY_ITEM` could ever map onto it.
  - Piece 1 (proposed-service preview): `pgFactAssembler` previews ONLY the current planning attempt's
    `recommendation.recommendedStrategyRef`, from its `offer_execution_bindings.proposed_transport_service_id`
    (`loadProposedOfferBindingsForStrategy`), gated by pure `selectProposedServicePreview` (no preview once any
    `execution_attempts` row exists for an action plan of that strategy; TRANSPORT items of the case only;
    proposal == canonical → nothing; two proposals for one item → ambiguous → nothing). Label from the
    itinerary (operator + mode, route via `places` names); no service code (the itinerary has none — never
    invented). Preview card + every edge touching it are `authority: PROPOSED`, card `semanticState: PROPOSED`,
    detail "… · Proposed replacement · not booked yet"; the canonical connection's FAILED verdict/"unreachable"
    detail is never transplanted onto it and no timing node grows from it. Canonical selection is only read.
    `ensureOriginalCaseGraph` reads with `{ proposedServicePreview: false }` so Original never contains a proposal.
  - Piece 2 (spine connectivity): generic, evaluator-driven — `TRANSFER_STAY` cards now declare
    `subjectRefs: [JOURNEY_ITEM:<item>]`; the assembler also collects `dependencyContext` (blocking, applicable,
    NON-FAIL explanations of the same CURRENT assessments; never part of `causalPath`); `projectFocusedGraph`
    appends, after the causal chain, the visible subjects of any dependency explanation that explicitly names a
    non-traveller node already on the chain. One hop (anchors frozen first), traveller never an anchor, so an
    unrelated commitment (explanation names no chain item) stays off. No topology search, no scenario tokens.
    Real D3 result: arrival → proposed onward, onward → stay, Jordan → stay, arrival → both commitments are
    causal edges; `causalPath` itself unchanged (1 step).
  - Checks: `test/a5-proposed-service-preview.test.ts` (new, 6 tests: canonical before proposal; PROPOSED
    preview from itinerary; no stale canonical card; after execution / canonical rebind → booked canonical card,
    no preview; selector edge cases; no canonical shadowing) + 3 new CP4 tests in
    `test/r2-focused-graph-projection.test.ts` (dependents join / unrelated + second-hop excluded; no chain → no
    additions; enrichment→projector end-to-end incl. stay subjectRefs + arrival→proposed onward→stay).
    10 graph-related unit files: 128/128 pass. `postgres-integration/a5JordanD3Planning.pgtest.ts` extended with
    durable CP4 assertions on the real D3 run (preview node from the real binding, canonical selection unchanged,
    no stale onward card, stay + both commitments on spine with connecting causal edges, Original-mode read has
    no PROPOSED node): 1/1 pass (166 s). `tsc --noEmit` clean; test-boundary gate CLEAN (313 files).
    `npm test` (current): 1404/1411 — the 7 failures were proven pre-existing/unrelated by running them on an
    index export without CP4 changes (6 reproduce: b1-product-acceptance, final-demo-content-coherence
    ait-draft-09 hotel, m9-vertical-loop copy regex, postgres-fast-suite-contract (a5ProviderStayBaseline in
    postgresFast), r1-case-projection C9 "Replacement travel" copy, r4-offer-execution-boundary provider-mutation
    guard flags `providerStayBaseline.ts`); the 7th (demo-console popover e2e timer) passes 10/10 alone — load flake.
    `npm run test:postgres:fast` (once, 28.6 min): 552/610 pass, 58 fail — NONE attributable to CP4. ~45 are
    one pre-existing family `VALIDATION_FAILED: GRANT_MISSING: action.intent.dispatch` (m8AuthorityExecution,
    c3TargetedRemediation, a4CompositeExecution/SelectedPlanContinuation/StayExecution, m7m8*, m9SameProgramme*,
    m9SarahTargetE2E, r1UnknownOutcome). Every read-model/planning-adjacent failure was re-run on the pre-CP4
    index export and reproduces identically there: r2FocusedCaseGraph "selected service uses an exact confirmed
    allocated reservation line", r1PlanningEvidenceProjection C9 "later canonical change…", r1CaseAttention,
    r1RecoveryProgression, b1RecoveryLoop, m9JordanMultiActionRecovery, a3StayArrivalRequirement, m8 (15/55 fail
    on baseline, same subtests). `a3JordanConnectionFoundation` ("the healthy whole journey passes before any
    disruption") passes on the tracked-only baseline but fails identically on that SAME pre-CP4 code once the
    worktree's 25 UNTRACKED `recordings/**` files (earlier sessions' RECORD output: atlas/search, frankfurter,
    nuitee quote/search/stay_context, official-documents) are copied in — environmental, not CP4; those
    untracked recordings are deliberately NOT committed and need a decision (commit, sanitize or delete) before
    CP6 REPLAY proof. These pre-existing PG failures are NOT CP4 scope; they
    must be triaged before CP5/CP6 relies on the execution gates (GRANT_MISSING blocks authority→dispatch).
  - Carry-forwards: (Park) `programme_participation` PASSes on the canonical onward arrival even when the
    connection into it is broken (evaluator is connection-blind) — pre-existing evaluator semantics, not a graph
    issue. (Park) the arrival→commitment edge is drawn from the last *implicated* timing node (inbound NRT
    arrival), not the destination arrival — pre-existing enrichment rule. The 6 pre-existing `current` failures
    above need their own fix pass (CP2/CP3 fallout) — not CP4 scope.
- [ ] CP5 — Chromium D1/D2/D3 acceptance
- [ ] CP6 — protected sandbox execution → RESOLVED + sanitized recordings + REPLAY proof

## Parked

- Unified all-provider LIVE/RECORD master switch — deferred (unchanged).
