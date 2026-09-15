# WiT demo visual + product contract — recovered SSOT

**Status:** recovered from the settled WiT product pass, the earlier NORTHSTAR System World motion work, `docs/DESIGN.md`, and the frozen Sarah/Jordan scenario world.

**Purpose:** preserve the already-agreed visual/product design so the graph is not redesigned from memory again.

This document does **not** replace scenario/data SSOTs:

- `docs/work/WIT_DEMO_WORLD_PROGRAMME_SEED_FREEZE_v1.md`
- `docs/work/WIT_SEED_DECISIONS.md`
- `docs/work/WIT_JORDAN_CONCORDE_CAPTURE_REPORT.md`

Those own world facts, timings, provider provenance, participant assignments and seeded-vs-derived boundaries.

This document owns the **WiT graph/product visual contract**, the two hero visual state machines, and the post-M9 acceptance target.

Historical visual references that informed this contract:

- `docs/DESIGN.md`
- `docs/MOTION_DESIGN.md`
- `media/seq05-objective-field/`
- `media/seq06-live-dependency-graph/`
- `media/seq07-blast-radius/`
- `media/seq08-resolution-engine/`
- `media/seq09-qwen-atlas/`
- `media/seq10-authority-hitl/`
- historical `docs/HACKATHON_VIDEO_STORYBOARD_AND_ASSET_PLAN.md` at commit `185d84f1ebd6bb99340935fae5253d3c67aca3b8`

The old motion work is a **visual-language reference**, not a second product architecture.

---

# 1. Core visual thesis

The Live Dependency Graph is not a supporting diagram. It is a **primary intelligence surface** of the operator product.

The graph must make this product thesis visually undeniable:

> **A replacement booking is not necessarily a recovered trip.**

The demo/product state flow remains:

`change -> state update -> blast radius -> recovery strategies -> deterministic viability -> authority -> action -> observation -> reconciled state`

The graph must feel **live, causal, spatial and high-end**. “Fancy” is desirable. Generic graph-library aesthetics are not.

The theatre comes from:

- scale;
- focus and level-of-detail;
- reveal order;
- selective dimming;
- causal propagation;
- counterfactual overlays;
- deterministic strategy rejection;
- authority boundaries;
- provider evidence returning into the graph;
- observation and reconciliation visibly changing authoritative state.

It does **not** come from random particles, neon, force physics, meaningless pulsing or fake AI-thinking animations.

---

# 2. One canonical world, multiple purpose-built projections

There is one canonical dependency/state world.

Each screen receives a **purpose-built backend projection** of that world. The frontend does not inspect a raw graph and infer business truth.

Required direction:

`authoritative state -> scoped projection/read model -> visual graph`

Forbidden direction:

`raw DB/ontology graph -> frontend guesses viability/impact/recovery`

The graph never owns business truth.

The same underlying state may be projected differently for:

- dashboard operational impact;
- programme/incident blast radius;
- focused traveller causal explanation;
- counterfactual programme preview;
- recovery strategies;
- authority/execution/observation;
- Jordan progressive connection and multi-action recovery.

---

# 3. Superseded decisions

The historical August storyboard mentioned `force-graph` as a possible product rendering technology. That idea is **superseded**.

The settled WiT product decision is:

> **Deterministic, deliberately placed, horizontal left-to-right HTML/SVG/CSS/JS. No force simulation or physics.**

Also superseded:

- old 360/720-minute demo timing assumptions;
- old Sarah 09:20 / 15:30 geometry;
- old four-person Sarah affected cohort;
- old MN218/MN310 Sarah visual truth;
- old Jordan 15:10 hard gate;
- old TR885-as-airline-default story.

The visual grammar survives; scenario facts come from the current seed SSOTs.

---

# 4. Product composition

The operator graph experience uses three persistent regions.

## Main graph canvas

The graph is the dominant explanatory surface, not a small card.

Typical focused graph density is roughly **6–12 meaningful human-labelled nodes**, not hundreds of raw entities.

The canvas supports level-of-detail:

- programme-wide / cohort view;
- focused traveller view;
- strategy view;
- authority/action view.

The world should feel continuous as focus changes. It should not feel like seven disconnected screenshots.

## Thin top status bar

The top bar summarizes the current operational state without competing with the graph.

Examples:

- `5 AFFECTED · 1 DISRUPTED · 4 ON TRACK`
- `SARAH · NOT VIABLE`
- `PREVIEW · NO CHANGES MADE`
- `RECOVERY IN PROGRESS`
- `OBSERVED · STATE UPDATED`

