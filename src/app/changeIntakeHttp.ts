/**
 * DR-5 — HTTP boundary for traveller natural-language change intake:
 * `POST /api/traveller/change-request`.
 *
 * Wire JSON -> interpretChangeRequest (model-or-deterministic proposal) ->
 * strict ChangeRequest schema validation -> the SAME resolveChangeRequest
 * engine the structured `/api/resolution/change-request` route uses
 * (src/app/changeIntake.ts's proposeThenResolve, unmodified). The NL
 * interpreter never mutates Trip state directly — only a validated proposal
 * ever reaches the resolver.
 */
import { z } from 'zod';
import { proposeThenResolve, type ChangeIntakeDeps, type ChangeIntakeInput } from './changeIntake.ts';
import type { ChangeRequestDeps, ChangeRequestResolveOutcome } from './changeRequest.ts';
import { EntityIdSchema, IsoDateTimeSchema } from '../domain/common.ts';

export type WireResult = { status: number; body: unknown };

const ChangeRequestNlBodySchema = z.strictObject({
  travellerId: EntityIdSchema,
  tripId: EntityIdSchema.optional(),
  text: z.string().min(1),
  at: IsoDateTimeSchema,
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

function resolutionWire(outcome: ChangeRequestResolveOutcome): WireResult {
  if (!outcome.accepted) {
    return {
      status: 409,
      body: {
        accepted: false,
        provenance: 'INTERPRETED' as const,
        tripId: outcome.tripId,
        intentKind: outcome.intentKind,
        urgency: outcome.urgency,
        issues: outcome.issues,
      },
    };
  }
  return {
    status: 200,
    body: {
      accepted: true,
      provenance: 'INTERPRETED' as const,
      tripId: outcome.tripId,
      caseId: outcome.caseId,
      caseStatus: outcome.caseStatus,
      intentKind: outcome.intentKind,
      urgency: outcome.urgency,
      implications: outcome.implications,
      uncertainties: outcome.uncertainties,
      issues: outcome.issues,
    },
  };
}

/**
 * Build the natural-language change-request handler. `deps` is the SAME
 * dependency set the structured resolution route already receives — this
 * route only adds the NL interpretation step in front of it.
 */
export function createChangeIntakeHandlers(deps: ChangeIntakeDeps & ChangeRequestDeps): {
  changeRequest(body: unknown): Promise<WireResult>;
} {
  return {
    async changeRequest(body) {
      const parsed = ChangeRequestNlBodySchema.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);

      const preflightTrip = parsed.data.tripId ? await deps.trips.getTrip(parsed.data.tripId) : undefined;
      if (parsed.data.tripId && !preflightTrip) {
        return { status: 404, body: { error: 'unknown_trip', tripId: parsed.data.tripId } };
      }

      const input: ChangeIntakeInput = {
        travellerId: parsed.data.travellerId,
        text: parsed.data.text,
        at: parsed.data.at,
        ...(parsed.data.tripId ? { tripId: parsed.data.tripId } : {}),
      };
      const { intake, resolution } = await proposeThenResolve(deps, input);

      if (!intake.ok || !resolution) {
        // Ambiguous/unsupported text fails closed with a clarification
        // request — never invented details, never a silent no-op.
        return {
          status: 422,
          body: {
            accepted: false,
            provenance: intake.provenance,
            clarificationNeeded: intake.clarificationNeeded,
            uncertainties: intake.uncertainties,
          },
        };
      }

      return resolutionWire(resolution);
    },
  };
}
