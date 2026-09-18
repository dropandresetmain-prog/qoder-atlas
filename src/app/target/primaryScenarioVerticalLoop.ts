/**
 * M9 primary-scenario vertical loop orchestration (programme recovery).
 *
 * Data-driven: traveller/item refs come from callers / fixture config.
 * No scenario-named branching. Flight purchase is not required.
 */
import type { AssessmentTone } from '../../contracts/v2/product/readModels.ts';
import { evaluateProgrammeArrivalReadiness } from '../../resolution/evaluation/programmeArrivalReadiness.ts';
import { evaluateSharedDisruptionCohort } from './cohortDisruption.ts';
import {
  previewBilateralProgrammeTimeSwap,
  type BilateralProgrammeTimeSwapPreview,
  type ProgrammeItemWindowFact,
} from './programmeTimeSwapPreview.ts';
import { sharedSupplierProgrammeCohortFoundation } from './primaryScenarioFoundation.ts';
import { loadIncidentProgrammeFactsFromCohort, buildTravellerTripFacts } from './readmodels/pgFactAssembler.ts';
import { projectIncidentProgramme, projectRecoveryCase, projectTravellerTrip, projectOperatorOverview } from './readmodels/index.ts';
import type { RecoveryActionFact, RecoveryCaseFacts } from './readmodels/types.ts';

export interface CohortMemberConfig {
  travellerRef: string;
  personLabel: string;
  tripRef: string;
  journeyRef: string;
  /** Commitment window start used for readiness arithmetic. */
  commitmentStart: string;
  /** Scheduled arrival used for readiness (e.g. shared replacement 10:30). */
  scheduledArrival: string;
  requiresPhysicalPresence: boolean;
  obligation: 'REQUIRED' | 'OPTIONAL' | 'INFORMED';
  requiredReadinessMinutes: number;
}

export interface PrimaryScenarioLoopInput {
  incidentRef: string;
  members: readonly CohortMemberConfig[];
  /** Bilateral swap parties — refs supplied by fixture/config, never hardcoded. */
  swap: {
    itemA: ProgrammeItemWindowFact;
    itemB: ProgrammeItemWindowFact;
  };
  generatedAt?: string;
}

export interface PrimaryScenarioLoopResult {
  foundationKind: typeof sharedSupplierProgrammeCohortFoundation.kind;
  readiness: {
    memberRef: string;
    verdict: string;
    availableMinutes: number | null;
    requiredMinutes: number | null;
  }[];
  cohort: ReturnType<typeof evaluateSharedDisruptionCohort>;
  incidentView: ReturnType<typeof projectIncidentProgramme>;
  preview: BilateralProgrammeTimeSwapPreview;
  /** Booking confirmed while journey fails readiness — truthful split. */
  disruptedMemberBookingConfirmed: true;
  recoveryCasePreview: ReturnType<typeof projectRecoveryCase>;
  operatorOverview: ReturnType<typeof projectOperatorOverview>;
  travellerView: ReturnType<typeof projectTravellerTrip>;
  pendingFixtureFields: readonly string[];
}

function readinessFor(member: CohortMemberConfig) {
  return evaluateProgrammeArrivalReadiness({
    scheduledArrival: member.scheduledArrival,
    commitmentStart: member.commitmentStart,
    requiredMinutes: member.requiredReadinessMinutes,
    requiresPhysicalPresence: member.requiresPhysicalPresence,
    obligation: member.obligation,
  });
}

function toneFromReadiness(verdict: string): AssessmentTone {
  if (verdict === 'FAIL') return 'FAIL';
  if (verdict === 'PASS') return 'PASS';
  return 'UNKNOWN';
}

/**
 * Run the generic primary-scenario vertical loop through read-model/projectors
 * and swap preview. Authoritative programme mutation remains in PG command path
 * (see m9SarahProgrammeLoop.pgtest.ts).
 */
