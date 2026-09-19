# NORTHSTAR Legacy Frontend Product Baseline — Astra Handoff

Post-R4 use: baseline remains the product floor. Read [A0 reconciliation](ASTRA_A0_CONVERGENCE.md)
for gaps checked against accepted R4 `2baf1f6`; older comparison findings below
must not override final-R4 code/evidence or the accepted frontend decisions.

**Authoritative frontend baseline:** 20454aa7f16e18cf07eb1558481637f8a18f2d09\
**Repository:** dropandresetmain-prog/qoder-atlas\
**R4 contract independently checked:** integration/r4-final-acceptance:docs/work/R4_FRONTEND_PARITY_CONTRACT.md\
**R4 contract blob inspected:** 5698bbe4b6d27bc169cd75c78a2ef9c416618dfd

The baseline below is a **product-quality floor**, not a request to restore the old persistence/runtime architecture. V5.6 may replace the old Case causal chain visual. V7.2 may introduce the new Event Overview visual. Those are the two major accepted visual adaptations. Everything else needs an explicit product reason before it is weakened or removed.

---

# 1. Executive finding

## What the legacy frontend actually was

The pre-refactor frontend was a **coherent product interface with a real design system and interaction model**, not merely a hackathon demo shell.

There was explicit product architecture behind it:

- a unified operator shell;
- a deliberately separate mobile-first traveller register;
- a shared state palette and typography system;
- consistent loading, error, empty and unknown-state behaviour;
- deterministic presentation mappings separating backend state from user language;
- structured Case, Programme, Decisions and Activity view models;
- real action forms wired to runtime endpoints;
- staged progress around real operations;
- approval and authority guards;
- funding presentation;
- progressive disclosure;
- cross-surface navigation;
- accessibility and responsive behaviour;
- extensive UI contract tests covering not just existence of data, but **what users see, in what order, and which actions become available at each state**.

docs/DESIGN.md explicitly described the two-register system as:

- operator = dense “glass cockpit”;
- traveller = warm, minimal “concierge desk”;
- one common state palette, type stack and interaction language.

That design intent is materially reflected in src/ui/theme.ts.

The demo controls were an additional development surface clearly labelled **“This is not part of the product UI.”** They do not make the product itself a demo shell.

## Minimum interpretation for convergence

“At least as good as pre-refactor” therefore does **not** mean:

> all old information technically exists somewhere in PostgreSQL or a graph.

It means the operator or traveller can still answer the same questions, discover the same necessary actions, understand the same uncertainty and authority boundaries, and complete the same user jobs with at least equivalent clarity.

There are also several places where the current R4 parity contract is too compressed and would permit regressions if Astra followed it literally. Those are detailed in §7.

Two particularly important corrections:

1. **The legacy Case journey chain and the legacy sticky Case rail were different things.**\
   V5.6 justifiably replaces the old journey-chain causal visual. It does **not automatically retire** the commitment/context/authority rail or the option-specific whole-trip decision evidence.

2. **The legacy Traveller surface deliberately did not use the operator navigation shell.**\
   The R4 statement about putting event name + decision count on “every page incl. Traveller” is not legacy parity. Traveller had its own compact mobile topbar with event context, not operator navigation.

A smaller documentation drift also exists inside the legacy sources themselves. For example, docs/DESIGN.md describes fleet ordering as urgency-based and UNKNOWN cells as hollow grey, while the authoritative legacy implementation/tests explicitly enforce **earliest upcoming commitment ordering** and a **filled grey Unconfirmed treatment distinct from Local/self-arranged**. For this baseline, code + tests at the exact SHA win.

---

# 2. Surface-by-surface minimum baseline

## 2.1 Overview

| Dimension | Legacy baseline |
|---|---|
| **LEGACY USER JOB** | Understand managed-travel readiness across the entire event population in seconds; see urgent work without losing context on everyone else; move directly into a Case or traveller interaction. |
| **INFORMATION HIERARCHY** | 1. Operations heading/context. 2. Managed readiness readout. 3. Fleet representation of **all participants**. 4. Needs-attention queue. 5. Searchable All Participants roster. |
| **PRIMARY ACTIONS** | Open an attention Case; open an active Case from its participant row. |
| **SECONDARY ACTIONS** | “Show interaction” → Traveller surface. Programme link when provided. Search roster. Page through roster. Historical Case remained discoverable. |
| **LOADING / PROGRESS** | Dedicated loading panel: “Loading the trip overview”; skeletons; no fake participant data. |
| **ERROR / EMPTY STATES** | Dedicated error panel. No fabricated rows. Needs-attention section disappears when there is nothing to show rather than inventing work. |
| **COPY / LANGUAGE RULES** | “Managed travel readiness”, “Confirmed”, “Needs Attention”, “Watching”, “Unconfirmed”, “Local / self-arranged”. Internal trip IDs and severity tags sanitized. |
| **INTERACTION BEHAVIOUR** | Attention-first sorting. Search resets pagination. Page size 10. Active Case is primary row target; Traveller interaction remains separately accessible. |
| **VISUAL STRUCTURE** | Two-column hero readout: dark readiness block + fleet grid; then attention queue; then full roster. Dense but readable operator layout. |
| **IMPORTANT TESTED INVARIANTS** | Entire population remains visible; managed denominator excludes local/self travel; disrupted/open cases surface without search; Local is distinct from Unconfirmed; active Case and Traveller interaction coexist; attention precedes healthy rows; fleet ordering by earliest upcoming commitment. |

### The old managed-population model

The Overview did not revolve around “open cases”. It revolved around **the managed population**.

The readiness calculation showed:

confirmed managed travellers / all Northstar-managed travellers

alongside explicit scale context:

Northstar-managed · local/self · total participants

The four managed-travel presentation buckets were:

- Confirmed
- Needs Attention
- Watching
- Unconfirmed

“Local / self-arranged” was **not a fifth workflow status**. It was a travel-arrangement cohort.

This distinction mattered. A local/self-arranged traveller could be touched by a shared event incident and display as Watching without incorrectly becoming an operator recovery task. Conversely, an actual pending traveller decision still elevated attention.

### Attention was additive, not substitutive

The most important old Overview invariant was:

> **Needs Attention never replaced All Participants.**

The UI simultaneously provided:

- whole-population status;
- current work queue;
- full roster.

That is a critical minimum for V7.2. The new Event Overview Graph may improve situational understanding, but it cannot turn the Overview back into an incident-only or Case-only page.

### Shared-incident intelligence

The old Overview also did more than list independent cases.

When multiple trips shared one source incident, it grouped them into a shared incident callout such as a shared airline change and showed differentiated consequences underneath it:

