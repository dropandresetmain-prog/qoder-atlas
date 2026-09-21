# Operator Workspace V5 — Physical Convergence Evidence

Rejected prior CP6 PARTIAL. This package records the physical convergence pass
against the approved V5 references.

## Workspace

- Branch: `ui/operator-workspace-v5`
- Demo workspace: `b62c6b6b-4af1-4ea4-8314-588f119317d9`
- Jordan case: `8344fcd3-5d11-584d-9e3a-7bb07127b285`
- Sarah case: `d4ff8d2d-10ec-57cd-822b-e38cceb2c238`

## Screenshots (~1440×900)

| # | File | Capture |
|---|---|---|
| 1 | `01-overview-event-health-1440.png` | Event health; Sarah + Jordan open; focus label agrees with graph pill |
| 2 | `02-overview-all-participants-1440.png` | All participants; focus control hidden |
| 3 | `03-jordan-d2-amber-1440.png` | Jordan D2; Arrival timing CHANGED/amber; onward ZG healthy |
| 4 | `04-jordan-d3-red-1440.png` | Jordan D3; Arrival timing FAILED/red; causal edges alert |
| 5 | `05-jordan-recommendation-1440.png` | Jordan recommendation workspace + sticky rail |
| 6 | `06-sarah-recommendation-1440.png` | Sarah Case; rail beside graph; travel-led recommendation |

## Sarah recovery investigation (ACT NOW — planner)

Selected recommendation ref `2150e35f-01ed-5093-8c42-2e0fbb8bc789` is option **5**
`SELECT_OFFER` / domain **TRANSPORT** (“Book replacement travel”).

Viable programme alternatives exist:

- options **7–8** `CHANGE_PROGRAMME_ITEM_TIME` on “Headline Interview: Aviation After Automation”
- candidate disposition `VIABLE_NOT_RECOMMENDED` / domain **PROGRAMME**

Basis: `selected among viable candidates: 0 regression(s), 1 improvement(s), blast radius 3`.

This is planner/comparator selection, not a frontend copy bug. Do not frontend-relabel.
