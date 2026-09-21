# Operator Workspace V5 — CP6 physical acceptance evidence

- Branch: `ui/operator-workspace-v5`
- Correction SHA (activity rail): `edf62e97be11df1cc6b0c174d52744ed4ddede47`
- Runtime: `npm run dev` @ `http://localhost:8787` · workspace `b62c6b6b-4af1-4ea4-8314-588f119317d9` · `ADAPTER_MODE=REPLAY`
- Date: 2026-09-21

## Walk order

1. Demo reset → healthy baseline (Jordan READY/VIABLE).
2. Jordan D1 `delay_begins_connection_viable` → Overview items=0; Jordan READY/VIABLE (GREEN).
3. Jordan D2 `delay_increases_connection_at_risk` → Overview `summary.atRisk=1`; Jordan **AT_RISK** / AT_RISK; case opened.
4. Jordan D3 `zg053_impossible` → Overview `summary.disrupted=1`; Jordan **DISRUPTED** / NOT_VIABLE; Case AWAITING_AUTHORITY with recommendation.
5. Sarah simulated airline (`POST /api/v2/demo/provider-event/airline-rebooking`) **without** resetting Jordan → 2 open stories.

## Screenshots

| File | What |
|---|---|
| `01-overview-both-stories.png` | Overview V5 with Jordan + Sarah open; real activity rail |
| `03-jordan-d3-overview-red.png` | Jordan D3 red / Needs attention |
| `04-jordan-recommendation.png` | Jordan Case recommended recovery + decision rail |
| `05-sarah-recommendation.png` | Sarah Case recommended recovery + activity |

## D2 amber capture gap

D2 was verified live via Overview API (`status=AT_RISK`, `summary.atRisk=1`, case opened) before D3. A dedicated amber UI screenshot was not frozen before advancing to D3 (continuing the same workspace for coexistence). Treat as **evidence gap**, not a semantic regression: D2→D3 escalation is proven by API status change AT_RISK → DISRUPTED.

## Physical checks observed

- Event health default; All participants sibling tab with search/pagination
- Sticky right rail (`position: sticky; top: 86px`); 2 stories remain when focus changes
- Compact Northstar activity: 4 real rows + View log →
- No horizontal overflow at ~1920 CSS px viewport during check
- No left sidebar
- Recommendation visible; approval unavailable (REPLAY / no sandbox execution composed) does not hide trip failure

## Limitations recorded

- Mini activity feed refreshes via existing Overview HTML poll regions (no dedicated activity cursor poller).
- Sarah recorded recommendation title led with **Book replacement travel** (programme commitments shown as preserved). Programme-reschedule alternatives exist in Other options. No frontend Sarah branch.
- Consequential Approve/execute not exercised (execution not composed in REPLAY).
