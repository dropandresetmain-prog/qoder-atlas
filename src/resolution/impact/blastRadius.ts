/**
 * NORTHSTAR M6 — machine-queryable blast radius / explanation view (pure).
 *
 * What a later UI (M9) or planner (M7) needs, without parsing prose:
 *  - what changed (the focus causes);
 *  - who and what is affected (every reached subject, with its registered
 *    causal path, and the Journeys/Travellers among them);
 *  - why (per affected Journey: failed/uncertain dimensions with their typed
 *    explanations, reason codes, facts and evidence);
 *  - which constraints failed and what is uncertain;
 *  - the manifest identity the view was derived from, for currentness checks.
 *
 * Proposed (scenario) state is M7: `state` is always 'CURRENT' here, and the
 * shape leaves room for a proposed counterpart without changing consumers.
 */
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import type { AssessmentResult, AssessmentVerdict } from '../../contracts/v2/assessment/assessmentManifest.ts';
import type { CausalExplanation, DependencyEdge, Uncertainty } from '../../contracts/v2/assessment/explanation.ts';
import type { CapturedWorld } from '../world/world.ts';
import { computeClosure, refKey } from './closure.ts';

export interface AffectedSubject {
  subject: TypedRef;
  cause: TypedRef;
  depth: number;
  path: DependencyEdge[];
}

export interface AffectedJourneyView {
  journey: TypedRef;
  traveller: TypedRef;
  trip: TypedRef;
  path: DependencyEdge[];
  assessmentId: string;
  overallVerdict: AssessmentVerdict;
  /** Blocking applicable dimensions that are FAIL or UNKNOWN. */
  blockingIssues: { dimension: string; verdict: AssessmentVerdict; explanations: CausalExplanation[] }[];
  /** Dimensions that hold (for "what still works" views), by name and verdict. */
  holding: { dimension: string; verdict: AssessmentVerdict; blocking: boolean }[];
  /** Registered constraint / rule / objective subjects cited by failing explanations. */
  failedRequirements: TypedRef[];
  uncertainty: Uncertainty[];
}

export interface BlastRadiusView {
  state: 'CURRENT';
  causes: TypedRef[];
  databaseSnapshot: string;
  capturedAt: string;
  affectedSubjects: AffectedSubject[];
  journeys: AffectedJourneyView[];
  /** Registered edges the capture rejected (unregistered semantics never propagate). */
  rejectedEdgeCount: number;
}

const REQUIREMENT_KINDS = new Set<TypedRef['kind']>(['CONSTRAINT_DEFINITION', 'RULE_SET', 'OBJECTIVE', 'INFORMATION_VERSION']);

export function buildBlastRadius(world: CapturedWorld, assessments: readonly AssessmentResult[]): BlastRadiusView {
  const closure = computeClosure({ causes: world.focus, edges: world.edges });
  const byJourney = new Map(assessments.map((a) => [refKey(a.subjects[0]!.subjectRef), a]));
  const journeys: AffectedJourneyView[] = closure.reached
    .filter((r) => r.subject.kind === 'JOURNEY')
    .map((r): AffectedJourneyView | undefined => {
      const journey = world.journeys.find((j) => j.id === r.subject.id);
      const assessment = byJourney.get(refKey(r.subject));
      if (!journey || !assessment) return undefined;
      const dims = assessment.dimensions.filter((d) => d.applicable);
      const blockingIssues = dims
        .filter((d) => d.blocking && d.verdict !== 'PASS')
        .map((d) => ({ dimension: d.dimension, verdict: d.verdict, explanations: d.explanations.filter((e) => e.status !== 'PASS') }));
      const failing = blockingIssues.flatMap((d) => d.explanations);
      return {
        journey: r.subject,
        traveller: { kind: 'TRAVELLER', id: journey.travellerId },
        trip: { kind: 'TRIP', id: journey.tripId },
        path: r.path,
        assessmentId: assessment.id,
        overallVerdict: assessment.overallVerdict,
        blockingIssues,
        holding: dims.filter((d) => d.verdict === 'PASS').map((d) => ({ dimension: d.dimension, verdict: d.verdict, blocking: d.blocking })),
        failedRequirements: [...new Map(failing.flatMap((e) => e.relatedSubjects).filter((s) => REQUIREMENT_KINDS.has(s.kind)).map((s) => [refKey(s), s])).values()]
          .sort((a, b) => refKey(a).localeCompare(refKey(b))),
        uncertainty: [...new Map(failing.flatMap((e) => e.uncertainty).map((u) => [`${u.kind}:${u.code}:${u.subjectRef ? refKey(u.subjectRef) : ''}`, u])).values()],
      };
    })
    .filter((v): v is AffectedJourneyView => v !== undefined);
  return {
    state: 'CURRENT',
    causes: [...world.focus],
    databaseSnapshot: world.capture.databaseSnapshot,
    capturedAt: world.capture.capturedAt,
    affectedSubjects: closure.reached.filter((r) => r.depth > 0).map((r) => ({ subject: r.subject, cause: r.cause, depth: r.depth, path: r.path })),
    journeys,
    rejectedEdgeCount: closure.rejectedEdges.length,
  };
}
