/**
 * M9 application commands — typed operations over the target PostgreSQL runtime.
 *
 * Forbidden shortcuts (never implement):
 * setSarahDisrupted, setTravellerRecovered, approveWithoutAuthority,
 * mutateProgrammeForDemo, markCaseResolved, direct state-setting UI APIs.
 */
import { randomUUID, createHash } from 'node:crypto';
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import { openRecoveryCase, persistActionPlan } from '../../persistence/postgres/commands/m8AuthorityCommands.ts';
import { persistRecoveryStrategy } from '../../persistence/postgres/commands/m7StrategyCommands.ts';
import { resolveRecoveryCase } from '../../persistence/postgres/commands/m9CaseResolutionCommands.ts';
import { recordTransportObservation } from '../../persistence/postgres/commands/arrangementCommands.ts';
import { recordChangeSignal, completeChangeSignal } from '../../persistence/postgres/commands/changeSignalCommands.ts';
import { canonicalPayloadHash } from '../../persistence/postgres/canonicalHash.ts';
import { evaluateRecoveryCaseResolution } from './recoveryCaseResolution.ts';
import { denyDirectObjectiveDisposition, M9_OBJECTIVE_DISPOSITION_API_EXPOSED } from './objectiveDispositionBoundary.ts';
import { issueRequiredAuthorityGrant } from './grantIssuance.ts';
import {
  previewBilateralProgrammeTimeSwap,
  previewAuthoritativeBilateralProgrammeTimeSwap,
  type AuthoritativeProgrammeSwapPreviewInput,
  type AuthoritativeProgrammeSwapPreviewOutcome,
  type BilateralProgrammeTimeSwapInput,
  type BilateralProgrammeTimeSwapPreview,
} from './programmeTimeSwapPreview.ts';
import type { RecoveryStrategy } from '../../contracts/v2/scenario/recoveryStrategy.ts';
import type { ActionPlan } from '../../contracts/v2/action/actionPlan.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import type { ApplicationError } from '../../contracts/v2/product/readModels.ts';
import { ApplicationErrorSchema } from '../../contracts/v2/product/readModels.ts';

export function applicationError(code: ApplicationError['code'], message: string): ApplicationError {
  return ApplicationErrorSchema.parse({ code, message, mutatesState: false });
}

// Deterministic UUIDv5 minting for the ChangeSignal id below — same
// construction as providerDisruptionIngress.ts's IdentityMinter (a fixed
// namespace, sha1 over namespace+name, RFC 4122 version/variant bits), kept
// local here since this event kind is minted from a different key shape
// (`${workspaceId}|change-signal|${providerId}|${providerEventId}`, no
// per-workspace dataset scoping).
const CHANGE_SIGNAL_NAMESPACE = '6f6a1d4c-1b2e-4d3a-9c7f-2a5b8e0d4c11';

function uuidV5(namespace: string, name: string): string {
  const hash = createHash('sha1')
    .update(Buffer.from(namespace.replace(/-/g, ''), 'hex'))
    .update(Buffer.from(name, 'utf8'))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface TargetCommandContext {
  workspaceId: string;
  actorPrincipalId: string;
  uow: () => PgUnitOfWork;
  pool: Pool;
}

/** Open a recovery case through the real command — never seed a resolved case. */
export async function commandOpenRecoveryCase(
  ctx: TargetCommandContext,
  input: { caseId?: string; openedAt: string; idempotencyKey?: string },
) {
  return openRecoveryCase(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    caseId: input.caseId,
    openedAt: input.openedAt,
  });
}

/** Persist an evaluated strategy (planning evidence) through the real command. */
export async function commandPersistStrategy(
  ctx: TargetCommandContext,
  input: { strategy: RecoveryStrategy; idempotencyKey?: string },
) {
  return persistRecoveryStrategy(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    strategy: input.strategy,
  });
}

/** Persist a compiled ActionPlan (M7→M8 seam). */
export async function commandPersistPlan(
  ctx: TargetCommandContext,
  input: { plan: ActionPlan; recoveryStrategyId?: string; idempotencyKey?: string },
) {
  return persistActionPlan(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    plan: input.plan,
    recoveryStrategyId: input.recoveryStrategyId,
  });
}

