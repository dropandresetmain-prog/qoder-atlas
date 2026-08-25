/**
 * D3 — RecoveryPlanner over the frozen F2 planner contract (FR-07,
 * ARCHITECTURE.md §11, ADR-024).
 *
 * Safety boundary (central rule):
 * - the planner consumes PlannerInput and produces PlannerOutput ONLY —
 *   strategies, read-only tool requests, assumptions, uncertainties,
 *   rationale. It never produces ActionIntents, authority decisions, or
 *   executable provider actions;
 * - candidateOperations are hypothetical overlay operations (FR-09); the
 *   deterministic ViabilityEngine decides feasibility later. The output
 *   schema has NO field in which the model could claim a deterministic
 *   check passed, and strict validation rejects any attempt to add one;
 * - tool requests are confined to the closed read-only ToolOperation
 *   vocabulary; consequential operations are structurally unrepresentable;
 * - malformed model output fails closed: the planner degrades to an honest
 *   empty plan carrying an uncertainty record — it never fabricates
 *   strategies and never throws into a RecoveryCase (NFR-03).
 *
 * A2 dependency note: the planner consumes the frozen ImpactAssessment
 * carried by PlannerInput; it does not depend on Lane A evaluator
 * internals. Viability evidence reaches later planner iterations through
 * priorToolResults/priorActionResults until integration wires A3 evidence.
 */
import type { EntityId, IsoDateTime, UncertaintyRecord } from '../domain/common.ts';
import { PREFERENCE_PRECEDENCE } from '../domain/preferences.ts';
import type { PlannerInput, PlannerOutput, RecoveryPlanner } from '../contracts/planner.ts';
import { PLANNER_OUTPUT_ALLOWED_KEYS } from '../contracts/planner.ts';
import { MutationOperationSchema, ENTITY_SCHEMA_BY_TYPE, type MutationOperation } from '../operational/mutation.ts';
import {
  RecoveryStrategySchema,
  TOOL_OPERATION_FAMILY,
  ToolOperationSchema,
  ToolRequestSchema,
  type RecoveryStrategy,
  type ToolRequest,
} from '../operational/strategy.ts';
import { newId } from '../util/ids.ts';
import type { ModelErrorCategory, ModelStudioClient } from './client.ts';
import {
  PlannerModelOutputSchema,
  type PlannerModelOutput,
  type PlannerStrategyModel,
  type PlannerToolRequestModel,
} from './schemas.ts';

export interface RecoveryPlannerOptions {
  client: ModelStudioClient;
  /** Injectable for deterministic test identifiers. */
  idFactory?: (prefix: string) => string;
  /** Injectable clock; deterministic in tests. */
  now?: () => IsoDateTime;
}

export class ModelStudioRecoveryPlanner implements RecoveryPlanner {
  private readonly client: ModelStudioClient;
  private readonly idFactory: (prefix: string) => string;
  private readonly now: () => IsoDateTime;

  constructor(options: RecoveryPlannerOptions) {
    this.client = options.client;
    this.idFactory = options.idFactory ?? newId;
    this.now = options.now ?? ((): IsoDateTime => new Date().toISOString());
  }

  async plan(input: PlannerInput): Promise<PlannerOutput> {
    const prompt = buildPlannerPrompt(input);
    const result = await this.client.call({
      id: 'recovery_planner',
      systemPrompt: prompt.systemPrompt,
      userPrompt: prompt.userPrompt,
      schema: PlannerModelOutputSchema,
    });
    if (!result.ok) {
      // Fail closed: model failure is data. No fabricated strategies.
      return this.degradedOutput(result.error.category, result.error.code, result.error.message);
    }
    return this.toPlannerOutput(result.value, input);
  }

  /** Honest empty plan: no strategies, visible uncertainty, no throw. */
  private degradedOutput(category: ModelErrorCategory, code: string, detail?: string): PlannerOutput {
    return {
      strategies: [],
      toolRequests: [],
      assumptions: [],
      uncertainties: [
        this.uncertainty(
          `recovery planner unavailable (${category}/${code}); no candidate strategies generated` +
            (detail !== undefined ? `; ${detail}` : ''),
          'HIGH',
        ),
      ],
      rationale: 'planner model unavailable; deterministic fallback produced no candidate strategies',
    };
  }

