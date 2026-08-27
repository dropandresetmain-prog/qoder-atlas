# NORTHSTAR Hackathon Video — Storyboard, Script & Asset Plan

**Status:** Draft for approval  
**Primary purpose:** Source of truth for the hackathon video story, scene order, timing, asset requirements, and production experiments.  
**Design authority:** `docs/DESIGN.md` remains authoritative for NORTHSTAR visual language. This document extends that system into motion; it does not create a second design system.  
**Script status:** Provisional. The scene logic is the current focus; final narration will be refined after visual timing is proven.

---

## 1. Objective

Produce a **< 3 minute** hackathon submission video that makes judges understand, remember, and believe:

1. **A replacement booking is not necessarily a recovered trip.**
2. **Travel disruption is a dependency problem.**
3. **NORTHSTAR maintains live connected state, follows the blast radius, and recovers the actual objective of the trip.**

This is not a product tour and not a broad technical explainer.

The film should tell one escalating story:

**pain → escalation → connected-state solution → how the resolution loop works → product proof → expansion**

---

## 2. Runtime structure

### Total target length
**2:50–2:58**

### Fixed allocation
- **0:00–1:30** — problem, escalation, NORTHSTAR solution, how it works
- **1:30–2:30** — actual product demo
- **2:30–2:40** — Qoder credit
- **2:40–2:58** — closing / future expansion

### Demo scenario allocation
- **30s** — **S1 → S3** continuous story
- **15s** — **S2**
- **15s** — **S7** *(tentative; replace only if a stronger breadth case emerges)*

---

## 3. Story architecture

### A. Personal pain
A traveller’s flight changes. The airline “fixes” the booking. The trip is still broken.

### B. Multiply the problem
Now many travellers have different dependencies.

### C. Organiser scale
Now an event organiser must understand the health of the whole programme.

### D. NORTHSTAR solution
NORTHSTAR maintains a **Live Dependency Graph** of travellers, trip elements, commitments, objectives, constraints and policies.

### E. How it works

**Signal → state update → blast radius → recovery planning → deterministic viability → authority → execute → observe → state update**

### F. Proof
Show the product actually run:
- S1 → S3
- S2
- S7

### G. Expansion
Same engine for:
- conferences
- sports tournaments
- corporate offsites
- self-managed corporate travel
- event organisers
- TMC / travel-agent operations

---

## 4. Naming / terminology

### Preferred terms
- **Live Dependency Graph**
- **Programme Map** *(UI-facing option)*
- **State & Resolution Engine**
- **Blast Radius**
- **Whole-Trip Recovery**
- **Objective-Aware Recovery**

### Avoid
- “Graph technology”
- “Ontology” in the video
- “Agent framework”
- “Travel chatbot”
- “AI assistant” as the main label

---

# 5. Visual direction — derived from `docs/DESIGN.md`

The video must look like **NORTHSTAR in motion**, not a separate campaign aesthetic.

The existing design system describes NORTHSTAR as **the calm, slightly obsessive fixer** and defines two registers:

- operator surfaces = a **glass cockpit**: light, dense, precise, instantly legible;
- traveller surfaces = a **concierge desk**: warm, minimal, composed.

The hackathon film should primarily inherit the **operator / glass-cockpit register**, because the story is about programme-scale situational awareness and recovery. Traveller-facing moments can briefly inherit the concierge register when the camera moves down to an individual trip.

## 5.1 Base visual world: cockpit daylight

Do **not** default to the usual dark neon “AI product” film.

The core frame should inherit the product’s neutral base:
- cool blue-grey / fog background feeling (`#F2F4F5` family)
- white surfaces
- restrained hairlines
- near-black ink for the strongest anchor

The film can use subtle depth, masking, focus, and camera movement, but the underlying palette should remain recognisably NORTHSTAR.

Dark frames may be used deliberately for transitions or branded punctuation, but should not replace the product’s visual identity.

## 5.2 Colour means state, never decoration

This rule from `DESIGN.md` applies to the film too.

- **Green** — confirmed, healthy, recovered
- **Brass** — changed, proposed, waiting, needs eyes
- **Vermilion** — broken, blocked, human decision needed
- **Grey** — unknown, missing, unconfirmed
- **Ink** — the system is actively working / recovering / planning