/** Issue a grant that covers deterministic required scopes. */
export async function commandIssueRequiredGrant(
  ctx: TargetCommandContext,
  input: {
    principalId: string;
    representedPartyRef: TypedRef;
    issuedByPrincipalId: string;
    issuedAt: string;
    actions: string[];
    proposedScopes: TypedRef[];
    requiredScopes: TypedRef[];
    idempotencyKey?: string;
  },
) {
  return issueRequiredAuthorityGrant(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    ...input,
  });
}

/** Evaluate resolution without mutating. */
export async function commandEvaluateResolution(
  ctx: TargetCommandContext,
  input: { recoveryCaseId: string; now: string; requiredAffectedPeople?: TypedRef[] },
) {
  return evaluateRecoveryCaseResolution(ctx.pool, {
    workspaceId: ctx.workspaceId,
    ...input,
  });
}

/** Resolve only through the deterministic gate. */
export async function commandResolveCase(
  ctx: TargetCommandContext,
  input: { recoveryCaseId: string; now: string; requiredAffectedPeople?: TypedRef[]; idempotencyKey?: string },
) {
  return resolveRecoveryCase(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
    recoveryCaseId: input.recoveryCaseId,
    now: input.now,
    requiredAffectedPeople: input.requiredAffectedPeople,
  });
}

/**
 * Provider-shaped demo event ingress (M9 1A).
 *
 * Presenter may say "Simulate supplier update" — this never edits
 * case/trip/journey status directly. The disclosed payload is normalised
 * into a real canonical PostgreSQL mutation through the accepted M3/M5
 * `recordTransportObservation` command (TRANSPORT_SERVICE_OBSERVED), which:
 *  - advances the TRANSPORT_SERVICE aggregate revision (staleness-guarded —
 *    an older/equal observedAt is a no-op 'STALE', never a silent overwrite);
 *  - lets the accepted M6 invalidation mechanism durably enqueue
 *    reassessment for every Journey reached through registered dependency
 *    semantics (no direct traveller/case mutation, no manual blast-radius
 *    walk here).
 * A caller separately runs the reassessment worker / evaluateImpact to
 * produce the resulting assessments; this command's job stops at "signal
 * accepted and normalised into canonical state".
 */
export interface TransportScheduleObservedEvent {
  kind?: 'TRANSPORT_SCHEDULE_OBSERVED';
  providerId: string;
  providerEventId: string;
  receivedAt: string;
  /**
   * Disclosed provider-shaped payload. Only a TRANSPORT_SERVICE schedule
   * observation is supported today (Sarah/Jordan's shared-supplier and
   * progressive-delay disruptions are both transport service facts) — no
   * scenario-named branching; the shape is generic across every scenario.
   */
  payload: {
    subjectKind: 'TRANSPORT_SERVICE';
    subjectId: string;
    expectedRevision: number;
    field: 'PUBLISHED' | 'ESTIMATED' | 'ACTUAL';
    departure?: string;
    arrival?: string;
    evidenceId: string;
  };
  disclosedAsSimulatedDemoInput: true;
}

export interface TransportServiceCancelledWithReprotectionEvent {
  kind: 'TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION';
  providerId: string;
  providerEventId: string;
  receivedAt: string;
  disclosedAsSimulatedDemoInput: true;
  originalService: {
    recordType: 'SOURCE_TRANSPORT_SERVICE';
    externalId: string;
  };
  replacementService: {
    recordType: 'SOURCE_TRANSPORT_SERVICE';
    externalId: string;
    operator: string;
    scheduledDeparture: string;
    scheduledArrival: string;
  };
  affectedBookings: Array<{
    recordType: 'SOURCE_BOOKING_REFERENCE';
    externalId: string;
  }>;
  reason: string;
  provenanceKind: string;
}

export type ProviderShapedDemoEvent =
  | TransportScheduleObservedEvent
  | TransportServiceCancelledWithReprotectionEvent;

