/**
 * NORTHSTAR M6 — m6.connection: connection feasibility between consecutive
 * (or explicitly linked) active TRANSPORT items of a Journey.
 *
 * docs/refactor/evidence/M6_EVALUATOR_CONTRACT.md §2 L1 `m6.connection`. Pure
 * function of (subject, { world, effective }); no I/O, no clock reads (the
 * dimension never compares against `now`, so `nextInvalidationAt` is always
 * undefined here — a pure time comparison with no future crossing).
 *
 * Contract gap (documented, resolved conservatively — see hand-off findings):
 * "Unknown time ⇒ UNKNOWN connection_time_unknown" is stated under the
 * "same place" bullet only; this file applies the same guard before branching
 * on same/different place, since a gap cannot be computed from an unknown
 * instant either way and absence must never fall through to PASS/FAIL.
 */
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { Instant } from '../../../domain/v2/shared/time.ts';
import type { CausalExplanation, EvidenceRef } from '../../../contracts/v2/assessment/explanation.ts';
import type { EffectiveItem, EffectiveJourney } from '../../world/effectiveTypes.ts';
import type { CapturedWorld, WConstraintDefinition } from '../../world/world.ts';
import type { EvaluationContext, Evaluator, EvaluatorOutput } from '../evaluator.ts';
import { operandNumber, operandSubjectId } from '../constraintTypes.ts';
import { constraintsFor, transferMinutes } from '../reachability.ts';
import { dimension, explain, minutesBetween, notApplicable } from '../explain.ts';

const EVALUATOR_ID = 'm6.connection';

function transportItemsOf(journey: EffectiveJourney): EffectiveItem[] {
  return journey.items.filter((i) => i.active && i.kind === 'TRANSPORT');
}

/** Resolve a dependency endpoint (JOURNEY_ITEM or TRANSPORT_SERVICE ref) to one of this Journey's active transport items. */
function resolveEndpoint(ref: TypedRef, byItem: Map<string, EffectiveItem>, byService: Map<string, EffectiveItem>): EffectiveItem | undefined {
  if (ref.kind === 'JOURNEY_ITEM') return byItem.get(ref.id);
  if (ref.kind === 'TRANSPORT_SERVICE') return byService.get(ref.id);
  return undefined;
}

function connectionPairs(world: CapturedWorld, journey: EffectiveJourney): [EffectiveItem, EffectiveItem][] {
  const items = transportItemsOf(journey);
  const byItem = new Map(items.map((i) => [i.itemRef.id, i] as const));
  const byService = new Map(items.filter((i) => i.serviceRef !== null).map((i) => [(i.serviceRef as TypedRef).id, i] as const));

  const seen = new Set<string>();
  const pairs: [EffectiveItem, EffectiveItem][] = [];
  const add = (a: EffectiveItem, b: EffectiveItem) => {
    const key = `${a.itemRef.id}>${b.itemRef.id}`;
    if (seen.has(key) || a.itemRef.id === b.itemRef.id) return;
    seen.add(key);
    pairs.push([a, b]);
  };

  for (let i = 0; i + 1 < items.length; i += 1) {
    const a = items[i];
    const b = items[i + 1];
    if (a && b) add(a, b);
  }
  for (const dep of world.dependencies) {
    if (dep.dependencyKind !== 'CONNECTS_TO') continue;
    const a = resolveEndpoint(dep.from, byItem, byService);
    const b = resolveEndpoint(dep.to, byItem, byService);
    if (a && b) add(a, b);
  }
  return pairs;
}

/** Applicable `minimum_connection_minutes` at `placeId`: unscoped or scoped to this place; the largest applicable wins. */
function applicableMinimum(world: CapturedWorld, journey: EffectiveJourney, placeId: string): { minutes: number; constraint: WConstraintDefinition } | undefined {
  const candidates = constraintsFor(world, journey, 'minimum_connection_minutes')
    .map((c) => ({ constraint: c, place: operandSubjectId(c, 'place'), minutes: operandNumber(c, 'minutes') }))
    .filter((c): c is { constraint: WConstraintDefinition; place: string | undefined; minutes: number } => c.minutes !== undefined && (c.place === undefined || c.place === placeId));
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, next) => (next.minutes > best.minutes ? next : best));
}

