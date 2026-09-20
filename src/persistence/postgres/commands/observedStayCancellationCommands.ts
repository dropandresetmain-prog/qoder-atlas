/** Atomically reflect one confirmed provider cancellation; it never calls a provider. */
import { z } from 'zod';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import { DomainCommandEnvelopeSchema, type DomainCommandEnvelope } from '../../../contracts/v2/command/domainCommand.ts';
import { InstantSchema } from '../../../domain/v2/shared/time.ts';
import { typedConflict } from '../../../domain/v2/shared/errors.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import { advanceHead, appendAuditTrail, buildReceipt, lockedRevisionOf, type AdvancedRoot } from '../commandSupport.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';
import { currentTransactionClient } from '../transactionContext.ts';
import { recordSelectedPlanCanonicalApplication } from '../execution/selectedPlanContinuation.ts';

const Uuid = z.uuid();

export interface ObservedStayCancellationParams {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
  journeyId: string;
  expectedJourneyRevision: number;
  reservationId: string;
  expectedReservationRevision: number;
  journeyItemId: string;
  reservationLineId: string;
  observedAt: string;
  evidenceId: string;
  canonicalApplication?: {
    attemptId: string;
    actionPlanId: string;
    actionIntentId: string;
    source: { kind: 'EXTERNAL_PROVIDER'; observationId: string };
  };
}

function validateIds(params: ObservedStayCancellationParams): boolean {
  const required = [
    params.journeyId,
    params.reservationId,
    params.journeyItemId,
    params.reservationLineId,
    params.evidenceId,
  ];
  if (required.some((id) => !Uuid.safeParse(id).success)) return false;
  if (!InstantSchema.safeParse(params.observedAt).success) return false;

  const application = params.canonicalApplication;
  if (application === undefined) return true;
  // When supplied, every required bridge ID must be present and valid.
  return [
    application.attemptId,
    application.actionPlanId,
    application.actionIntentId,
    application.source.observationId,
  ].every((id) => Uuid.safeParse(id).success);
}

