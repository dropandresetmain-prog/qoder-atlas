# A5.1 founder QC runbook — Sarah + Jordan click-through

Status: **CP5 browser acceptance PASS** against the **canonical Jordan clean-room corpus**.  
Not A5.2 LIVE destructive acceptance (CP6).

## Canonical recording corpus (required)

| Role | Path |
| --- | --- |
| **CANONICAL (use this)** | `recordings/jordan-corpus-2026-09-23/` |
| Marker | `.corpus-isolated` — runtime reads **only** this directory (no fixtures/scenario fallback) |
| Manifest | `recordings/jordan-corpus-2026-09-23/MANIFEST.json` |
| **QUARANTINED / NON-CANONICAL** | `recordings-quarantine/pre-2026-09-23-jordan-reset/` + `docs/work/JORDAN_RECORDINGS_QUARANTINE_MANIFEST.json` |

Confirm the corpus is active:

```bash
# .env.local (never commit secrets)
RECORDINGS_DIR=recordings/jordan-corpus-2026-09-23
ADAPTER_MODE=REPLAY
```

Boot log must show `mode=REPLAY` for transport and hotel research. If `RECORDINGS_DIR` points at legacy `recordings/` or fixtures, stop — that world is contaminated.

Jordan transactional RECORD (sandbox capture) uses `npm run demo:record` — see `docs/work/JORDAN_FOUNDER_RECORD_PROFILE.md`.

## Base

- Branch: `fix/a5-jordan-transaction-recording` (clean-room corpus freeze)
- Physically accepted A4 product: `546adf210db8ead343ecdac22b410515665c176a`

## Shared boot

1. PostgreSQL demo workspace (`PG_TARGET_WORKSPACE_ID`) with `NORTHSTAR_DEMO_DATASET_DIR` → AiT demo pack.
2. `RECORDINGS_DIR=recordings/jordan-corpus-2026-09-23` and `ADAPTER_MODE=REPLAY` for founder QC.
3. `NORTHSTAR_DEMO_CONTROLS_FILE=data/ait-demo-input-pack/demo-controls.json` so Jordan D1/D2/D3 controls appear.
4. Boot: `npm run dev` on the configured port.
5. Open Overview in the browser.

**One workspace holds both heroes.** Do **not** demo-reset between Sarah and Jordan.

Optional reset (healthy baseline, once — wipes Sarah and Jordan progression):

```bash
curl -X POST http://localhost:8787/api/v2/demo/reset
```

### Jordan provider stay baseline (mandatory before progression)

Current architecture does **not** bootstrap the provider stay on boot/reset.

```bash
curl -X POST http://localhost:8787/api/v2/demo/provider-baseline
```

Expect `ok: true`, `status: ATTACHED` (or `ALREADY_ATTACHED`), a **fresh** sandbox booking id (not historical `z-xdzAxcv`), and provider `bookedTotal` / cancellation terms. REPLAY uses the canonical corpus (`booking_lookup` + `stay_context`).

### Approval prerequisites (Jordan composite recommendation)

Before expecting Approve to be clickable, provision sandbox spend envelopes when rehearsing approval (`scripts/provision-sandbox-execution-inputs.ts`). Typical REPLAY blocker without that setup is `FRESH_PROVIDER_QUOTE_REQUIRED` / `BUDGET_UNAVAILABLE`. Do not bypass safety gates.

---

## Sarah — founder QC path

(Unchanged.) Confirm healthy Overview → Simulated airline update → Case → Approve programme recommendation when ready. **Leave Sarah’s Case in place** and continue to Jordan.

---

## Jordan — founder QC path (progressive delay)

### 0. Provider baseline (above) — then healthy Overview / Jordan READY.

### Progression control (generic / data-driven)

Demo Console HTTP (same seams as the product UI):

```bash
curl -X POST http://localhost:8787/api/v2/demo/controls/delay_begins_connection_viable/apply
curl -X POST http://localhost:8787/api/v2/demo/controls/delay_increases_connection_at_risk/apply
curl -X POST http://localhost:8787/api/v2/demo/controls/zg053_impossible/apply
```

Or the harness (requires `PG_TARGET_*` env loaded):

```bash
node --experimental-strip-types scripts/a5-founder-qc-progression.ts --list
node --experimental-strip-types scripts/a5-founder-qc-progression.ts --reset-cursor
node --experimental-strip-types scripts/a5-founder-qc-progression.ts --next   # D1
node --experimental-strip-types scripts/a5-founder-qc-progression.ts --next   # D2
node --experimental-strip-types scripts/a5-founder-qc-progression.ts --next   # D3
```

### Browser click-through

1. Healthy Overview / Jordan trip ready (after provider-baseline).
2. D1 → connection still viable; Overview GREEN / ready.
3. D2 → tight/at-risk; Overview **AMBER**; no actionable replacement.
4. D3 → Overview **RED**; connection FAILED; recovery planning → Path A recommended; Path B rejected (`original_stay_late_arrival_survival_unknown`).
5. For A5.1: stop before burning fresh destructive Atlas/Nuitée bookings unless rehearsing approval UX. Final destructive path is **A5.2 / CP6**.

Clock-only overnight stages use the scenario synthetic evaluation clock — do not substitute wall clock.

---

## What A5.1 must prove for Min Htet

- Product is understandable without reading implementation internals.
- Both heroes are clickable end-to-end **without reset between them**.
- Graph truth and cost/property presentation are trustworthy enough to decide whether this is the candidate to record.

Do **not** claim A5 complete. Do **not** run full release gates until A5.2/A5.3.
