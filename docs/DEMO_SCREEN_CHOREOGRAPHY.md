# Northstar hero demo screen choreography

**Status:** implementation contract; documentation only  
**Baseline:** `main` at `9a9921cb06c54ee3b7c257947756f3a254cd668a`  
**Hero order:** S2 Jordan → reset → S1 Sarah → S3 Sarah without reset → reset → S7 Oliver → reset → S5 Jonas  
**Authority:** this document connects the frozen scenario and product sources to judge-facing presentation. It does not change scenario, domain, recovery, authority, funding, or execution semantics.

## 1. Executive summary

Northstar's closed backend demonstrates most of the important hero consequences, but the current judge-facing flow does not reliably communicate them. The principal problem is not visual polish. It is missing state choreography.

The current product often:

- enters a hero after the decisive external change has already happened;
- hides an already-created plan behind a generic three-second “AI” animation;
- presents provider options without the arrival, commitment, funding, and authority facts that make one option meaningfully better;
- allows copy, CTA, and authoritative case state to disagree;
- compresses approval, execution, observation, and state update into one ambiguous transition; and
- fails to make the terminal outcome visible or revisit-safe.

This makes Northstar look like a flight option picker even when the engine has performed trip-graph propagation, whole-trip viability, programme counterfactuals, funding allocation, authority, observation, and state update.

The hero stories must instead land as four distinct proofs:

| Hero | The proof a judge must be able to repeat afterwards | Required authority | Honest external boundary |
|---|---|---|---|
| Jordan, S2 | An airline can restore a flight while leaving the trip objective at risk; Northstar tests the event and selects a whole-trip-viable recovery. | Organiser | Search may use REPLAY; ticketing execution is simulated at the provider boundary. |
| Sarah, S1→S3 | A shared airline change affects travellers differently; when travel cannot save the objective, Northstar safely changes the programme and re-evaluates the same trip. | Organiser commits the programme change | Schedule-change ingress is a labelled simulated external event. Programme preview, commit, propagation, and re-evaluation are real. |
| Oliver, S7 | A traveller's changed origin invalidates the old topology; Northstar rebuilds the trip while preserving explicit downstream intent. | Organiser | Search uses REPLAY; flight execution is simulated at the provider boundary. |
| Jonas, S5 | A personal stay extension can preserve event obligations while separating organiser-funded baseline cost from the traveller's incremental cost. | Traveller, not organiser | Hotel search uses recorded provider evidence; modification execution is simulated at the provider boundary. |

### Contract verdict

The recovered UI structure remains the right visual skeleton, especially the case-first two-column layout and Now/Proposed programme view. It needs to be driven by authoritative screen state and richer structured presentation data. Static recovered content must not be copied as product truth.

Before the hero can be considered ready, four correctness blockers must be closed:

1. Jordan and Oliver cannot currently reach execution from the judge-facing Case after approval because the generic options branch shadows the approved-state Execute branch.
2. Sarah becomes `VIABLE` underneath after programme commit but remains visibly `DISRUPTED / Needs Attention` with another Resolve CTA.
3. Jonas currently receives hotel-switch options instead of an extension of his existing Concorde stay, and the current-stay evidence drifts from the canonical fixture.
4. Current browser rehearsal can false-pass terminal state without proving execute, observed state, final topology/stay, or revisit correctness.

These are product-truth gaps, not optional polish.

## 2. Cross-hero reusable screen/state model

### 2.1 Shared state vocabulary

The UI should compose every hero from reusable states. A hero selects structured content; it does not select a scenario-specific component or engine branch.

| State | Meaning | Normal surface | Mutation allowed? |
|---|---|---|---|
| `BASELINE` | The current authoritative trip and commitments before the new change. | Overview, Traveller, or Programme | No |
| `CHANGE_RECEIVED` | A provider signal or traveller request has been received but not fully assessed. | Activity, Traveller thread, Overview callout | Ingress only |
| `IMPACT_VISIBLE` | Propagated affected elements and commitments are known. | Overview and Case | No |
| `REASONING` | Northstar is reconciling facts, searching, evaluating, or constructing a counterfactual. | Case or Programme transition panel | No authoritative candidate mutation |
| `OPTIONS` | At most three primary alternatives are available with consequences. | Case or Traveller decision card | No |
| `AWAITING_AUTHORITY` | A selected proposal is staged and the correct principal must act. | Case, Programme, or Traveller | No execution |
| `EXECUTING` | An approved proposal is being applied at its declared boundary. | Transition panel | External action may occur only through the executor |
| `OBSERVING` | Provider/programme outcome has been received and downstream state is being rechecked. | Transition panel | Observed state update only |
| `RESOLVED` | The authoritative case is closed and the remaining trip is viable. | Case, Overview, Traveller, Programme history | No further CTA unless a new change arrives |
| `COUNTERFACTUAL_PREVIEW` | A mutation-free Now/Proposed programme comparison. | Programme | No |
| `PROGRAMME_COMMITTING` | An organiser-approved programme proposal is being committed and propagated. | Programme transition panel | Programme mutation through the commit boundary |

`UNKNOWN` remains visibly distinct from confirmed, failed, or viable. The UI must not paint an unobserved chain element green to improve the ending.

### 2.2 State-derived CTA lifecycle

The displayed CTA is a projection of authoritative state, not browser memory.

| Authoritative condition | Primary CTA | Must not also show |
|---|---|---|
| Impact known, no plan requested | `Find a recovery` or the capability-specific equivalent | Approval or Execute |
| Plan available, no option staged | `Continue with this option` | A second Resolve CTA |
| Option staged, organiser required | `Approve as organiser` | Begin recovery |
| Option staged, traveller required | Traveller: `Approve and pay`; operator: no approval CTA | Organiser approval or operator impersonation |
| Approved, execution not started | `Execute approved recovery` | Begin recovery or another approval CTA |
| Executing/observing | No action; show progress and provenance | Duplicate submission controls |
| Resolved | `View updated trip` or `Back to Overview` | Resolve, Begin, Approve, or Execute |

Browser `sessionStorage` may remember a harmless expansion preference, but it must not determine whether the product appears impacted, planned, awaiting approval, executing, or resolved.

### 2.3 Shared Case composition

Use the recovered two-column Case structure as the base:

1. **Title band:** human consequence first, source/provenance second, state badge, last observed time.
2. **What changed:** observed input and the difference from authoritative baseline.
3. **Whole trip:** compact journey chain with changed, obsolete, proposed, preserved, unknown, and confirmed states.
4. **Commitments at risk:** actual time, required buffer, computed gap, and pass/fail consequence.
5. **Reasoning or recommendation:** only the content appropriate to the current state.
6. **Options:** maximum three primary alternatives; collapsed remainder is secondary.
7. **Impact and checks:** affected dependencies, completed checks, uncertainty, and evidence provenance.
8. **Sticky decision rail:** cost, payer, authority, next action, and no-mutation/execution disclosure.
9. **Activity/history:** ingress, proposal, decision, execution boundary, observation, and state update.

The rail must not use universal spend-cap copy. It must explain why this action requires this principal.

### 2.4 Option contract

Every primary option must carry the following structured fields. Unknown fields remain labelled unknown; they are not omitted in a way that implies safety.

- name and supplier/route/stay identity;
- departure/check-in and arrival/check-out in local human-readable time;
- recommendation state and evidence-specific reason;
- two or three concise pros;
- one or two material cons or uncertainties;
- provider charge with unambiguous currency code/symbol;
- home-policy equivalent, separately labelled, when different;
- payer and funding basis;
- effect on each hard commitment and important downstream dependency;
- authority required and the reason;
- provenance (`LIVE`, `RECORD`, `REPLAY`, reported/unobserved, or simulated external result).

At most three alternatives are expanded. “More options” may expose the remainder but must not compete with the recommendation.

### 2.5 Cross-surface hand-off rules

- **Overview** answers: who needs attention, why, and which Case to open. A shared incident should be grouped before its individual consequences.
- **Case** answers: what changed, what it breaks, what Northstar recommends, and who can act.
- **Programme** answers: what is true now, what would change, who is affected, and what will be committed.
- **Traveller** answers: what the traveller said, what they personally need to decide, what they pay, and what their trip now contains.
- **Activity/history** preserves evidence and allows a resolved Case to be reopened from Overview without reviving its CTAs.

### 2.6 Screen-state contract template

Each state below explicitly defines:

- screen ID and name;
- route/surface and entry condition;
- headline and user-facing explanation;
- visible and hidden components;
- capability proof;
- primary and secondary CTA;
- authority state;
- transition after action;
- authoritative state change;
- next state and terminal condition.

## 3. Jordan Hale — S2 full choreography

### J-01 — Connected trip before disruption

