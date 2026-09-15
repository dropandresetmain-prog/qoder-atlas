/**
 * M9 application commands — typed operations over the target PostgreSQL runtime.
 *
 * Forbidden shortcuts (never implement):
 * setSarahDisrupted, setTravellerRecovered, approveWithoutAuthority,
 * mutateProgrammeForDemo, markCaseResolved, direct state-setting UI APIs.
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import { openRecoveryCase, persistActionPlan } from '../../persistence/postgres/commands/m8AuthorityCommands.ts';
import { persistRecoveryStrategy } from '../../persistence/postgres/commands/m7StrategyCommands.ts';
import { resolveRecoveryCase } from '../../persistence/postgres/commands/m9CaseResolutionCommands.ts';
import { evaluateRecoveryCaseResolution } from './recoveryCaseResolution.ts';
import { denyDirectObjectiveDisposition, M9_OBJECTIVE_DISPOSITION_API_EXPOSED } from './objectiveDispositionBoundary.ts';
import { issueRequiredAuthorityGrant } from './grantIssuance.ts';
import {
  previewBilateralProgrammeTimeSwap,
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
    pool: ctx.pool,
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
 * Provider-shaped demo event ingress stub.
 * Presenter may say "Simulate supplier update" — this must never edit case/trip
 * state directly. Concrete normalisation reuses existing provider/signal paths
 * once fixtures are supplied (Checkpoint 2).
 */
export interface ProviderShapedDemoEvent {
  providerId: string;
  providerEventId: string;
  receivedAt: string;
  /** Opaque provider payload — normalised by adapter, not by UI. */
  payload: Record<string, unknown>;
  disclosedAsSimulatedDemoInput: true;
}

export type DemoIngressResult =
  | { ok: true; accepted: true; next: 'NORMALISE_AND_PROCESS_SIGNAL' }
  | { ok: false; error: ApplicationError };

export function acceptProviderShapedDemoEvent(event: ProviderShapedDemoEvent): DemoIngressResult {
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
  // Do not mutate trip/case here — hand off to normalisation/signal pipeline.
  return { ok: true, accepted: true, next: 'NORMALISE_AND_PROCESS_SIGNAL' };
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
 */
export function commandPreviewBilateralProgrammeTimeSwap(
  input: BilateralProgrammeTimeSwapInput,
): BilateralProgrammeTimeSwapPreview {
  return previewBilateralProgrammeTimeSwap(input);
}
