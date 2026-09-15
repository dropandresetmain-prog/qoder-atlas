/**
 * Shared-supplier cohort disruption — independent per-traveller programme evaluation.
 *
 * One supplier event → N travellers → independent outcomes.
 * No scenario-named branching; labels/refs are runtime inputs.
 */
import type {
  AssessmentTone,
  RemainderViability,
  ProductOperationalStatus,
} from '../../contracts/v2/product/readModels.ts';

export interface CohortTravellerEvaluationInput {
  travellerRef: string;
  personLabel: string;
  tripRef: string;
  journeyRef: string;
  /** Assessment tone from M6/effective-state for this traveller's programme scope. */
  programmeOutcome: AssessmentTone;
  remainderViability: RemainderViability;
  /** True when this traveller has at least one meaningful REQUIRED programme dependency evaluated. */
  hasEvaluatedRequiredProgrammeDependency: boolean;
}

export interface CohortTravellerEvaluation {
  travellerRef: string;
  personLabel: string;
  tripRef: string;
  journeyRef: string;
  outcome: AssessmentTone;
  remainderViability: RemainderViability;
  status: ProductOperationalStatus;
  /** Healthy-without-commitment is forbidden for cohort blast-radius members. */
  validCohortMember: boolean;
}

export interface SharedDisruptionCohortResult {
  incidentRef: string;
  sourceChangeSummary: string;
  travellers: CohortTravellerEvaluation[];
  allHaveProgrammeDependency: boolean;
  divergentOutcomes: boolean;
}

function statusFromOutcome(
  outcome: AssessmentTone,
  remainder: RemainderViability,
): ProductOperationalStatus {
  if (outcome === 'FAIL' || remainder === 'NOT_VIABLE') return 'DISRUPTED';
  if (outcome === 'UNKNOWN' || remainder === 'UNKNOWN') return 'UNKNOWN';
  if (remainder === 'AT_RISK') return 'AT_RISK';
  if (outcome === 'PASS' && remainder === 'VIABLE') return 'READY';
  return 'RECOVERING';
}

/**
 * Project independent outcomes for a shared disruption cohort.
 * Members without an evaluated REQUIRED programme dependency are flagged invalid
 * (do not treat "no Day-1 commitment" as healthy).
 */
export function evaluateSharedDisruptionCohort(input: {
  incidentRef: string;
  sourceChangeSummary: string;
  travellers: readonly CohortTravellerEvaluationInput[];
}): SharedDisruptionCohortResult {
  const travellers = input.travellers.map((t): CohortTravellerEvaluation => {
    const validCohortMember = t.hasEvaluatedRequiredProgrammeDependency;
    const outcome: AssessmentTone = validCohortMember ? t.programmeOutcome : 'UNKNOWN';
    const remainderViability: RemainderViability = validCohortMember
      ? t.remainderViability
      : 'UNKNOWN';
    return {
      travellerRef: t.travellerRef,
      personLabel: t.personLabel,
      tripRef: t.tripRef,
      journeyRef: t.journeyRef,
      outcome,
      remainderViability,
      status: statusFromOutcome(outcome, remainderViability),
      validCohortMember,
    };
  });

  const outcomes = new Set(travellers.map((t) => t.outcome));

  return {
    incidentRef: input.incidentRef,
    sourceChangeSummary: input.sourceChangeSummary,
    travellers,
    allHaveProgrammeDependency: travellers.every((t) => t.validCohortMember),
    divergentOutcomes: outcomes.size > 1,
  };
}