- critical;
- watching;
- still workable.

This was based on incident identity, **not similar description text**.

That is a meaningful product capability and is under-specified by the R4 contract.

### Roster depth

Each roster row could expose:

- traveller;
- role/event context;
- compact journey-state marks when available;
- what changed/current issue;
- “Working: …” system activity;
- “Still unclear: …” uncertainty;
- presentation status;
- update freshness;
- active/history Case destination;
- separate Show interaction traveller destination.

V7.2 may change how much of that needs to remain inline, but equivalent access and comprehension must survive.

---

## 2.2 Case

| Dimension | Legacy baseline |
|---|---|
| **LEGACY USER JOB** | Understand what changed, what it breaks downstream, what Northstar checked, what recovery is being proposed, who must approve, what it costs, what is currently happening, and whether the **whole trip** is recovered. |
| **INFORMATION HIERARCHY** | Header/status → lead change/decision callout → evidence progression → trip causal state → downstream impact → next action → selected recovery when staged → checks → activity → authority/funding → resolution/uncertainty, with persistent contextual rail. |
| **PRIMARY ACTIONS** | Find a recovery → Begin recovery → appropriate approval/decision → Execute approved recovery → return to Overview once resolved. |
| **SECONDARY ACTIONS** | Decline; escalate where permitted; open Traveller surface when traveller approval is required; inspect alternative/rejected recovery options; programme-change preview where applicable. |
| **LOADING / PROGRESS** | Case loading panel; option-forming skeleton; status stepper; staged lifecycle overlay around real plan/begin/execute operations; action rows with queued/in-progress/done/failed. |
| **ERROR / EMPTY STATES** | Case projection can fail closed instead of guessing. Explicit planning-exhausted state. Explicit all-options-rejected state. Explicit unresolved uncertainty. |
| **COPY / LANGUAGE RULES** | “What happened”, “What this affects”, “What we checked”, “Selected recovery”, “What you’re approving”, “What Northstar is doing right now”, etc. No raw authority, strategy, signal, rule or provider internals. |
| **INTERACTION BEHAVIOUR** | CTA determined from authoritative Case phase. Browser state could not resurrect a stale action. Candidate cards not dumped immediately. Traveller approval could not be performed by operator. Decline never executed. |
| **VISUAL STRUCTURE** | Two-column workspace on desktop: narrative/action column + sticky contextual rail. Single column under 900px. Strong progressive disclosure for options. |
| **IMPORTANT TESTED INVARIANTS** | Impact before CTA; selected recovery before approval; no Resolve after options exist; no Begin while approval pending; no Execute before approval; resolved case has no recovery CTA; rejected option requires reason; recovered-with-loss must disclose loss; traveller approval hands off to traveller; human-agent enum never appears. |

---

## 2.3 Programme

| Dimension | Legacy baseline |
|---|---|
| **LEGACY USER JOB** | Understand the event programme, which commitments are threatened, which travellers need attention or information, and what a proposed programme change would do before committing it. |
| **INFORMATION HIERARCHY** | Event heading → population scale + health summary → committed/change notices → endangered commitments → programme timeline → missing traveller information → traveller roster → programme actions. |
| **PRIMARY ACTIONS** | Open affected Case; preview a programme change; navigate to traveller/Case. |
| **SECONDARY ACTIONS** | Show interaction; message affected travellers; import updated sheet; export roster; inspect affected travellers on duplicate commitments. |
| **LOADING / PROGRESS** | Honest loading panel. Committed changes can briefly receive “just changed” treatment. |
| **ERROR / EMPTY STATES** | Honest error panel. Endangered section omitted when empty. Missing-info section omitted when empty. Timeline omitted if not supplied. Zero attention/watch counts treated as healthy zero states. |
| **COPY / LANGUAGE RULES** | Event/traveller vocabulary, not graph vocabulary. Timeline strings already event-local from projection; UI does not silently re-time them. |
| **INTERACTION BEHAVIOUR** | Attention-first traveller ordering. Timeline deduplicates repeated programme commitments. Proposed programme changes are explicitly previewed before commitment. |
| **VISUAL STRUCTURE** | Summary tiles; alert callouts; compact day/time timeline; fixed-column traveller table; modal preview for programme change. |
| **IMPORTANT TESTED INVARIANTS** | Every traveller remains present at scale; timeline duplicate commitment renders once; affected names remain drillable; active Case and Traveller access coexist; proposed-change backdrop is inert; “Preview · no changes made yet”; no fake action if commit route unavailable. |

### Programme capabilities beyond “roster + timeline”

The R4 contract’s one-line description materially understates the legacy Programme surface.

The legacy frontend included:

- managed/local population accounting;
- endangered commitments;
- affected-traveller count;
- optional direct Case navigation;
- event timeline;
- deduplication of traveller-specific copies of the same programme commitment;
- expandable affected-traveller list for a shared commitment;
- explicit missing-information panel;
- traveller-facing navigation even when no Case exists;
- active Case discoverability where one does exist;
- programme-change preview;
- Now vs Proposed comparison;
- population impact explanation;
- alternatives;
- “nothing has changed yet” framing;
- committed-change confirmation;
- brief changed-item wash;
- intake/import UX.

The intake screen was not the centre of daily operations, but it was real legacy capability and should not disappear accidentally.

---

## 2.4 Decisions

| Dimension | Legacy baseline |
|---|---|
| **LEGACY USER JOB** | See every place Northstar is waiting on a person and verify recent human decisions. |
| **INFORMATION HIERARCHY** | “Waiting now” first; “Decided recently” second. |
| **PRIMARY ACTIONS** | Open the relevant Case from a pending decision. |
| **SECONDARY ACTIONS** | Open completed Case when a Case reference exists. |
| **LOADING / PROGRESS** | Dedicated loading panel. |
| **ERROR / EMPTY STATES** | “Nothing is waiting on a person right now.” / “No recent decisions to show yet.” Missing cost/waiting/decide-by/age facts render —, not guessed values. |
| **COPY / LANGUAGE RULES** | “Every place Northstar is waiting on a person — nothing waits silently.” Human-facing actor names. |
| **INTERACTION BEHAVIOUR** | Pending and historical decisions are separate. Case links only where supported by supplied state. |
| **VISUAL STRUCTURE** | Compact operator tables using shared typography, badges and panels. |
| **IMPORTANT TESTED INVARIANTS** | Real authority projection preserved; TRAVELLER → Traveller, HUMAN_AGENT → Organiser; no invented deadlines/cost/history. |

A current surface that only shows pending approval references is not parity. “Decided recently” was part of the user job.

---

## 2.5 Activity