export type DemoIngressResult =
  | {
      ok: true;
      accepted: true;
      next: 'NORMALISE_AND_PROCESS_SIGNAL';
      subjectRef: TypedRef;
      mutationStatus: 'APPLIED' | 'STALE';
      revision: number;
      changeSignalId: string;
    }
  | { ok: false; error: ApplicationError };

export async function acceptProviderShapedDemoEvent(
  ctx: TargetCommandContext,
  event: TransportScheduleObservedEvent,
): Promise<DemoIngressResult> {
  if (!event.disclosedAsSimulatedDemoInput) {
    return {
      ok: false,
      error: applicationError('PROVIDER_INFO_UNAVAILABLE', 'demo ingress requires disclosed simulated demo input'),
    };
  }
  if (!event.providerId || !event.providerEventId) {
    return {
      ok: false,
      error: applicationError('PROVIDER_INFO_UNAVAILABLE', 'provider event identity required'),
    };
  }
  const payload = event.payload;
  if (!payload || payload.subjectKind !== 'TRANSPORT_SERVICE' || !payload.subjectId) {
    return {
      ok: false,
      error: applicationError('PROVIDER_INFO_UNAVAILABLE', 'provider event payload must identify a TRANSPORT_SERVICE subject'),
    };
  }
  if (!payload.departure && !payload.arrival) {
    return {
      ok: false,
      error: applicationError('PROVIDER_INFO_UNAVAILABLE', 'provider event must carry a departure or arrival observation'),
    };
  }

  // ChangeSignal (migration 0124): register once per provider event
  // identity, run the consequential mutation under it, complete it last.
  // "Has this provider event been applied" is application bookkeeping — it
  // lives on the ChangeSignal spine, never as ad-hoc world state. Registering
  // unconditionally on every call is safe: recordChangeSignal is idempotent
  // by origin (same key + same hash replays); the existing replay behaviour
  // of recordTransportObservation below already makes duplicate delivery
  // safe, so no ALREADY_APPLIED short-circuit is added here.
  const changeSignalId = uuidV5(
    CHANGE_SIGNAL_NAMESPACE,
    `${ctx.workspaceId}|change-signal|${event.providerId}|${event.providerEventId}`,
  );
  const contentHash = canonicalPayloadHash(payload);

  const evidenceCheck = await ctx.pool.query<{ id: string }>(
    'SELECT id FROM evidence_records WHERE workspace_id = $1 AND id = $2',
    [ctx.workspaceId, payload.evidenceId],
  );
  const evidenceIdForSignal = evidenceCheck.rows.length > 0 ? payload.evidenceId : undefined;

  const subjectCheck = await ctx.pool.query<{ id: string }>(
    `SELECT id FROM domain_subjects WHERE workspace_id = $1 AND id = $2 AND kind = 'TRANSPORT_SERVICE'`,
    [ctx.workspaceId, payload.subjectId],
  );
  const signalSubjects: Array<{ kind: 'TRANSPORT_SERVICE'; id: string; role: string }> =
    subjectCheck.rows.length > 0 ? [{ kind: 'TRANSPORT_SERVICE', id: payload.subjectId, role: 'OBSERVED_SERVICE' }] : [];

  const signalResult = await recordChangeSignal(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: `demo-ingress:${event.providerId}:${event.providerEventId}:change-signal`,
    changeSignalId,
    originKind: 'PROVIDER_EVENT',
    originKey: `${event.providerId}:${event.providerEventId}`,
    changeType: 'TRANSPORT_SCHEDULE_OBSERVED',
    contentHash,
    receivedAt: event.receivedAt,
    ...(evidenceIdForSignal ? { evidenceId: evidenceIdForSignal } : {}),
    subjects: signalSubjects,
  });
  if (!signalResult.ok) {
    return {
      ok: false,
      error: applicationError(
        'PROVIDER_INFO_UNAVAILABLE',
        `${signalResult.conflict.kind}: ${signalResult.conflict.message}`,
      ),
    };
  }

  // Real canonical mutation — never a direct traveller/case status write.
  const outcome = await recordTransportObservation(ctx.uow().underChangeSignal(changeSignalId), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: `demo-ingress:${event.providerId}:${event.providerEventId}`,
    serviceId: payload.subjectId,
    expectedRevision: payload.expectedRevision,
    observation: {
      field: payload.field,
      ...(payload.departure ? { departure: payload.departure } : {}),
      ...(payload.arrival ? { arrival: payload.arrival } : {}),
      observedAt: event.receivedAt,
      evidenceId: payload.evidenceId,
    },
    evidenceRefs: [payload.evidenceId],
  });
  if (!outcome.ok) {
    return {
      ok: false,
      error: applicationError(
        'PROVIDER_INFO_UNAVAILABLE',
        `${outcome.conflict.kind}: ${outcome.conflict.message}`,
      ),
    };
  }

  const completionResult = await completeChangeSignal(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: `demo-ingress:${event.providerId}:${event.providerEventId}:completion`,
    changeSignalId,
    // Deterministic, not wall-clock: this path has no ALREADY_APPLIED
    // short-circuit (recordTransportObservation's own replay makes repeat
    // delivery safe), so completeChangeSignal runs on EVERY call, including
    // true replays, through this SAME idempotency key. A wall-clock
    // completedAt would make each call's payload hash differ, turning a
    // legitimate replay into a spurious IDEMPOTENCY_KEY_PAYLOAD_MISMATCH.
    completedAt: event.receivedAt,
  });
  if (!completionResult.ok) {
    return {
      ok: false,
      error: applicationError(
        'PROVIDER_INFO_UNAVAILABLE',
        `${completionResult.conflict.kind}: ${completionResult.conflict.message}`,
      ),
    };
  }

  return {
    ok: true,
    accepted: true,
    next: 'NORMALISE_AND_PROCESS_SIGNAL',
    subjectRef: { kind: 'TRANSPORT_SERVICE', id: outcome.value.id },
    mutationStatus: outcome.value.status,
    revision: outcome.value.revision,
    changeSignalId,
  };
}

