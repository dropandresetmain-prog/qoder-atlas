# NORTHSTAR Live Dependency Graph — accepted visual contract

Status: **Accepted visual direction**

Approved prototype: **v5.6**

This document records the visual and interaction decisions accepted for the NORTHSTAR Live Dependency Graph prototype. It is a frontend design contract, not a domain-model or persistence contract.

The graph exists to help an operator understand, within seconds:

1. who the trip is about;
2. what changed;
3. what the supplier already did;
4. which downstream dependency was affected;
5. where the trip first became operationally disrupted;
6. what remains on track.

The graph must not resemble a raw database graph, BPMN flow, architecture diagram, or debugger.

---

## 1. Core visual principle

The visualization uses three independent visual channels:

- **Motion = liveness.** A moving pulse means a dependency is currently functioning and carrying live state.
- **Colour = condition.** Green, amber, and red describe the current operational condition of a node or dependency.
- **Size / emphasis = operator attention.** The focal card is the first operational breakpoint worth inspecting, not simply the reddest downstream consequence.

These channels must not be conflated.

Example for the accepted Sarah scenario:

- Batik Air OD-157 is green: the airline rebooked it successfully.
- Singapore arrival is amber and visually focal: it moved from 08:10 to 10:20 and is the first state change that makes the trip plan fail.
- The keynote is red: it is missed.
- The trip purpose is red: the intended outcome is unmet.

---

## 2. State source of truth

The visual layer must not independently toggle node classes, edge classes, badges, pulses, trip status, or attention state.

The accepted prototype uses one shared graph/scenario state model containing:

- entities;
- relationships;
- per-node display state;
- per-relationship display state;
- trip-level display state;
- attention state;
- liveness / pulse state.

The renderer derives all visible output from that shared state.

Required implementation rule:

> **State says what is true; the renderer decides how that truth is drawn.**

Do not encode business state in SVG coordinates, CSS selectors, DOM mutations, fixture IDs, traveller names, route names, or scenario-specific branches.

The production frontend contract may use different names/types, but it must preserve the single-source-of-truth property.

### Prototype invariants

The accepted v5.6 prototype validates that:

- each scenario covers the same entity set;
- each scenario covers the same relationship set;
- every relationship references existing entities;
- every node state is complete;
- every relationship state is complete;
- in the all-clear scenario, all true dependencies are green and live;
- red dependencies are never live/pulsing.

These checks are prototype guards, not the final production schema.

---

## 3. Status wording

The UI should use travel / operational language for the item itself rather than generic graph-health language.

Accepted prototype examples:

- Flight: `REBOOKED`, `CONFIRMED`
- Arrival: `LATE`, `ON TIME`
- Hotel: `CONFIRMED`
- Ground transport: `RESCHEDULED`, `SCHEDULED`
- Commitment: `MISSED`, `SCHEDULED`
- Trip purpose / objective: `UNMET`, `ON TRACK`
- Programme item: `SCHEDULED`
- Trip-level status: `TRIP DISRUPTED`, `TRIP ON TRACK`

Do **not** treat these exact strings as canonical architecture truth.

The canonical frontend/domain status taxonomy is still to be decided in the frontend contract. The important rule is that **colour may represent operational condition while the text names the concrete travel state of that item**.

Avoid generic user-facing terms such as `BROKEN` or `VIABLE` where a travel-specific state is clearer.

---

## 4. Colour grammar

### Green

Meaning: the item/dependency is functioning as expected or has been successfully recovered at its own level.

A green dependency may pulse.

### Amber

Meaning: changed / degraded but still functioning.

Amber is deliberately narrow; it should not also mean approval pending, uncertainty, generic warning, or policy breach unless the frontend contract explicitly expands the taxonomy.

An amber dependency may pulse because it is still live.

### Red

Meaning: the dependency or outcome can no longer be satisfied in the current plan.

Red dependencies are **static**. They do not pulse.

Use a restrained red halo/glow on failed dependency lines to attract attention without using flashing animation.

### Grey / dashed

Meaning: contextual or grouping relationship, not a live dependency.

