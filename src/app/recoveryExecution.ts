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
import type { AuditRepository, CaseRepository } from '../contracts/repositories.ts';
import { CaseService } from '../engine/case.ts';
import { withApproval } from '../engine/authority.ts';
import type { CaseVerifier, VerificationResult } from '../engine/observation.ts';

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
 */
export function consequentialOperationFor(operations: MutationOperation[]): ConsequentialOperation {
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
      return { operation: 'hotel.modify', capability: 'HOTEL', sideEffectLevel: 'REVERSIBLE' };
    }
  }
  return { operation: 'simulation.provider_action', capability: 'SIMULATION', sideEffectLevel: 'REVERSIBLE' };
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
 */
export function confirmedOperationsFor(
  operations: MutationOperation[],
  confirmedAt: IsoDateTime,
): MutationOperation[] {
  const confirmed: MutationOperation[] = [];
  for (const operation of operations) {
    if (operation.op !== 'UPSERT_ENTITY' || operation.entityType !== 'TRIP_ELEMENT') continue;
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
  strategyFor: (intent: ActionIntent) => RecoveryStrategy | undefined;
}): ExecutorService {
  return {
    execute: async (execution: AuthorisedExecution): Promise<ExecutionResult> => {
      const result = await deps.inner.execute(execution);
      if (result.status !== 'SUCCESS') return result;
      const strategy = deps.strategyFor(execution.intent);
      if (!strategy) return result;
      const operations = confirmedOperationsFor(strategy.candidateOperations, result.executedAt);
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
    const intent = buildActionIntent({
      id: this.nextIntentId(input.caseId, input.strategy.id, recoveryCase.actionIntents.map((i) => i.id)),
      caseId: input.caseId,
      strategy: input.strategy,
      at: input.at,
    });
    const context: AuthorityContext = {
      tripId: input.snapshot.tripId,
      caseId: input.caseId,
      ruleSetIds: input.snapshot.trip.governedByRuleSetIds,
      principals: principalsForSnapshot(input.snapshot),
    };
    const decision = await this.deps.authority.decide(intent, context);

    await this.caseService.record(input.caseId, input.at, {
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
    const updated = await this.moveCase(input.caseId, target, input.at);

    await this.deps.audit.append({
      occurredAt: input.at,
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
    return this.executeEnvelope({ intent, authority: decision }, recoveryCase.tripId, input.at);
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

    const verification = await this.deps.verifier.verify(tripId);
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
