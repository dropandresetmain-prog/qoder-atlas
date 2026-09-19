# R4 FRONTEND PARITY CONTRACT (frozen at R4-C0)

Baseline: legacy frontend at `20454aa7f16e18cf07eb1558481637f8a18f2d09` (minimum UX standard).
Truth source: current PostgreSQL v2 read models. Engine: current generalized recovery engine.
Graphs: Case = V5.6 (`docs/design/live-dependency-graph/`), Overview = V7.2 (`docs/design/event-overview-graph/`).
Decisions: PRESERVE / ADAPT_TO_GRAPH / IMPROVE / INTENTIONALLY_RETIRE.

Method: the legacy `operator-*` screens, `copy.ts`, `presentationState`, `caseLifecycle`, `case-view-model`,
`components` are pure presentation and still in the tree. R4 writes **adapters from v2 read models onto the
legacy view-model shapes** and renders with legacy-quality structure. No SQLite/RuntimeOrchestrator/legacy
state is restored. Legacy reference screenshots: recon evidence (scratchpad `legacy-*.png`), regenerable with
`node src/ui/preview.ts`.

## Shell / navigation
| Legacy | Current | R4 |
| --- | --- | --- |
| Top nav Overview/Programme/Decisions(count)/Activity | present, no count on case/incident/traveller pages | PRESERVE; pass event name + decision count on every page incl. Case, Incident, Traveller |
| `← Overview` back link on Case, "Back to Overview" on resolved | none | PRESERVE — Back on Case, Incident, Traveller; resolved CTA |
| Demo panel / demo banner | none in shell; reset refused | ADAPT: persistent **Reset demo** in shell on every operator page (demo/dev-gated) until founder says REMOVE IT |
| `/operator/cases/:id` clean URL | 302 to `/api/v2/cases/:id?format=html` | IMPROVE: serve case HTML in place |
| Loading/error panels | missing | PRESERVE |
| Case rows linked from Decisions/Programme/Activity | not linked | PRESERVE |

## Overview / Dashboard
| Legacy | Current | R4 |
| --- | --- | --- |
| Readout + four managed-travel buckets + fleet grid of all travellers | 5 raw tiles; queue REPLACES population when items>0 | PRESERVE buckets + population; **show "Needs attention" AND "All travellers" together**, de-duplicated by case |
| Roster search/pagination | missing | PRESERVE (bounded) |
| — | no event overview graph | ADAPT_TO_GRAPH: V7.2 Event Overview Graph from a bounded backend `eventOverview` projection (no browser inference) |
| Disrupted traveller visibly changes, others stay | others vanish | PRESERVE — acceptance gate |

## Case
| Legacy section | Current | R4 |
| --- | --- | --- |
| Header: traveller — event, status badge derived from evidence, updated time | raw lifecycle/UUID | PRESERVE; plain-language status; no refs |
| Lead callout ("what happened / waiting on a decision") | missing | PRESERVE |
| Whole-trip before/after, commitment rail | missing | ADAPT_TO_GRAPH: V5.6 graph replaces chain; before/after in Current/Original |
| "What this affects" list | missing/raw | PRESERVE (concrete commitments/people) |
| Selected recommendation (one dominant card) + collapsed "Other options considered" | all candidates dumped, repeated `Pass→Pass` rows | PRESERVE + IMPROVE: dominant recommended card (changes/who/why/cost/approver); alternatives + rejected in collapsed disclosure; UNCHANGED deltas summarised; technical evidence in secondary disclosure |
| "What you're approving" panel: funding split, Approve as X, Decline | strategy UUID + raw authority | PRESERVE; CTA e.g. "Recover <name>'s trip"; Decline retained |
| Staged plain-language activity ("Checking replacement flights ✓ …") | none | PRESERVE (real research/AI stages, no chain-of-thought) |
| Execution progress overlay | none | PRESERVE, truthful (no success before observation) |
| "What we checked" checklist | raw PASS/FAIL | PRESERVE (plain wording) |
| Resolved callout + Back to Overview | raw | PRESERVE; Current healthy only after reassessment, Original stays disruption |
| Escalate / traveller-approval guard / "Show interaction" | missing | PRESERVE escalate + traveller-approval guard where engine supports; interaction disclosure POST-R4 if no engine seam (recorded) |
| Progressive disclosure, page density | giant page | IMPROVE |

## Programme / Decisions / Activity / Traveller
| Legacy | Current | R4 |
| --- | --- | --- |
| Programme roster + timeline | schedule/preview raw rows | PRESERVE via adapter to legacy `ProgrammeView` (time-zone-safe) |
| Decisions list w/ plain reasons, links to case | raw refs, unlinked | PRESERVE via adapter to legacy `DecisionsPageView` |
| Activity with plain-language rows | actor UUIDs, enums | PRESERVE via adapter; safe labels for actors/refs |
| `/traveller` route + choice screen | current trip page not in shell | PRESERVE (shell, plain language); traveller choice flow ADAPT where engine supports |

## Language boundary
`FORBIDDEN_UI_TERMS` (copy.ts) is extended with raw-enum and UUID regex checks and enforced on **product-* renderer output** (visible text only; data-* exempt). Technical detail only behind a "Technical details" disclosure.

## Interaction architecture
* Polling remains, but NEVER replaces `<main>`; region patching only when the projection revision changed (guard on `projectionRevision`, not the xmin cursor).
* Graph runtime survives polls: camera/selection/view/tab/open details/scroll preserved; auto-fit only on first render and Home.
* Recover/Approve/Decline/Reset use document-level delegation, honest disabled/progress/error states, idempotent.

## Retirement
INTENTIONALLY_RETIRE: legacy commitment "chain" rail as the causal visual (superseded by V5.6 graph; ordering/labels adapted); legacy `/demo` deep-link panel in favour of the shell Reset control. Nothing else retired.

## Deferred (recorded, sequenced in ROADMAP at final)
Google Routes, Nuitée, Frankfurter, general change intake, programme-change parity, Activity extras: classified in the backend gap report; not silently dropped.
