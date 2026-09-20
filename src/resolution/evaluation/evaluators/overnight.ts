/**
 * NORTHSTAR M6 — m6.overnight: overnight accommodation coverage of long gaps
 * between consecutive active TRANSPORT items.
 *
 * docs/refactor/evidence/M6_EVALUATOR_CONTRACT.md §2 L1 `m6.overnight`. Pure
 * function of (subject, { world, effective }); no I/O, no clock reads (the
 * dimension never compares against `now`, so `nextInvalidationAt` is always
 * undefined — a pure time comparison with no future crossing).
 *
 * Contract gaps (documented, resolved conservatively — see hand-off findings):
 *  - the contract states "Unknown times ⇒ UNKNOWN" for a pair without naming a
 *    reason code; this file uses `overnight_gap_time_unknown`.
 *  - a candidate STAY whose own interval bounds are unknown (so coverage of
 *    the gap cannot be confirmed either way) is not covered by any of the
 *    three named outcomes; this file uses `stay_interval_unknown` rather than
 *    silently excluding it (which could otherwise manufacture a FAIL from an
 *    absence, the one thing the shared rules forbid).
 *  - when several `overnight_accommodation_required` constraints govern the
 *    Journey with different `minimum_gap_hours`, this file uses the smallest
 *    (the most protective: it makes the most gaps subject to the check).
 */
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import { compareInstants } from '../../../domain/v2/shared/time.ts';
import type { CausalExplanation, EvidenceRef } from '../../../contracts/v2/assessment/explanation.ts';
import type { EffectiveItem, EffectiveJourney } from '../../world/effectiveTypes.ts';
import type { CapturedWorld, WConstraintDefinition } from '../../world/world.ts';
import type { EvaluationContext, Evaluator, EvaluatorOutput } from '../evaluator.ts';
import { operandNumber } from '../constraintTypes.ts';
import { constraintsFor } from '../reachability.ts';
import { dimension, explain, minutesBetween, notApplicable } from '../explain.ts';

const EVALUATOR_ID = 'm6.overnight';

function transportItemsOf(journey: EffectiveJourney): EffectiveItem[] {
  return journey.items.filter((i) => i.active && i.kind === 'TRANSPORT');
}

function stayItemsOf(journey: EffectiveJourney): EffectiveItem[] {
  return journey.items.filter((i) => i.active && i.kind === 'STAY');
}

/** Governing `overnight_accommodation_required` constraints and the smallest `minimum_gap_hours` among them. */
function governingRequirement(world: CapturedWorld, journey: EffectiveJourney): { minimumGapHours: number; constraints: WConstraintDefinition[] } | undefined {
  const constraints = constraintsFor(world, journey, 'overnight_accommodation_required');
  const withMinutes = constraints
    .map((c) => ({ constraint: c, hours: operandNumber(c, 'minimum_gap_hours') }))
    .filter((c): c is { constraint: WConstraintDefinition; hours: number } => c.hours !== undefined);
  if (withMinutes.length === 0) return undefined;
  const minimumGapHours = withMinutes.reduce((min, next) => Math.min(min, next.hours), withMinutes[0]?.hours ?? Infinity);
  return { minimumGapHours, constraints: withMinutes.map((c) => c.constraint) };
}

type PlaceRelation = 'SAME' | 'SHARED' | 'DIFFERENT' | 'UNRESOLVED';

function placeRelation(world: CapturedWorld, stayPlaceId: string | null, gapPlaceId: string | null): PlaceRelation {
  if (stayPlaceId === null || gapPlaceId === null) return 'UNRESOLVED';
  if (stayPlaceId === gapPlaceId) return 'SAME';
  const stayJurisdictions = new Set(world.placeJurisdictions.filter((pj) => pj.placeId === stayPlaceId).map((pj) => pj.jurisdictionId));
  const gapJurisdictions = world.placeJurisdictions.filter((pj) => pj.placeId === gapPlaceId).map((pj) => pj.jurisdictionId);
  if (stayJurisdictions.size === 0 || gapJurisdictions.length === 0) return 'UNRESOLVED';
  return gapJurisdictions.some((j) => stayJurisdictions.has(j)) ? 'SHARED' : 'DIFFERENT';
}

