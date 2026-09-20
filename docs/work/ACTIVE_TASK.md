# ACTIVE TASK — A3 OPERATOR UI SECOND PASS

Live ledger for the bounded operator-UI convergence pass. Prior A2/A3 engine ledger below is preserved.

## Identity

- Branch: `finish/a3-operator-ui-second-pass`
- Worktree: `C:/Dev/qoder-atlas/.worktrees/a3-operator-ui-second-pass`
- Base / starting SHA: `ec7fb156493b08273f950fb3052fb8fe00462631` (`finish/a3-operator-ui-astra`, includes verifier fixes on `415badf` integration)
- Active integration (docs, no UI merge yet): `integration/astra-post-r4` @ `415badfc6b23e1af7b9108d48566f43fc5c4bacb`
- Runtime at diagnosis: `a3-operator-ui-astra-verify` worktree, same tip `ec7fb15`, `node src/main.ts` on port **4124**
- Role: PRIMARY operator-UI second-pass implementer
- Scope: Overview + shared Case presentation only. No A4. No recovery-engine changes. No archived-bundle copy.

## Owned paths

- `src/ui/screens/product-recovery-case.ts`
- `src/ui/caseDecisionPresentation.ts`
- `src/ui/operatorWorkspaceStyles.ts`
- `src/ui/screens/product-operator-overview.ts`
- `src/app/target/adapters/operatorOverviewAdapter.ts`
- `src/ui/overview-graph/model.ts` (framing membership/message only)
- `src/ui/overview-graph/index.ts` (label strip only if needed)
- `test/operator-ui-convergence.test.ts` (+ adjacent focused tests as touched)
- This ACTIVE_TASK section

Do not touch: A4 WIP branches, handoff bundle, recovery planning/engine, SQLite, provider adapters.

## Checkpoint status

| CP | Goal | SHA |
|---|---|---|
| 1 | Source/runtime identity + content ownership freeze + A–D triage | `3bded3e64026213b8f3b78e6b8e83ced28f72e5f` |
| 2 | Case default-visible hierarchy + focused tests | `ed41bd1b2493bd8d645c72a70b9eb362f53ba852` |
| 3 | Overview/framing integrate + Chromium QC | `c6d6826a765de08c6fbdb19716675bc0e3f41fca` (tip `8343362` lint tidy) |

## Chromium QC (CP3)

- Runtime SHA: `8343362fe1898ebe17f497fb6fcdd8e19cd0c150`
- Workspace: `C:/Dev/qoder-atlas/.worktrees/a3-operator-ui-second-pass`
- HTTP: `http://127.0.0.1:4125` (same PG world as prior verify server: workspace `18891fc1-…`)
- Cases: Sarah `fffa8660-16f7-5d8f-9824-c87947fa3626`; Jordan `297337f5-cda2-5397-a2ba-9ace992396b3`
- Screenshots (local, not staged): `output/a3-ui-second-pass/*-{1440x900,1280x800}-{viewport,full}.png` (+ Jordan 200% viewport)
- Playwright metrics @1440×900: Overview focus pill `Active change · ID: 4 cleared · 1 still need attention` / Focus Sarah Lim; `dossierOutsideDetails=0`; `hasPause=false`; cases `hasBlocker=true`
- Default Case scrollHeight: Sarah ≈3201px (~3.6×900); Jordan ≈3719px (~4.1×900). Over 2–3 viewport target because full-width V5.6 + recommendation remain required; dossiers no longer expand the default view.
- 200% zoom: sticky decision panel present; Park — button may sit below sticky overflow at extreme zoom.

## Default-visible removals → where evidence lives

| Removed from default | Now lives |
|---|---|
| Four large Overview status cards + decision instruction banner | Compact bucket row inside readiness; pending-decision note beside Needs attention |
| Unrelated traveller in active-change footprint | Dependency-scoped `incidentIds` / focus traveller |
| “Recommendation review” / “What you’re reviewing” banners | Factual situation lead + short recommendation-status link |
| Global `A3_EXECUTION_PAUSE` on every control | `decisionActionState` + exact `executionBlocker` when present |
| Default-visible rejected `proposalHtml` dossiers | Closed `Inspect evaluation` / detailed evaluation disclosures |
| Money + full action list duplicated in rail/evidence | Money primary in decision panel; cost table expanded in main column |
| Standalone “What we checked” + repeated formality article | Outcomes under recommendation; conditions once in decision panel; sources under activity |
| Second long evidence rail article | Compact research table + technical activity disclosure |

