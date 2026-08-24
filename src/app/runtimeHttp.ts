/**
 * R1/PL-3 — HTTP-facing adapter for the generic runtime recovery flow.
 *
 * Translates wire JSON into validated RuntimeOrchestrator calls. Validation is
 * Zod-enforced at the boundary; engine rejections (unknown case, illegal
 * transition...) come back as structured 409 responses — never crashes.
 * Every stage requires a caller-supplied instant (`at`), so the demo flow is
 * deterministic and never wall-clock-stamped. Scenario-neutral: the routes
 * know the operation vocabulary, never any scenario content.
 */
import { z } from 'zod';
import { EntityIdSchema, EntityRefSchema, IsoDateTimeSchema } from '../domain/common.ts';
import { TripSignalSchema } from '../operational/signal.ts';
import type { RuntimeOrchestrator } from './runtime.ts';
import { reportMissedFlight } from './missedFlight.ts';
import type { TripRepository } from '../contracts/repositories.ts';
import type { SqlMutationService } from '../engine/mutation.ts';

const InstantBody = z.strictObject({ at: IsoDateTimeSchema });

const PlanBodySchema = InstantBody.extend({ caseId: EntityIdSchema });

const BeginBodySchema = InstantBody.extend({
  caseId: EntityIdSchema,
  strategyId: EntityIdSchema,
});

const DecideBodySchema = InstantBody.extend({
  caseId: EntityIdSchema,
  intentId: EntityIdSchema,
  decidedBy: EntityRefSchema,
  verdict: z.enum(['APPROVED', 'DECLINED']),
  note: z.string().optional(),
});

const ExecuteBodySchema = InstantBody.extend({
  caseId: EntityIdSchema,
  intentId: EntityIdSchema,
});

const MissedFlightBodySchema = z.strictObject({
  tripId: EntityIdSchema,
  elementId: EntityIdSchema.optional(),
  travellerReport: z.string(),
  at: IsoDateTimeSchema,
});

type WireResult = { status: number; body: unknown };

function invalid(error: z.ZodError): WireResult {
  return {
    status: 400,
    body: {
      error: 'invalid_request',
      issues: error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
    },
  };
}

/** Engine-side rejections are structured data, not 500s. */
function rejected(message: string): WireResult {
  return { status: 409, body: { error: 'rejected', message } };
}

/**
 * Run `work` with boundary validation: Zod failures -> 400, known engine
 * rejections (thrown by the orchestrator) -> 409.
 */
async function guarded<T>(
  body: unknown,
  schema: z.ZodType<T>,
  work: (input: T) => Promise<unknown>,
): Promise<WireResult> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) return invalid(parsed.error);
  try {
    const result = await work(parsed.data);
    return { status: 200, body: result };
  } catch (error) {
    return rejected(error instanceof Error ? error.message : String(error));
  }
}

/** Compact wire projection of a ProcessedSignal. */
function signalWire(processed: Awaited<ReturnType<RuntimeOrchestrator['processDisruption']>>): Record<string, unknown> {
  return {
    signalId: processed.signalId,
    tripId: processed.tripId,
    caseId: processed.caseId,
    caseStatus: processed.caseStatus,
    mutationAccepted: processed.mutationAccepted,
    severity: processed.assessment.severity,
    directFailureIds: processed.assessment.directFailures.map((failure) => failure.elementId),
    threatenedObjectiveIds: processed.assessment.threatenedObjectives.map((o) => o.objectiveId),
    irreversibleLossCount: processed.assessment.irreversibleLosses.length,
    failedConstraintIds: processed.constraintEvaluations
      .filter((evaluation) => evaluation.status === 'FAIL')
      .map((evaluation) => evaluation.constraintId),
  };
}

/** RuntimeHandlers over a wired orchestrator. */
export function createRuntimeHandlers(deps: {
  orchestrator: RuntimeOrchestrator;
  trips: TripRepository;
  mutations: SqlMutationService;
  state: () => Promise<Record<string, unknown>>;
}): {
  disruption(body: unknown): Promise<WireResult>;
  plan(body: unknown): Promise<WireResult>;
  begin(body: unknown): Promise<WireResult>;
  decide(body: unknown): Promise<WireResult>;
  execute(body: unknown): Promise<WireResult>;
  reset(body: unknown): Promise<WireResult>;
  state(): Promise<WireResult>;
  reportMissedFlight(body: unknown): Promise<WireResult>;
} {
  const { orchestrator, trips, mutations } = deps;
  return {
    disruption(body) {
      return guarded(body, TripSignalSchema, async (signal) =>
        signalWire(await orchestrator.processDisruption(signal)),
      );
    },
    plan(body) {
      return guarded(body, PlanBodySchema, async (input) =>
        orchestrator.plan({ caseId: input.caseId, at: input.at }),
      );
    },
    begin(body) {
      return guarded(body, BeginBodySchema, async (input) =>
        orchestrator.begin({ caseId: input.caseId, strategyId: input.strategyId, at: input.at }),
      );
    },
    async decide(body) {
      const parsed = DecideBodySchema.safeParse(body);
      if (!parsed.success) return invalid(parsed.error);
      try {
        const outcome = await orchestrator.decide({
          caseId: parsed.data.caseId,
          intentId: parsed.data.intentId,
          decidedBy: parsed.data.decidedBy,
          verdict: parsed.data.verdict,
          at: parsed.data.at,
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
        });
        if (!outcome.accepted) {
          // A wrong principal or missing intent is a rejection, not an error.
          return { status: 409, body: { error: 'approval_rejected', message: outcome.reason ?? 'approval rejected' } };
        }
        return { status: 200, body: outcome };
      } catch (error) {
        return rejected(error instanceof Error ? error.message : String(error));
      }
    },
    execute(body) {
      return guarded(body, ExecuteBodySchema, async (input) =>
        orchestrator.execute({ caseId: input.caseId, intentId: input.intentId, at: input.at }),
      );
    },
    reset(body) {
      return guarded(body, InstantBody.extend({ now: IsoDateTimeSchema.optional() }), async (input) =>
        orchestrator.reset(input.at),
      );
    },
    async state() {
      return { status: 200, body: await deps.state() };
    },
    reportMissedFlight(body) {
      return guarded(body, MissedFlightBodySchema, async (input) => {
        const result = await reportMissedFlight(
          { orchestrator, trips, mutations },
          {
            tripId: input.tripId,
            elementId: input.elementId,
            travellerReport: input.travellerReport,
            at: input.at,
          },
        );
        return {
          signalId: result.signalId,
          caseId: result.caseId,
          caseStatus: result.caseStatus,
          missedElementId: result.missedElementId,
          mutationAccepted: result.processed.mutationAccepted,
          severity: result.processed.assessment.severity,
          directFailureIds: result.processed.assessment.directFailures.map((f) => f.elementId),
          threatenedObjectiveIds: result.processed.assessment.threatenedObjectives.map((o) => o.objectiveId),
        };
      });
    },
  };
}
