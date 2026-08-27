/**
 * Reconcile an already-open recovery case when a later authorised change
 * (typically programme commit fan-out) makes the same trip viable without a
 * travel execution.
 *
 * Brand-new cases on previously healthy trips are left alone: a commitment
 * change still opens an assessing case even when constraints currently pass.
 */
import type { EntityId, IsoDateTime } from '../domain/common.ts';
import type { CaseResolution, CaseStatus, RecoveryCase } from '../operational/case.ts';
import type { CaseRepository, SignalRepository, TripRepository } from '../contracts/repositories.ts';
import type { MutationService } from '../contracts/services.ts';
import type { EntityStore } from '../persistence/entityStore.ts';
import { CaseService } from '../engine/case.ts';
import { CaseVerifier } from '../engine/observation.ts';

export interface CaseReconciliationDeps {
  trips: TripRepository;
  signals: SignalRepository;
  entities: EntityStore;
  cases: CaseRepository;
  mutations: MutationService;
}

export interface CaseReconciliationResult {
  reconciled: boolean;
  caseId?: EntityId;
  caseStatus?: CaseStatus;
  resolution?: CaseResolution;
}

export async function reconcilePriorOpenCasesIfTripViable(
  deps: CaseReconciliationDeps,
  input: { tripId: EntityId; at: IsoDateTime; priorOpen: readonly RecoveryCase[] },
): Promise<CaseReconciliationResult> {
  if (input.priorOpen.length === 0) return { reconciled: false };

  const verifier = new CaseVerifier({
    trips: deps.trips,
    signals: deps.signals,
    entities: deps.entities,
    mutations: deps.mutations,
  });
  const verification = await verifier.verify(input.tripId, input.at);
  if (verification.suggestedCaseStatus !== 'RESOLVED' || !verification.resolution) {
    return { reconciled: false };
  }

  const caseService = new CaseService({ cases: deps.cases });
  let last: RecoveryCase | undefined;
  for (const open of input.priorOpen) {
    last = await caseService.resolveWhenViable(open.id, input.at, verification.resolution);
  }
  return {
    reconciled: true,
    ...(last
      ? { caseId: last.id, caseStatus: last.status, resolution: verification.resolution }
      : {}),
  };
}
