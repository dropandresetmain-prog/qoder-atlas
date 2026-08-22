# Reality Validation 08 — Traveller-initiated change

**Milestone:** Reality Validation (post-Checkpoint C, investigation phase)
**Worktree:** `/data/worktrees/rv-traveller-change` on branch `rv/traveller-change-investigation`
**Base SHA:** `6d203960a2948ac81e128a9483cb189323f7c018`
**Status:** Investigation, design/research only. No implementation.
**Author:** bounded investigator child of coordinator.

---

## 1. Executive summary

ROADMAP §"Reality Validation" investigation area 8 commits the system to supporting **traveller-initiated change as a first-class capability** and explicitly forbids a second "traveller modification engine" — these requests must enter the same generalised engine as externally caused disruptions: signal → state/context update → blast radius → recovery/resolution strategies → deterministic whole-trip viability → policy/authority → execution → observation → resolved state.

The engine already exposes everything needed: `TRAVELLER_INPUT` is an existing `SignalKind`; the `processSignal` pipeline already accepts authored traveller input from `src/ingest/travellerContext.ts`; the overlay/viability/authority/executor seams are request-shape-agnostic; `WAIVE_OR_REPRIORITIZE_OBJECTIVE` is an existing mutation operation; `ObjectiveStatus` already includes `WAIVED`/`REPRIORITY`/`LOST`/`ACHIEVED`; and the preference precedence in `src/domain/preferences.ts` already differentiates explicit instruction (4) > trip preference (3) > persistent (2) > latent (1).

**Recommendation (one line):** Keep TripSignal vocabulary closed; introduce a thin **`ChangeRequest` DTO at the ingestion boundary** that the **existing** `TRAVELLER_INPUT` signal pipeline normalises into the same `MutationProposal` / `RecoveryStrategy` / `ActionIntent` flow. Do NOT create a new `SignalKind` for change. The discriminator lives in the DTO, not in the signal. This preserves the single-engine invariant, reuses the authority/overlay machinery verbatim, and treats "no action is also a valid outcome" as a deterministic overlay result.

---

## 2. Current-state audit (what exists today)

### 2.1 TripSignal shape (`src/operational/signal.ts`)
`SignalKindSchema` already enumerates `TRAVELLER_INPUT` alongside provider kinds (`FLIGHT_CANCELLATION`, `FLIGHT_SCHEDULE_CHANGE`, `FLIGHT_DELAY`, `BOOKING_STATE_CHANGE`, `PROVIDER_EVENT`, `WEATHER_EVENT`) and `OPERATOR_INPUT`. `TripSignal` carries `id`, `kind`, `occurredAt`, `receivedAt?`, `sourceId`, `authority`, `confidence?`, `tripId?`, `subjectRef?`, `summary?`, and a free-form `payload: Record<string, unknown>`. `subjectRef` is `EntityRef` (entityType+id), and `payload` is schema-free.

### 2.2 Signal pipeline (`src/app/signalPipeline.ts`)
`processSignal` is a single deterministic funnel: `TripSignal` → persisted → `signalMutationOperations` → `MutationService.applyProposal` → `ImpactEngine.assess` → `evaluateConstraints` → impact persistence → `CaseService.open/transition` → audit. The case ID is `case-${tripId}-${signal.id}`, the transition is the frozen `DETECTED → ASSESSING` table from `src/operational/case.ts`. **This pipeline already handles `TRAVELLER_INPUT` for preference/instruction ingestion; it does not yet handle a change request.**

### 2.3 Traveller-context ingestion (`src/ingest/travellerContext.ts`)
Extracts `instructions`, `preferences`, `latent` arrays and writes `Preference` records with the right `origin` (EXPLICIT_INSTRUCTION / EXPLICIT_TRIP_PREFERENCE / EXPLICIT_PERSISTENT / LATENT_INFERRED), then emits a `TRAVELLER_INPUT` signal whose `payload.preferences` carries the resolved list. **It does not today parse a "change" utterance or produce an overlay-candidate-bearing signal.** This is the natural place to attach the proposed `ChangeRequest` DTO.

