/**
 * I4 — authority -> action -> observation -> resolution.
 *
 * The transition from a selected RecoveryStrategy to an ActionIntent is
 * deterministic and application-owned: the planner never mints execution
 * authority. Every intent passes the deterministic AuthorityEngine; required
 * approvals enter through the same generalized authority system; and the
 * executor boundary is only crossed with an AuthorisedExecution envelope that
 * survives executionGateIssues(). An intent merely marked AUTHORISED is never
 * executable evidence.
 *
 * Execution success alone never closes the case: observed effects become
 * VALIDATED mutations, the CaseVerifier re-evaluates viability, and only that
 * deterministic outcome resolves the case (FULLY_RECOVERED /
 * RECOVERED_WITH_LOSS) or loops back into assessment/planning.
 */
import type { EntityId, EntityRef, IsoDateTime } from '../domain/common.ts';
import { instantMillis, IsoDateTimeSchema } from '../domain/common.ts';
import type { TripSnapshot } from '../operational/snapshot.ts';
import type { RecoveryStrategy } from '../operational/strategy.ts';
import type {
  ActionIntent,
  AuthorityDecision,
  AuthorisedExecution,
  CapabilityOperation,
  ExecutionResult,
  SideEffectLevel,
} from '../operational/intent.ts';
import { executionGateIssues } from '../operational/intent.ts';
import type { CapabilityFamily } from '../operational/strategy.ts';
import { isLegalCaseTransition, type CaseStatus } from '../operational/case.ts';
import type { MutationOperation } from '../operational/mutation.ts';
import type {
  AuthorityContext,
  AuthorityEngine,
  ExecutorService,
  ObservationOutcome,
  ObservationService,
  PrincipalRecord,
} from '../contracts/services.ts';
import type { AuditRepository, CaseRepository, SignalRepository, TripRepository } from '../contracts/repositories.ts';
import type { EntityStore } from '../persistence/entityStore.ts';
import { CaseService } from '../engine/case.ts';
import { withApproval } from '../engine/authority.ts';
import { allocationFromDecision, payerDecisionFor } from '../engine/funding.ts';
import type { CaseVerifier, VerificationResult } from '../engine/observation.ts';
import { confirmsCandidateOperations } from '../operational/intent.ts';
import { principalScopeForTrip } from './snapshot.ts';

// ---------------------------------------------------------------------------
// Deterministic action-intent construction
// ---------------------------------------------------------------------------

interface ConsequentialOperation {
  operation: CapabilityOperation;
  capability: CapabilityFamily;
  sideEffectLevel: SideEffectLevel;
}

/**
 * Derive the consequential provider operation from a strategy's candidate
 * overlay operations. Purely structural: what kind of trip element the
 * candidate replaces determines the operation vocabulary entry — no
 * scenario/destination knowledge anywhere on this path.
 *
 * REV-2 WP-R1: waiving or reprioritising a traveller objective is itself a
 * consequential act on the traveller's trip. A strategy carrying a waiver must
 * therefore never be classified REVERSIBLE (which the default authority ladder
 * auto-approves): the side-effect level is escalated to IRREVERSIBLE so the
 * intent reaches an approval-requiring authority outcome.
 */
export function consequentialOperationFor(operations: MutationOperation[]): ConsequentialOperation {
  const carriesWaiver = operations.some((operation) => operation.op === 'WAIVE_OR_REPRIORITIZE_OBJECTIVE');
  for (const operation of operations) {
    if (operation.op !== 'UPSERT_ENTITY' || operation.entityType !== 'TRIP_ELEMENT') continue;
    const element = operation.data as Record<string, unknown>;
    const elementKind = element['elementKind'];
    if (elementKind === 'TRANSPORT_LEG') {
      const data = element['data'];
      const mode = data && typeof data === 'object' ? (data as Record<string, unknown>)['mode'] : undefined;
      if (mode === 'FLIGHT') {
        // Rebooking a flight moves money at the provider boundary.
        return { operation: 'flight.change', capability: 'FLIGHT', sideEffectLevel: 'MONEY_MOVING' };
      }
    }
    if (elementKind === 'STAY') {
      // G3R-R1 A1: a stay replacement books a chargeable replacement and
      // cancels the displaced stay at a real provider. It was previously
      // REVERSIBLE (auto-approved by the default ladder) — safe only while
      // execution was simulated. MONEY_MOVING is the honest classification
      // and, like IRREVERSIBLE, reaches an approval-requiring outcome, so a
      // waiver riding along still demands approval.
      return {
        operation: 'hotel.modify',
        capability: 'HOTEL',
        sideEffectLevel: 'MONEY_MOVING',
      };
    }
  }
  return {
    operation: 'simulation.provider_action',
    capability: 'SIMULATION',
    sideEffectLevel: carriesWaiver ? 'IRREVERSIBLE' : 'REVERSIBLE',
  };
}

