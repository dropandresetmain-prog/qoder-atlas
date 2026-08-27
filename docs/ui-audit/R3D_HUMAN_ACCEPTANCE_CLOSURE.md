# R3D Human Acceptance Closure Matrix

**Status:** FIX REQUIRED — remediation in progress  
**Branch:** `rescue/r3d-live-product-convergence`  
**Base before R3D:** `704c05bbc51c2aefa55210ee26ebfa1a78f6d8c3`  
**Candidate under remediation:** `0782f76ce8738e76d71460e918eb4ed8c7b6784e`  
**Owner:** primary (Grok 4.6 High)  
**Date opened:** 27 Aug 2026  

Do not mark R3 accepted. Do not start R3E. Every R3D human issue below must be PASS or ACCEPT RISK before asking the owner to review again.

| ID | Surface | Human issue | Classification | Root cause | Planned fix | Browser evidence | Status |
|---|---|---|---|---|---|---|---|
| O1 | Overview | Borders/rings around small fleet squares | Act Now | TBD | Remove emphasis rings; consistent fleet geometry | pending | OPEN |
| O2 | Overview | No visually filled empty/unconfirmed squares | Act Now | TBD | Unconfirmed = filled neutral grey contribution cell | pending | OPEN |
| O3 | Overview | Blocks under Travellers broken/misplaced | Act Now | TBD | Rebuild from recovered Overview composition | pending | OPEN |
| O4 | Overview | Frontend state vocabulary must stay collapsed | Act Now | TBD | Confirmed / Needs Attention / Watching / Unconfirmed; Local separate | pending | OPEN |
| O5 | Overview | Fleet order must be earliest commitment first | Act Now | TBD | Commitment-time fleet sort; attention list may stay priority | pending | OPEN |
| O6 | Overview | Traveller/case list 10/page with search+pagination | Act Now | TBD | Page size 10; search+pagination coexist | pending | OPEN |
| P1 | Programme | Too many states / summary boxes | Act Now | TBD | Collapse to approved frontend vocabulary | pending | OPEN |
| P2 | Programme | Composition must follow recovered; bleeding | Act Now | TBD | Rebuild from recovered programme structure | pending | OPEN |
| P3 | Programme | Events/commitments repeated across entries | Act Now | TBD | Dedup programme commitments; travellers in affected/detail | pending | OPEN |
| P4 | Programme | Traveller table/cards bleeding | Act Now | TBD | Recovered-style table; no overflow | pending | OPEN |
| C1 | Case | Case pages hard to scan | Act Now | TBD | Restore recovered information hierarchy | pending | OPEN |
| C2 | Case | "Waiting on decision" looks like error popup | Act Now | TBD | Integrated recovered-style content block | pending | OPEN |
| C3 | Case | Trip Status icons too small | Act Now | TBD | Enlarge Trip Status icons now | pending | OPEN |
| C4 | Case | Trip Status shows vague "Unknown" | Act Now | TBD | Project truthful unknown detail or specific pending state | pending | OPEN |
| C5 | Case | Options are static | Act Now | TBD | Selectable primary recovery options | pending | OPEN |
| C6 | Case | No transition animation / Resolve choreography | Act Now | TBD | Resolve overlay ~3s + execution transition | pending | OPEN |
| C7 | Case | Do not use "Broken"; use Impacted | Act Now | TBD | Replace Broken with Impacted / specific language | pending | OPEN |
| J1 | Jonas/S5 | Waiting on decision visual wrong | Act Now | TBD | Shared recovered case composition | pending | OPEN |
| J2 | Jonas/S5 | Trip Status icons too small | Act Now | TBD | Shared Trip Status sizing | pending | OPEN |
| J3 | Jonas/S5 | Unknown in Trip Status | Act Now | TBD | Shared Unknown projection fix | pending | OPEN |
| J4 | Jonas/S5 | Case does not follow recovered structure | Act Now | TBD | Recovered state choreography | pending | OPEN |
| J5 | Jonas/S5 | Org charged ~SGD 302 despite personal extension | Act Now | TBD | Trace funding; fix allocation/projection/label or domain | pending | OPEN |
| J6 | Jonas/S5 | Cannot select among three options | Act Now | TBD | Interactive strategy selection | pending | OPEN |
| J7 | Jonas/S5 | Hotel metadata leaks place-hotel-id… | Act Now | TBD | Human hotel display name; never internal IDs | pending | OPEN |
| J8 | Jonas/S5 | Recommended looks expensive / unexplained | Act Now | TBD | Fix ranking generically or project Why recommended | pending | OPEN |
| OL1 | Oliver/S7 | Same global Case UI problems | Act Now | TBD | Shared Case state components | pending | OPEN |
| OL2 | Oliver/S7 | No approval button when human approval required | Act Now | TBD | Render Approve/Deny from authority state | pending | OPEN |
| OL3 | Oliver/S7 | If already authorised, do not request human approval | Act Now | TBD | Show Approved by policy / authorised to proceed | pending | OPEN |
| JO1 | Jordan/S2 | Do not say Broken; use Impacted | Act Now | TBD | Shared Broken→Impacted copy | pending | OPEN |
| JO2 | Jordan/S2 | Nothing meaningful to click beyond Case | Act Now | TBD | Full Resolve→options→approve→execute→recovered | pending | OPEN |
| S1 | Sarah/Programme Change | Programme Change still old production UI | Act Now | TBD | Recovered E1 NOW vs PROPOSED | pending | OPEN |
| S2 | Sarah/Programme Change | Cannot go beyond current Programme Change | Act Now | TBD | Full browser path Commit → fan-out | pending | OPEN |
| S3 | Sarah/S1→S3 | Sarah not in alerts after Reset | Act Now | TBD | Generic attention projection surfaces critical cases | pending | OPEN |
| A1 | Activity | Internal/system tags remain | Act Now | TBD | Humanize who/what/Northstar/changed; no raw enums | pending | OPEN |
| A2 | Activity | 20 entries per page + day grouping | Act Now | TBD | Page size 20; preserve day grouping | pending | OPEN |
| T1 | Traveller | Recovered-first concierge hierarchy | Act Now | TBD | Hero hierarchy, choice cards, payoff state | pending | OPEN |
| G1 | Global | Remove demo banner from normal product pages | Act Now | TBD | Keep Reset; remove judge-facing banner | pending | OPEN |
| G2 | Global | Case Resolve choreography A→B→C | Act Now | TBD | Impacted → Resolve overlay → options → exec → terminal | pending | OPEN |
| G3 | Global | Authority-correct buttons | Act Now | TBD | Human Approve only when required; else authorised state | pending | OPEN |
| G4 | Global | Primary options ≤3 + More options | Act Now | TBD | 1 Recommended + ≤2 Alternatives; extras collapsed | pending | OPEN |
| G5 | Global | User-contract browser tests for human complaints | Act Now | TBD | Add human-flow assertions listed in prompt | pending | OPEN |
| G6 | Breadth | S4/S6/S8 reach terminal recovered/loss/escalation | Act Now | TBD | No dead-end open planning screens | pending | OPEN |

## Notes

- Status values allowed: `OPEN` | `IN PROGRESS` | `PASS` | `ACCEPT RISK`
- Aesthetic micro-polish only may later be R3E; nothing in this matrix may be silently parked to R3E.
- Update this file as each issue closes with root cause, fix summary, and screenshot evidence path.
