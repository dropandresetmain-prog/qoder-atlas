# 05 — Trip Assembly Investigation

> Reality Validation milestone, investigation area #5 ("Raw unseen sources → usable Trip").
> RESEARCH ONLY. No product implementation. Architecture DELTAS are proposals, not code.

Branch: `rv/trip-assembly-investigation` (based on `6d20396`).
Scope: minimum generic assembly process that turns independent external sources
into a Trip the recovery engine can reason over, without hand-authoring
`ScenarioSpec`. Covers traveller/entity/org/place resolution, element
ordering/dependency inference, objective extraction, policy assignment, source
authority, conflict handling, uncertainty and human confirmation gates.

Evidence labels: `DOCUMENTED` (in-repo doc/contract/code), `INFERRED` (reasoned
from named mechanisms), `UNKNOWN` (not resolved here). No live/sandbox probe —
sandbox has no credentials (per README §"Sandbox environment facts").

## Executive summary

The current bootstrap path (`src/app/bootstrap.ts:seedScenarioBundle` →
`buildSeedOperations`) is a **hand-authored bundle → all-or-nothing mutation
proposal** translator. It assumes the bundle already contains a fully-resolved
Trip (id, travellerIds, anchorEventId, all elements with place refs, all
objectives, all rule sets, all constraints, all sources). It does not assemble
anything; it only persists. The generalisation needed is an **assembly layer
sitting between source ingestion and the existing mutation path** that turns
"here are independent sources" into a `ScenarioSpec` (or directly into
`MutationOperation[]`) the rest of the engine already understands.

Bottom line — the smallest credible pipeline is six stages, all of which the
frozen contracts can already express *with two deltas* (one assembly DTO and
one `ProvisionalBinding` / "candidate fact" overlay). AI is used only for
semantic proposals and uncertain linking; deterministic code validates and
writes. The LLM never authoritatively mutates the graph (ADR-003/ADR-005).

- **Act Now:** Stages A–F (proposed below) using the existing ingestion
  capability (`src/ingest/pipeline.ts`) plus a new `TripAssemblyService`.
