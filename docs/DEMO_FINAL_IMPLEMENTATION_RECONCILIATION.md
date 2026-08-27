# NORTHSTAR final hero implementation reconciliation

**Status:** implementation checklist after choreography + owner visual review  
**Branch:** `rescue/demo-screen-choreography-recovery`  
**Primary choreography contract:** `docs/DEMO_SCREEN_CHOREOGRAPHY.md`  
**Purpose:** reconcile the choreography contract with the owner's latest production review and the earlier R3D matrix-truth audit. Where prior closure rows said PASS but current screenshots/runtime contradict them, this document reopens the issue.

This is not a new scenario source of truth and does not reopen architecture. It is the final implementation/rehearsal checklist connecting the existing hero choreography to current visible defects.

## 1. Gate rule

Do not ask the owner for another full clickthrough until every **Act Now** item below is browser-proven on the exact candidate SHA. A prior matrix PASS is not evidence if current screenshots or production behavior contradict it.

Use `docs/DEMO_SCREEN_CHOREOGRAPHY.md` for the intended screen sequence. Use authoritative runtime/read-model/domain truth for state. Recovered UI is the structural visual baseline; static recovered facts are never product truth.

## 2. Act Now — shared lifecycle and state truth

- [ ] **Approval is not recovery.** Jordan and Oliver must visibly continue from approval to `Execute approved recovery`, provider-boundary execution, observation, authoritative state update, and terminal recovered state.
- [ ] **CTA lifecycle is exclusive.** `Begin recovery` / `Resolve with Northstar AI` disappears immediately once recovery has begun and never coexists with pending approval, approved Execute, executing, observing, or resolved state.
- [ ] **Resolved persistence is authoritative.** Reload/direct reopen cannot resurrect unresolved state. Case, Traveller, Overview and history agree after resolution.
- [ ] **Overview terminal projection.** A traveller who becomes resolved/viable moves from Needs Attention/red to Confirmed/green; they do not disappear or become Watching unless authoritative state actually says so.
- [ ] **Trip Status semantics.** Unaffected/known-good trip elements remain Confirmed. Only the element genuinely impacted/unknown/pending is shown as such. Do not paint unrelated known elements Pending or Unknown.
- [ ] **Programme engagement semantics.** Event commitments use programme language such as Scheduled / At risk / Preserved / Confirmed, not `NOT BOOKED` merely because they are not supplier reservations.
- [ ] **Browser rehearsal truth.** Hero tests assert exact CTA sequence, execution/commit receipt, observed authoritative values, terminal topology/stay/programme state, then reload/reopen. Generic terminal words/CSS cannot false-pass.
- [ ] **Deny/decline path remains real.** Where a human decision is required, the negative action is present and does not execute the staged change.

## 3. Act Now — shared option and financial presentation

- [ ] **One currency convention everywhere.** No bare `$`. Use one consistent primary display convention across Overview/Case/Traveller/Programme/Activity where money appears. Preferred UI convention: `US$90.54`, `S$122.23`; detailed breakdowns may additionally show `USD` / `SGD` labels.
- [ ] **Provider payable vs home-policy equivalent are distinct.** Example: `US$223.94 payable` and `Approx. S$302.32 policy equivalent`; never make them look like two separate charges.
- [ ] **Payer is explicit beside the amount and action.** For Jonas, state plainly that Jonas pays the personal increment and the organiser incurs no new cost.
- [ ] **Each primary option has decision content.** At most three primary options; each shows route/stay identity, timing, pros, cons/uncertainties, commitment effect, payable cost, payer, authority, provenance, and why it is or is not recommended.
- [ ] **Recommendation is defensible, not merely labelled.** The selected recommendation must be visibly better on the factors the engine actually ranks (viability, disruption, policy, timing, funding, etc.). If that cannot be defended from evidence, fix the ranking/projection rather than adding generic `Why recommended` copy.
- [ ] **Options stay hidden until the appropriate planning/reasoning stage.** Do not leak the exact recommended answer in `What Northstar is doing right now` before the user initiates the analysis unless the product explicitly frames it as already-planned state.

