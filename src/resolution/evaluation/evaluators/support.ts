/**
 * NORTHSTAR M6 — L3 evaluator: `m6.support`.
 *
 * Dimension `support_continuity` (blocking). A Journey traveller who is the
 * supported traveller of an accompaniment requirement (latest version) whose
 * coverage overlaps one of their active effective items must have that
 * requirement continuously satisfied: an ACTIVE assignment pinned to the
 * current requirement version, shaped to satisfy the requirement exactly
 * (never a relaxation — enforced by `assignmentSatisfiesDefinition`), and,
 * for every active TRANSPORT item inside coverage, every supporter whose
 * assigned scope covers that item's start must actually be travelling the
 * same service (co-presence) — a split route (supporter on a different
 * service) or a missing itinerary is never silently accepted.
 *
 * Pure: reads only `(subject, { now, world, effective })`, no I/O.
 *
 * M6_EVALUATOR_CONTRACT.md §2 L3 does not name a reasonCode for every branch
 * (only PASS `supporter_on_same_service` / FAIL `supporter_not_on_same_service`
 * / `no_active_assignment` / `assignment_pins_superseded_requirement` /
 * `assignment_does_not_satisfy_requirement` are named literally). Additional
 * codes used here are conservative, snake_case, and covered by the test
 * suite:
 *   - `dependant_service_unknown` / `supporter_itinerary_unknown` (UNKNOWN,
 *     named in the contract's prose but not spelled out as a literal code);
 *   - `insufficient_simultaneous_supporters` (FAIL): fewer co-present,
 *     on-service supporters at an item's start than
 *     `minimumSimultaneousSupporters` requires;
 *   - `assignment_satisfies_requirement` (PASS): the assignment fully and
 *     correctly satisfies the requirement and the dependant has no active
 *     TRANSPORT item inside coverage to co-presence-check (e.g. support
 *     during a STAY) — absence of a checkable item is not silently ignored;
 *     it still requires an explicit PASS grounded in the validated shape.
 */
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { Instant } from '../../../domain/v2/shared/time.ts';
import { compareInstants } from '../../../domain/v2/shared/time.ts';
import { assignmentSatisfiesDefinition, type AccompanimentConstraintDefinition, type SupportAssignment } from '../../../domain/v2/trip/support.ts';
import type { CapturedWorld, WAccompanimentRequirement } from '../../world/world.ts';
import type { EffectiveItem, EffectiveJourney, EffectiveWorld } from '../../world/effectiveTypes.ts';
import type { Evaluator, EvaluatorOutput } from '../evaluator.ts';
import { dimension, explain, notApplicable } from '../explain.ts';
import type { CausalExplanation, EvidenceRef } from '../../../contracts/v2/assessment/explanation.ts';

const DIMENSION = 'support_continuity';
const EVALUATOR_ID = 'm6.support';

function overlaps(aStart: Instant, aEnd: Instant, bStart: Instant, bEnd: Instant): boolean {
  return compareInstants(aStart, bEnd) < 0 && compareInstants(bStart, aEnd) < 0;
}

function within(t: Instant, start: Instant, end: Instant): boolean {
  return compareInstants(t, start) >= 0 && compareInstants(t, end) < 0;
}

function dedupeEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  const map = new Map<string, EvidenceRef>();
  for (const r of refs) map.set(`${r.kind}:${r.id}:${r.detail ?? ''}`, r);
  return [...map.values()].sort((a, b) => `${a.kind}:${a.id}:${a.detail ?? ''}`.localeCompare(`${b.kind}:${b.id}:${b.detail ?? ''}`));
}

