# A5.1 founder QC runbook — Sarah + Jordan click-through

Status: **ready for founder E2E click-through** (REPLAY / controlled boundaries).  
Not A5.2 LIVE destructive acceptance.

## Base

- Branch: `fix/a5-backend-truth-closure` (from `finish/a5-final-truth-repeat-freeze` @ `372a664041897ddb173aa12612307c759e060bc3`)
- Physically accepted A4 product: `546adf210db8ead343ecdac22b410515665c176a`

## Shared boot

1. Use a stable demo PostgreSQL workspace (`PG_TARGET_WORKSPACE_ID`) with `NORTHSTAR_DEMO_DATASET_DIR` pointing at the AiT demo pack.
2. `ADAPTER_MODE=REPLAY` for founder QC (do not burn fresh destructive bookings). For **Jordan transactional RECORD** (sandbox capture, not production pay), use `npm run demo:record` — see `docs/work/JORDAN_FOUNDER_RECORD_PROFILE.md`.
3. Boot normal product: `npm run dev` (or built `npm start`) on the configured port.
4. Open Overview in the browser.

**One workspace holds both heroes.** Sarah and Jordan are both present after a single dataset provision. Do **not** demo-reset between Sarah and Jordan click-through — reset clears the whole world and is only for an initial healthy baseline.

Optional reset (healthy baseline, once):

```bash
curl -X POST http://localhost:8787/api/v2/demo/reset
```

(Only when demo reset is configured/open.)

### Approval prerequisites (Jordan composite recommendation)

Before expecting Approve to be clickable on a costed Jordan recommendation, provision sandbox spend envelopes and protected booking identities **before** disruption/planning (A4 lesson). Typical REPLAY blocker without that setup is `FRESH_PROVIDER_QUOTE_REQUIRED` or `BUDGET_UNAVAILABLE` / `EXECUTION_INPUTS_UNAVAILABLE` on `executionBlocker` — not a missing UI button. Use `scripts/provision-sandbox-execution-inputs.ts` with an explicit synthetic inputs file when rehearsing approval composition. Do not bypass safety gates.

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

**Leave Sarah’s Case in place** and continue to Jordan on the same Overview.

---

## Jordan — founder QC path (progressive delay)

### Progression control (generic / data-driven)

```bash
# List stages from progressive-delay-timeline.json
node --experimental-strip-types scripts/a5-founder-qc-progression.ts --list

# Reset cursor only (does not wipe Sarah / workspace)
node --experimental-strip-types scripts/a5-founder-qc-progression.ts --reset-cursor
node --experimental-strip-types scripts/a5-founder-qc-progression.ts --next   # D1 viable delay
node --experimental-strip-types scripts/a5-founder-qc-progression.ts --next   # D2 tight / Case opens / monitor — no replacement sell
node --experimental-strip-types scripts/a5-founder-qc-progression.ts --next   # D3 connection impossible / recovery actionable
```

Or jump:

```bash
node --experimental-strip-types scripts/a5-founder-qc-progression.ts --stage zg053_impossible
```

Clock-only overnight stages (`planningNow = 2026-09-29T21:30:00+09:00`) are printed by `--list` / exhausted `--next`; they are **not** auto-applied by inventing wall-clock. Planning for overnight-required must keep that synthetic clock — do not let wall-clock revive departed same-night inventory.

### Browser click-through

1. Healthy Overview / Jordan trip ready (Sarah may already show an active Case).
2. Apply D1 → connection still viable; Overview stays GREEN / ready; graph must **not** show definitive red failure.
3. Apply D2 → tight/at-risk; Overview **AMBER** (`AT_RISK` / CHECKING); Case may open for monitoring; connection relationship amber/watch (AFFECTED); delayed arrival CHANGED; **no** actionable replacement recommendation.
4. Apply D3 → Overview **RED** (`DISRUPTED`); unmistakable **FAILED** connection relationship; delayed arrival may remain CHANGED; recovery becomes actionable when planning completes.
5. Continue to missed-connection / same-night context as configured.
6. When a complete recommendation is present and sandbox inputs are provisioned: confirm approval composition (authority/budget) without burning A5.2 destructive bookings unless rehearsing that path.
7. For A5.1: stop before burning fresh destructive Atlas/Nuitée bookings unless explicitly rehearsing approval UX only. Final destructive LIVE/SANDBOX is **A5.2**.

---

## What A5.1 must prove for Min Htet

- Product is understandable without reading implementation internals.
- Both heroes are clickable end-to-end in a repeatable QC setup **without reset between them**.
- Graph truth and cost/property presentation are trustworthy enough to decide whether this is the candidate to record.

Do **not** claim A5 complete. Do **not** run full release gates until A5.2/A5.3.