export function runPrimaryScenarioVerticalLoop(input: PrimaryScenarioLoopInput): PrimaryScenarioLoopResult {
  const generatedAt = input.generatedAt ?? '2031-06-01T12:00:00.000Z';
  const readiness = input.members.map((m) => {
    const r = readinessFor(m);
    return {
      memberRef: m.travellerRef,
      verdict: r.verdict,
      availableMinutes: r.availableMinutes,
      requiredMinutes: r.requiredMinutes,
    };
  });

  const travellers = input.members.map((m, i) => {
    const r = readiness[i]!;
    const outcome = toneFromReadiness(r.verdict);
    return {
      travellerRef: m.travellerRef,
      personLabel: m.personLabel,
      tripRef: m.tripRef,
      journeyRef: m.journeyRef,
      programmeOutcome: outcome,
      remainderViability: outcome === 'FAIL' ? 'NOT_VIABLE' as const : outcome === 'PASS' ? 'VIABLE' as const : 'UNKNOWN' as const,
      hasEvaluatedRequiredProgrammeDependency: m.obligation === 'REQUIRED',
    };
  });

  const cohort = evaluateSharedDisruptionCohort({
    incidentRef: input.incidentRef,
    sourceChangeSummary: 'Shared supplier replacement; programme readiness re-evaluated',
    travellers,
  });

  const incidentFacts = loadIncidentProgrammeFactsFromCohort({
    incidentRef: input.incidentRef,
    sourceChangeSummary: 'Shared supplier disruption with independent programme outcomes',
    generatedAt,
    travellers,
    currentProgrammeState: `itemA=${input.swap.itemA.window.start};itemB=${input.swap.itemB.window.start}`,
    proposedProgrammeState: `swap windows between ${input.swap.itemA.itemRef} and ${input.swap.itemB.itemRef}`,
    programmeCommitments: input.members.map((m) => ({
      itemRef: `commitment:${m.travellerRef}`,
      label: m.personLabel,
      windowLabel: m.commitmentStart,
      state: toneFromReadiness(readinessFor(m).verdict) === 'FAIL' ? 'FAILED' as const : 'HEALTHY' as const,
    })),
  });
  const incidentView = projectIncidentProgramme(incidentFacts);

  const preview = previewBilateralProgrammeTimeSwap({
    itemA: input.swap.itemA,
    itemB: input.swap.itemB,
    evaluate: ({ travellerRef, window, role }) => {
      const member = input.members.find((m) => m.travellerRef === travellerRef);
      if (!member) {
        // Local counterpart (or other non-travel participant) — viability is
        // supplied by programme fit, not the shared arrival readiness rule.
        return { verdict: 'PASS', detail: 'non_cohort_participant' };
      }
      if (role === 'CURRENT') {
        return { verdict: toneFromReadiness(readinessFor(member).verdict) };
      }
      const proposed = evaluateProgrammeArrivalReadiness({
        scheduledArrival: member.scheduledArrival,
        commitmentStart: window.start,
        requiredMinutes: member.requiredReadinessMinutes,
        requiresPhysicalPresence: member.requiresPhysicalPresence,
        obligation: member.obligation,
      });
      return { verdict: toneFromReadiness(proposed.verdict), detail: proposed.reasonCode };
    },
  });

  const recoveryActions: RecoveryActionFact[] = [
    {
      actionRef: 'programme-swap-a',
      domain: 'programme',
      capability: 'internal:programme.schedule',
      subjectRefs: [input.swap.itemA.itemRef],
      authorityState: 'required',
      dependencyOrder: 0,
      executionState: 'PROPOSED',
    },
    {
      actionRef: 'programme-swap-b',
      domain: 'programme',
      capability: 'internal:programme.schedule',
      subjectRefs: [input.swap.itemB.itemRef],
      authorityState: 'required',
      dependencyOrder: 1,
      dependsOnActionRefs: [],
      executionState: 'PROPOSED',
    },
  ];

  const disrupted = readiness.find((r) => r.verdict === 'FAIL');
  const caseFacts: RecoveryCaseFacts = {
    generatedAt,
    projectionRevision: 1,
    changedVisibleRefs: [input.incidentRef],
    changedEdgeIds: [],
    currentSemanticState: 'FAILED',
    nodes: incidentFacts.nodes,
    edges: incidentFacts.edges,
    caseRef: `case:${input.incidentRef}`,
    status: 'PLANNING',
    changeSummary: 'Programme readiness failure after confirmed replacement booking',
    bookingServiceState: {
      label: 'Replacement booking',
      state: 'RECOVERED',
      detail: 'Supplier replacement remains confirmed',
    },
    tripViability: {
      label: 'Journey viability',
      verdict: disrupted ? 'FAIL' : 'PASS',
      detail: disrupted
        ? `Readiness ${disrupted.availableMinutes} < ${disrupted.requiredMinutes}`
        : undefined,
    },
    affectedItems: input.members.map((m) => m.tripRef),
    strategies: [{
      strategyRef: 'bilateral-programme-swap',
      version: 1,
      viability: preview.previewAccepted ? 'VIABLE' : 'NOT_VIABLE',
      status: 'PROPOSED',
      optionNumber: 1,
      // This loop projects an in-memory preview, not a persisted
      // ScenarioChange, so it has no stored effects to explain and no
      // authoritative current verdict to compare against. Both stay empty
      // rather than being invented here.
      changes: [],
      resolves: [],
      projectedSummary: {
        total: preview.proposed.projections.length,
        pass: preview.proposed.projections.filter((p) => p.verdict === 'PASS').length,
        fail: preview.proposed.projections.filter((p) => p.verdict === 'FAIL').length,
        unknown: preview.proposed.projections.filter((p) => p.verdict === 'UNKNOWN').length,
      },
      projectedPeople: preview.proposed.projections.map((p) => ({
        subjectRef: p.travellerRef,
        personLabel: p.personLabel,
        verdict: p.verdict,
      })),
    }],
    authorityState: 'awaiting_organiser',
    executionState: 'not_started',
    reconciliationState: 'idle',
    uncertainty: preview.mutatesAuthoritativeState ? ['unexpected mutation'] : [],
    recoveryActions,
    requirementVsActual: disrupted
      ? {
          requirement: `${disrupted.requiredMinutes} minutes readiness`,
          actual: `${disrupted.availableMinutes} minutes available`,
        }
      : undefined,
  };
  const recoveryCasePreview = projectRecoveryCase(caseFacts);

  const operatorOverview = projectOperatorOverview({
    generatedAt,
    projectionRevision: 1,
    changedVisibleRefs: [input.incidentRef],
    changedEdgeIds: [],
    currentSemanticState: 'FAILED',
    nodes: incidentFacts.nodes,
    edges: incidentFacts.edges,
    items: cohort.travellers.map((t) => ({
      tripRef: t.tripRef,
      travellerLabel: t.personLabel,
      status: t.status,
      remainderViability: t.remainderViability,
      incidentRef: input.incidentRef,
      caseRef: caseFacts.caseRef,
      whatChanged: 'Shared supplier replacement arrival',
      affectedPeople: [t.personLabel],
      affectedItems: [t.tripRef],
      decisionRequired: t.outcome === 'FAIL',
      unresolvedUncertainty: t.validCohortMember ? [] : ['missing programme dependency'],
    })),
  });

  const failMember = input.members.find((_, i) => readiness[i]?.verdict === 'FAIL') ?? input.members[0]!;
  const travellerView = projectTravellerTrip(buildTravellerTripFacts({
    tripRef: failMember.tripRef,
    amIOkay: 'NO',
    doesTheRestWork: 'NOT_VIABLE',
    whatChanged: 'Shared supplier service was replaced; arrival time changed',
    whatMattersNow: 'Programme commitment readiness after the new arrival',
    whatNorthstarIsDoing: 'Proposing a bilateral programme time swap (preview only until approved)',
    whatDoYouNeedFromMe: 'Organiser approval for the programme swap',
    generatedAt,
  }));

  return {
    foundationKind: sharedSupplierProgrammeCohortFoundation.kind,
    readiness,
    cohort,
    incidentView,
    preview,
    disruptedMemberBookingConfirmed: true,
    recoveryCasePreview,
    operatorOverview,
    travellerView,
    pendingFixtureFields: [
      'Fable visual direction (polish only)',
    ] as const,
  };
}
