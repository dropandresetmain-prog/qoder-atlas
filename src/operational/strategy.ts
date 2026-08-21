/**
 * F1 — RecoveryStrategy: structured hypothetical recovery plan
 * (ARCHITECTURE.md §10). Strategies describe overlay candidate mutations and
 * information needs. They carry NO executable handles: consequential side
 * effects only ever appear as ActionIntents built and authorised elsewhere
 * (FR-10).
 */
import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema, MoneySchema, UncertaintyRecordSchema } from '../domain/common.ts';
import { MutationOperationSchema } from './mutation.ts';

/** Provider-neutral capability families (FR-08). */
export const CapabilityFamilySchema = z.enum([
  'FLIGHT',
  'ROUTING',
  'HOTEL',
  'RESEARCH',
  'INGESTION',
  'COMMUNICATION',
  'SIMULATION',
]);
export type CapabilityFamily = z.infer<typeof CapabilityFamilySchema>;

/** Information/tool need the planner asks the orchestrator to fulfil. */
export const ToolRequestSchema = z.strictObject({
  id: EntityIdSchema,
  capability: CapabilityFamilySchema,
  operation: z.string(),
  parameters: z.record(z.string(), z.unknown()).default({}),
  purpose: z.string(),
});
export type ToolRequest = z.infer<typeof ToolRequestSchema>;

export const RecoveryStrategySchema = z.strictObject({
  id: EntityIdSchema,
  caseId: EntityIdSchema,
  summary: z.string(),
  /** Applied to a scenario overlay only — never to authoritative state (FR-09). */
  candidateOperations: z.array(MutationOperationSchema).default([]),
  toolRequests: z.array(ToolRequestSchema).default([]),
  assumptions: z.array(z.string()).default([]),
  uncertainties: z.array(UncertaintyRecordSchema).default([]),
  expectedOutcomes: z.array(z.string()).default([]),
  costImpact: MoneySchema.optional(),
  createdAt: IsoDateTimeSchema,
});
export type RecoveryStrategy = z.infer<typeof RecoveryStrategySchema>;