  private toPlannerOutput(model: PlannerModelOutput, input: PlannerInput): PlannerOutput {
    const uncertainties: UncertaintyRecord[] = model.uncertainties.map((u) =>
      this.uncertainty(u.statement, u.severity, u.aboutRef !== undefined ? [u.aboutRef] : []),
    );

    const toolRequests: ToolRequest[] = [];
    for (const request of model.toolRequests) {
      const mapped = this.mapToolRequest(request, uncertainties);
      if (mapped !== undefined) toolRequests.push(mapped);
    }

    const strategies: RecoveryStrategy[] = [];
    for (const strategyModel of model.strategies) {
      const mapped = this.mapStrategy(strategyModel, input.caseId, uncertainties);
      if (mapped !== undefined) strategies.push(mapped);
    }

    const output: PlannerOutput = {
      strategies,
      toolRequests,
      assumptions: [...model.assumptions],
      uncertainties,
      rationale: model.rationale,
    };
    // Defence in depth: the frozen allowed-key set is the final gate; an
    // unexpected key degrades the whole plan rather than leaking through.
    for (const key of Object.keys(output)) {
      if (!(PLANNER_OUTPUT_ALLOWED_KEYS as readonly string[]).includes(key)) {
        return this.degradedOutput('INVALID_OUTPUT', 'planner_output_key_rejected');
      }
    }
    return output;
  }

  /**
   * Maps a model tool request onto the frozen ToolRequest, assigning the id
   * deterministically and enforcing the read-only vocabulary plus
   * capability/operation family consistency. Invalid requests are dropped
   * with a visible uncertainty — never passed through, never executed.
   *
   * Boundary normalization (still fail-closed): the operation must be an
   * exact member of the closed read-only vocabulary, and the capability is
   * normalized onto the frozen family enum via TOOL_OPERATION_FAMILY —
   * accepting lowercase aliases and rejecting any model-claimed family that
   * contradicts the operation. No consequential operation is representable.
   */
  private mapToolRequest(
    request: PlannerToolRequestModel,
    uncertainties: UncertaintyRecord[],
  ): ToolRequest | undefined {
    const operationParsed = ToolOperationSchema.safeParse(request.operation);
    if (!operationParsed.success) {
      // Never echo the rejected operation name: consequential names must
      // not leak into persisted planner output.
      uncertainties.push(
        this.uncertainty('discarded planner tool request outside the read-only operation vocabulary', 'LOW'),
      );
      return undefined;
    }
    const capability = TOOL_OPERATION_FAMILY[operationParsed.data];
    const parsed = ToolRequestSchema.safeParse({
      id: this.idFactory('tool'),
      capability,
      operation: operationParsed.data,
      parameters: request.parameters,
      purpose: request.purpose,
    });
    if (!parsed.success) {
      uncertainties.push(
        this.uncertainty(
          `discarded invalid planner tool request (${request.capability}/${request.operation})`,
          'LOW',
        ),
      );
      return undefined;
    }
    return parsed.data;
  }

  /**
   * Maps a model strategy onto the frozen RecoveryStrategy. Ids and
   * timestamps are assigned deterministically; the result is validated
   * against the frozen schema before acceptance. Strategies remain
   * hypothetical overlay proposals — no viability claim exists or is added.
   *
   * Per-strategy fail-closed: every candidateOperation must validate against
   * MutationOperationSchema; one invalid operation drops the whole strategy
   * with a visible uncertainty (never the entire plan, never a partial
   * reinterpretation of the proposal).
   */
  private mapStrategy(
    model: PlannerStrategyModel,
    caseId: EntityId,
    uncertainties: UncertaintyRecord[],
  ): RecoveryStrategy | undefined {
    const strategyToolRequests: ToolRequest[] = [];
    for (const request of model.toolRequests) {
      const mapped = this.mapToolRequest(request, uncertainties);
      if (mapped !== undefined) strategyToolRequests.push(mapped);
    }
    const candidateOperations: MutationOperation[] = [];
    for (const raw of model.candidateOperations) {
      const parsed = MutationOperationSchema.safeParse(raw);
      if (!parsed.success) {
        const path = parsed.error.issues
          .slice(0, 4)
          .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '<root>'}:${issue.code}`)
          .join('; ');
        uncertainties.push(
          this.uncertainty(
            `discarded planner strategy with invalid candidate operation (${path}): ${model.summary}`,
            'MEDIUM',
          ),
        );
        return undefined;
      }
      // Validate UPSERT_ENTITY payloads against the deterministic entity
      // registry here (the overlay enforces the same registry) so the model
      // receives specific issue paths instead of a generic overlay rejection.
      const op = parsed.data;
      if (op.op === 'UPSERT_ENTITY') {
        const payload = ENTITY_SCHEMA_BY_TYPE[op.entityType].safeParse(op.data);
        if (!payload.success) {
          const path = payload.error.issues
            .slice(0, 6)
            .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '<root>'}:${issue.code}`)
            .join('; ');
          uncertainties.push(
            this.uncertainty(
              `discarded planner strategy with invalid ${op.entityType} payload (${path}): ${model.summary}`,
              'MEDIUM',
            ),
          );
          return undefined;
        }
      }
      candidateOperations.push(parsed.data);
    }
    const candidate: RecoveryStrategy = {
      id: this.idFactory('strat'),
      caseId,
      summary: model.summary,
      candidateOperations,
      toolRequests: strategyToolRequests,
      assumptions: [...model.assumptions],
      uncertainties: model.uncertainties.map((statement) => this.uncertainty(statement, 'MEDIUM')),
      expectedOutcomes: [...model.expectedOutcomes],
      costImpact: model.costImpact,
      createdAt: this.now(),
    };
    const validated = RecoveryStrategySchema.safeParse(candidate);
    if (!validated.success) {
      uncertainties.push(
        this.uncertainty(`discarded planner strategy failing frozen RecoveryStrategy validation: ${model.summary}`, 'MEDIUM'),
      );
      return undefined;
    }
    return validated.data;
  }

  private uncertainty(
    statement: string,
    severity: 'LOW' | 'MEDIUM' | 'HIGH',
    aboutRefs: UncertaintyRecord['aboutRefs'] = [],
  ): UncertaintyRecord {
    return { id: this.idFactory('unc'), statement, aboutRefs, severity };
  }
}

