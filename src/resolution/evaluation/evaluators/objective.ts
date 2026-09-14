/**
 * NORTHSTAR M6 L2 — `m6.objective`: hard/soft/waived objective viability per Journey.
 *
 * Contract: docs/refactor/evidence/M6_EVALUATOR_CONTRACT.md §2 L2.
 *
 * Objectives governing a Journey are those owned by the Journey itself, its
 * Trip, or a coordination group the Journey is a member of. A Trip- or
 * group-owned objective is evaluated separately for every member Journey
 * (each Journey gets its own explanation, its own reach computation).
 *
 * WAIVED / CLOSED_WITH_LOSS objectives are reported only in
 * `waived_objectives` (non-blocking) — they never relax `hard_objectives` or
 * `soft_objectives` (AT20: an authorised loss never relaxes another
 * dimension). ACTIVE objectives are evaluated by `successPredicateKind`;
 * anything other than `ARRIVAL_BY` / `ATTEND` (e.g. `STATEMENT`,
 * `COMPLETE_ITEMS`, `BOUND_SPEND`) has no registered evaluation semantics
 * here and is reported UNKNOWN `objective_predicate_unsupported`
 * (UNSUPPORTED_EVALUATION) — never silently PASS.
 */
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { Instant } from '../../../domain/v2/shared/time.ts';
import type { CausalExplanation, EvidenceRef } from '../../../contracts/v2/assessment/explanation.ts';
import type { CapturedWorld, WObjective } from '../../world/world.ts';
import type { EffectiveJourney } from '../../world/effectiveTypes.ts';
import type { DimensionResult, EvaluationContext, Evaluator, EvaluatorOutput } from '../evaluator.ts';
import { dimension, earliestAfter, explain, notApplicable } from '../explain.ts';
import { reachPlaceBy } from '../reachability.ts';

export const EVALUATOR_ID = 'm6.objective';
const VERSION = '1';

const refKey = (r: TypedRef) => `${r.kind}:${r.id}`;

/** Owners whose objectives govern this Journey: the Journey, its Trip, its coordination groups. */
function objectiveOwners(world: CapturedWorld, journey: EffectiveJourney): TypedRef[] {
  const owners: TypedRef[] = [journey.journeyRef, journey.tripRef];
  for (const m of world.groupMemberships.filter((membership) => membership.journeyId === journey.journeyRef.id)) {
    owners.push({ kind: 'COORDINATION_GROUP', id: m.groupId });
  }
  return owners;
}

function governingObjectives(world: CapturedWorld, journey: EffectiveJourney): WObjective[] {
  const owners = new Set(objectiveOwners(world, journey).map(refKey));
  return world.objectives.filter((o) => owners.has(refKey(o.owner))).sort((a, b) => a.id.localeCompare(b.id));
}

type Bucket = 'hard' | 'soft' | 'waived';

interface ObjectiveEvaluation {
  bucket: Bucket;
  explanation: CausalExplanation;
  /** An instant after which this explanation's verdict could change by time alone. */
  invalidatesAt?: Instant;
}

function objectiveRef(objective: WObjective): TypedRef {
  return { kind: 'OBJECTIVE', id: objective.id };
}

