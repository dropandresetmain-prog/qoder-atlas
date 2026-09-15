# WiT demo visual + product contract

**Purpose:** durable source of truth for the **WiT demo product behaviour and visual graph projections** after the programme/world seed was frozen.

This document does **not** replace the scenario/data SSOTs:

- `docs/work/WIT_DEMO_WORLD_PROGRAMME_SEED_FREEZE_v1.md`
- `docs/work/WIT_SEED_DECISIONS.md`
- `docs/work/WIT_JORDAN_CONCORDE_CAPTURE_REPORT.md`

Those own world facts, provider provenance, programme timings, participant assignments and seeded-vs-derived boundaries.

This document owns:

1. what the WiT product demo must prove;
2. the already-agreed graph / dependency visual contract;
3. the Sarah and Jordan end-to-end acceptance stories after M9;
4. what remains in scope and what is deliberately parked.

The implementation must also comply with `docs/DESIGN.md`.

---

## 1. Product thesis the demo must make obvious

> **A replacement booking is not necessarily a recovered trip.**

Northstar maintains live trip state and dependencies, evaluates downstream impact, proposes whole-trip recovery, validates it deterministically, checks authority, executes permitted actions, observes provider outcomes and keeps going until the trip is valid again or explicitly escalated.

The graph/state model is central. Chat is only an interface.

The demo must visibly prove:

`change -> state update -> blast radius -> recovery strategies -> deterministic viability -> authority -> action -> observation -> recovered/resolved state`

Do not fake intermediate states just to make the demo look agentic.

---

## 2. Visual system already agreed

### 2.1 General graph direction

All demo dependency graphs are **deterministic horizontal left-to-right projections**.

Do not use:

- force-directed layouts;
- physics;
- freeform graph exploration;
- draggable nodes;
- radial layouts;
- cinematic camera movement;
- raw database/ontology graphs in the user-facing product.

The graph should read like an operational causal chain, not a developer debugger.

### 2.2 One canonical world, multiple projections

There is **one authoritative dependency/state world**.

The product may expose multiple purpose-built projections of that world.

The frontend must **never infer business truth from the visual graph**. The graph is a projection of authoritative read-model/state truth.

Required rule:

> **Business truth -> scoped read model / projection -> visual graph**

Never:

> **raw graph -> frontend guesses viability / impact / recovery**

### 2.3 State semantics

Use the binding state language from `docs/DESIGN.md`:

- **Green** — confirmed, healthy, done.
- **Brass** — proposed, waiting, changed, needs eyes.
- **Vermilion** — broken, blocked, decide now.
- **Grey** — unknown, missing, unbooked or unverifiable.
- **Ink** — the system is actively working on it.

Healthy is always green, never grey.

State must never rely on colour alone. Use labels/glyphs/text as well.

### 2.4 Edge semantics

For journey / dependency links:

- **solid green** — authoritative and healthy;
- **dashed brass** — proposed / counterfactual / awaiting confirmation or decision;
- **solid vermilion** — authoritative but broken / no longer viable;
- **dotted grey** — unknown / missing / unbooked.

A proposal must not visually look authoritative before commit.

### 2.5 Motion

Motion is state-driven only.

- Changes animate when projection revision/state actually changes.
- Prefer a revision/change-set concept so only changed nodes/edges animate.
- Entry stagger total <= 600 ms.
- No fake timers.
- No fake AI-thinking animation.
- No looping decorative pulses except the limited design-system allowance for a `LIVE` indicator.
- Proposed -> committed is a meaningful transition: dashed brass can become solid green only after authoritative commit + observation/reassessment.

---

## 3. Shared compact journey-chain component

Case views retain the already-defined chain:

`flight — transfer — stay — ✦ commitment`

This is the fastest compact answer to:

> **Is the trip still a trip?**

The chain is not a substitute for the larger Live Dependency Graph projections below. It is the compact case-level summary.

---

# 4. Sarah visual contract

Sarah is the **primary WiT hero**.

Her visual story must prove that the airline can successfully recover the booking while the trip remains broken.

The Sarah flow uses **four specific graph projections** from the same underlying state.

---

## 4.1 Projection A — dashboard operational impact graph

