# WiT demo visual + product contract

**Purpose:** durable source of truth for the graph/product decisions settled in the current WiT finalist demo workstream.

This document does **not** replace the scenario/data SSOTs:

- `docs/work/WIT_DEMO_WORLD_PROGRAMME_SEED_FREEZE_v1.md`
- `docs/work/WIT_SEED_DECISIONS.md`
- `docs/work/WIT_JORDAN_CONCORDE_CAPTURE_REPORT.md`

Those own world facts, timings, provider provenance, participant assignments and seeded-vs-derived boundaries.

This document owns only:

1. the Live Dependency Graph product contract agreed in this WiT chat;
2. the Sarah graph projections;
3. the Jordan extension of the same graph system;
4. the post-M9 Sarah/Jordan acceptance target.

`docs/DESIGN.md` remains the visual-design authority.

---

# 1. Binding graph principles

## One canonical world, purpose-built projections

There is one authoritative dependency/state world.

Different screens expose scoped projections of that same world.

Required direction:

`authoritative state -> scoped read model / projection -> visual graph`

Never:

`raw graph -> frontend infers viability / impact / recovery`

The graph never owns business truth.

## Deterministic horizontal layout

All demo dependency graphs are deliberately placed **left -> right**.

Use deterministic HTML/SVG/CSS/JS rendering.

Do not use:

- force-directed layouts;
- physics;
- radial layouts;
- freeform graph exploration;
- raw ontology/database graphs;
- traveller/scenario-specific layout logic.

The graph should read as a causal operational world, not a developer debugger.

## State semantics

Use `docs/DESIGN.md`:

- **green** — healthy / confirmed / done;
- **brass** — proposed / changed / waiting / needs eyes;
- **vermilion** — broken / blocked / decision required;
- **grey** — unknown / missing / unverified;
- **ink** — system actively working.

Healthy is always green, never grey.

State must never be colour-only; include labels/glyphs/text.

## Edge semantics

- **solid green** — authoritative healthy relation;
- **solid vermilion** — authoritative broken relation;
- **dashed brass** — proposed/counterfactual relation;
- **dotted grey** — unknown/missing/unverified relation;
- **ink** — active tracing / planning / work-in-progress where useful.

Proposed state must never look authoritative before commit.

## Revision-driven motion

> **R2 reconciliation (2026-09-19, authoritative — see
> `docs/work/R2_CASE_DECISION_SURFACE_CONTRACT.md` §5/§9):** the "No decorative
> perpetual pulsing" clause below is SUPERSEDED for ambient dependency pulse. R2
> separates two concepts: (1) ambient pulse is PURE FRONTEND animation derived from
> semantic condition (green normal / amber slower / red none), NOT a backend
> liveness field and NOT gated on revision events; (2) revision-driven transition
> animation (only changed items animate on a new snapshot) remains valid and
> separate. No backend liveness state is added.

Graph motion follows actual projection revisions/state changes.

Prefer `revision`, `changedNodeIds`, `changedEdgeIds` or equivalent semantics so only changed items animate.

No fake timers. No fake AI thinking. No decorative perpetual pulsing.

Entry stagger should remain restrained (<= 600 ms total).

---

# 2. Shared graph/read-model contract

Exact DTO names may follow current M9 contracts, but the protected semantics are:

```ts
{
  scope,
  revision,
  rootRefs,
  nodes,
  edges,
  changedNodeIds,
  changedEdgeIds,
  focusPath,
  summary
}
```

A presentation-safe node needs enough information to render a meaningful operator-facing entity, for example:

```ts
{
  id,
  kind,
  label,
  secondaryLabel,
  state,
  provenance,
  href?
}
```

Edges need at minimum:

```ts
{
  id,
  from,
  to,
  relation,
  state
}
```

Meaningful projection concepts may include:

- disruption/source event;
- affected service/booking;
- traveller;
- meaningful arrival/timing state;
- transfer/stay when causally relevant;
- programme commitment;
- proposed recovery;
- authority/action/observation where relevant.

Do not expose every canonical domain object merely because it exists.

---

# 3. Sarah — protected graph projections

Sarah is the primary WiT hero.

Her graph story must prove that the airline can recover the booking while the trip remains broken.

## 3.1 Dashboard operational-impact projection

Direction:

`SIGNAL / CHANGE -> SERVICE -> AFFECTED TRAVELLERS -> CONSEQUENCE / COMMITMENT`

For the frozen Sarah world:

```text
[ID7159 CANCEL / ID7153 REPROTECTION] -> [SHARED CGK->SIN SERVICE] -> [SARAH] -> [11:30 HEADLINE] -> DISRUPTED
                                                                    -> [ARJUN] -> [13:50 KEYNOTE] -> ON TRACK
                                                                    -> [SITI]  -> [14:00 PANEL]   -> ON TRACK
                                                                    -> [MEI]   -> [14:00 PANEL]   -> ON TRACK
                                                                    -> [FELIX] -> [16:30 TALK]    -> ON TRACK
```