function evaluateRequirement(
  subject: TypedRef,
  journey: EffectiveJourney,
  world: CapturedWorld,
  effective: EffectiveWorld,
  requirement: WAccompanimentRequirement,
): CausalExplanation[] {
  const explanations: CausalExplanation[] = [];
  const requirementRef: TypedRef = { kind: 'CONSTRAINT_DEFINITION', id: requirement.id };
  const dependantRef: TypedRef = { kind: 'TRAVELLER', id: journey.travellerId };
  const provenance: EvidenceRef[] = requirement.provenanceEvidenceId ? [{ kind: 'EVIDENCE_RECORD', id: requirement.provenanceEvidenceId }] : [];

  const candidates = world.supportAssignments
    .filter((a) => a.requirementId === requirement.id && a.lifecycleStatus === 'ACTIVE')
    .sort((a, b) => a.id.localeCompare(b.id));

  if (candidates.length === 0) {
    explanations.push(explain({
      evaluatorId: EVALUATOR_ID, dimension: DIMENSION, status: 'FAIL', reasonCode: 'no_active_assignment',
      cause: { kind: 'REQUIREMENT', subjectRef: requirementRef },
      affectedSubject: subject, relatedSubjects: [requirementRef, dependantRef],
      evidenceRefs: provenance,
      facts: { requirementId: requirement.id, requirementVersion: requirement.version },
    }));
    return explanations;
  }

  const current = candidates.find((a) => a.requirementVersion === requirement.version);
  if (!current) {
    const stale = candidates[0]!;
    explanations.push(explain({
      evaluatorId: EVALUATOR_ID, dimension: DIMENSION, status: 'FAIL', reasonCode: 'assignment_pins_superseded_requirement',
      cause: { kind: 'REQUIREMENT', subjectRef: requirementRef },
      affectedSubject: subject, relatedSubjects: [requirementRef, dependantRef, { kind: 'SUPPORT_ASSIGNMENT', id: stale.id }],
      evidenceRefs: provenance,
      facts: { assignmentId: stale.id, pinnedVersion: stale.requirementVersion, currentVersion: requirement.version },
    }));
    return explanations;
  }

  const definition: AccompanimentConstraintDefinition = {
    id: requirement.id,
    version: requirement.version,
    supportedTravellerId: requirement.supportedTravellerId,
    requiredCoverage: requirement.coverage,
    minimumSimultaneousSupporters: requirement.minimumSimultaneousSupporters,
    eligibleSupporterTravellerIds: requirement.eligibleSupporterTravellerIds,
    maximumHandoffGapMinutes: requirement.maximumHandoffGapMinutes,
    ...(requirement.provenanceEvidenceId ? { provenanceEvidenceId: requirement.provenanceEvidenceId } : {}),
  };
  const assignment: SupportAssignment = {
    id: current.id,
    revision: current.revision,
    constraintDefinitionId: current.requirementId,
    constraintDefinitionVersion: current.requirementVersion,
    lifecycleStatus: 'ACTIVE',
    assignedSupporterTravellerIds: current.assigneeTravellerIds,
    assignedScopes: current.scopes.map((s) => ({ supporterTravellerId: s.supporterTravellerId, interval: { start: s.start, end: s.end } })),
    handoffs: current.handoffs.map((h) => ({ fromSupporterTravellerId: h.fromSupporterTravellerId, toSupporterTravellerId: h.toSupporterTravellerId, handoffAt: h.at })),
  };
  const assignmentRef: TypedRef = { kind: 'SUPPORT_ASSIGNMENT', id: current.id };

  const check = assignmentSatisfiesDefinition(assignment, definition);
  if (!check.ok) {
    check.reasons.forEach((_reason, index) => {
      explanations.push(explain({
        evaluatorId: EVALUATOR_ID, dimension: DIMENSION, status: 'FAIL', reasonCode: 'assignment_does_not_satisfy_requirement',
        cause: { kind: 'REQUIREMENT', subjectRef: requirementRef },
        affectedSubject: subject, relatedSubjects: [requirementRef, dependantRef, assignmentRef],
        evidenceRefs: provenance,
        facts: { assignmentId: current.id, requirementId: requirement.id, reasonIndex: index },
      }));
    });
    return explanations;
  }

  const scopesAt = (t: Instant) => assignment.assignedScopes.filter((s) => within(t, s.interval.start, s.interval.end));
  const dependantItems: EffectiveItem[] = journey.items.filter(
    (i) => i.active && i.kind === 'TRANSPORT' && i.start.value !== null && within(i.start.value, requirement.coverage.start, requirement.coverage.end),
  );

  let checkedAny = false;
  for (const item of dependantItems) {
    if (!item.serviceRef) {
      checkedAny = true;
      explanations.push(explain({
        evaluatorId: EVALUATOR_ID, dimension: DIMENSION, status: 'UNKNOWN', reasonCode: 'dependant_service_unknown',
        cause: { kind: 'MISSING_INFORMATION' },
        affectedSubject: subject, relatedSubjects: [requirementRef, dependantRef, item.itemRef],
        facts: { itemId: item.itemRef.id },
        uncertainty: [{ kind: 'MISSING_INPUT', code: 'transport_service', subjectRef: item.itemRef }],
      }));
      continue;
    }
    const serviceId = item.serviceRef.id;
    const coveringScopes = scopesAt(item.start.value as Instant);
    let passCount = 0;
    for (const scope of coveringScopes) {
      checkedAny = true;
      const supporterId = scope.supporterTravellerId;
      const supporterRef: TypedRef = { kind: 'TRAVELLER', id: supporterId };
      const supporterJourneyIds = world.journeys.filter((j) => j.travellerId === supporterId).map((j) => j.id);
      if (supporterJourneyIds.length === 0) {
        explanations.push(explain({
          evaluatorId: EVALUATOR_ID, dimension: DIMENSION, status: 'UNKNOWN', reasonCode: 'supporter_itinerary_unknown',
          cause: { kind: 'MISSING_INFORMATION' },
          affectedSubject: subject, relatedSubjects: [requirementRef, dependantRef, supporterRef, item.itemRef],
          facts: { supporterId, itemId: item.itemRef.id },
          uncertainty: [{ kind: 'MISSING_INPUT', code: 'supporter_itinerary', subjectRef: supporterRef }],
        }));
        continue;
      }
      const supporterItems = effective.journeys
        .filter((j) => supporterJourneyIds.includes(j.journeyRef.id))
        .flatMap((j) => j.items);
      const onSameService = supporterItems.some((si) => si.active && si.kind === 'TRANSPORT' && si.serviceRef?.id === serviceId);
      if (onSameService) {
        passCount += 1;
        explanations.push(explain({
          evaluatorId: EVALUATOR_ID, dimension: DIMENSION, status: 'PASS', reasonCode: 'supporter_on_same_service',
          cause: { kind: 'WORLD_STATE' },
          affectedSubject: subject, relatedSubjects: [requirementRef, dependantRef, supporterRef, item.itemRef, item.serviceRef],
          facts: { supporterId, itemId: item.itemRef.id, serviceId },
        }));
      } else {
        explanations.push(explain({
          evaluatorId: EVALUATOR_ID, dimension: DIMENSION, status: 'FAIL', reasonCode: 'supporter_not_on_same_service',
          cause: { kind: 'WORLD_STATE' },
          affectedSubject: subject, relatedSubjects: [requirementRef, dependantRef, supporterRef, item.itemRef, item.serviceRef],
          facts: { supporterId, itemId: item.itemRef.id, serviceId },
        }));
      }
    }
    if (coveringScopes.length > 0 && passCount < requirement.minimumSimultaneousSupporters) {
      explanations.push(explain({
        evaluatorId: EVALUATOR_ID, dimension: DIMENSION, status: 'FAIL', reasonCode: 'insufficient_simultaneous_supporters',
        cause: { kind: 'REQUIREMENT', subjectRef: requirementRef },
        affectedSubject: subject, relatedSubjects: [requirementRef, dependantRef, item.itemRef],
        facts: { itemId: item.itemRef.id, coPresentSupporters: passCount, minimumRequired: requirement.minimumSimultaneousSupporters },
      }));
    }
  }

  if (!checkedAny) {
    explanations.push(explain({
      evaluatorId: EVALUATOR_ID, dimension: DIMENSION, status: 'PASS', reasonCode: 'assignment_satisfies_requirement',
      cause: { kind: 'WORLD_STATE' },
      affectedSubject: subject, relatedSubjects: [requirementRef, dependantRef, assignmentRef],
      evidenceRefs: provenance,
      facts: { assignmentId: current.id, requirementId: requirement.id },
    }));
  }

  return explanations;
}