### Purpose

Show the shared disruption and differentiated downstream outcomes at a glance.

### Direction

Strictly **left -> right**.

### Conceptual hierarchy

`signal/change -> affected service -> travellers -> consequence / commitment`

### Frozen Sarah shape

The shared CGK disruption affects five travellers:

- Sarah Lim;
- Arjun Rao;
- Siti Rahmah;
- Mei Ling Goh;
- Felix Hartono.

All five are reprotected onto the same replacement arrival at 10:30.

Their programme dependencies then diverge:

- Sarah -> 11:30 REQUIRED headline -> **broken**;
- Arjun -> 13:50 REQUIRED keynote -> **healthy**;
- Siti -> 14:00 REQUIRED panel -> **healthy**;
- Mei Ling -> 14:00 REQUIRED panel -> **healthy**;
- Felix -> 16:30 REQUIRED provocation -> **healthy**.

### Required message

The screen should make this obvious without explanation:

> **5 affected · 1 disrupted · 4 still okay**

### Important rule

The five-person blast radius and each traveller's viability come from authoritative dependency + evaluation output. Do not hardcode red/green branches in the graph component.

### Minimum interaction

Clicking/selecting a traveller branch should open/focus that traveller/case.

---

## 4.2 Projection B — Sarah focused causal graph

### Purpose

Explain **why Sarah is broken even though the airline replacement booking is valid**.

This is the most important causal visual in the Sarah case.

### Direction

Strictly **left -> right**.

### Required causal chain

`replacement flight -> arrival -> operational readiness window -> programme purpose`

For the frozen world:

- replacement booking / flight is valid and therefore **green**;
- arrival is 10:30 and known/confirmed;
- REQUIRED physical-presence readiness rule is 150 minutes;
- Sarah's headline is 11:30;
- only 60 minutes are available;
- the commitment/trip purpose fails;
- Sarah journey is NOT_VIABLE.

### Critical visual contrast

The graph must visibly support:

> **FLIGHT = GREEN**
>
> **TRIP / PURPOSE = RED**

This contrast is the product thesis in one frame.

Do not make the flight red simply because the trip is broken.

### Minimum interaction

The user/operator must be able to inspect the failed reason in plain language, e.g. the available readiness time versus required readiness time.

---

## 4.3 Projection C — programme / incident blast-radius graph

### Purpose

When viewing a programme change or incident, show what else would be touched beyond Sarah alone.

### Direction

Strictly **left -> right**.

### Conceptual hierarchy

`CHANGE -> PEOPLE -> TRIP DEPENDENCIES -> PROGRAMME`

This is broader than the compact journey chain and narrower/more purposeful than a raw graph explorer.

For the Sarah swap, the projection must include the people and commitments genuinely affected by the proposed programme change, including at minimum:

- Sarah;
- Daniel Ong;
- Elena Tan where her linked headline/interviewer relationship moves with the session;
- any other participant actually linked to the swapped commitments.

Do not include unrelated people purely to make the graph look dense.

---

## 4.4 Projection D — programme counterfactual preview graph

### Purpose

Show the difference between **current authoritative programme state** and **proposed counterfactual state** before mutation.

### Direction

Strictly **left -> right**.

### Current state

- Sarah -> 11:30 headline -> broken under current arrival/readiness.
- Daniel -> 14:30 local host session -> healthy.

### Proposed state

- Daniel -> 11:30 local host session -> projected healthy.
- Sarah -> 14:30 headline -> projected healthy.

### Visual semantics

Before approval/commit:

- current authoritative edges remain authoritative;
- proposed swap edges are **dashed brass**;
- proposed nodes/edges must not look committed;
- preview performs **zero authoritative mutation**.

After approval + commit + observation + reassessment:

- new programme relationships become authoritative;
- dashed brass proposal edges become **solid green** if observed/revalidated healthy;
- old relationships are removed/retired from the authoritative projection;
- Sarah's same trip re-evaluates to viable.

### Minimum interaction

The UI must let the operator distinguish:

- **current**;
- **proposed**;
- affected people;
- projected viability.

Do not reduce the preview to a plain text card if the projection data exists.

---

