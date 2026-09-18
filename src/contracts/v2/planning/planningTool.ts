/**
 * NORTHSTAR v2 — Bounded read-only planning tool protocol (R1 / freeze C2).
 *
 * This ADAPTS the useful historical `ToolRequest` / `PriorToolResult` /
 * `planningLoop` / `dispatch.ts` design onto the current provider-neutral
 * capability vocabulary. It does NOT replace it and it does NOT reintroduce a
 * consequential operation.
 *
 * Safety is structural, in three layers:
 *   1. `ToolOperationSchema` (src/operational/strategy.ts) is a CLOSED enum
 *      that does not contain booking, payment, cancellation submission or any
 *      other consequential verb. A `PlanningToolRequest` literally cannot
 *      represent one.
 *   2. the capability/operation pair is validated exactly as the historical
 *      contract does, via `TOOL_OPERATION_FAMILY`.
 *   3. equivalent requests deduplicate by canonical `capability + operation +
 *      parameters`, so bounded research rounds cannot be inflated by repeats.
 *
 * Downstream proposers consume `normalizedEvidence` — validated,
 * provider-neutral results — never provider wire payloads. LIVE / RECORD /
 * REPLAY share normalization and this contract. External failure is visible
 * data (`status`/`error`/`uncertainty`), never a fabricated fact.
 */
import { z } from 'zod';
import {
  CapabilityFamilySchema,
  ToolOperationSchema,
  TOOL_OPERATION_FAMILY,
  type CapabilityFamily,
  type ToolOperation,
} from '../../../operational/strategy.ts';
import { EntityIdSchema } from '../../../domain/common.ts';
import { InstantSchema, type Instant } from '../../../domain/v2/shared/time.ts';

/**
 * Provenance mode of a planning tool result. Mirrors the provider runner's
 * LIVE / RECORD / REPLAY normalization plus INTERNAL for state already held in
 * canonical PostgreSQL (no external call).
 */
export const PlanningToolProvenanceModeSchema = z.enum(['LIVE', 'RECORD', 'REPLAY', 'INTERNAL']);
export type PlanningToolProvenanceMode = z.infer<typeof PlanningToolProvenanceModeSchema>;

/**
 * A bounded, read-only research request the coordinator may dispatch during a
 * planning basis. `operation` is constrained to the closed read-only
 * vocabulary; the shape has no field that could carry a consequential action.
 */
export const PlanningToolRequestSchema = z
  .strictObject({
    id: EntityIdSchema,
    capability: CapabilityFamilySchema,
    operation: ToolOperationSchema,
    parameters: z.record(z.string(), z.unknown()).default({}),
    /** Why this read is needed — bounded, factual, no chain-of-thought. */
    purpose: z.string().min(1).max(512),
    /** Closed-vocabulary evidence-gap code this request answers. */
    evidenceGapCode: z.string().regex(/^[a-z][a-z0-9_]*$/),
    /** 1-based bounded research round this request belongs to. */
    round: z.number().int().min(1),
  })
  .superRefine((request, ctx) => {
    const expectedFamily: CapabilityFamily = TOOL_OPERATION_FAMILY[request.operation];
    if (request.capability !== expectedFamily) {
      ctx.addIssue({
        code: 'custom',
        path: ['capability'],
        message: `operation ${request.operation} belongs to capability ${expectedFamily}, not ${request.capability}`,
      });
    }
  });
export type PlanningToolRequest = z.infer<typeof PlanningToolRequestSchema>;

/** Terminal status of a dispatched read. Failure/absence are first-class. */
export const PlanningToolResultStatusSchema = z.enum([
  'SUCCEEDED',
  'PARTIAL',
  'FAILED',
  'UNAVAILABLE',
]);
export type PlanningToolResultStatus = z.infer<typeof PlanningToolResultStatusSchema>;

/** Provenance of a result: which provider, which mode, when, from what refs. */
export const PlanningToolProvenanceSchema = z.strictObject({
  providerId: z.string().min(1).optional(),
  mode: PlanningToolProvenanceModeSchema,
  observedAt: InstantSchema,
  sourceRefs: z.array(EntityIdSchema).default([]),
  /** Recording reference when mode is REPLAY/RECORD. */
  recordingRef: z.string().min(1).optional(),
});
export type PlanningToolProvenance = z.infer<typeof PlanningToolProvenanceSchema>;