## Checks run

- `node --test test/operator-ui-convergence.test.ts` — 13/13
- `node --test test/operator-ui-camera.test.ts` — 6/6
- `node --test test/eventOverview.test.ts test/r4-f1-overview-hit-targets.test.ts` — 25/25
- `npx tsc --noEmit -p tsconfig.json` — clean
- Chromium Playwright native viewports + full pages — captured locally
- No full suite / no PG campaign / no supplier calls

## Status

**UI CANDIDATE READY FOR FOUNDER QC — A3 NOT YET ACCEPTED**

## Next action

Founder QC. Do not start A4.

---

## Presentation contract (FROZEN)

Authoritative fields only; no invented facts.

1. **Selected identity:** `planningEvidence.recommendation.recommended.ref` → exact `RecoveryStrategyView` via `decisionOptions`/`sameStrategy`. Candidate via `candidateFor` on that strategy. Missing/stale/mismatched ref → explicit unavailability, never fallback selection.
2. **Current vs proposed:** strategy `changes[]` (+ proposal flights/stays/programme when joined by strategyRef). Do not zip unrelated arrays by position/city/date.
3. **Typed action rows:** one compact row per meaningful `effectKind` / proposal element; cancellation stays “proposed, not completed”.
4. **Outcome rows:** `strategy.resolves` + recommendation `basis` (≤3). Proposed-world checks ≠ completed recovery.
5. **Money (decision panel primary):** home new spend; original-currency amounts; potential cancellation loss separate; “up to” only when source label establishes maximum. Expanded itemised table + FX provenance in main column.
6. **Authority/action:** enable consequential control only when recommended strategy has no `executionBlocker` and case is awaiting authority; otherwise show exact blocker or unavailability. No global `A3_EXECUTION_PAUSE` as the reason for every disabled control. Do not invent approver identity in copy; server resolves principal on POST. No A4 hotel/external booking enablement.
7. **Conditions:** once in decision area from uncertainty + entry research notes + proposal blockers; link to evidence details.
8. **Research:** compact category \| outcome \| source/mode; mixed stays mixed.
9. **Disclosure identity:** stable `candidateKey` / `strategyRef` region keys; rejected preview ≤3 compact rows; full human-readable evaluation inside closed disclosure (no default-visible `proposalHtml` dossiers).

## Diagnostics A–D (Checkpoint 1)

### A. Sarah recommendation identity — no presentation drift

- Case `fffa8660-16f7-5d8f-9824-c87947fa3626`, status `AWAITING_AUTHORITY`.
- `recommended.ref` = `35d0b862-4e53-5af9-9c62-9fe3022ad537` matches strategy #1 `SELECT_OFFER` and candidate `proposer.transport-offer:…` disposition `RECOMMENDED`.
- Title path = “Book replacement travel”; cost AVAILABLE (USD 41.66 → SGD 53.26). `executionBlocker` = `EXTERNAL_EXECUTION_NOT_COMPOSED`.
- Viable programme strategies #7/#8 exist without blocker but are **not** the recorded recommendation — do not force them.
- Founder screenshot corridor/price (DXB–SIN / ~$645) differs from this LIVE attempt (CGK–SIN / SGD 53.26). Different LIVE recommendation ≠ UI identity bug.
- **Triage: Park for Later** (world/story variance). **No BACKEND BLOCKER for identity.** Revisit only if a section selects a different strategy than `recommended.ref`.

### B. Active-change dependency footprint — Act Now (UI)

- Overview blast: `SERVICE:01baf3ba-…` (label ID), cleared 4 / unresolved 1; landmark programme item supplied.
- Promoted: Sarah `UNRESOLVED` on that dependency; Jordan `ATTENTION` with **empty** `dependencyRef`.
- Current model includes all non-cleared promoted travellers in `incidentIds` and picks first unresolved without dependency filter → Jordan incorrectly enters Sarah’s active-change footprint.
- **Triage: Act Now — CLOSED in CP2** — restrict incident membership + focus traveller to the selected `blast.dependencyRef`; label count strip as change-scoped. Chromium proves Focus Sarah Lim on ID.