// ---------------------------------------------------------------------------
// Prompt construction — deterministic projection of PlannerInput
// ---------------------------------------------------------------------------

export interface PlannerPrompt {
  systemPrompt: string;
  /** Pure JSON projection of the frozen PlannerInput. */
  userPrompt: string;
}

/**
 * Builds the planner prompt from PlannerInput only. No scenario facts are
 * injected; everything comes from the snapshot, signals, impact, capability
 * registry and prior results. Preferences are projected in frozen
 * precedence order (explicit over latent) so the model sees the ranking.
 */
export function buildPlannerPrompt(input: PlannerInput): PlannerPrompt {
  const { snapshot } = input;
  const preferences = [...snapshot.preferences]
    .sort((a, b) => PREFERENCE_PRECEDENCE[b.origin.kind] - PREFERENCE_PRECEDENCE[a.origin.kind])
    .map((p) => ({
      statement: p.statement,
      originKind: p.origin.kind,
      precedence: PREFERENCE_PRECEDENCE[p.origin.kind],
    }));

  const context = {
    caseId: input.caseId,
    trip: {
      id: snapshot.trip.id,
      viability: snapshot.trip.viability,
      elements: snapshot.trip.elements.map((element) => ({
        id: element.id,
        // Named exactly as the domain schema field: model-authored
        // UPSERT_ENTITY payloads must carry `elementKind`, not `kind`.
        elementKind: element.elementKind,
        importance: element.importance,
        flexibility: element.flexibility,
        reservationState: element.reservationState,
        status: element.status,
        dependsOn: element.dependsOn,
        notes: element.notes,
        // Read-only schedule/location grounding so the model can author
        // timing-aware tool parameters and candidate operations. Facts keep
        // their provenance envelope; the model never upgrades authority.
        data: element.data,
      })),
      objectives: snapshot.trip.objectives.map((o) => ({
        id: o.id,
        statement: o.statement,
        hardness: o.hardness,
        status: o.status,
      })),
      relations: snapshot.trip.relations,
    },
    constraints: snapshot.constraints,
    preferences,
    ruleSetIds: snapshot.ruleSets.map((r) => r.id),
    anchorEventId: snapshot.anchorEvent?.id,
    travellerIds: snapshot.travellers.map((t) => t.id),
    places: snapshot.places.map((place) => ({
      id: place.id,
      name: place.name,
      kind: place.kind,
      timezone: place.timezone,
      coordinates: place.coordinates,
      externalRefs: place.externalRefs,
      servedByPlaceIds: place.servedByPlaceIds,
    })),
    // Source metadata (no raw payloads): the ids the model may cite when
    // authoring fact envelopes in candidate operations.
    sources: snapshot.sourceRecords.map((source) => ({
      id: source.id,
      kind: source.kind,
      authority: source.authority,
    })),
    triggeringSignals: input.triggeringSignals.map((signal) => ({
      id: signal.id,
      kind: signal.kind,
      occurredAt: signal.occurredAt,
      authority: signal.authority,
      summary: signal.summary,
      payload: signal.payload,
    })),
    impact: {
      severity: input.impact.severity,
      directFailures: input.impact.directFailures,
      affectedElements: input.impact.affectedElements,
      threatenedObjectives: input.impact.threatenedObjectives,
      irreversibleLosses: input.impact.irreversibleLosses,
      policyImplications: input.impact.policyImplications,
      insuranceImplications: input.impact.insuranceImplications,
      financialExposure: input.impact.financialExposure,
      unresolvedUnknowns: input.impact.unresolvedUnknowns,
      recoveryHeadroom: input.impact.recoveryHeadroom,
    },
    capabilities: input.capabilityRegistry.map((descriptor) => ({
      family: descriptor.family,
      providerId: descriptor.providerId,
      mode: descriptor.mode,
      supportedOperations: descriptor.supportedOperations,
      maxSideEffectLevel: descriptor.maxSideEffectLevel,
    })),
    priorToolResults: input.priorToolResults,
    priorActionResults: input.priorActionResults,
  };

  return { systemPrompt: PLANNER_SYSTEM_PROMPT, userPrompt: JSON.stringify(context, null, 2) };
}