| Dimension | Legacy baseline |
|---|---|
| **LEGACY USER JOB** | Understand what happened, who was involved, and what Northstar did, in chronological plain language. |
| **INFORMATION HIERARCHY** | Day group → activity rows: glyph · actor · action · optional detail · time. |
| **PRIMARY ACTIONS** | None inside the feed. It was an audit/read surface. |
| **SECONDARY ACTIONS** | Page through history. Operator nav provides movement elsewhere. |
| **LOADING / PROGRESS** | Dedicated loading panel. |
| **ERROR / EMPTY STATES** | Dedicated error panel; “No activity recorded yet.” |
| **COPY / LANGUAGE RULES** | Internal actors translated. Providers becomes “Travel provider”; app:* becomes Northstar; raw enum-like action text falls back to human wording; internal trip/place IDs stripped. |
| **INTERACTION BEHAVIOUR** | 20 events/page; day headings remain associated only with visible rows. |
| **VISUAL STRUCTURE** | Lightweight chronological feed, state-toned glyphs, day headers. |
| **IMPORTANT TESTED INVARIANTS** | Pagination 20; raw Providers actor not visible; internal IDs sanitized. |

### Correction to R4 contract

The R4 contract says:

> “Case rows linked from Decisions/Programme/Activity — PRESERVE.”

That is not accurate as a statement of legacy Activity behaviour.

The legacy operator-activity.ts feed had **no Case links in its row model or renderer**. Decisions and Programme did. Activity did not.

Adding Activity→Case navigation could be a legitimate improvement, but Astra must not treat it as evidence of legacy parity.

---

## 2.6 Traveller

| Dimension | Legacy baseline |
|---|---|
| **LEGACY USER JOB** | Answer, in this order as appropriate: Am I okay? What changed? What matters? Is the rest of my trip okay? What do you need from me? What is Northstar doing? What is my new plan? |
| **INFORMATION HIERARCHY** | Compact traveller topbar → status hero → change/commitment story → viability → requested input → progress → resolution → concierge composer. Ordering adapts to disruption vs healthy state. |
| **PRIMARY ACTIONS** | Make a requested choice; send Northstar a change/request message. |
| **SECONDARY ACTIONS** | Review itinerary, commitment, viability and progress. |
| **LOADING / PROGRESS** | “Checking your trip”; skeleton state; progress rows; option-forming skeleton when applicable. |
| **ERROR / EMPTY STATES** | “We can’t show your trip right now.” Healthy trips omit unnecessary warning blocks. Choice controls do not render unless a real decision is required. |
| **COPY / LANGUAGE RULES** | Status-specific traveller copy. Clear reassurance where trip changed but remains viable without falsifying machine status. “Nothing is booked until you choose.” |
| **INTERACTION BEHAVIOUR** | Traveller decision posts through real decision seam. Composer posts through generic change-request seam. Already answered requests show response timestamp. Thread-first mode exists when conversation history is supplied. |
| **VISUAL STRUCTURE** | Separate mobile-first 480px concierge surface: photo/ink hero, serif headline, commitment card, itinerary rows, rich choice cards, full-width touch actions, chat composer. |
| **IMPORTANT TESTED INVARIANTS** | Choice cards only when input is required; DISRUPTED+VIABLE may say “Your trip changed, but still works” while underlying status stays DISRUPTED; no operator shell; commitment remains visible; no booking implied before choice. |

### Important shell boundary

Traveller explicitly rendered **without operator chrome**.

Its own topbar contained:

- Northstar;
- optional event name.

It did **not** contain:

- Overview;
- Programme;
- Decisions;
- Activity;
- operator avatar;
- decision count.

That separation is part of the product baseline.

---

## 2.7 Shell / navigation

| Dimension | Legacy baseline |
|---|---|
| **LEGACY USER JOB** | Move predictably between the main operator work surfaces while retaining event context. |
| **INFORMATION HIERARCHY** | Sticky topbar: Northstar → event → Overview / Programme / Decisions(count) / Activity → environment/profile context. |
| **PRIMARY ACTIONS** | Surface navigation. |
| **SECONDARY ACTIONS** | Profile/admin controls; optional reset in profile; demo controls only when explicitly in demo tooling. |
| **LOADING / PROGRESS** | Page body state changes independently from stable shell. |
| **ERROR / EMPTY STATES** | Surface-specific states render inside the shell rather than replacing navigation semantics. |
| **COPY / LANGUAGE RULES** | Product nav is short and user-facing. Development mode is explicitly labelled. |
| **INTERACTION BEHAVIOUR** | Case marks Overview active and has ← Overview; resolved Case has “Back to Overview”. |
| **VISUAL STRUCTURE** | Sticky compact shell; event context; Decisions badge; responsive nav. Traveller intentionally outside it. |
| **IMPORTANT TESTED INVARIANTS** | Decisions and Activity are real served routes reachable through nav; normal product pages omit demo banner; demo tooling may opt into it. |

### Demo controls

Legacy demo tooling was explicitly development-only.

There were two distinct mechanisms:

1. optional reset as a **secondary profile/admin action**;
2. dedicated /demo panel containing reset, scenario rehearsal, hero launch and product-page links.

The normal product pages were tested to **omit the demo banner**.

Therefore, R4’s persistent reset control is an **intentional convergence adaptation**, not a historical parity requirement.

Retiring the /demo route itself can be justified if its development/rehearsal capabilities remain available elsewhere. Retiring the capabilities merely because the route is old is not justified.

---

# 3. Shared design system

## Typography

The product used three main registers:

| Register | Use |
|---|---|
| Sans | Main interface, sentences, headings, operator information |
| Mono | Data, times, counts, labels, badges, metadata |
| Serif | Traveller-facing hero/commitment emphasis |

Implementation at the baseline used a 16px body foundation, strong ~17px section headings, larger page titles, and deliberately small mono metadata.

The operator surfaces were **dense, not tiny**.

The traveller surface was intentionally more spacious and narrative.

## Spacing and density

Operator:

- max content width around 1180px;
- compact 24px-ish page gutters;
- 12–20px inter-component gaps;
- rows designed to let an operator scan many travellers without card explosion.

Traveller:

- max ~480px;
- 16px gutters;
- one major idea at a time;
- full-width/touch-friendly actions.

## Cards and panels

Shared conventions:

- white/light surfaces;
- quiet border;
- modest rounded corners;
- restrained shadow;
- stronger tinted edge/background only when state mattered.

Cards were not decorative containers for every datum. They created visual hierarchy.

## Badges

Badges were:

- compact;
- mono;
- uppercase;
- explicit text + indicator.