Do not spray green/red/brass glows around purely for visual energy.

If a graph node is red, it should be red because something is genuinely disrupted in the story.

If a dependency path becomes brass, it should mean the state has changed or requires review.

The theatre should come from **state transitions, ordering, scale, camera, sound, and composition** — not decorative colour.

## 5.3 One strong visual anchor per shot

`DESIGN.md` uses the principle of one ink-dark punctuation object per screen.

Extend that idea to video composition:

Each shot should have **one dominant object or fact** the eye lands on first.

Examples:
- the replacement flight card in Scene 1;
- the first broken downstream commitment;
- the event-health readout at organiser scale;
- Sarah’s critical dependency chain;
- the selected recovery strategy;
- the final NORTHSTAR lockup.

Do not make every node equally bright, equally labelled, or equally important.

The viewer should always know where to look.

## 5.4 Typography follows the product

Use the existing hierarchy rather than generic cinematic typography:

- **mono / tabular numerals** for times, counts, flight numbers, status readouts, timestamps;
- **sans** for explanation, scene text, names, decisions;
- **serif only if deliberately showing a traveller-facing commitment moment**, matching the concierge register.

Use short labels and strong numbers. Avoid paragraphs on screen.

Examples that fit the system:
- `67 PARTICIPANTS`
- `42 MANAGED`
- `09:20 HEADLINE`
- `360 MIN REQUIRED`
- `NOT VIABLE`

## 5.5 Reuse NORTHSTAR signature components in motion

The film should visually extend components that already exist in the product rather than inventing unrelated infographic objects.

### Fleet dot grid → programme health field
The existing fleet dot grid already represents one traveller per cell, sorted by urgency.

For the video, this concept can expand spatially into a programme-scale field or map. A graph is allowed, but it should feel like the **fleet grid unfolding into relationships**, not a random Obsidian hairball.

### Journey chain → dependency graph close-up
The journey chain is already NORTHSTAR’s fastest answer to “is the trip still a trip?”

When the camera focuses on one traveller, preserve this logic:

`flight — transfer — stay — ✦ commitment`

Then extend it only where useful to show:
- objective
- policy / constraint
- recovery strategy

This keeps the graph grounded in an existing product metaphor.

### Option cards → recovery branches
When comparing strategies, use the existing option-card logic:
- route
- timing
- cost delta
- effect on the commitment
- rejection reason

The film can animate these as branches, but their information architecture should remain recognisable.

## 5.6 Event-level health concept

A central event/programme representation is still useful, but it should be designed as a **NORTHSTAR readout**, not a generic glowing “mother node.”

Candidate treatment:
- event/programme as the dominant composition anchor;
- participant health represented around or adjacent to it as small status marks / segments / cells;
- each status mark maps to one participant;
- programme counts remain legible as data, not merely colour;
- disrupted travellers can visually connect back to the programme.

A segmented event-health halo remains an experiment, not a locked component.

Any final treatment must still satisfy the product rule that state is not communicated by colour alone. Counts, glyphs, labels, or explicit status text must remain available.

## 5.7 Motion inherits the NORTHSTAR motion charter

The film can be more authored than the UI, but it should still feel like the same system.

The product motion charter says motion communicates **state change and ordering**, never decoration.

Use these motifs:

### Settle
When a state changes, do not snap it. Let it settle:
- brief split-flap / data-board feeling;
- new-state wash;
- number/status stabilises.

This should become a signature transition throughout the film.

### Stagger
When a programme or dependency structure is revealed, assemble it in ordered waves rather than dropping everything on screen at once.

### Propagation
A change can travel along a dependency path, but avoid perpetual pulsing. The pulse exists because a specific state change is propagating.

### Resolved state
Recovery should feel like information becoming stable again:
- path settles to green;
- warning structure reduces;
- programme readout reconciles;
- no fireworks or celebratory bounce.

## 5.8 Theatre without violating the design system

The video still needs drama. Get it from:

- **scale** — one trip expanding to dozens;
- **camera** — moving from traveller chain to programme-level system;
- **reveal order** — hiding downstream consequences until the booking appears “fixed”;
- **contrast** — one vermilion failure emerging inside an otherwise healthy programme;
- **counterfactual branches** — showing a strategy fail before the viable path settles;
- **sound design** — restrained data ticks, state-change impacts, low-frequency transitions;
- **tempo** — quiet setup → fast propagation → controlled recovery;
- **morphing existing NORTHSTAR components** into larger explanatory structures.

