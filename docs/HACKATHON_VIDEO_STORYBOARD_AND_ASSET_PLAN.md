# NORTHSTAR Hackathon Video — Storyboard, Script & Asset Plan

**Status:** APPROVED / production baseline  
**Primary purpose:** Source of truth for the hackathon video story, scene order, timing, communication objectives, asset requirements, and production sequence.  
**Design authority:** `docs/DESIGN.md` remains authoritative for NORTHSTAR visual language. This document extends that system into motion; it does not create a second design system.  
**Script status:** LOCKED for storyboard and asset production. Final voice timing may require only surgical word-level trims; do not reopen story structure without new evidence.

---

## 1. Objective

Produce a **< 3 minute** hackathon submission video that makes judges understand, remember, and believe:

1. **A travel disruption rarely breaks just one thing.**
2. **Rebooking the flight is not recovery.**
3. **NORTHSTAR treats travel as connected state through a Live Dependency Graph.**
4. **NORTHSTAR reasons across travel, traveller, policy and event context to restore the trip, not merely replace a booking.**
5. **NORTHSTAR can execute within delegated authority and uses explicit human-in-the-loop decisions when a boundary is crossed.**

This is not a product tour and not a broad technical explainer.

The film tells one escalating story:

**disruption → cascade → scale → connected-state resolution → autonomy / human-in-the-loop → product proof → breadth → expansion**

The technical story must be expressed through the product behaviour. Avoid stopping the film for a standalone architecture lecture.

---

## 2. Runtime structure and approved beat sheet

### Total target length
**Approximately 2:50–2:55**, always below 3:00.

The locked narration is approximately 455 words. Final timing is governed by the chosen AI voice and visual breathing room rather than an arbitrary word target.

### Beat 1 — Disruption cascade and scale
**Time:** ~0:00–0:20  
**Mode:** Generated motion

**Objective**
- **WHAT:** Make the viewer immediately understand that a travel disruption cascades downstream, and that rebooking one flight does not necessarily recover the trip. Then multiply that problem from one traveller to dozens or hundreds.
- **HOW:** Begin on one healthy NORTHSTAR journey chain: `flight → transfer → hotel → ✦ commitment`. Change/rebook the flight, then visibly propagate consequences through the downstream chain. Pull the camera back as the one journey multiplies into many travellers with differentiated states from the same supplier change.

**Viewer takeaway:** `REBOOKED` can coexist with `TRIP NOT RECOVERED`.

---

### Beat 2 — NORTHSTAR and the Live Dependency Graph
**Time:** ~0:20–0:43  
**Mode:** Generated graph motion

**Objective**
- **WHAT:** Explain what NORTHSTAR fundamentally sees that a booking-centric system does not: connected state across travel, travellers and the event programme.
- **HOW:** Continue the same camera move outward. Traveller journey chains connect into an event/programme graph with day nodes and nested commitments. Highlight travel nodes when the narration names flights, transfers and hotels, then programme/traveller nodes when it names constraints and event commitments. Reveal NORTHSTAR as the system maintaining this state, not as a separate overlay.

**Viewer takeaway:** NORTHSTAR sees the trip as a connected system.

---

### Beat 3 — Blast radius and AI resolution reasoning
**Time:** ~0:43–1:03  
**Mode:** Generated graph / resolution motion

**Objective**
- **WHAT:** Show how NORTHSTAR moves from a change to an actual recovery strategy by understanding messy context and exploring whole-trip alternatives.
- **HOW:** Trigger a change inside the graph and propagate the blast radius only along affected dependencies. Bring traveller requests, flight/hotel updates, policy, insurance and immigration context into the impacted trip. Let recovery branches emerge from the connected state — flight, hotel, programme or combined changes — rather than cutting to a generic pipeline diagram.

**Viewer takeaway:** NORTHSTAR asks both **what else is affected?** and **what has to change for the trip to work again?**

---

### Beat 4 — Qwen + Atlas inside the system
**Time:** ~1:03–1:09  
**Mode:** Generated integration motion inside Beat 3

**Objective**
- **WHAT:** Credit Alibaba Cloud and Atlas while making their roles intelligible rather than interrupting the story with logos.
- **HOW:** Keep the graph/recovery scene running. Show **Alibaba Cloud Qwen** at the interpretation/reasoning layer as messy context becomes structured recovery possibilities. When a recovery branch requires flights, show **Atlas GDS API** providing search/verification evidence that feeds back into NORTHSTAR.

**Viewer takeaway:** Qwen powers reasoning; Atlas powers flight search and verification within NORTHSTAR's resolution process.

---

### Beat 5 — Autonomy and human-in-the-loop
**Time:** ~1:09–1:15  
**Mode:** Generated authority-gate motion