## 4. Act Now — natural-language content pass

Perform a page-by-page writing pass on all hero surfaces.

- [ ] Remove internal/process language where a normal organiser/traveller phrase exists.
- [ ] Replace `Human agent review needed` / `Approval needed from a human agent` with the actual principal: e.g. `Organisation approval required`, `AiT organising team decides`, or `Traveller approval required`.
- [ ] Remove contradictory checks such as `No longer meets: timing still works`.
- [ ] State deterministic checks in human terms with numbers where useful, e.g. `370 min available / 360 min required — viable`.
- [ ] Remove raw IDs, enum names, system tags, raw ISO timestamps, placeholder location IDs and duplicate generic impact reasons.
- [ ] Programme/case/traveller copy should answer what changed, what matters, what Northstar is doing, what the user must decide, and what remains uncertain.
- [ ] Activity visible in hero flows contains human-facing actor/action wording; if full Activity cleanup is deferred, do not feature Activity in the final video.

## 5. Act Now — explanatory progress / animation

The product needs to show Northstar's differentiated reasoning, not decorative AI theatre.

- [ ] Use the generic structured transition/progress model from `DEMO_SCREEN_CHOREOGRAPHY.md`; content differs by case but component/logic is generic.
- [ ] Planning screens visibly expose the relevant reasoning dimensions: dependencies, provider evidence, event viability, stay implications, funding, policy and authority as applicable.
- [ ] Execution is visually separate from planning and approval.
- [ ] Observation/state-update phase is visible after the external boundary so the judge sees `execute → observe → update graph → recheck trip`.
- [ ] Timing may be presentation-smoothed for demo readability, but do not narrate timer-driven progress as a literal live trace of tool execution.
- [ ] Preserve reduced-motion support and do not hardcode hero/person IDs into the component.

## 6. Jordan S2 — golden path

- [ ] Needs Attention Case clearly shows missed/impossible NRT→SIN and the Finals Showcase consequence.
- [ ] Do not falsely call the current reported viable TR885-class reprotection inadequate. If the stronger inadequate-provider story is retained, supply an honest labelled external fixture/presentation seam first.
- [ ] Recommended option visibly shows `08:20 NRT→SIN`, arrival `14:35`, showcase `20:45`, `370 min available / 360 min required`, cost, payer, authority and REPLAY provenance.
- [ ] Organiser approval leads to **Execute**, not directly to a pseudo-terminal state.
- [ ] Execution/observation updates the trip; NRT→SIN is no longer shown Impacted after successful observed recovery.
- [ ] Terminal Case is resolved, no `OPTIONS ON THE TABLE`, no Begin/Resolve CTA, no stale approval.
- [ ] Overview turns Jordan Confirmed/green and revisit preserves the recovered state.

## 7. Sarah S1→S3 — golden path, no reset

- [ ] Initial shared incident is visible as one source event with differentiated consequences; Sarah is naturally discoverable without search.
- [ ] Population truth is consistent everywhere: `67 participants = 42 Northstar-managed + 25 local/self-managed`; no `76 travellers`, no `67 managed arrivals`.
- [ ] Travel-first evidence is truthful: either demonstrate actual evidence/REPLAY for why travel cannot protect the current headline or soften the claim.
- [ ] Programme preview uses human times `09:20–09:50 → 15:30–16:00`, not raw ISO as primary UI.
- [ ] Preview shows named/distinct affected people and reasons; no duplicate generic `commitment rescheduled` rows. Units are consistent (`participants` vs `trips`).
- [ ] Commit screen visibly shows programme update → fan-out → same Sarah trip re-evaluation.
- [ ] After commit, Sarah is no longer Needs Attention and no second Resolve CTA remains.
- [ ] Terminal Case/Programme/Overview all agree: 15:30 commitment, same trip viable/resolved, no new flight purchase, Confirmed/green on revisit.