function pairFacts(a: EffectiveItem, b: EffectiveItem, gapMinutes: number | null): Record<string, string | number | boolean | null> {
  return { gapMinutes, upstreamArrival: a.end.value, downstreamDeparture: b.start.value, arrivalBasis: a.end.basis, departureBasis: b.start.basis };
}

function pairEvidence(a: EffectiveItem, b: EffectiveItem, stay?: EffectiveItem): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  if (a.end.evidenceId) refs.push({ kind: 'SUPPLIER_OBSERVATION', id: a.end.evidenceId, detail: 'upstream_arrival' });
  if (b.start.evidenceId) refs.push({ kind: 'SUPPLIER_OBSERVATION', id: b.start.evidenceId, detail: 'downstream_departure' });
  if (stay?.start.evidenceId) refs.push({ kind: 'SUPPLIER_OBSERVATION', id: stay.start.evidenceId, detail: 'stay_start' });
  if (stay?.end.evidenceId) refs.push({ kind: 'SUPPLIER_OBSERVATION', id: stay.end.evidenceId, detail: 'stay_end' });
  return refs;
}

function byIdAsc(a: EffectiveItem, b: EffectiveItem): number {
  return a.itemRef.id.localeCompare(b.itemRef.id);
}

function evaluateGap(
  subject: TypedRef,
  world: CapturedWorld,
  a: EffectiveItem,
  b: EffectiveItem,
  stays: EffectiveItem[],
  constraints: WConstraintDefinition[],
): CausalExplanation {
  const constraintRefs = constraints.map((c) => ({ kind: 'CONSTRAINT_DEFINITION' as const, id: c.id }));
  const gapPlaceId = a.endPlaceId;

  const covering = stays.filter((s) => s.start.value !== null && s.end.value !== null && a.end.value !== null && b.start.value !== null
    && compareInstants(s.start.value, a.end.value) <= 0 && compareInstants(s.end.value, b.start.value) >= 0);
  const passCandidates = covering.filter((s) => {
    const relation = placeRelation(world, s.startPlaceId, gapPlaceId);
    return relation === 'SAME' || relation === 'SHARED';
  }).sort(byIdAsc);
  const unresolvedCandidates = covering.filter((s) => placeRelation(world, s.startPlaceId, gapPlaceId) === 'UNRESOLVED').sort(byIdAsc);
  const unknownIntervalCandidates = stays.filter((s) => s.start.value === null || s.end.value === null).sort(byIdAsc);

  const gapMinutes = a.end.value !== null && b.start.value !== null ? minutesBetween(a.end.value, b.start.value) : null;

  if (passCandidates.length > 0) {
    const stay = passCandidates[0] as EffectiveItem;
    return explain({
      evaluatorId: EVALUATOR_ID, dimension: 'overnight_accommodation', status: 'PASS', reasonCode: 'stay_covers_gap',
      cause: { kind: 'WORLD_STATE', subjectRef: stay.itemRef }, affectedSubject: subject,
      relatedSubjects: [a.itemRef, b.itemRef, stay.itemRef, ...constraintRefs],
      evidenceRefs: pairEvidence(a, b, stay), facts: pairFacts(a, b, gapMinutes),
    });
  }
  if (unresolvedCandidates.length > 0) {
    const stay = unresolvedCandidates[0] as EffectiveItem;
    return explain({
      evaluatorId: EVALUATOR_ID, dimension: 'overnight_accommodation', status: 'UNKNOWN', reasonCode: 'stay_place_unresolved',
      cause: { kind: 'MISSING_INFORMATION', subjectRef: stay.itemRef }, affectedSubject: subject,
      relatedSubjects: [a.itemRef, b.itemRef, stay.itemRef, ...constraintRefs],
      evidenceRefs: pairEvidence(a, b, stay), facts: pairFacts(a, b, gapMinutes),
      uncertainty: [{ kind: 'UNRESOLVED_LOCATION', code: 'stay_place_relation', subjectRef: stay.itemRef }],
    });
  }
  if (unknownIntervalCandidates.length > 0) {
    const stay = unknownIntervalCandidates[0] as EffectiveItem;
    return explain({
      evaluatorId: EVALUATOR_ID, dimension: 'overnight_accommodation', status: 'UNKNOWN', reasonCode: 'stay_interval_unknown',
      cause: { kind: 'MISSING_INFORMATION', subjectRef: stay.itemRef }, affectedSubject: subject,
      relatedSubjects: [a.itemRef, b.itemRef, stay.itemRef, ...constraintRefs],
      evidenceRefs: pairEvidence(a, b, stay), facts: pairFacts(a, b, gapMinutes),
      uncertainty: [{ kind: 'MISSING_INPUT', code: 'stay_interval', subjectRef: stay.itemRef }],
    });
  }
  return explain({
    evaluatorId: EVALUATOR_ID, dimension: 'overnight_accommodation', status: 'FAIL', reasonCode: 'overnight_unaccommodated',
    cause: { kind: 'REQUIREMENT', subjectRef: constraints[0] ? { kind: 'CONSTRAINT_DEFINITION', id: constraints[0].id } : a.itemRef },
    affectedSubject: subject, relatedSubjects: [a.itemRef, b.itemRef, ...constraintRefs],
    evidenceRefs: pairEvidence(a, b), facts: pairFacts(a, b, gapMinutes),
  });
}

