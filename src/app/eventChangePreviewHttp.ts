/**
 * DR-6 — HTTP boundary for event-change preview/commit:
 *   POST /api/programme/:anchorEventId/change-preview
 *   POST /api/programme/:anchorEventId/change-commit
 *
 * Wire JSON -> the EXISTING src/app/eventChangePreview.ts implementation.
 * Preview reads authoritative state only and mutates nothing (proven byte-
 * identical before/after by the integration test); commit performs the real
 * change through the SAME processCommitmentChange fan-out path the legacy
 * `/api/programme/commitment-change` route uses — no second engine.
 */
import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from '../domain/common.ts';
import {
  compareEventChangePreviews,
  previewEventChange,
  commitEventChange,
  type EventChangePreviewDeps,
  type EventChangeCommitDeps,
  type EventChangePreviewInput,
} from './eventChangePreview.ts';

export type WireResult = { status: number; body: unknown };

const ChangeBodySchema = z.strictObject({
  commitmentId: EntityIdSchema,
  changeKind: z.enum(['RESCHEDULED', 'RELOCATED', 'CANCELLED', 'OTHER']),
  newStartsAt: IsoDateTimeSchema.optional(),
  newEndsAt: IsoDateTimeSchema.optional(),
  newPlaceId: EntityIdSchema.optional(),
  at: IsoDateTimeSchema,
});

const ComparisonBodySchema = z.strictObject({
  options: z
    .array(
      ChangeBodySchema.extend({
        optionId: z.string().min(1),
      }),
    )
    .min(2),
});

function invalid(error: z.ZodError): WireResult {
  return {
    status: 400,
    body: {
      error: 'invalid_request',
      issues: error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
    },
  };
}

function buildInput(anchorEventId: string, body: z.infer<typeof ChangeBodySchema>): EventChangePreviewInput {
  return {
    anchorEventId,
    commitmentId: body.commitmentId,
    changeKind: body.changeKind,
    at: body.at,
    ...(body.newStartsAt ? { newStartsAt: body.newStartsAt } : {}),
    ...(body.newEndsAt ? { newEndsAt: body.newEndsAt } : {}),
    ...(body.newPlaceId ? { newPlaceId: body.newPlaceId } : {}),
  };
}

export function createEventChangePreviewHandlers(
  deps: EventChangePreviewDeps & EventChangeCommitDeps,
): {
  preview(anchorEventId: string, body: unknown): Promise<WireResult>;
  compare(anchorEventId: string, body: unknown): Promise<WireResult>;
  commit(anchorEventId: string, body: unknown): Promise<WireResult>;
} {
  return {
    async preview(anchorEventId, body) {
      const parsed = ChangeBodySchema.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);

      const anchorEntry = await deps.entities.get('ANCHOR_EVENT', anchorEventId);
      if (!anchorEntry || anchorEntry.entityType !== 'ANCHOR_EVENT') {
        return { status: 404, body: { error: 'unknown_anchor_event', anchorEventId } };
      }
      if (!anchorEntry.entity.commitments.some((c) => c.id === parsed.data.commitmentId)) {
        return { status: 404, body: { error: 'unknown_commitment', commitmentId: parsed.data.commitmentId } };
      }

      const result = await previewEventChange(deps, buildInput(anchorEventId, parsed.data));
      return { status: 200, body: result };
    },

    async compare(anchorEventId, body) {
      const parsed = ComparisonBodySchema.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);

      const anchorEntry = await deps.entities.get('ANCHOR_EVENT', anchorEventId);
      if (!anchorEntry || anchorEntry.entityType !== 'ANCHOR_EVENT') {
        return { status: 404, body: { error: 'unknown_anchor_event', anchorEventId } };
      }
      for (const option of parsed.data.options) {
        if (!anchorEntry.entity.commitments.some((commitment) => commitment.id === option.commitmentId)) {
          return { status: 404, body: { error: 'unknown_commitment', commitmentId: option.commitmentId } };
        }
      }

      const result = await compareEventChangePreviews(
        deps,
        parsed.data.options.map((option) => ({
          optionId: option.optionId,
          input: buildInput(anchorEventId, option),
        })),
      );
      return { status: 200, body: result };
    },

    async commit(anchorEventId, body) {
      const parsed = ChangeBodySchema.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);

      const anchorEntry = await deps.entities.get('ANCHOR_EVENT', anchorEventId);
      if (!anchorEntry || anchorEntry.entityType !== 'ANCHOR_EVENT') {
        return { status: 404, body: { error: 'unknown_anchor_event', anchorEventId } };
      }
      if (!anchorEntry.entity.commitments.some((c) => c.id === parsed.data.commitmentId)) {
        return { status: 404, body: { error: 'unknown_commitment', commitmentId: parsed.data.commitmentId } };
      }

      const outcome = await commitEventChange(deps, buildInput(anchorEventId, parsed.data));
      return {
        status: outcome.accepted ? 200 : 409,
        body: {
          accepted: outcome.accepted,
          ...(outcome.anchorEventId ? { anchorEventId: outcome.anchorEventId } : {}),
          ...(outcome.commitmentId ? { commitmentId: outcome.commitmentId } : {}),
          ...(outcome.changeKind ? { changeKind: outcome.changeKind } : {}),
          linkedTripCount: outcome.linkedTripCount,
          unlinkedTripCount: outcome.unlinkedTripCount,
          processedSignals: outcome.processed.map((processed) => ({
            signalId: processed.signalId,
            tripId: processed.tripId,
            caseId: processed.caseId,
            caseStatus: processed.caseStatus,
          })),
          issues: outcome.issues,
        },
      };
    },
  };
}