UNKNOWN never depended on grey alone; the neutral badge deliberately added a ?.

## State palette

Colour had semantic meaning:

- green = confirmed / healthy / done;
- brass = proposed / waiting / changed / needs attention but not broken;
- vermilion = broken / blocked / immediate human intervention;
- grey = unknown / unconfirmed / unbooked;
- ink = active system work.

Colour was not used casually for branding decoration.

## Buttons

Primary:

- dark ink;
- high contrast;
- minimum useful target height;
- one dominant next action.

Secondary:

- bordered ghost style.

Destructive/decline:

- red text/border;
- visually secondary to the safe primary path.

Disabled operations were visibly disabled.

## Callouts

Callouts were used for semantic moments:

- what happened;
- waiting on decision;
- alert;
- resolved;
- programme change;
- commitment risk.

They used state tint and left-edge emphasis rather than oversized banners.

## Sticky/context rails

Case desktop used a real sticky right rail containing:

- commitment at stake/held;
- projected Case facts;
- authority explanation.

Under 900px this became normal-flow content.

This rail is **not the old journey chain**.

## Progress treatment

Three levels existed:

1. a small Case stepper for high-level lifecycle progression;
2. action rows for real individual stages;
3. modal lifecycle progress during plan/begin/execute.

Progress represented understandable work such as:

- re-checking trip;
- searching recovery options;
- checking policy;
- applying approved change;
- confirming provider result;
- updating trip record;
- rechecking the trip.

This was presentation choreography around real operations, not exposed model chain-of-thought.

Browser memory was explicitly prohibited from deciding whether the Case was impacted, approved, executing or resolved.

## Responsive patterns

At ≤900px:

- Overview readout stacked;
- Case became one column;
- rail stopped sticking;
- intake became one column.

At ≤720px:

- gutters tightened;
- summary tiles became two columns;
- roster/queue rows collapsed sensibly;
- long issue text wrapped;
- topbar reduced;
- profile identity collapsed to avatar;
- progress grids reduced columns.

Traveller was mobile-first from the start.

## Motion

Motion was deliberately constrained:

- entry stagger;
- short “settle” animation after state change;
- subtle hover movement;
- one breathing LIVE dot.

prefers-reduced-motion disabled the motion system.

No decorative cinematic movement was part of the baseline.

---

# 4. Case product flow: disruption → resolution

The old Case was not a static report. It was a stateful recovery workspace.

## Stage A — Disruption

The first job was to explain the problem before asking the operator to act.

Visible structure included:

- traveller/trip identity;
- plain-language status badge;
- update time;
- ← Overview;
- “What happened” lead callout;
- optional “How this unfolded” chronology;
- trip causal state;
- “What this affects” downstream consequences;
- commitment at stake;
- unresolved uncertainty.

Only then did the recovery CTA appear.

### V5.6 implication

The old journey-chain visual can retire here.

V5.6 should replace its job:

> show how the trip currently fits together and where the disruption propagates.

The following should survive around it:

- header/status;
- change callout;
- status/evidence timeline;
- explicit downstream consequence explanation;
- commitment context;
- uncertainties;
- next-action hierarchy.

The graph should not swallow all of these into nodes and expect the operator to infer the narrative.

---

## Stage B — Investigation

Initial CTA:

**Find a recovery**

The legacy copy told the operator what would happen:

- re-check the whole trip;
- compare workable fixes;
- identify who must approve what;
- do that before anything is booked.

During the real planning request, the UI showed understandable lifecycle stages.

If no candidate existed:

- the Case explicitly said planning had been exhausted;
- showed what had been checked;
- said **nothing had been changed**;
- offered human escalation.

If every candidate failed:

- rejected candidates remained visible with reasons;
- the Case said no automated option worked;
- escalation became available.

There was no endless “try again” illusion.

---

## Stage C — Recommendation

A key legacy invariant was **impact-first disclosure**.

Candidate data being available did not mean the UI dumped six strategy cards immediately.

When options had been projected:

- Resolve disappeared;
- the next state became “Recovery options ready”;
- the operator got **Begin recovery**, not another Resolve action.

Once a recommendation had been staged and authority became relevant:

- exactly one selected recommendation became dominant;
- alternatives were collapsed into “Other options considered”;
- rejected options remained inspectable;
- rejection reasons stayed visible.

A recommendation could explain:

- title;
- summary;
- why recommended;
- provider payable amount;
- approximate policy/home-currency equivalent;
- payer allocation;
- authority required;
- pros;
- cons;
- effect on commitment;
- flags/consequences;
- explicit rejection reason;
- whole-trip before/after plan;
- known incremental cost;
- cost notes;
- items checked vs executable vs manual/provider follow-up.

### V5.6 implication

Do **not** assume that V5.6 makes option decision evidence redundant.

V5.6 replaces the causal-state visual.

A recommendation card answers a different question:

> “Why should I choose or approve this recovery?”

Option-specific Before → After, trade-offs, cost and authority still need a clear decision surface, even if graph state is richer.

---

## Stage D — Approval / authority

Legacy authority handling was strict.

If traveller approval was required:

- operator could **not** approve on traveller’s behalf;
- UI said “Traveller decision required”;
- named who was being waited on where possible;
- linked to Traveller view.

If organisation approval was required and a valid approver existed:

- “What you’re approving” panel;
- reason;
- amount;
- funding allocation;
- Approve as organiser;
- Decline.

If the system knew organisation approval was required but no valid in-scope principal was available:

- it explicitly said so;
- nothing appeared approved.

HUMAN_AGENT never appeared as user wording.

Another important truthfulness invariant:

> Before Begin/authority evaluation ran, the UI did not claim “no approval required.”

Authority was discovered by the real flow.

### Funding

Funding presentation could distinguish:

- programme/organisation-funded;
- traveller-funded incremental amount;
- mixed funding.

The payable provider amount and policy/home-currency restatement were not presented as two separate charges.

Unknown/incomplete allocation was omitted rather than fabricated.

---

## Stage E — Execution

After approval:

- Approve disappeared;
- Resolve disappeared;
- Begin disappeared;
- primary action became **Execute approved recovery**.

Executing state said Northstar was:

- applying the approved recovery;
- checking the supplier result;
- rechecking the trip.

The progress overlay explicitly included:

1. applying approved change;
2. confirming provider result;
3. updating trip record;
4. rechecking the rest of the trip.

This is an important product invariant:

> execution success was not equated with trip recovery before observation and reassessment.

---

## Stage F — Resolution

Only authoritative resolved state produced:

- recovered status;
- resolution callout;
- loss disclosure where applicable;
- “What changed” record;
- action history;
- funding/approval history;
- “Back to Overview”.