### 2.4 Recovery engine (already shape-agnostic)
- **Impact** (`src/engine/impact.ts` + `src/operational/impact.ts`) reads POST-mutation state and returns an `ImpactAssessment` with `directFailures`, `affectedElements`, `threatenedObjectives`, `irreversibleLosses`, `policyImplications`, `financialExposure`, `unresolvedUnknowns`, `recoveryHeadroom`, `severity`.
- **Overlay** (`src/engine/overlay.ts`) applies `MutationOperation[]` to an isolated deep clone, enforces the judging-criteria guard (ADR-032), and returns `feasible` + `hardFailureIds` + `softTradeoffs` + `unknownIds`. **Goal-directed candidates are structurally indistinguishable from disruption-recovery candidates; only the source intent differs.**
- **Planner** (`src/contracts/planner.ts`) consumes `triggeringSignals: TripSignal[]` plus impact and returns strategies, tool requests, assumptions, uncertainties — never an `ActionIntent`.
- **Authority** (`src/engine/authority.ts`) is fully deterministic over `sideEffectLevel` + `priceDelta` + rules (SPEND_LIMIT, APPROVAL_REQUIRED, APPROVAL_ABOVE_SPEND) + principals with `ACTION_APPROVAL_PERMISSION` and optional `delegatedSpendLimit`. Outcomes: `AUTO_APPROVED`, `REQUIRES_TRAVELLER`, `REQUIRES_ORGANISATION_APPROVER`, `REQUIRES_HUMAN_AGENT`, `BLOCKED`.
- **Executor** (`src/operational/intent.ts` `executionGateIssues`) requires an `AuthorisedExecution` envelope; intent status alone is never executable evidence.
- **Case lifecycle** is identical regardless of trigger: 11 statuses, deterministic `CASE_TRANSITIONS`, `ResolutionOutcome` ∈ `{FULLY_RECOVERED, RECOVERED_WITH_LOSS, ESCALATED_CLOSED}`.

### 2.5 Mutation vocabulary already supports abandonment/reprioritisation
`MutationOperationKind` includes `WAIVE_OR_REPRIORITIZE_OBJECTIVE` (carrying `action: WAIVE|REPRIORITY`, `newHardness?`, `by: EntityRef`, `reason?`). `ObjectiveStatus` already exposes `WAIVED`/`REPRIORITY`/`LOST`/`ACHIEVED`. ADR-033 makes loss/waiver the authoritative home of the trip objective's `status` — so a voluntary "I no longer need to attend dinner" is **already expressible** end-to-end through the same mutation.

### 2.6 Capability surfaces (`src/contracts/capabilities.ts` + `src/operational/intent.ts`)
- `flight.search` / `flight.verify` / `flight.fare_rules` / `flight.change` / `flight.cancel` / `flight.refund_quote` exist.
- `hotel.context` (read stay context only) / `hotel.modify` / `hotel.cancel` exist; **there is no `hotel.search`** — confirmed gap.
- `routing.context` exists; no transactional ground transport.
- `research.entry_requirements` / `research.local_context` exist.
- `communication.notify` / `communication.request_approval` / `simulation.provider_action` exist.

### 2.7 Precedence (already encoded)
`src/domain/preferences.ts` `PREFERENCE_PRECEDENCE`: EXPLICIT_INSTRUCTION(4) > EXPLICIT_TRIP_PREFERENCE(3) > EXPLICIT_PERSISTENT(2) > LATENT_INFERRED(1). `dominatingPreference` returns the higher-precedence record; equal precedence is caller-decided. The four-level ladder maps directly onto traveller utterances (see §4).

---

## 3. Design decision 1 — signal kind vs. DTO

**Recommendation: keep `SignalKind` closed; introduce a `ChangeRequest` DTO at the ingestion boundary that normalises INTO the existing `TRAVELLER_INPUT` signal.**

### Why not a new `SignalKind` (e.g. `TRAVELLER_CHANGE_REQUEST`)
1. The `SignalKind` enum is the **provenance** discriminator (provider vs. traveller vs. operator vs. weather). It is consumed by the `signalMutationOperations` switch and by every audit/observability surface. Adding `TRAVELLER_CHANGE_REQUEST` would either duplicate the `TRAVELLER_INPUT` branch in the switch or carve out an exception that bypasses the same-engine invariant.
2. `payload` is already schema-free, so a change request's structured fields (target state, time window, hotel location, cabin preference, soft-vs-hard, etc.) live naturally in `payload` without schema churn.
3. Case routing, audit, and read-model wiring all key on `kind`; a new kind would require touching every consumer (operator dashboard, traveller page, runtime HTTP wire) for no semantic gain.

### Why a DTO at the boundary
- A traveller utterance is **raw language or a structured form field**, not a `TripSignal`. A DTO (`ChangeRequest`) is the *normalised representation* the LLM/extractor produces. The extractor maps the DTO to a `TRAVELLER_INPUT` signal whose `payload` carries the parsed `targetState` and `candidateOperations` (or a "no-op" flag — see §4.2).
- The DTO is also the place where a **soft preference vs. hard instruction** discriminator lives (see §4.1) — that distinction is change-specific and should not pollute `SignalKind` or `MutationOrigin`.
- The DTO can be tested, validated, and replayed as a unit. The signal is its wire envelope.

### Sketch (proposal only — do not commit to schema yet)