## Contextual right rail

The right rail is **not permanently noisy**. It appears or expands when the current graph state needs explanation, comparison, approval or action detail.

It can carry:

- plain-language failed reason;
- checks / uncertainties;
- option summary;
- projected blast radius;
- cost delta;
- policy/authority decision;
- human-in-the-loop approval;
- action progress;
- provider observation / partial failure.

When it is not needed, it collapses so the graph remains the main character.

Traveller-facing UI remains simpler and does not expose the operator graph as a raw analytical surface.

---

# 5. Visual language

## 5.1 NORTHSTAR cockpit daylight

Use the current `docs/DESIGN.md` system:

- cool blue-grey/fog base;
- white surfaces;
- restrained hairlines;
- near-black ink as the strongest anchor;
- mono/tabular numerals for times/counts/status data;
- sans for explanation;
- serif only where a traveller-facing commitment moment deliberately uses the concierge register.

Avoid dark-neon AI-dashboard aesthetics.

## 5.2 State colours are semantic

- **Green** — confirmed, healthy, done, recovered.
- **Brass** — changed, proposed, waiting, needs eyes.
- **Vermilion** — broken, blocked, human decision required.
- **Grey** — unknown, missing, unbooked, unverifiable.
- **Ink** — system actively tracing/planning/recovering.

Healthy is always green, never grey.

Colour is never the only signal: pair it with glyph/text/status.

## 5.3 Current / observed / proposed / computed / unresolved

The product must visually distinguish:

- **CURRENT / OBSERVED authoritative state** — solid;
- **PROPOSED counterfactual state** — ghosted/dashed brass;
- **COMPUTED / ASSESSED consequence** — labelled as evaluation, not provider observation;
- **ACTIVE work** — ink;
- **UNKNOWN / STALE / unresolved** — grey with explicit unknown/stale language.

A proposed node or edge does not become authoritative merely because the user selected it.

It becomes current only after the applicable chain of:

`authority -> execution -> observation -> reconciliation / reassessment`

## 5.4 Edge semantics

- solid green — authoritative healthy dependency;
- solid vermilion — authoritative broken dependency;
- dashed brass — proposed/counterfactual/change-awaiting-decision;
- dotted grey — unknown/missing/unverified;
- ink tracing path — active causal propagation / system work.

Relationship vocabulary exposed by the projection may include:

- **affected by**;
- **relies on**;
- **must happen before**;
- **participates in**;
- **proposed change**.

Copy should remain user-facing rather than exposing ontology jargon.

---

# 6. The “fancy” behavior carried over from System World

The old HTML/SVG System World is the visual reference for how NORTHSTAR should feel when the graph is alive.

## 6.1 Level-of-detail focus

At programme scale, travellers can be compact/minified.

When the operator focuses a traveller/case, the detailed journey **emerges from the compact representation** rather than appearing as an unrelated new diagram.

The prior System World did this by moving from programme camera scale into a detailed hero representation while the rest of the field faded back. Product implementation need not reproduce the exact timed camera path, but it should preserve the concept:

> overview -> focused causal world -> back to wider context

## 6.2 Selective dimming

When one causal path is being explained, unrelated programme nodes and edges recede strongly rather than disappearing.

The user should retain spatial context while attention is controlled.

Affected nodes remain strong; unrelated nodes stay quiet.

## 6.3 Selective propagation trace

A new signal appears at the left/root of the relevant projection.

An **ink trace moves left-to-right along the actual affected path**.

Affected nodes react once as the trace reaches them.

Do not make every edge pulse continuously.

## 6.4 Constraints tether in contextually

Constraints/policies should not be dumped as a giant list.

When a constraint becomes relevant to the current explanation, its small card/chip tethers to the affected stage/path.

Example for Sarah:

- `ARRIVAL 10:30`
- `AVAILABLE 60 MIN`
- `REQUIRED 150 MIN`

The readiness rule should visually attach to the causal point it evaluates.

## 6.5 Outcome chips / health marks

Cohort outcomes can settle as compact result chips/marks adjacent to the traveller branches:

- `✓ ON TRACK`
- `▲ AT RISK`
- `✕ DISRUPTED`

They are summaries of runtime truth, not seeded graph decorations.

## 6.6 Strategy branches grow from the impacted trip

Recovery strategies do not appear as an unrelated AI sidebar.

They **branch out of the impacted trip / causal path**.