function pairFacts(a: EffectiveItem, b: EffectiveItem, gapMinutes: number | null, requiredMinutes: number | null): Record<string, string | number | boolean | null> {
  return {
    gapMinutes,
    requiredMinutes,
    upstreamArrival: a.end.value,
    downstreamDeparture: b.start.value,
    arrivalBasis: a.end.basis,
    departureBasis: b.start.basis,
  };
}

function pairEvidence(a: EffectiveItem, b: EffectiveItem): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  if (a.end.evidenceId) refs.push({ kind: 'SUPPLIER_OBSERVATION', id: a.end.evidenceId, detail: 'upstream_arrival' });
  if (b.start.evidenceId) refs.push({ kind: 'SUPPLIER_OBSERVATION', id: b.start.evidenceId, detail: 'downstream_departure' });
  return refs;
}

function evaluatePair(subject: TypedRef, world: CapturedWorld, journey: EffectiveJourney, a: EffectiveItem, b: EffectiveItem): CausalExplanation {
  const relatedSubjects = [a.itemRef, b.itemRef];
  const evidenceRefs = pairEvidence(a, b);

  if (a.end.value === null || b.start.value === null) {
    const missingRef = a.end.value === null ? a.itemRef : b.itemRef;
    return explain({
      evaluatorId: EVALUATOR_ID, dimension: 'connection_feasibility', status: 'UNKNOWN', reasonCode: 'connection_time_unknown',
      cause: { kind: 'MISSING_INFORMATION', subjectRef: missingRef }, affectedSubject: subject, relatedSubjects, evidenceRefs,
      facts: pairFacts(a, b, null, null),
      uncertainty: [{ kind: 'MISSING_INPUT', code: a.end.value === null ? 'arrival_time' : 'departure_time', subjectRef: missingRef }],
    });
  }

  const arrival = a.end.value as Instant;
  const departure = b.start.value as Instant;
  const gapMinutes = minutesBetween(arrival, departure);
  const samePlace = a.endPlaceId !== null && a.endPlaceId === b.startPlaceId;

  if (samePlace) {
    const place = a.endPlaceId as string;
    if (gapMinutes < 0) {
      return explain({
        evaluatorId: EVALUATOR_ID, dimension: 'connection_feasibility', status: 'FAIL', reasonCode: 'connection_broken',
        cause: { kind: 'WORLD_STATE', subjectRef: a.itemRef }, affectedSubject: subject, relatedSubjects, evidenceRefs,
        facts: pairFacts(a, b, gapMinutes, null),
      });
    }
    const minimum = applicableMinimum(world, journey, place);
    if (!minimum) {
      return explain({
        evaluatorId: EVALUATOR_ID, dimension: 'connection_feasibility', status: 'UNKNOWN', reasonCode: 'minimum_connection_time_missing',
        cause: { kind: 'MISSING_INFORMATION', subjectRef: { kind: 'PLACE', id: place } }, affectedSubject: subject, relatedSubjects, evidenceRefs,
        facts: pairFacts(a, b, gapMinutes, null),
        uncertainty: [{ kind: 'MISSING_INPUT', code: 'minimum_connection_minutes', subjectRef: { kind: 'PLACE', id: place } }],
      });
    }
    const withConstraint = [...relatedSubjects, { kind: 'CONSTRAINT_DEFINITION' as const, id: minimum.constraint.id }];
    if (gapMinutes >= minimum.minutes) {
      return explain({
        evaluatorId: EVALUATOR_ID, dimension: 'connection_feasibility', status: 'PASS', reasonCode: 'connection_meets_minimum',
        cause: { kind: 'REQUIREMENT', subjectRef: { kind: 'CONSTRAINT_DEFINITION', id: minimum.constraint.id } }, affectedSubject: subject,
        relatedSubjects: withConstraint, evidenceRefs, facts: pairFacts(a, b, gapMinutes, minimum.minutes),
      });
    }
    return explain({
      evaluatorId: EVALUATOR_ID, dimension: 'connection_feasibility', status: 'FAIL', reasonCode: 'connection_below_minimum',
      cause: { kind: 'REQUIREMENT', subjectRef: { kind: 'CONSTRAINT_DEFINITION', id: minimum.constraint.id } }, affectedSubject: subject,
      relatedSubjects: withConstraint, evidenceRefs, facts: pairFacts(a, b, gapMinutes, minimum.minutes),
    });
  }

  // Different places (or a place unresolved on either end): need a registered transfer time.
  if (a.endPlaceId === null || b.startPlaceId === null) {
    const missingRef = a.endPlaceId === null ? a.itemRef : b.itemRef;
    return explain({
      evaluatorId: EVALUATOR_ID, dimension: 'connection_feasibility', status: 'UNKNOWN', reasonCode: 'route_discontinuity',
      cause: { kind: 'MISSING_INFORMATION', subjectRef: missingRef }, affectedSubject: subject, relatedSubjects, evidenceRefs,
      facts: pairFacts(a, b, gapMinutes, null),
      uncertainty: [{ kind: 'MISSING_INPUT', code: 'transfer_minutes', subjectRef: missingRef }],
    });
  }
  const transfer = transferMinutes(world, journey, a.endPlaceId, b.startPlaceId);
  if (!transfer) {
    return explain({
      evaluatorId: EVALUATOR_ID, dimension: 'connection_feasibility', status: 'UNKNOWN', reasonCode: 'route_discontinuity',
      cause: { kind: 'MISSING_INFORMATION', subjectRef: a.itemRef }, affectedSubject: subject, relatedSubjects, evidenceRefs,
      facts: pairFacts(a, b, gapMinutes, null),
      uncertainty: [{ kind: 'MISSING_INPUT', code: 'transfer_minutes', subjectRef: a.itemRef }],
    });
  }
  const withConstraint = [...relatedSubjects, { kind: 'CONSTRAINT_DEFINITION' as const, id: transfer.constraint.id }];
  if (gapMinutes >= transfer.minutes) {
    return explain({
      evaluatorId: EVALUATOR_ID, dimension: 'connection_feasibility', status: 'PASS', reasonCode: 'transfer_fits',
      cause: { kind: 'REQUIREMENT', subjectRef: { kind: 'CONSTRAINT_DEFINITION', id: transfer.constraint.id } }, affectedSubject: subject,
      relatedSubjects: withConstraint, evidenceRefs, facts: pairFacts(a, b, gapMinutes, transfer.minutes),
    });
  }
  return explain({
    evaluatorId: EVALUATOR_ID, dimension: 'connection_feasibility', status: 'FAIL', reasonCode: 'transfer_does_not_fit',
    cause: { kind: 'REQUIREMENT', subjectRef: { kind: 'CONSTRAINT_DEFINITION', id: transfer.constraint.id } }, affectedSubject: subject,
    relatedSubjects: withConstraint, evidenceRefs, facts: pairFacts(a, b, gapMinutes, transfer.minutes),
  });
}

export const connectionEvaluator: Evaluator = {
  id: EVALUATOR_ID,
  version: '1',
  assessmentKind: 'VIABILITY',
  subjectKinds: ['JOURNEY'],
  dimensions: ['connection_feasibility'],
  informationTopics: [],
  evaluate(subject: TypedRef, { world, effective }: EvaluationContext): EvaluatorOutput {
    const journey = effective.journeys.find((j) => j.journeyRef.id === subject.id);
    if (!journey || transportItemsOf(journey).length < 2) {
      return { dimensions: [notApplicable('connection_feasibility')], evidence: [], missingCoverage: [] };
    }
    const pairs = connectionPairs(world, journey);
    const explanations = pairs.map(([a, b]) => evaluatePair(subject, world, journey, a, b));
    const dim = dimension({ dimension: 'connection_feasibility', explanations, blocking: true });
    const evidence = [...new Map(dim.explanations.flatMap((e) => e.evidenceRefs).map((e) => [`${e.kind}:${e.id}:${e.detail ?? ''}`, e])).values()];
    return { dimensions: [dim], evidence, missingCoverage: [] };
  },
};