export const overnightEvaluator: Evaluator = {
  id: EVALUATOR_ID,
  version: '2',
  assessmentKind: 'VIABILITY',
  subjectKinds: ['JOURNEY'],
  dimensions: ['overnight_accommodation'],
  informationTopics: [],
  evaluate(subject: TypedRef, { world, effective }: EvaluationContext): EvaluatorOutput {
    const journey = effective.journeys.find((j) => j.journeyRef.id === subject.id);
    if (!journey) return { dimensions: [notApplicable('overnight_accommodation')], evidence: [], missingCoverage: [] };

    const requirement = governingRequirement(world, journey);
    if (!requirement) return { dimensions: [notApplicable('overnight_accommodation')], evidence: [], missingCoverage: [] };

    const items = transportItemsOf(journey);
    const stays = stayItemsOf(journey);
    const explanations: CausalExplanation[] = [];
    for (let i = 0; i + 1 < items.length; i += 1) {
      const a = items[i];
      const b = items[i + 1];
      if (!a || !b) continue;
      if (a.end.value === null || b.start.value === null) {
        explanations.push(explain({
          evaluatorId: EVALUATOR_ID, dimension: 'overnight_accommodation', status: 'UNKNOWN', reasonCode: 'overnight_gap_time_unknown',
          cause: { kind: 'MISSING_INFORMATION', subjectRef: a.end.value === null ? a.itemRef : b.itemRef }, affectedSubject: subject,
          relatedSubjects: [a.itemRef, b.itemRef], evidenceRefs: pairEvidence(a, b), facts: pairFacts(a, b, null),
          uncertainty: [{ kind: 'MISSING_INPUT', code: a.end.value === null ? 'arrival_time' : 'departure_time', subjectRef: a.end.value === null ? a.itemRef : b.itemRef }],
        }));
        continue;
      }
      const gapHours = minutesBetween(a.end.value, b.start.value) / 60;
      if (gapHours < requirement.minimumGapHours) {
        explanations.push(explain({
          evaluatorId: EVALUATOR_ID, dimension: 'overnight_accommodation', status: 'PASS', reasonCode: 'overnight_not_required_for_gap',
          cause: { kind: 'REQUIREMENT', subjectRef: { kind: 'CONSTRAINT_DEFINITION', id: requirement.constraints[0]!.id } },
          affectedSubject: subject,
          relatedSubjects: [a.itemRef, b.itemRef, ...requirement.constraints.map((constraint) => ({ kind: 'CONSTRAINT_DEFINITION' as const, id: constraint.id }))],
          evidenceRefs: pairEvidence(a, b),
          facts: { ...pairFacts(a, b, gapHours * 60), minimumGapHours: requirement.minimumGapHours },
        }));
        continue;
      }
      explanations.push(evaluateGap(subject, world, a, b, stays, requirement.constraints));
    }

    // A known short connection satisfies this conditional obligation. An empty
    // explanation list must not manufacture uncertainty in a healthy journey.
    const dim = explanations.length ? dimension({ dimension: 'overnight_accommodation', explanations, blocking: true }) : notApplicable('overnight_accommodation');
    const evidence = [...new Map(dim.explanations.flatMap((e) => e.evidenceRefs).map((e) => [`${e.kind}:${e.id}:${e.detail ?? ''}`, e])).values()];
    return { dimensions: [dim], evidence, missingCoverage: [] };
  },
};