Grey dashed context lines do not pulse.

---

## 5. Motion grammar

The graph should feel alive even when nothing is wrong.

A small travelling dot / pulse moves along live dependencies almost continuously.

Rules:

- green live dependency -> green pulse;
- amber live dependency -> amber pulse;
- red failed dependency -> no pulse;
- contextual/dashed relationship -> no pulse.

The pulse is intentionally subtle and should read more like a heartbeat than an animation effect.

Do not use flashing red lines or continuously pulsing red failure states.

---

## 6. Operator focus / attention hierarchy

The main focal object should be the **first operational breakpoint**, not every downstream red consequence.

For Sarah:

1. flight rebooked successfully;
2. arrival changes to 10:20;
3. that changed arrival makes the 09:30 keynote impossible;
4. the trip purpose becomes unmet.

Therefore **Singapore arrival** is the primary focal card.

The direct downstream impact (the keynote) may receive secondary emphasis.

The objective remains visible as a downstream consequence but does not automatically become the largest card.

### Focal-card treatment

The focal card is a larger version of the normal card design, not a separate warning component.

Accepted treatment:

- wider rectangular footprint rather than a square warning tile;
- proportionally larger typography;
- date/time remains visible;
- the changed/current value is the strongest information;
- static amber focus ring + broader diffuse amber glow;
- no `NEEDS ATTENTION` badge is required.

When nothing needs attention, there should be **no enlarged card**. The graph returns to a calm set of equally weighted green/live nodes.

---

## 7. Dates and times

Dates are required on temporal travel entities. A travel graph without dates is ambiguous.

Accepted prototype convention:

- include year;
- include timezone where the clock time is operationally relevant;
- date ranges are acceptable for stays / trip spans.

Examples:

- `12 Mar 2025`
- `12 Mar 2025 · 10:20 SGT`
- `12–15 Mar 2025`

The production frontend contract should determine localization and timezone-display rules.

---

## 8. Programme context

An AnchorEvent / programme context should appear as a quiet containing region rather than another normal graph node.

For Sarah, `AI IN TRAVEL SUMMIT` is a contextual region containing programme commitments.

### Adjacent programme items

The programme item immediately before and immediately after the affected commitment appear as small, greyed contextual cards vertically stacked above and below the affected commitment.

They provide chronology without falsely implying a causal dependency.

In the disruption-path view these context cards are display context, not primary interactive graph entities.

If another programme commitment is itself evaluated as part of the trip state, it can appear as a normal coloured graph node. Example: VIP Dinner remains a real green downstream commitment because NORTHSTAR is evaluating whether the changed arrival still allows attendance.

### Multiple required commitments

Do not create a separate graph for every required event.

Multiple required commitments belong to the same trip graph. Commitments materially involved in the current blast radius can expand into graph nodes; neighbouring chronology can remain compressed context.

---

## 9. Objectives / trip purpose

Keep objectives available as graph entities because they express *why the trip exists*, which may differ from any one booking or commitment.

The visual layer may demote or hide objectives when they add no useful information, but the accepted Sarah prototype keeps `Deliver keynote` visible as the downstream trip purpose.

Do not assume every commitment equals the trip objective.

---

## 10. Relationship / connector discipline

Every visible dependency edge must answer a real question: **what depends on what?**

Do not connect two items merely because both belong to the trip.

Examples:

- Arrival -> Hotel is legitimate if hotel/stay validity depends on the revised arrival.
- Arrival -> Ground transport is legitimate because transport timing depends on arrival.
- Arrival -> VIP Dinner is legitimate because the revised arrival determines whether the dinner can still be attended.
- Do not create a Flight -> Hotel edge just because both are bookings.

### Independent children

When one parent has multiple children, render independent branches.

Do not use a shared junction if it visually implies a relationship among the child nodes.

Source anchors may be distributed across the relevant surface of the parent card.

---

## 11. Connector geometry

Graph state must describe connectivity, not pixel coordinates.

The renderer calculates connector geometry from the cards' actual rendered dimensions.

Accepted rules:

- side-to-side dependencies use a monotonic cubic Bezier;
- downward dependencies use independent bottom-to-top curves;
- right/down downstream items use a tight monotonic curve;
- control points remain between source and target to avoid decorative loops/overshoot;
- short-gap handles scale with the actual available gap so control points cannot cross;
- curves should use the **minimum curvature necessary** to connect the layout.

Curvature is not a severity signal.

The relationship's condition is communicated by colour, pulse/liveness, and glow — not by making critical lines geometrically different.

Context/grouping lines may be dashed.

---

## 12. Pan, zoom, and semantic zoom

The graph is a navigable canvas.

Accepted behavior:

- drag to pan;
- wheel/trackpad to zoom around the pointer;
- toolbar `-`, home/reset, `+` controls;
- smooth interpolated camera movement;
- node selection does **not** automatically snap the node to the viewport centre;
- double-clicking empty canvas / home returns to the active canonical view.

### Semantic zoom

Do not simply shrink all text indefinitely.

At lower zoom levels, hide low-priority metadata and preserve entity/state recognition.

At higher zoom levels, reveal richer detail.

---

## 13. Named views

Accepted views:

### Disruption path

Default when a disruption exists.

Frames the causal path and de-emphasizes unaffected secondary dependencies while preserving enough context to understand the wider trip.

### Trip overview

Fits the broader dependency graph and acts as the canonical home view.

### Programme

Frames the programme / AnchorEvent context and its related commitments.

When the trip is fully on track, `Disruption path` should not remain the active view. The accepted prototype disables it and returns to `Trip overview`.

---

## 14. All-clear behavior

The healthy state must be a real state transition, not a cosmetic pulse recolor.

In all-clear:

- no attention card is enlarged;
- all true dependencies are green;
- all true dependencies are live/pulsing;
- no red or amber dependency lines remain;
- no red failure glow remains;
- the trip-level state changes consistently;
- disruption-path view is not active.

This is a critical state-sync requirement for production integration.

---

## 15. Selection behavior

Clicking a node may highlight its immediate dependency neighbourhood.

Selection is a display concern only. It must not mutate operational state.

Selection should not automatically move the camera.

---

## 16. Product-copy discipline

Every visible word must justify its space.

Do not add explanatory slogans or pitch-deck copy inside the operator dashboard.

Examples deliberately removed during exploration:

- `Booking recovered != trip recovered`
- redundant edge prose permanently printed over connectors
- generic explanatory legends when the visual grammar is already self-evident

Use detail-on-demand instead of permanent explanatory copy where possible.

---

## 17. Prototype-only limitations

The accepted v5.6 file is a visual/interaction prototype, not production frontend code.

Known prototype limitations that must **not** silently become architecture:

- scenario data is hardcoded display data;
- entity positions are manually placed for this composition;
- the prototype contains only disrupted/all-clear demonstration scenarios;
- programme adjacency is mocked;
- colours/spacing are prototype-local rather than imported from the production design-token system;
- the exact UI status labels are provisional pending the frontend contract;
- relationship semantics are illustrative and must be fed by the real graph/read model in production;
- attention/focal selection is supplied by mock scenario state; the production contract must define how the breakpoint/focus is derived or supplied;
- the prototype is not evidence that domain state should be duplicated in frontend state.

---

## 18. Production integration principle

Do not port this prototype by copying its mock scenario object into application logic.

Production direction:

`authoritative graph/read model -> frontend contract -> normalized presentation state -> renderer`

The renderer should remain generic across travellers, routes, suppliers, AnchorEvents, commitments, stays, transport, and objectives.

No Sarah-specific, Singapore-specific, Batik-specific, keynote-specific, or AI-in-Travel-specific branching belongs in generic rendering logic.

---

## 19. Accepted artifact

The accepted HTML prototype is stored beside this document as:

`prototype/live-dependency-graph-v5.6.html`

It is the visual reference for this contract. Where this document and incidental mock copy in the prototype differ, the **design rules in this document and the future frontend contract take precedence over prototype-only wording/data**.
