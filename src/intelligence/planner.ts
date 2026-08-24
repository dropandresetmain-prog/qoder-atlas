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
import {
  RecoveryStrategySchema,
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
      return this.degradedOutput(result.error.category, result.error.code);
    }
    return this.toPlannerOutput(result.value, input);
  }

  /** Honest empty plan: no strategies, visible uncertainty, no throw. */
  private degradedOutput(category: ModelErrorCategory, code: string): PlannerOutput {
    return {
      strategies: [],
      toolRequests: [],
      assumptions: [],
      uncertainties: [
        this.uncertainty(
          `recovery planner unavailable (${category}/${code}); no candidate strategies generated`,
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
   */
  private mapToolRequest(
    request: PlannerToolRequestModel,
    uncertainties: UncertaintyRecord[],
  ): ToolRequest | undefined {
    const parsed = ToolRequestSchema.safeParse({
      id: this.idFactory('tool'),
      capability: request.capability,
      operation: request.operation,
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
    const candidate: RecoveryStrategy = {
      id: this.idFactory('strat'),
      caseId,
      summary: model.summary,
      candidateOperations: model.candidateOperations,
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
        kind: element.elementKind,
        importance: element.importance,
        flexibility: element.flexibility,
        reservationState: element.reservationState,
        status: element.status,
        dependsOn: element.dependsOn,
        notes: element.notes,
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
- Respond with a single JSON object matching the required schema.
- Strategies are hypothetical: candidateOperations are overlay-only mutation proposals evaluated later by a deterministic viability engine. You have NOT performed any deterministic check; never claim feasibility, viability, authority or execution status, and never add any field asserting it.
- Tool requests must be read-only information requests using only these operations: flight.search, flight.verify, flight.fare_rules, flight.order_status, flight.cancel_quote, flight.cancel_status, flight.refund_quote, hotel.context, hotel.search, hotel.quote, hotel.retrieve, routing.context, transfer.search, transfer.quote, transfer.retrieve, research.entry_requirements, research.local_context. Request information you are missing (e.g. replacement flights, fare rules, hotel options, routing context, entry requirements) before or alongside strategies that need it.
- Never request consequential operations (flight.book, flight.pay, flight.change, flight.cancel, hotel.book, hotel.modify, hotel.cancel, transfer.book, transfer.amend, transfer.cancel, communication.*, simulation.*); you cannot produce ActionIntents, authority decisions or executable actions.
- Precedence: explicit instructions outrank explicit preferences; explicit preferences outrank latent inferences. Accessibility and legal/entry items are requirements, never mere preferences.
- Legal/entry facts require authoritative sourcing; when missing, request research and keep the uncertainty visible.
- Keep uncertainties visible; never convert missing or stale evidence into certainty. When evidence is insufficient, record uncertainty instead of inventing detail.
- Propose multiple materially different strategies when reasonable, each with assumptions, uncertainties, expected outcomes and rationale.
`;