- **Route/surface:** Traveller trip, with the same state visible from Overview.
- **Entry condition:** Jordan's LAX→NRT→SIN itinerary and Finals Showcase commitment are authoritative and still viable.
- **Headline:** `Jordan is on track for the Finals Showcase`.
- **Explanation:** Show the real two-flight journey, the genuine 2h40 Narita connection, Concorde stay, and 30 Sep 20:45–21:05 showcase.
- **Visible:** LAX→NRT ZG023; NRT→SIN ZG053; connection duration; Singapore arrival; 360-minute required event buffer; Confirmed/on-track state.
- **Hidden:** options, approval, costs, recovery CTA, hotel/immigration/insurance claims.
- **Capability:** authoritative baseline and dependency graph.
- **Primary CTA:** none.
- **Secondary CTA:** `View trip details`.
- **Authority:** none required.
- **Transition:** a labelled provider delay event arrives.
- **State change:** new observed timing evidence is ingested; the itinerary itself is not yet mutated.
- **Next/terminal:** J-02; not terminal.

### J-02 — Connection risk is changing

- **Route/surface:** Traveller alert plus Overview `Watching` row; Case is optional until impact becomes material.
- **Entry condition:** progressive delay evidence reduces connection margin but the onward flight has not yet been confirmed missed.
- **Headline:** `Jordan's Narita connection is tightening`.
- **Explanation:** `The flight is delayed. Northstar is rechecking the onward connection and the Finals Showcase as new timings arrive.`
- **Visible:** old versus latest arrival, remaining connection margin, observed-source badge, `Still viable` or `Tight` state, event dependency.
- **Hidden:** definitive missed-connection language, final recommendation, approval, Execute.
- **Capability:** change ingestion and continuous propagation.
- **Primary CTA:** none; this state advances from evidence.
- **Secondary CTA:** `Open case`.
- **Authority:** none.
- **Transition:** real evidence-driven status update, not a timed animation.
- **State change:** viability/check results may change from viable to tight; no booking mutation.
- **Next/terminal:** repeat J-02 for a later observation or advance to J-03; not terminal.

### J-03 — Provider itinerary is not yet a recovered trip

- **Route/surface:** Case, linked from an Overview `Needs Attention` row and a Traveller alert.
- **Entry condition:** the NRT→SIN connection is missed or impossible and provider-side replacement information is present.
- **Headline:** `The airline restored a flight. Jordan's trip is not recovered yet.`
- **Explanation:** `A replacement flight is only useful if it still protects the Finals Showcase. Northstar has not accepted the provider itinerary as a whole-trip recovery.`
- **Visible:** missed NRT→SIN sector; reported provider response as a distinct card; provider-response provenance; showcase time and 360-minute buffer; current whole-trip viability; known uncertainty.
- **Hidden:** “Northstar booked” language, provider confirmation if only reported, organiser approval before a candidate exists, transit-hotel/immigration/insurance execution.
- **Capability:** distinction between provider recovery and whole-trip recovery.
- **Primary CTA:** `Protect the Finals Showcase`.
- **Secondary CTA:** `Keep provider itinerary` only when that is a real, selectable alternative; otherwise `View evidence`.
- **Authority:** no authority requested until a viable action is staged.
- **Loading after CTA:** J-04.
- **State change:** planning begins against the current overlay; the provider itinerary is not made authoritative merely by display.
- **Next/terminal:** J-04; not terminal.

**Truth constraint:** the current closed manifest reports that the airline has already placed Jordan on the viable 08:20/TR885-class flight. That reported TR885 must not be called inadequate. To meet the desired “inadequate provider solution → better Northstar recovery” story, a future implementation must change only the labelled external/presentation fixture so that the observed provider reprotection is genuinely inadequate, for example a TR867-class arrival at 20:45, and then let the existing generic planner evaluate TR885. Until that fixture exists, J-03 must say that provider recovery is *unverified until whole-trip checks complete*, not falsely claim that TR885 fails.

### J-04 — Whole-trip recovery analysis

- **Route/surface:** full Case transition panel within the recovered C2-style shell.
- **Entry condition:** the operator requested a recovery and planning/search evidence is being produced or replayed.
- **Headline:** `Finding a flight that protects the showcase`.
- **Explanation:** `Northstar is testing onward flights against Jordan's actual Singapore commitment, not arrival alone.`
- **Visible progress:** 
  1. `Confirming the missed Narita connection`;
  2. `Searching recorded NRT→SIN alternatives`;
  3. `Comparing Singapore arrival with the 20:45 showcase`;
  4. `Applying the required 360-minute arrival buffer`;
  5. `Checking funding and organiser authority`.
- **Resulting consequence:** `One next-morning option leaves 370 minutes before the showcase.`
- **Hidden:** selectable options until evidence is complete; approval; fake token-by-token AI text; hotel/immigration/insurance as completed work.
- **Capability:** provider search, whole-trip viability, event consequence, funding, and authority.
- **Primary CTA:** none during progress.
- **Authority:** calculating only.
- **Transition:** actual projected progress; fast work may settle without artificial delay.
- **State change:** candidate overlays and deterministic viability results are created; authoritative trip remains unchanged.
- **Next/terminal:** J-05; not terminal.

### J-05 — Whole-trip options

- **Route/surface:** Case recommendation state.
- **Entry condition:** ranked candidate overlays and their viability evidence exist.
- **Headline:** `One option gets Jordan to the showcase safely`.
- **Explanation:** `Northstar compared each arrival with the Finals Showcase and the required six-hour buffer.`
- **Visible recommendation:** the actual 08:20→14:35 TR885-class offer, marked recommended; `370 minutes available / 360 minutes required`; provider charge `US$90.54`; home-policy equivalent `S$122.23`; event/organiser funding if confirmed by allocation; organiser authority; REPLAY provenance.
- **Recommended pros:** protects the hard commitment; smallest viable whole-trip recovery in current evidence; preserves downstream Singapore stay.
- **Recommended cons:** overnight wait/next-morning departure; ticketing is not yet executed.
- **Why recommended:** `This is the earliest evidenced option that satisfies the 360-minute showcase buffer.`
- **Other primary alternatives:** at most two evidenced alternatives. A TR867-class 20:45 arrival, if present as inventory, is explicitly rejected because it leaves no showcase buffer. Other late arrivals are explicitly rejected by computed timing. Do not invent supplier details absent from evidence.
- **Commitment effect:** Finals Showcase `VIABLE`; Concorde and other downstream elements `preserved` or `unknown` according to evidence.
- **Hidden:** approval success, provider confirmation, resolved state.
- **Capability:** option ranking by trip consequence rather than fare alone.
- **Primary CTA:** `Continue with recommended recovery`.
- **Secondary CTA:** `More options` and `View checks`.
- **Authority:** organiser required because a flight change is being executed.
- **Loading after CTA:** short staging transition, then J-06; not execution.
- **State change:** selected proposal is staged; no trip mutation or provider action.
- **Next/terminal:** J-06; not terminal.

### J-06 — Organiser approval

- **Route/surface:** Case decision rail and decision summary.
- **Entry condition:** a viable flight recovery is staged and awaits the organisation principal.
- **Headline:** `Organiser approval is required`.
- **Explanation:** `Northstar has a viable recovery, but it will not change the booking until an organiser approves the flight action and cost.`
- **Visible:** selected flight; commitment buffer; provider and home-equivalent amounts; payer; authority reason; simulation disclosure for eventual provider execution; approve/decline identity.
- **Hidden:** Begin recovery, traveller approval, auto-book-under-cap copy, Execute before approval.
- **Capability:** policy and authority separation from planning.
- **Primary CTA:** `Approve as organiser`.
- **Secondary CTA:** `Decline` or `Choose another option`.
- **Authority:** waiting for organiser.
- **Loading after CTA:** approval receipt, then J-07.
- **State change:** deterministic decision becomes `APPROVED`; no external action yet.
- **Next/terminal:** J-07; not terminal.

### J-07 — Execute, observe, and recheck

- **Route/surface:** Case transition panel.
- **Entry condition:** approved recovery has not yet been executed.
- **Headline:** `Applying Jordan's approved recovery`.
- **Explanation:** `The ticketing boundary is simulated in this closed demo. Northstar still records the result, observes it, and rechecks the real trip graph.`
- **Visible progress:** `Submitting approved action to the simulated provider boundary` → `Recorded provider-boundary result received` → `Updating the observed onward sector` → `Rechecking showcase timing and downstream stay`.
- **Visible provenance:** `SIMULATED EXECUTION`; search evidence remains labelled `REPLAY`.
- **Hidden:** live-ticketed claim, animation unrelated to response state, additional approval controls.
- **Capability:** execution boundary, observation, authoritative update, re-verification.
- **Primary CTA:** `Execute approved recovery` appears only before this transition; none once submitted.
- **Authority:** approved.
- **State change:** executor result is observed; authoritative trip and case state update only after the observed result.
- **Next/terminal:** J-08; not terminal until observation and viability pass.

### J-08 — Jordan recovered

