/**
 * F2 — RecoveryPlanner input/output contract (FR-07, ARCHITECTURE.md §11).
 *
 * SAFETY INVARIANT: PlannerOutput carries strategies, tool requests,
 * assumptions and uncertainty only. It contains NO ActionIntent and NO
 * executable side-effect handle — consequential actions are constructed and
 * authorised downstream. This is enforced structurally by the type and
 * checked by the contract tests.
 */
import type { EntityId, UncertaintyRecord } from '../domain/common.ts';
import type { ImpactAssessment } from '../operational/impact.ts';
import type { ExecutionResult } from '../operational/intent.ts';
import type { TripSignal } from '../operational/signal.ts';
import type { TripSnapshot } from '../operational/snapshot.ts';
import type { RecoveryStrategy, ToolRequest } from '../operational/strategy.ts';
import type { CapabilityDescriptor } from './capabilities.ts';

export interface PriorToolResult {
  toolRequestId: EntityId;
  summary: string;
  data: Record<string, unknown>;
}

export interface PlannerInput {
  caseId: EntityId;
  snapshot: TripSnapshot;
  triggeringSignals: TripSignal[];
  impact: ImpactAssessment;
  capabilityRegistry: CapabilityDescriptor[];
  priorToolResults: PriorToolResult[];
  priorActionResults: ExecutionResult[];
}

export interface PlannerOutput {
  strategies: RecoveryStrategy[];
  toolRequests: ToolRequest[];
  assumptions: string[];
  uncertainties: UncertaintyRecord[];
  rationale?: string;
}

/** Keys a PlannerOutput may contain — the contract test enforces this set. */
export const PLANNER_OUTPUT_ALLOWED_KEYS = [
  'strategies',
  'toolRequests',
  'assumptions',
  'uncertainties',
  'rationale',
] as const;

export interface RecoveryPlanner {
  plan(input: PlannerInput): Promise<PlannerOutput>;
}