## 8. Oliver S7 — golden path

- [ ] Current topology clearly shows London inbound and preserved SIN→LHR return intent before change.
- [ ] Proposed topology clearly shows HND/NRT→SIN replacing obsolete London inbound while preserving the return.
- [ ] Recommended option names actual route/times; do not say vague `declared departure gateway`.
- [ ] `US$163.98` candidate is not presented as a direct HND/NRT→SIN option unless normalized evidence proves the route. Otherwise show complete routing under More options or omit it.
- [ ] Authority is shown as organiser/organisation approval, not generic HUMAN_AGENT wording.
- [ ] Approval exposes Execute; execution/observation updates authoritative topology.
- [ ] Terminal Case shows Tokyo-origin trip + preserved LHR return, no old London inbound as current, no stale options/Begin/approval controls, and remains resolved on revisit.

## 9. Jonas S5 — golden path

- [ ] **Correct problem:** extend the existing Concorde Hotel Singapore stay; never `Switch stay to hotel` and never promote Value Hotel/Sakura/J8 as the hero solution.
- [ ] Canonical baseline is Concorde through `3 Oct 11:00`; requested checkout is `4 Oct 11:00`.
- [ ] `What to do next` explicitly states the **personal incremental cost is paid by Jonas**, not the organiser.
- [ ] Natural wording throughout: `Extend Concorde stay through Sunday`, `Jonas pays the extra night`, etc.; remove generic accommodation/process phrases.
- [ ] Same-property proposal is real in planner/read model or the hero stops honestly rather than filling cards with unrelated hotels.
- [ ] Fireside remains visibly satisfied/confirmed throughout; unaffected elements do not become Pending.
- [ ] Traveller decision explicitly states the exact mutation being approved: extend Concorde to 4 Oct 11:00, payable amount, payer, and no flight change.
- [ ] Traveller authority only; operator cannot approve as Jonas and no organiser approval is created.
- [ ] After approval, pending-decision UI disappears; execution/observation updates the same Concorde stay.
- [ ] Terminal UI contains the Concorde property name, new checkout, funding split and resolved status; no internal place ID.
- [ ] Overview red/Needs Attention becomes Confirmed/green after resolution.
- [ ] Direct reopen/reload stays resolved; no stale Approve/Decline/Resolve controls reappear.

## 10. Overview / Programme / Traveller visual truth

These are structural acceptance items, not another broad redesign.

- [ ] **Recovered structure is visibly present.** Major page composition/grouping should read as recovered UI plus current authoritative data/actions, not old production markup with small patches.
- [ ] Overview fleet cells keep the approved filled-grey/unconfirmed semantics, no unwanted emphasis rings, 67 cells, commitment-time ordering, 10-row pagination/search.
- [ ] Overview blocks beneath Travellers do not bleed/misalign at desktop and laptop widths.
- [ ] Programme summary remains collapsed; event/programme commitments appear once in the main timeline rather than once per traveller segment.
- [ ] Reconcile any remaining venue/tag-based duplicate programme entries before claiming timeline dedup PASS.
- [ ] Programme traveller rows/cards do not bleed; `tl-affected`/related CSS issues are checked visually, not assumed fixed by unit tests.
- [ ] Traveller surfaces use recovered concierge hierarchy where state warrants it, including clean choice/recovered states.
- [ ] **Singapore CBD/dusk traveller hero visual is present again where the recovered traveller design calls for it** (use the approved/repository asset truthfully; do not misrepresent the AI replacement as an original recovered asset).
- [ ] Typography remains readable per `UI_VISUAL_DIRECTION.md`; no regression to tiny metadata.
- [ ] General hover/focus/state transitions are present beyond the single Resolve modal; keep them restrained and meaningful.

## 11. Matrix-truth items explicitly reopened

