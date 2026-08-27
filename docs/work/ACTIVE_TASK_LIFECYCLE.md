# ACTIVE_TASK_LIFECYCLE — NORTHSTAR hero lifecycle/state closure

**Owner:** lifecycle/state lane  
**Branch:** `final/lifecycle-state-closure`  
**Base:** `origin/main` at start of this task  
**Contracts:** `docs/DEMO_SCREEN_CHOREOGRAPHY.md`, `docs/DEMO_FINAL_IMPLEMENTATION_RECONCILIATION.md`

## Goal

Make Case CTA lifecycle, approval → execute → observe → resolved, persistence/reload, Overview terminal projection, and Sarah post-programme-change convergence authoritative and browser-provable. No hero-ID hardcoding in product logic.

## Not owned

- Jonas hotel-extension planner / same-property proposal
- Jordan/Oliver provider fixture/evidence choices
- Broad copy/visual polish, currency formatting, recovered-layout polish

## Checklist (check only after evidence)

- [ ] Approval is not recovery — Jordan/Oliver expose Execute after organiser approval
- [ ] Exclusive CTA lifecycle — Begin/Resolve never coexist with pending approval, Execute, executing, or resolved
- [ ] Begin/Resolve disappear once recovery has begun
- [ ] Resolved cases never resurrect unresolved CTAs on reload/reopen
- [ ] Resolved traveller projects Confirmed/green on Overview
- [ ] Unaffected Trip Status elements stay Confirmed; programme engagements are not `Not booked`
- [ ] Sarah S1→S3 same-trip resolved/Confirmed; no second Resolve CTA
- [ ] Deny/Decline does not execute
- [ ] Browser rehearsal asserts exact CTA sequence + terminal state + reload/reopen
- [ ] Focused tests, lifecycle/user-contract tests, four hero browser paths, typecheck, changed-path lint, build

## Root causes (diagnosed)

1. **CTA branch order:** `recoveryActionsInner` treats `options.length > 0` before `approval.state === 'APPROVED'`, so Execute is unreachable when strategies remain on the view.
2. **Presentation phase is client memory:** `data-case-phase` is `impacted` unless `resolution` exists; `sessionStorage` / `nsResolve` reveals Begin/options. Reload without that key resurrects Resolve.
3. **Sarah fan-out does not close the prior case:** `processSignal` always opens `case-${tripId}-${signal.id}`. `latestCaseFor` prefers any open case, so a now-`VIABLE` trip stays DISRUPTED with Resolve.
4. **Overview hides resolved case links:** `activeCaseId` omitted when RESOLVED, so reopen cannot show history; open DISRUPTED cases keep Needs Attention.
5. **Chain treats programme engagements as reservations:** `reservationState === 'NONE'` → `UNBOOKED` / `Not booked` for event commitments.

## Phase log

- Diagnosed contracts and code. Implementation next.