**Objective**
- **WHAT:** Make NORTHSTAR's operating boundary explicit: it can resolve and execute automatically within delegated authority, while key decisions remain human-in-the-loop.
- **HOW:** Show one proposed action clearing policy/authority and flowing directly to `EXECUTE`, while a second action reaches an `AUTHORITY BOUNDARY` and stops at an explicit **HUMAN-IN-THE-LOOP** decision. Show the human receiving mapped impact and viable options, not a vague alert.

**Viewer takeaway:** NORTHSTAR is autonomous where permitted and deliberately human-controlled where judgement or authority is required.

---

### Beat 6 — Product transition
**Time:** ~1:15  
**Mode:** Generated-to-real transition

**Objective**
- **WHAT:** Turn the conceptual promise into proof without resetting the viewer's mental model.
- **HOW:** Push into one affected traveller / programme state in the generated graph and morph that structure into the corresponding real NORTHSTAR operator UI. Avoid a black-card `DEMO` interstitial.

**Viewer takeaway:** The concepts just shown are the behaviour of the real product.

---

### Beat 7 — Sarah / S1 → S3 hero
**Time:** ~1:15–1:42  
**Mode:** Real NORTHSTAR product capture

**Objective**
- **WHAT:** Prove programme-scale blast radius, differentiated traveller recovery, cross-domain recovery and human-in-the-loop programme change. The hero insight is that the best recovery is not always another travel booking.
- **HOW:** Start at programme level with one shared airline retime affecting several AiT speakers. Show most being handled/recovered automatically while Sarah remains unresolved. Open Sarah: airline rebooked, but she can no longer reach Singapore in time for her keynote. Show NORTHSTAR proposing a programme-side recovery, the organiser previewing downstream impact before any change, then approving/committing. Show programme update, traveller notification and Sarah becoming viable again without buying another flight.

**Viewer takeaway:** NORTHSTAR can recover the objective of the trip, not merely the disrupted booking.

---

### Beat 8 — Jordan / S2 second hero
**Time:** ~1:42–2:10  
**Mode:** Real NORTHSTAR product capture

**Objective**
- **WHAT:** Prove anticipatory resolution during an evolving in-travel disruption and show NORTHSTAR coordinating multiple recovery components into one actionable plan.
- **HOW:** Show Jordan's first-leg delay increasing over successive updates, with the connection moving `SAFE → AT RISK → IMPOSSIBLE`. NORTHSTAR starts planning before Jordan is simply left stranded. Present one coordinated recovery plan containing the next viable flight, Narita hotel, entry/transit requirements, insurance, Singapore hotel change, event timing and total cost. Show organiser approval, permitted execution and continuing observation until the journey is viable again.

**Viewer takeaway:** NORTHSTAR plans ahead across the whole disrupted journey instead of waiting for each failure to happen independently.

---

### Beat 9 — Traveller-request breadth: Jonas + Oliver
**Time:** ~2:10–2:22  
**Mode:** Fast real-product montage or animated real screenshots

**Objective**
- **WHAT:** Prove that the same resolution engine handles traveller-requested changes, not only supplier disruptions.
- **HOW:** Use two very short examples rather than full demos. Jonas asks to stay an extra night; briefly expose hotel/funding/policy/authority evaluation. Oliver says he is now flying from Tokyo instead of London; show the origin change propagating into the trip and forcing downstream re-evaluation before a recommendation is made.

**Viewer takeaway:** Different change, same impact-first resolution engine.

---

### Beat 10 — Qoder credit
**Time:** ~2:22–2:30  
**Mode:** Real Qoder captures + restrained motion

**Objective**
- **WHAT:** Give Qoder meaningful build credit and communicate the development method without turning the film into a tooling demo.
- **HOW:** Start with one workstream, fan it out into bounded parallel lanes such as UI, scenario engine, provider integration and testing, show authentic Qoder/code/test captures, then fan the work back into `INTEGRATE → VERIFY` and a passing result.

**Viewer takeaway:** Qoder enabled parallel implementation with controlled fan-in and verification.

---

### Beat 11 — Expansion and final thesis
**Time:** ~2:30–2:52/2:55  
**Mode:** Generated motion + final lockup

**Objective**
- **WHAT:** Expand NORTHSTAR beyond the AiT summit without making it look like five different future products, then land the central thesis cleanly.
- **HOW:** Return to the same graph visual language. Pull outward from AiT and change the programme context beneath the same resolution engine: conference → sports event → corporate offsite, then travel-team / TMC operating contexts. Collapse back to one healthy traveller chain and end on the NORTHSTAR lockup with a deliberate pause after the final line.

**Viewer takeaway:** The same resolution engine applies wherever many journeys must converge on a shared objective. **Fixing the booking is not enough; restore the trip.**

---

## 3. Story architecture

### A. Pain
One disrupted travel element creates downstream consequences.

### B. Scale
Multiply differentiated dependencies across dozens or hundreds of travellers.

