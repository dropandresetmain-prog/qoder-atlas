/**
 * NORTHSTAR M6 — m6.booking: supplier fulfilment of TRANSPORT items and
 * per-booking validity, independent of Journey viability.
 *
 * docs/refactor/evidence/M6_EVALUATOR_CONTRACT.md §2 L1 `m6.booking`. Pure
 * function of (subject, { world, effective }); no I/O, no clock reads.
 *
 * Contract gap (documented, resolved conservatively — see hand-off findings):
 * the contract names the FAIL/UNKNOWN reason codes for `supplier_fulfilment`
 * (`booking_invalid`, `booking_state_unknown`) but not a PASS code for "all
 * bookings VALID"; this file uses `supplier_fulfilled` for that case only.
 */
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { CausalExplanation, EvidenceRef } from '../../../contracts/v2/assessment/explanation.ts';
import type { BookingState, EffectiveItem } from '../../world/effectiveTypes.ts';
import type { CapturedWorld } from '../../world/world.ts';
import type { EvaluationContext, Evaluator, EvaluatorOutput } from '../evaluator.ts';
import { dimension, explain, notApplicable } from '../explain.ts';

const EVALUATOR_ID = 'm6.booking';

function lineEvidence(world: CapturedWorld, booking: BookingState): EvidenceRef | undefined {
  const line = world.reservationLines.find((l) => l.id === booking.lineRef.id);
  return line?.evidenceId ? { kind: 'SUPPLIER_OBSERVATION', id: line.evidenceId, detail: 'reservation_line_status' } : undefined;
}

function uniqueEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  return [...new Map(refs.map((e) => [`${e.kind}:${e.id}:${e.detail ?? ''}`, e])).values()];
}

function bookingFacts(booking: BookingState): Record<string, string | number | boolean | null> {
  return { reservationStatus: booking.reservationStatus, lineStatus: booking.lineStatus };
}

/** One explanation per booking, used both for a single booking (booking_validity) and folded into an item (supplier_fulfilment). */
function bookingExplanation(subject: TypedRef, dim: string, item: EffectiveItem, booking: BookingState, world: CapturedWorld): CausalExplanation {
  const evidence = lineEvidence(world, booking);
  const relatedSubjects = [item.itemRef, booking.reservationRef, booking.lineRef];
  if (booking.bookingValid === 'VALID') {
    return explain({
      evaluatorId: EVALUATOR_ID, dimension: dim, status: 'PASS', reasonCode: 'booking_valid',
      cause: { kind: 'WORLD_STATE', subjectRef: booking.lineRef }, affectedSubject: subject,
      relatedSubjects, evidenceRefs: evidence ? [evidence] : [], facts: bookingFacts(booking),
    });
  }
  if (booking.bookingValid === 'INVALID') {
    return explain({
      evaluatorId: EVALUATOR_ID, dimension: dim, status: 'FAIL', reasonCode: 'booking_invalid',
      cause: { kind: 'WORLD_STATE', subjectRef: booking.lineRef }, affectedSubject: subject,
      relatedSubjects, evidenceRefs: evidence ? [evidence] : [], facts: bookingFacts(booking),
    });
  }
  return explain({
    evaluatorId: EVALUATOR_ID, dimension: dim, status: 'UNKNOWN', reasonCode: 'booking_state_unknown',
    cause: { kind: 'MISSING_INFORMATION', subjectRef: booking.lineRef }, affectedSubject: subject,
    relatedSubjects, evidenceRefs: evidence ? [evidence] : [], facts: bookingFacts(booking),
    uncertainty: [{ kind: 'UNKNOWN_SUPPLIER_STATE', code: 'booking_status', subjectRef: booking.lineRef }],
  });
}

