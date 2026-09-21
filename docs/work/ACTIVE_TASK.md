# ACTIVE TASK — A5.1 INTEGRATION (post backend closure)

## Identity

- Repo: `dropandresetmain-prog/qoder-atlas`
- **Active production integration branch:** `finish/a5-1-integration`
- **Backend substrate (accepted for UI integration REVIEW):** `36f87112de50ac7fd9467664bb62418bde524db3`
- Historical backend evidence/recovery branch (do not delete): `qoder/general-session-x3h3qj` @ same SHA
- Previous backend closure base: `fix/a5-backend-truth-closure` @ `c4680005f30338378c1d2e49830e8c35bb1ca6f7`
- Founder-QC baseline: `finish/a5-final-truth-repeat-freeze` @ `372a664041897ddb173aa12612307c759e060bc3`
- Planning reconciliation source (intent): `docs/a5-founder-qc-reconcile` @ `67034f2527eb16bf8912868129efab410ed75019`
- Accepted A4 execution baseline (FROZEN): `finish/a4-destination-hotel-robustness` @ `546adf210db8ead343ecdac22b410515665c176a`

Read `docs/work/A5_FOUNDER_QC_RECONCILIATION.md` for A5 sequence, scope lock, Lane A/B relationship, and founder-QC findings. Where older planning text conflicts with this ledger on **backend implementation status**, this file wins.

## Current phase

**A5.1 convergence — UI integration begins on `finish/a5-1-integration`.**

- A5.2 final physical repeat: **BLOCKED on integrated founder acceptance**
- A5.3 release gates/freeze: **BLOCKED on A5.2**

Do **not** claim A5.1 / A5.2 / A5 complete.

## Lane status

### Lane B — backend truth closure

Status: **IMPLEMENTATION COMPLETE FOR INTEGRATION REVIEW at `36f8711`**

Backend lineage retained on this branch:

`c468000` → `a7d9cb2` (CP2) → `9b551f3` → `352ea9f` (CP3) → `32faa94` (CP4) → `36f8711` (CP5)

| Checkpoint | Result |
|---|---|
| CP1 investigation + contract decisions | complete |
| CP2 FIX1 D2 monitoring + FIX2 connection classification | complete |
| CP3 FIX3 controlled evaluation clock | complete |
| CP4 FIX4 causal Qwen transport offer selection | complete |
| CP5 FIX6 fail-closed demo readiness preflight | complete |
| INV5 multi-subject progression | **Park for Later** (production cases single-subject; settledBasis untouched) |

Backend work is substrate for UI integration review. It does **not** close A5.1 alone.

### Lane A — visual-first UI redesign

Status: **ACTIVE in separate design chat** (integrate only after founder-accepted composition)

Sequence: information architecture → image mockups → founder visual QC → static HTML → founder HTML QC → **production integration on this branch**.

Preserve V7.2 and V5.6 as the graph systems. Surrounding Overview/Case composition may be redesigned.

Required product outcomes (from founder QC):

- Overview / Case graphs immediately dominant under header;
- simultaneous Sarah + Jordan stories visible in one product world;
- one selected incident may drive V7.2 focus (multi-centre graph not required);
- clear recommendation / decision / activity hierarchy;
- NEW SPEND separate from POTENTIAL DISPLACED-BOOKING LOSS;
- graph → Case drill-down;
- no walls of internal/UUID copy on primary surfaces.

## Still outstanding (do not mark done)

- [ ] production UI integration onto `finish/a5-1-integration` using `36f8711` backend/read-model truth
- [ ] demo readiness preflight against the real provisioned demo workspace
- [ ] live dual-hero founder Sarah + Jordan E2E on the integrated candidate
- [ ] A5.2 physical proof on one exact candidate SHA
- [ ] A5.3 gates / freeze

A5.1 closes only after accepted UI direction is integrated with this backend substrate **and** founder can click Sarah + Jordan through the integrated product without interpreting internals.

## A4 freeze (unchanged)

Do not reopen planner / continuation / authority / execution / provider architecture absent a demonstrated defect.

Path remains: `AI proposal → validation → deterministic viability → authority → executor → observe → state update`.

## Park

- mobile/traveller acceptance;
- healthy-trip request/composer;
- broad programme/hotel/admin expansion;
- broad immigration;
- transfer transactions;
- insurance claims;
- unrelated providers;
- extra scenarios;
- importer redesign;
- infrastructure/refactors;
- multi-centre V7.2 graph unless a real requirement appears;
- INV5 multi-subject progression (as above).

## Exact next step

**Integrate the founder-approved production UI target onto `finish/a5-1-integration`, using `36f8711` backend/read-model truth as the substrate.**

Backend code should change during UI integration only if the accepted UI reveals a genuine generic read-model gap.

---

## Backend closure evidence ledger (retained)

Detailed CP investigation notes and focused-proof evidence from the backend lane remain below for recovery. Do not rewrite historical evidence; do not treat this section as an open implementation checklist.

### CP2 — FIX1 (D2 monitorable) + FIX2 (connection classification)

- Contract `recoveryProgression.ts`: `failingStateMonitorable`; WAIT reason `failing_state_monitorable` before ESCALATE.
- Shared `classifyAssessmentConnection` preserves TIGHT vs IMPOSSIBLE; product amber only when `TIGHT && !separateBlockingFailure`.
- Focused pure + PG proofs green; anti-hardcoding clean at CP2 close.

### CP3 — FIX3 controlled evaluation clock

- Migration `0136_workspace_evaluation_clocks.sql`; `evaluationClock.ts`; boot injects controlled `now` into reassessment/lifecycle/planning.
- Harness advances CONTROLLED clock for clock-only stages. MUST-STAY-WALL sites untouched.
- Pure + PG proofs green.

### CP4 — FIX4 causal Qwen TRANSPORT offer selection

- Bounded `recovery.offer_selection` prefers real boardable offer keys within corridor cap; fail-closed; RC-6/authority untouched.
- Pure offer-selection + adjacent proposer proofs green.

### CP5 — FIX6 demo readiness preflight

- Read-only `runDemoReadinessPreflight` + CLI; fail-closed required checks.
- Pure + PG proofs green; anti-hardcoding clean.
- Live dual-hero rehearsal against a provisioned demo workspace remains an operator/integration step (not claimed done).