- **Route/surface:** resolved Case, then Overview/Traveller.
- **Entry condition:** observed onward sector is updated, whole-trip viability passes, and the case is `RESOLVED`.
- **Headline:** `Jordan is back on track for the Finals Showcase`.
- **Explanation:** `The observed recovery arrives at 14:35, leaving 370 minutes before the 20:45 showcase.`
- **Visible:** updated LAX→NRT→SIN journey; recovered sector; showcase PASS with `370 ≥ 360`; preserved downstream stay; approved cost/payer; activity history; `SIMULATED EXECUTION` qualifier.
- **Hidden:** Resolve, Begin, Approve, Execute, rejected options as primary content.
- **Capability:** observed state update and whole-trip resolution.
- **Primary CTA:** `Back to Overview`.
- **Secondary CTA:** `View updated trip` and `View case history`.
- **Authority:** completed.
- **State change:** none on view.
- **Next:** Overview shows Jordan Confirmed/green and retains a case-history link.
- **Terminal condition:** reload and reopen show the same resolved case, recovered route, showcase buffer, cost, authority, and simulation provenance.

## 4. Sarah Lim — S1→S3 full choreography, no reset

### S-01 — Programme and cohort baseline

- **Route/surface:** Programme with an Overview cohort summary.
- **Entry condition:** the shared CGK→SIN speaker arrivals and programme commitments are currently authoritative.
- **Headline:** `67 managed arrivals aligned to the programme`.
- **Explanation:** Sarah's 09:20 headline is visibly distinct from later Wanderpay commitments.
- **Visible:** programme timeline, Sarah headline at 09:20, later speaker commitments, current arrival cohort, Confirmed counts.
- **Hidden:** programme proposal, recovery options, impact warning.
- **Capability:** shared event/trip graph baseline.
- **Primary CTA:** none.
- **Transition:** labelled airline schedule-change events arrive.
- **State change:** provider changes are ingested per affected trip.
- **Next/terminal:** S-02; not terminal.

### S-02 — Shared airline change ingested

- **Route/surface:** Overview shared-incident callout, linked to Programme impact and individual Cases.
- **Entry condition:** the S1 simulated external schedule-change events have been received and propagated.
- **Headline:** `One airline change. Four different trip consequences.`
- **Explanation:** `The new morning arrival affects a shared cohort, but each traveller is evaluated against their own programme commitment.`
- **Visible:** `4 itineraries changed`; `3 remain viable`; `Sarah needs action`; Arjun Mehta, Siti Rahman, and Mei Tan shown as viable for later Wanderpay duties; Sarah shown critical for the 09:20 headline; `SIMULATED SOURCE EVENT` provenance.
- **Hidden:** four indistinguishable red case rows, recovery cost, programme mutation, anonymous impact IDs.
- **Capability:** change ingestion, cohort blast-radius propagation, traveller-specific consequence.
- **Primary CTA:** `Review Sarah's impact`.
- **Secondary CTA:** `View affected cohort`.
- **Authority:** none yet.
- **Transition:** open the same Sarah Case.
- **State change:** none from navigation.
- **Next/terminal:** S-03; not terminal.

### S-03 — Sarah's current trip is non-viable

- **Route/surface:** Sarah Case.
- **Entry condition:** Sarah's replacement itinerary is observed and deterministic timing marks the trip non-viable.
- **Headline:** `Sarah's new flight cannot protect the 09:20 headline`.
- **Explanation:** `The airline change gets Sarah to Singapore, but not with the required 360-minute preparation buffer.`
- **Visible:** new arrival time/class; 09:20 headline; actual arrival-to-commitment gap; required 360 minutes; explicit FAIL; other affected elements; source provenance.
- **Hidden:** contradictory “timing still works” text; commitment `Not booked`; Programme committed state; flight purchase claim.
- **Capability:** dependency and event-consequence reasoning.
- **Primary CTA:** `Find a way to protect the headline`.
- **Secondary CTA:** `View cohort impact`.
- **Authority:** none until a proposal exists.
- **Loading after CTA:** S-04.
- **State change:** search/planning creates overlays only.
- **Next/terminal:** S-04; not terminal.

### S-04 — Travel-only recovery does not solve the objective

- **Route/surface:** Case transition panel.
- **Entry condition:** the operator requests recovery.
- **Headline:** `Testing travel recovery before changing the programme`.
- **Explanation:** `Northstar first checks whether a travel change can preserve the current 09:20 headline. The programme will not move unless travel cannot satisfy the objective.`
- **Visible progress:** `Verifying the airline replacement` → `Testing current arrival against the 09:20 headline` → `Checking evidenced travel alternatives` → `Headline commitment still fails` → `Opening a mutation-free programme counterfactual`.
- **Resulting consequence:** `No evidenced travel-only option protects the current headline. A programme change can be evaluated without changing the live schedule.`
- **Hidden:** unsupported claim that a provider search completed if only current acceptance flow was used; any programme mutation; Commit.
- **Capability:** travel-first recovery, objective reasoning, escalation to programme counterfactual.
- **Primary CTA:** none during progress.
- **Authority:** not yet requested.
- **Transition:** evidence-based progress. If travel-search evidence is only REPLAY, label it. If it does not exist, do not claim search exhaustion.
- **State change:** candidate travel overlays may be rejected; no authoritative itinerary or programme mutation.
- **Next/terminal:** S-05; not terminal.

### S-05 — Programme recovery strategy

- **Route/surface:** Case recommendation with Programme hand-off.
- **Entry condition:** travel-only recovery cannot satisfy the current commitment and a safe programme proposal can be previewed.
- **Headline:** `Protect Sarah by moving the headline, not buying another flight`.
- **Explanation:** `Northstar can test a later headline against every linked traveller before the organiser commits anything.`
- **Visible recommendation:** `Move Sarah's headline to 15:30–16:00`; why it restores Sarah's timing margin; no flight purchase; organiser authority; preview is mutation-free.
- **Pros:** uses the current airline rebooking; restores Sarah's viability; avoids a new flight transaction.
- **Cons:** changes a public programme commitment; Elena's interview and Daniel's local/changeable context must be reviewed.
- **Cost/currency/payer:** `No new travel purchase in this proposal`; do not invent zero supplier cost if other programme costs are not represented.
- **Commitment effect:** Sarah becomes viable in the preview; named linked people show their actual counterfactual effect.
- **Authority:** organiser programme commit required.
- **Primary CTA:** `Preview programme impact`.
- **Secondary CTA:** `Back to travel options` if real alternatives exist.
- **Loading after CTA:** short blast-radius computation, then S-06.
- **State change:** none; preview remains mutation-free.
- **Next/terminal:** S-06; not terminal.

### S-06 — NOW versus PROPOSED programme preview

- **Route/surface:** Programme, recovered C6-style side-by-side comparison.
- **Entry condition:** preview response exists and authoritative programme still shows 09:20.
- **Headline:** `Move Sarah's headline to 15:30?`.
- **Explanation:** `This is a preview. The current programme and all trip states remain unchanged until the organiser commits.`
- **Visible NOW:** `09:20–09:40`; Sarah `NOT VIABLE`; current linked consequences.
- **Visible PROPOSED:** `15:30–16:00`; Sarah `VIABLE`; human-readable local dates/times; changed programme item highlighted.
- **Visible blast radius:** Sarah by name and positive viability consequence; Elena by name and her actual linked consequence; Daniel as local/changeable context only unless he is genuinely returned as affected evidence; `65 unaffected` when that is the current preview result; reason in human language.
- **Visible alternatives:** at most three real programme strategies. Do not invent a slot-swap API; the hero is a reschedule.
- **Hidden:** raw trip IDs, raw ISO inputs as the primary UI, `Place <id>`, duplicate generic impact rows, Execute, flight-booking language.
- **Capability:** mutation-free counterfactual, programme blast radius, consequence comparison.
- **Primary CTA:** `Commit programme change`.
- **Secondary CTA:** `Cancel` and `Edit proposal`; advanced raw editing is secondary.
- **Authority:** organiser; copy states `No programme mutation until you commit`.
- **Loading after CTA:** S-07.
- **State change:** only after explicit commit; cancel leaves all state unchanged.
- **Next/terminal:** S-07 after commit; S-05 or Sarah Case after cancel.

### S-07 — Commit and re-evaluate the same trip

- **Route/surface:** Programme transition panel.
- **Entry condition:** organiser has committed the previewed proposal.
- **Headline:** `Updating the programme and rechecking affected trips`.
- **Explanation:** `Northstar is applying the approved programme time, propagating the change, and re-evaluating the same Sarah trip.`
- **Visible progress:** `Committing 15:30 headline time` → `Updating linked programme dependencies` → `Recalculating Sarah's arrival buffer` → `Checking Elena and other linked trips` → `Programme and trip states updated`.
- **Visible consequence:** `Sarah's existing airline rebooking is now viable. No new flight was purchased.`
- **Hidden:** 220 ms flash-and-reload, another Resolve CTA, flight execution, a new Sarah identity/trip, provider ticketing claim.
- **Capability:** authorised programme mutation, graph propagation, deterministic re-evaluation.
- **Primary CTA:** none during commit; submission is idempotent/guarded.
- **Authority:** committed by organiser.
- **State change:** authoritative AnchorEvent changes; ordinary fan-out signals re-evaluate linked trips; viable cases reconcile to terminal state.
- **Next/terminal:** S-08; not terminal until same-trip state and Case projection converge.