function evaluateObjective(objective: WObjective, journey: EffectiveJourney, world: CapturedWorld): ObjectiveEvaluation {
  const affectedSubject = journey.journeyRef;
  const relatedSubjects: TypedRef[] = [objectiveRef(objective)];

  if (objective.disposition === 'WAIVED' || objective.disposition === 'CLOSED_WITH_LOSS') {
    const evidenceRefs: EvidenceRef[] = objective.dispositionEvidenceId ? [{ kind: 'EVIDENCE_RECORD', id: objective.dispositionEvidenceId }] : [];
    return {
      bucket: 'waived',
      explanation: explain({
        evaluatorId: EVALUATOR_ID,
        dimension: 'waived_objectives',
        status: 'PASS',
        reasonCode: 'objective_loss_authorised',
        cause: { kind: 'REQUIREMENT', subjectRef: objectiveRef(objective) },
        affectedSubject,
        relatedSubjects,
        evidenceRefs,
        facts: { disposition: objective.disposition, hardness: objective.hardness },
      }),
    };
  }

  const bucket: Bucket = objective.hardness === 'HARD' ? 'hard' : 'soft';
  const dim = bucket === 'hard' ? 'hard_objectives' : 'soft_objectives';

  if (objective.disposition === 'ACHIEVED') {
    return {
      bucket,
      explanation: explain({
        evaluatorId: EVALUATOR_ID, dimension: dim, status: 'PASS', reasonCode: 'objective_achieved',
        cause: { kind: 'REQUIREMENT', subjectRef: objectiveRef(objective) }, affectedSubject, relatedSubjects,
        facts: { disposition: objective.disposition, hardness: objective.hardness },
      }),
    };
  }

  // disposition === 'ACTIVE' from here.
  if (objective.successPredicateKind === 'ARRIVAL_BY') {
    const timeTarget = objective.targets.find((t) => t.targetKind === 'TIME' && t.atOrBefore !== null);
    const placeTarget = objective.targets.find((t) => t.targetKind === 'PLACE' && t.placeId !== null);
    const deadline = timeTarget?.atOrBefore ?? null;
    const placeId = placeTarget?.placeId ?? null;
    if (deadline === null || placeId === null) {
      return {
        bucket,
        explanation: explain({
          evaluatorId: EVALUATOR_ID, dimension: dim, status: 'UNKNOWN', reasonCode: 'objective_target_missing',
          cause: { kind: 'MISSING_INFORMATION' }, affectedSubject, relatedSubjects,
          uncertainty: [{ kind: 'MISSING_INPUT', code: 'objective_target', subjectRef: objectiveRef(objective) }],
        }),
      };
    }
    const reach = reachPlaceBy(world, journey, placeId, deadline);
    return {
      bucket,
      invalidatesAt: deadline,
      explanation: explain({
        evaluatorId: EVALUATOR_ID, dimension: dim, status: reach.status, reasonCode: reach.reasonCode,
        cause: { kind: 'REQUIREMENT', subjectRef: objectiveRef(objective) }, affectedSubject,
        relatedSubjects: [
          ...relatedSubjects,
          { kind: 'PLACE', id: placeId },
          ...(reach.item ? [reach.item.itemRef] : []),
          ...(reach.constraint ? [{ kind: 'CONSTRAINT_DEFINITION', id: reach.constraint.id } as TypedRef] : []),
        ],
        facts: { deadline, arrival: reach.arrival ?? null, readyAt: reach.readyAt ?? null, slackMinutes: reach.slackMinutes ?? null, transferMinutes: reach.transferMinutes ?? null },
        uncertainty: reach.uncertainty,
      }),
    };
  }

  if (objective.successPredicateKind === 'ATTEND') {
    const subjectTarget = objective.targets.find((t) => t.targetKind === 'SUBJECT' && t.subject?.kind === 'PROGRAMME_ITEM');
    const targetSubject = subjectTarget?.subject ?? null;
    const programmeItem = targetSubject ? world.programmeItems.find((p) => p.id === targetSubject.id) : undefined;
    if (!targetSubject || !programmeItem) {
      return {
        bucket,
        explanation: explain({
          evaluatorId: EVALUATOR_ID, dimension: dim, status: 'UNKNOWN', reasonCode: 'objective_target_missing',
          cause: { kind: 'MISSING_INFORMATION' }, affectedSubject, relatedSubjects,
          uncertainty: [{ kind: 'MISSING_INPUT', code: 'objective_target', subjectRef: objectiveRef(objective) }],
        }),
      };
    }
    const withItem = [...relatedSubjects, { kind: 'PROGRAMME_ITEM', id: programmeItem.id } as TypedRef];
    if (programmeItem.lifecycleStatus === 'CANCELLED') {
      return {
        bucket,
        explanation: explain({
          evaluatorId: EVALUATOR_ID, dimension: dim, status: 'FAIL', reasonCode: 'attend_target_cancelled',
          cause: { kind: 'REQUIREMENT', subjectRef: objectiveRef(objective) }, affectedSubject, relatedSubjects: withItem,
          facts: { programmeItemStatus: programmeItem.lifecycleStatus },
        }),
      };
    }
    const window = programmeItem.window;
    const placeId = programmeItem.placeId;
    if (!window || !placeId) {
      return {
        bucket,
        explanation: explain({
          evaluatorId: EVALUATOR_ID, dimension: dim, status: 'UNKNOWN', reasonCode: 'attend_target_unscheduled',
          cause: { kind: 'MISSING_INFORMATION' }, affectedSubject, relatedSubjects: withItem,
          uncertainty: [{ kind: 'MISSING_INPUT', code: 'programme_item_window', subjectRef: { kind: 'PROGRAMME_ITEM', id: programmeItem.id } }],
        }),
      };
    }
    const reach = reachPlaceBy(world, journey, placeId, window.start);
    return {
      bucket,
      invalidatesAt: window.start,
      explanation: explain({
        evaluatorId: EVALUATOR_ID, dimension: dim, status: reach.status, reasonCode: reach.reasonCode,
        cause: { kind: 'REQUIREMENT', subjectRef: objectiveRef(objective) }, affectedSubject,
        relatedSubjects: [
          ...withItem,
          ...(reach.item ? [reach.item.itemRef] : []),
          ...(reach.constraint ? [{ kind: 'CONSTRAINT_DEFINITION', id: reach.constraint.id } as TypedRef] : []),
        ],
        facts: { deadline: window.start, arrival: reach.arrival ?? null, readyAt: reach.readyAt ?? null, slackMinutes: reach.slackMinutes ?? null, transferMinutes: reach.transferMinutes ?? null },
        uncertainty: reach.uncertainty,
      }),
    };
  }

  // STATEMENT / COMPLETE_ITEMS / BOUND_SPEND / any unregistered predicate kind.
  return {
    bucket,
    explanation: explain({
      evaluatorId: EVALUATOR_ID, dimension: dim, status: 'UNKNOWN', reasonCode: 'objective_predicate_unsupported',
      cause: { kind: 'MISSING_INFORMATION' }, affectedSubject, relatedSubjects,
      uncertainty: [{ kind: 'UNSUPPORTED_EVALUATION', code: 'objective_predicate_kind', subjectRef: objectiveRef(objective) }],
      facts: { successPredicateKind: objective.successPredicateKind },
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
    return { dimensions: [notApplicable('hard_objectives'), notApplicable('soft_objectives'), notApplicable('waived_objectives')], evidence: [], missingCoverage: [] };
  }

  const objectives = governingObjectives(context.world, journey);
  const hard: CausalExplanation[] = [];
  const soft: CausalExplanation[] = [];
  const waived: CausalExplanation[] = [];
  const invalidations: (Instant | undefined)[] = [];

  for (const objective of objectives) {
    const evaluated = evaluateObjective(objective, journey, context.world);
    invalidations.push(evaluated.invalidatesAt);
    if (evaluated.bucket === 'hard') hard.push(evaluated.explanation);
    else if (evaluated.bucket === 'soft') soft.push(evaluated.explanation);
    else waived.push(evaluated.explanation);
  }

  const dimensions: DimensionResult[] = [
    hard.length > 0 ? dimension({ dimension: 'hard_objectives', explanations: hard, blocking: true }) : notApplicable('hard_objectives'),
    soft.length > 0 ? dimension({ dimension: 'soft_objectives', explanations: soft, blocking: false }) : notApplicable('soft_objectives'),
    waived.length > 0 ? dimension({ dimension: 'waived_objectives', explanations: waived, blocking: false }) : notApplicable('waived_objectives'),
  ];

  const nextInvalidationAt = earliestAfter(context.now, invalidations);
  return {
    dimensions,
    evidence: collectEvidence([...hard, ...soft, ...waived]),
    missingCoverage: [],
    ...(nextInvalidationAt ? { nextInvalidationAt } : {}),
  };
}

export const objectiveEvaluator: Evaluator = {
  id: EVALUATOR_ID,
  version: VERSION,
  assessmentKind: 'VIABILITY',
  subjectKinds: ['JOURNEY'],
  dimensions: ['hard_objectives', 'soft_objectives', 'waived_objectives'],
  informationTopics: [],
  evaluate,
};