Required summary:

> **5 affected · 1 disrupted · 4 still on track**

The five-person affected set and each outcome must come from runtime/read-model truth, not hardcoded graph colouring.

## 3.2 Sarah focused causal projection

Direction:

`REPLACEMENT FLIGHT -> ARRIVAL -> OPERATIONAL WINDOW -> PURPOSE`

Frozen geometry:

```text
[ID7153 REPROTECTED ✓] -> [SIN ARRIVAL 10:30 ✓] -> [60 MIN AVAILABLE / 150 REQUIRED ✕] -> [11:30 HEADLINE ✕] -> [TRIP NOT VIABLE]
```

The critical visual contrast is:

> **FLIGHT = GREEN**
>
> **TRIP / PURPOSE = RED**

Do not mark the replacement flight broken merely because the overall trip is not viable.

## 3.3 Programme / incident blast-radius projection

Direction:

`CHANGE -> PEOPLE -> TRIP DEPENDENCIES -> PROGRAMME`

For Sarah's programme recovery, include only genuinely affected people/relationships, including as applicable:

- Sarah;
- Daniel Ong;
- Elena Tan;
- any other participant genuinely linked to the affected commitments.

Do not add unrelated people for visual density.

## 3.4 Counterfactual programme preview

Current authoritative state:

```text
[SARAH]  -> [11:30 HEADLINE]      BROKEN
[DANIEL] -> [14:30 LOCAL HOST]    HEALTHY
```

Proposed counterfactual:

```text
[SARAH]  - - -> [14:30 HEADLINE]      PROJECTED HEALTHY
[DANIEL] - - -> [11:30 LOCAL HOST]    PROJECTED HEALTHY
```

Before approval/commit:

- current relations remain authoritative;
- proposed relations are dashed brass;
- preview performs zero authoritative mutation.

After approval -> commit -> observation -> reassessment:

- new programme relations become authoritative;
- dashed brass becomes solid green only if the observed/revalidated state is healthy;
- old authoritative relations retire;
- the same Sarah trip re-evaluates.

The operator must be able to distinguish current vs proposed state clearly.

---

# 4. Sarah — agreed interaction/state progression

The settled Sarah progression is:

**Healthy -> Signal -> Blast Radius -> Why Sarah Fails -> Recovery Proposal -> Impact/Approval -> Execute/Observe/Recover**

Important interaction expectations:

- select a traveller branch -> focus/open that case;
- inspect a failed node/path -> plain-language reason;
- compare current authoritative vs proposed counterfactual state;
- inspect projected affected people/viability before commit;
- approval releases the real change path;
- the same graph/read model updates after observation rather than jumping to a detached success screen.

The graph is expected to be polished and visually strong. It is not a raw graph editor; the operator is inspecting, comparing, approving and following recovery.

---

# 5. Jordan — extension of the same graph system

Jordan does not introduce a second graph philosophy.

His role is to prove progressive live state plus coordinated multi-domain recovery.

## 5.1 Progressive connection-state projection

Direction:

`LAX FLIGHT -> NRT ARRIVAL -> CONNECTION WINDOW -> NRT->SIN LEG -> SIN ARRIVAL`

The **same horizontal path** revises as D1-D4 arrive:

- baseline healthy;
- D1 safe;
- D2 at risk;
- D3 ZG053 impossible;
- TR875 may appear as temporary recovery;
- D4 eliminates TR875 and forces an overnight consequence.

State changes only on actual runtime/input changes.

## 5.2 Airline-default causal proof

Airline-default TR867 may be a valid booking while the trip remains invalid:

```text
[TR867 BOOKING ✓] -> [SIN ARRIVAL 20:45 ✓] -> [0 MIN TO 20:45 FINALS ✕] -> [WHOLE TRIP NOT VIABLE]
```

This intentionally echoes Sarah's booking-valid / trip-invalid thesis.

## 5.3 Deep whole-trip recovery projection

Direction remains left -> right.

Conceptually:

```text
[BROKEN NRT CONNECTION] -> [TR885 RECOVERY FLIGHT] -> [SIN ARRIVAL 14:35] -> [20:45 FINALS ✓]
                        -> [NARITA OVERNIGHT] -> [STAY VALID / OBSERVED]
                        -> [CHANGED SIN ARRIVAL] -> [SINGAPORE HOTEL CONSEQUENCE]
                                                  -> [AIRPORT TRANSFER CONSEQUENCE]
```

The graph must support the distinction:

> **The airline recovered the passenger. NORTHSTAR recovered the trip.**

## 5.4 Multi-action recovery truth

Consequential actions may carry their own:

- cost;
- authority state;
- execution state;
- observed result;
- partial-failure state.