# 5. Jordan visual contract

Jordan is the second scenario and proves **progressive disruption + coordinated multi-domain recovery**.

Sarah proves Northstar knows when **not** to buy/change travel.

Jordan proves that when Northstar **should** act, it can coordinate a whole-trip repair.

Jordan does not need a separate graph philosophy. He uses the same deterministic left-to-right projection rules.

---

## 5.1 Jordan progressive connection-state graph

### Purpose

Show that the system is maintaining live trip state before the traveller is simply stranded and asking for help.

### Direction

Strictly **left -> right** along the travel dependency.

Conceptually:

`LAX flight -> NRT arrival -> connection window -> NRT->SIN onward leg -> Singapore arrival`

The connection state progresses through actual scenario updates:

- baseline healthy;
- D1 safe;
- D2 at risk;
- D3 impossible for ZG053;
- temporary TR875 alternative may appear;
- D4 eliminates TR875 and forces overnight NRT consequence.

Do not animate these states on a timer. They change only when the corresponding runtime/input state changes.

---

## 5.2 Jordan deep dependency / recovery graph

### Purpose

Show that the missed connection affects multiple downstream trip elements and that recovery is a coordinated plan, not a flight recommendation.

### Direction

Strictly **left -> right**.

### Required causal / dependency shape

The broken connection must propagate into at least:

`missed NRT connection -> replacement flight`

`missed NRT connection -> Narita overnight`

`changed Singapore arrival -> Singapore stay consequence`

`changed Singapore arrival -> airport transfer consequence`

`changed Singapore arrival -> 20:45 programme commitment viability`

The recovery strategy then contains coordinated actions such as:

1. use/select TR885 rather than airline-default TR867;
2. book Narita overnight;
3. adjust/rebook the Singapore stay using the supported cancel+rebook mechanism;
4. re-time / redispatch the Singapore transfer where represented;
5. re-evaluate the finals commitment / whole trip.

### Airline default contrast

The graph/read model must support the distinction:

- airline-default TR867 may be a valid booking;
- it still produces an invalid whole trip against the 20:45 commitment;
- TR885 can restore programme viability when combined with downstream repairs.

The visual should support the sentence:

> **The airline recovered the passenger. Northstar recovered the trip.**

### Execution / observation semantics

Jordan's recovery is multi-action.

Each consequential action can have its own:

- cost;
- authority state;
- execution state;
- observed provider result;
- failure/partial-failure state.

The graph/step UI must not imply FULLY_RECOVERED while a consequential action remains incomplete or ambiguous.

Examples:

- Narita booking failure -> unresolved;
- Singapore replacement confirms but displaced booking cancellation fails -> duplicate-booking exposure, not full recovery;
- quote changes -> return to viability/authority;
- ambiguous provider status -> do not claim success.

---

# 6. Graph implementation contract

The Live Dependency Graph UI is a **projection system**, not a graph editor.

## Required properties

1. **Deterministic layout** — horizontal left-to-right.
2. **Scoped projections** — dashboard, focused causal, programme blast radius, programme counterfactual, Jordan deep recovery.
3. **Authoritative state outside the graph** — graph renders read-model truth.
4. **Stable node identity** across revisions where the underlying entity is the same.
5. **Revision/change-set awareness** where practical so state changes animate locally rather than rerendering theatrically.
6. **Current vs proposed distinction** must be explicit.
7. **Plain-language labels** — no internal ontology/debug jargon in operator-facing copy.
8. **Accessible state** — colour plus glyph/label/text.
9. **No force physics / graph database visualiser aesthetic**.
10. **No scenario-specific component branches** for Sarah/Jordan/flight numbers/airports/hotel IDs.

## Minimum interactions already agreed

- click/select a traveller branch -> focus/open case;
- inspect failed reason / consequence;
- clearly distinguish current vs proposed programme state.

Everything beyond that is optional and must not block the two demo scenarios.

---

# 7. Post-M9 scenario acceptance

The M9 lane owns its own completion. Do not interrupt or reopen it for visual work.

After M9 is accepted, the WiT lane has only two functional acceptance goals.

## 7.1 Sarah end-to-end definition of done