A recovered-with-loss Case had to say what could not be kept.

Resolved Cases exposed **no recovery CTA**.

### Elements to preserve around V5.6

Preserve or equivalently reproduce:

- Case header/status/back navigation;
- “What happened”;
- “How this unfolded” where evidence exists;
- explicit downstream consequences;
- commitment at stake/held;
- authoritative phase-derived primary CTA;
- impact-first recommendation sequencing;
- selected recommendation;
- alternatives/rejected disclosure;
- rejection reasons;
- whole-trip option comparison;
- cost and funding;
- authority guard;
- traveller handoff;
- planning-exhausted state;
- all-rejected state;
- escalation;
- “What we checked”;
- real work/progress;
- execution/observation/recheck progression;
- resolution with remaining losses;
- uncertainties.

Replace only the old journey-chain causal visual with V5.6 unless a separate capability is demonstrably represented at least as clearly elsewhere.

---

# 5. Overview managed-population model and attention layering

The legacy Overview had four conceptual layers.

## Layer 1 — Programme scale

The user immediately knew:

- total participants;
- Northstar-managed count;
- local/self-arranged count.

This prevented misleading health statistics.

A local/self-arranged traveller did not inflate the managed “Confirmed” numerator.

## Layer 2 — Managed travel readiness

The large readout answered:

> How much of the travel we actually manage is confirmed?

Then the subordinate state segments answered:

> What is left, and of what type?

Confirmed / Needs Attention / Watching / Unconfirmed.

## Layer 3 — Whole-population visual context

The fleet grid represented all participants simultaneously.

It was not a queue.

Its purpose was population context and anomaly perception.

The implementation/test baseline sorted these cells by earliest upcoming commitment, with missing commitment time last.

## Layer 4 — Action queue + full roster

The Needs Attention queue answered:

> What should I work on?

The full roster answered:

> What is happening to everyone else?

Both remained on screen.

This is the fundamental Overview parity rule for V7.2:

> **Situation awareness and work queue must coexist.**

The graph may become the strongest visual expression of population dependencies, but it cannot erase the population, status distribution, urgent work or roster.

---

# 6. User-language boundary

## Explicit forbidden/internal vocabulary

The legacy FORBIDDEN_UI_TERMS included:

| Internal concept prohibited from primary UI |
|---|
| graph node |
| TripSignal |
| dependency propagation |
| RecoveryStrategy |
| deterministic evaluator |
| blast radius |
| ontology |
| read model / readmodel |
| scenario overlay |
| planner |
| schema |
| mutation |
| Atlas sandbox IDs beginning atlsbx- |
| ruletrace / rule trace |
| caseId |
| intentId |
| strategyId |
| signalId |
| offerId |
| internal hotel/place IDs |
| provider flight state |
| raw schedule_changed |
| human agent / HUMAN_AGENT-derived language |
| requires_human_agent |
| fully_recovered |
| recovered_with_loss |
| escalated_closed |
| search evidence |
| provider boundary |
| soft tradeoffs |
| evidenced option |
| required arrival buffer |
| recorded provider response |
| live provider response |
| execution: simulated |

The rule was not that these concepts could never exist in the DOM or system.

Machine values could remain in:

- data-*;
- hidden form inputs;
- audit/debug state;
- endpoint paths.

They could not become **primary visible product language**.

## Historical mechanisms that enforced the boundary

### 1. copy.ts

Central fixed mapping for:

- statuses;
- traveller headlines;
- viability;
- option verdicts;
- resolution outcomes;
- Case headings;
- authority wording;
- Programme wording.

### 2. Presentation-state projection

Backend statuses were reduced into user-facing operator buckets rather than dumping backend lifecycle states onto the Overview.

### 3. Presentation sanitizers

Activity actors, raw IDs, evidence text and transport semantics were converted before rendering.

Examples:

- Providers → “Travel provider”;
- app:* → “Northstar”;
- HUMAN_AGENT → organisation/organiser language;
- temporal evaluator evidence → “Arrival still leaves enough time before the commitment.”

### 4. Explicit user-facing rejection reasons

A NOT_VIABLE option could not render as an unexplained red state.

The Case consistency guard rejected malformed views that omitted the reason.

### 5. Visible-text jargon tests

Tests scanned rendered visible text across:

- Overview;
- Decisions;
- Activity;
- Case states;
- Traveller states;
- Programme.

### 6. Fail closed rather than guess

Malformed Case views did not quietly render a half-true story.

The entire Case switched to:

> “This case cannot be displayed yet”

with an error panel.

That was part of the product truthfulness model.

---

# 7. Capabilities missing or under-specified in the R4 parity contract

The current R4 contract captures the broad direction, but Astra should not use it alone.

## A. Material legacy capabilities it under-specifies

### Overview

**Missing/under-specified:**

- shared-incident grouping;
- per-traveller differentiated consequence inside one shared incident;
- distinction between local/self arrangement and operator attention;
- earliest-upcoming-commitment fleet ordering;
- row-level working state;
- row-level uncertainty;
- active Case vs historical Case behaviour;
- separate Show interaction access;
- optional compact journey-state synopsis.

R4’s “buckets + population + roster search/pagination” is not enough to guarantee these.

### Case

**Missing/under-specified:**

- “How this unfolded” evidence timeline;
- impact-first sequencing;
- Find recovery → Begin recovery → authority/execution phase separation;
- no recommendation-detail leak before staging;
- planning-exhausted state;
- all-rejected state;
- fail-closed malformed projections;
- rejected options must carry reasons;
- recovered-with-loss must enumerate losses;
- option pros/cons;
- commitment effect;
- whole-trip candidate plan classification;
- provider payable vs approximate policy equivalent;
- complete payer/funding semantics;
- explicit “nothing has changed” language after exhausted planning;
- unavailable approver state;
- rule that operator cannot act for traveller;
- pre-authority rule not to claim no approval is needed.

### Programme

R4 currently says essentially “Programme roster + timeline”.

The legacy minimum additionally included:

- endangered commitments;
- missing traveller information;
- shared timeline commitment deduplication;
- affected traveller disclosure;
- event-local timing ownership;
- committed-change confirmation;
- changed-item wash;
- programme change preview;
- Now vs Proposed;
- affected population;
- alternatives;
- no-change-yet framing;
- programme intake/on-file source surface.

### Decisions

R4 misses:

- “Decided recently” history;
- explicit empty states;
- refusal to invent missing cost/deadline/history values.

### Activity

R4 misses:

- day grouping;
- pagination;
- actor sanitization;
- raw enum fallback handling;
- internal-ID sanitization.

### Traveller