### S-08 — Programme changed; Sarah recovered without a flight purchase

- **Route/surface:** Programme success state with a direct link back to the same Sarah Case.
- **Entry condition:** programme commit completed and Sarah's same trip is viable.
- **Headline:** `Programme updated. Sarah is back on track.`
- **Explanation:** `The headline now starts at 15:30. Sarah's existing airline rebooking meets the new commitment, so Northstar did not buy another flight.`
- **Visible:** just-changed 15:30 programme item; Sarah `VIABLE`; named blast-radius outcomes; commit actor/time; `View Sarah's updated trip`.
- **Hidden:** old 09:20 as current, fresh recovery CTA, anonymous internal reasons.
- **Capability:** programme recovery and same-trip consequence propagation.
- **Primary CTA:** `View Sarah's updated trip`.
- **Secondary CTA:** `Back to Overview` and `View change history`.
- **Authority:** complete.
- **State change:** none on navigation.
- **Next/terminal:** S-09.

### S-09 — Sarah terminal Case, no reset

- **Route/surface:** the same Sarah Case, then Overview.
- **Entry condition:** same trip ID is `VIABLE`; the programme-change consequence has been observed and the open fan-out case is reconciled/resolved.
- **Headline:** `Sarah can make the 15:30 headline`.
- **Explanation:** `The airline itinerary did not change again. The approved programme change restored the trip objective.`
- **Visible:** existing airline rebooking; 15:30 commitment; new computed buffer/PASS; `No flight purchase`; programme change history; resolved/Confirmed state.
- **Hidden:** `Needs Attention`, Resolve CTA, options, approval, execution.
- **Capability:** persistence, same-trip re-evaluation, state convergence.
- **Primary CTA:** `Back to Overview`.
- **Secondary CTA:** `View programme change`.
- **Terminal condition:** without reset, reload/reopen shows Sarah Confirmed, the 15:30 programme item, the same trip, no new flight execution, and a resolved case/history link.

## 5. Oliver Bennett — S7 full choreography

### O-01 — Original London topology

- **Route/surface:** Traveller trip or Case baseline, visible from Overview.
- **Entry condition:** authoritative trip has a London-origin inbound and London return intent.
- **Headline:** `Oliver's trip currently starts in London`.
- **Explanation:** Show the current topology, not a flattened list: London inbound → Singapore stay/commitment → Singapore→London return.
- **Visible:** inbound origin, stay, event commitment, explicit LHR return; current known/unknown statuses.
- **Hidden:** Tokyo options, obsolete labels, approval.
- **Capability:** topology baseline and preserved intent.
- **Primary CTA:** none.
- **Transition:** traveller message received.
- **State change:** change request is recorded; itinerary remains unchanged.
- **Next/terminal:** O-02; not terminal.

### O-02 — Traveller reports a new origin

- **Route/surface:** Traveller conversation and operator Activity/Case callout.
- **Entry condition:** Oliver states he is already in Tokyo, wants to depart HND or NRT, and still wants to return to LHR.
- **Headline:** `Oliver is already in Tokyo`.
- **Explanation:** `His London inbound is now obsolete. His London return remains explicit intent.`
- **Visible:** traveller's request; parsed new origin; preserved return intent; acknowledgement; `Trip not changed yet`.
- **Hidden:** provider confirmation, applied Tokyo route, inferred return uncertainty when the message is explicit.
- **Capability:** natural-language change ingestion and intent extraction.
- **Primary CTA:** operator Case: `Rebuild the trip from Tokyo`; traveller has no approval yet.
- **Secondary CTA:** `Review original trip`.
- **Authority:** none until a structural proposal is staged.
- **Loading after CTA:** O-03.
- **State change:** planning begins against an overlay.
- **Next/terminal:** O-03; not terminal.

### O-03 — Structural replan analysis

- **Route/surface:** Case transition panel with NOW topology visible behind/above progress.
- **Entry condition:** operator requests structural replanning.
- **Headline:** `Rebuilding Oliver's trip from Tokyo`.
- **Explanation:** `Northstar is removing obsolete inbound travel while preserving the parts Oliver still needs.`
- **Visible progress:** `Marking London inbound sectors obsolete` → `Preserving the Singapore→LHR return` → `Searching recorded HND/NRT→SIN alternatives` → `Rechecking Singapore arrival against the event` → `Rechecking the existing stay` → `Checking structural-change authority`.
- **Resulting consequence:** `Tokyo-origin alternatives found; organiser approval is required for the structural flight change.`
- **Hidden:** claim that a transfer was checked when no transfer element/evidence exists; applied topology; generic departure-gateway language.
- **Capability:** structural graph mutation proposal, provider search, downstream dependency reasoning, authority.
- **Primary CTA:** none during progress.
- **Authority:** calculating.
- **Transition:** evidence-driven progress; REPLAY labelled.
- **State change:** candidate topology overlays are created; original trip remains authoritative.
- **Next/terminal:** O-04; not terminal.

### O-04 — NOW versus PROPOSED topology and options

- **Route/surface:** Case recommendation state with a topology delta.
- **Entry condition:** viable Tokyo-origin overlays exist.
- **Headline:** `Replace the obsolete London inbound with a Tokyo flight`.
- **Explanation:** `The proposed trip starts at HND/NRT, keeps Singapore commitments and the existing stay, and preserves Oliver's return to LHR.`
- **Visible NOW:** London inbound marked `OBSOLETE IF APPROVED`; Singapore stay/commitment; LHR return marked `PRESERVE`.
- **Visible PROPOSED:** actual replay-backed HND/NRT→SIN offer; Singapore stay/commitment effects; unchanged SIN→LHR return.
- **Recommended option:** the actual 02:20 HND→SIN replay offer, provider charge `US$143.62`, home-policy equivalent `S$193.89`, recommendation rationale derived from viability/evidence.
- **Recommended pros:** starts from Oliver's actual location; satisfies the evidenced Singapore commitment; preserves explicit LHR return.
- **Recommended cons:** simulated execution boundary; any unknown hotel or arrival detail remains explicit.
- **Other primary alternative:** actual 02:00 option at `US$163.98`, with its evidenced consequence and clear reason it is not preferred. Show at most one further evidenced option.
- **Payer:** organisation/event only if current allocation proves it; otherwise show `Funding confirmation required` rather than guessing.
- **Commitment effect:** actual debate/event timing PASS; hotel `rechecked/preserved` only when evidence supports it; transfer `not represented` rather than falsely checked.
- **Authority:** organiser required because the change structurally replaces a flight origin.
- **Hidden:** abstract “declared departure gateway,” invented carriers/times, hidden return ambiguity, applied changes.
- **Capability:** topology comparison, whole-trip viability, evidence-specific ranking.
- **Primary CTA:** `Continue with recommended topology`.
- **Secondary CTA:** `More options` and `View checks`.
- **Loading after CTA:** stage proposal then O-05.
- **State change:** selected structural proposal is staged only.
- **Next/terminal:** O-05; not terminal.

### O-05 — Organiser approval for structural change

- **Route/surface:** Case decision rail.
- **Entry condition:** selected structural proposal awaits the organisation principal.
- **Headline:** `Organiser approval is required to replace the inbound`.
- **Explanation:** `This changes the trip structure, so Northstar will not execute it under a generic spending-cap rule.`
- **Visible:** before/after topology; provider/home amounts; payer; explicit LHR return preservation; authority reason; simulation disclosure.
- **Hidden:** Begin recovery, “human agent” ambiguity, traveller approval, automatic-booking copy.
- **Capability:** structural authority and no-mutation-before-approval.
- **Primary CTA:** `Approve as organiser`.
- **Secondary CTA:** `Decline` or `Choose another option`.
- **Authority:** waiting for organiser.
- **Loading after CTA:** approval receipt, then O-06.
- **State change:** decision becomes approved; trip remains unchanged until execution/observation.
- **Next/terminal:** O-06; not terminal.

### O-06 — Execute and observe structural recovery

- **Route/surface:** Case transition panel.
- **Entry condition:** proposal approved.
- **Headline:** `Applying Oliver's approved topology`.
- **Explanation:** `Flight execution is simulated at the provider boundary. Northstar will apply only the observed result and then recheck the trip.`
- **Visible progress:** `Submitting approved Tokyo-origin change to simulated provider boundary` → `Recorded result received` → `Replacing obsolete inbound in authoritative trip` → `Confirming LHR return remains` → `Rechecking event and stay viability`.
- **Hidden:** live ticketing claim; transfer confirmation without a transfer element; green treatment for unrelated `UNKNOWN` elements.
- **Capability:** executor boundary, observation, graph update, dependency propagation.
- **Primary CTA:** `Execute approved recovery` appears only before submission.
- **Authority:** approved.
- **State change:** observed result replaces the inbound topology; preserved return and downstream elements retain their authoritative identity/status.
- **Next/terminal:** O-07.

