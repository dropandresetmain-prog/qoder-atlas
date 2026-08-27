/**
 * A4 — RecoveryCase lifecycle service (FR-11, ARCHITECTURE.md §15).
 *
 * Every status change goes through the frozen CASE_TRANSITIONS guard;
 * illegal transitions throw instead of silently applying. Timestamps come
 * from callers (signal/event instants), never from a wall clock, so the
 * lifecycle stays deterministic and replayable.
 */
import type { EntityId, IsoDateTime } from '../domain/common.ts';
import {
  isLegalCaseTransition,
  type CaseKind,
  type CaseStatus,
  type RecoveryCase,
  type CaseResolution,
} from '../operational/case.ts';
import type { CaseRepository } from '../contracts/repositories.ts';
import type { ActionIntent, AuthorityDecision, ExecutionResult } from '../operational/intent.ts';
import type { RecoveryStrategy } from '../operational/strategy.ts';

export class IllegalCaseTransitionError extends Error {
  constructor(caseId: EntityId, from: CaseStatus, to: CaseStatus) {
    super(`illegal case transition for ${caseId}: ${from} -> ${to}`);
    this.name = 'IllegalCaseTransitionError';
  }
}

export interface CasePatch {
  strategies?: RecoveryStrategy[];
  authorityDecisions?: AuthorityDecision[];
  actionIntents?: ActionIntent[];
  executionResults?: ExecutionResult[];
  affectedElementIds?: EntityId[];
  failedConstraintIds?: EntityId[];
  resolution?: CaseResolution;
}

export interface OpenCaseInput {
  id: EntityId;
  tripId: EntityId;
  openedAt: IsoDateTime;
  /** Classification evidence only; behaviour stays engine-generic (ADR-038). */
  caseKind?: CaseKind;
  triggeredBySignalIds?: EntityId[];
  affectedElementIds?: EntityId[];
  failedConstraintIds?: EntityId[];
}

export class CaseService {
  private readonly cases: CaseRepository;

  constructor(deps: { cases: CaseRepository }) {
    this.cases = deps.cases;
  }

  async open(input: OpenCaseInput): Promise<RecoveryCase> {
    const recoveryCase: RecoveryCase = {
      id: input.id,
      tripId: input.tripId,
      caseKind: input.caseKind ?? 'RECOVERY',
      status: 'DETECTED',
      openedAt: input.openedAt,
      updatedAt: input.openedAt,
      triggeredBySignalIds: input.triggeredBySignalIds ?? [],
      affectedElementIds: input.affectedElementIds ?? [],
      failedConstraintIds: input.failedConstraintIds ?? [],
      strategies: [],
      authorityDecisions: [],
      actionIntents: [],
      executionResults: [],
      version: 0,
    };
    await this.cases.saveCase(recoveryCase);
    return recoveryCase;
  }

  /**
   * Move the case to `to`, enforcing the frozen transition table. `patch`
   * appends/replaces lifecycle evidence atomically with the transition.
   */
  async transition(caseId: EntityId, to: CaseStatus, at: IsoDateTime, patch: CasePatch = {}): Promise<RecoveryCase> {
    const recoveryCase = await this.mustGet(caseId);
    if (!isLegalCaseTransition(recoveryCase.status, to)) {
      throw new IllegalCaseTransitionError(caseId, recoveryCase.status, to);
    }
    if (to === 'RESOLVED' && !patch.resolution && !recoveryCase.resolution) {
      throw new Error(`case ${caseId} cannot resolve without a CaseResolution`);
    }
    const updated: RecoveryCase = {
      ...recoveryCase,
      ...patch,
      status: to,
      updatedAt: at,
      version: recoveryCase.version + 1,
    };
    await this.cases.saveCase(updated);
    return updated;
  }

  /**
   * Close a case whose trip is now viable without executing a staged recovery
   * (authorised programme mutation, or equivalent re-evaluation). Walks only
   * legal transitions; EXECUTING still observes via VERIFYING first.
   */
  async resolveWhenViable(caseId: EntityId, at: IsoDateTime, resolution: CaseResolution): Promise<RecoveryCase> {
    let recoveryCase = await this.mustGet(caseId);
    if (recoveryCase.status === 'RESOLVED') {
      return recoveryCase.resolution ? recoveryCase : this.record(caseId, at, { resolution });
    }
    if (recoveryCase.status === 'DETECTED') {
      recoveryCase = await this.transition(caseId, 'ASSESSING', at);
    }
    if (recoveryCase.status === 'EXECUTING') {
      recoveryCase = await this.transition(caseId, 'VERIFYING', at);
    }
    return this.transition(caseId, 'RESOLVED', at, { resolution });
  }

  /** Record lifecycle evidence without changing status. */
  async record(caseId: EntityId, at: IsoDateTime, patch: CasePatch): Promise<RecoveryCase> {
    const recoveryCase = await this.mustGet(caseId);
    const updated: RecoveryCase = {
      ...recoveryCase,
      ...patch,
      updatedAt: at,
      version: recoveryCase.version + 1,
    };
    await this.cases.saveCase(updated);
    return updated;
  }

  async get(caseId: EntityId): Promise<RecoveryCase | undefined> {
    return this.cases.getCase(caseId);
  }

  private async mustGet(caseId: EntityId): Promise<RecoveryCase> {
    const recoveryCase = await this.cases.getCase(caseId);
    if (!recoveryCase) throw new Error(`unknown recovery case ${caseId}`);
    return recoveryCase;
  }
}
