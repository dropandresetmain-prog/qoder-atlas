# ACTIVE_TASK_LIFECYCLE — NORTHSTAR hero lifecycle/state closure

**Owner:** lifecycle/state lane  
**Branch:** `final/lifecycle-state-closure`  
**Base:** `origin/main` `73c577b`  
**Contracts:** `docs/DEMO_SCREEN_CHOREOGRAPHY.md`, `docs/DEMO_FINAL_IMPLEMENTATION_RECONCILIATION.md`

## Goal

Make Case CTA lifecycle, approval → execute → observe → resolved, persistence/reload, Overview terminal projection, and Sarah post-programme-change convergence authoritative and browser-provable. No hero-ID hardcoding in product logic.

## Not owned

- Jonas hotel-extension planner / same-property proposal
- Jordan/Oliver provider fixture/evidence choices
- Broad copy/visual polish, currency formatting, recovered-layout polish

## Checklist (check only after evidence)

- [x] Approval is not recovery — Jordan/Oliver expose Execute after organiser approval
- [x] Exclusive CTA lifecycle — Begin/Resolve never coexist with pending approval, Execute, executing, or resolved
- [x] Begin/Resolve disappear once recovery has begun
- [x] Resolved cases never resurrect unresolved CTAs on reload/reopen
- [x] Resolved traveller projects Confirmed/green on Overview
- [x] Unaffected Trip Status elements stay Confirmed; programme engagements are not `Not booked`
- [x] Sarah S1→S3 same-trip resolved/Confirmed; no second Resolve CTA
- [x] Deny/Decline does not execute
- [x] Browser rehearsal asserts exact CTA sequence + terminal state + reload/reopen
- [x] Focused tests, lifecycle/user-contract tests, four hero browser paths, typecheck, changed-path lint, build

## Root causes (diagnosed)

1. **CTA branch order:** `recoveryActionsInner` treated `options.length > 0` before `approval.state === 'APPROVED'`, so Execute was unreachable when strategies remained on the view.
2. **Presentation phase was client memory:** `data-case-phase` was `impacted` unless `resolution` existed; `sessionStorage` / `nsResolve` revealed Begin/options. Reload without that key resurrected Resolve.
3. **Sarah fan-out did not close the prior case:** `processSignal` always opened `case-${tripId}-${signal.id}`. `latestCaseFor` preferred any open case, so a now-`VIABLE` trip stayed DISRUPTED with Resolve.
4. **Overview hid resolved case links:** `activeCaseId` omitted when RESOLVED, so reopen could not show history.
5. **Chain treated programme engagements as reservations:** `reservationState === 'NONE'` → `UNBOOKED` / `Not booked` for event commitments.

## Evidence

- `node --experimental-strip-types --test test/case-lifecycle-state.test.ts test/domain.test.ts test/r3d-user-contracts.test.ts` → 36 pass
- `test/a4-case-authority.test.ts` + `test/wave3-case-c-commitment-fanout.test.ts` → 19 pass (Case C still opens brand-new cases)
- `test/final-demo-s1-s3-continuity.test.ts` → 2 pass
- `test/final-demo-lifecycle-convergence.test.ts` → 4 pass (Jordan Execute/resolve/reload, Decline no execute, Oliver Execute/Confirmed, Sarah commit → RESOLVED)
- `test/e2e/operator-clickthrough.test.ts` → 4 pass
- `test/e2e/hero-lifecycle-rehearsal.test.ts` → 4 pass (Jordan, Oliver, Sarah, Jonas)
- `npm run typecheck` pass
- changed-path eslint pass
- `npm run build` pass

## Lane C note

Jonas was not owned. In this environment the existing traveller-approval/execute path still reached `resolved` + Overview Confirmed; same-property planner work was not changed.

## Phase log

- Diagnosed contracts and code.
- Implemented server-projected phase, restoration transitions, prior-open reconciliation, engagement chain semantics, Overview history link.
- Verified HTTP + four-hero browser paths. Ready to hand off.