/** Provider-facing parameters derived from the candidate element payloads. */
function providerParametersFor(strategy: RecoveryStrategy): Record<string, unknown> {
  const candidateElementIds: string[] = [];
  const bookingRefs: Array<{ system: string; reference: string }> = [];
  for (const operation of strategy.candidateOperations) {
    if (operation.op !== 'UPSERT_ENTITY' || operation.entityType !== 'TRIP_ELEMENT') continue;
    const element = operation.data as Record<string, unknown>;
    if (typeof element['id'] === 'string') candidateElementIds.push(element['id']);
    const data = element['data'];
    if (data && typeof data === 'object') {
      const ref = (data as Record<string, unknown>)['bookingRef'];
      if (
        ref &&
        typeof ref === 'object' &&
        typeof (ref as Record<string, unknown>)['system'] === 'string' &&
        typeof (ref as Record<string, unknown>)['reference'] === 'string'
      ) {
        bookingRefs.push(ref as { system: string; reference: string });
      }
    }
  }
  return { candidateElementIds, bookingRefs };
}

/**
 * Deterministic strategy -> ActionIntent. Identical strategy + timestamp
 * always yields an identical intent; authority is never part of the output.
 */
export function buildActionIntent(input: {
  id: EntityId;
  caseId: EntityId;
  strategy: RecoveryStrategy;
  at: IsoDateTime;
  /** Deterministic payer allocation of priceDelta when mixed funding applies. */
  costAllocation?: ActionIntent['costAllocation'];
}): ActionIntent {
  const { operation, capability, sideEffectLevel } = consequentialOperationFor(input.strategy.candidateOperations);
  return {
    id: input.id,
    caseId: input.caseId,
    strategyId: input.strategy.id,
    operation,
    capability,
    parameters: providerParametersFor(input.strategy),
    sideEffectLevel,
    ...(input.strategy.costImpact ? { priceDelta: input.strategy.costImpact } : {}),
    ...(input.costAllocation ? { costAllocation: input.costAllocation } : {}),
    evidenceRefs: [],
    expectedResult: input.strategy.summary,
    status: 'PROPOSED',
    createdAt: input.at,
  };
}

/** Generic principal derivation: the snapshot's travellers and organisations. */
export function principalsForSnapshot(snapshot: TripSnapshot): PrincipalRecord[] {
  return [
    ...snapshot.travellers.map((traveller) => ({
      ref: { entityType: 'TRAVELLER' as const, id: traveller.id },
      permissions: [] as string[],
    })),
    ...snapshot.organisations.map((organisation) => ({
      ref: { entityType: 'ORGANISATION' as const, id: organisation.id },
      permissions: [] as string[],
    })),
  ];
}

// ---------------------------------------------------------------------------
// Timeline coherence (DR-1.1)
// ---------------------------------------------------------------------------

/**
 * The causal horizon of a case's triggering signals: the latest instant at
 * which any triggering disruption was received (or occurred). Recovery work
 * performed IN RESPONSE to those signals is causally downstream of them and
 * must never be stamped earlier.
 *
 * Returns undefined when no signal instant is derivable (e.g. unit tests that
 * drive the service without a signal repository) — callers then keep the
 * requested instant unchanged.
 */
export async function signalHorizon(
  signals: SignalRepository | undefined,
  triggeredBySignalIds: EntityId[],
): Promise<IsoDateTime | undefined> {
  if (!signals) return undefined;
  let horizon: IsoDateTime | undefined;
  for (const signalId of triggeredBySignalIds) {
    const signal = await signals.getSignal(signalId);
    if (!signal) continue;
    const instant = signal.receivedAt ?? signal.occurredAt;
    if (horizon === undefined || instantMillis(instant) > instantMillis(horizon)) horizon = instant;
  }
  return horizon;
}

/**
 * Lift a caller-supplied instant to the causal horizon when it predates it.
 *
 * This does NOT weaken the causal evidence rule (`observedAt >= signalInstant`
 * in ImpactEngine): genuinely older evidence still loses. It only stops the
 * runtime from stamping a response to a disruption with an instant that
 * predates the disruption itself — which is what happens when a demo/UI
 * surface supplies an ordinary wall-clock instant against a future-dated
 * scenario timeline. Ordering goes through instant comparison, so the host
 * timezone never changes the result.
 */
