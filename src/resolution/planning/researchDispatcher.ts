/**
 * NORTHSTAR R1 — bounded read-only planning-tool dispatcher (freeze C2 impl).
 *
 * Turns a planning basis's evidence-gap read requests into normalized,
 * provider-neutral evidence records WITHOUT ever being able to perform a
 * consequential action. Safety is inherited structurally from the contract:
 * the request type cannot represent booking/payment/cancellation submission
 * (the closed `ToolOperationSchema` excludes them), and this dispatcher only
 * ever routes those read-only requests to an injected transport.
 *
 * What this module owns (all pure except the injected `dispatch`):
 *   - dedupe equivalent requests by canonical fingerprint so bounded research
 *     cannot be inflated by repeats;
 *   - enforce the explicit finite research budget (rounds + total requests) and
 *     surface a structured PLANNING_BUDGET_EXCEEDED refusal rather than looping;
 *   - record one bounded, factual PlanningEvidenceRecord per dispatched read,
 *     carrying the result's own status/provenance/uncertainty. External failure
 *     stays visible data; nothing is fabricated.
 *
 * The transport is a dependency injected by the composition root (a real
 * LIVE/RECORD/REPLAY provider runner locally, a checked-in REPLAY source in
 * tests). It is never model-controlled.
 */
import type { CapabilityFamily } from '../../operational/strategy.ts';
import {
  dedupePlanningToolRequests,
  planningToolRequestFingerprint,
  DEFAULT_PLANNING_RESEARCH_BUDGET,
  type PlanningBudgetExceeded,
  type PlanningResearchBudget,
  type PlanningToolRequest,
  type PlanningToolResult,
} from '../../contracts/v2/planning/planningTool.ts';
import {
  PlanningEvidenceRecordSchema,
  type PlanningEvidenceRecord,
} from '../../contracts/v2/planning/recoveryPlanningAttempt.ts';

/**
 * The injected read-only transport. Given a validated request it returns the
 * provider-normalized result (or a FAILED/UNAVAILABLE result). It cannot be
 * handed a consequential operation because the request type cannot carry one.
 */
export type PlanningToolTransport = (request: PlanningToolRequest) => Promise<PlanningToolResult>;

export interface DispatchResearchInput {
  /** Read requests grouped by 1-based research round; the array index + 1 is the round. */
  rounds: readonly (readonly PlanningToolRequest[])[];
  transport: PlanningToolTransport;
  budget?: PlanningResearchBudget;
}

export type DispatchResearchOutcome =
  | { ok: true; evidence: PlanningEvidenceRecord[]; dispatched: number }
  | { ok: false; refusal: PlanningBudgetExceeded; evidence: PlanningEvidenceRecord[] };

/**
 * Dispatch deduped read requests round-by-round under the finite budget. Within
 * a round, equivalent requests collapse to one dispatch. Exceeding the round or
 * total-request cap returns a structured refusal carrying the evidence already
 * gathered — bounded planning never loops unbounded and never silently drops
 * what it already learned.
 */
export async function dispatchResearch(input: DispatchResearchInput): Promise<DispatchResearchOutcome> {
  const budget = input.budget ?? DEFAULT_PLANNING_RESEARCH_BUDGET;
  const evidence: PlanningEvidenceRecord[] = [];
  const seen = new Set<string>();
  let dispatched = 0;

  if (input.rounds.length > budget.maxRounds) {
    return {
      ok: false,
      evidence,
      refusal: {
        kind: 'PLANNING_BUDGET_EXCEEDED',
        budget: { maxRounds: budget.maxRounds, maxRequests: budget.maxRequests },
        attemptedRound: input.rounds.length,
        attemptedRequests: input.rounds.reduce((n, r) => n + r.length, 0),
      },
    };
  }

  for (let i = 0; i < input.rounds.length; i += 1) {
    const round = i + 1;
    const unique = dedupePlanningToolRequests(input.rounds[i]!).filter(
      (request) => !seen.has(planningToolRequestFingerprint(request)),
    );
    for (const request of unique) {
      if (dispatched >= budget.maxRequests) {
        return {
          ok: false,
          evidence,
          refusal: {
            kind: 'PLANNING_BUDGET_EXCEEDED',
            budget: { maxRounds: budget.maxRounds, maxRequests: budget.maxRequests },
            attemptedRound: round,
            attemptedRequests: dispatched + 1,
          },
        };
      }
      seen.add(planningToolRequestFingerprint(request));
      const result = await input.transport(request);
      dispatched += 1;
      evidence.push(toEvidenceRecord(request, result));
    }
  }

  return { ok: true, evidence, dispatched };
}

/**
 * Project a dispatched read into the bounded evidence record persisted inside
 * the planning attempt. The summary is a short factual projection of status +
 * provenance — explicitly NOT a reasoning transcript and NOT a raw wire payload.
 */
export function toEvidenceRecord(request: PlanningToolRequest, result: PlanningToolResult): PlanningEvidenceRecord {
  return PlanningEvidenceRecordSchema.parse({
    evidenceRef: `evidence:${request.id}`,
    requestFingerprint: planningToolRequestFingerprint(request),
    capability: result.capability as CapabilityFamily,
    operation: result.operation,
    status: result.status,
    summary: summarize(request, result),
    provenance: result.provenance,
    uncertainty: [...result.uncertainty],
  });
}

function summarize(request: PlanningToolRequest, result: PlanningToolResult): string {
  const base = `${request.operation} ${result.status.toLowerCase()} for gap ${request.evidenceGapCode}`;
  if (result.error) return `${base}: ${result.error.code}`;
  return base;
}
