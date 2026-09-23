/**
 * Required destination-stay policy: an original booked stay must either start
 * on the selected arrival's local date, or — when arrival falls on a later
 * night inside the booked window — be shown by evidence to survive the
 * first-night no-show; otherwise it must be retired and replaced by an equally
 * located stay whose start aligns with arrival and whose checkout matches the
 * original. Date coverage alone never proves a late-arrival booking survives.
 */
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { CapturedWorld, WConstraintDefinition } from '../../world/world.ts';
import type { EvaluationContext, Evaluator, EvaluatorOutput } from '../evaluator.ts';
import { constraintsFor } from '../reachability.ts';
import { dimension, explain, notApplicable } from '../explain.ts';

const EVALUATOR_ID = 'm6.stay-arrival-date-aligned';

function localDate(instant: string, timeZone: string): string | undefined {
  try {
    const values = new Map(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const year = values.get('year'); const month = values.get('month'); const day = values.get('day');
    return year && month && day ? `${year}-${month}-${day}` : undefined;
  } catch { return undefined; }
}

function operand(constraint: WConstraintDefinition, key: string) {
  return constraint.operands.find((candidate) => candidate.key === key);
}

function operandItemId(constraint: WConstraintDefinition, key: string): string | undefined {
  const subject = constraint.operands.find((operand) => operand.key === key)?.subject;
  return subject?.kind === 'JOURNEY_ITEM' ? subject.id : undefined;
}

function unknown(subject: TypedRef, constraint: WConstraintDefinition, reasonCode: string, related: TypedRef[]) {
  return explain({
    evaluatorId: EVALUATOR_ID, dimension: 'stay_arrival_date_aligned', status: 'UNKNOWN', reasonCode,
    cause: { kind: 'MISSING_INFORMATION', subjectRef: { kind: 'CONSTRAINT_DEFINITION', id: constraint.id } },
    affectedSubject: subject, relatedSubjects: related,
    uncertainty: [{ kind: 'MISSING_INPUT', code: reasonCode, subjectRef: { kind: 'CONSTRAINT_DEFINITION', id: constraint.id } }],
  });
}

function evaluateConstraint(subject: TypedRef, world: CapturedWorld, context: EvaluationContext, constraint: WConstraintDefinition) {
  const journey = context.effective.journeys.find((candidate) => candidate.journeyRef.id === subject.id);
  const originalStayId = operandItemId(constraint, 'original_stay_item');
  const arrivalItemId = operandItemId(constraint, 'arrival_item');
  if (!journey || !originalStayId || !arrivalItemId) {
    return unknown(subject, constraint, 'arrival_alignment_operands_missing', [{ kind: 'CONSTRAINT_DEFINITION', id: constraint.id }]);
  }
  const original = journey.items.find((item) => item.itemRef.id === originalStayId);
  const arrival = journey.items.find((item) => item.itemRef.id === arrivalItemId);
  if (!original || original.kind !== 'STAY' || !arrival || arrival.kind !== 'TRANSPORT') {
    return unknown(subject, constraint, 'arrival_alignment_items_missing', [
      { kind: 'CONSTRAINT_DEFINITION', id: constraint.id },
      { kind: 'JOURNEY_ITEM', id: originalStayId }, { kind: 'JOURNEY_ITEM', id: arrivalItemId },
    ]);
  }
  const placeId = original.startPlaceId;
  const place = placeId ? world.places.find((candidate) => candidate.id === placeId) : undefined;
  if (!place || arrival.end.value === null || original.start.value === null || original.end.value === null) {
    return unknown(subject, constraint, 'arrival_alignment_time_or_place_unknown', [
      { kind: 'CONSTRAINT_DEFINITION', id: constraint.id }, original.itemRef, arrival.itemRef,
    ]);
  }
  const arrivalDate = localDate(arrival.end.value, place.timeZone);
  const originalStart = localDate(original.start.value, place.timeZone);
  const originalCheckout = localDate(original.end.value, place.timeZone);
  if (!arrivalDate || !originalStart || !originalCheckout) {
    return unknown(subject, constraint, 'arrival_alignment_local_date_unknown', [
      { kind: 'CONSTRAINT_DEFINITION', id: constraint.id }, original.itemRef, arrival.itemRef,
    ]);
  }
  const related = [{ kind: 'CONSTRAINT_DEFINITION' as const, id: constraint.id }, original.itemRef, arrival.itemRef];
  if (original.active) {
    const facts = { arrivalLocalDate: arrivalDate, stayStartLocalDate: originalStart, checkoutLocalDate: originalCheckout };
    if (arrivalDate === originalStart) {
      return explain({
        evaluatorId: EVALUATOR_ID, dimension: 'stay_arrival_date_aligned', status: 'PASS', reasonCode: 'original_stay_arrival_aligned',
        cause: { kind: 'WORLD_STATE', subjectRef: original.itemRef }, affectedSubject: subject, relatedSubjects: related, facts,
      });
    }
    // YYYY-MM-DD lexicographic order matches calendar order.
    if (arrivalDate > originalStart && arrivalDate < originalCheckout) {
      // Arrival after the check-in date is a first-night no-show. The booking
      // counts only when reviewed/provider evidence shows it survives.
      const cutoff = operand(constraint, 'no_show_cutoff')?.instant ?? null;
      const retained = operand(constraint, 'late_arrival_retained')?.boolean ?? null;
      const survives = cutoff !== null ? Date.parse(arrival.end.value) <= Date.parse(cutoff) : retained;
      if (survives === true) {
        return explain({
          evaluatorId: EVALUATOR_ID, dimension: 'stay_arrival_date_aligned', status: 'PASS', reasonCode: 'original_stay_survives_late_arrival',
          cause: { kind: 'WORLD_STATE', subjectRef: original.itemRef }, affectedSubject: subject, relatedSubjects: related,
          facts: { ...facts, ...(cutoff !== null ? { noShowCutoff: cutoff } : { lateArrivalRetained: true }) },
        });
      }
      if (survives === false) {
        return explain({
          evaluatorId: EVALUATOR_ID, dimension: 'stay_arrival_date_aligned', status: 'FAIL', reasonCode: 'original_stay_forfeited_by_late_arrival',
          cause: { kind: 'REQUIREMENT', subjectRef: { kind: 'CONSTRAINT_DEFINITION', id: constraint.id } }, affectedSubject: subject, relatedSubjects: related,
          facts: { ...facts, ...(cutoff !== null ? { noShowCutoff: cutoff } : { lateArrivalRetained: false }) },
        });
      }
      return unknown(subject, constraint, 'original_stay_late_arrival_survival_unknown', related);
    }
    return explain({
      evaluatorId: EVALUATOR_ID, dimension: 'stay_arrival_date_aligned', status: 'FAIL', reasonCode: 'active_original_stay_misaligned',
      cause: { kind: 'REQUIREMENT', subjectRef: { kind: 'CONSTRAINT_DEFINITION', id: constraint.id } }, affectedSubject: subject, relatedSubjects: related,
      facts: { arrivalLocalDate: arrivalDate, stayStartLocalDate: originalStart, checkoutLocalDate: originalCheckout },
    });
  }
  const replacement = journey.items.find((item) => {
    if (!item.active || item.kind !== 'STAY' || item.itemRef.id === original.itemRef.id) return false;
    if (item.startPlaceId !== placeId || item.start.value === null || item.end.value === null) return false;
    return localDate(item.start.value, place.timeZone) === arrivalDate
      && localDate(item.end.value, place.timeZone) === originalCheckout;
  });
  if (replacement) {
    return explain({
      evaluatorId: EVALUATOR_ID, dimension: 'stay_arrival_date_aligned', status: 'PASS', reasonCode: 'replacement_stay_arrival_aligned',
      cause: { kind: 'WORLD_STATE', subjectRef: replacement.itemRef }, affectedSubject: subject,
      relatedSubjects: [...related, replacement.itemRef], facts: { arrivalLocalDate: arrivalDate, checkoutLocalDate: originalCheckout },
    });
  }
  return explain({
    evaluatorId: EVALUATOR_ID, dimension: 'stay_arrival_date_aligned', status: 'FAIL', reasonCode: 'arrival_aligned_replacement_missing',
    cause: { kind: 'REQUIREMENT', subjectRef: { kind: 'CONSTRAINT_DEFINITION', id: constraint.id } }, affectedSubject: subject, relatedSubjects: related,
    facts: { arrivalLocalDate: arrivalDate, checkoutLocalDate: originalCheckout },
  });
}

export const stayArrivalDateAlignedEvaluator: Evaluator = {
  id: EVALUATOR_ID,
  version: '1',
  assessmentKind: 'VIABILITY',
  subjectKinds: ['JOURNEY'],
  dimensions: ['stay_arrival_date_aligned'],
  informationTopics: [],
  evaluate(subject, context): EvaluatorOutput {
    const journey = context.effective.journeys.find((candidate) => candidate.journeyRef.id === subject.id);
    if (!journey) return { dimensions: [notApplicable('stay_arrival_date_aligned')], evidence: [], missingCoverage: [] };
    const constraints = constraintsFor(context.world, journey, 'stay_arrival_date_aligned');
    if (constraints.length === 0) return { dimensions: [notApplicable('stay_arrival_date_aligned')], evidence: [], missingCoverage: [] };
    const explanations = constraints.map((constraint) => evaluateConstraint(subject, context.world, context, constraint));
    return { dimensions: [dimension({ dimension: 'stay_arrival_date_aligned', explanations, blocking: true })], evidence: [], missingCoverage: [] };
  },
};