export function liftToHorizon(requestedAt: IsoDateTime, horizon: IsoDateTime | undefined): IsoDateTime {
  if (horizon === undefined) return requestedAt;
  return instantMillis(horizon) > instantMillis(requestedAt) ? horizon : requestedAt;
}

// ---------------------------------------------------------------------------
// Executor wrapper: provider-boundary effects become observed operations
// ---------------------------------------------------------------------------

function isFactValue(value: unknown): value is { value: string; sourceId: string } {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>)['value'] === 'string' &&
    typeof (value as Record<string, unknown>)['sourceId'] === 'string' &&
    typeof (value as Record<string, unknown>)['authority'] === 'string' &&
    typeof (value as Record<string, unknown>)['observedAt'] === 'string'
  );
}

/** Upgrade fact fields in an element payload to confirmed provider evidence. */
function confirmedData(data: Record<string, unknown>, confirmedAt: IsoDateTime): Record<string, unknown> {
  const upgraded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    upgraded[key] = isFactValue(value)
      ? { value: value.value, sourceId: value.sourceId, authority: 'AUTHORITATIVE', observedAt: confirmedAt }
      : value;
  }
  return upgraded;
}

/**
 * Overlay candidates are HELD hypotheses; a provider confirmation turns them
 * into confirmed authoritative element state. Purely structural: reservation
 * state/status become CONFIRMED/VALID and every schedule fact is upgraded to
 * AUTHORITATIVE evidence at the execution instant. No scenario knowledge.
 *
 * Observation vocabulary is an explicit allowlist (REV-C WP-C1): an execution
 * observation may legitimately carry only confirmed TRIP_ELEMENT upserts and
 * objective waivers/reprioritisations (G1 depends on waivers surviving
 * observation into authoritative state). Everything else in the mutation
 * vocabulary — UPSERT_CONSTRAINT, UPSERT_ENTITY of RULE_SET / TRAVELLER /
 * ORGANISATION / PLACE / TRIP / TRIP_OBJECTIVE, UPSERT_FACT, ADD_RELATION
 * and REMOVE_RELATION — is policy/state that no provider result can observe,
 * so it is never admitted into the observation mutation. A planner-authored
 * constraint downgrade can therefore never reach authoritative state through
 * execution (FR-09, ADR-003, ADR-004).
 *
 * Waiver provenance (REV-2 WP-R1): a waiver is admitted into the observation
 * mutation only when the execution it rides on is backed by an explicitly
 * APPROVED authority decision. A planner-authored waiver that was never
 * approved — including anything that slipped through as AUTO_APPROVED — is
 * dropped here, making the approval provenance explicit instead of implicit.
 */
export function confirmedOperationsFor(
  operations: MutationOperation[],
  confirmedAt: IsoDateTime,
  authority?: AuthorityDecision,
): MutationOperation[] {
  const waiverApproved =
    authority !== undefined &&
    authority.outcome !== 'AUTO_APPROVED' &&
    authority.approval !== undefined &&
    authority.approval.decision === 'APPROVED';
  const confirmed: MutationOperation[] = [];
  for (const operation of operations) {
    if (operation.op === 'WAIVE_OR_REPRIORITIZE_OBJECTIVE') {
      // Explicit instruction evidence observed through execution survives —
      // but only when an approved authority decision originates it.
      if (waiverApproved) confirmed.push(operation);
      continue;
    }
    if (operation.op !== 'UPSERT_ENTITY' || operation.entityType !== 'TRIP_ELEMENT') {
      // Not observable from a provider result: never admitted.
      continue;
    }
    const element = operation.data as Record<string, unknown>;
    const data = element['data'];
    confirmed.push({
      op: 'UPSERT_ENTITY',
      entityType: 'TRIP_ELEMENT',
      data: {
        ...element,
        reservationState: 'CONFIRMED',
        status: 'VALID',
        ...(data && typeof data === 'object'
          ? { data: confirmedData(data as Record<string, unknown>, confirmedAt) }
          : {}),
      },
    });
  }
  return confirmed;
}

/**
 * Wraps an executor so that a SUCCESS at the provider boundary carries the
 * confirmed candidate operations as observed effects. Observation still
 * re-validates them through the MutationService (PROVIDER origin) before any
 * authoritative state changes; a simulation never bypasses validation.
 */
