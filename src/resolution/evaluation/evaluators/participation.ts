/**
 * NORTHSTAR M6 L2 — `m6.participation`: programme obligations per Journey.
 *
 * Contract: docs/refactor/evidence/M6_EVALUATOR_CONTRACT.md §2 L2.
 *
 * A Journey is assessed for the `WParticipation` rows of its own traveller
 * (`journey.travellerId`). REQUIRED obligations feed `programme_participation`
 * (blocking); OPTIONAL/INFORMED feed `optional_participation` (non-blocking).
 * Every Journey is assessed on its own itinerary, so the same programme item
 * can PASS for one traveller and FAIL for another — no averaging across
 * people (contract §1.8).
 *
 * A CANCELLED programme item removes the obligation (PASS
 * `programme_item_cancelled`); otherwise the traveller must reach the item's
 * place by its window start (`reachPlaceBy`) and — once there — the first
 * active transport item departing from that place (or a place with a
 * registered transfer to it) after that arrival must not depart before
 * `window.end` (plus any transfer minutes needed to reach it), else FAIL
 * `departs_before_item_ends`. Absence of such a departing item is not a
 * failure ("none -> fine"); absence of its *time* is UNKNOWN, never PASS.
 */
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { Instant } from '../../../domain/v2/shared/time.ts';
import type { CausalExplanation, EvidenceRef } from '../../../contracts/v2/assessment/explanation.ts';
import type { CapturedWorld, WParticipation, WProgrammeItem } from '../../world/world.ts';
import type { EffectiveItem, EffectiveJourney } from '../../world/effectiveTypes.ts';
import type { DimensionResult, EvaluationContext, Evaluator, EvaluatorOutput } from '../evaluator.ts';
import { addMinutes, dimension, earliestAfter, explain, notApplicable } from '../explain.ts';
import { reachPlaceBy, transferMinutes, constraintsFor } from '../reachability.ts';
import { operandNumber } from '../constraintTypes.ts';
import {
  evaluateProgrammeArrivalReadiness,
  PROGRAMME_ARRIVAL_READINESS_CONSTRAINT,
  readinessMinutesFromOperatingRequirements,
  requiresPhysicalPresenceFromOperatingRequirements,
} from '../programmeArrivalReadiness.ts';

function resolveReadinessMinutes(
  world: CapturedWorld,
  journey: EffectiveJourney,
  programmeItem: WProgrammeItem,
): number | undefined {
  const fromItem = readinessMinutesFromOperatingRequirements(programmeItem.operatingRequirements);
  if (fromItem !== undefined) return fromItem;

  const constraints = constraintsFor(world, journey, PROGRAMME_ARRIVAL_READINESS_CONSTRAINT);
  const scoped = constraints.filter((c) =>
    (c.owner.kind === 'PROGRAMME_ITEM' && c.owner.id === programmeItem.id)
    || (c.owner.kind === 'PROGRAMME' && c.owner.id === programmeItem.programmeId)
    || c.owner.kind === 'ORGANISATION'
    || c.owner.kind === 'EVENT'
    || c.owner.kind === 'TRIP'
    || c.owner.kind === 'JOURNEY'
    || c.owner.kind === 'TRAVELLER',
  );
  const minutes = scoped
    .map((c) => operandNumber(c, 'minutes'))
    .filter((n): n is number => n !== undefined);
  if (minutes.length === 0) return undefined;
  // Most conservative: largest required readiness window.
  return Math.max(...minutes);
}

export const EVALUATOR_ID = 'm6.participation';
const VERSION = '1';

type DimensionName = 'programme_participation' | 'optional_participation';

function dimensionFor(participation: WParticipation): DimensionName {
  return participation.obligation === 'REQUIRED' ? 'programme_participation' : 'optional_participation';
}

interface ParticipationEvaluation {
  dim: DimensionName;
  explanation: CausalExplanation;
  invalidations: (Instant | undefined)[];
}

interface DepartureCandidate {
  item: EffectiveItem;
  transferMinutesNeeded: number;
  constraintId: string | null;
}

function eligibleDepartures(world: CapturedWorld, journey: EffectiveJourney, itemPlaceId: string): DepartureCandidate[] {
  const transports = journey.items.filter((i) => i.active && i.kind === 'TRANSPORT');
  const candidates: DepartureCandidate[] = [];
  for (const t of transports) {
    if (t.startPlaceId === itemPlaceId) {
      candidates.push({ item: t, transferMinutesNeeded: 0, constraintId: null });
      continue;
    }
    if (t.startPlaceId) {
      const transfer = transferMinutes(world, journey, itemPlaceId, t.startPlaceId);
      if (transfer) candidates.push({ item: t, transferMinutesNeeded: transfer.minutes, constraintId: transfer.constraint.id });
    }
  }
  return candidates;
}

