# R4 final acceptance — open findings dispositions (2026-09-20)

Physical Sarah programme path (exact `Recover Sarah's trip`) and prior transport sandbox path are green. Dispositions below close the handoff open list without silent drop.

## 1. Demo dataset: no booking identities / organiser travel budget — PARK

**Decision:** Park. Do **not** add synthetic legal names, gender/DOB/email or organiser budget into `fixtures/programmes/ait-summit-2026/programme.json` for R4 acceptance.

**Why:** That change would rewrite the dataset content hash, force a fresh DB for every environment, and churn hash-dependent tests. Costed transport options remain truthfully blocked with `EXECUTION_INPUTS_UNAVAILABLE` / `BUDGET_UNAVAILABLE` until inputs exist.

**Proven workaround (transport vertical):** operator commands already used in the browser transport proof — `addTravellerName`, `recordTravellerBookingIdentity`, `createBudget` — on local DB only. F4a presenter headlines an executable option when one exists.

**Revisit when:** an organiser entry surface for booking identities + travel budget ships (or an explicit product decision to ship synthetic demo identities with a hash bump).

## 2. Replan loop / `PLAN_PERSIST_FAILED: SERIALIZATION_RETRY_EXHAUSTED` — PARK

**Decision:** Park with evidence from the normal Sarah programme flow.

**Evidence:** On LIVE boot (`r4final`, port 4110), cases `658e73dc-…` and `521d1e3b-…` progressed `PLANNED → EXECUTED → RESOLVED` without any `PLAN_PERSIST_FAILED` or `SERIALIZATION_RETRY_EXHAUSTED` lines in `docs/work/r4-evidence/boot-sarah.log`. Strategies did not double during these runs.

**Prior occurrence:** Hand-off noted doubling 8→16 after a mid-run budget injection on case `98fd643c` — operator-induced replan race, not reproduced on the clean Reset→disrupt→Recover path.

**Revisit when:** the failure recurs without mid-run command injection, with a reproducible log excerpt.

## 3. Transport option card missing flight/time/price — FIXED

**Decision:** Fixed at presentation layer (`caseWorkspacePresenter.ts` + copy). SELECT_OFFER titles use disrupted transport labels from the case graph when the journey-item subject label is a typed ref; option/approval cost uses strategy-scoped action costs when present.

**Proof:** `node --test test/r4-f1-ui-language.test.ts` — 30/30 including `R4 transport option cards: leg label and strategy-scoped cost`.

## 4. Minor UI leftovers — PARK / Accept Risk

| Item | Disposition |
| --- | --- |
| Recovered graph service node still `Unknown / unconfirmed` | Park — R3 carry-forward; UNKNOWN is valid; not an R4 blocker when trip is CURRENT+PASS. |
| Overview Sarah row keeps “booked service was cancelled…” after recovery | Park — truthful change history; status is Confirmed/Viable (shot `45-overview-sarah-confirmed.png`, 52/67, Nobody needs attention). |
| “Back to Overview” / Overview nav lands on `/api/v2/operator/overview?format=html` | Accept Risk — `/` and `/operator` both 302 to that HTML surface; it is the product overview (same shell). |
| Apply control inside collapsed “Simulated airline update” `<details>` | Intentional for the demo — confirmed; expand summary then Apply. |

## 5. Screenshots

`docs/work/r4-evidence/shots/` remains **untracked** (binaries). Paths referenced in ACTIVE_TASK / final report. Commit deliberately only if promotion wants a few selected stills.