/** A bounded, factual uncertainty note. Never a reasoning transcript. */
export const PlanningToolUncertaintySchema = z.strictObject({
  code: z.string().regex(/^[a-z][a-z0-9_]*$/),
  summary: z.string().min(1).max(512),
});
export type PlanningToolUncertainty = z.infer<typeof PlanningToolUncertaintySchema>;

/** A structured, retryable-or-not failure. Visible, never swallowed. */
export const PlanningToolErrorSchema = z.strictObject({
  category: z.string().min(1).max(128),
  code: z.string().regex(/^[a-z][a-z0-9_]*$/),
  message: z.string().min(1).max(1024),
  retryable: z.boolean().optional(),
});
export type PlanningToolError = z.infer<typeof PlanningToolErrorSchema>;

/**
 * The provider-neutral result of a dispatched read. `normalizedEvidence` is
 * operation-specific validated content — already normalized by the adapter —
 * and is the ONLY thing a proposer may consume.
 */
export const PlanningToolResultSchema = z.strictObject({
  requestId: EntityIdSchema,
  capability: CapabilityFamilySchema,
  operation: ToolOperationSchema,
  status: PlanningToolResultStatusSchema,
  /** Operation-specific validated provider-neutral evidence. Absent on failure. */
  normalizedEvidence: z.unknown().optional(),
  provenance: PlanningToolProvenanceSchema,
  uncertainty: z.array(PlanningToolUncertaintySchema).default([]),
  error: PlanningToolErrorSchema.optional(),
});
export type PlanningToolResult = z.infer<typeof PlanningToolResultSchema>;

/**
 * Canonical request identity for dedupe: `capability|operation|canonicalJson(
 * parameters)`. Equivalent reads within the same current planning basis share
 * a fingerprint and may replay a prior result instead of re-dispatching. Key
 * order does not matter — parameters are canonicalized recursively.
 */
export function planningToolRequestFingerprint(
  request: Pick<PlanningToolRequest, 'capability' | 'operation' | 'parameters'>,
): string {
  return `${request.capability}|${request.operation}|${canonicalizeParameters(request.parameters)}`;
}

function canonicalizeParameters(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, canonicalize(v)] as const);
    return Object.fromEntries(entries);
  }
  return value;
}

/**
 * Deduplicate equivalent read requests, preserving first-seen order. Two
 * requests are equivalent when their canonical fingerprints match; the earlier
 * request's id/round/purpose are retained and later duplicates dropped.
 */
export function dedupePlanningToolRequests(
  requests: readonly PlanningToolRequest[],
): PlanningToolRequest[] {
  const seen = new Set<string>();
  const unique: PlanningToolRequest[] = [];
  for (const request of requests) {
    const fingerprint = planningToolRequestFingerprint(request);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    unique.push(request);
  }
  return unique;
}

/**
 * Explicit finite research budget for one planning basis. Defaults reuse the
 * historical bounded-planning limits rather than inventing new ones
 * (`planningLoop` maxRounds = 2; candidate caps live with the proposer port).
 */
export interface PlanningResearchBudget {
  /** Maximum bounded research rounds. Historical default: 2. */
  readonly maxRounds: number;
  /** Maximum distinct read requests dispatched across the whole basis. */
  readonly maxRequests: number;
}

export const DEFAULT_PLANNING_RESEARCH_BUDGET: PlanningResearchBudget = {
  maxRounds: 2,
  maxRequests: 12,
};

/**
 * Structured refusal when a research budget would be exceeded. Bounded
 * planning never loops unbounded; hitting the cap is a visible outcome.
 */
export const PlanningBudgetExceededSchema = z.strictObject({
  kind: z.literal('PLANNING_BUDGET_EXCEEDED'),
  budget: z.strictObject({
    maxRounds: z.number().int().min(1),
    maxRequests: z.number().int().min(1),
  }),
  attemptedRound: z.number().int().min(1),
  attemptedRequests: z.number().int().min(0),
});
export type PlanningBudgetExceeded = z.infer<typeof PlanningBudgetExceededSchema>;

export type { CapabilityFamily, ToolOperation, Instant };