### O-07 — Tokyo-origin trip resolved

- **Route/surface:** resolved Case, Traveller trip, then Overview.
- **Entry condition:** observed HND/NRT→SIN inbound is authoritative, LHR return remains, whole-trip viability passes, case resolved.
- **Headline:** `Oliver's trip now starts in Tokyo`.
- **Explanation:** `The obsolete London inbound was removed. Oliver's Singapore commitments and return to London remain in the trip.`
- **Visible:** final topology; removed/obsolete audit history; Tokyo inbound; Singapore stay and event consequence; preserved SIN→LHR return; cost/payer; authority; simulation provenance.
- **Hidden:** Resolve, Begin, Approve, Execute; false transfer confirmation; recoloured unknowns.
- **Capability:** structural state update and durable intent preservation.
- **Primary CTA:** `Back to Overview`.
- **Secondary CTA:** `View updated trip` and `View case history`.
- **Terminal condition:** reload/reopen proves final Tokyo inbound plus LHR return, resolved case, correct cost/authority, and simulated execution disclosure.

## 6. Jonas Berg — S5 full choreography

### V-01 — Event-funded baseline stay

- **Route/surface:** Traveller trip and operator Overview.
- **Entry condition:** Jonas has an existing Concorde stay through 3 Oct 11:00 and a 1 Oct 14:30–14:50 fireside commitment.
- **Headline:** `Jonas's event trip is confirmed through 3 October`.
- **Explanation:** `The organiser-funded stay already covers the business programme. Any later personal nights will be evaluated separately.`
- **Visible:** Concorde stay; current checkout; event-funded baseline label; fireside confirmed/satisfied; current return scope if known.
- **Hidden:** hotel-switch options, extension cost, approval.
- **Capability:** baseline accommodation, commitment, and funding context.
- **Primary CTA:** none.
- **Transition:** traveller sends a request.
- **State change:** request signal only.
- **Next/terminal:** V-02; not terminal.

### V-02 — Traveller requests a personal extension

- **Route/surface:** Traveller conversation with composed trip context; operator sees a read-only Case alert.
- **Entry condition:** Jonas asks to stay until Sunday, 4 Oct.
- **Headline:** `Jonas wants to extend his existing stay by one night`.
- **Explanation:** `Northstar will check the Concorde extension, keep the business-funded baseline separate, and confirm that event obligations remain safe.`
- **Visible:** request text; current checkout 3 Oct; requested checkout 4 Oct; same-property intent; `Trip not changed yet`; fireside still satisfied.
- **Hidden:** “Switch stay to hotel”; organiser approval; executed extension; return-flight change.
- **Capability:** natural-language change ingestion and scoped recovery objective.
- **Primary CTA:** traveller acknowledgement only; operator `Check extension` if planning is not already started.
- **Secondary CTA:** `View current stay`.
- **Authority:** none yet.
- **Loading after CTA:** V-03.
- **State change:** planning begins against a candidate overlay.
- **Next/terminal:** V-03; not terminal.

### V-03 — Stay, commitments, funding, and authority analysis

- **Route/surface:** Traveller or Case transition panel, with operator read-only view.
- **Entry condition:** extension request is being evaluated.
- **Headline:** `Checking Jonas's extension and personal cost`.
- **Explanation:** `Northstar is extending the current trip, not replacing its business stay.`
- **Visible progress:** `Comparing current 3 Oct checkout with requested 4 Oct checkout` → `Searching recorded same-property extension availability` → `Preserving the organiser-funded baseline` → `Calculating Jonas's personal increment` → `Rechecking the fireside and remaining trip` → `Confirming traveller authority`.
- **Resulting consequence:** `The business programme remains satisfied. Jonas can approve and pay the incremental extension.`
- **Hidden:** organiser decision, automatic execution, hotel-switch language, return-flight recovery.
- **Capability:** accommodation reasoning, funding attribution, commitments, traveller authority.
- **Primary CTA:** none during progress.
- **Authority:** calculating; result is traveller authority.
- **Transition:** evidence-driven; search provenance labelled RECORD/REPLAY as applicable.
- **State change:** extension overlay, cost allocation, and authority requirement are created; existing stay remains authoritative.
- **Next/terminal:** V-04; not terminal.

### V-04 — Traveller decision for the existing stay extension

- **Route/surface:** Traveller decision card composed below the existing conversation; operator Case shows `Waiting for Jonas` without an approval control.
- **Entry condition:** a same-property extension proposal is available and requires the traveller.
- **Headline:** `Extend Concorde through Sunday`.
- **Explanation:** `Your event-funded stay remains unchanged through 3 October. You pay only for the personal extension to 4 October.`
- **Visible recommendation:** existing Concorde extension; current and proposed checkout; provider charge `US$223.94`; `Policy equivalent: S$302.32`; `Jonas pays the provider charge`; `No new organiser-funded cost`; fireside remains satisfied; traveller authority; simulated modification disclosure.
- **Recommended pros:** no hotel move; event commitments remain satisfied; clean separation between business baseline and personal increment.
- **Recommended cons:** Jonas pays the incremental provider charge; provider modification is simulated in this closed demo.
- **Why recommended:** `It extends the existing stay without changing the event-funded baseline or disrupting the programme.`
- **Other options:** maximum two real extension alternatives only if the planner has authoritative evidence. Do not substitute unrelated hotels merely to fill three cards.
- **Hidden on Traveller:** organiser approval, Begin recovery, ambiguous `$223.94`/`SGD302.32` as two charges.
- **Hidden on operator:** ability to approve as Jonas.
- **Capability:** role-correct authority and comprehensible funding/currency presentation.
- **Primary CTA:** Traveller: `Approve extension and pay US$223.94`.
- **Secondary CTA:** `Decline` or `Ask a question`.
- **Authority:** waiting for Jonas.
- **Loading after CTA:** V-05.
- **State change:** traveller approval is recorded; no organiser approval is created.
- **Next/terminal:** V-05; not terminal.

### V-05 — Apply and observe the stay extension

- **Route/surface:** Traveller transition panel mirrored read-only in Case.
- **Entry condition:** Jonas approved the traveller-funded extension.
- **Headline:** `Applying Jonas's approved stay extension`.
- **Explanation:** `The hotel modification is simulated at the provider boundary. Northstar will record the response and recheck the trip.`
- **Visible progress:** `Submitting approved extension to simulated provider boundary` → `Recorded provider-boundary response received` → `Updating checkout to Sunday, 4 October` → `Rechecking the fireside and whole-trip viability` → `Closing the resolved case`.
- **Hidden:** live hotel confirmation; organiser action; generic “Confirming provider result” without provenance.
- **Capability:** execution, observation, authoritative accommodation update, resolution.
- **Primary CTA:** none after traveller submission.
- **Authority:** traveller approved.
- **State change:** observed stay end changes to 4 Oct; personal allocation is recorded; case resolves after re-verification.
- **Next/terminal:** V-06.

### V-06 — Stay extended and obligations preserved

- **Route/surface:** resolved Traveller and Case.
- **Entry condition:** observed stay end is 4 Oct, fireside remains satisfied, trip viable, case resolved.
- **Headline:** `Concorde extended through Sunday`.
- **Explanation:** `Jonas's event-funded baseline is unchanged. His personal extension is recorded separately and the fireside remains on track.`
- **Visible:** same Concorde stay; checkout 4 Oct 11:00; event-funded baseline through 3 Oct; personal increment `US$223.94` with `S$302.32 policy equivalent`; Jonas as payer/approver; fireside PASS; simulation provenance; resolved activity.
- **Hidden:** hotel switch, organiser approval, Resolve/Begin/Approve/Execute, combined return-flight claim.
- **Capability:** durable accommodation, funding, authority, and commitment state.
- **Primary CTA:** `Back to trip` or `Back to Overview`.
- **Secondary CTA:** `View case history`.
- **Next/terminal:** V-07.

### V-07 — Revisit-safe confirmed state

- **Route/surface:** Overview row opening resolved Case history.
- **Entry condition:** user reloads or reopens after resolution.
- **Headline:** Overview row `Confirmed`; Case headline remains `Concorde extended through Sunday`.
- **Visible:** green Confirmed state; updated checkout; fireside safe; resolved case link/history; no pending approval.
- **Hidden:** Needs Attention, stale 3 Oct checkout as current, options or approval lifecycle.
- **Capability:** persistence and reliable state projection.
- **Terminal condition:** reload, direct Case reopen, Traveller reopen, and Overview all agree on stay, funding, authority, viability, and resolved state.

## 7. Generic loading/progress design

### 7.1 Presentation model

Implement one generic progress component driven by a structured presentation projection equivalent to:

