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
  /**
   * Transactional ground transfer inventory (private transfers, shuttles).
   * Deliberately distinct from ROUTING: routing answers "how long would a
   * drive take", TRANSFER answers "what can be booked at what price".
   */
  'TRANSFER',
  'RESEARCH',
  'INGESTION',
  'COMMUNICATION',
  'SIMULATION',
]);
export type CapabilityFamily = z.infer<typeof CapabilityFamilySchema>;

/**
 * Closed READ-ONLY operation vocabulary for planner tool requests (FR-07,
 * FR-10, ADR-024). The planner may ask for information; it can never request
 * a consequential provider action. Consequential operations (flight.change,
 * flight.cancel, hotel.book/modify/cancel, transfer.book/amend/cancel,
 * communication.*, simulation.*) are deliberately absent and exist only on
 * the ActionIntent/authority path.
 * Values must remain a subset of CapabilityOperationSchema (test-enforced).
 */
export const ToolOperationSchema = z.enum([
  'flight.search',
  'flight.verify',
  'flight.fare_rules',
  'flight.refund_quote',
  'hotel.context',
  'hotel.search',
  'hotel.quote',
  'hotel.retrieve',
  'routing.context',
  'transfer.search',
  'transfer.quote',
  'transfer.retrieve',
  'research.entry_requirements',
  'research.local_context',
]);
export type ToolOperation = z.infer<typeof ToolOperationSchema>;

/** Capability family each tool operation belongs to; keeps requests coherent. */
export const TOOL_OPERATION_FAMILY: Record<ToolOperation, CapabilityFamily> = {
  'flight.search': 'FLIGHT',
  'flight.verify': 'FLIGHT',
  'flight.fare_rules': 'FLIGHT',
  'flight.refund_quote': 'FLIGHT',
  'hotel.context': 'HOTEL',
  'hotel.search': 'HOTEL',
  'hotel.quote': 'HOTEL',
  'hotel.retrieve': 'HOTEL',
  'routing.context': 'ROUTING',
  'transfer.search': 'TRANSFER',
  'transfer.quote': 'TRANSFER',
  'transfer.retrieve': 'TRANSFER',
  'research.entry_requirements': 'RESEARCH',
  'research.local_context': 'RESEARCH',
};

/** Information/tool need the planner asks the orchestrator to fulfil. */
export const ToolRequestSchema = z
  .strictObject({
    id: EntityIdSchema,
    capability: CapabilityFamilySchema,
    operation: ToolOperationSchema,
    parameters: z.record(z.string(), z.unknown()).default({}),
    purpose: z.string(),
  })
  .superRefine((request, ctx) => {
    const expectedFamily = TOOL_OPERATION_FAMILY[request.operation];
    if (request.capability !== expectedFamily) {
      ctx.addIssue({
        code: 'custom',
        path: ['capability'],
        message: `operation ${request.operation} belongs to capability ${expectedFamily}, not ${request.capability}`,
      });
    }
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