```ts
// Proposed ingestion-boundary DTO. NOT a TripSignal. NOT persisted directly.
export const ChangeRequestKindSchema = z.enum([
  'RESCHEDULE_FLIGHT',           // "fly tomorrow instead" / "leave tonight"
  'CHANGE_ROUTE',                // "earlier flight" / "direct flight"
  'EXTEND_STAY',                 // "stay two extra nights"
  'CHANGE_HOTEL',                // "change my hotel" / "stay near the venue"
  'CANCEL_BOOKING',              // "I no longer need to attend dinner"
  'CHANGE_CABIN',                // "business class if policy allows"
  'CHANGE_RETURN_DATE',          // "return a day earlier"
  'PREFERENCE_DRIVEN_MODIFY',    // generic "I'd rather …" soft preference
  'OTHER',
]);

export const ChangeUrgencySchema = z.enum([
  'HARD_INSTRUCTION',   // "I need to …" — non-negotiable
  'SOFT_PREFERENCE',    // "I'd rather …" — ranking signal, may be traded off
]);

export const ChangeRequestSchema = z.strictObject({
  id: EntityIdSchema,
  kind: ChangeRequestKindSchema,
  urgency: ChangeUrgencySchema,
  travellerId: EntityIdSchema,
  tripId: EntityIdSchema,
  // Subject element(s) affected. May be empty for preference-driven requests.
  subjectRefs: z.array(EntityRefSchema).default([]),
  // Free-form target state description (e.g. { newDepartureDate, newHotelArea }).
  targetState: z.record(z.string(), z.unknown()).default({}),
  // Optional raw utterance for audit + LLM provenance.
  utterance: z.string().optional(),
  issuedAt: IsoDateTimeSchema,
  sourceId: EntityIdSchema,
  authority: FactAuthoritySchema,
});

export type ChangeRequest = z.infer<typeof ChangeRequestSchema>;
```

The normaliser in `travellerContext.ts` then produces:

```ts
const changeSignal: TripSignal = {
  id: hashId('signal', changeRequest.sourceId, changeRequest.id),
  kind: 'TRAVELLER_INPUT',                  // <-- existing kind
  occurredAt: changeRequest.issuedAt,
  sourceId: changeRequest.sourceId,
  authority: changeRequest.authority,       // typically CONNECTED for traveller chat, ASSERTED for typed form
  tripId: changeRequest.tripId,
  subjectRef: changeRequest.subjectRefs[0] ?? { entityType: 'TRAVELLER', id: changeRequest.travellerId },
  summary: summarise(changeRequest),        // "traveller-requested reschedule outbound flight"
  payload: {
    changeRequest: changeRequest,           // the DTO travels inside the signal payload
    candidateOperations: [...],            // optional: pre-validated UPSERT_* for known shapes
  },
};
```

`signalMutationOperations` (or a new `changeRequestToMutations` adapter) reads `payload.changeRequest` and emits `MutationOperation[]` — for `RESCHEDULE_FLIGHT` that is `UPSERT_FACT data.scheduledDeparture` + `UPSERT_FACT data.scheduledArrival` (CONNECTED authority, not AUTHORITATIVE — see §5); for `CANCEL_BOOKING` it is `WAIVE_OR_REPRIORITIZE_OBJECTIVE`; for `CHANGE_HOTEL` it is `UPSERT_ENTITY TRIP_ELEMENT` carrying the new stay data. From there, **the rest of the pipeline is unchanged** — impact, overlay, planner, authority, executor, observation, resolution.

---

## 4. Target state vs. disruption semantics

### 4.1 Goal-directed vs. repair
A disruption is **reactive**: an external event moves a fact out of place, the engine finds replacement candidates that bring the trip back to plan. A traveller change is **proactive**: the traveller supplies a target state; the engine finds candidates that move the trip to that state.

Both flows produce the same internal shape: a `TripSignal` whose `payload` carries candidate `MutationOperation[]` (or a request to compute them). The overlay engine is already direction-agnostic — it just applies candidates and reports feasibility. **No new engine code is required to distinguish them.** The only place the direction is recorded is `signal.payload.changeRequest.urgency` and the audit log.

### 4.2 Overlays express target-state candidates
`OverlayInput.candidateOperations` is `MutationOperation[]`. A "fly tomorrow instead" request produces an overlay whose single `UPSERT_FACT data.scheduledDeparture = tomorrow+09:00` is applied to a deep-clone snapshot; feasibility is judged against the same HARD/SOFT constraints. A "stay near the venue" preference produces an overlay whose `UPSERT_ENTITY TRIP_ELEMENT` carries a `stayPlaceId` of the venue-adjacent place, judged against any `MUST_STAY_NEAR_*` constraint (or absent one — in which case the soft tradeoff is the extra cost vs. the latent preference).

