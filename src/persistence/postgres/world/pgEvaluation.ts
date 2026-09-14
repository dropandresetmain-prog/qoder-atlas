/**
 * M6 evaluation entry point over PostgreSQL: capture one consistent world from
 * the changed/requested subjects, project it, assess every reached Journey
 * with the same captured slice (all affected people, none averaged), and build
 * the machine-queryable blast radius. Optionally persists the assessments.
 *
 * Evaluation runs after the read session has ended, over the immutable slice
 * (DATA_STRUCTURE_LOGICAL_SCHEMA.md §11.2).
 */
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { Instant } from '../../../domain/v2/shared/time.ts';
import type { AssessmentResult } from '../../../contracts/v2/assessment/assessmentManifest.ts';
import { projectEffectiveWorld } from '../../../resolution/world/effectiveItinerary.ts';
import type { CapturedWorld } from '../../../resolution/world/world.ts';
import type { EffectiveWorld } from '../../../resolution/world/effectiveTypes.ts';
import { assessSubject, type EvaluatorRegistry } from '../../../resolution/evaluation/assess.ts';
import { buildBlastRadius, type BlastRadiusView } from '../../../resolution/impact/blastRadius.ts';
import { captureWorld } from './pgCurrentState.ts';
import { saveAssessment } from './pgAssessments.ts';

export interface EvaluationRun {
  world: CapturedWorld;
  effective: EffectiveWorld;
  assessments: AssessmentResult[];
  blastRadius: BlastRadiusView;
}

export async function evaluateImpact(
  pool: Pool,
  params: { workspaceId: string; focus: TypedRef[]; now: Instant; registry: EvaluatorRegistry; persist?: { actorId: string } },
): Promise<EvaluationRun> {
  const world = await captureWorld(pool, { workspaceId: params.workspaceId, focus: params.focus, at: params.now, informationTopics: params.registry.informationTopics });
  const effective = projectEffectiveWorld(world);
  const assessments = [...world.journeys]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((journey) => assessSubject({ registry: params.registry, world, effective, subject: { kind: 'JOURNEY', id: journey.id }, now: params.now, assessmentId: randomUUID() }).result);
  if (params.persist) {
    for (const assessment of assessments) await saveAssessment(pool, params.workspaceId, assessment, params.persist.actorId);
  }
  return { world, effective, assessments, blastRadius: buildBlastRadius(world, assessments) };
}