function supplierFulfilmentExplanation(subject: TypedRef, world: CapturedWorld, item: EffectiveItem): CausalExplanation {
  const related: TypedRef[] = [item.itemRef, ...(item.serviceRef ? [item.serviceRef] : [])];

  if (item.bookings.length > 0) {
    const evidenceRefs = uniqueEvidence(item.bookings.map((b) => lineEvidence(world, b)).filter((e): e is EvidenceRef => e !== undefined));
    const relatedSubjects = [...related, ...item.bookings.flatMap((b) => [b.reservationRef, b.lineRef])];
    const validCount = item.bookings.filter((b) => b.bookingValid === 'VALID').length;
    const invalidCount = item.bookings.filter((b) => b.bookingValid === 'INVALID').length;
    const facts = { bookingCount: item.bookings.length, validCount, invalidCount };

    if (invalidCount > 0) {
      return explain({
        evaluatorId: EVALUATOR_ID, dimension: 'supplier_fulfilment', status: 'FAIL', reasonCode: 'booking_invalid',
        cause: { kind: 'WORLD_STATE', subjectRef: item.itemRef }, affectedSubject: subject, relatedSubjects, evidenceRefs, facts,
      });
    }
    if (validCount === item.bookings.length) {
      return explain({
        evaluatorId: EVALUATOR_ID, dimension: 'supplier_fulfilment', status: 'PASS', reasonCode: 'supplier_fulfilled',
        cause: { kind: 'WORLD_STATE', subjectRef: item.itemRef }, affectedSubject: subject, relatedSubjects, evidenceRefs, facts,
      });
    }
    return explain({
      evaluatorId: EVALUATOR_ID, dimension: 'supplier_fulfilment', status: 'UNKNOWN', reasonCode: 'booking_state_unknown',
      cause: { kind: 'MISSING_INFORMATION', subjectRef: item.itemRef }, affectedSubject: subject, relatedSubjects, evidenceRefs, facts,
      uncertainty: [{ kind: 'UNKNOWN_SUPPLIER_STATE', code: 'booking_status', subjectRef: item.itemRef }],
    });
  }

  if (item.serviceRef) {
    return explain({
      evaluatorId: EVALUATOR_ID, dimension: 'supplier_fulfilment', status: 'UNKNOWN', reasonCode: 'service_selected_not_booked',
      cause: { kind: 'MISSING_INFORMATION', subjectRef: item.itemRef }, affectedSubject: subject, relatedSubjects: related,
      uncertainty: [{ kind: 'MISSING_INPUT', code: 'booking', subjectRef: item.itemRef }],
    });
  }

  const journeyItem = world.journeyItems.find((i) => i.id === item.itemRef.id);
  if (journeyItem?.flexible) {
    return explain({
      evaluatorId: EVALUATOR_ID, dimension: 'supplier_fulfilment', status: 'PASS', reasonCode: 'flexible_item_no_supplier_required',
      cause: { kind: 'WORLD_STATE', subjectRef: item.itemRef }, affectedSubject: subject, relatedSubjects: related, facts: { flexible: true },
    });
  }
  return explain({
    evaluatorId: EVALUATOR_ID, dimension: 'supplier_fulfilment', status: 'UNKNOWN', reasonCode: 'booking_missing',
    cause: { kind: 'MISSING_INFORMATION', subjectRef: item.itemRef }, affectedSubject: subject, relatedSubjects: related,
    uncertainty: [{ kind: 'MISSING_INPUT', code: 'booking', subjectRef: item.itemRef }],
  });
}

export const bookingEvaluator: Evaluator = {
  id: EVALUATOR_ID,
  version: '1',
  assessmentKind: 'VIABILITY',
  subjectKinds: ['JOURNEY'],
  dimensions: ['supplier_fulfilment', 'booking_validity'],
  informationTopics: [],
  evaluate(subject: TypedRef, { world, effective }: EvaluationContext): EvaluatorOutput {
    const journey = effective.journeys.find((j) => j.journeyRef.id === subject.id);
    if (!journey) {
      return { dimensions: [notApplicable('supplier_fulfilment'), notApplicable('booking_validity')], evidence: [], missingCoverage: [] };
    }

    const transportItems = journey.items.filter((i) => i.active && i.kind === 'TRANSPORT');
    const supplierExplanations = transportItems.map((item) => supplierFulfilmentExplanation(subject, world, item));
    const supplierDim = transportItems.length > 0
      ? dimension({ dimension: 'supplier_fulfilment', explanations: supplierExplanations, blocking: true })
      : notApplicable('supplier_fulfilment');

    const activeItems = journey.items.filter((i) => i.active);
    const allBookings = activeItems.flatMap((item) => item.bookings.map((booking) => ({ item, booking })));
    const bookingExplanations = allBookings.map(({ item, booking }) => bookingExplanation(subject, 'booking_validity', item, booking, world));
    const bookingDim = allBookings.length > 0
      ? dimension({ dimension: 'booking_validity', explanations: bookingExplanations, blocking: false })
      : notApplicable('booking_validity');

    const evidence = uniqueEvidence([...supplierDim.explanations, ...bookingDim.explanations].flatMap((e) => e.evidenceRefs));
    return { dimensions: [supplierDim, bookingDim], evidence, missingCoverage: [] };
  },
};