### 4.3 "No action is also a valid outcome"
This is critical. Two cases:
- **Request already satisfied** (the traveller asked for a direct flight and the existing one is direct): overlay is `feasible: true` with `hardFailureIds: []` and `softTradeoffs: []`. The case opens, the planner may emit a single zero-cost strategy, viability passes, **no `ActionIntent` is built**, and the case resolves to `FULLY_RECOVERED` (or `RESOLVED` with an empty action set) on the next verification tick. The DTO must support a `satisfied: true` boolean that the normaliser uses to skip candidate construction and emit a signal that flows straight to RESOLVED.
- **Request infeasible** (e.g. "return a day earlier" while a HARD `MUST_OCCUR_AFTER_DEPENDENCY` blocks the new date): overlay is `feasible: false` with the blocking constraint id. The planner emits one or more "compromise" strategies (e.g. rebook the dependency, change cabin, partial waiver), the authority/executor chain runs the chosen strategy, and the case resolves to `RECOVERED_WITH_LOSS` if the original date is irreversibly missed — recorded as a `LossRecord` per ADR-033.

Representation sketch (in signal payload, **proposal**):

```ts
payload: {
  changeRequest: { ... },
  // If the change is already satisfied or requires no mutation, the
  // candidateOperations array is empty and `outcome` carries the no-op
  // resolution (the case will still open for audit, then close RESOLVED).
  outcome?: { kind: 'ALREADY_SATISFIED' } | { kind: 'INFEASIBLE', blockingConstraints: EntityId[] },
}
```

The `INFEASIBLE` outcome still flows through the planner — the planner can then propose the *nearest feasible compromise* (e.g. "return two days earlier" or "rebook upstream dependency first"). This keeps a single funnel: nothing terminates early.

---

## 5. Preference / instruction precedence mapping

The brief asks how a **soft preference** ("I'd rather stay near the venue") differs from a **hard instruction** ("I need to return a day earlier"). The answer is already encoded in the preference model and must be propagated, not invented.

### 5.1 Mapping the four example utterances

| Utterance | DTO `urgency` | Generated artefacts | Effect on viability |
|---|---|---|---|
| "I need to return a day earlier" | `HARD_INSTRUCTION` | `WAIVE_OR_REPRIORITIZE_OBJECTIVE` (downgrade the original return date) + `UPSERT_FACT data.scheduledDeparture` (return flight) | New HARD constraint is added by the candidate (an `MUST_DEPART_ON` on the new date); overlay must pass; if HARD `MUST_OCCUR_AFTER_DEPENDENCY` blocks, the case is `RECOVERED_WITH_LOSS` |
| "I'd rather stay near the venue" | `SOFT_PREFERENCE` | `Preference{ origin: EXPLICIT_INSTRUCTION, status: ACTIVE }`; if feasible, candidate `UPSERT_ENTITY TRIP_ELEMENT` with new place | Soft tradeoff; if no HARD constraint, feasibility is true even when cost rises; ranker prefers proximity over cost |
| "Change me to business class if company policy allows" | `HARD_INSTRUCTION` + hard policy gate | `UPSERT_FACT data.cabin` + tool request `flight.fare_rules` + `flight.search` filtered to business | Authority must return `REQUIRES_ORGANISATION_APPROVER` (or `AUTO_APPROVED` if the rule set allows), not `REQUIRES_TRAVELLER` — the traveller is asking, not spending on themselves blindly |
| "I no longer need to attend dinner" | `HARD_INSTRUCTION` (voluntary abandonment) | `WAIVE_OR_REPRIORITIZE_OBJECTIVE { action: WAIVE, by: traveller }` | Objective transitions to `WAIVED`; case resolves `RECOVERED_WITH_LOSS` (or `FULLY_RECOVERED` if it was a SOFT objective) |

### 5.2 The precedence ladder already does the right thing
- **Current explicit instruction** (4): the utterance itself. `EXPLICIT_INSTRUCTION` in the preference model; `by: travellerEntityRef` in the WAIVE operation.
- **Trip preference** (3): stored on the trip, e.g. "I usually prefer aisle seats". The change request carries its own urgency; the trip preference only matters if no explicit instruction is present for the same dimension.
- **Persistent preference** (2): e.g. "I always want direct flights when possible". Surfaced as a soft tradeoff in ranking; never as a hard constraint.
- **Latent** (1): inferred (e.g. "this traveller has chosen 4-star hotels 6/7 times" → 4-star in ranking).

`dominatingPreference` already returns the higher-precedence record; the overlay engine never sees the preference directly, it sees only the candidate mutations and the snapshot's stored preferences (the snapshot already contains `preferences: Preference[]` per `src/operational/snapshot.ts`).