### C. NORTHSTAR
NORTHSTAR maintains a **Live Dependency Graph** spanning travel, traveller constraints and programme commitments.

### D. Resolution
A change propagates through the graph. NORTHSTAR interprets messy context, maps the blast radius and proposes whole-trip recovery strategies.

### E. AI + provider evidence
Alibaba Cloud Qwen powers the reasoning layer; Atlas GDS API provides flight search and verification evidence.

### F. Authority model
Within delegated authority, NORTHSTAR can execute automatically. When a decision crosses that boundary, **human-in-the-loop** takes over with mapped impact and viable options.

### G. Proof
- **S1 → S3:** shared airline retime → differentiated outcomes → Sarah requires programme-side recovery → counterfactual preview → organiser commit → recovered trip.
- **S2:** progressive delay → anticipated missed connection → coordinated whole-trip recovery plan → approval → execution / observation.
- **Jonas + Oliver:** traveller-requested hotel extension and origin substitution as compact breadth proof.

### H. Expansion
Same resolution engine across conferences, sports events, corporate offsites, corporate travel teams and TMCs.

---

## 4. Naming / terminology

### Preferred terms in the film
- **Live Dependency Graph**
- **Blast Radius**
- **AI travel resolution layer**
- **Human-in-the-loop**
- **Delegated authority**
- **Recovery plan**
- **Viable / not viable**

### Avoid in narration unless strictly necessary
- “Graph technology”
- “Ontology”
- “Agent framework”
- “Travel chatbot”
- “AI assistant” as the main label
- long internal pipeline vocabulary

The internal execution pattern remains architecturally important, but the film should express it through behaviour rather than listing every internal stage.

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

Each shot should have **one dominant object or fact** the eye lands on first.

Examples:
- the rebooked flight that still leaves the trip broken;
- the first downstream commitment that becomes at risk;
- the programme-level multi-traveller impact;
- Sarah as the one unresolved traveller;
- Jordan's coordinated recovery plan;
- the human-in-the-loop authority gate;
- the final NORTHSTAR lockup.

Do not make every node equally bright, equally labelled, or equally important.

## 5.4 Typography follows the product

Use the existing hierarchy rather than generic cinematic typography:

- **mono / tabular numerals** for times, counts, flight numbers, status readouts and timestamps;
- **sans** for explanation, scene text, names and decisions;
- **serif only if deliberately showing a traveller-facing commitment moment**, matching the concierge register.

Use short labels and strong numbers. Avoid paragraphs on screen.

Examples that fit the system:
- `67 PARTICIPANTS`
- `42 MANAGED`
- `09:20 HEADLINE`
- `NOT VIABLE`
- `HUMAN-IN-THE-LOOP`

Do not surface implementation-only placeholder thresholds as headline film copy when the plain-language consequence is stronger.

## 5.5 Reuse NORTHSTAR signature components in motion

### Fleet dot grid → programme health field
The existing fleet dot grid already represents one traveller per cell, sorted by urgency. Use it when transitioning between many travellers and programme-scale state.

### Journey chain → dependency graph close-up
Preserve the existing product logic:

`flight — transfer — stay — ✦ commitment`

Extend it only where useful to show programme links, traveller constraints, policy/context and recovery strategies.

### Programme graph
The approved explainer concept may use large floating day nodes containing smaller event/commitment nodes. Traveller chains connect into the relevant programme commitments. The graph must communicate dependency and state, not become a decorative network.

### Option cards → recovery branches
When comparing strategies, preserve the existing option-card information hierarchy where useful: route, timing, cost effect, commitment effect and rejection/approval state.

## 5.6 Motion charter

Motion communicates **state change and ordering**, never decoration.

### Settle
When a value or state changes, let it settle rather than snap: brief data-board/split-flap feeling, state wash, then stabilisation.

### Stagger
Reveal programmes and dependency structures in ordered waves.

### Propagation
A pulse exists only because a specific change is travelling through a dependency path. No perpetual pulsing.

### Resolved state
Recovery should feel like information becoming stable again: paths reconcile, warnings reduce, affected state settles. No celebratory fireworks.

## 5.7 Theatre without violating the design system

Get drama from:
- **scale** — one trip expanding to dozens;
- **camera** — traveller chain → programme graph → affected case → product UI;
- **reveal order** — rebooking appears successful before downstream consequences emerge;
- **contrast** — one unresolved traveller inside a mostly recovered cohort;
- **counterfactuals** — previewing a programme change before commit;
- **sound design** — restrained data ticks, state-change impacts, propagation and resolution;
- **tempo** — immediate failure → accelerating complexity → controlled recovery.

Avoid:
- cyberpunk neon;
- generic glowing AI networks;
- random particle fields;
- sci-fi holograms;
- looping decorative animation;
- stock-airport montage as the storytelling backbone;
- standalone sponsor-logo interstitials.

## 5.8 One continuous explainer world