/** Terminal objective disposition is not exposed on M9 APIs. */
export function commandDirectObjectiveDisposition(input: {
  disposition: string;
  viaAuthorisedActionIntent: boolean;
}): { ok: true } | { ok: false; error: ApplicationError } {
  if (!M9_OBJECTIVE_DISPOSITION_API_EXPOSED && !input.viaAuthorisedActionIntent) {
    const denial = denyDirectObjectiveDisposition(input);
    if (!denial.allowed) {
      return { ok: false, error: applicationError('OBJECTIVE_DISPOSITION_FORBIDDEN', denial.reason) };
    }
  }
  const denial = denyDirectObjectiveDisposition(input);
  if (!denial.allowed) {
    return { ok: false, error: applicationError('OBJECTIVE_DISPOSITION_FORBIDDEN', denial.reason) };
  }
  return { ok: true };
}

/**
 * Preview a bilateral programme time swap — never mutates authoritative state.
 * Commitment IDs are caller-supplied runtime inputs (fixture lane), never hardcoded.
 *
 * Internal/demo-loop building block only (takes an injected `evaluate`
 * callback) — NOT the HTTP-facing preview command. `targetHttpHandlers.ts`
 * must use `commandPreviewAuthoritativeBilateralProgrammeTimeSwap` below,
 * which builds the evaluator server-side from real PostgreSQL state.
 */
export function commandPreviewBilateralProgrammeTimeSwap(
  input: BilateralProgrammeTimeSwapInput,
): BilateralProgrammeTimeSwapPreview {
  return previewBilateralProgrammeTimeSwap(input);
}

/**
 * HTTP-facing preview command (M9 1B). The caller identifies the two
 * programme items only; the server loads authoritative state, builds the
 * real M7 counterfactual overlay, and invokes the real M6 evaluator. Never
 * mutates authoritative state.
 */
export async function commandPreviewAuthoritativeBilateralProgrammeTimeSwap(
  ctx: TargetCommandContext,
  input: Omit<AuthoritativeProgrammeSwapPreviewInput, 'workspaceId'>,
): Promise<AuthoritativeProgrammeSwapPreviewOutcome> {
  return previewAuthoritativeBilateralProgrammeTimeSwap(ctx.pool, {
    workspaceId: ctx.workspaceId,
    ...input,
  });
}