Option-card information architecture remains recognisable:

- route/action;
- timing;
- cost delta;
- effect on the commitment;
- rejection reason.

This directly carries forward the old resolution-engine visual where strategies grew from the impacted trip.

## 6.7 Deterministic viability is visible

Recovery branches are evaluated by deterministic viability.

Branches that do not restore the trip purpose should visibly fail and recede — for example by fading/shrinking/de-emphasising while retaining the rejection reason.

Viable branches remain strong and can receive a restrained green settle/glow.

This is not decorative ranking. It visualises actual deterministic evaluation.

## 6.8 Qwen / Atlas / evidence appear inside the graph when relevant

Do not turn provider/model integrations into a logo montage.

The old System World visual logic remains useful:

- structured context can feed into the intelligence/planning step;
- recovery candidates emerge;
- Atlas Search/Verify appears on the relevant flight strategy path;
- provider evidence returns to the strategy as a verified fact;
- the strategy state changes from “verify” to “verified” based on actual provider evidence.

For the current product this can be rendered as restrained service/evidence nodes/chips rather than huge branded objects, but the causal relationship should remain visible when it helps prove the loop.

## 6.9 Authority threshold / human-in-the-loop

Authority is a visible boundary, not hidden backend logic.

The old System World used an **AUTHORITY THRESHOLD** separating permitted automatic action from actions needing human approval.

Carry that concept into the product:

- actions within authority can progress;
- actions requiring approval visibly stop at a human-in-the-loop decision;
- no irreversible action visually crosses the boundary before approval.

## 6.10 Observation visibly reconciles state

After an action, do not jump straight to “Resolved”.

Show an observation/reconciliation beat:

`EXECUTED -> PROVIDER OBSERVED -> STATE UPDATED -> REASSESSED`

Only then should new authoritative edges/nodes settle to green.

The old System World explicitly used `✓ OBSERVED · STATE UPDATED`; that semantic remains correct.

---

# 7. Motion rules

Motion is **state-driven and meaningful**, but it should still look premium.

Use:

- split-flap/data-board **settle** when values/statuses change;
- brief new-state colour wash;
- ordered stagger when a field/graph is first revealed;
- left-to-right propagation trace for a real state change;
- level-of-detail focus transitions;
- local node/edge transitions based on projection revision/change-set;
- restrained green settle when recovery is actually reconciled.

Affected nodes react once. Unrelated nodes remain quiet.

Avoid:

- fake countdowns;
- fake AI thinking;
- perpetual pulsing;
- autoplay state changes unrelated to runtime state;
- decorative particle systems;
- celebration/confetti after recovery.

The product should feel calm, precise and alive — not static, and not chaotic.

---

# 8. Projection/read-model contract

The visual graph consumes a presentation-safe projection.

Previously agreed shape:

```ts
{
  scope,
  revision,
  rootRefs,
  nodes: [
    {
      id,
      kind,
      label,
      secondaryLabel,
      state,
      provenance,
      href?
    }
  ],
  edges: [
    {
      id,
      from,
      to,
      relation,
      state
    }
  ],
  changedNodeIds,
  changedEdgeIds,
  focusPath,
  summary
}
```

The exact DTO naming can follow current M9 contracts; the semantics are protected.

Semantic graph states previously agreed:

- `HEALTHY`
- `CHANGED` / `AFFECTED`
- `FAILED`
- `PROPOSED`
- `ACTIVE`
- `UNKNOWN`
- `RECOVERED`

Meaningful node concepts may include:

- disruption/source event;
- affected service/booking;
- traveller;
- meaningful arrival/timing state;
- transfer/stay when causally relevant;
- programme commitment;
- recovery proposal;
- action/authority/observation when relevant to the current projection.

Do not expose every canonical domain object merely because it exists.

---

# 9. Sarah — recovered seven-state visual progression

The settled Sarah product progression is:

**Healthy -> Signal -> Blast radius -> Why Sarah fails -> Recovery proposal -> Impact/approval -> Execute/observe/recover**

The current seed facts below supersede historical timings.

## State 1 — Healthy connected world

Main canvas: programme/cohort field at a readable wide level of detail.

All five shared inbound travellers are healthy.

The shared travel dependency is visible without dominating the whole event.

Top status: healthy event/cohort summary.

Right rail: collapsed/minimal.

The graph feels populated and connected before anything breaks; disruption does not create the graph, it changes an already-maintained world.

## State 2 — Supplier signal enters