The first ~75 seconds should feel like **one camera journey**, not a sequence of infographic slides:

**one traveller**  
→ many travellers  
→ programme graph  
→ blast radius  
→ recovery branches / context  
→ Qwen + Atlas inside the process  
→ autonomous action / human-in-the-loop boundary  
→ push into the real NORTHSTAR UI

Where practical, build this as two reusable generated sequences rather than many independent assets:

1. **Journey Cascade**
2. **Live Dependency Graph / Resolution Engine**

---

# 6. Shot-by-shot storyboard

## Scene 1 — Journey Cascade
### Time
**0:00–0:20**

### Objective
- **WHAT:** Establish the central problem immediately: disruption cascades and rebooking alone does not equal recovery; then scale that pain from one traveller to a group.
- **HOW:** Start on one green journey chain. Change/rebook the flight. Let the flight itself settle as recovered while transfer, hotel and keynote become affected. Hold the contradiction briefly, then pull out as the journey multiplies into many travellers with different outcomes from the same supplier change.

### Visual anchors
`FLIGHT → TRANSFER → HOTEL → ✦ KEYNOTE`

`REBOOKED ✓`

then downstream state changes.

Potential headline:

**REBOOKING THE FLIGHT IS NOT RECOVERY.**

### Asset type
**Generated / animated — Asset A1 Journey Cascade**

---

## Scene 2 — Live Dependency Graph reveal
### Time
**0:20–0:43**

### Objective
- **WHAT:** Make the connected-state concept tangible and show travel connected to the event objective.
- **HOW:** Continue pulling outward. Traveller chains connect into a programme represented by three large floating day structures with nested event nodes. Reveal different travellers connecting to different commitments. Highlight the relevant node families as the narration names travel, traveller constraints and event programme.

### On-screen copy
**LIVE DEPENDENCY GRAPH**

Optional secondary line:
`TRAVEL ↔ PEOPLE ↔ PROGRAMME`

### Asset type
**Generated / animated — Asset A2 Live Dependency Graph Hero**

---

## Scene 3 — Blast radius + resolution reasoning
### Time
**0:43–1:03**

### Objective
- **WHAT:** Explain how NORTHSTAR reasons from a change to whole-trip recovery possibilities.
- **HOW:** A real change propagates through only the affected graph paths. Attach incoming context to the impacted trip: messy traveller request, flight/hotel updates, policy, insurance, immigration. Recovery branches emerge from the graph — e.g. alternate flight, hotel adjustment, programme change — with unsuitable branches rejected or deprioritised.

### On-screen copy
**BLAST RADIUS**

then, selectively:

**WHAT ELSE IS AFFECTED?**  
**WHAT HAS TO CHANGE?**

### Asset type
**Generated / animated — continuation of A2**

---

## Scene 4 — Qwen + Atlas in context
### Time
**1:03–1:09**

### Objective
- **WHAT:** Explain provider roles without breaking narrative flow.
- **HOW:** Keep the same scene. Qwen appears at the reasoning/interpretation stage as unstructured context becomes recovery possibilities. A flight-recovery branch calls Atlas for search/verification evidence and returns the result to NORTHSTAR.

### On-screen copy
Restrained integration labels only:
- `Alibaba Cloud · Qwen`
- `Atlas · Flight search + verification`

### Asset type
**Generated / animated — continuation of A2**

---

## Scene 5 — Delegated autonomy + human-in-the-loop
### Time
**1:09–1:15**

### Objective
- **WHAT:** Show exactly where NORTHSTAR acts autonomously and where a human must decide.
- **HOW:** One low-boundary action clears checks and reaches `EXECUTE`. A programme-level action stops at `AUTHORITY BOUNDARY` and exposes mapped downstream impact plus viable options to an organiser.

### On-screen copy
**HUMAN-IN-THE-LOOP**

Supporting labels:
`WITHIN AUTHORITY → EXECUTE`  
`BOUNDARY CROSSED → HUMAN DECISION`

### Asset type
**Generated / animated — continuation of A2**

---

## Scene 6 — Transition into product
### Time
**~1:15**

### Objective
- **WHAT:** Convert the conceptual explanation into product proof without a visual reset.
- **HOW:** Push into one affected traveller/programme state from the generated graph and morph it into the matching NORTHSTAR operator surface.

### Asset type
**Generated transition + real UI**

---

## Scene 7 — Product hero: S1 → S3 / Sarah Lim
### Time
**~1:15–1:42**

### Objective
- **WHAT:** Prove differentiated multi-traveller impact, automatic handling for recoverable cases, cross-domain recovery and human-in-the-loop programme change.
- **HOW:** Begin on programme impact after one airline retime. Show several affected speakers and most settling back to viable/recovered automatically. Keep Sarah as the unresolved exception. Open her case: airline rebooked, but she cannot reach Singapore in time for her keynote. Show NORTHSTAR proposing a programme-slot move, organiser previewing downstream impact before mutation, then approving. Finish on programme update, traveller notifications and Sarah becoming viable again without another flight purchase.