Avoid theatre based on:
- cyberpunk neon;
- random particle fields;
- generic glowing graph networks;
- sci-fi holograms;
- looping animation that has no state meaning;
- stock airport montage as the main storytelling layer.

## 5.9 Film graph vs product graph

Do not lock the rendering technology yet.

### Explainer graph scenes
Should be hand-authored / directed with exact timing and camera choreography.
Candidate tools:
- Motion Canvas
- Remotion
- OpenMontage orchestrating code-generated motion

### Product graph / Programme Map
Can be data-driven if added to the app.
Candidate:
- `force-graph`

The visual semantics should match, but the film version does not need to use the live force simulation.

---

# 6. Scene-by-scene storyboard

## Scene 1 — Personal pain
### Time
**0:00–0:12**

### Purpose
Hook the viewer fast.

### Visual
Start with one traveller.
A flight changes.
An airline replacement appears.

Initially:
**Replacement found ✓**

Then consequences appear:
- transfer broken
- arrival buffer broken
- keynote / commitment at risk

Use a calm NORTHSTAR journey-chain treatment. The replacement can settle to green at the booking level before the downstream journey chain reveals vermilion failure.

### Communication point
A booking can be “fixed” while the trip remains broken.

### On-screen text
Possible:
- “Replacement found”
- “Transfer broken”
- “Arrival buffer lost”
- “Keynote at risk”

### Provisional voiceover
“A flight disruption looks simple. Find another flight, rebook the traveller, problem solved. Except it isn’t. If the new flight breaks the transfer, the arrival buffer, or the commitment that caused the trip to exist, the booking may be fixed — but the trip is still broken.”

### Assets needed
- traveller card / identity
- flight card
- journey-chain elements
- commitment card / marker
- state-settle animation
- dependency reveal

### Asset type
**Generated / animated**

---

## Scene 2 — Multiply the problem
### Time
**0:12–0:28**

### Purpose
Scale from one person to group complexity.

### Visual
The single journey structure multiplies into several travellers.
Each has slightly different dependencies.

Some remain green.
Some change to brass.
One becomes vermilion.

The reveal should feel like the NORTHSTAR fleet view expanding from compact health marks into connected trip structures.

### Communication point
Travel disruption is a dependency problem, not just a booking problem.

### On-screen text
“Different travellers. Different consequences.”

### Provisional voiceover
“Now multiply that across a group. Different travellers, different flights, different commitments, different constraints. The same disruption can affect each person differently.”

### Assets needed
- multiple traveller journey structures
- fleet-health / programme-health transition
- staggered state changes

### Asset type
**Generated / animated**

---

## Scene 3 — Organiser scale
### Time
**0:28–0:45**

### Purpose
Shift from personal problem to organiser problem.

### Visual
Pull outward to:
**AiT — AI in Travel Summit 2026**

Show:
- 67 participants
- 42 NORTHSTAR-managed travellers
- 25 local / self-managed

The event/programme is the dominant readout. Participant status marks surround or feed into it. A supplier disruption propagates into several travellers, producing differentiated outcomes.

### Communication point
An organiser needs to understand the health of the whole programme, not one booking at a time.

### On-screen text
`AiT 2026`  
`67 PARTICIPANTS`  
`42 MANAGED`

### Provisional voiceover
“And now make that an organiser problem. One programme. Dozens of participants. Some managed, some local, all converging on the same event. A single supplier change can ripple through the health of the whole programme.”

### Assets needed
- programme readout
- participant health field / graph treatment
- optional segmented event-health experiment
- state counts

### Asset type
**Generated / animated**

---

## Scene 4 — Introduce NORTHSTAR
### Time
**0:45–1:02**

### Purpose
Show what NORTHSTAR actually is.

### Visual
NORTHSTAR is revealed as the system maintaining this connected state.
A real change propagates through dependency paths.
Affected travellers / commitments settle into their new states.

The graph should emerge from existing journey/fleet components rather than appearing as a generic network overlay.

### Communication point
NORTHSTAR maintains a Live Dependency Graph and follows the blast radius.

### On-screen text
“Live Dependency Graph”  
“Blast Radius”