The synthetic ID7159 cancellation/reprotection signal appears at the left of the affected projection.

The relevant shared service/path receives an ink “tracing change” state.

A single left-to-right trace begins.

The replacement/reprotected booking can settle as valid/green at booking level once authoritative, while downstream evaluation is still active/ink/brass.

Only affected structures react.

## State 3 — Shared blast radius resolves

Strict horizontal structure:

```text
[ID7159 CANCEL / ID7153 REPROTECTION] ──▶ [SHARED SERVICE] ──┬──▶ [SARAH] ──▶ [11:30 HEADLINE] ──▶ [✕ DISRUPTED]
                                                             ├──▶ [ARJUN] ──▶ [13:50 KEYNOTE]  ──▶ [✓ ON TRACK]
                                                             ├──▶ [SITI]  ──▶ [14:00 PANEL]    ──▶ [✓ ON TRACK]
                                                             ├──▶ [MEI]   ──▶ [14:00 PANEL]    ──▶ [✓ ON TRACK]
                                                             └──▶ [FELIX] ──▶ [16:30 TALK]     ──▶ [✓ ON TRACK]
```

The dominant readout is:

> **5 affected · 1 disrupted · 4 still on track**

Unrelated world dims but remains spatially present.

Selecting Sarah transitions/focuses into her detailed causal world.

## State 4 — Why Sarah fails

Strict horizontal causal chain:

```text
[ID7153 REPROTECTED ✓] ──▶ [SIN ARRIVAL 10:30 ✓] ──▶ [READINESS: 60 AVAILABLE / 150 REQUIRED ✕] ──▶ [11:30 HEADLINE ✕] ──▶ [TRIP PURPOSE NOT VIABLE]
```

This frame must make the thesis visually undeniable:

> **The flight is green. The trip is red.**

The readiness rule appears as a contextual constraint tether, not as unexplained backend jargon.

Right rail explains the failure in plain language.

## State 5 — Recovery strategies grow from the broken trip

Structured context / relevant constraints become visible around the focused Sarah path.

Recovery branches grow **to the right of the impacted trip**, rather than appearing as an unrelated recommendations list.

Travel-side and programme-side strategies can coexist.

Actual provider search/verification may appear on the relevant flight branch.

Deterministic viability visibly rejects options that do not restore the purpose.

The programme-side zero-new-flight recovery remains strong because it restores the objective without replacing the airline’s valid reprotected flight.

## State 6 — Counterfactual programme impact + human approval

Current and proposed state coexist.

Current authoritative programme:

```text
[SARAH] ──solid vermilion──▶ [11:30 HEADLINE · BROKEN]
[DANIEL] ──solid green──────▶ [14:30 LOCAL HOST · HEALTHY]
```

Counterfactual overlay:

```text
[SARAH]  - - dashed brass - -▶ [14:30 HEADLINE · PROJECTED HEALTHY]
[DANIEL] - - dashed brass - -▶ [11:30 LOCAL HOST · PROJECTED HEALTHY]
```

The preview graph can expand horizontally as:

```text
[PROPOSED CHANGE] ──▶ [SARAH / DANIEL / ELENA] ──▶ [TRIP + PARTICIPATION DEPENDENCIES] ──▶ [11:30 + 14:30 PROGRAMME STATE]
```

The right rail shows impact/checks and the **human-in-the-loop approval**.

Top status must make clear: `PREVIEW · NO CHANGES MADE`.

No authoritative graph mutation has occurred.

## State 7 — Execute, observe, reconcile, recover

After approval:

- programme action enters active/ink state;
- execution progresses;
- authoritative programme observation returns;
- state update/reassessment runs;
- proposed edges become current only after observation/reconciliation;
- dashed brass edges settle to solid green;
- old authoritative relationships retire;
- Sarah’s same trip becomes viable;
- cohort/event health count settles;
- no new Sarah flight exists.

Final state should feel stable again, not celebratory.

---

# 10. Sarah graph scopes — protected definitions

## Dashboard operational impact projection

Direction:

`SIGNAL / CHANGE -> SERVICE -> AFFECTED TRAVELLERS -> CONSEQUENCE / COMMITMENT`

Purpose: differentiated cohort impact at a glance.

## Focused Sarah causal projection

Direction:

`REPLACEMENT FLIGHT -> ARRIVAL -> OPERATIONAL WINDOW -> PURPOSE`

Purpose: explain why valid booking != viable trip.