### Required product moments
1. shared supplier change visible at programme level;
2. multiple affected travellers with differentiated outcomes;
3. most recover automatically / Sarah remains unresolved;
4. Sarah's airline replacement visible;
5. plain-language consequence: cannot make keynote in time;
6. programme-side recovery proposal;
7. **preview before change** with downstream impact;
8. explicit organiser approval / commit;
9. programme update + traveller notification;
10. Sarah `VIABLE / RESOLVED`.

### Asset type
**Real NORTHSTAR product capture**

---

## Scene 8 — Product hero: S2 / Jordan Hale
### Time
**~1:42–2:10**

### Objective
- **WHAT:** Prove continuous recalculation, anticipatory recovery and coordination of multiple downstream travel consequences into one plan.
- **HOW:** Show progressive first-leg delay updates and the connection status moving from safe to at risk to impossible. NORTHSTAR begins recovery before Jordan is simply stranded. Present one coordinated plan covering the next viable flight, Narita overnight hotel, entry/transit requirements, insurance, Singapore hotel change, event arrival requirement and total cost. Show organiser approval, execution of permitted actions and continued observation until Jordan is back on a viable path.

### Required product moments
1. baseline LAX → NRT → SIN journey;
2. progressive delay updates;
3. `SAFE → AT RISK → IMPOSSIBLE` connection state;
4. recovery starts proactively;
5. one coordinated recovery plan rather than unrelated cards;
6. flight + Narita stay + entry/transit + insurance + Singapore stay consequences + event timing + cost;
7. organiser approval;
8. permitted execution;
9. observation / continuing state updates;
10. final viable trip.

### Asset type
**Real NORTHSTAR product capture**

---

## Scene 9 — Breadth montage: Jonas + Oliver
### Time
**~2:10–2:22**

### Objective
- **WHAT:** Show traveller-requested changes passing through the same impact-first engine.
- **HOW:** Use two quick examples. Jonas asks for an extra hotel night; show hotel, funding/payer, policy and authority evaluation. Oliver changes origin from London to Tokyo; show the trip topology changing and downstream travel/event assumptions being re-evaluated before recommendation.

### Asset type
**Short real UI captures or animated real screenshots**

Do not spend production time on full standalone 15-second demos for either scenario unless later footage proves unusually strong.

---

## Scene 10 — Qoder fan-out / fan-in
### Time
**~2:22–2:30**

### Objective
- **WHAT:** Credit Qoder and demonstrate how it accelerated NORTHSTAR development.
- **HOW:** Visually fan one task into bounded parallel workstreams, use authentic Qoder / code / test captures inside those lanes, then converge into one integration and verification path.

### Visual
`ONE PROBLEM`

→ `UI`  
→ `SCENARIO ENGINE`  
→ `PROVIDER INTEGRATION`  
→ `TESTING`

then:

`INTEGRATE → VERIFY → PASS`

### Asset type
**Real Qoder captures + generated composition**

---

## Scene 11 — Closing / expansion
### Time
**~2:30–2:52/2:55**

### Objective
- **WHAT:** Generalise the product while landing the core thesis with emotional and visual closure.
- **HOW:** Return to the graph. Pull out from AiT as the programme context changes into conference, sports event and corporate offsite; then show corporate travel team / TMC operating contexts over the same resolution engine. Collapse back to the original traveller journey chain, now healthy. End on NORTHSTAR and leave 2–3 seconds of breathing room after the final line.

### On-screen close
**NORTHSTAR**

**YOU HAVE TO RESTORE THE TRIP.**

### Asset type
**Generated / animated**

---

# 7. Production reconciliation — current execution state

**Reconciled:** 2026-08-28
**Authority:** This section normalises the production identity and current status. It does not alter the approved story or the locked narration below. Approximate timings are editorial guides only until final narration timing is available.

## 7.1 Sequence identity, timing, and ownership

