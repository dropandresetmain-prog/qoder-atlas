# ACTIVE_TASK — final/hero-integration

**Branch:** `final/hero-integration`  
**Base:** `origin/main` @ `73c577b4956f9fc9045521adb787e83c9bb81887`  
**Lanes merged:**
1. `final/lifecycle-state-closure` (`d207238`)
2. `final/hero-business-truth` (`e06bd63`)

**Contracts:** `docs/DEMO_SCREEN_CHOREOGRAPHY.md`, `docs/DEMO_FINAL_IMPLEMENTATION_RECONCILIATION.md`

## Goal

Integrate the two completed NORTHSTAR closure lanes onto latest main without redesigning either lane. Resolve any conflicts using authoritative scenario/business truth and generic architecture.

## Merge result

- No content conflicts: lanes owned disjoint paths (lifecycle = CTA/state/persistence/projection; hero-truth = planner/fixtures/funding/topology/evidence).
- Hero-truth updates to `docs/DEMO_SCREEN_CHOREOGRAPHY.md` (Jonas Concorde `US$541.83` / `S$731.47`) retained as authoritative business truth.
- Lifecycle CTA/phase/persistence and Sarah same-trip reconciliation retained as authoritative state projection.

## Proof checklist

- [x] Jordan execute → observe → resolved/revisit — `final-demo-lifecycle-convergence` + `hero-lifecycle-rehearsal` + S2 acceptance REPLAY
- [x] Sarah S1→S3 same-trip terminal convergence — continuity + lifecycle + browser rehearsal + R2.3
- [x] Oliver Tokyo topology + preserved LHR return + execution/revisit — HTTP path: `preserveReturnDestination LHR`, `HND→SIN (direct)`, chain Tokyo Haneda inbound + SIN→LHR return, execute→RESOLVED→`case-phase-resolved`; browser reopen Confirmed
- [x] Jonas same Concorde extension + traveller funding + resolved/revisit — S5 acceptance: `incrementalPayer=TRAVELLER`, provider `USD 541.83`, case RESOLVED; browser reopen does not resurrect Resolve/Approve
- [x] Focused integration tests — 71 unit/HTTP + 19 authority/fanout + 3 R2.3 + 8 e2e
- [x] Hero browser rehearsal — 4/4 pass
- [x] Typecheck — pass
- [x] Build — pass

## Findings triage

| Finding | Class | Why |
|---------|-------|-----|
| S7 acceptance asserts `approval.requestedFrom === ORGANISATION` but runtime projects `HUMAN_AGENT` (approver remains ORGANISATION; UI already labels Approve as organiser) | Park for Later | Pre-existing on `main` @ `73c577b`; presentation/copy lane owns HUMAN_AGENT→organiser wording. Not introduced by this merge. Functional execute/revisit proven. |
| Oliver post-execute return/stay/commitment chain elements may still show `UNKNOWN` rather than Confirmed | Park for Later | Topology + LHR preservation + RESOLVED/VIABLE proven; trip-status paint polish is presentation lane. |

## Explicit non-goals

- Do not merge to main
- Do not redesign either lane
- Do not expand into presentation/copy/visual lanes

## Interface assumptions for the UI / presentation lane

| Surface | Contract to consume |
|---------|---------------------|
| Case phase | Prefer server `data-case-phase-*` / projected phase over `sessionStorage` |
| CTA exclusivity | Begin/Resolve never coexist with pending approval, Execute, executing, or resolved |
| Approved CTA | `Execute approved recovery` after organiser approval (options may still be present) |
| Overview reopen | Resolved travellers use `historyCaseId` / `case-history-link`; Confirmed/green |
| Hotel strategies | Same-property: `Extend stay at {name} through {YYYY-MM-DD} — {amount} {ccy}`; switches: `Switch stay to …` |
| Jonas money | Provider `USD 541.83` / policy `SGD 731.47`; `incrementalPayer: TRAVELLER`; no organiser approval |
| Flight strategies | Summaries include route + `(direct\|N stop(s))`; Oliver recommended is `HND→SIN (direct)` @ `US$143.62` / `S$193.89`; `US$163.98` is `HND→SGN→SIN (1 stop)` |
| ChangeRequest | optional `preserveReturnDestination: { system, value }` |
| Programme preview | `affected[].travellerNames: string[]` with `travellerIds` / `reasons` |
| Sarah blast radius | Exact set Elena Tan (`ait-draft-01`) + Sarah Lim (`ait-draft-14`) only |
| Authority projection | Flight money-moving may still be `requestedFrom: HUMAN_AGENT` with `approver.entityType: ORGANISATION`; UI already maps this to organiser Approve — copy lane should replace residual “Human agent” strings |
| Programme engagements | Chain projection uses Scheduled (not `Not booked`) for event commitments |