### Provisional voiceover
“NORTHSTAR solves this by maintaining live connected state — a dependency graph of travellers, trip elements, commitments, objectives, constraints and policies. When something changes, it doesn’t just see the change. It sees everything the change affects.”

### Assets needed
- dependency map / journey-chain expansion
- blast-radius animation
- changed-state settle
- NORTHSTAR title / product identity

### Asset type
**Generated / animated**

---

## Scene 5 — How NORTHSTAR works
### Time
**1:02–1:22**

### Purpose
Explain the architecture without turning the video into an architecture presentation.

### Visual
The connected state resolves into an ordered process while retaining the NORTHSTAR surface language:

**Trip Signal**  
→ **State Update**  
→ **Blast Radius**  
→ **Recovery Planning**  
→ **Deterministic Viability**  
→ **Policy & Authority**  
→ **Execute**  
→ **Observe**  
→ back to **State Update**

Alibaba Cloud / Qwen and Atlas appear inside the relevant steps, not as a logo montage.

### Communication point
AI proposes; deterministic systems govern viability, authority and execution.

### On-screen text
- “AI proposes”
- “Deterministic viability”
- “Policy & authority”
- “Observe & update”

### Provisional voiceover
“NORTHSTAR combines strategic use of AI, APIs and deterministic control. Alibaba Cloud’s Qwen helps interpret context and generate recovery strategies. Atlas provides the flight-side search and verification layer. But AI does not directly execute irreversible actions. NORTHSTAR validates each proposal, checks viability, checks authority, executes permitted actions, observes the result, and updates state again.”

### Assets needed
- animated resolution loop
- restrained Atlas attribution
- restrained Alibaba Cloud / Qwen attribution
- viability / authority state transitions
- execution → observation → state loop

### Asset type
**Generated / animated**

---

## Scene 6 — Transition to product
### Time
**1:22–1:30**

### Purpose
Bridge from concept to proof.

### Visual
The explanatory structure morphs into or matches the real NORTHSTAR UI.

Ideal transition: a familiar NORTHSTAR component from the motion sequence becomes the same component in the real app rather than a hard cut to unrelated browser footage.

### Communication point
“Let’s see it in action.”

### Provisional voiceover
“Here’s that recovery loop running in the product.”

### Assets needed
- matching animation and real UI entry frame
- transition plate

### Asset type
**Generated transition + real UI**

---

## Scene 7 — Product demo: S1 → S3
### Time
**1:30–2:00**

### Purpose
Hero proof.

### Scenario
Airline retime affects several CGK→SIN speakers.
Most remain viable.
Sarah Lim becomes critical.
Her rebooked arrival fails the required buffer for the 09:20 headline commitment.
NORTHSTAR then evaluates a programme-side resolution: move the headline slot to 15:30.
The organiser previews impact, commits, Sarah re-evaluates, and the case resolves without purchasing another flight.

### Communication point
The best recovery is not always another booking.

### On-screen text
Possible:
- “Shared supplier disruption”
- “Sarah Lim: NOT VIABLE”
- “Preview programme change”
- “Commit reschedule”
- “Case resolved”

### Provisional voiceover
“In this case, one airline retime affects several inbound speakers. NORTHSTAR recalculates each trip individually. Most remain viable. Sarah Lim, a headline speaker, does not. Her airline rebooking gets her to Singapore, but not in time for her 09:20 commitment. Instead of forcing a new flight purchase, NORTHSTAR previews a programme change. The organiser moves her headline to 15:30, the same trip is re-evaluated, and the case resolves.”

### Product footage needed
- programme impact / blast-radius view
- Sarah case view
- preview mode
- commit action
- post-commit resolved state

### Asset type
**Real product capture**, with only restrained framing overlays if needed

---

## Scene 8 — Product demo: S2
### Time
**2:00–2:15**

### Purpose
Show in-travel recovery and execution.

### Scenario
Jordan Hale misses the NRT→SIN connection after progressive delay.
NORTHSTAR reconciles actual state, evaluates recovery options, rejects an inadequate slower option, selects a viable next-morning option, checks authority, executes, observes, and confirms viability for the 20:45 finals showcase.

### Communication point
NORTHSTAR recovers the actual downstream objective, not just the onward flight.