```text
TransitionPresentation
  transitionId
  phase: INGESTING | RECONCILING | PROPAGATING | SEARCHING |
         EVALUATING | COUNTERFACTUAL | AUTHORITY |
         EXECUTING | OBSERVING | UPDATING
  title
  explanation
  steps[]
    id
    label
    status: QUEUED | IN_PROGRESS | DONE | FAILED | SKIPPED
    detail?
    evidenceProvenance?
  consequence?
    tone: POSITIVE | WARNING | BLOCKED | NEUTRAL
    headline
    explanation
  authorityOwner?
  externalBoundary?
    mode: LIVE | RECORD | REPLAY | REPORTED | SIMULATED
    label
  nextAction?
```

The exact TypeScript shape is an implementation choice. The contract is that progress, completion, provenance, and consequence come from structured product evidence rather than hero IDs, person names, static timers, or CSS state.

### 7.2 Behaviour rules

- Use actual completed and active phases. Do not simulate a fixed three-second “AI thinking” sequence after the result already exists.
- If work completes quickly, show a short settled consequence and move on. Do not slow the product to look intelligent.
- If work is asynchronous, persist the transition ID so reload returns to the correct state.
- A failed or degraded check stays visible with a meaningful next action.
- Search mode and execution mode are separate. A REPLAY search does not make a later provider execution real.
- Label reported-but-unobserved traveller/provider statements separately from observed supplier state.
- Execution progress begins only after the correct authority is recorded.
- Observation and state update remain visible after the external result; this is where Northstar proves it is maintaining the trip, not merely clicking a supplier API.
- Reduced-motion mode uses state replacement and a progress list without animated shimmer or motion dependence.
- Announce phase/consequence changes to assistive technology; never rely on colour alone.
- The component receives content; it contains no branches for S1, S2, S5, S7, Jordan, Sarah, Oliver, Jonas, airports, suppliers, or fixture IDs.

### 7.3 Hero-specific structured content

| Hero | Planning/checking phases | Execution/commit phases | Required resulting consequence |
|---|---|---|---|
| Jordan | Confirm miss; search onward; compare arrivals with 20:45 showcase; apply 360-minute buffer; check organiser authority. | Submit to simulated ticketing boundary; receive recorded result; observe new sector; recheck showcase and stay. | `One option leaves 370 minutes before the showcase.` |
| Sarah | Propagate shared change; differentiate cohort; test current headline; check evidenced travel alternatives; compute programme counterfactual blast radius. | Commit 15:30 programme time; fan out; re-evaluate same trip; reconcile case state. | `Existing airline itinerary is viable after the programme change; no flight purchase.` |
| Oliver | Parse new origin/preserved return; identify obsolete inbound; search Tokyo; recheck evidenced commitment and stay; determine structural authority. | Submit simulated structural change; observe Tokyo inbound; preserve LHR return; recheck viability. | `Trip now starts in Tokyo and still returns to London.` |
| Jonas | Compare current/requested checkout; search same-property extension; separate baseline/increment; recheck fireside; determine traveller authority. | Submit simulated stay modification; observe new checkout; recheck commitments; close case. | `Existing stay extended; Jonas pays only the incremental provider charge.` |

## 8. Current-screen mapping

`Available` means the present product has the underlying route/component or evidence, not that the current judge flow already satisfies the contract.

| Ideal state | Current screen/evidence | Available? | Missing or wrong now | Required change | Decision |
|---|---|---:|---|---|---|
| Baseline before each hero event | Traveller, Programme, Overview; manifest/demo launch | Partial | Demo launch often advances through planning/begin before the judge enters. | Add a stateful judge choreography entry that exposes baseline and labelled trigger before impact. | B / C |
| Shared S1 incident and differentiated cohort | Flat Overview attention queue | No | Four similar disrupted rows; viable Wanderpay travellers look equally bad. | Group one source incident and project `4 changed / 3 viable / Sarah critical` with named outcomes. | B |
| Progressive S2 viable→tight→missed | Manifest events, no judge-facing sequence | Backend only | Important change-ingestion story runs invisibly. | Present labelled manifest/replay observations through generic Activity/Watching/Case states. | C |
| Traveller request plus trip context | Traveller conversation | Partial | Message presence suppresses itinerary/funding/decision composition. | Compose conversation, trip context, progress, and decision card based on state. | B |
| Impacted Case | Recovered-style operator Case | Yes | Headline/state can disagree with authoritative pending approval; commitment/chain statuses mislead. | Derive phase from authoritative state and project actual arrival/buffer/commitment semantics. | A/B |
| Meaningful failed checks | Case checks | Partial | Duplicated/contradictory “No longer meets: timing still works” language. | Project pass/fail consequence from the deterministic check result. | A |
| Generic explanatory reasoning | Fixed Case overlay | Shell only | Same hardcoded steps for all heroes; fixed timer; says “AI” even for deterministic fallback. | Drive generic transition component from structured evidence/state. | A shell, B projection |
| Maximum-three options | Case option cards and More options | Yes | Titles are abstract; no structured pros/cons, arrival, commitment effect, payer, or authority reason. | Extend presentation projection and render the option contract. | B |
| Jordan airline response versus whole-trip result | Current Jordan Case | No | Current reported TR885 is already viable; no distinct provider-offer card or event comparison. | Reconcile the external fixture/presentation seam; never call TR885 inadequate. | C, Investigate Now |
| Sarah travel-only failure | Case copy and continuity manifest | Claim only | Current continuity path does not actually perform a pre-commit travel plan/search. | Wire genuine evidence or label a bounded REPLAY presentation; otherwise soften the claim. | B/C |
| Mutation-free programme preview | Live Now/Proposed modal | Partial | Raw ISO entry, anonymous/internal rows, no positive Sarah viability, no organiser identity; 15:30 is only a placeholder. | Prefill human proposal; named structured consequences; explicit no-mutation and organiser state. | A/B |
| Programme commit transition | `Committing…` then fast reload | No | No fan-out/re-evaluation explanation; success is too fleeting. | Use generic commit/progress projection and durable committed notice. | A/B |
| Sarah post-commit terminal | Sarah Case after commit | Wrong | Underlying trip `VIABLE`, visible Case still `DISRUPTED / Needs Attention` with Resolve CTA. | Reconcile viable fan-out case to terminal and persist programme-change history. | B, Act Now |
| Oliver topology delta | Old London chain plus generic options | No | Obsolete inbound not shown; Tokyo proposal and preserved return are absent. | Project generic before/after topology from candidate operations and explicit preserved intent. | B |
| Jonas existing-stay extension | Hotel-switch option cards | Wrong | Replaces Concorde instead of extending it; canonical checkout drift; fireside appears Not booked. | Fix fixture/planning/projection to produce same-property extension and correct baseline. | B, Act Now |
| Role-correct authority | Case approval forms | Partial | `HUMAN_AGENT` copy conflicts with “Approve as organiser”; operator can approve as Jonas; generic auto-book cap contradicts structural rules. | Project principal/reason; place traveller action on Traveller; operator observes. | A/B |
| Currency and funding | Provider/home amounts and funding callout | Partial | `$` is ambiguous; home equivalent looks like a second charge; CTA may use the wrong unit. | Standard currency policy: provider payable first, home-policy equivalent second, payer explicit. | A |
| Approved execution CTA | Case actions | Wrong | Options branch shadows approved Execute for Jordan/Oliver; Begin can coexist with pending approval. | Make CTA lifecycle mutually exclusive and state-derived. | A, Act Now |
| Execution/observation explanation | Fixed execution overlay | Partial | Hardcoded timing/content; simulation not prominent; Jonas traveller-decision bypasses overlay. | Route all execution seams through structured transition presentation with provenance. | B |
| Honest provider result | Activity/result projection | Partial | `simulated` can be buried while copy implies provider confirmation. | Keep REPLAY/REPORTED/SIMULATED badges on transition and terminal history. | A |
| Resolved Case and Overview | Direct Case URL; Confirmed mapping | Partial | Resolved rows lose case link; current tests do not prove revisit; stale open cases can shadow outcome. | Retain case-history link and reconcile terminal projection across Case/Traveller/Overview. | A/B |
| Browser rehearsal evidence | Live product rehearsal | Wrong | Terminal regex can match generic page/CSS terms and does not require execute/final topology. | Assert exact authoritative state, execute response, observed data, and reload/reopen UI. | A, Act Now |

## 9. Gap analysis and triage

Every gap below has both a delivery disposition and the repository-required risk classification.

