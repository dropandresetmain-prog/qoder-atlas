/**
 * NORTHSTAR v2 — accompaniment support: requirement vs. selected fulfilment.
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §4.2 and §14 (issue triage: "Support
 * requirement mixed with selected supporter" is Act Now). ConstraintDefinition
 * owns mandatory coverage, minimum count, eligible-alternative and separation
 * rules. SupportAssignment owns ONLY selected fulfilment within that
 * unchanged requirement. This module's whole purpose is making it a TYPE
 * ERROR for an assignment to widen or weaken its governing requirement.
 */
import { z } from 'zod';
import { SubjectIdSchema } from '../shared/identity.ts';
import { InstantIntervalSchema } from '../shared/time.ts';

/**
 * The requirement itself. Deliberately has NO status/PASS-FAIL field — that
 * belongs to an Assessment (see contracts/v2/assessment). A ConstraintDefinition
 * is immutable-by-identity: changing coverage/minCount/eligibility is a new
 * definition version, never an in-place mutation that a downstream assignment
 * could quietly ride along with.
 */
export const AccompanimentConstraintDefinitionSchema = z.strictObject({
  id: SubjectIdSchema,
  version: z.number().int().min(1),
  supportedTravellerId: SubjectIdSchema,
  requiredCoverage: InstantIntervalSchema,
  minimumSimultaneousSupporters: z.number().int().min(1),
  eligibleSupporterTravellerIds: z.array(SubjectIdSchema).min(1),
  maximumHandoffGapMinutes: z.number().int().min(0).default(0),
  provenanceEvidenceId: SubjectIdSchema.optional(),
});
export type AccompanimentConstraintDefinition = z.infer<typeof AccompanimentConstraintDefinitionSchema>;

export const SupportHandoffSchema = z.strictObject({
  fromSupporterTravellerId: SubjectIdSchema,
  toSupporterTravellerId: SubjectIdSchema,
  handoffAt: z.iso.datetime({ offset: true }),
});
export type SupportHandoff = z.infer<typeof SupportHandoffSchema>;

export const SupportAssignmentSchema = z
  .strictObject({
    id: SubjectIdSchema,
    revision: z.number().int().min(1),
    constraintDefinitionId: SubjectIdSchema,
    constraintDefinitionVersion: z.number().int().min(1),
    lifecycleStatus: z.enum(['PROPOSED', 'ACTIVE', 'SUPERSEDED', 'WITHDRAWN']),
    assignedSupporterTravellerIds: z.array(SubjectIdSchema).min(1),
    assignedScopes: z.array(
      z.strictObject({
        supporterTravellerId: SubjectIdSchema,
        interval: InstantIntervalSchema,
      }),
    ),
    handoffs: z.array(SupportHandoffSchema).default([]),
  })
  .strict();
export type SupportAssignment = z.infer<typeof SupportAssignmentSchema>;

/**
 * Validates an assignment against its EXACT governing definition. This is the
 * enforcement point for F-support: an assignment naming a non-eligible
 * supporter, covering fewer simultaneous supporters than required, leaving a
 * coverage gap, or a handoff gap wider than permitted is REJECTED here — it
 * can never "pass" merely because the assignment's own shape validated.
 */
export function assignmentSatisfiesDefinition(
  assignment: SupportAssignment,
  definition: AccompanimentConstraintDefinition,
): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];

  if (assignment.constraintDefinitionId !== definition.id) {
    reasons.push('assignment references a different constraint definition');
  }
  if (assignment.constraintDefinitionVersion !== definition.version) {
    reasons.push('assignment pins a stale/mismatched constraint definition version');
  }

  const ineligible = assignment.assignedSupporterTravellerIds.filter(
    (id) => !definition.eligibleSupporterTravellerIds.includes(id),
  );
  if (ineligible.length > 0) {
    reasons.push(`assigned supporter(s) not in the eligible set: ${ineligible.join(', ')}`);
  }

  const required = definition.requiredCoverage;
  const scopesWithin = assignment.assignedScopes.filter(
    (s) => s.interval.start <= required.end && s.interval.end >= required.start,
  );
  const uncoveredExists = !isIntervalFullyCovered(
    required,
    scopesWithin.map((s) => s.interval),
    definition.maximumHandoffGapMinutes,
  );
  if (uncoveredExists) {
    reasons.push('assigned scopes do not fully cover the required interval — a gap is a requirement failure, not a permitted relaxation');
  }

  for (const moment of assignment.assignedScopes) {
    const simultaneous = assignment.assignedScopes.filter(
      (s) => s.interval.start < moment.interval.end && s.interval.end > moment.interval.start,
    ).length;
    if (simultaneous < definition.minimumSimultaneousSupporters) {
      reasons.push('fewer simultaneous supporters assigned than the definition requires');
      break;
    }
  }

  for (const handoff of assignment.assignedScopes.length > 1 ? assignment.handoffs : []) {
    const outgoing = assignment.assignedScopes.find((s) => s.supporterTravellerId === handoff.fromSupporterTravellerId);
    const incoming = assignment.assignedScopes.find((s) => s.supporterTravellerId === handoff.toSupporterTravellerId);
    if (!outgoing || !incoming) {
      reasons.push('handoff references a supporter with no assigned scope');
      continue;
    }
    const gapMinutes = (Date.parse(incoming.interval.start) - Date.parse(outgoing.interval.end)) / 60000;
    if (gapMinutes > definition.maximumHandoffGapMinutes) {
      reasons.push('handoff gap exceeds the definition-permitted maximum');
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}

function isIntervalFullyCovered(
  required: { start: string; end: string },
  scopes: { start: string; end: string }[],
  permittedGapMinutes: number,
): boolean {
  const sorted = [...scopes].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  let cursor = required.start;
  for (const scope of sorted) {
    const gapMinutes = (Date.parse(scope.start) - Date.parse(cursor)) / 60000;
    if (gapMinutes > permittedGapMinutes) return false; // gap wider than any permitted handoff
    if (scope.end > cursor) cursor = scope.end;
    if (cursor >= required.end) return true;
  }
  return cursor >= required.end;
}