The following old R3D matrix claims require fresh visual/browser evidence because later production review contradicted or weakened them:

- [ ] O1/O2/O3 — fleet geometry/filled-grey/traveller-block layout.
- [ ] P2/P3/P4 — Programme composition, real dedup including venue/tag variants, traveller-table bleeding.
- [ ] C1/C5/C6 — recovered Case hierarchy, actual selectable options, lifecycle transitions beyond timer overlay.
- [ ] J5/J8 — funding clarity and defensible recommendation, not merely presence of labels.
- [ ] S1/S2/S3 — Now/Proposed UI, continuation, Sarah terminal convergence.
- [ ] A1 — recovered-quality human wording, not only removal of the literal `Providers` string.
- [ ] T1 — recovered traveller composition/hierarchy, not merely existence of traveller screenshots.
- [ ] G2/G3 — full A→B→C includes authority-correct approval **and execution/observation**, not approval-as-terminal.
- [ ] Global typography/motion — previously missing from the closure matrix; now explicitly accepted here.

## 12. Investigate Now

- [ ] Root cause of Jonas revisit/unresolved regression: persistence, stale case projection, replay/reset interaction, or client presentation state.
- [ ] Confirm the actual persisted Jonas `Stay.propertyId` remains Concorde after execution.
- [ ] Confirm exactly which two trips/participants Sarah programme preview fan-out returns and project distinct identities/reasons.
- [ ] Determine whether the generic Authority card is static copy; if so, replace with case/read-model authority output.
- [ ] Determine whether Jordan/Oliver recommended plan leakage before Resolve is precomputed state leaking through presentation or an intentional already-planned state.
- [ ] Verify Oliver `US$163.98` normalized route/directness before any hero exposure.
- [ ] Verify Jordan's stronger provider-inadequacy story can be supported by an honest external fixture; otherwise keep the weaker truthful `unverified until checked` story.

## 13. Park / Accept Risk

- [ ] **Park:** full Activity redesign; keep it out of the hero video unless trivial cleanup makes it presentable.
- [ ] **Park:** full Programme page visual overhaul beyond hero-critical summary/timeline/bleeding fixes; Sarah Now/Proposed is the stronger video proof.
- [ ] **Accept Risk:** timer-smoothed loading visuals are acceptable as user-facing resolution choreography if not narrated as literal live tool telemetry.
- [ ] **Accept Risk:** no live provider ticketing/hotel modification; keep simulated execution visibly disclosed.
- [ ] **Accept Risk:** Jordan transit hotel/Japan immigration/insurance execution remain outside closed hero.
- [ ] **Accept Risk:** Oliver transfer remains unrepresented and unclaimed.
- [ ] **Park:** Jonas return-flight modification remains outside S5 closed hero.

## 14. Implementation lane suggestion

Do not split unresolved shared contracts across competing writers. Recommended bounded lanes after this checklist is accepted:

1. **Lifecycle/state lane (primary/strong model):** CTA lifecycle, execute/observe/terminal convergence, persistence, exact rehearsal assertions.
2. **Hero data/logic lane (strong model):** Jonas same-property extension + funding, Sarah fan-out terminal reconciliation, Oliver topology/route evidence, Jordan fixture truth.
3. **Presentation/copy lane:** shared money formatter, option pros/cons, authority wording, commitment semantics, natural-language copy.
4. **Transition/visual lane:** structured progress component, recovered composition gaps, Singapore CBD/dusk traveller visual, typography/motion, programme/overview bleed fixes.
5. **Independent acceptance lane:** browser-drive four golden paths on exact candidate SHA; verify screenshots + reload/reopen; no product writes unless explicitly assigned.

Each lane must maintain a lightweight `docs/work/ACTIVE_TASK.md` or lane-local checklist and return concise evidence. The integration owner reconciles all lanes against this document and `DEMO_SCREEN_CHOREOGRAPHY.md` before human review.
