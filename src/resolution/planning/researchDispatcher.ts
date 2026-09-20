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
  PlanningToolRequestSchema,
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

/**
 * Optional bounded continuation for a completed research round. The callback
 * receives every normalized result gathered so far, so a later read can be
 * derived from an earlier read (for example, quote a rate returned by search).
 * The dispatcher, rather than the callback, owns round and request budgets.
 */
export type NextResearchRound = (input: {
  completedRound: number;
  results: readonly PlanningToolResult[];
}) => readonly PlanningToolRequest[] | Promise<readonly PlanningToolRequest[]>;

export interface DispatchResearchInput {
  /** Read requests grouped by 1-based research round; the array index + 1 is the round. */
  rounds: readonly (readonly PlanningToolRequest[])[];
  transport: PlanningToolTransport;
  budget?: PlanningResearchBudget;
  /** Optional bounded continuation; generated requests join the next static round. */
  nextRound?: NextResearchRound;
}

export type DispatchResearchOutcome =
  | { ok: true; evidence: PlanningEvidenceRecord[]; results: PlanningToolResult[]; dispatched: number }
  | { ok: false; refusal: PlanningBudgetExceeded; evidence: PlanningEvidenceRecord[]; results: PlanningToolResult[] };

/**
 * Dispatch deduped read requests round-by-round under the finite budget. Within
 * a round, equivalent requests collapse to one dispatch. Exceeding the round or
 * total-request cap returns a structured refusal carrying the evidence already
 * gathered — bounded planning never loops unbounded and never silently drops
 * what it already learned.
 *
 * `results` carries the raw provider-normalized `PlanningToolResult` payloads
 * (e.g. `flight.search` offers) INDEX-ALIGNED with `evidence` — `evidence[i]` is
 * the projected attempt record for `results[i]`. A proposer consumes the raw
 * normalized results (via the coordinator's PlanningEvidenceContext); the attempt
 * persists only the projected records, never the raw payload.
 */
export async function dispatchResearch(input: DispatchResearchInput): Promise<DispatchResearchOutcome> {
  const budget = input.budget ?? DEFAULT_PLANNING_RESEARCH_BUDGET;
  if (![budget.maxRounds, budget.maxRequests].every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error('Planning research budgets must be finite non-negative integers');
  }
  const evidence: PlanningEvidenceRecord[] = [];
  const results: PlanningToolResult[] = [];
  const seen = new Set<string>();
  let dispatched = 0;

  if (input.rounds.length > budget.maxRounds) {
    return {
      ok: false,
      evidence,
      results,
      refusal: {
        kind: 'PLANNING_BUDGET_EXCEEDED',
        budget: { maxRounds: budget.maxRounds, maxRequests: budget.maxRequests },
        attemptedRound: input.rounds.length,
        attemptedRequests: input.rounds.reduce((n, r) => n + r.length, 0),
      },
    };
  }

  let round = 1;
  let dynamicRequests: readonly PlanningToolRequest[] = [];
  while (round <= input.rounds.length || dynamicRequests.length > 0) {
    const staticRequests = input.rounds[round - 1] ?? [];
    // Static requests retain their historical first-seen order; generated
    // requests are appended and then deduplicated against the whole basis.
    const generated = dynamicRequests.map((request) => {
      const parsed = PlanningToolRequestSchema.safeParse(request);
      if (!parsed.success) {
        throw new Error(
          `nextRound generated invalid planning request for round ${round}: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`,
        );
      }
      return parsed.data;
    });
    const unique = dedupePlanningToolRequests([...staticRequests, ...generated]).filter(
      (request) => !seen.has(planningToolRequestFingerprint(request)),
    );
    if (round > budget.maxRounds) {
      // Inspect the continuation at the boundary without dispatching it. A
      // still-needed quote is an explicit research gap, not silent completion;
      // an already-observed duplicate requires no additional budget.
      if (unique.length === 0) break;
      return {
        ok: false, evidence, results,
        refusal: {
          kind: 'PLANNING_BUDGET_EXCEEDED',
          budget: { maxRounds: budget.maxRounds, maxRequests: budget.maxRequests },
          attemptedRound: round,
          attemptedRequests: dispatched + unique.length,
        },
      };
    }
    for (const request of unique) {
      if (dispatched >= budget.maxRequests) {
        return {
          ok: false,
          evidence,
          results,
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
      // Pushed together so evidence[i] is the record for results[i].
      evidence.push(toEvidenceRecord(request, result));
      results.push(result);
    }

    const hadRoundInput = staticRequests.length > 0 || dynamicRequests.length > 0;
    if (!hadRoundInput) {
      // Preserve the static dispatcher’s ability to skip an empty round and
      // continue to a later static round. With no later work, stop cleanly.
      round += 1;
      continue;
    }
    if (input.nextRound) {
      const generatedNext = await input.nextRound({ completedRound: round, results: [...results] });
      if (!Array.isArray(generatedNext)) {
        throw new Error(`nextRound must return an array for round ${round + 1}`);
      }
      dynamicRequests = generatedNext;
    } else {
      dynamicRequests = [];
    }
    round += 1;
  }

  return { ok: true, evidence, results, dispatched };
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
