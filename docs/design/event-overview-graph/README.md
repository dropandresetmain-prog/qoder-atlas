# NORTHSTAR Event Overview Graph — accepted visual contract

Status: **Accepted visual direction**

Approved prototype: **v7.2**

This document records the accepted visual, interaction, and product-boundary decisions for the NORTHSTAR Event Overview Graph. It is a frontend design contract, not a domain-model, persistence, or backend orchestration contract.

The Overview Graph exists to let an operator understand, within seconds:

1. whether the travelling population is broadly okay;
2. whether NORTHSTAR is continuously watching the event world;
3. where a meaningful operational change has occurred;
4. how wide the current blast radius is;
5. which affected travellers have cleared and which still require attention;
6. which major programme commitment is implicated;
7. where to click next for focused causal explanation.

The Overview Graph must not become a miniature raw-domain graph, a dashboard of disconnected cards, or a zoomed-out copy of the Case Graph.

---

## 1. Product role

The Event Overview Graph is a **curated spatial operational world**.

It is not the complete NORTHSTAR graph.

Its job is:

> **overall health + meaningful shared concentration + active change + blast radius + attention routing**

The accepted product boundary is:

- **Event Overview Graph** — “Is everyone okay, where did something change, how wide is it, and where does attention belong?”
- **Focused Case Graph / V5.6** — “Why exactly is this traveller not okay?”
- **Entire Graph** — future exploratory topology of the broader connected operational world.

The Overview may visually hint at the complexity of the Entire Graph, but it must remain a bounded projection.

---

## 2. Core visual model

The Overview uses a stable spatial geography rather than a force-directed graph.

The primary spatial backbone is the **programme spine**:

- Day 01;
- Day 02;
- Day 03;
- equal-width horizontal territories;
- continuous containing lane;
- major programme commitments arranged in two rows.

Shared operational dependencies connect from above.

Traveller cohorts and promoted traveller exceptions connect from below.

This gives the operator a consistent mental model:

**shared dependencies → programme spine ← traveller population / exceptions**

The exact coordinates are presentation data only. They are not domain truth.

---

## 3. Information hierarchy

The Overview does not expose every canonical object.

### Permanently eligible overview content

- major programme landmarks;
- meaningful shared dependencies;
- compressed traveller cohorts / population health;
- promoted current exceptions;
- current active blast-radius relationships.

### Normally omitted content

- low-value individual booking plumbing;
- ordinary transfer nodes;
- ordinary hotel nodes;
- allocation records;
- participation records;
- policy internals;
- raw evidence sources;
- provider/tool-call internals;
- recovery-option graph nodes;
- every one of the 61 programme items;
- every traveller as a full card.

A normally omitted object may be promoted if it becomes operationally material to current health or blast radius.

Example: an airport transfer is not permanently important merely because it exists. It should appear only when it is itself a consequential shared dependency or operational breakpoint.

---

## 4. Programme spine

The programme is the visual centre lane of the Overview.

Accepted rules:

- three equal-width Day territories for the current AiT prototype;
- one continuous containing lane with subtle internal separation;
- two programme rows are sufficient for the compact Overview;
- only major programme landmarks are rendered;
- programme landmarks remain quiet when healthy;
- affected commitments may become amber/red when current authoritative state warrants it.

The specific number of days is prototype fixture data, not a generic product assumption. Production layout must derive its programme territories from the projection it receives.

---

## 5. Shared dependencies

Meaningful shared dependencies may remain visible in the healthy state because they communicate concentration risk and explain how NORTHSTAR understands the event as a connected system.

Examples may include:

- a shared inbound flight;
- a shared hotel block;
- a shared transfer;
- another supplier/service dependency shared across multiple journeys.

However, inclusion is based on operational relevance, not ontology membership.

The Overview projection should prefer dependencies that help explain:

- shared concentration;
- current health;
- current change;
- current blast radius.

Do not make every service or reservation a permanent node.

---

## 6. Traveller representation

Not all travellers need full cards in the healthy Overview.

Accepted behaviour:

- healthy ordinary travellers may be compressed into cohort / population representations;
- notable travellers may remain discoverable without being visually dominant;
- a traveller who enters current CHECKING / affected / disrupted attention may be **promoted** into an explicit traveller card;
- promoted travellers may temporarily override normal compression rules;
- cleared travellers fade substantially after reconciliation;
- unresolved travellers remain visually prominent until their current issue is resolved.

Key visual rule:

> **Operational importance overrides zoom/compression.**

The Sarah example is an accepted fixture demonstration, not a generic hardcoded rule.

---

## 7. Compact and expanded modes

The Overview Graph is not the whole page.

### Compact mode

Default height is approximately **30% of the viewport**.

Compact mode should:

- preserve all programme territories;
- show the current whole-event health shape;
- keep readable typography;
- preserve meaningful shared dependencies;
- show current exceptions;
- avoid a giant virtual canvas shrunk to illegible scale.