export async function applyObservedStayCancellation(
  uow: UnitOfWork,
  params: ObservedStayCancellationParams,
): Promise<ExecuteOutcome<{ journeyRevision: number; reservationRevision: number }>> {
  if (!validateIds(params)) {
    return {
      ok: false,
      conflict: typedConflict(
        'VALIDATION_FAILED',
        'OBSERVED_STAY_CANCELLED: ids and observedAt must be valid',
        [],
      ),
    };
  }

  const journeyRef = { kind: 'JOURNEY' as const, id: params.journeyId };
  const reservationRef = { kind: 'RESERVATION' as const, id: params.reservationId };
  const payload = { ...params };
  const envelope: DomainCommandEnvelope = DomainCommandEnvelopeSchema.parse({
    commandType: 'OBSERVED_STAY_CANCELLED',
    schemaVersion: '1',
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(payload),
    expectedAggregateRevisions: [
      { aggregateRef: journeyRef, expectedRevision: params.expectedJourneyRevision },
      { aggregateRef: reservationRef, expectedRevision: params.expectedReservationRevision },
    ],
    typedPayload: payload,
    evidenceRefs: [params.evidenceId],
  });

  try {
    return await uow.execute(envelope, async ({ lockedHeads }) => {
      const client = currentTransactionClient();
      // Canonical reservation ownership lives on reservation_allocations (not a parallel allocations table).
      const owned = (
        await client.query<{ observed_status: string; lifecycle_status: string }>(
          `SELECT rl.observed_status, ji.lifecycle_status
             FROM reservation_lines rl
             JOIN reservation_allocations ra
               ON ra.workspace_id = rl.workspace_id AND ra.line_id = rl.id
             JOIN journey_items ji
               ON ji.workspace_id = ra.workspace_id AND ji.id = ra.journey_item_id
             JOIN journeys j
               ON j.workspace_id = ji.workspace_id AND j.id = ji.journey_id
            WHERE rl.workspace_id = $1
              AND rl.id = $2
              AND rl.reservation_id = $3
              AND ji.id = $4
              AND ji.journey_id = $5
              AND ra.traveller_id = j.traveller_id
            FOR UPDATE`,
          [
            params.workspaceId,
            params.reservationLineId,
            params.reservationId,
            params.journeyItemId,
            params.journeyId,
          ],
        )
      ).rows;

      if (owned.length !== 1) {
        return {
          ok: false,
          conflict: typedConflict(
            'VALIDATION_FAILED',
            'confirmed cancellation must own exactly one stay line/item/traveller/Journey',
            [journeyRef, reservationRef],
          ),
        };
      }

      const current = owned[0]!;
      if (current.observed_status !== 'CONFIRMED' || !['PLANNED', 'ACTIVE'].includes(current.lifecycle_status)) {
        return {
          ok: false,
          conflict: typedConflict(
            'VALIDATION_FAILED',
            'cancellation needs an active confirmed supplier stay',
            [journeyRef, reservationRef],
          ),
        };
      }

      await client.query(
        `UPDATE reservation_lines
            SET observed_status = 'CANCELLED',
                observed_status_at = $3::timestamptz,
                observation_evidence_id = $4,
                updated_at = now()
          WHERE workspace_id = $1 AND id = $2`,
        [params.workspaceId, params.reservationLineId, params.observedAt, params.evidenceId],
      );
      await client.query(
        `UPDATE journey_items
            SET lifecycle_status = 'DROPPED', updated_at = now()
          WHERE workspace_id = $1 AND id = $2 AND journey_id = $3`,
        [params.workspaceId, params.journeyItemId, params.journeyId],
      );

      const advance = async (
        ref: { kind: 'JOURNEY' | 'RESERVATION'; id: string },
      ): Promise<AdvancedRoot | undefined> => {
        const before = lockedRevisionOf(lockedHeads, ref.id);
        if (before === undefined) return undefined;
        const after = await advanceHead({
          workspaceId: params.workspaceId,
          aggregateId: ref.id,
          fromRevision: before,
        });
        return after === undefined
          ? undefined
          : { aggregateRef: ref, beforeRevision: before, afterRevision: after };
      };

      const journeyAdvanced = await advance(journeyRef);
      const reservationAdvanced = await advance(reservationRef);
      if (!journeyAdvanced || !reservationAdvanced) {
        return {
          ok: false,
          conflict: typedConflict(
            'STALE_AGGREGATE_REVISION',
            'stay changed while applying provider cancellation',
            [journeyRef, reservationRef],
          ),
        };
      }

      const value = {
        journeyRevision: journeyAdvanced.afterRevision,
        reservationRevision: reservationAdvanced.afterRevision,
      };

      if (params.canonicalApplication) {
        const application = await recordSelectedPlanCanonicalApplication(client, {
          workspaceId: params.workspaceId,
          actorId: params.actorPrincipalId,
          attemptId: params.canonicalApplication.attemptId,
          actionPlanId: params.canonicalApplication.actionPlanId,
          actionIntentId: params.canonicalApplication.actionIntentId,
          commandNamespace: envelope.commandType,
          idempotencyKey: envelope.idempotencyKey,
          source: params.canonicalApplication.source,
        });
        if (!application.ok) {
          return {
            ok: false,
            conflict: typedConflict(
              'VALIDATION_FAILED',
              `selected-plan canonical application rejected: ${application.reason}`,
              [journeyRef, reservationRef],
            ),
          };
        }
      }

      await appendAuditTrail({
        envelope,
        advanced: [journeyAdvanced, reservationAdvanced],
        destinationKind: 'OBSERVED_STAY_CANCELLED',
        payload: value,
      });
      return {
        ok: true,
        value,
        receipt: buildReceipt({
          envelope,
          value,
          advanced: [journeyAdvanced, reservationAdvanced],
        }),
      };
    });
  } catch (error) {
    return {
      ok: false,
      conflict: typedConflict(
        'VALIDATION_FAILED',
        `OBSERVED_STAY_CANCELLED: ${error instanceof Error ? error.message : String(error)}`,
        [journeyRef, reservationRef],
      ),
    };
  }
}