### Provisional voiceover
“In a different case, Jordan is already travelling when a progressive delay causes him to miss his connection. NORTHSTAR reconciles what actually happened, evaluates the onward options, rejects one that still breaks the trip objective, selects a viable recovery, checks authority, executes, observes the result, and confirms the trip is once again viable.”

### Product footage needed
- Jordan disrupted trip
- option comparison
- approval / action
- resolved viable state

### Asset type
**Real product capture**

---

## Scene 9 — Product demo: S7
### Time
**2:15–2:30**

### Purpose
Show breadth beyond supplier disruption.

### Scenario
Traveller says:
“I’m actually flying from Tokyo, not London.”

NORTHSTAR re-evaluates the trip under a changed origin, including downstream implications and policy / authority boundaries.

### Communication point
Different disruption. Same recovery engine.

### Provisional voiceover
“And the same engine handles different disruption types entirely. Here, a traveller changes their origin from London to Tokyo. NORTHSTAR doesn’t just patch the field. It re-evaluates the trip, the timings, the options, the policy impact and the required actions.”

### Product footage needed
- traveller request input
- recalculated options / impact
- resulting case or strategy output

### Asset type
**Real product capture**

---

## Scene 10 — Qoder credit
### Time
**2:30–2:40**

### Purpose
Credit Qoder cleanly, without derailing the story.

### Visual
Fast montage of authentic development screens:
- Qoder IDE / Cloud
- code
- architecture work
- tests / integration
- UI build progression if available

### Provisional voiceover
“NORTHSTAR was built extensively with Qoder across architecture, implementation, testing and integration.”

### Assets needed
- Qoder screenshots or short recordings
- optional UI progression / Kimi contribution evidence if useful

### Asset type
**Real screen capture**

---

## Scene 11 — Closing / expansion
### Time
**2:40–2:58**

### Purpose
Expand the vision beyond the demo and land the thesis.

### Visual
Zoom outward from the conference use case into other contexts:
- sports tournament
- corporate offsite
- concert / group programme
- self-managed corporate travel
- travel-agent / TMC operations

Keep the same State & Resolution Engine in the middle while the surrounding context changes.

### Communication point
Same engine, different contexts.

### On-screen text
“Different trip. Different policy. Same recovery engine.”

Final lockup:

**NORTHSTAR**  
**Recover the trip, not just the booking.**

### Provisional voiceover
“The same resolution engine can support conferences, sports events, offsites, self-managed corporate travel, and eventually the operators who manage disruption across many travellers. Different trip. Different policy. Same recovery engine. NORTHSTAR. Recover the trip, not just the booking.”

### Assets needed
- closing context-expansion animation
- final NORTHSTAR title lockup

### Asset type
**Generated / animated**

---

# 7. Provisional full narration script

**Status: intentionally not final.** This exists only to test timing against the current storyboard. Rewrite after scene prototypes and real product captures establish actual pacing.

Target: approximately 390–410 words.

> A flight disruption looks simple. Find another flight, rebook the traveller, problem solved. Except it isn’t. If the new flight breaks the transfer, the arrival buffer, or the commitment that caused the trip to exist, the booking may be fixed — but the trip is still broken.
>
> Now multiply that across a group. Different travellers, different flights, different commitments, different constraints. The same disruption can affect each person differently.
>
> And now make that an organiser problem. One programme. Dozens of participants. Some managed, some local, all converging on the same event. A single supplier change can ripple through the health of the whole programme.
>
> NORTHSTAR solves this by maintaining live connected state — a dependency graph of travellers, trip elements, commitments, objectives, constraints and policies. When something changes, it doesn’t just see the change. It sees everything the change affects.
>
> NORTHSTAR combines strategic use of AI, APIs and deterministic control. Alibaba Cloud’s Qwen helps interpret context and generate recovery strategies. Atlas provides the flight-side search and verification layer. But AI does not directly execute irreversible actions. NORTHSTAR validates each proposal, checks viability, checks authority, executes permitted actions, observes the result, and updates state again.
>
> Here’s that recovery loop running in the product.
>
> In this case, one airline retime affects several inbound speakers. NORTHSTAR recalculates each trip individually. Most remain viable. Sarah Lim, a headline speaker, does not. Her airline rebooking gets her to Singapore, but not in time for her 09:20 commitment. Instead of forcing a new flight purchase, NORTHSTAR previews a programme change. The organiser moves her headline to 15:30, the same trip is re-evaluated, and the case resolves.
>
> In a different case, Jordan is already travelling when a progressive delay causes him to miss his connection. NORTHSTAR reconciles what actually happened, evaluates the onward options, rejects one that still breaks the trip objective, selects a viable recovery, checks authority, executes, observes the result, and confirms the trip is once again viable.
>
> And the same engine handles different disruption types entirely. Here, a traveller changes their origin from London to Tokyo. NORTHSTAR doesn’t just patch the field. It re-evaluates the trip, the timings, the options, the policy impact and the required actions.
>
> NORTHSTAR was built extensively with Qoder across architecture, implementation, testing and integration.
>
> The same resolution engine can support conferences, sports events, offsites, self-managed corporate travel, and eventually the operators who manage disruption across many travellers. Different trip. Different policy. Same recovery engine. NORTHSTAR. Recover the trip, not just the booking.

