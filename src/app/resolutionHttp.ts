/**
 * Northstar RV-N3 / RV-N5 — HTTP boundary for the resolution engine lane.
 *
 * Wire JSON -> validated service calls. Mirrors the programmeHttp discipline
 * (RV-N1/RV-N2): zod boundary validation; engine rejections (unknown trip,
 * already-booked trip, empty target, schema-invalid request) come back as
 * structured WireResult responses — never crashes. The integrator wires these
 * handlers into the composed HTTP runtime; this file only builds the factory.
 */
import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from '../domain/common.ts';
import { ChangeRequestSchema } from '../contracts/changeRequest.ts';
import { startInitialPlanning, type InitialPlanningDeps, type InitialPlanningOutcome } from './initialPlanning.ts';
import { resolveChangeRequest, type ChangeRequestDeps, type ChangeRequestResolveOutcome } from './changeRequest.ts';

export type WireResult = { status: number; body: unknown };

const InitialPlanBodySchema = z.strictObject({
  tripId: EntityIdSchema,
  at: IsoDateTimeSchema,
});

const ChangeRequestBodySchema = z.strictObject({
  request: ChangeRequestSchema,
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

function rejected(outcome: { issues: string[]; accepted: boolean }): WireResult {
  return {
    status: outcome.accepted ? 200 : 409,
    body: { accepted: outcome.accepted, issues: outcome.issues },
  };
}

function unknownTrip(tripId: string): WireResult {
  return { status: 404, body: { error: 'unknown_trip', tripId } };
}

/**
 * Build the resolution handler pair. Both handlers stay scenario-neutral:
 * they only know the frozen contracts (ChangeRequest, planning request
 * shape) and the service functions; the integrator wires the same deps
 * object the runtime already has.
 */
export function createResolutionHandlers(deps: InitialPlanningDeps & ChangeRequestDeps): {
  initialPlan(body: unknown): Promise<WireResult>;
  changeRequest(body: unknown): Promise<WireResult>;
} {
  return {
    async initialPlan(body) {
      const parsed = InitialPlanBodySchema.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);
      // Pre-flight: unknown trip is a 404; already-booked trip is a 409.
      const preflightTrip = await deps.trips.getTrip(parsed.data.tripId);
      if (!preflightTrip) return unknownTrip(parsed.data.tripId);
      const outcome = await startInitialPlanning(deps, parsed.data);
      return resolutionWireForInitial(outcome);
    },
    async changeRequest(body) {
      const parsed = ChangeRequestBodySchema.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);
      const preflightTrip = await deps.trips.getTrip(parsed.data.request.tripId);
      if (!preflightTrip) return unknownTrip(parsed.data.request.tripId);
      const outcome = await resolveChangeRequest(deps, parsed.data);
      return resolutionWireForChange(outcome);
    },
  };
}

function resolutionWireForInitial(outcome: InitialPlanningOutcome): WireResult {
  if (!outcome.accepted) return rejected(outcome);
  return {
    status: 200,
    body: {
      accepted: true,
      tripId: outcome.tripId,
      caseId: outcome.caseId,
      caseStatus: outcome.caseStatus,
      strategies: outcome.strategies,
      uncertainties: outcome.uncertainties,
      issues: outcome.issues,
      ...(outcome.rationale !== undefined ? { rationale: outcome.rationale } : {}),
    },
  };
}

function resolutionWireForChange(outcome: ChangeRequestResolveOutcome): WireResult {
  if (!outcome.accepted) {
    return {
      status: 409,
      body: {
        accepted: false,
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