| Sequence | Approx. time | Locked narration beat | Visual mode | Current status | Asset / output owner |
|---|---:|---|---|---|---|
| SEQ 01 | ~0:00–0:03 | A travel disruption rarely breaks just one thing. | OpenMontage-directed cinematic hybrid: free stock + Alibaba Wan where useful | DONE | Cinematics |
| SEQ 02 | ~0:03–0:11 | Delayed flight downstream consequences. | OpenMontage-directed cinematic hybrid: free stock + Alibaba Wan where useful | DONE | Cinematics |
| SEQ 03 | ~0:11–0:14 | Rebooking the flight is not recovery. | HTML + CSS + SVG + GSAP | DONE / minor user polish possible | `video-production/seq03-rebooking/` |
| SEQ 04 | ~0:14–0:20 | One traveller → many. | HTML + CSS + SVG + GSAP | DONE / minor user polish possible | `video-production/seq04-scale/` |
| SEQ 05 | ~0:20–0:26 | Event as connected state. | HTML + CSS + SVG + GSAP | REDESIGN REQUIRED | Fresh HTML-only workstream |
| SEQ 06 | ~0:26–0:43 | Live Dependency Graph / interconnected system. | HTML + CSS + SVG + GSAP | REDESIGN REQUIRED | Fresh HTML-only workstream |
| SEQ 07 | ~0:43–0:51 | Blast radius propagation. | HTML + CSS + SVG + GSAP | NOT STARTED | Fresh HTML-only workstream |
| SEQ 08 | ~0:51–1:03 | Resolution engine: context → recovery strategies. | HTML + CSS + SVG + GSAP | NOT STARTED | Fresh HTML-only workstream |
| SEQ 09 | ~1:03–1:09 | AI/Qwen + Atlas roles. | HTML + CSS + SVG + GSAP | NOT STARTED | Fresh HTML-only workstream |
| SEQ 10 | ~1:09–1:15 | Delegated authority + human-in-the-loop. | HTML + CSS + SVG + GSAP | NOT STARTED | Fresh HTML-only workstream |
| SEQ 11 | ~1:15–1:42 | Sarah real-product hero. | Real NORTHSTAR product capture | USER UI HARDENING / CAPTURE PENDING | Product capture workstream |
| SEQ 12 | ~1:42–2:10 | Jordan real-product hero. | Real NORTHSTAR product capture | USER UI HARDENING / CAPTURE PENDING | Product capture workstream |
| SEQ 13 | ~2:10–2:22 | Jonas + Oliver breadth. | Real NORTHSTAR product capture | USER UI HARDENING / CAPTURE PENDING | Product capture workstream |
| SEQ 14 | ~2:22–2:30 by current default | Qoder fan-out / fan-in. | Standalone HTML/GSAP Qoder animation | DONE | `video-production/seq14-qoder/` |
| SEQ 15 | ~2:30–2:55 | Expansion + closing thesis. | OpenMontage cinematic expansion, then HTML NORTHSTAR final graph/thesis lockup | Cinematic expansion DONE; final NORTHSTAR lockup NOT STARTED | Cinematics; Fresh HTML-only workstream |

## 7.2 Proven production rules

1. HTML + CSS + SVG + GSAP is the chosen generated-motion stack.
2. Sequences are separately editable and renderable assets.
3. They share one reusable production visual system under `video-production/shared/`.
4. `docs/DESIGN.md` remains the visual authority.
5. Shared components enforce congruence, while sequence authors retain creative freedom where `docs/DESIGN.md` does not prescribe a solution.
6. Continuity uses explicit handoff-frame / world-state contracts; do not force the full film into one huge HTML file.
7. Level-of-detail must reduce information as the camera pulls out. Never leave unreadable microtext on screen.

## 7.3 Seq 05–10 direction and technology framing

The primary communication goal for SEQ 05–06 is **interconnectedness**, not merely “show an event graph.” The viewer must understand that the event/programme has connected structure; journeys have dependent stages; travellers connect to specific programme commitments; many travellers connect to distinct areas of one shared event; traveller constraints affect viability; and NORTHSTAR maintains the whole connected state.

The rejected SEQ 05–06 composition on `demo-videos-html-production` is not approved and must not be integrated as a visual asset. A future workstream may selectively use only generic donor architecture from that branch—such as programme-graph primitives, LOD helpers, connected-programme world representation, graph-state/layout concepts, and a potential SEQ 07 mutation baseline—after an explicit design decision.

SEQ 09 frames AI as the capability. This hackathon build uses Alibaba Cloud Qwen for the AI/reasoning implementation, and Alibaba Cloud sponsorship must receive visible, meaningful credit. Qwen is not a NORTHSTAR-specific architectural dependency; a visual may use an Alibaba Cloud branded AI/Qwen container rather than treating “Qwen” as the architecture. Atlas has a distinct role: flight search and verification evidence.

SEQ 10 remains separate and explicit: one action within delegated authority clears to execute; a second reaches an authority boundary; mapped impact and viable options are already prepared for the human; and an explicit human-in-the-loop decision is shown. Do not bury this in SEQ 08–09.

## 7.4 Qoder, capture, and cinematic evidence

SEQ 14 is complete and standalone. Its default placement remains after product proof. Editorially it may later move between SEQ 10 and “Let’s see Northstar in action” without rebuilding the asset; this reconciliation does not change locked narration order.

Playwright capture is **VALIDATED**: deterministic browser driving at a fixed 1920×1080 viewport produces usable capture. The future enhancements are a giant clearly visible cursor, exact Sarah/Jordan/breadth choreography, and scenario reset/state handling. The harness and lightweight evidence live in `video-production/demo-capture-proof/`; capture binaries are intentionally ignored.