## Programme / incident blast-radius projection

Direction:

`CHANGE -> PEOPLE -> TRIP DEPENDENCIES -> PROGRAMME`

Purpose: show who/what a programme change would touch.

## Counterfactual programme preview

Direction: current + proposed left-to-right relationships in one spatial frame.

Purpose: show mutation-free proposed world before approval, then visibly reconcile into authoritative state afterward.

---

# 11. Jordan — current application of the same visual grammar

Jordan is not a new graph philosophy. He uses the same world/projection/motion language.

His role is to prove progressive live state and coordinated multi-domain action.

## 11.1 Healthy baseline

Strict left-to-right journey:

```text
[ZG023 LAX→NRT] ──▶ [NRT ARRIVAL 14:10] ──▶ [160 MIN CONNECTION] ──▶ [ZG053 NRT→SIN] ──▶ [SIN 23:00] ──▶ [CONCORDE / TRANSFER] ──▶ [20:45 FINALS · FUTURE COMMITMENT]
```

All relevant authoritative nodes are healthy/green.

## 11.2 Progressive degradation

The graph does not cut to a new diagram for every delay.

The **same horizontal path** revises as D1–D4 arrive.

Connection-window node is the main changing object:

- D1: safe;
- D2: at risk/brass;
- D3: ZG053 impossible/vermilion;
- TR875 recovery branch becomes available;
- D4: TR875 itself becomes unboardable, overnight consequence appears.

Only changed nodes/edges settle/trace.

## 11.3 Airline default proves the thesis again

Airline default branch:

```text
[TR867 BOOKING ✓] ──▶ [SIN ARRIVAL 20:45 ✓] ──▶ [READINESS TO 20:45 FINALS = 0 ✕] ──▶ [WHOLE TRIP NOT VIABLE]
```

Again, a booking can be green while the objective is red.

## 11.4 Whole-trip recovery expands horizontally

The recovery view grows from the broken NRT state and changed arrival.

Conceptually:

```text
[BROKEN NRT CONNECTION] ──▶ [TR885 RECOVERY FLIGHT] ───────────────▶ [SIN ARRIVAL 14:35] ──▶ [20:45 FINALS ✓]
                         ├──▶ [NARITA OVERNIGHT] ───────────────────▶ [OBSERVED ✓]
                         └──▶ [CHANGED SIN ARRIVAL] ──┬────────────▶ [CONCORDE 30 SEP→3 OCT]
                                                     └────────────▶ [AIRPORT TRANSFER REDISPATCH]
```

The visual point is:

> **The airline recovered the passenger. NORTHSTAR recovered the trip.**

## 11.5 Multi-action plan / action DAG

The coordinated recovery should expose per-action truth:

- proposal;
- deterministic viability;
- cost;
- authority;
- execution;
- observation;
- failure/partial-failure.

The action flow remains left-to-right and may branch where actions can be coordinated/parallel, then converge on final whole-trip reassessment.

For Singapore hotel cancel+rebook, the dependency ordering must remain visible/truthful:

```text
[QUOTE / AUTHORITY] ──▶ [BOOK REPLACEMENT] ──▶ [OBSERVE CONFIRMED] ──▶ [CANCEL DISPLACED] ──▶ [OBSERVE CANCELLED] ──▶ [REASSESS]
```

If displaced cancellation fails, that branch does not become green and whole-trip/full-resolution status must remain appropriately unresolved/partial.

---

# 12. User interaction contract

This is **not “nothing fancy.”** The graph is expected to be polished and interactive enough to feel like the core product intelligence surface.

Required interaction behavior includes:

- selecting/clicking a traveller branch to focus/open that case;
- smooth level-of-detail transition from cohort/programme view into focused traveller path;
- selecting a failed node/path to reveal its plain-language reason in the right rail;
- selecting a recovery strategy to emphasise its branch and de-emphasise alternatives;
- visibly toggling/contrasting current authoritative versus proposed counterfactual state;
- approval action at the human-in-the-loop boundary;
- execution/observation state updating the same graph rather than navigating to an unrelated “success” screen;
- ability to return to wider programme context without losing the state story.

Do not turn the graph into an editor. The operator is inspecting, comparing, approving and following recovery — not manually rewiring ontology edges.

---

# 13. What the old motion work contributes, and what remains video-only

Carry into product:

- cockpit-daylight design;
- horizontal causality;
- crisp SVG paths;
- deliberate placement;
- LOD/focus;
- selective dimming;
- propagation tracing;
- constraint tethers;
- outcome chips;
- strategies growing from the impacted trip;
- deterministic rejection;
- Qwen/Atlas evidence paths where useful;
- authority threshold semantics;
- observed/state-updated reconciliation;
- settle/stagger motion.

Video-only / not required in product:

- authored camera timing in seconds;
- cinematic airport footage;
- OpenMontage/Runway/Wan/stock footage;
- sound-design timing;
- exact scripted sequence duration.

The product should feel like the System World became real and interactive, not like a separate dashboard unrelated to it.

---

# 14. Anti-patterns — explicitly rejected

Do not build:

- force-directed/physics graph;
- radial graph;
- graph-database debugger;
- raw ontology explorer;
- random “AI network” decoration;
- cyberpunk neon;
- every node equally bright or equally labelled;
- perpetual pulses;
- graph changes driven by fake timers;
- giant logo montage for Qwen/Atlas;
- plain recommendation cards detached from the impacted path when graph strategy data exists;
- proposal that visually looks committed;
- instant `RESOLVED` jump without execute/observe/reassess;
- Sarah/Jordan-specific graph code or IDs in domain/application logic.

---

# 15. Post-M9 functional acceptance

M9 is allowed to finish independently. The WiT lane resumes scenario hardening after its accepted integration tip.

## Sarah definition of done

Without a reset between disruption and recovery:

1. coherent viable baseline;
2. shared disruption/reprotection enters through normal path;
3. all five replacement bookings valid;
4. five-person blast radius rendered from projection;
5. runtime derives Sarah NOT_VIABLE and four peers VIABLE;
6. focused graph proves green flight / red trip purpose;
7. recovery planning runs through normal engine;
8. Sarah↔Daniel programme recovery available;
9. preview is mutation-free;
10. current/proposed graph truthfully rendered;
11. affected linked participants projected viable;
12. human-in-the-loop authority/approval runs;
13. change commits;
14. programme observation/state update occurs;
15. same Sarah trip re-evaluates VIABLE;
16. no new Sarah flight purchased;
17. four peers remain viable.

## Jordan definition of done

1. viable ZG023→ZG053 baseline;
2. progressive D1→D4 updates revise same graph;
3. safe→at-risk→impossible derived truthfully;
4. temporary TR875 can appear then disappear;
5. overnight NRT consequence derived;
6. TR867 valid booking but whole trip NOT_VIABLE;
7. TR885 identified/evaluated as stronger recovery;
8. Narita overnight consequence/action present;
9. Singapore hotel consequence/action present;
10. transfer consequence present where represented;
11. finals viability restored by whole plan;
12. authority/execution/observation visible per consequential action;
13. partial failures remain partial;
14. final whole-trip viability recomputed;
15. recovered/resolved only when required authoritative state is valid or remaining uncertainty explicitly escalated.

---

# 16. Remaining scope after M9

## Act Now

- Sarah end-to-end hardening.
- Jordan end-to-end hardening.
- Implement/polish the recovered graph contract against actual M9 projections and revisions.
- Ensure state changes remain truthful through signal, preview, authority, execution, observation and reassessment.

## Investigate Now

Only when one of the two heroes fails: classify the issue as fixture/data drift, product/read-model bug, generalized engine bug or architecture gap. Fix the generic cause.

## Park for Later

- exact presenter timing;
- click-by-click recording choreography;
- extra scenarios / S8 unless contaminating the heroes;
- raw graph explorer;
- immigration/visa expansion;
- insurance execution;
- extra transfer-provider integration;
- further OpenRouter work;
- provider-class cosmetic naming cleanup;
- Batik evidence capture unless needed for a truthful external claim.

## Ignore / Accept Risk

- Sarah Batik flight geometry remains honestly synthetic/organiser-supplied until provider evidence is captured.
- REPLAY/sandbox provider actions are acceptable when provenance is explicit.
- Synthetic disruption triggers are acceptable at the external-event boundary.

---

# 17. Final protected statement

The WiT graph is **not** a simple trip chain with a few colours.

It is a polished, deterministic, left-to-right operational world that can move between programme scale and traveller scale, trace real causal propagation, compare authoritative and counterfactual state, grow recovery branches from the impacted trip, show deterministic rejection, expose provider evidence and human authority boundaries, then reconcile the same world after observed execution.

That visual system is a protected demo deliverable. Do not simplify it into generic cards, raw graph-debugger UI, force physics or top-to-bottom flow.