### C. Authority / action path — Act Now (presentation) + Park (projection gap)

- Approve HTTP: `POST /api/v2/cases/:id/strategies/:id/approve` resolves principal from `x-northstar-principal` or workspace operator; then `approveRecoveryStrategy` grant checks.
- Case read-model exposes `authorityState`, per-strategy `executionBlocker`; **does not** project caller principal / grant coverage.
- Current UI disables all approval with global `A3_EXECUTION_PAUSE` even when a programme-only strategy has no blocker.
- Sarah’s **recorded** recommendation is externally blocked → must remain blocked with that reason.
- **Triage: Act Now — CLOSED in CP2** — action-state matrix from recommended strategy + blocker; remove global pause-as-reason. **Park for Later** — explicit approver/grant projection on the case view (fail closed without inventing organiser copy).

### D. Entry / formality applicability — Act Now (dedupe only)

- Jordan: entry tool uncertainty supplies SG Arrival Card obligation; entryResult `PASS`/`requirements_met` on recommended candidate. Notes are evidence-backed for that attempt, not inferred from name/city.
- Default UI repeats formalities across lead/approval/evidence/activity.
- **Triage: Act Now — CLOSED in CP2** — show once in decision conditions; detailed sources under evidence expansion. Do not invent legal applicability.

## Content ownership (default view)

| Fact | Primary home | Expansion / technical |
|---|---|---|
| What broke + stake | Situation lead + compact impact | — |
| Causal state | Full-width V5.6 | Original toggle |
| Proposed changes + ≤3 reasons | Recommendation card | Technical strategy JSON |
| Money + conditions + next action | Sticky decision panel | Cost breakdown (main width); sources |
| Other viable / rejected | Collapsed counts + ≤3 rejection rows | Per-option closed evaluation |
| Research | Compact rows | Tool/model technical activity |

## Next action

Chromium QC on normal runtime (Overview / Sarah / Jordan), update ledger evidence, push CP3. Stop before A4.

---

# ACTIVE TASK — A2 ACCEPTED / A3 IN PROGRESS

- Goal: one generalized PostgreSQL engine, two rich desktop hero recoveries. [Hard scope lock](ASTRA_HERO_DEPTH_SCOPE.md).
- Finishing execution plan: [A3–A5 finishing implementation plan](A3_A5_FINISHING_IMPLEMENTATION_PLAN.md). New implementation agents must read it before starting A3/A4/A5 work.
- Primary: `integration/astra-post-r4` in `C:/Dev/qoder-atlas/.worktrees/astra-post-r4`. Verify current HEAD before opening a new finishing lane; do not rely on a copied SHA in this ledger.
- Immutable R4 base: `2baf1f6df484319e131590d37a0b026222324d03`.
- A3 LIVE progress base: `eca447d804debd4e704df9ef48db08b50f1dfcb8`. [Actual A3 LIVE progress](ASTRA_A3_LIVE_PROGRESS.md) records normal provider/PG/browser evidence and source-complete baseline; acceptance remains pending.
- A4 preserved WIP handoff: [A4_RECOVERY_PREP.md](A4_RECOVERY_PREP.md) — docs-only; do not integrate WIP lanes yet.
- Accepted: A0 `f55899b15200de692dd749bbcfb795c67f6a22e0`; A1 `a948917c239fc02435020f6740474283dd795ea8`; A2 `f0c79f2412513e3a676737ac32c3c3694c03388a` (tested565f561).
- Evidence: [A1](ASTRA_A1_PRODUCT_EVIDENCE.md), [A2 LIVE](ASTRA_A2_LIVE_EVIDENCE.md), [A3 decisions](ASTRA_A3_STAY_EXTENSION_DECISION.md), [ROADMAP](../ROADMAP.md).

## Acceptance and broad counters