- **Investigate Now:** Whether to expose assembly as a separate capability
  family or as a new runtime endpoint (impacts ADR-029's vocabulary).
- **Park for Later:** Multi-source traveller identity beyond
  email/phone/passport/PNR-hash (e.g. face-to-name matching from photos).
- **Ignore:** Real-time Wikipedia-of-record assembly; out of scope for RV.

## Current bootstrap reality (what exists)

- `src/scenarios/spec.ts:ScenarioSpecSchema` — frozen (ADR-022). The bundle
  already includes `sources`, `organisations`, `travellers`, `anchorEvents`,
  `places`, `ruleSets`, `preferences`, `trip` (with `elements`, `objectives`,
  `relations`, `governedByRuleSetIds`), `constraints`, `disruption`. Every id
  is referenced by something else; `validateScenarioReferences` enforces
  integrity.
- `src/app/bootstrap.ts:seedScenarioBundle` — persists the bundle via one
  `MutationProposal` over the frozen mutation service. All
  `UPSERT_ENTITY`/`UPSERT_CONSTRAINT` ops in `buildSeedOperations` are
  authored by hand; there is no discovery.
- `src/ingest/pipeline.ts:createSourceIngestionCapability` — produces
  `IngestionOutcome { proposals, ruleSets, signals, uncertainties }`. Today
  every normalizer in `src/ingest/normalize.ts` **requires
  `env.context.tripId`** to emit `TRIP_ELEMENT` ops; without it,
  transport/stay/engagement proposals are dropped as uncertainty
  (`normalize.ts:281–285, 397–401, 193–200`). This is the single most
  important gap: assembly has no way to *create* a Trip from sources.
- `src/app/runtime.ts` / `runtimeHttp.ts` — generic
  `POST /api/runtime/{disruption,plan,begin,decide,execute,reset}` over
  authoritative state (ADR-029). Nothing today accepts a "create a new Trip
  from these sources" payload.
- `src/operational/mutation.ts:ENTITY_SCHEMA_BY_TYPE` — only
  `ORGANISATION | TRAVELLER | ANCHOR_EVENT | TRIP | TRIP_ELEMENT | TRIP_OBJECTIVE | PLACE | RULE_SET | CONSTRAINT` are accepted; lane-specific extensions
  forbidden.
- `src/domain/common.ts:FactSchema` / `SourceRecordSchema` /
  `UncertaintyRecordSchema` already express provenance, authority and
  recorded uncertainty; nothing here needs reinvention.
- `src/domain/trip.ts:TripSchema` requires `travellerIds.min(1)`, so a Trip
  cannot be persisted without at least one resolved traveller.

## Gap analysis

| Capability | Today | Needed for assembly | Severity |
|---|---|---|---|
| Create Trip from sources | No — bootstrap only persists a hand-authored Trip | Deterministic trip-shell creator: `{ traveller, objective } → Trip` | **Blocker** |
| Bind an ingested source to a trip that does not yet exist | Normalizers drop TRIP_ELEMENT proposals if `context.tripId` absent | Either (a) two-phase ingest (create shell first, then attach), or (b) provisional candidate elements that the assembly layer promotes | **Blocker** |
| Traveller identity resolution across sources | None — bootstrap author hand-picks ids | Deterministic key (email, phone, last-name+DOB) + AI-proposed candidate merges with `UncertaintyRecord` evidence | **Blocker** |
| Organisation resolution | None — bootstrap author hand-picks ids | Same pattern as traveller (org name + domain + role hint) | High |
| Place dedup + timezone resolution | Hash per (source, code) — `src/ingest/normalize.ts:256, 379`; no airport-timezone DB | Central place registry; AIRPORT codes → IANA zone via buildTimezoneResolver (already exists at `src/app/compose.ts:39`) | **Blocker** (per ADR-028 honest offset) |
| Multi-traveller PNR matching | Not addressed | `BOOKING_CONFIRMATION` with shared `bookingReference`+`bookingSystem` ⇒ candidate co-travellers, requires traveller confirmation | High |
| Element dependency inference | Frozen `TripRelationKind` is the user's choice (ADR-026) | AI proposes candidate `CONNECTS_TO` / `DEPENDS_ON`; deterministic checks terminal-connection/same-place/buffer-achievable | High |
| Objective extraction | Anchor-event engagements can become `ENGAGEMENT` elements (`normalize.ts:202–232`) but no `TripObjective` creation | Deterministic objective-derivation rule (engagement → required HARD objective) + AI-proposed `statement` text | **Blocker** |
| Policy assignment | `RuleSet` extracted from `POLICY_DOCUMENT`; elements carry `governedByRuleSetIds` | Deterministic binding (stay place ↔ supplier policy; trip ↔ org policy) once ids exist | Medium |
| Source authority / conflicts / duplicates / uncertainty | Fact authority ladder exists (ADR-013, ADR-032); `resolveAuthoritativeFact` exists | Assembly must emit `UPSERT_FACT` not whole-entity overwrite when authority is weaker (per ADR-032 PARK-2 rule) | High |
| Human confirmation gate / partial Trip | None — bootstrap is all-or-nothing | "Readiness gate" producing a checklist of UNKNOWNs for human sign-off, **before** the trip becomes authoritative | **Blocker** |
| Chronology ≠ dependency | Already explicit in `ARCHITECTURE.md:136` | Just respect it; do not infer `DEPENDS_ON` from time alone | Honoured |

## Proposed assembly pipeline (Scenario 0 minimum)

The minimum pipeline is six stages. Each takes a frozen-contract-shaped input
and produces a frozen-contract-shaped output. Stages A–C are *evidence* work
(no authoritative writes); D–E are *provisional*; F is the *commit gate*. AI
is restricted to `[proposal + uncertainty]`; writes are deterministic.

### Stage A — Source intake

- **Input:** heterogeneous `SourceInput` (kind=`EMAIL` / `WEBPAGE` /
  `BOOKING_CONFIRMATION` / `POLICY_DOCUMENT` / `INSURANCE_DOCUMENT` /
  `DOCUMENT` / `PROFILE` / `RESEARCH` / `MANUAL`).
- **Mechanism:** existing `createSourceIngestionCapability`
  (`src/ingest/pipeline.ts`); persists `SourceRecord` (authority from
  `SOURCE_AUTHORITY_BY_KIND` in `src/ingest/source.ts:41–52`) and raw content.
  No trip context required.
- **Output:** `SourceRecord[]` with stable `sourceId`s; uncertainty per source.
- **Failure modes:** unsupported kind → uncertainty, no crash; extraction
  failure (no model client / model refused) → uncertainty per
  `pipeline.ts:118–125, 168–175`; security-trim failure (future SPF/DKIM /
  URL-allowlist per report 04) → REJECTED with provenance.

### Stage B — Extraction to candidate facts (no entity writes)

- **Input:** persisted source content; `ExtractionTask` per
  `EXTRACTION_TASKS_BY_KIND` (`src/ingest/semantic.ts:201–212`).
- **Mechanism:** same `runExtraction`; normalizers emit a new intermediate
  shape `CandidateFact` (Delta 1) instead of `MutationOperation[]`. Keep the
  existing `normalizeExtracted*` for the already-have-a-trip path; add
  sibling `candidateFrom*` normalizers that yield the same parsed fields
  wrapped in a candidate envelope.
- **Output:** `CandidateFact[]` tagged by kind (PLACE, TRANSPORT_LEG, STAY,
  ENGAGEMENT, ORGANISATION, TRAVELLER, ANCHOR_EVENT, RULE_SET, OBJECTIVE,
  FACT_FIELD_UPDATE). Each carries `sourceId`, `rawValue`, `authority`,
  `confidence`, `observedAt`, `evidenceQuote`.
- **Failure modes:** schema-validate failure → discarded with uncertainty;
  ambiguous datetime without timezone → `CANDIDATE_PARTIAL` with the gap
  noted, not silently `Z`-ed (ADR-028 honesty).

### Stage C — Entity / place / organisation resolution

- **Input:** `CandidateFact[]`; existing `EntityStore` (read).
- **Mechanism:** deterministic key functions + AI candidate-suggestion
  (proposal only, never a write):
  - **Traveller key:** `email | phone | (lastName + DOB) | passportNumber`.
    Equal key → merge proposal with `UncertaintyRecord` evidence.
  - **Organisation key:** `(name.normalised, domain) | registrationId`.
  - **Place (AIRPORT):** `IATA` → canonical `PLACE`; existing match →
    `UPSERT_FACT` the timezone (never whole-entity overwrite, ADR-032 PARK-2).
  - **Place (HOTEL/VENUE):** `(propertyName.normalised, address.city)`;
    fuzzy match + AI proposal + `UncertaintyRecord`.
  - **Same-booking co-travellers:** shared `(bookingSystem, bookingReference)`
    ⇒ candidate set; requires `Traveller` ack in stage F.
- **Output:** `ResolutionGraph` — `candidateRef → existingOrNewEntityId` with
  `UncertaintyRecord[]` for AI-proposed merges the deterministic key didn't
  match.
- **Failure modes:** same key, contradictory attribute → conflict recorded,
  surfaced at F; no silent attach (`ARCHITECTURE.md:197`).

### Stage D — Trip shell + provisional elements

- **Input:** `ResolutionGraph`; trigger = a `traveller` + a `primary
  objective` (a `CandidateFact` of kind OBJECTIVE or the trip purpose
  inferred from the most-anchor-like event).
- **Mechanism:**
  1. **Trip shell:** `id = hashId('trip', sorted(travellerIds), earliest
     windowStart)`. `MutationProposal[UPSERT_ENTITY TRIP]` with `elements: []`,
     `objectives: []`, `viability: 'UNKNOWN'`, `travellerIds: [primary]`,
     optional `anchorEventId`.
  2. **Provisional elements:** each `CandidateFact` TRANSPORT_LEG / STAY /
     ENGAGEMENT becomes `MutationProposal[UPSERT_ENTITY TRIP_ELEMENT]` with
     `reservationState = UNKNOWN`, `status = UNKNOWN` (ADR-027),
     `flexibility = FLEXIBLE` (assembly never asserts `FIXED`; policy
     attachment later upgrades if appropriate — `normalize.ts:323–326`
     correctly uses `FIXED` for already-confirmed bookings, but for
     assembly's first commit the safe default is `FLEXIBLE`).
  3. **No relation writes yet** (stage E).
- **Output:** provisional Trip + `TripElement[]` in *authoritative* state with
  `status = UNKNOWN` and `flexibility = FLEXIBLE`. Real but partial —
  exactly what `ARCHITECTURE.md:222` allows.
- **Failure modes:** no traveller resolved → reject trip creation; no
  objective derivable → `viability = UNKNOWN`, surfaced at F, not a crash.

### Stage E — Objectives, dependencies, policy attachment

- **Input:** Stage D's provisional Trip + `CandidateFact[]` OBJECTIVE /
  RULE_SET / relation-proposal.
- **Mechanism:**
  1. **Objectives:** each `OBJECTIVE` candidate becomes a `TripObjective`
     with `hardness = HARD` for engagements, `SOFT` for tourism;
     `linkedElementIds` derived deterministically from the candidate that
     named them. `statement` is AI-proposed; deterministic validation rejects
     empty / generic / non-declarative strings.
  2. **Dependencies:** AI proposes `TripRelation{kind:CONNECTS_TO|DEPENDS_ON,
     from, to, meta:{reason}}` only. Deterministic code validates:
     - `CONNECTS_TO` accepted only when (a) `to.placeId` is the
       `from.placeId` of `to` (terminal-connection) or (b)
       `from.scheduledArrival` + buffer ≤ `to.scheduledDeparture`. Chronology
       alone is **not** sufficient (`ARCHITECTURE.md:136`).
     - `DEPENDS_ON` accepted only when recoverable from observed facts
       (e.g. "must arrive before engagement starts"), not invented.
     - Anything that fails validation becomes `UncertaintyRecord`, never a
       graph edge.
  3. **Policy:** `RULE_SET` candidates upserted; deterministic binding
     `Trip.governedByRuleSetIds` / `TripElement.governedByRuleSetIds` by
     `RuleSet.ownerOrganisationId` ↔ element's place org and `RuleSet.kind` ↔
     `elementKind`.
- **Output:** enriched provisional Trip with objectives, validated relations,
  policy bindings.
- **Failure modes:** AI-proposed relation with unprovable reason → discarded
  + uncertainty; rule set referencing unknown entity → schema-rejected.

### Stage F — Readiness gate (commit ↔ defer)

- **Input:** all earlier outputs + accumulated `UncertaintyRecord[]`.
- **Mechanism:** produce a `ReadinessReport` listing:
  - **BLOCKERS** — things that prevent any trip (no traveller, no window,
    conflicting identity).
  - **NEEDS_HUMAN** — unresolved merges, same-booking co-traveller sets,
    timezones absent on airport `PLACE`s (ADR-028), low-confidence objectives.
  - **WARNINGS** — soft conflicts, partial schedules, asserted-vs-authoritative
    deltas.
  - **AUTHORITATIVE_DIFFS** — sources whose `authority` outranks current
    state (operator must be told a re-ingest will *not* be silently
    downgraded — ADR-032).
  - The gate **does not commit** stage D/E writes until the caller
    (operator or a deterministic policy: all BLOCKERS cleared AND every
    NEEDS_HUMAN item either confirmed or explicitly waived) signs off.
    Stage D/E writes happen *provisionally* as a `ScenarioOverlay`
    (ADR-032-acknowledged shape) that the gate promotes via the same
    `MutationService.applyProposal` path bootstrap uses — so the published
    contracts never see a "draft entity" type, and rollback is trivial.
- **Output:** `ReadinessReport` (UI-facing) + an authorisation token
  (caller can `POST /api/runtime/assembly/{commit|abort}` with the report id).
- **Failure modes:** aborts leave the partial Trip marked `viability =
  UNKNOWN`; nothing silently rolled back (ADR-005, ADR-032).

## Per-topic design decisions (items 1–7)

**1. Trip shell.** A *real* Trip in authoritative state — `travellerIds.min(1)`
satisfied, `elements: []`, `objectives: []`, `viability: 'UNKNOWN'`. Carries the
first-window anchor but no elements yet. Honours `ARCHITECTURE.md:65` and
ADR-027. A "draft trip" type would need a new `EntityType` and break
ADR-022.

**2. Traveller / entity resolution.** Deterministic keys are primary; AI
proposes merges only. Keys (priority): `email | phone | (lastName, dob) |
passportNumber`. Every AI-suggested merge produces a `UncertaintyRecord` with
verbatim quote, `sourceId`, confidence; merge is **never** auto-applied —
goes on `NEEDS_HUMAN` in stage F. Honours ADR-003, ADR-013.

**3. Organisation / same-booking PNR.** Org key = `(name.normalised, domain) |
registrationId`. Co-travellers: shared `(bookingSystem, bookingReference)` is a
*proposal* to add the listed passenger names to `Trip.travellerIds`. Goes to
`NEEDS_HUMAN` because a booking may include minors, dependents, or unrelated
rows.

**4. Place resolution; timezone (ADR-028).** Airports: canonical `PLACE` keyed
by IATA; `Place.timezone` is a **mandatory fact** — if absent at first ingest,
`normalizeExtractedFlightBooking` records uncertainty rather than emit `...Z`.
Existing `buildTimezoneResolver` (`src/app/compose.ts:39`) is the production
data path; a static IATA→IANA table is the deterministic fallback.
Hotels/venues: canonical key = `(propertyName.normalised, address.city)`;
timezone is a fact (same rule). Provider-extracted timezones are `ASSERTED`;
an authoritative source can `UPSERT_FACT` to upgrade. Direct application of
ADR-028 and ADR-032.

**5. Element ordering; dependency inference.** Order is presentation only
(UI sort by `startsAt`/`checkIn`). Dependency inference is AI-proposal-only;
deterministic validator rejects:
- `CONNECTS_TO` without a place or schedule overlap.
- `DEPENDS_ON` reducible to "chronology" (`ARCHITECTURE.md:136`).
- Any relation with a non-empty `meta` whose keys aren't in a closed
  vocabulary (`{bufferMinutes, reason, evidenceSourceId}`).

Chronology is *not* a relation; assembly never writes `DEPENDS_ON` because
one element ends before another begins.

**6. TripObjective extraction.** Engagement candidates become **HARD**
objectives with `linkedElementIds = [engagementId]`; named-role engagements
(speaker, panellist) become HARD with `statement` quoting the role. Tourism
objectives are SOFT. AI proposes `statement` text; deterministic code rejects
empty / generic / non-declarative strings. Each objective carries `sourceId`;
no source → no objective (no fabrication).

**7. Policy, authority, conflicts, duplicates, uncertainty, confirmation,
partial Trip.**
- **Policy:** deterministic binding by `RuleSet.ownerOrganisationId` ↔
  element's place org; `RuleSet.kind` ↔ element `elementKind`.
- **Authority:** assembly never demotes a stronger fact; `UPSERT_FACT` with
  weaker authority is rejected by `resolveAuthoritativeFact`
  (`src/domain/common.ts:54`); whole-entity overwrite at weaker authority is
  rejected per ADR-032 PARK-2 (omission = erase attempt).
- **Conflicts:** both kept as `Fact<T>` history; deterministic truth-resolution
  picks operational state; surfaces in `ReadinessReport.WARNINGS`.
- **Duplicates:** deterministic key collision ⇒ `UncertaintyRecord` with both
  `sourceId`s; merges require human.
- **Uncertainty:** every stage emits `UncertaintyRecord[]`; the readiness gate
  never silently converts to certainty.
- **Human confirmation:** `ReadinessReport` is the contract; commit only after
  explicit sign-off (or a deterministic policy, e.g. "auto-commit only
  `WEBPAGE`-sourced `ANCHOR_EVENT` with no NEEDS_HUMAN items").
- **Partial Trip:** `viability = UNKNOWN` + at least one `UNKNOWN` element is
  the design state. `ARCHITECTURE.md:222` already supports it; the partial
  Trip is the *base* state until readiness is signed off — not a scenario
  overlay.

## Scenario 0 — RAW UNSEEN SOURCES → USABLE TRIP → RECOVERY ENGINE

Scenario 0 is a WiT-style conference speaker on a Singapore trip. The raw
inputs are three independent, unseen, hand-collected artefacts: a speaker
agenda webpage, a flight confirmation email, and a hotel PDF.

| Stage | Input (raw) | Mechanism | Output | Failure mode |
|---|---|---|---|---|
| **A. Source intake** | (1) Speaker page URL, (2) flight email body, (3) hotel PDF bytes | `createSourceIngestionCapability`; kind routed from extension + headers (`WEBPAGE` / `EMAIL` / `DOCUMENT`) | `SourceRecord s1,s2,s3` with kinds & authorities (`ASSERTED`, `ASSERTED`, `ASSERTED`) | Wrong kind → mis-routed extraction; bad URL → fetch error → uncertainty |
| **B. Candidate facts** | Source content + task routing (`ANCHOR_EVENT` / `FLIGHT_BOOKING` / `STAY_BOOKING` / `RULE_SET`) | Existing `runExtraction` + new `candidateFrom*` normalizers | `CandidateFact[]`: `place:SIN-Airport[timezone=Asia/Singapore]`, `place:MarinaHotel[…]`, `transport:SQ478[SIN→…]`, `anchor:WiT-Summit-2026[…]`, `objective:speak-WiT-keynote` (HARD) | Bad datetime → candidate with timezone gap; ambiguous IATA → uncertainty |
| **C. Entity resolution** | Candidates | Deterministic key (IATA `SIN` → existing `Place` if any; otherwise `hashId('place', source, 'SIN', 'AIRPORT')`); AI proposes "Dr A. Lee" = same person as on page and on flight passenger list | `ResolutionGraph`: `travellerId=t1`, `placeId=pl-sin`, `anchorId=ae-wit`; uncertainty "speaker page lists 'Dr Lee', email lists 'A. Lee' — same person?" | Conflicting DOB → BLOCKER; same email conflicting names → NEEDS_HUMAN |
| **D. Trip shell + elements** | `t1` + `objective:speak-WiT-keynote` | `UPSERT_ENTITY TRIP` (travellerIds=[t1], viability=UNKNOWN), `UPSERT_ENTITY TRIP_ELEMENT` × 3 (flight, stay, engagement) all with `status=UNKNOWN`, `flexibility=FLEXIBLE` | Provisional Trip `tr-wit-1` with 3 elements | No traveller → no Trip; no window → UNKNOWN viability, surfaced later |
| **E. Objectives / dependencies / policy** | `CandidateFact{objective:…}`, `…{rel:CONNECTS_TO:hotel→airport}`, `…{ruleSet:airline-fare-rules}` (if present in flight email) | Deterministic rules: HARD objective for keynote, validation that "hotel→airport return transfer" overlap = CONNECTS_TO if places match, rule set attachment by kind | Trip with 1 HARD objective, 1–2 relations, 1 rule set binding | Relation that reduces to chronology alone → rejected + uncertainty |
| **F. Readiness gate** | `UncertaintyRecord[]`, identity-merge proposals, same-booking co-traveller set (none in this scenario) | Emit `ReadinessReport`; require explicit commit if any `NEEDS_HUMAN` exists; else auto-commit via deterministic policy | Authoritative `tr-wit-1` ready for the runtime to consume — exactly the same shape the recovery engine already ingests via `seedScenarioBundle` | Abort leaves Trip in `viability=UNKNOWN`; nothing silently lost |

After stage F the same engine, the same `/api/runtime/{disruption,…}`
endpoints and the same case verifier work without modification
(ADR-029). The only invariant Reality Validation needs to **prove** is that
a real disruption applied to `tr-wit-1` produces the same recovery shape as
a hand-authored bundle of the same trip.

## Architecture deltas (proposed, not implemented)

1. **`CandidateFact` DTO (assembly-only, not an entity type).**
   Schema sketch:
   ```text
   CandidateFact {
     kind: 'PLACE' | 'TRANSPORT_LEG' | 'STAY' | 'ENGAGEMENT'
         | 'ORGANISATION' | 'TRAVELLER' | 'ANCHOR_EVENT'
         | 'OBJECTIVE' | 'RULE_SET' | 'FACT_UPDATE' | 'RELATION_PROPOSAL'
     payload: <one of the frozen entity schemas, but without enforced ids>
     sourceId, observedAt, authority, confidence?
     evidenceQuote?
   }
   ```
   Lives in `src/contracts/assembly.ts` (new); never persisted; never
   crosses the mutation-service boundary. Resolves ADR-022's "no parallel
   DTOs" rule by being explicitly *transient*.

2. **`ProvisionalBinding` mechanism for two-phase mutation.** A new
   `MutationOperation` variant `UPSERT_PROVISIONAL` is **not** needed if
   we use the existing `UPSERT_ENTITY` writes with `status: UNKNOWN` and
   `flexibility: FLEXIBLE` (ADR-027 already mandates UNKNOWN defaults).
   The "provisional" semantics live in the **readiness gate**, not in
   the contract. This is the *smallest* viable delta — likely zero
   contract change.

3. **`ReadinessReport` projection** (UI/read-model addition, no engine
   change). Schema sketch:
   ```text
   ReadinessReport {
     tripId, blockers: { reason, refs[] }[],
     needsHuman: { reason, refs[], evidence[] }[],
     warnings: { reason, refs[] }[],
     authoritativeDiffs: { sourceId, currentAuthority, proposedAuthority, refs[] }[]
   }
   ```
   New projection in `src/app/readmodels.ts`. No mutation contract
   change.

4. **Assembly runtime endpoint** (optional). If decided to expose as a
   capability, `POST /api/runtime/assembly/{begin,stage,commit,abort}`
   keeps the ADR-029 generic-seam posture. Alternative: assembly is a
   one-shot service call from `composeAppRuntime` (no HTTP). **Investigate Now.**

5. **Identity key registry.** A `src/contracts/identityKeys.ts` listing
   the deterministic keys (traveller: email/phone/lastName+DOB/passport;
   org: name+domain/regId; place: IATA/propertyName+city) — no schema
   change, just a documented contract surface so lanes don't reinvent.

6. **Relation validator policy.** A `src/contracts/relationPolicy.ts`
   documenting the closed `meta` vocabulary and the chronological
   non-dependency rule. No new edge types (ADR-026 closed).

## Findings triaged

| Finding | Triage | Why |
|---|---|---|
| Bootstrap is hand-authored, not assembled | **Act Now** | The whole RV-5 deliverable is the design for the missing assembly layer |
| Ingestion normalizers require an existing `tripId` | **Act Now** | Either (a) two-phase ingest (create shell first) or (b) sibling `candidateFrom*` normalizers. (b) is smaller and aligns with Delta 1 |
| No traveller identity resolution | **Act Now** | Core Scenario 0 step C; deterministic keys + AI proposals + human gate |
| AI proposal must never write the graph authoritatively | **Act Now** | Already mandated (ADR-003/ADR-005/ADR-032); restated in Delta 1 envelope |
| Place timezone honesty (ADR-028) | **Act Now** | Central place registry + UPSERT_FACT upgrades; no fabricated `Z` |
| Multi-PNR co-traveller matching | **Investigate Now** | Real but rarer; surfaces as NEEDS_HUMAN in the gate |
| Chronology ≠ dependency | **Ignore / Accept Risk** | Already explicit (`ARCHITECTURE.md:136`); just enforced in relation validator |
| Same `(bookingSystem, bookingRef)` may be a tour, not co-travellers | **Investigate Now** | Add to NEEDS_HUMAN list; deterministic policy cannot disambiguate |
| Duplicates across sources | **Act Now** | Deterministic key collision → UncertaintyRecord; no auto-merge |
| Partial Trip in authoritative state | **Act Now** | Allowed (`ARCHITECTURE.md:222`); design uses `viability=UNKNOWN` + `status=UNKNOWN` defaults; no new entity type |
| Assembly as a runtime endpoint vs internal service | **Investigate Now** | Affects ADR-029 vocabulary; pick during integration |
| Identity beyond email/phone/passport (face-to-name, social) | **Park for Later** | Out of RV scope; would require new identity key + provider |
| `UPSERT_PROVISIONAL` operation kind | **Ignore / Accept Risk** | Not needed; `status=UNKNOWN` already encodes provisionality (ADR-027) |
| Real-time Wikipedia-of-record assembly | **Ignore / Accept Risk** | Out of scope; would require continuous ingestion loop, separate milestone |
| Recovery engine reuse | **Ignore / Accept Risk** | Already proven by ADR-029: same `processDisruption` consumes any Trip whose shape matches `TripSchema`; assembly output is shape-conformant by construction |