For destination-stay cancel+rebook, the ordering must remain truthful:

```text
[QUOTE / AUTHORITY] -> [BOOK REPLACEMENT] -> [OBSERVE CONFIRMED] -> [CANCEL DISPLACED] -> [OBSERVE CANCELLED] -> [REASSESS]
```

If a consequential branch fails or remains ambiguous, the graph/read model must not imply full recovery.

---

# 6. Post-M9 functional acceptance

Leave M9 to finish independently.

After M9 is accepted, this WiT lane has two functional goals.

## Sarah definition of done

Without reset between disruption and recovery:

1. coherent viable baseline;
2. shared disruption/reprotection enters through the normal path;
3. all five replacement bookings remain valid;
4. five-person blast radius comes from runtime truth;
5. Sarah is derived NOT_VIABLE while Arjun, Siti, Mei and Felix remain VIABLE;
6. focused graph proves green flight / red trip purpose;
7. normal recovery planning evaluates travel/programme options;
8. Sarah<->Daniel programme recovery is available;
9. preview is mutation-free;
10. current/proposed state is rendered truthfully;
11. affected linked participants are projected viable;
12. real authority/approval path runs;
13. programme change commits;
14. observation/state update occurs;
15. same Sarah trip becomes VIABLE;
16. no new Sarah flight is purchased;
17. four peers remain viable.

## Jordan definition of done

1. viable ZG023->ZG053 baseline;
2. D1-D4 revise the same graph/state path;
3. safe -> at-risk -> impossible is derived truthfully;
4. TR875 can appear then disappear;
5. overnight NRT consequence is derived;
6. TR867 can be a valid booking while whole trip is NOT_VIABLE;
7. TR885 is evaluated as the stronger recovery;
8. Narita overnight consequence/action is present;
9. Singapore hotel consequence/action is present;
10. transfer consequence is present where represented;
11. finals viability is restored by the whole plan;
12. authority/execution/observation remains truthful per action;
13. partial failures remain partial;
14. final whole-trip viability is recomputed;
15. recovered/resolved only when required authoritative state is valid or remaining uncertainty is explicitly escalated.

---

# 7. Remaining scope after M9

## Act Now

- Sarah end-to-end hardening.
- Jordan end-to-end hardening.
- Implement/polish the agreed left-to-right projections against actual M9 state/read models.
- Ensure graph state remains truthful through preview, approval, execution, observation and reassessment.

## Investigate Now

Only if one of the two heroes fails: classify the issue as fixture/data drift, read-model/product integration, generalized engine bug or architecture gap. Fix the generic cause.

## Park for Later

- exact presenter timing;
- click-by-click recording choreography;
- extra scenarios / S8 unless contaminating the heroes;
- raw graph explorer;
- immigration/visa expansion;
- insurance execution;
- extra transfer-provider integration;
- further OpenRouter work;
- Batik evidence capture unless needed for a truthful external claim.

## Ignore / Accept Risk

- Sarah Batik geometry remains honestly synthetic/organiser-supplied until provider evidence is captured.
- REPLAY/sandbox provider actions are acceptable when provenance is explicit.
- Synthetic disruption triggers are acceptable at the external-event boundary.

---

# Appendix A — optional visual reference only

**This appendix is non-binding. It is not the product contract and must not override the main sections above.**

The current accepted graph visual direction is `docs/design/live-dependency-graph/README.md` (v5.6). The `media/seq06-live-dependency-graph/` material below is older optional inspiration, not the accepted reference.

Older NORTHSTAR System World / hackathon-video work may be consulted as optional visual inspiration for motion/composition, especially:

- `docs/MOTION_DESIGN.md`
- `media/seq05-objective-field/`
- `media/seq06-live-dependency-graph/`
- `media/seq07-blast-radius/`
- `media/seq08-resolution-engine/`
- `media/seq09-qwen-atlas/`
- `media/seq10-authority-hitl/`
- historical `docs/HACKATHON_VIDEO_STORYBOARD_AND_ASSET_PLAN.md` at commit `185d84f1ebd6bb99340935fae5253d3c67aca3b8`

Useful optional motifs from that older work include:

- level-of-detail focus from programme scale into a traveller;
- selective dimming of unrelated context;
- one-time causal propagation traces;
- contextual constraint cards/tethers;
- strategy branches growing from an impacted trip;
- deterministic rejection/de-emphasis of invalid strategies;
- restrained provider/evidence nodes;
- visible authority boundary / human-in-the-loop concept;
- observation/state-update reconciliation;
- NORTHSTAR's cockpit-daylight visual language.

These are references only. They do **not** require recreating old video camera choreography, old scenario timings, old graph technology experiments, or old storyboard structure.

Where old material conflicts with the main body of this document or current scenario/data SSOTs, the main body/current SSOT wins.