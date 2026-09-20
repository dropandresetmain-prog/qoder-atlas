# A5.1 founder QC runbook — Sarah + Jordan click-through

Status: **ready for founder E2E click-through** (REPLAY / controlled boundaries).  
Not A5.2 LIVE destructive acceptance.

## Base

- Branch: `finish/a5-final-truth-repeat-freeze`
- Start from docs reconcile: `30374c56308c92e6a8bdf7d79ccf260b48fbec03`
- Physically accepted A4 product: `546adf210db8ead343ecdac22b410515665c176a`

## Shared boot

1. Use a stable demo PostgreSQL workspace (`PG_TARGET_WORKSPACE_ID`) with `NORTHSTAR_DEMO_DATASET_DIR` pointing at the AiT demo pack.
2. `ADAPTER_MODE=REPLAY` for founder QC (do not burn fresh destructive bookings).
3. Boot normal product: `npm run dev` (or built `npm start`) on the configured port.
4. Open Overview in the browser.

Optional reset (healthy baseline):

```bash
curl -X POST http://localhost:8787/api/v2/demo/reset
```

(Only when demo reset is configured/open.)

---

## Sarah — founder QC path

Sarah already has accepted A2 LIVE programme recovery. For A5.1 QC:

1. Confirm Overview shows healthy/ready state for the summit population.
2. Apply the disclosed **Simulated airline update** from Overview (Sarah disruption control).
3. Open the Sarah Case from Needs attention / Open case.
4. Confirm V5.6 graph sits **above** secondary blocks; read What changed → graph → impact → recommendation.
5. Confirm recovery planning / provider-model activity is understandable; technical dumps stay behind disclosures.
6. Approve the programme recommendation when ready (programme-side execution — **no forced external flight purchase**).
7. Watch execution → reassessment → RESOLVED / recovered presentation.

If anything looks like implementation logs or UUID-heavy primary copy, note it; do not reopen planner architecture.

---

## Jordan — founder QC path (progressive delay)

### Progression control (generic / data-driven)

```bash
# List stages from progressive-delay-timeline.json
node --experimental-strip-types scripts/a5-founder-qc-progression.ts --list

# Reset cursor, then walk provider-event stages one at a time
node --experimental-strip-types scripts/a5-founder-qc-progression.ts --reset-cursor
node --experimental-strip-types scripts/a5-founder-qc-progression.ts --next   # D1 viable delay
node --experimental-strip-types scripts/a5-founder-qc-progression.ts --next   # D2 tight / Case opens
node --experimental-strip-types scripts/a5-founder-qc-progression.ts --next   # D3 connection impossible
```

Or jump:

```bash
node --experimental-strip-types scripts/a5-founder-qc-progression.ts --stage zg053_impossible
```

Clock-only overnight stages (`planningNow = 2026-09-29T21:30:00+09:00`) are printed by `--list` / exhausted `--next`; they are **not** auto-applied by inventing wall-clock. Planning for overnight-required must keep that synthetic clock — do not let wall-clock revive departed same-night inventory.

### Browser click-through

1. Healthy Overview / Jordan trip ready.
2. Apply D1 → connection still viable; graph must **not** show definitive red failure.
3. Apply D2 → tight/at-risk; Case opens; connection relationship amber/watch (AFFECTED), delayed arrival CHANGED.
4. Apply D3 → unmistakable **red FAILED** connection relationship in the causal story; delayed arrival may remain CHANGED (amber) as the operational breakpoint.
5. Continue to missed-connection / same-night context as configured.
6. When a complete recommendation is present: confirm **NEW SPEND** vs **POTENTIAL DISPLACED-BOOKING LOSS** are visually separate; hotel **property** label distinct from place context.
7. For A5.1: stop before burning fresh destructive Atlas/Nuitée bookings unless explicitly rehearsing approval UX only. Final destructive LIVE/SANDBOX is **A5.2**.

---

## What A5.1 must prove for Min Htet

- Product is understandable without reading implementation internals.
- Both heroes are clickable end-to-end in a repeatable QC setup.
- Graph truth and cost/property presentation are trustworthy enough to decide whether this is the candidate to record.

Do **not** claim A5 complete. Do **not** run full release gates until A5.2/A5.3.