The accepted OpenMontage result is: opening PASS (11-second cinematic sequence, hybrid Wan + real stock) and closing expansion PASS (sports → corporate offsite → travel operations, hybrid Wan + stock). Detailed evidence remains in `video-production/cinematics/CINEMATIC_PRODUCTION_REPORT.md`; rendered local source/output footage may remain ignored.

## 7.5 Next production milestone

The fresh HTML-only workstream owns SEQ 05, SEQ 06, SEQ 07, SEQ 08, SEQ 09, SEQ 10, and the SEQ 15 final NORTHSTAR graph/thesis lockup. SEQ 03–04 are accepted reference assets, not tasks. That workstream must first solve SEQ 05–06 visual direction before implementing the remaining sequence chain.

---

# 8. Final narration script — LOCKED

Use this as the production narration baseline. Do not replace it with older provisional narration elsewhere in the repository.

> A flight delay doesn’t stop at the flight.
>
> It can cost you the connection, transfer, hotel and even that important business meeting or conference.
>
> Rebooking the flight alone may not recover the trip down the line.
>
> Now multiply that across dozens — or hundreds — of travelers, like at a conference. One disruption can ripple across the whole chain of events and travelers, each facing a different problem.
>
> Travel isn’t a list of bookings — it’s a network, or graph, of connected dependencies.
>
> Northstar is an AI travel resolution engine built around that graph, the Live Dependency Graph, connecting flights, hotel, traveler constraints and event programmes.
>
> When something changes, NORTHSTAR traces the blast radius — what else is affected, and what now has to change for the trip to still work?
>
> The Northstar Engine makes sense of the messy context — traveler requests, flight, hotel and event changes, policy, insurance and immigration — and produces viable recovery plans for the whole journey.
>
> Alibaba Cloud’s frontier AI models power the reasoning while Atlas API powers the flight search and booking capabilities to turn those plans into real options.
>
> Northstar can also automatically recover the journey within approved limits. When human judgement is needed, Northstar flags the decision with viable options and their impact already mapped out.
>
> Let’s see Northstar in action.
>
> One airline retime affects several AiT speakers. Most are recovered automatically.
>
> Sarah Lim cannot be.
>
> The airline has rebooked her, but she can no longer reach Singapore in time for her keynote.
>
> Because NORTHSTAR also sees the programme, it proposes moving Sarah’s speaking slot. The organiser previews who else would be affected before approving.
>
> She commits. The programme updates, travellers are notified, and Sarah’s trip becomes viable again — without buying another flight.
>
> Jordan’s disruption unfolds differently.
>
> His first flight is delayed repeatedly. NORTHSTAR sees his Tokyo connection move from safe, to at risk, to impossible — and starts planning before he becomes stranded.
>
> It builds one recovery plan: the next viable flight, a transit hotel in Tokyo, entry and transit requirements, insurance coverage, the Singapore hotel change, event timing and total cost.
>
> The organiser approves, NORTHSTAR executes permitted actions, and keeps tracking the journey until it is viable again.
>
> The same engine handles traveller-led changes too. Jonas wants another hotel night. Oliver changes where he’s flying from. NORTHSTAR works out what else is affected before changing anything.
>
> We built NORTHSTAR with Qoder using a long-horizon fan-out, fan-in approach — splitting work into parallel streams, then integrating, reviewing and repeating until the system was complete.
>
> Today, NORTHSTAR coordinates one summit. Tomorrow, the same engine can support conferences, sports events, corporate offsites, travel teams and TMCs.
>
> A booking gets you a ticket.
>
> NORTHSTAR gets you there.

---

# 9. Asset production manifest

## A1 — Journey Cascade
**Priority:** Critical  
**Covers:** Beat 1  
**Purpose:** One-trip downstream failure → many differentiated travellers.  
**Production:** Code-generated motion.

Required pieces:
- journey chain;
- rebooked-flight state;
- downstream propagation;
- state settle;
- multi-traveller multiplication;
- camera pull-out.

## A2 — Live Dependency Graph / Resolution Engine
**Priority:** Critical / highest-value generated asset  
**Covers:** Beats 2–5  
**Purpose:** Explain connected state, programme relationships, blast radius, AI context, recovery branches, Qwen / Atlas roles, delegated execution and human-in-the-loop.  
**Production:** One continuous code-generated motion world where practical.

Required pieces:
- floating programme day structures with nested event nodes;
- traveller chains linked to commitments;
- status/state semantics matching `DESIGN.md`;
- blast-radius propagation;
- context ingestion;
- recovery branches;
- restrained Qwen integration label;
- restrained Atlas integration label;
- authority boundary;
- autonomous execute branch;
- explicit `HUMAN-IN-THE-LOOP` branch;
- morph target for transition into real product.