The graph should be composed near screen scale rather than rendering a huge world at 50% zoom merely to fit it.

### Expanded mode

The same graph may expand in place to approximately **70–80% of viewport height**.

Expansion does not create a second graph or second state model.

It only provides more room for:

- pan;
- zoom;
- labels;
- neighbourhood inspection;
- semantic detail.

The same projection, node identities, relation identities, and current state continue to apply.

---

## 8. State source of truth

As with the accepted V5.6 Case Graph:

> **State says what is true; the renderer decides how that truth is drawn.**

The renderer must not independently invent or toggle business truth based on:

- coordinates;
- CSS selectors;
- DOM position;
- traveller names;
- supplier names;
- route names;
- fixture ids;
- scenario-specific branches.

The accepted v7.2 prototype uses one shared graph model containing:

- entities;
- relationships;
- per-node display state;
- per-relationship display state;
- summary state;
- visibility;
- attention/focus hints;
- liveness.

Production names may differ, but the single-source-of-truth property is binding.

---

## 9. Colour grammar

The Overview reuses the V5.6 visual grammar.

### Green

Meaning: functioning / healthy / recovered at that level.

A green live dependency may pulse.

### Amber

Meaning: changed / degraded / currently being checked while still functioning.

Amber is not a generic warning bucket.

An amber live dependency may pulse more slowly.

### Red

Meaning: the current dependency or outcome cannot be satisfied.

Red dependencies are static and do not pulse.

### Grey / muted

Meaning: contextual, compressed, unknown, or de-emphasized display context depending on the frontend semantic contract.

Do not conflate muted display emphasis with operational failure.

---

## 10. Motion grammar

Motion communicates liveness, not severity.

Accepted rules:

- green live dependency → normal travelling pulse;
- amber live dependency → slower travelling pulse;
- red failed dependency → no pulse;
- contextual/dashed relationship → no pulse.

The healthy Overview should feel subtly alive even when no incident is active.

Do not flash red failures.

Pulse/liveness is a renderer concern. Do not add backend fields such as pulse speed or CSS-animation flags.

---

## 11. Semantic zoom

The Overview follows the same semantic zoom principle as V5.6.

Do not continuously shrink every label until it becomes unreadable.

At lower zoom:

- preserve entity recognition;
- preserve primary titles/state;
- hide lower-priority metadata;
- slightly compact cards.

At normal zoom:

- show full normal card detail.

At close zoom:

- richer detail may remain visible;
- do not introduce new business semantics solely because the camera is closer.

The accepted prototype uses V5.6-style overview / normal / detail thresholds as presentation logic.

---

## 12. Disruption lifecycle

The Overview is a current-world operational surface, not an event replay system.

For a meaningful shared disruption:

1. the changed shared dependency becomes visually active;
2. affected travellers are promoted from compressed population state;
3. those affected travellers enter generic CHECKING treatment while downstream evaluation settles;
4. relevant dependency paths strengthen;
5. unaffected world remains visible at reduced emphasis;
6. cleared travellers settle green and fade substantially;
7. unresolved travellers remain promoted;
8. the relevant programme commitment reflects current authoritative consequence;
9. clicking the unresolved traveller routes to the focused Case experience.

The Overview does not explain the full traveller causal chain.

That belongs to V5.6.

---

## 13. Camera / focus behaviour

Healthy default:

- fit the whole current Overview projection;
- preserve all programme territories;
- do not force an arbitrary focal traveller.

Active disruption:

- frame the **whole active incident footprint**;
- include the changed shared dependency;
- include all promoted affected travellers;
- include the relevant programme context;
- do not automatically zoom so tightly that the operator loses blast-radius context.

A deliberate “Focus traveller” action may tighten the view after the operator chooses it.

Selection itself must not automatically move the camera.

---

## 14. Selection behaviour

Every visible interactive entity may be selected.

Selection is a display concern only.

Accepted behaviour:

- selected node receives focus emphasis;
- its immediate visible dependency neighbourhood remains strong;
- unrelated visible entities and edges dim;
- camera position does not change;
- operational state does not change;
- clicking empty canvas or pressing Escape resets the emphasis.

The selection algorithm must be generic over the visible projection.

Do not add Sarah-specific or flight-specific click handlers to generic rendering code.

---

## 15. Relationship discipline

Every visible edge must answer a real operational question: **what depends on what in this Overview projection?**

Do not draw decorative lines merely because two objects belong to the same event.

Examples:

- a shared inbound service may connect to the programme landmark it materially feeds;
- a promoted affected traveller may connect to the shared dependency currently affecting them;
- an unresolved traveller may connect to the programme commitment currently affected by their journey state.

If a relationship cannot be justified semantically, omit it.

---

## 16. Connector geometry

Connectivity is semantic state.

Pixel geometry is renderer output.

The renderer must calculate connector geometry from the actual rendered cards.

Accepted rules:

- anchors derive from actual card bounds;
- use the minimum curvature necessary;
- prefer monotonic cubic curves;
- do not manually hand-place connector endpoints for each fixture;
- card resizing under semantic zoom must not leave dangling lines;
- geometry changes must not alter relationship meaning.

The v7.2 prototype uses rendered DOM bounds + resize observation to maintain connector alignment.

---

## 17. Healthy state

Healthy Overview must be a real state, not a blank canvas.

It should communicate:

> **NORTHSTAR is continuously watching the connected event world.**

Healthy state should contain:

- all programme territories;
- major programme landmarks;
- meaningful shared dependencies;
- population/cohort health;
- subtle live pulses;
- any pre-existing known attention/unknown state.

It should not automatically expand every traveller or every dependency.

---

## 18. Generality requirements

The renderer must remain generic across:

- different AnchorEvents;
- different programme durations;
- different traveller counts;
- different shared dependencies;
- different suppliers;
- different affected traveller groups;
- scenarios with or without programme commitments;
- scenarios where hotel/transfer/shared ground dependency becomes material;
- materially different recovery cases.

No generic rendering logic may branch on:

- Sarah;
- AI in Travel Summit;
- SQ322;
- Singapore;
- keynote;
- fixture-specific refs;
- demo-only coordinates or routes.

Demo facts belong in fixture/projection data.

If the projection cannot express a real operational requirement, report a contract/architecture gap instead of hardcoding around it.

---

## 19. Projection boundary

The production Overview should consume a purpose-built authoritative projection.

Conceptual direction:

**authoritative event/trip state → bounded Event Overview projection → normalized presentation state → renderer**

The Overview projection should expose only what is required for:

- health;
- shared concentration;
- active change;
- blast radius;
- current attention;
- routing to focused cases.

The browser must not infer:

- viability;
- causality;
- blast radius;
- policy;
- authority;
- consequence;
- programme impact

by traversing raw topology.

Those conclusions must be supplied by authoritative backend/read-model truth.

---

## 20. Relationship to Case Graph / V5.6

The Overview should stop before the detailed traveller causal explanation.

Example accepted handoff:

Overview shows:

- SQ322 changed;
- five travellers affected;
- four cleared;
- Sarah remains disrupted;
- Day 01 keynote affected.

Then the operator opens Sarah’s Case.

V5.6 explains the detailed current-world causal chain.

Do not duplicate the V5.6 dependency chain inside the Overview merely because the data exists.

---

## 21. Relationship to Entire Graph

The Overview and Entire Graph may share visual philosophy, but not information budget.

The Overview is curated and operationally bounded.

The Entire Graph may later allow deeper exploratory semantic zoom and a much broader entity set.

Do not implement the Overview as “Entire Graph with half the nodes hidden in CSS.”

The backend projection itself should be bounded.

---

## 22. Product-copy discipline

Every visible word must justify its space.

Avoid permanent explanatory prose inside the graph.

The operator should understand the visual grammar from:

- state;
- hierarchy;
- labels;
- interaction;
- detail on demand.

Prototype-only explanatory copy should not become production UI by accident.

---

## 23. Prototype guardrails

The accepted v7.2 prototype validates that:

- every relationship references existing entities;
- every scenario covers the same entity set;
- every scenario covers the same relationship set;
- node state is complete;
- relationship state is complete;
- red relationships are never live/pulsing;
- selection is generic;
- relationship geometry is renderer-derived.

These are prototype guards, not a final production schema.

---

## 24. Prototype-only limitations

The accepted v7.2 HTML is a visual/interaction prototype, not production frontend code.

Known prototype limitations that must not silently become architecture:

- fixture data is hardcoded display data;
- entity positions are manually composed for this presentation;
- the sample uses three programme days;
- only one disruption fixture is demonstrated;
- the exact shared-dependency inclusion threshold is not yet a frozen backend contract;
- the exact cohorting algorithm is not yet a frozen backend contract;
- semantic states are prototype display states pending production projection integration;
- the prototype uses a browser timer to simulate CHECKING → settled;
- the prototype does not prove the current PostgreSQL read model already produces the exact Overview projection required.

---

## 25. Production integration principle

Do not port this prototype by copying its mock `GRAPH.states` or fixture ids into application logic.

Production direction:

**authoritative PostgreSQL/read model → Event Overview projection → frontend semantic adapter → generic renderer**

The renderer owns:

- geometry;
- semantic zoom;
- motion;
- selection emphasis;
- pan/zoom;
- compact/expanded presentation.

The backend/read model owns:

- entity identity;
- relationship truth;
- semantic condition;
- visibility eligibility;
- blast-radius membership;
- current attention;
- authoritative change state.

---

## 26. Accepted artifact

The accepted HTML prototype is stored beside this document as:

`prototype/event-overview-v7.2.html`

This file is the accepted visual reference for the Event Overview Graph.

Where incidental fixture wording in the prototype and this contract differ, the design rules in this document and the production frontend contract take precedence over prototype-only copy.