function evaluateParticipation(participation: WParticipation, journey: EffectiveJourney, world: CapturedWorld): ParticipationEvaluation {
  const affectedSubject = journey.journeyRef;
  const dim = dimensionFor(participation);
  const relatedSubjects: TypedRef[] = [{ kind: 'PARTICIPATION', id: participation.id }];
  const evaluatorId = EVALUATOR_ID;

  const programmeItem = world.programmeItems.find((p) => p.id === participation.programmeItemId);
  if (!programmeItem) {
    return {
      dim,
      invalidations: [],
      explanation: explain({
        evaluatorId, dimension: dim, status: 'UNKNOWN', reasonCode: 'programme_item_not_captured',
        cause: { kind: 'MISSING_INFORMATION' }, affectedSubject, relatedSubjects,
        uncertainty: [{ kind: 'MISSING_INPUT', code: 'programme_item', subjectRef: { kind: 'PARTICIPATION', id: participation.id } }],
      }),
    };
  }

  const withItem = [...relatedSubjects, { kind: 'PROGRAMME_ITEM', id: programmeItem.id } as TypedRef];

  if (programmeItem.lifecycleStatus === 'CANCELLED') {
    return {
      dim,
      invalidations: [],
      explanation: explain({
        evaluatorId, dimension: dim, status: 'PASS', reasonCode: 'programme_item_cancelled',
        cause: { kind: 'WORLD_STATE' }, affectedSubject, relatedSubjects: withItem,
        facts: { programmeItemStatus: programmeItem.lifecycleStatus },
      }),
    };
  }

  const window = programmeItem.window;
  const placeId = programmeItem.placeId;
  if (!window || !placeId) {
    return {
      dim,
      invalidations: [],
      explanation: explain({
        evaluatorId, dimension: dim, status: 'UNKNOWN', reasonCode: 'participation_schedule_unknown',
        cause: { kind: 'MISSING_INFORMATION' }, affectedSubject, relatedSubjects: withItem,
        uncertainty: [{ kind: 'MISSING_INPUT', code: 'programme_item_window', subjectRef: { kind: 'PROGRAMME_ITEM', id: programmeItem.id } }],
      }),
    };
  }

  const windowStart = window.start;
  const windowEnd = window.end;
  const reach = reachPlaceBy(world, journey, placeId, windowStart);
  const reachRelated = [
    ...withItem,
    ...(reach.item ? [reach.item.itemRef] : []),
    ...(reach.constraint ? [{ kind: 'CONSTRAINT_DEFINITION', id: reach.constraint.id } as TypedRef] : []),
  ];
  const arrivalFacts = { deadline: windowStart, arrival: reach.arrival ?? null, readyAt: reach.readyAt ?? null, slackMinutes: reach.slackMinutes ?? null, transferMinutes: reach.transferMinutes ?? null };

  if (reach.status !== 'PASS') {
    return {
      dim,
      invalidations: [windowStart],
      explanation: explain({
        evaluatorId, dimension: dim, status: reach.status, reasonCode: reach.reasonCode,
        cause: { kind: 'REQUIREMENT', subjectRef: { kind: 'PROGRAMME_ITEM', id: programmeItem.id } }, affectedSubject,
        relatedSubjects: reachRelated, facts: arrivalFacts, uncertainty: reach.uncertainty,
      }),
    };
  }

  // REQUIRED + physical-presence: enforce rule-driven arrival readiness window.
  const physicalPresence = requiresPhysicalPresenceFromOperatingRequirements(programmeItem.operatingRequirements);
  if (participation.obligation === 'REQUIRED' && physicalPresence) {
    const requiredMinutes = resolveReadinessMinutes(world, journey, programmeItem);
    const readiness = evaluateProgrammeArrivalReadiness({
      scheduledArrival: reach.arrival ?? reach.readyAt,
      commitmentStart: windowStart,
      requiredMinutes,
      requiresPhysicalPresence: true,
      obligation: 'REQUIRED',
    });
    const readinessFacts = { ...arrivalFacts, ...readiness.facts, readinessReason: readiness.reasonCode };
    if (readiness.verdict === 'FAIL' || readiness.verdict === 'UNKNOWN') {
      return {
        dim,
        invalidations: [windowStart],
        explanation: explain({
          evaluatorId,
          dimension: dim,
          status: readiness.verdict,
          reasonCode: readiness.reasonCode,
          cause: { kind: 'REQUIREMENT', subjectRef: { kind: 'PROGRAMME_ITEM', id: programmeItem.id } },
          affectedSubject,
          relatedSubjects: reachRelated,
          facts: readinessFacts,
          ...(readiness.verdict === 'UNKNOWN'
            ? { uncertainty: [{ kind: 'MISSING_INPUT' as const, code: 'programme_arrival_readiness_minutes', subjectRef: { kind: 'PROGRAMME_ITEM' as const, id: programmeItem.id } }] }
            : {}),
        }),
      };
    }
  }

  // Arrival PASS: check departure after the item's window using the arrival actually used.
  const arrivedAt = reach.readyAt ?? (reach.arrival as Instant);
  const eligible = eligibleDepartures(world, journey, placeId);
  const timed = eligible
    .filter((c) => c.item.start.value !== null && (c.item.start.value as string) > arrivedAt)
    .sort((a, b) => Date.parse(a.item.start.value as string) - Date.parse(b.item.start.value as string));
  const untimed = eligible.filter((c) => c.item.start.value === null);
  const candidate = timed[0];

  if (candidate) {
    const requiredDeparture = addMinutes(windowEnd, candidate.transferMinutesNeeded);
    const departRelated = [
      ...reachRelated,
      candidate.item.itemRef,
      ...(candidate.constraintId ? [{ kind: 'CONSTRAINT_DEFINITION', id: candidate.constraintId } as TypedRef] : []),
    ];
    const departureFacts = { ...arrivalFacts, windowEnd, requiredDeparture, actualDeparture: candidate.item.start.value, departureTransferMinutes: candidate.transferMinutesNeeded };
    if ((candidate.item.start.value as string) < requiredDeparture) {
      return {
        dim,
        invalidations: [windowStart, windowEnd],
        explanation: explain({
          evaluatorId, dimension: dim, status: 'FAIL', reasonCode: 'departs_before_item_ends',
          cause: { kind: 'REQUIREMENT', subjectRef: { kind: 'PROGRAMME_ITEM', id: programmeItem.id } }, affectedSubject,
          relatedSubjects: departRelated, facts: departureFacts,
        }),
      };
    }
    return {
      dim,
      invalidations: [windowStart, windowEnd],
      explanation: explain({
        evaluatorId, dimension: dim, status: 'PASS', reasonCode: 'participation_feasible',
        cause: { kind: 'REQUIREMENT', subjectRef: { kind: 'PROGRAMME_ITEM', id: programmeItem.id } }, affectedSubject,
        relatedSubjects: departRelated, facts: departureFacts,
      }),
    };
  }

  if (untimed.length > 0) {
    return {
      dim,
      invalidations: [windowStart, windowEnd],
      explanation: explain({
        evaluatorId, dimension: dim, status: 'UNKNOWN', reasonCode: 'departure_time_unknown',
        cause: { kind: 'MISSING_INFORMATION' }, affectedSubject,
        relatedSubjects: [...reachRelated, ...untimed.map((c) => c.item.itemRef)],
        facts: arrivalFacts,
        uncertainty: untimed.map((c) => ({ kind: 'MISSING_INPUT' as const, code: 'departure_time', subjectRef: c.item.itemRef })),
      }),
    };
  }

  // No eligible departing item at all: nothing to fail against ("none -> fine").
  return {
    dim,
    invalidations: [windowStart, windowEnd],
    explanation: explain({
      evaluatorId, dimension: dim, status: 'PASS', reasonCode: 'participation_feasible',
      cause: { kind: 'REQUIREMENT', subjectRef: { kind: 'PROGRAMME_ITEM', id: programmeItem.id } }, affectedSubject,
      relatedSubjects: reachRelated, facts: arrivalFacts,
    }),
  };
}