export const supportEvaluator: Evaluator = {
  id: EVALUATOR_ID,
  version: '1',
  assessmentKind: 'VIABILITY',
  subjectKinds: ['JOURNEY'],
  dimensions: [DIMENSION],
  informationTopics: [],
  evaluate(subject, { world, effective }): EvaluatorOutput {
    const journey = effective.journeys.find((j) => j.journeyRef.id === subject.id);
    if (!journey) return { dimensions: [notApplicable(DIMENSION)], evidence: [], missingCoverage: [] };

    const activeItems = journey.items.filter((i) => i.active && i.start.value !== null && i.end.value !== null);
    const requirements = world.accompanimentRequirements
      .filter((r) => r.latestVersion && r.supportedTravellerId === journey.travellerId)
      .filter((r) => activeItems.some((i) => overlaps(r.coverage.start, r.coverage.end, i.start.value as Instant, i.end.value as Instant)))
      .sort((a, b) => a.id.localeCompare(b.id));

    if (requirements.length === 0) return { dimensions: [notApplicable(DIMENSION)], evidence: [], missingCoverage: [] };

    const explanations = requirements.flatMap((r) => evaluateRequirement(subject, journey, world, effective, r));
    const evidence = dedupeEvidence(explanations.flatMap((e) => e.evidenceRefs));
    return { dimensions: [dimension({ dimension: DIMENSION, explanations })], evidence, missingCoverage: [] };
  },
};
