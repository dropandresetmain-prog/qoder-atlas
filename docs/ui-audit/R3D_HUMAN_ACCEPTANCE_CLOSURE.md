# R3D Human Acceptance Closure Matrix

**Status:** R3D HUMAN ACCEPTANCE CANDIDATE — awaiting owner verification  
**Branch:** `rescue/r3d-live-product-convergence`  
**Base before R3D:** `704c05bbc51c2aefa55210ee26ebfa1a78f6d8c3`  
**Prior failed candidate:** `0782f76ce8738e76d71460e918eb4ed8c7b6784e`  
**Final remediation SHA:** `69259ac2b9e4f17d4085dcaa88e1b6258debf74d`  
**Owner:** primary (Grok 4.6 High)  
**Date closed for owner review:** 27 Aug 2026  

Do not mark R3 accepted. Do not start R3E until owner verifies.

| ID | Surface | Human issue | Classification | Root cause | Planned fix | Browser evidence | Status |
|---|---|---|---|---|---|---|---|
| O1 | Overview | Borders/rings around fleet squares | Act Now | Inset `::before` hollow cells | Full-fill fleet cell backgrounds; no rings | `output/r3d-human-acceptance/overview-start.png` | PASS |
| O2 | Overview | Unconfirmed not filled grey | Act Now | Same inset treatment | `d-unconfirmed` solid neutral fill | overview-start + contracts | PASS |
| O3 | Overview | Travellers blocks broken/misplaced | Act Now | Readout overflow / min-width | Recovered readout grid + overflow containment | overview-start / overview-laptop | PASS |
| O4 | Overview | State vocabulary collapse | Act Now | Already mapped; preserved | Confirmed / Needs Attention / Watching / Unconfirmed; Local separate | overview-start | PASS |
| O5 | Overview | Fleet order earliest commitment | Act Now | Already implemented | Commitment-time fleet sort retained | contracts | PASS |
| O6 | Overview | 10/page + search/pagination | Act Now | Already implemented | Page size 10 retained | contracts | PASS |
| P1 | Programme | Too many summary boxes | Act Now | Already collapsed | Four buckets + Local | programme.png | PASS |
| P2 | Programme | Composition / bleeding | Act Now | Table/timeline structure | Recovered-style timeline + table | programme.png + ui-programme tests | PASS |
| P3 | Programme | Commitment duplication | Act Now | Timeline keyed per traveller segment | Dedup by commitment identity; affected travellers once | ui-programme dedup test | PASS |
| P4 | Programme | Traveller table bleeding | Act Now | Column overflow | Fixed columns / recovered-style table | ui-programme table test | PASS |
| C1 | Case | Hard to scan | Act Now | Production hierarchy | Recovered case grid + rail | case-impacted.png | PASS |
| C2 | Case | Waiting-on-decision looks like error | Act Now | Alert callout styling | Integrated `waiting-decision-block` | jonas-funding.png | PASS |
| C3 | Case | Trip Status icons too small | Act Now | 10px glyphs | 18px / 28px glyph chips | case-impacted.png | PASS |
| C4 | Case | Vague Unknown | Act Now | Generic UNKNOWN word | Contextual pending copy (flight/hotel/transfer) | case-impacted.png | PASS |
| C5 | Case | Options static | Act Now | Non-interactive cards | Selectable option cards + selected state | case-options.png | PASS |
| C6 | Case | No Resolve transition | Act Now | Missing choreography | ~3s Resolve overlay + exec transition | case-resolve-progress.png | PASS |
| C7 | Case | Broken wording | Act Now | CHAIN_LINK_STYLE word | Impacted | case-impacted.png | PASS |
| J1 | Jonas | Waiting block wrong | Act Now | Shared C2 | Waiting-decision block | jonas-funding.png | PASS |
| J2 | Jonas | Icons too small | Act Now | Shared C3 | Larger Trip Status icons | jonas-funding.png | PASS |
| J3 | Jonas | Unknown | Act Now | Shared C4 | Contextual pending | jonas-funding.png | PASS |
| J4 | Jonas | Not recovered structure | Act Now | Shared case base | Recovered choreography | jonas-options.png | PASS |
| J5 | Jonas | Org charged SGD 302 | Act Now | FX home restatement misread as org charge; allocation already TRAVELLER | Explicit traveller incremental funding callout; Approve traveller-funded label | jonas-funding.png; rehearsal traveller-approve | PASS |
| J6 | Jonas | Cannot select options | Act Now | Shared C5 | Selectable strategies | jonas-options.png | PASS |
| J7 | Jonas | place-hotel-id leak | Act Now | placeName fell back to id | Never leak internal place ids; Hotel fallback | jonasNoHotelId check | PASS |
| J8 | Jonas | Recommended unexplained / expensive | Act Now | Missing why copy | Why recommended projection from ranking rationale | jonas-options.png | PASS |
| OL1 | Oliver | Case UI problems | Act Now | Shared case | Shared components | oliver-authority.png | PASS |
| OL2 | Oliver | No approval when required | Act Now | HUMAN_AGENT dead-end / org path | Organiser Approve for HUMAN_AGENT when principal unambiguous | rehearsal organiser-approve S7 | PASS |
| OL3 | Oliver | Auto-authorised should not ask | Act Now | Banner path | Approved by policy banner when no human ask | contracts + authority banner | PASS |
| JO1 | Jordan | Broken wording | Act Now | Shared C7 | Impacted | case-impacted.png | PASS |
| JO2 | Jordan | Nothing to click | Act Now | Options shown early; HUMAN_AGENT no button | Resolve choreography + organiser Approve | rehearsal S2 full path | PASS |
| S1 | Sarah | Programme Change old UI | Act Now | Partial E1 | Now vs Proposed modal | sarah-programme-now-proposed.png | PASS |
| S2 | Sarah | Cannot go beyond Programme Change | Act Now | Preview/commit path | Commit mutates; continuity | sarah-after-commit.png; rehearsal | PASS |
| S3 | Sarah | Not in alerts after Reset | Act Now | Attention queue only approvals | Needs-attention queue includes disrupted open cases | sarah-alert.png; s1s3.sarah-in-attention | PASS |
| A1 | Activity | System tags | Act Now | Raw actors/enums | presentActivityActor + sanitizeActivityCopy | activity.png; contracts | PASS |
| A2 | Activity | 20/page + day grouping | Act Now | Already present | Retained | contracts | PASS |
| T1 | Traveller | Recovered-first | Act Now | Partial | Choice/recovered captures + existing traveller screens | traveller-*.png | PASS |
| G1 | Global | Demo banner | Act Now | Already off product pages | Confirmed absent | demoBannerAbsent | PASS |
| G2 | Global | Resolve A→B→C | Act Now | New choreography | Impacted → Resolve → options → approve → recovered | rehearsal PASS | PASS |
| G3 | Global | Authority-correct buttons | Act Now | HUMAN_AGENT gap | Organiser approve / traveller approve / policy banner | rehearsal | PASS |
| G4 | Global | ≤3 primary + More options | Act Now | Already capped | Retained | contracts | PASS |
| G5 | Global | User-contract tests | Act Now | Gaps | Expanded `test/r3d-user-contracts.test.ts` | 15/15 pass | PASS |
| G6 | Breadth | S4/S6/S8 terminal | Act Now | Rehearsal | Escalation/terminal paths | live-product-browser-rehearsal PASS | PASS |

## Gate evidence

- `node --experimental-strip-types --test test/r3d-user-contracts.test.ts test/ui-programme.test.ts` → 36 pass
- `node --experimental-strip-types scripts/live-product-browser-rehearsal.mjs` → LIVE PRODUCT REHEARSAL PASS
- Screenshots: `output/r3d-human-acceptance/`

## Explicit non-claims

- R3E HAS NOT STARTED
- NOT MERGED TO MAIN
- NOT DEPLOYED
- NOT owner-accepted yet — awaiting verification