### 5.3 What the new code does NOT need to do
- It does **not** need a new precedence rule — the four-level ladder already covers it.
- It does **not** need a new `Preference` kind — `EXPLICIT_INSTRUCTION` already exists.
- It does **not** need a new mutation operation — `WAIVE_OR_REPRIORITIZE_OBJECTIVE` already exists.
- It does **not** need a new SignalKind — `TRAVELLER_INPUT` already exists.

The change-specific work is: a DTO + a normaliser + a `changeRequestToMutations` adapter (tested in isolation) + UI affordances for the traveller to issue a change. **Everything else is reuse.**

---

## 6. Policy / authority / loss analysis

### 6.1 Spend — voluntary change may cost money
Authority already keys on `intent.priceDelta` (see `DeterministicAuthorityEngine.decide`, step 1–3). A "stay two extra nights" change has a `priceDelta = extra_nights_cost`; a "business class" change may be a positive priceDelta. The engine will:
- `BLOCKED` if a `SPEND_LIMIT` rule currency-mismatches or the priceDelta exceeds it.
- `REQUIRES_ORGANISATION_APPROVER` if an `APPROVAL_REQUIRED` rule covers `flight.change` / `hotel.modify`, or if an `APPROVAL_ABOVE_SPEND` rule triggers.
- `AUTO_APPROVED` if a principal with `ACTION_APPROVAL_PERMISSION` + covering `delegatedSpendLimit` is present.
- `REQUIRES_TRAVELLER` (the default) if irreversible/money-moving and nothing else matched.

**Who pays** is recorded in `intent.priceDelta` and surfaced in the traveller's read model; organisation-paid vs traveller-paid is a policy attribute (rule set) the engine already consults.

### 6.2 Policy breach
A "direct flight even if it costs more" may breach an org rule (`APPROVAL_REQUIRED` for `flight.change` when cost > X). The authority engine returns `REQUIRES_ORGANISATION_APPROVER`; the operator dashboard surfaces it; the case transitions `AWAITING_APPROVAL` per the frozen table.

### 6.3 Abandonment / reprioritisation (ADR-033)
ADR-033 already defines: a WAIVE persists the objective's status; the case verifier counts WAIVED/REPRIORITY/LOST objectives into `remainingLossRefs`; `FULLY_RECOVERED` is impossible while any loss stands. "I no longer need to attend dinner" is therefore a **voluntary loss** — the case resolves `RECOVERED_WITH_LOSS` with `remainingLossRefs: [dinner_objective_id]` and the loss is *traveller-attributed* (the `WAIVE_OR_REPRIORITIZE_OBJECTIVE` op carries `by: travellerRef` + `reason: "traveller waived this objective"`). This is structurally identical to a system-detected loss, but the audit trail distinguishes them.

### 6.4 Irreversible cost / loss / cancellation
- A "cancel my hotel" produces a `hotel.cancel` action intent with `sideEffectLevel: IRREVERSIBLE` and a refund quote (`flight.refund_quote` equivalent for hotels is missing — see §6.5). Authority default for `IRREVERSIBLE` is `REQUIRES_TRAVELLER`.
- The "two extra nights" add has a positive priceDelta; the refundee of any cancelled nights is a separate intent (`hotel.cancel` returning a negative priceDelta to the wallet view).
- A `RESOLVED` case is only reached when verification passes (per ADR-033 + `CaseVerifier`).

### 6.5 Capability surface gaps (must note)
- **`hotel.search` does not exist.** `HotelCapability` exposes `getStayContext`, `modifyStay`, `cancelStay` — but there is no way to *find* a different hotel. A "change my hotel" or "stay near the venue" request that needs a different property cannot complete a transaction today. Roadmap stretch items (`Booking.com Demand`, `Expedia Rapid`) cover this externally; for the hackathon a `REPLAY`/`SIMULATED` adapter that proposes candidates from a curated set is the realistic surface. **This is a real gap and must be raised to investigation area 1/2.**
- **`flight.refund_quote` is a ToolRequest but the `HotelCapability` interface has no equivalent.** A "cancel hotel" currently can only signal cancellation, not return a refund amount — `HotelActionOutcome.fee` is the cancellation fee, not the refund. This is a smaller gap: an explicit `hotel.refund_quote` operation (or extending the existing `cancelStay` outcome) should be added if refund accounting is required.
- **`communication.request_approval` and `communication.notify`** are the existing surface for telling the traveller their change is awaiting org approval; no new communication work is needed.

### 6.6 Authority nuance — is initiation itself consent?
**No, not on its own.** Initiation is an *expressed intent*, not an *executable authorisation*. A traveller typing "stay two extra nights" expresses desire; the deterministic authority gate still runs on the resulting `ActionIntent` (which has `priceDelta`, `sideEffectLevel: MONEY_MOVING`, and an operation covered by rules). The authority engine does not know the intent came from a traveller chat; the same gate applies whether the trigger was a provider delay or a typed form. This is the right property — it prevents LLM-fabricated "the user asked for this" bypasses from reaching the executor.

