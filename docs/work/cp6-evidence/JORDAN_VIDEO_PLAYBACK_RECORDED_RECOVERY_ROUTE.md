# Jordan video playback — recorded recovery route (founder session)

Captured after the founder recording on **2026-09-23** (playback server `http://127.0.0.1:8787`, CP6 staging corpus). Case reached **RESOLVED**; this document is the authoritative log of what the product planned, executed, and showed.

Structured machine log: [`jordan-recorded-recovery-route-log.json`](./jordan-recorded-recovery-route-log.json).

## Identity

| Field | Value |
|--------|--------|
| Case | `2948b19e-8652-51e4-825d-8b0997037d00` |
| Recommended strategy | `5dda2d93-ca2b-5506-80b2-e762828d01a7` (option 1) |
| Journey | `JOURNEY:ab497dd8-6a86-5a03-9835-7b4b9813d1aa` (Jordan Hale) |
| Disruption | `TRANSPORT_SCHEDULE_OBSERVED` @ 2026-09-28T22:00:00Z (ZG023 delay → missed NRT connection) |
| Final state | **RESOLVED**, trip viability **PASS**, booking state **RECOVERED** |

## Intended recovery story (strategy effects)

The viable recommended path is a **connection + overnight + stay replacement** bundle, not “flight only”:

1. **SELECT_OFFER** — Replace the NRT→SIN segment (`JOURNEY_ITEM:f5218a0d-…`) with TR routing arriving SIN **2026-09-30 14:35 +08**.
2. **ADD_JOURNEY_STAY** — Narita Gateway overnight **29 Sep 15:00 → 30 Sep 11:00** (`JOURNEY_ITEM:3e1d2938-…`).
3. **CANCEL_STAY** — Cancel original lyf Bugis **29 Sep → 3 Oct** (`JOURNEY_ITEM:529fefcf-…`); **USD 0** penalty; **USD 954.16** displaced credit.
4. **ADD_JOURNEY_STAY** — Replacement lyf Bugis **30 Sep 15:00 → 3 Oct** (`JOURNEY_ITEM:6e2719fb-…`).

Comparator economics (decision time): net **−131.36 SGD** home exposure after displaced-stay credit (see case `planningEvidence`).

## What actually executed (runtime log)

Chronological server lines for this case (abbreviated):

```
REPLAN → PLANNED (STALE_RETRY_REQUIRED)
REPLAN → FAILED (PLAN_PERSIST_FAILED: SERIALIZATION_RETRY_EXHAUSTED)   # D1–D3 path hiccup; later replan succeeded
REPLAN → PLANNED (AWAITING_AUTHORITY)
external execution SUCCEEDED  intent=4b0ef64d-…   # flight select
stay execution REFUSED        intent=73c1d761-…  # ASSESSMENT_NOT_CURRENT (reassessment race)
stay execution SUCCEEDED      intent=73c1d761-…  # Narita book USD 35.18
stay execution SUCCEEDED      intent=4dee149e-…  # Singapore replacement book USD 714.74
stay execution SUCCEEDED      intent=52434afe-…  # Original stay cancel
RESOLVE → RESOLVED
```

**Execution order vs operator narrative**

| Step | Capability | USD | Notes |
|------|------------|-----|--------|
| 1 | `external:offer.select` | 101.19 | Replacement flight booked first |
| 2 | `external:stay.book` | 35.18 | Narita overnight (after one reassessment deferral) |
| 3 | `external:stay.book` | 714.74 | Singapore replacement **before** cancel of original |
| 4 | `external:stay.cancel` | 0 | Original lyf Bugis cancelled last |

The persisted DAG uses `dependencyOrder` **0 → 3 (Narita) → 1 (Singapore book) → 2 (cancel)** with edges that require **Singapore book before original cancel**, and **Narita book before Singapore book**. That is internally consistent with execution but **contradicts a natural “cancel displaced stay, then book replacements” story** and can confuse the Case graph / action timeline during recording.

## Product issues visible on this route (for main chat)

### 1. Programme participation vs recommended path — **Act Now**

For the **RECOMMENDED** candidate, programme check for **Bootcamp Opening Cocktails** is stored as **PASS** (`participation_feasible`) even though:

- Programme deadline: **2026-09-30 12:45 +08**
- Modelled arrival at SIN: **2026-09-30 14:35 +08** (after deadline)

The same candidate marks other flight options **FAIL** with `arrives_after_deadline` for the same programme item. The recommended TR885-class arrival appears to inherit PASS from a template that still lists the cocktail as feasible with `availableMinutes: 370` — **inconsistent with wall-clock arrival after deadline**.

**Risk:** Founder/demo shows a “recommended” path that operators would read as making the opening cocktails, when deterministic checks on sibling candidates say otherwise.

**Classification:** Act Now (RC-6 / programme evaluator seam on stay-replacement composite candidates).

### 2. Case causal path empty — **Investigate Now**

Case JSON exposes `causalPath: []` while `originalFocusedGraph` and LDG carry rich breakpoint data (`connection_below_minimum` on NRT arrival timing). Recovery storytelling in Case may not surface the same causal chain as Event Overview / original graph.

### 3. LDG ordering edge — **Park for Later**

Post-resolution LDG includes `MUST_HAPPEN_BEFORE` from **cancelled original lyf** → **replacement lyf**. Visually this can read as “original stay before replacement” rather than “cancel then replace”.

### 4. Planning flake under load — **Park for Later**

`SERIALIZATION_RETRY_EXHAUSTED` during replan before D3 (`PLAN_PERSIST_FAILED`) — reassessment-heavy playback can briefly show **FAILED** planning before a later attempt reaches `AWAITING_AUTHORITY`. Not a wrong final route but noisy for demo.

## Post-resolution authoritative graph (summary)

- **Flight:** TR NRT→SIN confirmed (`SERVICE_BOOKING:bcc74cd3-…`).
- **Stays:** Narita Gateway confirmed; original lyf **CANCELLED**; replacement lyf **CONFIRMED** (shifted check-in 30 Sep).
- **Programme nodes:** Still shown HEALTHY on graph for both Bootcamp and Hackathon items.

## Evidence files

- Case snapshot (API): captured as `tmp-case-recorded.json` in worktree during doc authoring (not committed).
- This markdown + `jordan-recorded-recovery-route-log.json` committed under `docs/work/cp6-evidence/`.