- [x] A0 freeze; A1 desktop/V5.6/V7.2; A2 Sarah LIVE Qwen + Atlas research, internal programme recovery, recorded RESOLVED/Current PASS, Original FAIL, Overview52/67.
- [ ] A3 complete LIVE flight + overnight + entry + destination cancel/rebook + FX recommendation physically visible.
- [ ] A4 four real sandbox actions, per-action observation, atomic canonical stay updates, whole-trip resolution/video.
- [ ] A5 both heroes LIVE repeat, presentation/final gates/freeze.
- Broad attempts: **postgres:fast3 / CURRENT_TARGET2 / full canonical PG0**. Continuation lane accidentally used `npm test -- file` (wrapper ran CURRENT_TARGET, exit0); corrected to direct Node exact-file tests, no repeat. Historical broad closures remain in A1 evidence.

## Current lanes — all Act Now

- **A4 WIP preserved (not integrated):** see [A4_RECOVERY_PREP.md](A4_RECOVERY_PREP.md).
  - Continuation: `codex/a4-selected-continuation` @ `b911989` (prior candidate `fb4ff102`; 6PG at that SHA not re-run). `b911989` attempts external dependency + source-kind guards; external-dep PG proof still missing; root owns trusted fresh capture.
  - Hotel execution: `codex/a4-hotel-execution` @ `2e6cdae` in `.worktrees/terra-a4-hotel-execution`. Sibling fork of continuation — do not merge whole tip; port hotel-unique delta after continuation. Unit stay-boundary 7/7; cancel PG authored, not re-run; boot composition missing.
- Compiler stay-dependency tests f62d836 / primary `0433979` already integrated (26 focused pass).
- Luna hotel ceiling b218558 integrated. Visit attachment b2f6f96 + validation b9676b1 integrated (reuse8PG pass). Luna cd8f328+b53e8f1 desktop terminal copy/exact item labels/alternatives integrated.
- Root: durable candidate details9cd4ba6 integrated with local zones/timing facts; official source links and remaining formality notes; actual active sandbox baseline booking ingested/bound. LIVE complete composite now recommended/VIABLE (attempt3cdb224a); final desktop evidence/authority-readiness pending.

## Integrated A3 evidence

- Foundationb7500638 and source reconciliation710faf58; reset/external guard8939a491. Current engine progression baseline160min→D195PASS→D230FAIL/Case→D3-65FAIL/sameCase.
- Proposed stay/visit overlays, companion planner, bounded FLIGHT/HOTEL dispatch, current HOTEL transport, exact source/property verification, explicit encrypted sandbox document store and retry-safe passport provisioner integrated. Reuse lane unit/PG evidence; no real A3 transaction claimed.
- Reviewed publicationa817d36:59focused+PG1/1. Preparation recapturea2b1265:real HTTP/PG1/1(12.5s), stale audit/no promoted strategy until normal reassessment. Candidate PLACE geographyPG1/1; passportPG4/4.
- Reader source digestd61b517:18focused; actual RECORD retrieval of4configured official sources, both entry/property verifiers pass. Readable-text hashes agree. Evidence expires after24h; not final LIVE normal-runtime proof.
- Source stay-date policy35b7865 and destination compositee70e999 integrated:28focused pass; reuse source-policyPG1/1. Explicit generic requirement drives CANCEL_STAY + ADD_STAY; penalty requires actual provider evidence, never zero by absence.
- Exact cost helper78e94ec/core64babf6 integrated:9focused pass. Existing layered Frankfurter resolver retained; full original currency + normalized total + selected dated provenance. Root per-basis pair-cache3focused pass; normal-runtime/UI still pending.
- New physical finding: overnight conditional requirement produced empty explanations/UNKNOWN for a known below-threshold gap. Root fixes evaluator v2 (known short gap PASS, qualifying gap still requires stay). L1 focused24/24. Focused foundation PG1/1(145s) now additionally proves whole-Journey baseline PASS then unchanged progressive path.
- Fresh A3 database `astra_jordan_a3_20260920`, workspace `d71ba69c-5a48-49b8-b292-3b21a542c29c`, source connection `6a80479b-6d24-541e-bf8f-275ac01a3c4f`. Browser baseline52/67 confirmed after overnight fix. D1/D2/D3 applied through normal HTTP; Case60e5af48-8b35-5661-a9bd-39e3b1f8d40b. LIVE evidence retained; no external transaction. Current normal server4122/session31404 runs this graph/activity correction.