| Finding | Risk class | Why it matters | Recommended action | Risk of deferring/accepting |
|---|---|---|---|---|
| Approved Jordan/Oliver actions cannot reach Execute in the current Case branch order. | **Act Now** | Judge flow stops before the engine's proven execution/observation path. | Make CTAs mutually exclusive and state-derived; add exact browser assertions. | Hero falsely appears complete while no action occurs. |
| Browser rehearsal terminal detector false-passes generic text. | **Act Now** | Existing closure evidence overstates visible completion. | Require exact state badges, action receipt, final authoritative values, and reload/reopen checks. | Regressions continue to be certified. |
| Sarah remains visibly disrupted after a successful programme re-evaluation. | **Act Now** | It destroys the strongest architecture story at the last screen. | Reconcile/finalise the viable fan-out Case and project durable programme-change history. | Judge sees a failed demo or another flight-recovery loop. |
| Jonas offers hotel switches rather than a Concorde extension. | **Act Now** | This contradicts frozen S5 semantics, funding story, and user wording. | Trace canonical stay ingestion and constrain generic accommodation operation to the requested extension. | Hero proves the wrong capability. |
| Jonas current checkout in acceptance evidence differs from the canonical 3 Oct fixture. | **Investigate Now** | Funding increment and requested duration cannot be trusted until baseline is correct. | Locate fixture/normalisation/projection drift before implementing the screen. | Correct-looking UI may explain the wrong charge/stay. |
| Jordan's desired “inadequate airline solution” conflicts with the current reported viable TR885. | **Investigate Now** | Calling TR885 inadequate would be a false capability claim. | Change only a labelled external fixture/presentation event to a genuinely inadequate reprotection, or use the weaker truthful “unverified until checked” story. | Demo either overclaims or fails the requested contrast. |
| S1 continuity path claims travel recovery is insufficient without demonstrating a pre-commit search. | **Investigate Now** | A judge cannot distinguish evidence from narration. | Wire existing real search/viability evidence or use an explicit REPLAY seam; soften copy until proven. | Northstar appears to jump to changing the programme. |
| Current option projection omits consequences, pros/cons, payer, and authority reason. | **Act Now** | Options read as a generic supplier list. | Add structured presentation fields and render the shared option contract. | All heroes continue to look like booking search. |
| Authority copy/action is role-confused. | **Act Now** | Operator can appear to impersonate Jonas, while Oliver sees human-agent/organiser contradictions. | Project the actual principal and reason; compose traveller decision on Traveller; remove universal cap copy. | Trust and policy proof fail. |
| Currency presentation mixes payable USD and home-equivalent SGD. | **Act Now** | Judge cannot tell cost or payer. | Show explicit provider charge, labelled policy equivalent, and one payer/CTA currency. | Funding story becomes misleading. |
| Commitment chain shows `Not booked` or `pending` for programme obligations. | **Act Now** | The screen contradicts known programme facts and obscures the viability computation. | Separate programme engagement state from reservation status; show check result independently from unknown supplier state. | Terminal screens look unresolved. |
| Fixed progress theatre is not evidence-driven. | **Act Now** | It hides the differentiating Northstar reasoning and can imply fake AI work. | Implement the generic structured progress shell and project actual phases. | Four heroes look identical and less credible. |
| Shared S1 blast radius is not grouped/differentiated. | **Act Now** | The demo misses change propagation and traveller-specific outcomes. | Add a generic source-incident/cohort projection or equivalent Programme impact summary. | S1 looks like four unrelated cases. |
| Oliver's explicit LHR return is still projected as uncertain. | **Investigate Now** | Structural recovery could silently drop critical intent. | Add a generic preserved-return target/constraint or surface the inconsistency as unresolved; do not hide it. | Final topology may be unsafe despite a green headline. |
| Oliver transfer is not represented in seeded evidence. | **Ignore / Accept Risk** for this hero | Claiming a check would be false; transfer is not necessary to prove topology. | Say `not represented` or omit it from completed checks. Revisit only when a real transfer element is added generically. | Minor scope loss; avoids overclaim. |
| Transit hotel, Japan immigration, and insurance execution are not closed S2 capabilities. | **Ignore / Accept Risk** | They are context, not required to prove whole-trip recovery. | Keep hidden from action/result claims; optionally list as unresolved context. | Adding them would expand architecture/provider scope before freeze. |
| Jonas combined hotel plus return-flight change is outside the closed hero. | **Park for Later** | S5 is intentionally hotel-only. | Keep return-flight change in ROADMAP/deferred scope. | No material hero loss. |
| Live provider ticketing/hotel execution is unavailable. | **Ignore / Accept Risk** with disclosure | Internal authority, execution boundary, observation, and state update can still be honestly demonstrated. | Keep provider execution simulated and visibly labelled. | Only unacceptable if the qualifier is hidden. |
| Recovered static HTML contains non-authoritative copy/data. | **Ignore / Accept Risk** | It is a composition reference, not runtime truth. | Reuse structure and hierarchy only. | Copying it verbatim could introduce false facts. |
| Adding scenario/person/airport branches would make the demo brittle. | **Act Now** as a prevention rule | It violates the anti-hardcoding invariant. | Drive generic components from structured presentation data. | Creates unmaintainable demo-only semantics. |

## 10. Generic build versus simulate decisions

### A. Generic + easy — implement

These are reusable presentation/lifecycle changes with no domain redesign:

- fix the mutually exclusive CTA order so approved cases expose Execute and awaiting-authority cases never expose Begin;
- initialise presentation phase from authoritative state, not a hardcoded impacted phase or stale session key;
- standardise money display (`US$`/`USD`, `S$`/`SGD`) and explicitly label payable amount versus home-policy equivalent;
- correct failed-check grammar and positive/negative consequence copy;
- make organiser/traveller labels match the projected principal;
- replace universal spend-cap/auto-book copy with the case's actual authority reason;
- retain a resolved Case/history link from Overview;
- preserve `REPLAY`, `REPORTED`, and `SIMULATED` provenance on the active and terminal screens;
- prefill Sarah's 15:30 proposal and use human-readable Singapore dates/times, leaving advanced raw editing secondary;
- add structured slots for option pros, cons, payer, commitment effect, and authority reason when projection data is available;
- add durable transition/result notices instead of a fleeting reload message;
- strengthen browser rehearsal to assert exact Execute, resolved state, final data, and reload/reopen behaviour.

### B. Generic but nontrivial — investigate, then implement if safe

These are correct generalized capabilities but touch read models, workflow state, or candidate projection:

- build structured transition projection from real ingress, planning, provider-tool, viability, authority, execution, observation, and state-update evidence;
- group one shared provider incident into differentiated cohort outcomes without changing case semantics;
- project evidence-specific recommendation reasoning and complete option consequences;
- project a generic before/after topology delta from candidate operations, including obsolete and preserved elements;
- represent explicit preserved return intent generically and close Oliver's false uncertainty;
- compose Traveller conversation, trip context, progress, funding, and decision instead of making them mutually exclusive;
- reconcile stale/progressive Jordan cases so observed viable recovery becomes the visible terminal case;
- reconcile Sarah's viable post-commit fan-out state to a resolved/Confirmed screen and persist a committed-programme notice;
- join named programme impacts and counterfactual positive viability into the Now/Proposed projection;
- correct Jonas fixture/normalisation drift and make generic accommodation planning produce an extension of the existing stay;
- route traveller-approved execution through the same structured execution/observation presentation as organiser-approved actions;
- provide a stateful hero entry/rehearsal sequence that exposes baseline, event, impact, decision, and terminal states without pre-advancing the judge past the story.

### C. Honest demo simulation/presentation seams

Simulation is permitted only at an external or presentation boundary. Internal ingestion, propagation, planning, viability, authority, programme commit, observation, and state update remain real.

- **S1:** drive the shared airline change as a labelled `SIMULATED SOURCE EVENT`; continue through real per-trip propagation and real programme preview/commit/re-evaluation.
- **S2:** expose progressive delay/miss notifications from the manifest/replay driver. A traveller-reported airline offer is `REPORTED / UNOBSERVED` until supplier evidence exists. To demonstrate an inadequate provider offer followed by a better Northstar option, change only the external fixture to a genuinely inadequate offer; never relabel the viable TR885 as inadequate.
- **S1 travel search:** if real pre-commit search cannot be wired safely, show a bounded `REPLAY` evidence sequence at the search/presentation boundary. Do not fabricate flight execution or imply a paid call.
- **S2 and S7 execution:** show `SIMULATED PROVIDER EXECUTION`, then show real observation, authoritative update, and deterministic viability.
- **S5 execution:** show `SIMULATED HOTEL MODIFICATION`, then show real observed checkout projection, funding record, commitment recheck, and resolution.
- **Optional unavailable dependencies:** describe a transfer, transit hotel, immigration, or insurance item only as unrepresented/unconfirmed context, never as checked or executed.

Simulation disclosure must remain visible in Activity/history and on the terminal result. It must not be hidden in demo-only chrome.

### D. Do not do

- Do not add scenario, person, airport, supplier, fixture-ID, or hero-order branches to the domain engine or reusable UI.
- Do not modify trip/state semantics merely to paint terminal screens green.
- Do not bypass deterministic viability, policy, authority, executor, observation, or state-update boundaries.
- Do not auto-commit Sarah's programme change or imply a programme slot-swap API that does not exist.
- Do not claim Sarah received or bought another flight during S3.
- Do not call the currently reported viable TR885 an inadequate airline solution.
- Do not add transit-hotel insertion, Japan entry/immigration, insurance execution, or live ticketing claims to Jordan.
- Do not invent Oliver transfer evidence or suppress unresolved return-intent uncertainty.
- Do not recolour `UNKNOWN` itinerary elements as confirmed.
- Do not turn Jonas's extension into a hotel switch or add the deferred return-flight change.
- Do not claim a live provider modification for Jordan, Oliver, or Jonas while execution remains simulated.
- Do not copy recovered UI facts or static copy into live presentation without authoritative projection.