export function createRecoveryExecutor(deps: {
  inner: ExecutorService;
  strategyFor: (intent: ActionIntent) => RecoveryStrategy | undefined | Promise<RecoveryStrategy | undefined>;
}): ExecutorService {
  return {
    execute: async (execution: AuthorisedExecution): Promise<ExecutionResult> => {
      const result = await deps.inner.execute(execution);
      // G3R-R1 A2: provider SUCCESS is not, by itself, the candidate state.
      // A `flight.book` hold and an accepted-but-PROCESSING cancellation are
      // both SUCCESSful operations that have NOT realised the strategy's
      // candidate elements; confirming them here would make HELD
      // indistinguishable from TICKETED in authoritative trip state. The
      // ADR-007 simulation boundary keeps its historic confirming behaviour.
      if (!confirmsCandidateOperations(result)) return result;
      const strategy = await deps.strategyFor(execution.intent);
      if (!strategy) return result;
      // Waiver provenance: the authority decision backing THIS execution is
      // the only evidence that can admit a waiver into observation.
      const operations = confirmedOperationsFor(strategy.candidateOperations, result.executedAt, execution.authority);
      if (operations.length === 0) return result;
      return {
        ...result,
        observedEffects: { ...(result.observedEffects ?? {}), operations },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Recovery execution service: the full authority -> execution -> resolution
// lifecycle on persisted case state
// ---------------------------------------------------------------------------

export interface RecoveryExecutionDependencies {
  cases: CaseRepository;
  audit: AuditRepository;
  authority: AuthorityEngine;
  executor: ExecutorService;
  observation: ObservationService;
  verifier: CaseVerifier;
  /** Approval-time principal scope resolution (WP-C4): trip repository. */
  trips: TripRepository;
  /** Approval-time principal scope resolution (WP-C4): entity store. */
  entities: EntityStore;
  /**
   * Optional: triggering-signal evidence for funding anchors. Present in the
   * composed runtime; absent only in unit tests that drive the service
   * directly without signal history.
   */
  signals?: SignalRepository;
}

export interface BeginStrategyInput {
  snapshot: TripSnapshot;
  caseId: EntityId;
  strategy: RecoveryStrategy;
  at: IsoDateTime;
}

export interface AuthorityStageOutcome {
  intent: ActionIntent;
  decision: AuthorityDecision;
  caseStatus: CaseStatus;
  /** True when no approval is needed and execution may proceed immediately. */
  executable: boolean;
}

export interface ApprovalInput {
  caseId: EntityId;
  intentId: EntityId;
  decidedBy: EntityRef;
  decidedAt: IsoDateTime;
  verdict: 'APPROVED' | 'DECLINED';
  note?: string;
}

export interface ApprovalStageOutcome {
  accepted: boolean;
  decision: AuthorityDecision;
  caseStatus: CaseStatus;
  reason?: string;
}

export interface ExecutionStageOutcome {
  executed: boolean;
  gateIssues: string[];
  intent: ActionIntent;
  decision: AuthorityDecision;
  /** Absent when the authority gate refused before any executor call. */
  result?: ExecutionResult;
  observation?: ObservationOutcome;
  verification?: VerificationResult;
  caseStatus: CaseStatus;
}

const APPROVER_ENTITY_TYPES: Record<string, readonly string[]> = {
  REQUIRES_TRAVELLER: ['TRAVELLER'],
  REQUIRES_ORGANISATION_APPROVER: ['ORGANISATION'],
  REQUIRES_HUMAN_AGENT: ['ORGANISATION', 'TRAVELLER'],
};

export class RecoveryExecutionService {
  private readonly deps: RecoveryExecutionDependencies;
  private readonly caseService: CaseService;

  constructor(deps: RecoveryExecutionDependencies) {
    this.deps = deps;
    this.caseService = new CaseService({ cases: deps.cases });
  }

  /**
   * Deterministic strategy -> intent -> authority decision. The case moves to
   * READY_TO_EXECUTE, an awaiting state, or ESCALATED (blocked) — never
   * straight to execution.
   */
  async beginStrategy(input: BeginStrategyInput): Promise<AuthorityStageOutcome> {
    const recoveryCase = await this.mustGet(input.caseId);
    // Timeline coherence (DR-1.1): the intent's effective instant is lifted to
    // the causal horizon of the case's triggering signals, so the execution
    // evidence this intent later produces is never stamped causally before the
    // disruption it answers. A caller instant already past the horizon is kept.
    const at = liftToHorizon(
      input.at,
      await signalHorizon(this.deps.signals, recoveryCase.triggeredBySignalIds),
    );
    // Mixed funding (ADR-037): the authoritative CostAllocation is computed
    // HERE, where the strategy's real priceDelta is known — never at request
    // time, where no cost exists. Deterministic window rules + the cost
    // anchor decide the payer; absent evidence the allocation stays UNKNOWN.
    const costAllocation = await this.costAllocationFor(
      input.snapshot,
      recoveryCase.triggeredBySignalIds,
      input.strategy,
    );
    const intent = buildActionIntent({
      id: this.nextIntentId(input.caseId, input.strategy.id, recoveryCase.actionIntents.map((i) => i.id)),
      caseId: input.caseId,
      strategy: input.strategy,
      at,
      ...(costAllocation ? { costAllocation } : {}),
    });
    const context: AuthorityContext = {
      tripId: input.snapshot.tripId,
      caseId: input.caseId,
      ruleSetIds: input.snapshot.trip.governedByRuleSetIds,
      principals: principalsForSnapshot(input.snapshot),
    };
    const decision = await this.deps.authority.decide(intent, context);

    await this.caseService.record(input.caseId, at, {
      actionIntents: [...recoveryCase.actionIntents, intent],
      authorityDecisions: [...recoveryCase.authorityDecisions, decision],
    });

    const target: CaseStatus =
      decision.outcome === 'AUTO_APPROVED'
        ? 'READY_TO_EXECUTE'
        : decision.outcome === 'REQUIRES_TRAVELLER'
          ? 'AWAITING_TRAVELLER'
          : decision.outcome === 'BLOCKED'
            ? 'ESCALATED'
            : 'AWAITING_APPROVAL';
    const updated = await this.moveCase(input.caseId, target, at);

    await this.deps.audit.append({
      occurredAt: at,
      actor: 'app:recovery-execution',
      action: 'AUTHORITY_DECIDED',
      subject: input.snapshot.tripId,
      payload: {
        caseId: input.caseId,
        intentId: intent.id,
        strategyId: input.strategy.id,
        operation: intent.operation,
        outcome: decision.outcome,
        ruleTrace: decision.ruleTrace,
        // Mixed-funding evidence (ADR-037): the deterministic allocation of
        // the intent's priceDelta, when one was derivable from FUNDED_WINDOW
        // rules + a cost anchor. Absence means allocation is UNKNOWN.
        ...(costAllocation ? { costAllocation } : {}),
      },
    });

    return { intent, decision, caseStatus: updated.status, executable: decision.outcome === 'AUTO_APPROVED' };
  }

  /**
   * Record a traveller/organisation approval decision through the same
   * generalized authority system. Approvals attach to the deterministic
   * AuthorityDecision; the execution gate remains the only proof an executor
   * accepts. Declined approvals loop the case back to planning.
   */
  async recordApproval(input: ApprovalInput): Promise<ApprovalStageOutcome> {
    const recoveryCase = await this.mustGet(input.caseId);
    const intent = recoveryCase.actionIntents.find((candidate) => candidate.id === input.intentId);
    const decision = recoveryCase.authorityDecisions.find((candidate) => candidate.intentId === input.intentId);
    if (!intent || !decision) {
      throw new Error(`case ${input.caseId} has no intent/authority pair for ${input.intentId}`);
    }
    const allowedTypes = APPROVER_ENTITY_TYPES[decision.outcome];
    if (!allowedTypes || !allowedTypes.includes(input.decidedBy.entityType)) {
      const reason = `principal type ${input.decidedBy.entityType} cannot approve outcome ${decision.outcome}`;
      await this.deps.audit.append({
        occurredAt: input.decidedAt,
        actor: 'app:recovery-execution',
        action: 'APPROVAL_REJECTED',
        subject: recoveryCase.tripId,
        payload: { caseId: input.caseId, intentId: input.intentId, reason },
      });
      return { accepted: false, decision, caseStatus: recoveryCase.status, reason };
    }

    // WP-C4: approval is type-checked AND identity-checked. The approving
    // principal must actually belong to this trip's principal scope — generic
    // ref resolution from authoritative state, no scenario knowledge. An id
    // that does not exist in the store (or has no relationship to the trip)
    // is refused as an audited APPROVAL_REJECTED, never a throw.
    const scope = await principalScopeForTrip(
      { trips: this.deps.trips, entities: this.deps.entities },
      recoveryCase.tripId,
    );
    const scopeRefIds = new Set<string>([
      ...scope.travellers.map((traveller) => `TRAVELLER:${traveller.id}`),
      ...scope.organisations.map((organisation) => `ORGANISATION:${organisation.id}`),
    ]);
    if (!scopeRefIds.has(`${input.decidedBy.entityType}:${input.decidedBy.id}`)) {
      const reason =
        `principal ${input.decidedBy.entityType}:${input.decidedBy.id} is not in the principal scope ` +
        `of trip ${recoveryCase.tripId}`;
      await this.deps.audit.append({
        occurredAt: input.decidedAt,
        actor: 'app:recovery-execution',
        action: 'APPROVAL_REJECTED',
        subject: recoveryCase.tripId,
        payload: { caseId: input.caseId, intentId: input.intentId, reason },
      });
      return { accepted: false, decision, caseStatus: recoveryCase.status, reason };
    }

    const approved = withApproval(decision, input.decidedBy, input.decidedAt, input.verdict, input.note);
    const decisions = recoveryCase.authorityDecisions.map((candidate) =>
      candidate.intentId === input.intentId ? approved : candidate,
    );

    if (input.verdict === 'DECLINED') {
      const intents = recoveryCase.actionIntents.map((candidate) =>
        candidate.id === input.intentId ? { ...candidate, status: 'REJECTED' as const } : candidate,
      );
      const updated = await this.moveCase(input.caseId, 'PLANNING', input.decidedAt, {
        authorityDecisions: decisions,
        actionIntents: intents,
      });
      await this.deps.audit.append({
        occurredAt: input.decidedAt,
        actor: 'app:recovery-execution',
        action: 'APPROVAL_RECORDED',
        subject: recoveryCase.tripId,
        payload: { caseId: input.caseId, intentId: input.intentId, verdict: 'DECLINED' },
      });
      return { accepted: true, decision: approved, caseStatus: updated.status };
    }

    const updated = await this.moveCase(input.caseId, 'READY_TO_EXECUTE', input.decidedAt, {
      authorityDecisions: decisions,
    });
    await this.deps.audit.append({
      occurredAt: input.decidedAt,
      actor: 'app:recovery-execution',
      action: 'APPROVAL_RECORDED',
      subject: recoveryCase.tripId,
      payload: { caseId: input.caseId, intentId: input.intentId, verdict: 'APPROVED', decidedBy: input.decidedBy.id },
    });
    return { accepted: true, decision: approved, caseStatus: updated.status };
  }

  /**
   * Execute the approved (or auto-approved) intent. The authority gate is
   * checked BEFORE any executor call: a rejected/forged envelope produces no
   * provider interaction at all.
   */
  async executeApproved(input: { caseId: EntityId; intentId: EntityId; at: IsoDateTime }): Promise<ExecutionStageOutcome> {
    const recoveryCase = await this.mustGet(input.caseId);
    const intent = recoveryCase.actionIntents.find((candidate) => candidate.id === input.intentId);
    const decision = recoveryCase.authorityDecisions.find((candidate) => candidate.intentId === input.intentId);
    if (!intent || !decision) {
      throw new Error(`case ${input.caseId} has no intent/authority pair for ${input.intentId}`);
    }
    // Timeline coherence (DR-1.1): verification/case-transition instants are
    // lifted to the causal horizon exactly like the intent's own instant.
    const at = liftToHorizon(
      input.at,
      await signalHorizon(this.deps.signals, recoveryCase.triggeredBySignalIds),
    );
    return this.executeEnvelope({ intent, authority: decision }, recoveryCase.tripId, at);
  }

  /** Execute an explicit envelope; the deterministic gate is the only entry proof. */
  async executeEnvelope(
    execution: AuthorisedExecution,
    tripId: EntityId,
    at: IsoDateTime,
  ): Promise<ExecutionStageOutcome> {
    const gateIssues = executionGateIssues(execution);
    if (gateIssues.length > 0) {
      await this.deps.audit.append({
        occurredAt: at,
        actor: 'app:recovery-execution',
        action: 'EXECUTION_REFUSED',
        subject: tripId,
        payload: { intentId: execution.intent.id, issues: gateIssues },
      });
      const recoveryCase = await this.mustGet(execution.intent.caseId);
      return {
        executed: false,
        gateIssues,
        intent: execution.intent,
        decision: execution.authority,
        caseStatus: recoveryCase.status,
      };
    }

    const caseId = execution.intent.caseId;
    await this.moveCase(caseId, 'EXECUTING', at);
    const result = await this.deps.executor.execute(execution);

    const intentsAfter = await this.replaceIntent(caseId, at, execution.intent.id, {
      status: result.status === 'SUCCESS' ? 'EXECUTED' : 'FAILED',
    });
    await this.caseService.record(caseId, at, { executionResults: [...intentsAfter.executionResults, result] });
    await this.deps.audit.append({
      occurredAt: at,
      actor: 'app:recovery-execution',
      action: 'EXECUTION_COMPLETED',
      subject: tripId,
      payload: {
        caseId,
        intentId: execution.intent.id,
        status: result.status,
        provenance: result.provenance,
        simulated: result.provenance === 'SIMULATED',
      },
    });

    // Execution evidence enters verification; success alone never resolves.
    const verifying = await this.moveCase(caseId, 'VERIFYING', at);
    const observation = await this.deps.observation.observe(result);

    if (!observation.stateUpdated) {
      const target = observation.suggestedCaseStatus ?? 'ASSESSING';
      const finalCase = await this.moveCase(caseId, target, at, {}, verifying);
      return {
        executed: true,
        gateIssues: [],
        intent: execution.intent,
        decision: execution.authority,
        result,
        observation,
        caseStatus: finalCase.status,
      };
    }

    const verification = await this.deps.verifier.verify(tripId, at);
    await this.deps.audit.append({
      occurredAt: at,
      actor: 'app:recovery-execution',
      action: 'CASE_VERIFIED',
      subject: tripId,
      payload: {
        caseId,
        suggestedCaseStatus: verification.suggestedCaseStatus,
        outcome: verification.resolution?.outcome,
        hardFailureIds: verification.hardFailureIds,
        hardUnknownIds: verification.hardUnknownIds,
      },
    });

    if (verification.suggestedCaseStatus === 'RESOLVED' && verification.resolution) {
      const resolved = await this.moveCase(caseId, 'RESOLVED', at, { resolution: verification.resolution }, verifying);
      return {
        executed: true,
        gateIssues: [],
        intent: execution.intent,
        decision: execution.authority,
        result,
        observation,
        verification,
        caseStatus: resolved.status,
      };
    }

    const finalCase = await this.moveCase(caseId, verification.suggestedCaseStatus, at, {}, verifying);
    return {
      executed: true,
      gateIssues: [],
      intent: execution.intent,
      decision: execution.authority,
      result,
      observation,
      verification,
      caseStatus: finalCase.status,
    };
  }

  // -------------------------------------------------------------------------

  /**
   * Authoritative mixed-funding allocation for a strategy (ADR-037).
   * Computed ONLY here, where the strategy's real priceDelta is known:
   * deterministic FUNDED_WINDOW rules + a derived cost anchor decide the
   * payer. Absent a governing rule, a cost amount, or an anchor, the
   * allocation stays undefined — the UNKNOWN state, never a guess.
   */
  private async costAllocationFor(
    snapshot: TripSnapshot,
    triggeredBySignalIds: EntityId[],
    strategy: RecoveryStrategy,
  ): Promise<ActionIntent['costAllocation'] | undefined> {
    if (!strategy.costImpact) return undefined;
    // Deterministic rule order (REV-2 WP-R5 discipline): FUNDED_WINDOW rules
    // from rule sets sorted by id, same as the change-request rule walk.
    const rules = snapshot.ruleSets
      .filter((ruleSet) => snapshot.trip.governedByRuleSetIds.includes(ruleSet.id))
      .flatMap((ruleSet) => ruleSet.rules)
      .filter((rule) => rule.kind === 'FUNDED_WINDOW');
    if (rules.length === 0) return undefined;
    const anchor = await this.fundingAnchorFor(triggeredBySignalIds, strategy);
    const decision = payerDecisionFor(rules, anchor);
    if (!decision) return undefined;
    return allocationFromDecision(strategy.costImpact, decision);
  }

  /**
   * When the strategy's cost accrues. Evidence order:
   * 1. the new travel date named by the strategy's own candidate operations
   *    (a flight change's cost accrues on its new departure date) — the
   *    PER-INTENT anchor, so a two-dimension change allocates each intent
   *    against its own accrual date;
   * 2. an explicit anchor carried by a triggering signal (change requests
   *    persist the target's temporal anchor as the request-level fallback);
   * 3. nothing derivable — undefined, which keeps allocation UNKNOWN.
   */
  private async fundingAnchorFor(
    triggeredBySignalIds: EntityId[],
    strategy: RecoveryStrategy,
  ): Promise<IsoDateTime | undefined> {
    for (const operation of strategy.candidateOperations) {
      if (operation.op !== 'UPSERT_ENTITY' || operation.entityType !== 'TRIP_ELEMENT') continue;
      const element = operation.data as Record<string, unknown>;
      if (element['elementKind'] !== 'TRANSPORT_LEG') continue;
      const data = element['data'];
      if (!data || typeof data !== 'object') continue;
      const departure = (data as Record<string, unknown>)['scheduledDeparture'] as { value?: unknown } | undefined;
      if (
        departure &&
        typeof departure.value === 'string' &&
        IsoDateTimeSchema.safeParse(departure.value).success
      ) {
        return departure.value;
      }
    }
    if (this.deps.signals) {
      for (const signalId of triggeredBySignalIds) {
        const signal = await this.deps.signals.getSignal(signalId);
        const raw = (signal?.payload as Record<string, unknown> | undefined)?.['fundingCostAccruesAt'];
        if (typeof raw === 'string' && IsoDateTimeSchema.safeParse(raw).success) return raw;
      }
    }
    return undefined;
  }

  private async mustGet(caseId: EntityId) {
    const recoveryCase = await this.deps.cases.getCase(caseId);
    if (!recoveryCase) throw new Error(`unknown recovery case ${caseId}`);
    return recoveryCase;
  }

  /** Transition only when legal and actually a change; otherwise no-op. */
  private async moveCase(
    caseId: EntityId,
    to: CaseStatus,
    at: IsoDateTime,
    patch: Parameters<CaseService['transition']>[3] = {},
    current?: Awaited<ReturnType<typeof this.mustGet>>,
  ) {
    const recoveryCase = current ?? (await this.mustGet(caseId));
    if (recoveryCase.status === to) return recoveryCase;
    if (!isLegalCaseTransition(recoveryCase.status, to)) {
      throw new Error(`cannot move case ${caseId} from ${recoveryCase.status} to ${to}`);
    }
    return this.caseService.transition(caseId, to, at, patch);
  }

  private async replaceIntent(
    caseId: EntityId,
    at: IsoDateTime,
    intentId: EntityId,
    changes: Partial<Pick<ActionIntent, 'status'>>,
  ) {
    const recoveryCase = await this.mustGet(caseId);
    const actionIntents = recoveryCase.actionIntents.map((candidate) =>
      candidate.id === intentId ? { ...candidate, ...changes } : candidate,
    );
    return this.caseService.record(caseId, at, { actionIntents });
  }

  private nextIntentId(caseId: EntityId, strategyId: EntityId, existing: EntityId[]): EntityId {
    const base = `intent-${caseId}-${strategyId}`;
    if (!existing.includes(base)) return base;
    let suffix = 2;
    while (existing.includes(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }
}

// ---------------------------------------------------------------------------
// Traveller decision entry point (I5 traveller interaction)
// ---------------------------------------------------------------------------

export interface TravellerDecisionInput {
  caseId: EntityId;
  verdict: 'APPROVED' | 'DECLINED';
  at: IsoDateTime;
  note?: string;
}

export interface TravellerDecisionOutcome {
  accepted: boolean;
  error?: 'unknown_case' | 'no_pending_traveller_decision' | 'unknown_trip';
  verdict?: 'APPROVED' | 'DECLINED';
  caseStatus?: CaseStatus;
  execution?: ExecutionStageOutcome;
}

/**
 * Settle a pending traveller approval through the real lifecycle: approval
 * proceeds to gate-checked execution and observation; decline loops the case
 * back to planning. The traveller principal is derived from the case's trip —
 * no caller-supplied authority is ever trusted.
 */
export async function settleTravellerDecision(
  deps: { service: RecoveryExecutionService; cases: CaseRepository; trips: TripRepository },
  input: TravellerDecisionInput,
): Promise<TravellerDecisionOutcome> {
  const recoveryCase = await deps.cases.getCase(input.caseId);
  if (!recoveryCase) return { accepted: false, error: 'unknown_case' };
  const pending = recoveryCase.authorityDecisions.find(
    (decision) => decision.outcome === 'REQUIRES_TRAVELLER' && decision.approval === undefined,
  );
  if (!pending) {
    return { accepted: false, error: 'no_pending_traveller_decision', caseStatus: recoveryCase.status };
  }
  const trip = await deps.trips.getTrip(recoveryCase.tripId);
  const travellerId = trip?.travellerIds[0];
  if (!trip || !travellerId) return { accepted: false, error: 'unknown_trip' };

  const approval = await deps.service.recordApproval({
    caseId: input.caseId,
    intentId: pending.intentId,
    decidedBy: { entityType: 'TRAVELLER', id: travellerId },
    decidedAt: input.at,
    verdict: input.verdict,
    ...(input.note ? { note: input.note } : {}),
  });
  if (input.verdict === 'DECLINED') {
    return { accepted: true, verdict: 'DECLINED', caseStatus: approval.caseStatus };
  }
  const execution = await deps.service.executeApproved({
    caseId: input.caseId,
    intentId: pending.intentId,
    at: input.at,
  });
  return { accepted: true, verdict: 'APPROVED', caseStatus: execution.caseStatus, execution };
}