## Triage / exact next actions

- **Act Now:** finish corrected context + boot composition, explicit sandbox inputs/current destination provider booking terms, LIVE whole composite recommendation, desktop evidence. Source date truth is4→3 nights (29Sep→3Oct becomes30Sep→3Oct); founder3→2 was a conditional example.
- **Act Now closure:** second PG world has explicit source visit+selected passport+LIVE scoped ICA evidence before baseline52PASS/15UNKNOWN. DBastra_jordan_a3_composite_20260920/workspace18891fc1-6e2a-4200-8328-f33b9ca96205; metadata/config under ignored output/playwright and data/local/a3. Source baseline sandbox booking observed; D1/D2/D3 applied normally. LIVE attempt cabd29d2 on Case2e15c71d produced16 rejected partial candidates. Retain SG arrival-card obligation visibly; no completed submission/admission claim.
- **Act Now closure:** candidate capacity corrected; LIVE attempt3cdb224a-0c6e-54f0-8ecc-5f6bb60a9b7d producedoneVIABLE complete composite, AWAITING_AUTHORITY. OriginalUSD and Frankfurter18Sep SGD2757.86 exposure displayed. Initial serialization conflict closed by normal fresh-basis retry; oneNuiteequote409 refused, otherquoted optionworked. Desktop finalreadability stillpending. Current booking c4NsnfT_N confirmed; NRFN full-price loss ceiling is explicitly conservative, not exact fee/refund.
- **Act Now A4 safety:** bounded review findings remain open (checkpoint JSON/provenance, unowned receipt links, caller-asserted residual/world/revisions, unstable hashes). `b911989` does not close them. Root owns authoritative fresh capture. Nothing consequential may use continuation until closed — details in [A4_RECOVERY_PREP.md](A4_RECOVERY_PREP.md).
- **Act Now A4 (later, after A3 desktop acceptance):** [exact selected-plan continuation contract](ASTRA_A4_SELECTED_PLAN_CONTINUATION.md); flight, overnight book, destination replacement book, old-stay cancel. Integration order: continuation safety → hotel-unique port → root review → four-action physical. Do not integrate either WIP branch blindly.
- **Park for Later:** healthy-trip requests/composer, mobile, generic programme/hotel/visit/credential management, immigration/crawling breadth, unrelated providers, transfer transactions, claims, multi-incidents/extra scenarios, importer atomicity, unrelated parity/refactors/infrastructure.
- **Ignore / Accept Risk:** accepted R4 redirect/collapsed Apply and inert legacy controls, unless new hero evidence makes them blockers.
- No founder decision pending. No A3 acceptance yet. Next: restart4123 with desktop/actual programme timing evidence, refresh via normal reassessment/operator planning, capturefinalA3visibleproof. Structuredgiven/family source dossier copied withauditedaddTravellerName; noinventedidentity. Narrative-only21:00same-nightclosure sourcegap remains explicit. Then A4 selected execution. Initial sandbox source booking must not be counted as an A4 selected action.

## Stop-safe handoff

- Accepted Sarah server remains on565f561 port4120/session16512, DBastra_product; preserve its evidence. It predates external-reset safety; never execute A4 on that old process.
- Root `C:/Dev/qoder-atlas` remains unrelated integration/pg-test-perf2534175; do not edit/base lanes there. No main merge.
- Preserve rejected drafts (pushed WIP checkpoints; never merge as-is): request planner `codex/astra-a1-request-gates` @ `bfed770` (base be69d056), request authority `codex/a1-request-authority` @ `091555c`, importer7b8236ed, wrong-base proposed-stay7ee0c431.
- Ignore local output/playwright proof scripts, source recordings, raw A2 videos and local keys/config; never stage secrets/generated artifacts.
- Continue same task. Fresh A4 engineering: read [A4_RECOVERY_PREP.md](A4_RECOVERY_PREP.md) first. This ledger plus linked evidence is the compact fresh-chat handoff.
