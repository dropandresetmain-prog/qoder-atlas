# ACTIVE_TASK_HERO_FIXES — close FINAL HERO acceptance failures

**Branch:** `final/hero-acceptance-fixes`  
**Base SHA:** `779f9691264ded8294ec708917c0e607f247cff7`  
**Contracts:** `docs/DEMO_SCREEN_CHOREOGRAPHY.md`, `docs/DEMO_FINAL_IMPLEMENTATION_RECONCILIATION.md`  
**Acceptance evidence:** `output/hero-acceptance/live/` + `docs/work/ACTIVE_TASK_ACCEPTANCE.md` on `cursor/hero-acceptance-599e`  
**Scope:** bounded presentation/lifecycle/copy fixes only. No architecture or scenario redesign.

## Gate rule

Do not ask for human review until every Act Now REC below is browser-proven on this branch. Checklist PASS requires screenshot evidence under `output/hero-acceptance/fixes/`.

## Jonas cost investigation (required)

| Candidate | Amount | Source |
|---|---|---|
| Prior reconciliation example | US$223.94 / S$302.32 | Different room SKU (Standard Queen) / older book-retrieve path |
| Live acceptance + choreography §9 | US$541.83 / S$731.47 | Nuitée REPLAY search Deluxe Plus same-property Concorde rate |

**Root cause:** legitimate current REPLAY price for the selected same-property Concorde Deluxe Plus offer — not FX mistake, not funding-allocation mistake. US$223.94 is a different inventory SKU in the same corpus.

**Authoritative display:** **US$541.83 payable** / **Approx. S$731.47 policy equivalent**, consistent on Case, Traveller, CTA, funding, history.

## Checklist

| ID | Status | Evidence |
|---|---|---|
| REC-2-trip-status | PASS (unit+rehearsal) | `chain.ts` linkState; unaffected Confirmed |
| REC-2-programme-engagement | PASS (unit+rehearsal) | Scheduled/At risk/Preserved; no DETAILS PENDING |
| REC-5-observe-update-visible | PASS (rehearsal) | lifecycle overlay on execute/commit |
| REC-7-shared-incident | PASS (rehearsal) | shared-incident-group on Overview |
| REC-7-iso-prefill | PASS (rehearsal) | human 15:30/16:00 prefilled; ISO in data-* |
| REC-7-named-distinct-blast | PASS (rehearsal) | distinct reasons; no el-trip; Sarah Viable |
| REC-9-operator-cannot-approve-jonas | PASS (rehearsal) | Waiting for Jonas; no traveller-decision form |
| REC-9-traveller-exact-mutation | PASS (rehearsal) | Concorde / 4 Oct / Extend copy |
| REC-4-contradictory-checks | PASS (unit+rehearsal) | presentCheckLabel FAIL rewrite |
| REC-3-cta-currency | PASS (unit+rehearsal) | Approve as organiser US$… |
| REC-3-options-hidden-until-plan | PASS (rehearsal) | options hidden in options phase |
| REC-10-overview-76 | PASS (rehearsal) | participants footer; no 76 travellers |
| REC-8-declared-gateway | PASS (rehearsal) | fly from HND |
| REC-4-raw-ids-iso | PASS (rehearsal) | sanitized IDs/ISO |
| REC-2-browser-rehearsal-truth | PASS | strengthened hero-lifecycle-rehearsal 5/5 |

## Preserve (do not regress)

- Jordan Approve → Execute → recovered → revisit
- Sarah programme commit → same trip viable/resolved
- Oliver Tokyo inbound + LHR return retained
- Jonas same Concorde extension + traveller authority + resolved persistence
- dusk traveller hero; 67/42/25 fleet header; Oliver 1-stop US$163.98; no HUMAN_AGENT; no demo banner

## Boundaries

No scenario/person-specific branches in generic domain/UI logic. Use structured presentation data. No merge to main. No self-certify final acceptance.

## Gates run

- `npm run typecheck` PASS
- `npm run lint` PASS
- `npm run build` PASS
- focused unit tests PASS
- `test/e2e/hero-lifecycle-rehearsal.test.ts` 5/5 PASS
