/**
 * NORTHSTAR M6 — registered constraint types evaluators understand.
 *
 * M5 stores `constraint_definitions.registered_type` plus typed operands and no
 * verdict. A type is executable only because a registered evaluator defines
 * what satisfaction means (closure §5 REQUIRES). An unregistered type is
 * captured and reported as UNSUPPORTED_EVALUATION — never silently PASS.
 * Adding a type is an additive extension (AT21): register it here with its
 * operand contract and the evaluator id that owns it.
 */
import type { WConstraintDefinition } from '../world/world.ts';

export interface ConstraintTypeRegistration {
  registeredType: string;
  evaluatorId: string;
  operands: Record<string, { kind: 'SUBJECT_REF' | 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'INSTANT' | 'LOCAL_DATE'; required: boolean; subjectKind?: string }>;
  meaning: string;
}

export const CONSTRAINT_TYPES: readonly ConstraintTypeRegistration[] = [
  {
    registeredType: 'minimum_connection_minutes',
    evaluatorId: 'm6.connection',
    operands: { minutes: { kind: 'NUMBER', required: true }, place: { kind: 'SUBJECT_REF', required: false, subjectKind: 'PLACE' } },
    meaning: 'minimum minutes between arriving at a place and departing from it again (optionally only at one place)',
  },
  {
    registeredType: 'transfer_minutes',
    evaluatorId: 'm6.connection',
    operands: { from_place: { kind: 'SUBJECT_REF', required: true, subjectKind: 'PLACE' }, to_place: { kind: 'SUBJECT_REF', required: true, subjectKind: 'PLACE' }, minutes: { kind: 'NUMBER', required: true } },
    meaning: 'minutes needed to move between two different places (e.g. arrival point to venue); symmetric unless both directions are registered',
  },
  {
    registeredType: 'overnight_accommodation_required',
    evaluatorId: 'm6.overnight',
    operands: { minimum_gap_hours: { kind: 'NUMBER', required: true } },
    meaning: 'a gap of at least this many hours between arrival and the next departure that spans a local night requires an active stay covering it',
  },
  {
    registeredType: 'stay_arrival_date_aligned',
    evaluatorId: 'm6.stay-arrival-date-aligned',
    operands: {
      original_stay_item: { kind: 'SUBJECT_REF', required: true, subjectKind: 'JOURNEY_ITEM' },
      arrival_item: { kind: 'SUBJECT_REF', required: true, subjectKind: 'JOURNEY_ITEM' },
    },
    meaning: 'the required destination stay starts on the selected arrival local date and preserves the original stay checkout local date',
  },
  {
    registeredType: 'travel_together',
    evaluatorId: 'm6.group',
    operands: { destination_place: { kind: 'SUBJECT_REF', required: false, subjectKind: 'PLACE' } },
    meaning: 'members of the owning coordination group travel into the destination on the same transport service',
  },
  {
    registeredType: 'programme_arrival_readiness_minutes',
    evaluatorId: 'm6.participation',
    operands: {
      minutes: { kind: 'NUMBER', required: true },
      requires_physical_presence: { kind: 'BOOLEAN', required: false },
    },
    meaning: 'REQUIRED physical-presence programme commitments need at least this many minutes between scheduled arrival and commitment start (RuleSet/policy data — not a hardcoded duration)',
  },
];

const BY_TYPE = new Map(CONSTRAINT_TYPES.map((entry) => [entry.registeredType, entry]));

export function constraintRegistration(registeredType: string): ConstraintTypeRegistration | undefined {
  return BY_TYPE.get(registeredType);
}

export function operandNumber(constraint: WConstraintDefinition, key: string): number | undefined {
  const operand = constraint.operands.find((o) => o.key === key);
  if (!operand || operand.number === null) return undefined;
  const value = Number(operand.number);
  return Number.isFinite(value) ? value : undefined;
}

export function operandSubjectId(constraint: WConstraintDefinition, key: string): string | undefined {
  return constraint.operands.find((o) => o.key === key)?.subject?.id;
}