Without resetting between disruption and recovery:

1. Sarah + four peers begin in a coherent viable baseline.
2. Shared supplier disruption/reprotection enters through the normal external-event path.
3. All five replacement bookings remain valid.
4. Blast-radius projection shows five affected.
5. Runtime evaluation derives:
   - Sarah NOT_VIABLE;
   - Arjun VIABLE;
   - Siti VIABLE;
   - Mei Ling VIABLE;
   - Felix VIABLE.
6. Sarah case visibly explains why the replacement flight is green while her trip purpose is red.
7. Recovery planning evaluates travel/programme options through the normal engine.
8. Programme-side Sarah<->Daniel recovery is available.
9. Preview is mutation-free and shows the current/proposed graph truthfully.
10. Preview projects Sarah and Daniel/linked participants viable.
11. Authority/approval runs through the real path.
12. Programme change commits.
13. Observation/state update occurs.
14. The **same Sarah trip** re-evaluates to VIABLE.
15. No new Sarah flight is purchased.
16. The other four shared travellers remain viable.

Pass means underlying trip/programme state is coherent, not merely that the case label says `RESOLVED`.

## 7.2 Jordan end-to-end definition of done

1. Jordan begins viable on ZG023 -> ZG053.
2. Progressive updates move connection state through safe -> at risk -> impossible.
3. Temporary same-night recovery can appear and later disappear when D4 makes it unboardable.
4. Overnight NRT consequence is derived.
5. Airline-default TR867 can be a valid booking while whole trip remains NOT_VIABLE.
6. Northstar identifies/evaluates TR885 as the stronger recovery.
7. Recovery plan includes the downstream trip consequences needed by the frozen world:
   - Narita overnight;
   - Singapore stay date consequence;
   - ground-transfer consequence where represented;
   - programme viability.
8. Authority/approval is disclosed at whole-strategy level while execution remains per action.
9. Consequential actions are executed/observed through their real/simulated provider boundaries as configured.
10. Partial failures remain partial.
11. Final whole-trip viability is recomputed.
12. Jordan reaches recovered/resolved only when all required state is valid or remaining uncertainty is explicitly escalated.

---

# 8. Remaining WiT scope after M9

## Act Now

- Make Sarah work end-to-end against the accepted M9 runtime.
- Make Jordan work end-to-end against the accepted M9 runtime.
- Implement / finish the agreed left-to-right graph projections above using actual read-model/state revisions.
- Ensure graph states remain truthful through preview, commit, execution and observation.

## Investigate Now

Only if one of the two hero scenarios fails:

- classify whether the failure is fixture/data drift, product/read-model integration, generalized engine bug or architecture gap;
- fix the generalized cause rather than adding scenario branches.

## Park for Later

- exact presentation timing;
- click-by-click recording choreography;
- graph explorer / filters / raw ontology browser;
- equal polish for additional scenarios;
- S8 realignment unless it contaminates Sarah/Jordan;
- immigration/visa expansion;
- insurance execution;
- fancy transfer-provider integration;
- further OpenRouter work;
- provider-class naming cleanup;
- additional Batik evidence capture unless needed for truthful external presentation.

## Ignore / Accept Risk

- Sarah's Batik cancellation/reprotection is currently honest synthetic/provider-unverified scenario input.
- Progressive Jordan delay events are synthetic provider-boundary inputs.
- Programme world is synthetic by design.
- Nuitée/Atlas REPLAY is acceptable when provenance is explicit.

---

# 9. Non-goals / anti-regression

Do not:

- redesign Northstar;
- reopen broad product discovery;
- build a generic graph editor;
- make graph visuals vertical merely because a library defaults that way;
- use force-directed placement;
- let UI calculate viability from node positions or colours;
- fake AI-thinking states;
- fake execution success;
- mark a booking red just because the trip is red;
- make proposed programme edges look committed;
- add Sarah/Jordan/airport/flight/hotel branches to domain logic;
- restart timing/deck/storyboard planning before the two scenarios work.

The remaining objective is deliberately narrow:

> **After M9: get Sarah and Jordan working end-to-end, with the already-agreed left-to-right dependency/state visuals making the runtime truth obvious.**