R4’s current line is substantially too thin.

It does not establish the old traveller information architecture:

- status hero;
- commitment;
- itinerary/change;
- remainder viability;
- choice gating;
- requested-info state;
- progress;
- option-forming state;
- resolution;
- thread-first mode;
- live change-request composer;
- changed-but-still-working reassurance;
- “nothing booked until you choose” safety language.

### Shell

R4 does not explicitly preserve the operator/traveller shell separation.

That must be added to acceptance truth.

---

## B. R4 statements that are not actually legacy parity

### 1. Activity Case links

Legacy Decisions and Programme had Case links.

Legacy Activity did not.

Classify Activity→Case linking as **MAY IMPROVE**, not PRESERVE.

### 2. Operator nav context on Traveller

Legacy Traveller deliberately had its own mobile shell.

Do not place the operator nav/decision count onto Traveller under the banner of parity.

### 3. Persistent Reset on every operator page

Legacy reset was optional, secondary/admin profile functionality plus a separate development /demo panel.

A persistent shell reset may be a useful R4 demo adaptation, but it is **not** the old product baseline.

### 4. Polling contract

At the exact legacy SHA, src/ui/polling.ts does not exist.

The inspected legacy interaction path used real fetch/POST actions followed by authoritative page reload/projection refresh.

R4’s projection-revision region patching and graph-state-preserving polling are appropriate new requirements for the graph-enabled frontend, but they are **new interaction architecture**, not evidence of legacy parity.

### 5. “Legacy commitment chain rail”

This phrase conflates two old UI components.

Legacy had:

- journey chain in the main Case narrative;
- sticky rail carrying commitment/context/authority.

V5.6 supersedes the former.

It does not automatically supersede the latter.

---

# 8. Parity matrix

| Legacy capability | MUST PRESERVE | ADAPT TO GRAPH | MAY IMPROVE | JUSTIFIED RETIREMENT |
|---|---|---|---|---|
| Whole-population Overview | ✓ | V7.2 may enrich | Layout | — |
| Managed denominator vs total population | ✓ | — | Copy/visual | — |
| Confirmed / Needs Attention / Watching / Unconfirmed semantics | ✓ | May feed V7.2 state | Visual encoding | — |
| Local/self arrangement distinct from workflow state | ✓ | May feed V7.2 | Visual encoding | — |
| Fleet whole-population representation | Capability ✓ | V7.2 may become stronger population visual | Form | Old dot-grid form only if V7.2 demonstrably replaces its job |
| Earliest upcoming commitment prioritisation | ✓ | Could influence graph ordering/focus | Sorting controls | — |
| Needs Attention + All Participants simultaneously | ✓ | — | Layout | — |
| Shared incident grouping | ✓ | Strong candidate for V7.2 | Presentation | — |
| Per-traveller consequence within shared incident | ✓ | Strong candidate for V7.2 | Presentation | — |
| Roster search/pagination | ✓ | — | Better controls | — |
| Active Case primary row destination | ✓ | — | — | — |
| Traveller Show interaction access | ✓ | — | Wording/location | — |
| Case lead explanation | ✓ | Surround V5.6 | Copy | — |
| Case How this unfolded | ✓ when evidence exists | Can coordinate with graph time state | Presentation | — |
| Old Case journey chain | Semantic job ✓ | **Replace with V5.6** | — | **Old chain visual itself: YES** |
| Explicit downstream consequences | ✓ | Graph can reinforce | Reduce duplication only if comprehension proven | — |
| Sticky commitment/context/authority rail | Capability ✓ | Coordinate with V5.6 | Responsive/layout | **No automatic retirement** |
| Impact-first Case sequencing | ✓ | Graph becomes investigation context | — | — |
| Find Recovery CTA | Functional equivalent ✓ | — | Wording | — |
| Begin Recovery phase | Functional equivalent ✓ | — | Interaction | — |
| One dominant selected recommendation | ✓ | Option can highlight graph delta | Visual | — |
| Alternatives/rejected disclosure | ✓ | Graph link optional | Disclosure UX | — |
| Rejection reasons | ✓ | — | — | — |
| Option-specific whole-trip Before→After | ✓ | Can connect to graph candidate state | Visual | **Not justified merely because V5.6 exists** |
| Pros/cons/commitment effect | ✓ | — | Presentation | — |
| Provider payable + policy equivalent semantics | ✓ | — | Presentation | — |
| Funding/payer allocation | ✓ | — | Presentation | — |
| Traveller approval guard | ✓ | — | — | — |
| Organisation approval/decline | ✓ | — | — | — |
| Unavailable approver honesty | ✓ | — | — | — |
| Planning exhausted | ✓ | — | Copy | — |
| All candidates rejected | ✓ | — | Copy | — |
| Escalation | ✓ when authority/state permits | — | Wording | — |
| Checks performed | ✓ | V5.6 may contextualise | Disclosure | — |
| Action/progress feed | ✓ | Graph may animate affected state | Visual | — |
| Execute → observe → recheck progression | ✓ | Graph can show result | Visual | — |
| Recovered-with-loss disclosure | ✓ | — | Presentation | — |
| Fail-closed malformed Case | ✓ | — | Better error UX | — |
| Programme health summary | ✓ | V7.2 may share event state | Visual | — |
| Endangered commitments | ✓ | V7.2 can augment | Presentation | — |
| Programme timeline | ✓ | V7.2 can coexist | Presentation | — |
| Timeline commitment dedup | ✓ | — | — | — |
| Missing traveller information | ✓ | — | — | — |
| Programme change preview | ✓ where change functionality exists | V7.2 can show impact | Visual | — |
| Programme intake/on-file surface | Preserve capability if still in MVP | — | Can simplify | Only through explicit product decision |
| Decisions Waiting Now | ✓ | — | — | — |
| Decisions Decided Recently | ✓ | — | — | — |
| Activity day-grouped audit | ✓ | — | — | — |
| Activity pagination/sanitization | ✓ | — | — | — |
| Activity→Case links | — | — | ✓ | Not a legacy capability |
| Traveller mobile concierge shell | ✓ | — | Visual/content | — |
| Traveller commitment card | ✓ | May coordinate with graph-derived state, but graph is not shown as operator UI | — | — |
| Traveller itinerary/change explanation | ✓ | — | — | — |
| Traveller remainder viability | ✓ | — | — | — |
| Traveller choice gating | ✓ | — | — | — |
| Traveller progress | ✓ | — | — | — |
| Traveller request composer | ✓ | — | — | — |
| Thread-first traveller mode | ✓ when messages exist | — | — | — |
| Separate operator/traveller chrome | ✓ | — | — | — |
| Demo /demo page | Capability not product floor | — | Relocate tooling | **Route may retire if tooling survives** |
| Generic legacy frontend polling | Not established at baseline | New graph requirement | ✓ | N/A |