function collectEvidence(explanations: CausalExplanation[]): EvidenceRef[] {
  const map = new Map<string, EvidenceRef>();
  for (const e of explanations) for (const ev of e.evidenceRefs) map.set(`${ev.kind}:${ev.id}:${ev.detail ?? ''}`, ev);
  return [...map.values()].sort((a, b) => `${a.kind}:${a.id}:${a.detail ?? ''}`.localeCompare(`${b.kind}:${b.id}:${b.detail ?? ''}`));
}

function evaluate(subject: TypedRef, context: EvaluationContext): EvaluatorOutput {
  const journey = context.effective.journeys.find((j) => j.journeyRef.id === subject.id);
  if (!journey) {
    return { dimensions: [notApplicable('programme_participation'), notApplicable('optional_participation')], evidence: [], missingCoverage: [] };
  }

  const participations = context.world.participations
    .filter((p) => p.travellerId === journey.travellerId)
    .sort((a, b) => a.id.localeCompare(b.id));

  const required: CausalExplanation[] = [];
  const optional: CausalExplanation[] = [];
  const invalidations: (Instant | undefined)[] = [];

  for (const participation of participations) {
    const evaluated = evaluateParticipation(participation, journey, context.world);
    invalidations.push(...evaluated.invalidations);
    (evaluated.dim === 'programme_participation' ? required : optional).push(evaluated.explanation);
  }

  const dimensions: DimensionResult[] = [
    required.length > 0 ? dimension({ dimension: 'programme_participation', explanations: required, blocking: true }) : notApplicable('programme_participation'),
    optional.length > 0 ? dimension({ dimension: 'optional_participation', explanations: optional, blocking: false }) : notApplicable('optional_participation'),
  ];

  const nextInvalidationAt = earliestAfter(context.now, invalidations);
  return {
    dimensions,
    evidence: collectEvidence([...required, ...optional]),
    missingCoverage: [],
    ...(nextInvalidationAt ? { nextInvalidationAt } : {}),
  };
}

export const participationEvaluator: Evaluator = {
  id: EVALUATOR_ID,
  version: VERSION,
  assessmentKind: 'VIABILITY',
  subjectKinds: ['JOURNEY'],
  dimensions: ['programme_participation', 'optional_participation'],
  informationTopics: [],
  evaluate,
};