---

# 8. Asset production list

## A. Generated / animated scenes
1. Scene 1 personal pain / journey-chain failure
2. Scene 2 multi-traveller escalation
3. Scene 3 organiser-scale programme health view
4. Scene 4 Live Dependency Graph / blast-radius sequence
5. Scene 5 recovery loop / architecture sequence
6. Scene 6 transition into product
7. Scene 11 closing expansion

## B. Product screen captures
1. S1 blast-radius / programme impact screen
2. Sarah trip / case screen
3. S3 preview mode
4. S3 commit + resolved state
5. S2 disrupted in-travel state
6. S2 strategy comparison / decision
7. S2 approval / action / resolved state
8. S7 changed-origin case and resulting evaluation

## C. Build / Qoder captures
1. Qoder IDE / Cloud working session
2. code implementation view
3. testing / integration evidence
4. optional UI progression / Kimi contribution evidence

## D. Branding / typography assets
1. NORTHSTAR wordmark / title card
2. section labels using DESIGN.md typography rules
3. final end-card lockup

## E. Audio assets
1. AI voiceover
2. background score
3. restrained sound design:
   - data settle / flip
   - state-change impact
   - dependency propagation
   - approval / resolve confirmation
   - scene transitions

---

# 9. Asset-generation approach by tool

## Motion explainer scenes
Candidates to test:
- **Motion Canvas**
- **Remotion**
- **OpenMontage** orchestrating code-generated motion

## Final composition
Candidates:
- **Remotion**
- OpenMontage if its production pipeline proves stable enough

## Product footage
Direct screen recording

## Qoder footage
Direct screen recording

## Do not depend on
- NotebookLM as the final visual generator
- stock-footage-first auto-video tools
- PowerPoint-like generated video builders

---

# 10. Open questions / triage

## Act Now
1. Confirm **S7** as the third 15-second scenario.
2. Decide whether a read-only Programme Map is worth adding to the app before filming.
3. Confirm final tagline: **Recover the trip, not just the booking.**
4. Freeze the communication objective of each scene before writing final narration.

## Investigate Now
1. Build a 10–15 second **Motion Canvas** prototype using the DESIGN.md visual system.
2. Build the same 10–15 second concept in **Remotion**.
3. Test **OpenMontage** on one 30–45 second section only.
4. Choose AI voice only after script timing is close to final.
5. Test multiple programme-health visual treatments; the segmented halo is one option, not the default.

## Park for Later
1. advanced interactive graph behaviour
2. using graph UI for authoritative operational manipulation
3. additional breadth scenarios beyond the three demo beats

## Ignore / Accept Risk
1. NotebookLM as the primary production engine
2. trying to explain all eight scenarios
3. turning the film into a full architecture lecture

---

# 11. Recommended next production sequence

1. Approve the **storyboard / scene communication intent**.
2. Prototype the hardest non-product visual in both Motion Canvas and Remotion.
3. Select the motion-production path.
4. Capture the three product demo beats against the approved shot requirements.
5. Time the real footage.
6. Rewrite the narration to fit the proven visual timing.
7. Produce all remaining animated assets.
8. Assemble, add Qoder footage, sound design, captions, and final close.
9. Blind-judge the finished cut for comprehension before submission.

Do **not** lock the final motion tool or final graph implementation until the visual prototype comparison is complete.