const PLANNER_SYSTEM_PROMPT = `You are the recovery planner for a disrupted trip. You propose recovery strategies; you never execute anything.

Hard rules:
- Respond with a single JSON object matching the required schema: no markdown fences, no text before or after the JSON, and no keys other than the ones named below.
- Strategies are hypothetical: candidateOperations are overlay-only mutation proposals evaluated later by a deterministic viability engine. You have NOT performed any deterministic check; never claim feasibility, viability, authority or execution status, and never add any field asserting it.
- Tool requests must be read-only information requests using only these operations: flight.search, flight.verify, flight.fare_rules, flight.order_status, flight.cancel_quote, flight.cancel_status, flight.refund_quote, hotel.context, hotel.search, hotel.quote, hotel.retrieve, routing.context, transfer.search, transfer.quote, transfer.retrieve, research.entry_requirements, research.local_context. Request information you are missing (e.g. replacement flights, fare rules, hotel options, routing context, entry requirements) before or alongside strategies that need it. Ground tool parameters in the context: use place externalRefs (e.g. IATA airport codes) for airports, coordinates or place ids for routing/transfer origins and destinations, and element data for dates. Only request operations that appear in the projected capabilities list (operations missing there are not wired and return structured unavailability).
- Tool parameters must match these exact shapes (no extra keys):
  flight.search: { origin: { system, value }, destination: { system, value }, departureDate: "YYYY-MM-DD", passengers?: { adults, children?, infants? }, cabinClass?, maxStops? } — origin/destination are place externalRefs objects, e.g. { "system": "IATA", "value": "KUL" }.
  flight.verify | flight.fare_rules: { offerId } (from a prior flight.search result).
  flight.order_status | flight.cancel_quote: { orderRef, clientReference? }.
  flight.cancel_status: { orderRef, clientReference?, cancellationRequestRef? }.
  hotel.context: { stayElementId } — the id of a STAY trip element.
  hotel.search: { location: { externalRef?: { system, value }, coordinates?: { latitude, longitude, radiusKm? } }, checkInDate: "YYYY-MM-DD", checkOutDate: "YYYY-MM-DD", guests?: { adults, children? }, rooms? }.
  hotel.quote: { rateId, workflowState? } (from a prior hotel.search result).
  hotel.retrieve: { bookingId }.
  routing.context: { origin: { externalRef?: { system, value }, coordinates?: { latitude, longitude } }, destination: { externalRef?: { system, value }, coordinates?: { latitude, longitude } }, mode?: "DRIVE"|"TRANSIT"|"WALK", departAt?: ISO datetime }.
  research.entry_requirements: { destinationCountryCode, nationalityCodes?, travelDate? }.
  research.local_context: { topic, placeRef?: { system, value } }.
- Never request consequential operations (flight.book, flight.pay, flight.change, flight.cancel, hotel.book, hotel.modify, hotel.cancel, transfer.book, transfer.amend, transfer.cancel, communication.*, simulation.*); you cannot produce ActionIntents, authority decisions or executable actions.
- Precedence: explicit instructions outrank explicit preferences; explicit preferences outrank latent inferences. Accessibility and legal/entry items are requirements, never mere preferences.
- Legal/entry facts require authoritative sourcing; when missing, request research and keep the uncertainty visible.
- Keep uncertainties visible; never convert missing or stale evidence into certainty. When evidence is insufficient, record uncertainty instead of inventing detail.
- Propose multiple materially different strategies when reasonable, each with assumptions, uncertainties, expected outcomes and rationale.
- If you cannot yet author grounded candidateOperations because required evidence is missing (e.g. no replacement schedule known), emit the toolRequests that would obtain it and keep strategies empty or minimal — a strategy whose candidateOperations are empty is deterministically infeasible.
- When changing only specific facts of an existing element (scheduled times, check-in/check-out, occupancy), PREFER one UPSERT_FACT operation per changed fact over a full UPSERT_ENTITY payload; use UPSERT_ENTITY mainly to create a brand-new element. The fact value keeps the provenance envelope, e.g. { "op": "UPSERT_FACT", "target": { "entityType": "TRIP_ELEMENT", "id": "<element id>" }, "factPath": "data.scheduledArrival", "value": { "value": "<ISO datetime>", "sourceId": "<a sourceId visible in the context>", "authority": "CONNECTED", "observedAt": "<ISO datetime>" }, "sourceId": "<a sourceId visible in the context>", "authority": "CONNECTED" }. Reuse only ids that appear in the provided context; never invent ids.

Required output JSON shape (exact top-level keys; every key optional except none — empty arrays are valid):
{
  "strategies": [
    {
      "summary": "string",
      "candidateOperations": [<mutation operations, see below>],
      "toolRequests": [<tool requests, see below>],
      "assumptions": ["string"],
      "uncertainties": ["string"],
      "expectedOutcomes": ["string"],
      "costImpact": { "amount": 0, "currency": "USD" }
    }
  ],
  "toolRequests": [
    {
      "capability": "FLIGHT|HOTEL|TRANSFER|ROUTING|RESEARCH",
      "operation": "<one of the read-only operations above>",
      "parameters": { },
      "purpose": "string"
    }
  ],
  "assumptions": ["string"],
  "uncertainties": [
    { "statement": "string", "severity": "LOW|MEDIUM|HIGH" }
  ],
  "rationale": "string"
}

candidateOperations use exactly one of these shapes per item:
- { "op": "UPSERT_ENTITY", "entityType": "TRIP_ELEMENT", "id": "<existing element id when updating, omit when creating>", "data": { <a COMPLETE trip element object: every field shown in the context projection of the element you are changing — id, tripId (the exact trip id string from the context), elementKind, importance, flexibility, reservationState, status, dependsOn, governedByRuleSetIds, notes (optional), and the elementKind-specific data block. Copy the existing element exactly and change only the affected fields; do not omit fields and do not wrap the element in another object. For a TRANSPORT_LEG the data block is { mode, originPlaceId, destinationPlaceId, scheduledDeparture: { value, sourceId, authority, observedAt }?, scheduledArrival: { value, sourceId, authority, observedAt }?, bookingRef?: { system, reference }, durationEstimate?, carrierRef? }; mode is exactly one of FLIGHT, TRAIN, FERRY, PUBLIC_TRANSIT, TAXI_OR_RIDEHAIL, PRIVATE_TRANSFER, CAR_RENTAL, WALKING, OTHER (copy the existing element's mode); fact values are ISO datetimes like "2026-09-30T08:10:00+08:00". For a STAY it is { placeId, checkIn: <fact>, checkOut: <fact>, bookingRef?, guests?, policyRuleSetIds }. For an ENGAGEMENT it is { title, placeId?, startsAt: <fact>, endsAt?: <fact>, anchorEventId?, anchorCommitmentId?, participantRole? }. }> }
- Other entityType values are exactly: ORGANISATION, TRAVELLER, ANCHOR_EVENT, TRIP, TRIP_ELEMENT, TRIP_OBJECTIVE, PLACE, RULE_SET, CONSTRAINT. No other entityType exists; a strategy with an invalid operation is discarded.
- { "op": "UPSERT_FACT", "target": { "entityType": "...", "id": "..." }, "factPath": "data.checkIn", "value": <any>, "sourceId": "...", "authority": "AUTHORITATIVE|CONNECTED|ASSERTED|INFERRED" }
- { "op": "ADD_RELATION", "tripId": "...", "relation": { ... } }
- { "op": "REMOVE_RELATION", "tripId": "...", "relation": { ... } }
- { "op": "UPSERT_CONSTRAINT", "constraint": { ... } }
- { "op": "WAIVE_OR_REPRIORITIZE_OBJECTIVE", "objectiveId": "...", "action": "WAIVE|REPRIORITY", "by": { "entityType": "...", "id": "..." }, "reason": "string" }
You may never upsert a constraint, rule set or judging objective that already exists in the snapshot — those are the evaluation basis.
`;