## 11. Full implementation checklist

### Shared

- [ ] **Authoritative screen state:** reload at every lifecycle stage renders the same state from backend/read-model truth; `sessionStorage` cannot make an impacted case look planned, approved, or resolved.
- [ ] **Exclusive CTA lifecycle:** each Case shows exactly one valid next action; Begin, Approve, and Execute never coexist or shadow one another.
- [ ] **Execute reachability:** organiser approval for both Jordan and Oliver exposes and completes `Execute approved recovery` in the judge-facing UI.
- [ ] **Structured progress:** one reusable component renders phase, real checks, completion, consequence, provenance, and reduced-motion behaviour from structured data, with no hero-specific branches or fixed fake-thinking timer.
- [ ] **Option completeness:** each primary option shows identity/timing, recommendation reason, pros, cons/uncertainty, cost, currencies, payer, commitment effect, authority, and provenance; no more than three are expanded.
- [ ] **Currency clarity:** provider payable and home-policy equivalent use unambiguous currency notation and cannot be mistaken for two charges.
- [ ] **Authority clarity:** UI names the correct principal and reason; structural flight change never inherits generic auto-book-under-cap copy.
- [ ] **Role-correct action:** organiser screens cannot approve as a traveller; Traveller composes request, trip context, funding, and decision when traveller authority is required.
- [ ] **Evidence provenance:** `LIVE`, `RECORD`, `REPLAY`, `REPORTED / UNOBSERVED`, and `SIMULATED` remain visible through progress, result, and history.
- [ ] **Commitment semantics:** programme engagements do not appear `Not booked` merely because they are not supplier reservations; PASS/FAIL/UNKNOWN remains evidence-based.
- [ ] **Resolved persistence:** resolved Case, Traveller, and Overview agree after reload; Overview retains a link to resolved Case history without reviving actions.
- [ ] **Exact rehearsal gate:** browser evidence requires the intended CTA sequence, execution/commit receipt, observed authoritative values, terminal status, and reload/reopen state; generic page text cannot satisfy it.
- [ ] **Recovered structure:** Case and Programme use recovered hierarchy where it improves comprehension, while all facts come from current read models/evidence.
- [ ] **Accessibility:** progress/result changes are announced, status never relies on colour alone, keyboard option selection remains supported, and reduced motion is respected.
- [ ] **Anti-hardcoding gate:** two materially different heroes render through the same state/progress/option/authority components without scenario, person, airport, supplier, or fixture-ID branches.

### Jordan — S2

- [ ] **Baseline and progression:** judge can see viable/tight/missed change states or an honest condensed Activity history before recovery starts.
- [ ] **Missed connection:** Case explicitly identifies the impossible/missed NRT→SIN connection and separates provider response from Northstar's assessment.
- [ ] **Provider truth:** current TR885 is never called inadequate; an inadequate provider-offer story is shown only after a labelled external fixture supplies one truthfully.
- [ ] **Whole-trip comparison:** recommendation visibly shows 20:45 showcase, 360-minute requirement, 14:35 arrival, and `370 ≥ 360` PASS.
- [ ] **Option evidence:** actual flight/timing and `US$90.54` provider charge plus `S$122.23` policy equivalent are projected with payer and REPLAY provenance.
- [ ] **Organiser authority:** staged recovery waits for organiser, explains why, and performs no execution before approval.
- [ ] **Execution and observation:** simulated ticketing is disclosed; observed trip update and showcase recheck are distinct visible phases.
- [ ] **Terminal state:** Jordan Case and Overview are resolved/Confirmed on revisit with the recovered sector and showcase buffer; no transit-hotel, immigration, or insurance execution is claimed.

### Sarah — S1→S3, no reset

- [ ] **Shared incident:** one schedule-change callout shows four changed travellers, three viable Wanderpay speakers, and Sarah critical, with names and simulated-source provenance.
- [ ] **Sarah failure:** Case shows actual replacement arrival, 09:20 headline, actual gap, 360-minute requirement, and unambiguous FAIL.
- [ ] **Travel-first evidence:** UI demonstrates evidenced travel-only failure or labels the bounded REPLAY seam; it never asserts an unperformed search.
- [ ] **Programme recommendation:** Case explains why moving the programme is better than purchasing another flight and shows no-flight-purchase consequence.
- [ ] **Mutation-free preview:** NOW 09:20 and PROPOSED 15:30–16:00 appear in human time; cancelling leaves programme and all trips byte-for-byte/semantically unchanged.
- [ ] **Named blast radius:** Sarah and Elena show actual counterfactual outcomes; Daniel is labelled local/changeable context unless genuinely linked; unaffected count matches evidence.
- [ ] **Organiser commit:** programme remains unchanged until explicit organiser Commit; no raw ISO typing is required for the hero path.
- [ ] **Commit propagation:** progress visibly shows programme update, linked-trip fan-out, and same Sarah trip re-evaluation.
- [ ] **No flight execution:** terminal history states that the existing airline itinerary became viable and no new flight was bought.
- [ ] **Terminal convergence:** without reset, Programme shows 15:30, Sarah Case is resolved, Overview is Confirmed/green, and reload/reopen preserves the same trip and change history.

### Oliver — S7

- [ ] **Original topology:** judge can see London inbound, Singapore stay/commitment, and explicit London return before the request.
- [ ] **Traveller intent:** message visibly captures Tokyo origin and preserved LHR return; original trip remains unchanged before approval.
- [ ] **Topology delta:** Case marks London inbound obsolete-if-approved, shows HND/NRT→SIN proposal, and preserves SIN→LHR in NOW/PROPOSED form.
- [ ] **Evidence-scoped checks:** event and stay consequences use real evidence; transfer is labelled unrepresented rather than falsely checked.
- [ ] **Option evidence:** recommendation shows actual replay route/timing, `US$143.62`, `S$193.89` equivalent, payer state, pros/cons, commitment effect, and organiser authority; alternative `US$163.98` is clearly differentiated.
- [ ] **Return intent:** explicit LHR return is represented as a preserved constraint or surfaced as unresolved; it is never silently dropped.
- [ ] **Structural authority:** copy says organiser and explains structural change; no generic HUMAN_AGENT ambiguity or automatic-cap promise remains.
- [ ] **Execution and observation:** simulated flight execution is disclosed; observed topology update and viability checks are visible.
- [ ] **Terminal topology:** reload/reopen proves Tokyo inbound plus unchanged LHR return, resolved Case, correct authority/cost history, and no invented transfer confirmation.

### Jonas — S5

- [ ] **Correct baseline:** canonical Concorde stay ends 3 Oct 11:00, the fireside is satisfied, and acceptance/runtime evidence no longer drifts to another checkout.
- [ ] **Extension language:** every screen says extend the existing Concorde stay through Sunday; no primary strategy says switch to Value Hotel, Hotel Sakura, J8, or another property.
- [ ] **Same-property proposal:** planner/read model returns a genuine same-property extension or the hero stops honestly rather than filling cards with unrelated hotels.
- [ ] **Funding split:** screen says event-funded baseline unchanged, Jonas pays only the increment, provider charge `US$223.94`, and policy equivalent `S$302.32`.
- [ ] **Commitment protection:** fireside remains visibly satisfied before, during, and after the extension; it never appears `Not booked`.
- [ ] **Traveller authority:** Jonas receives `Approve extension and pay US$223.94` on Traveller; operator only sees `Waiting for Jonas`; no organiser approval is created.
- [ ] **Execution transition:** traveller approval enters the same generic execution/observation choreography and visibly discloses simulated hotel modification.
- [ ] **Observed stay:** resolved Traveller/Case shows the same Concorde property and 4 Oct 11:00 checkout with funding and authority history.
- [ ] **Revisit correctness:** after reload, Overview is Confirmed/green and opens resolved Case history; no stale approval or Resolve CTA returns.
- [ ] **Scope discipline:** no return-flight modification is implied or executed in the closed S5 hero.

## Source audit notes

This contract was derived in the required order from:

1. `docs/SCENARIOS.md`;
2. `docs/FINAL_DEMO_CONTENT_SSOT.md`;
3. `docs/UI_VISUAL_DIRECTION.md`;
4. `docs/FINAL_DEMO_INTEGRATION_PLAN.md`;
5. `docs/recovered_ui/**` as structure/reference only;
6. `docs/ui-audit/R3D_HUMAN_ACCEPTANCE_CLOSURE.md`;
7. current UI, application, read-model, planner, execution, fixture, and manifest code;
8. current acceptance and browser-rehearsal evidence/screenshots.

Where the closure matrix and current judge-facing evidence disagree, this contract follows verified code/runtime evidence and classifies the difference above. It does not reopen architecture or scenario ideation.