---

# 9. GOLDEN ACCEPTANCE CHECKLIST

Astra should not declare frontend convergence complete until these are demonstrably true in a browser.

## Shell

- [ ] Overview, Programme, Decisions and Activity are reachable from the operator shell.
- [ ] Decisions shows a count when decisions are pending.
- [ ] Event context remains visible on operator surfaces.
- [ ] Case has an obvious route back to Overview.
- [ ] Traveller does **not** inherit the operator navigation shell.
- [ ] Traveller retains compact Northstar + event context.
- [ ] Normal product pages do not look like diagnostic/demo tooling.
- [ ] Any reset/rehearsal affordance is clearly demo/dev-only.

## Overview / V7.2

- [ ] Opening Overview immediately communicates total population, managed population and local/self population.
- [ ] Managed readiness does not count local/self travellers as managed Confirmed.
- [ ] Confirmed, Needs Attention, Watching and Unconfirmed remain distinguishable.
- [ ] Local/self arrangement remains distinguishable from Unconfirmed.
- [ ] V7.2 does not cause unaffected travellers to disappear when one traveller is disrupted.
- [ ] Needs Attention and the full managed population are available simultaneously.
- [ ] A disrupted Case is discoverable without using search.
- [ ] Shared source incidents are understandable as shared events rather than arbitrary duplicate Cases.
- [ ] Different consequences for travellers affected by the same incident remain visible.
- [ ] Full roster remains searchable.
- [ ] A normal traveller can be opened even without an active Case.
- [ ] An active Case remains the primary operational destination when one exists.
- [ ] Traveller interaction remains separately accessible.
- [ ] Unknown information is explicitly marked rather than silently appearing healthy.

## Case / V5.6

### Disruption

- [ ] Operator can immediately answer “What happened?”
- [ ] Operator can answer “What does this affect?”
- [ ] Operator can identify the commitment/objective at risk.
- [ ] V5.6 makes causal trip state clearer than the old chain.
- [ ] V5.6 does not expose graph/ontology/internal backend vocabulary.
- [ ] Historical evidence progression remains available when present.

### Investigation

- [ ] Initial disrupted Case has one clear recovery action rather than multiple contradictory CTAs.
- [ ] Recovery progress describes real work in plain language.
- [ ] No success is shown before the actual operation returns.
- [ ] If planning returns no candidate, the UI explicitly says no safe automated path was found and that nothing was changed.
- [ ] If every candidate fails, rejected candidates/reasons remain inspectable.

### Recommendation

- [ ] Operator is not dumped into a giant raw strategy list.
- [ ] Exactly one staged recommendation is visually dominant when authority is requested.
- [ ] Other considered options are still reachable.
- [ ] Rejected options explain why they fail.
- [ ] Recommendation explains consequence to the whole trip, not merely the replacement booking.
- [ ] Relevant cost, payer and approval information is understandable.
- [ ] Provider charge is not confused with an approximate home-policy conversion.

### Authority

- [ ] Traveller-required approval cannot be performed by the operator.
- [ ] Case clearly tells operator it is waiting on the traveller and provides a traveller handoff.
- [ ] Organisation approval states who/why/amount when known.
- [ ] Decline is distinct from Execute.
- [ ] Missing valid approver does not render as implicitly approved.
- [ ] No internal HUMAN_AGENT wording appears.

### Execution

- [ ] Approved recovery exposes Execute, not Resolve/Begin/Approve simultaneously.
- [ ] Execution visibly progresses through apply → provider confirmation/observation → state update → recheck.
- [ ] Supplier execution alone does not immediately imply “trip recovered”.

### Resolution

- [ ] Resolved Case has no recovery CTA.
- [ ] Recovered trip has clear resolved presentation and Back to Overview.
- [ ] If anything was lost, the exact loss remains visible.
- [ ] Current state shows healthy only after the appropriate reassessment.
- [ ] Original disruption remains understandable rather than being erased.
- [ ] Uncertainty remains visible where still unresolved.

## Programme

- [ ] Event population scale is obvious.
- [ ] Endangered commitments are obvious.
- [ ] Programme timeline is readable without duplicate copies of one shared commitment.
- [ ] Multiple affected travellers can be understood without duplicating programme rows.
- [ ] Traveller table links to Traveller even if no Case exists.
- [ ] Active Cases remain separately discoverable.
- [ ] Missing traveller information is surfaced explicitly.
- [ ] Proposed programme changes clearly show Now vs Proposed.
- [ ] Preview states clearly say no changes have yet been made.
- [ ] Population impact and viable alternatives are understandable before commit.
- [ ] After commit, the changed programme state is obvious and affected rows/items update.

## Decisions

- [ ] Pending decisions answer Traveller / Decision / Cost / Waiting on / Decide by / Age where facts exist.
- [ ] Missing facts display honestly rather than being invented.
- [ ] Waiting decision links to its Case.
- [ ] Empty pending state explicitly says nothing is waiting.
- [ ] Recent completed decisions remain visible separately.

## Activity

- [ ] Feed is grouped chronologically by day.
- [ ] User sees human actors such as Northstar / Travel provider, not provider or application identifiers.
- [ ] Internal IDs and raw enum strings do not appear in visible activity text.
- [ ] Empty state is explicit.
- [ ] Longer histories paginate without losing day grouping.

## Traveller

- [ ] At first glance traveller can tell whether they are okay.
- [ ] A disruption leads with what changed.
- [ ] The trip’s important commitment remains understandable.
- [ ] Traveller can tell whether the rest of the trip still works.
- [ ] DISRUPTED + still-viable can reassure without falsifying the underlying status.
- [ ] Choice controls render only when a real decision exists.
- [ ] Traveller is told nothing is booked until their choice is processed where applicable.
- [ ] Progress tells traveller what Northstar is doing without technical language.
- [ ] Resolved trip clearly shows the new plan.
- [ ] Traveller can submit a change/request through the concierge composer.
- [ ] Existing messages can become a thread-first experience.
- [ ] Surface remains clean and usable at mobile width.

## Cross-cutting truthfulness

- [ ] Loading never fabricates data.
- [ ] Error never masquerades as normal state.
- [ ] Unknown never masquerades as healthy.
- [ ] State meaning never relies on colour alone.
- [ ] Rejected recovery without reason fails closed rather than rendering misleadingly.
- [ ] Recovered-with-loss cannot render without the loss.
- [ ] No forbidden internal terminology appears in primary visible UI.
- [ ] No raw UUID/internal entity IDs appear as user labels.
- [ ] Dynamic values are HTML-escaped.
- [ ] Browser/session state cannot override authoritative lifecycle state.
- [ ] Responsive collapse preserves user jobs rather than simply shrinking desktop UI.