## A3 — Sarah / S1 → S3 product capture
**Priority:** Critical / primary real-product hero

Capture the complete required sequence from Scene 7. Prefer one controlled continuous story, then edit for pace rather than assembling unrelated screenshots.

## A4 — Jordan / S2 product capture
**Priority:** Critical / secondary real-product hero

Capture the progressive delay state changes and one coordinated recovery plan from Scene 8.

## A5 — Jonas + Oliver breadth montage
**Priority:** Important, lightweight

Use short product recordings or animated authentic screenshots. Do not overproduce.

## A6 — Qoder fan-out / fan-in
**Priority:** Required hackathon credit

Required pieces:
- authentic Qoder IDE / Cloud footage;
- code / implementation;
- test / verification evidence;
- generated fan-out / fan-in composition.

## A7 — Closing expansion
**Priority:** Important

Reuse the A2 graph language rather than inventing a new campaign aesthetic. Programme context changes while the resolution engine remains constant, then collapse to the healthy journey chain and NORTHSTAR lockup.

## A8 — Audio
- locked narration rendered with selected AI voice;
- background score;
- restrained sound design for state changes, propagation, authority boundary, approval and resolution;
- captions/subtitles timed to final voice.

---

# 10. Asset-plan changes from the superseded draft

## Act Now
1. Build **A1 Journey Cascade**.
2. Build **A2 Live Dependency Graph / Resolution Engine** as the central explainer asset.
3. Capture **Sarah S1 → S3** as the primary product proof.
4. Capture **Jordan S2** as a full second hero rather than a 15-second supporting beat.
5. Capture lightweight **Jonas + Oliver** breadth moments.
6. Build explicit **human-in-the-loop** authority-gate visual.
7. Build Qoder **fan-out / fan-in** credit.
8. Reuse graph language for the close.

## Simplify / supersede
1. **Standalone nine-stage recovery-loop animation** — remove. Express the architecture through the graph and recovery behaviour instead.
2. **Standalone Qwen animation** — remove. Qwen belongs inside the resolution sequence.
3. **Standalone Atlas animation** — remove. Atlas belongs inside the flight-recovery branch.
4. **Standalone 15-second S7 demo** — remove from primary cut. Oliver becomes a breadth beat.
5. **Standalone 15-second S5 demo** — do not add. Jonas becomes a breadth beat.
6. **Segmented programme-health halo** — optional experiment only; not a required asset.
7. **Stock-airport visual layer** — not required.

## Park for Later
- interactive graph manipulation beyond what the film requires;
- full standalone breadth-scenario demos;
- decorative AI visualisation;
- additional scenario coverage beyond what strengthens the <3 minute film.

---

# 11. Tool / production strategy

The visual contracts are frozen. HTML + CSS + SVG + GSAP is the chosen generated-motion stack for SEQ 03–10 and the final SEQ 15 lockup. OpenMontage-directed cinematic hybrid production is used for SEQ 01–02 and the SEQ 15 expansion.

### Code-generated motion
HTML + CSS + SVG + GSAP. Separate editable/renderable sequences use the reusable system in `video-production/shared/`.

### Final composition
Use a final compositor with frame-accurate control over the approved assets, product captures, audio, and typography.

### Product footage
Direct controlled recording of the production NORTHSTAR UI. Playwright-assisted 1920×1080 capture is validated.

### Qoder footage
The completed standalone HTML/GSAP SEQ 14 asset uses authentic Qoder evidence within its fan-out / fan-in composition.

### Do not depend on
- NotebookLM as the final visual generator;
- stock-footage-first auto-video tools;
- generic AI-video clips for dependency/state animation;
- PowerPoint-like generated video builders.

---

# 12. Production sequence

1. **Lock narration and beat objectives** — DONE in this document.
2. Render the chosen AI voice and measure actual spoken timing.
3. Adjust only beat timings and surgical word-level trims if needed; do not reopen the story casually.
4. Prototype **A1 Journey Cascade** and **A2 Live Dependency Graph / Resolution Engine** using the approved visual contract.
5. Keep accepted SEQ 01–04 and SEQ 14 assets as references; do not reopen their completed work in the next HTML milestone.
6. Capture Sarah S1 → S3 against the required product moments.
7. Capture Jordan S2 against the required product moments.
8. Capture Jonas + Oliver breadth inserts using the validated harness where useful.
9. First establish approved SEQ 05–06 visual direction, then implement the connected HTML sequence chain through SEQ 10.
10. Build the final SEQ 15 NORTHSTAR graph/thesis lockup after the connected sequence chain.
11. Assemble, sound-design, caption and tighten to <3:00.
12. Blind-judge the finished cut for comprehension and claim/visual alignment before submission.

The primary production rule from this point onward is:

**Every asset must serve a locked narration beat and its WHAT/HOW objective. Do not create visually impressive assets that do not advance the story.**