**Re-confirmation is still required when:**
- The priceDelta is non-zero and the intent is `MONEY_MOVING` (default → `REQUIRES_TRAVELLER`); the traveller must approve the *specific price*.
- The intent deviates materially from the uttered request (e.g. the engine proposes a different date than the one the traveller said). The system should display the proposed intent's effect and require a fresh `APPROVED` verdict.
- An org rule is breached; the org approver is the principal who must approve (`REQUIRES_ORGANISATION_APPROVER`).
- A preference was waived or an objective was abandoned; the WAIVE operation requires `by: EntityRef` but the *case verifier* still needs the persisted WAIVE in the audit log.

**When initiation alone is consent:** When the intent is `READ_ONLY` (e.g. "show me flight options" — produces a `flight.search` `ToolRequest`, not an `ActionIntent`), the authority engine returns `AUTO_APPROVED` for any read. When the change is a pure preference update with no `ActionIntent` (the DTO's `satisfied: true` no-op path), no authority decision is needed.

---

## 7. Scenario candidates (4–6, realistic)

| # | Utterance | Trip shape | Target state (overlay candidate) | Blast radius | Policy angle | Expected outcome | Capabilities required |
|---|---|---|---|---|---|---|---|
| 1 | "I want to fly tomorrow instead" | LHR→JFK outbound on day D; meeting at 10:00 on D+1 | `UPSERT_FACT data.scheduledDeparture = D+1 09:00`, `UPSERT_FACT data.scheduledArrival` recomputed | Arrival ~1h later than planned, still pre-meeting; buffer constraint PASS; meeting `MUST_ARRIVE_BEFORE` PASS | Rebook fee likely >$0; org `APPROVAL_ABOVE_SPEND` rule may require org approval | `FULLY_RECOVERED` (if fee within traveller delegated spend) or `RECOVERED_WITH_LOSS` (fee paid) | `flight.search`, `flight.verify`, `flight.fare_rules`, `flight.change`; `communication.notify` |
| 2 | "Can I leave tonight?" | Trip starts tomorrow 06:00; tonight is free | `UPSERT_FACT data.scheduledDeparture = tonight 22:00`, `UPSERT_ENTITY TRIP_ELEMENT` may need a new outbound | Earlier departure: no negative downstream impact; hotel early check-in may need confirmation | Tonight's fare may be higher; spend above threshold | `FULLY_RECOVERED` with cost; possible `REQUIRES_TRAVELLER` re-confirmation if price differs materially from quoted | `flight.search`, `flight.fare_rules`, `flight.verify`, `flight.change`, `hotel.context` (early check-in) |
| 3 | "Move me to an earlier flight" | Outbound on day D afternoon; same-day anchor event at 18:00 | `UPSERT_FACT data.scheduledDeparture` to earlier slot, `data.scheduledArrival` recomputed | Earlier arrival = more buffer, no threat; dependent elements all still PASS | Cost difference may be in either direction | `FULLY_RECOVERED`; if cheaper, possible wallet credit | `flight.search`, `flight.fare_rules`, `flight.change` |
| 4 | "I want to stay two extra nights" | Hotel checkout D+2; return flight D+2 evening | `UPSERT_FACT data.scheduledDeparture` to D+4, `UPSERT_FACT data.checkOut` to D+4; possibly new outbound leg days later | Return date moves; no anchor event threatened; new nights add cost | `MONEY_MOVING`; org `APPROVAL_REQUIRED` for `flight.change` likely; traveller wallet may absorb if within delegated spend | `FULLY_RECOVERED` (if approved and paid) or `REQUIRES_ORGANISATION_APPROVER` then `RECOVERED_WITH_LOSS` (fee or rule breach) | `flight.search`, `flight.fare_rules`, `flight.change`, `hotel.modify`, `communication.request_approval` |
| 5 | "Change my hotel" / "I'd rather stay near the venue" | Stay element 6km from venue; persistent preference `PREF_NEAR_VENUE` | `UPSERT_ENTITY TRIP_ELEMENT` with new `stayPlaceId` = venue-adjacent place; new cost; new confirmation | No temporal impact; soft tradeoff on cost and brand | Org may cap hotel cost → `REQUIRES_ORGANISATION_APPROVER` if over cap | `FULLY_RECOVERED` (approved) or `RECOVERED_WITH_LOSS` (capped, alternative accepted) | **Hotel search gap — `hotel.search` does not exist**; `hotel.modify`, `hotel.context`; for the "near the venue" preference, ranking uses existing `Preference` record |
| 6 | "I no longer need to attend dinner" | Day-2 engagement (dinner) at 19:00; other day-2 elements intact | `WAIVE_OR_REPRIORITIZE_OBJECTIVE { action: WAIVE, by: travellerRef }`; drop dependent transport element if any | Engagement WAIVED; dependent `MUST_OCCUR_AFTER` elements may now be UNKNOWN → re-evaluate; financial loss recorded | Voluntary; no spend change; `OBJECTIVE_LOST` is the loss type per ADR-033 | `RECOVERED_WITH_LOSS` (objectives count: WAIVED); loss attributed to traveller | `communication.notify` (confirm to traveller); no external capability needed |
| 7 (bonus) | "Change me to business class if company policy allows" | Economy booking; org rule `ORG_CABIN_POLICY: BUSINESS allowed for flights >6h` | `UPSERT_FACT data.cabin = BUSINESS`; tool request `flight.fare_rules`; new search for business fare | Re-priced; re-ticketed if approved | Org rule decides; if allowed, spend above traveller limit → `REQUIRES_ORGANISATION_APPROVER`; if not allowed, `BLOCKED` | `FULLY_RECOVERED` (approved), `BLOCKED` (rule forbids), or `ESCALATED` (human agent if org ambiguous) | `flight.fare_rules`, `flight.search`, `flight.verify`, `flight.change`, `communication.request_approval` |
| 8 (bonus) | "I want a direct flight even if it costs more" | Current 1-stop itinerary; persistent preference `PREF_DIRECT` | `UPSERT_ENTITY TRIP_ELEMENT` with new direct offer; priceDelta likely positive | Removes connection risk; no buffer constraint change; time may improve | Spend above threshold; same-day re-issue may incur fee | `FULLY_RECOVERED` (within delegated spend) or `REQUIRES_TRAVELLER`/`REQUIRES_ORGANISATION_APPROVER` (above) | `flight.search`, `flight.fare_rules`, `flight.verify`, `flight.change` |

---

## 8. Architecture deltas (proposed, not implemented)

The investigation conclusion is: **minimal new surface, all on the ingestion boundary.** Concretely:

1. **New: `src/contracts/changeRequest.ts`** — `ChangeRequest` DTO + `ChangeRequestKindSchema` + `ChangeUrgencySchema`. Test-only dependency, no persistence.
2. **New: `src/app/changeRequestNormaliser.ts`** — maps `ChangeRequest` → `MutationOperation[]` (pure) using existing `MutationOperation` vocabulary. Tested with fixtures. Reuses the existing switch in `signalMutationOperations` for the well-known kinds (`FLIGHT_DELAY`-shape becomes `RESCHEDULE_FLIGHT`-shape, etc.).
3. **New: `src/app/changeRequestIngest.ts`** — accepts a `ChangeRequest`, builds a `TripSignal{kind: 'TRAVELLER_INPUT', payload: { changeRequest, candidateOperations, outcome? }}`, calls the existing `processSignal` pipeline. **No new `SignalKind`, no new pipeline.**
4. **New: `src/app/changeRequestViability.ts` (optional)** — a thin wrapper that, when `changeRequest.outcome?.kind === 'INFEASIBLE'`, asks the planner for compromise strategies. Reuses `runPlanningLoop` from existing code.
5. **New: `src/server/http.ts` `RuntimeHandlers` extension** — add `changeRequest(body)` handler that delegates to `changeRequestIngest`. Wire `POST /api/runtime/change-request` analogous to `POST /api/runtime/disruption` (no new endpoint class; same `/api/runtime/*` surface).
6. **Trip-element modification in the mutation path:** for `CHANGE_HOTEL` and similar, the candidate is `UPSERT_ENTITY TRIP_ELEMENT` with the new data. The mutation service already validates entity payloads against `ENTITY_SCHEMA_BY_TYPE`; no change needed there.
7. **UI:** traveller trip page gets a "Request a change" affordance producing the DTO; operator dashboard surfaces the same case UI it does today (no new case status).
8. **Doc:** ROADMAP investigation area 8 gets a "Decision adopted: DTO at boundary, no new SignalKind" entry.

### Explicitly NOT in scope
- No new `SignalKind`.
- No second modification engine.
- No LLM-direct authority bypass.
- No new mutation operation kind (the WAIVE op already exists).
- No new objective status (WAIVED/REPRIORITY already exist).
- No new precedence level (the four-level ladder already covers it).

### Open capability gaps (raised, not fixed here)
- `hotel.search` does not exist; investigation area 2 (hotel provider) should resolve.
- No `hotel.refund_quote` operation; `HotelActionOutcome.fee` covers cancellation fee, not refund.
- `communication.*` surface is generic; no traveller-chat-specific operation, and none needed for the engine to work.

---

## 9. Findings triaged

### Adopt (commit to design)
- **F1.** Traveller-initiated change enters the same engine as disruptions, via a `ChangeRequest` DTO at the ingestion boundary that normalises into the existing `TRAVELLER_INPUT` `TripSignal`. No new `SignalKind`. The pipeline (`processSignal` → `impact` → `overlay` → `planner` → `authority` → `executor` → `observation` → `resolve`) is reused verbatim. **Decision adopted: DTO at boundary.**
- **F2.** "No action is a valid outcome" is represented as an empty `candidateOperations` array plus a `payload.outcome.kind: ALREADY_SATISFIED` flag on the signal. The case opens, the planner emits a no-op strategy, viability passes, the case resolves `RESOLVED` on the next verification tick.
- **F3.** Initiation is **not** consent on its own. The authority gate still runs on the resulting `ActionIntent`. Re-confirmation is required for non-zero `priceDelta`, material deviation from the uttered request, and org-rule breaches. Initiation suffices only for `READ_ONLY` intents and for the `ALREADY_SATISFIED` no-op path.
- **F4.** Soft preference vs. hard instruction is the DTO's `urgency` field (`HARD_INSTRUCTION` / `SOFT_PREFERENCE`), propagated to the candidate operations and to the authority/verifier layers. The four-level preference precedence (`src/domain/preferences.ts`) is unchanged.

### Defer to other investigations
- **F5.** `hotel.search` capability gap — defer to Reality Validation investigation area 2 (Hotel provider). The change-request pipeline can carry a `CHANGE_HOTEL` DTO and produce a candidate; whether the candidate is from a real search or a curated/REPLAY set is the hotel investigation's call.
- **F6.** `hotel.refund_quote` — defer to same investigation; not blocking the change-request design.
- **F7.** Communication-channel surface (Slack/WhatsApp) for change-request intake — defer to stretch (already rejected in ROADMAP).

### Reject (do not do)
- **R1.** New `SignalKind` for change requests — would duplicate the `TRAVELLER_INPUT` branch and violate the single-engine invariant. **Rejected.**
- **R2.** Second modification engine — explicitly forbidden by ROADMAP investigation area 8. **Rejected.**
- **R3.** New mutation operation kind for change — `WAIVE_OR_REPRIORITIZE_OBJECTIVE` + `UPSERT_FACT` + `UPSERT_ENTITY` already cover every change shape in the brief. **Rejected.**
- **R4.** New objective status — `WAIVED`/`REPRIORITY`/`LOST` already exist. **Rejected.**
- **R5.** Bypassing the authority gate when the traveller initiated the change — same gate regardless of trigger; prevents LLM-fabricated "user asked" bypass. **Rejected.**

### Watch (open questions for the team)
- **W1.** When the overlay is `INFEASIBLE` for a `HARD_INSTRUCTION` ("return a day earlier") and the planner proposes a compromise (e.g. "return two days earlier"), should the system re-ask the traveller for a fresh verdict on the compromise, or auto-accept if the compromise is dominated by the original (closer to their stated goal)? Current default is re-ask; the spec may want a `nearest_feasible` shortcut for trivial cases.
- **W2.** When a `WAIVE` is issued by the traveller, does the case still count it as `remainingLossRefs` for ADR-033 compliance? Today: yes (ADR-033 explicitly includes WAIVED in the loss count). This is correct for audit but may surprise UX ("I asked to cancel, why is the case still 'recovered with loss'?"). Worth a UI label clarification, not a behaviour change.
- **W3.** Cost attribution: when org policy is `REQUIRES_ORGANISATION_APPROVER` and the approver approves, who "paid"? The engine doesn't decide; it's a `PolicyRule` field. Worth ensuring the rule schema carries an `payer` attribute before this lands.

---

## 10. One-paragraph decision record

Keep the engine unchanged. Add a `ChangeRequest` DTO at the ingestion boundary (`src/contracts/changeRequest.ts`), a normaliser that emits an existing-shape `TripSignal{kind: 'TRAVELLER_INPUT', payload: { changeRequest, candidateOperations, outcome? }}`, and one new `/api/runtime/change-request` HTTP handler. The four-level preference precedence, the WAIVE mutation, the overlay/viability/authority/executor seams, the case state machine, the `LossRecord` mechanism, and the ADR-033 loss accounting all apply unchanged. "No action is a valid outcome" is represented as an empty `candidateOperations` plus a `payload.outcome.kind: ALREADY_SATISFIED` flag. Initiation is not consent; the authority gate runs on the resulting `ActionIntent` regardless of who triggered it. Two real capability gaps (`hotel.search`, `hotel.refund_quote`) are raised to investigation areas 1/2 and are not blocking the design.

**End of investigation document.**