Passing this checklist is the minimum credible interpretation of:

> **“At least as good as pre-refactor.”**

---

# 10. Reference inventory for Astra

Astra should use these exact sources rather than redoing archaeology.

## A. Authoritative baseline

**Commit:**

20454aa7f16e18cf07eb1558481637f8a18f2d09

Always inspect legacy files against that SHA, not current main.

## B. Primary surface implementations

- src/ui/screens/operator-dashboard.ts
- src/ui/screens/operator-case.ts
- src/ui/screens/operator-programme.ts
- src/ui/screens/operator-decisions.ts
- src/ui/screens/operator-activity.ts
- src/ui/screens/traveller.ts
- src/ui/screens/demo-panel.ts

## C. Presentation and interaction contracts

- src/ui/case-resolution-interaction.ts
- src/ui/case-view-model.ts
- src/ui/caseLifecycle.ts
- src/ui/interaction.ts
- src/ui/copy.ts
- src/ui/page.ts
- src/ui/theme.ts
- src/ui/components.ts
- src/ui/presentationState.ts
- src/ui/operator-surfaces-view-model.ts
- src/ui/traveller-presentation.ts
- src/ui/programme-change-interaction.ts
- src/app/presentation.ts
- src/ui/html.ts

### Negative evidence

src/ui/polling.ts **does not exist at the authoritative legacy SHA**.

Do not use later polling architecture to reconstruct supposed legacy behaviour.

## D. Legacy design intent

- docs/DESIGN.md

Use this for product intent, but where it conflicts with exact-SHA code/tests, code/tests are authoritative. Known minor drift includes fleet ordering and Unconfirmed cell treatment.

## E. Highest-value legacy frontend tests

### Broad UI contract

test/ui.test.ts

Especially:

- “user-facing vocabulary contains no internal jargon”
- “no internal jargon leaks into any rendered screen”
- “dashboard renders every status and orders attention first”
- “operator rows link to case when active and expose Show interaction secondary”
- “loading and error surfaces never fabricate data”
- “case detail tells the full recovery story incl. rejected attractive option”
- “planning action exposes truthful in-flight stages before the real response”
- “approval requirement is explicit with who, why, and amount”
- “resolution outcomes render honestly, including loss”
- “traveller surfaces: disrupted hero, decision buttons, viability”
- “a changed but still viable trip reassures without changing machine status”
- “recovery progress is derived from evidence, never asserted for UNKNOWN”
- “malformed case views are refused instead of guessed”

### Overview / product-density contracts

test/r3d-user-contracts.test.ts

Especially:

- “presentation mapping collapses managed travel into four buckets”
- “fleet Local cohort is distinct from Unconfirmed filled-grey treatment”
- “fleet ordering uses earliest upcoming commitment with missing last”
- “overview attention queue surfaces disrupted open cases without requiring search”
- “overview contracts: 67/42/25, four labels, fleet, pagination, case-first”
- “case selected recovery stages one recommendation with alternatives disclosure”
- “activity paginates 20 and never surfaces raw Providers actor”
- “traveller choice cards only when a decision is required”
- “normal product pages omit demo banner; demo tooling may keep it”
- “case options-ready phase shows Begin, not a second Resolve”
- “authority-required case renders human approve; traveller funding is explicit”
- “activity copy humanizes audit projection and strips internal ids”

### Case lifecycle

test/case-lifecycle-state.test.ts

Especially:

- “impacted case without options shows only Resolve”
- “options already projected show Begin and never Resolve”
- “pending approval hides Begin, Resolve, and Execute”
- “HUMAN_AGENT pending approval is awaiting authority, not options on the table”
- “organiser approval with remaining options exposes Execute only”
- “declined approval does not expose Execute”
- “resolved case never shows recovery CTAs”
- “shared airline incident differentiates by remainderViable, not case DISRUPTED”
- “local fan-out watching is not operator attention”
- “case sections order impact before CTA and selected recovery before approval”
- “traveller handoff surfaces open traveller view link”

### Programme

test/ui-programme.test.ts

Especially:

- loading/error/loaded contract;
- 45-traveller scale;
- attention ordering;
- traveller/Case navigation;
- endangered commitments;
- missing information;
- timeline conditional rendering;
- commitment deduplication;
- committed notice/changed markers;
- change preview inertness and honesty;
- intake/on-file programme.

### Language and money

test/presentation-lane.test.ts

Especially:

- US$/S$ rather than ambiguous bare $;
- consequence-oriented timing language;
- HUMAN_AGENT never visible;
- payable/provider amount vs policy equivalent.

### End-to-end UI wiring

- test/final-ui-backend-wiring.test.ts
- test/integration.i5.test.ts
- test/wave3r-dr8-projection-truth.test.ts
- test/final-demo-usability.test.ts

These prove the old screens were not isolated static comps: they were wired through application/runtime paths and guarded against projection-language leakage.

## F. R4 contract to use with corrections from this report

integration/r4-final-acceptance:docs/work/R4_FRONTEND_PARITY_CONTRACT.md

Inspected blob:

5698bbe4b6d27bc169cd75c78a2ef9c416618dfd

Use it for the accepted convergence direction:

- PostgreSQL/v2 remains current truth;
- V5.6 replaces old Case causal visual;
- V7.2 becomes Event Overview graph;
- legacy UI quality is the minimum.

Do **not** let its compressed tables override the more specific legacy behaviour documented above.

---

# Final baseline statement for Astra

The target is not “make the current frontend resemble the old frontend.”

The target is:

> **Preserve the old frontend’s user jobs, truthfulness, information hierarchy, authority boundaries, whole-trip reasoning, population awareness, interaction quality and design-system coherence while replacing only the parts that the accepted V5.6/V7.2 direction genuinely supersedes.**

V5.6 is allowed to supersede the old Case journey-chain visual.

V7.2 is allowed to become the new event-level visual.

PostgreSQL is allowed to supersede legacy persistence.

Those changes do **not** justify losing:

- managed-population awareness;
- attention layering;
- rich Case recovery flow;
- progressive disclosure;
- approval/funding comprehension;
- exhausted/rejected recovery states;
- Programme consequence management;
- Decisions history;
- readable Activity;
- traveller concierge quality;
- responsive behaviour;
- loading/error/unknown honesty;
- or the user-language boundary.

That is the objective pre-refactor minimum.
