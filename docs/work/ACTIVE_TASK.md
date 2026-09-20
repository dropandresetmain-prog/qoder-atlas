# ACTIVE TASK — A5 CONVERGENCE AFTER FOUNDER E2E

## Identity

- Accepted A4 product: `finish/a4-destination-hotel-robustness @ 546adf210db8ead343ecdac22b410515665c176a`
- Founder-QC code baseline: `finish/a5-final-truth-repeat-freeze @ 372a664041897ddb173aa12612307c759e060bc3`
- Planning reconciliation: `docs/a5-founder-qc-reconcile`
- Current phase: **A5.1 convergence**
- A5.2 final physical repeat: **BLOCKED on integrated founder acceptance**
- A5.3 release gates/freeze: **BLOCKED on A5.2**

Read `docs/work/A5_FOUNDER_QC_RECONCILIATION.md` first.

## Current reality

Founder completed Sarah + Jordan click-through far enough to expose both presentation and backend-truth defects.

A4 execution architecture remains accepted and frozen. Do not reopen planner/continuation/authority/execution architecture absent a demonstrated defect.

## Lane A — visual-first UI redesign

Status: **ACTIVE in separate design chat**

Sequence:

1. information architecture;
2. image mockups;
3. founder visual QC;
4. static HTML prototypes;
5. founder HTML QC;
6. production integration only after acceptance.

Preserve V7.2 and V5.6 as the graph systems. Everything around them may be redesigned.

Required product outcomes:

- Overview graph immediately dominant under header;
- Case graph immediately dominant under header;
- simultaneous Sarah + Jordan stories visible in one product world;
- one selected incident may drive V7.2 focus; multiple graph blast centres are not required;
- clear recommendation/decision/activity hierarchy;
- NEW SPEND separate from POTENTIAL DISPLACED-BOOKING LOSS;
- graph -> Case drill-down;
- no walls of internal/UUID copy on primary surfaces.

## Lane B — backend truth closure

Status: **READY FOR IMPLEMENTATION on a separate branch from 372a664041897ddb173aa12612307c759e060bc3**

Act Now:

- [ ] D1 GREEN -> D2 AMBER -> D3 RED in authoritative Overview projection
- [ ] D3 focused graph exposes clear failed connection/breakpoint
- [ ] remove redundant focused connection edge if confirmed duplicate
- [ ] D2 monitoring/risk without premature actionable replacement recommendation
- [ ] reproduce exact Jordan approval blocker and fix the correct layer
- [ ] Sarah + Jordan coexist in one normal PostgreSQL workspace without product reset
- [ ] inspect/fix suspicious Sarah FAILED node/edge inheritance

No frontend redesign in this lane.

## Founder-QC evidence

See `docs/work/A5_1_FOUNDER_SARAH_QC_NOTES.md`.

Positive evidence already observed:

- Overview auto-updates without hard refresh;
- Sarah Active Change highlighting is understandable;
- graph motion is visually effective;
- LIVE Qwen evidence existed in the Sarah path.

## A5.1 integration acceptance

Do not close A5.1 when either lane finishes alone.

A5.1 closes only after:

- accepted image + HTML direction is integrated;
- backend truth closure is integrated;
- focused/adjacent tests are green;
- founder can click Sarah + Jordan through the integrated product without interpreting internals;
- approval/action state is understandable and genuinely actionable at the correct point.

## A5.2

After A5.1 founder acceptance, prove Sarah + Jordan on one exact candidate SHA.

Sarah: LIVE model/provider evidence + programme recovery + observation/reassessment + RESOLVED.

Jordan: fresh external baseline where required; full protected four-action path; final CURRENT/PASS + RESOLVED.

Unknown provider outcome -> reconcile, never blind redispatch.

## A5.3

Only after both hero proofs pass on the same SHA:

```bash
npm run typecheck
npm run build
npm run lint
npm test
npm run test:postgres
npm run test:migration
npm run gate:anti-hardcoding
```

Then normal PG boot smoke, final docs/evidence, exact diff/status/secrets check, push and freeze.

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
- multi-centre V7.2 graph unless a real requirement appears.

## Exact next planning step

Let the two A5.1 lanes run in parallel.

Planning owner should next reconcile their outputs, decide the production-integration order, then schedule one founder E2E on the integrated candidate before A5.2.
