/**
 * A3 Jordan connection foundation: configured AiT source facts enter through
 * the generic provider-event boundary, then normal reassessment and case
 * escalation. No case is seeded and no recovery or execution is attempted.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { acceptProviderShapedDemoEvent } from '../src/app/target/applicationCommands.ts';
import { runCaseEscalation } from '../src/app/target/caseEscalation.ts';
import {
  deriveConnectionViabilityFromEvaluator,
  mapConnectionProgression,
} from '../src/app/target/readmodels/mapConnectionProgression.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { currentAssessmentView, PgReassessmentWorker, type ReassessmentPipeline } from '../src/persistence/postgres/world/pgAssessments.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { assessSubject } from '../src/resolution/evaluation/assess.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import {
  AIT_FIXTURE_NOW,
  buildAitFixtureDatabase,
  cloneAitFixtureDatabase,
  type AitCloneHandle,
  type AitFixtureHandle,
} from './aitFixtureClone.ts';
import { attachSeedSession, commitSeed, takeSeedEvidence } from './m2Seed.ts';

const ACTOR = 'principal:a3-jordan-connection-foundation';
const TIMELINE_PATH = fileURLToPath(
  new URL('../data/ait-demo-input-pack/scenarios/s2-missed-connection/inputs/progressive-delay-timeline.json', import.meta.url),
);

interface DelayStage {
  id: string;
  at: string;
  eventId: string;
  arrTime: string;
  connectionRemainingMinutes: number;
}

interface DelayTimeline {
  baseline: { connectionMinutes: number };
  stages: DelayStage[];
}

const timeline = JSON.parse(readFileSync(TIMELINE_PATH, 'utf8')) as DelayTimeline;

function stage(id: string): DelayStage {
  const found = timeline.stages.find((entry) => entry.id === id);
  assert.ok(found, `configured S2 timeline includes ${id}`);
  return found;
}

function connectionDimension(view: Awaited<ReturnType<typeof currentAssessmentView>>) {
  const dimension = view.assessment?.dimensions.find((entry) => entry.dimension === 'connection_feasibility');
  assert.ok(dimension, 'connection feasibility is assessed');
  const explanation = dimension.explanations[0];
  assert.ok(explanation, 'connection feasibility has a deterministic explanation');
  return {
    verdict: dimension.verdict,
    reasonCode: explanation.reasonCode,
    gapMinutes: (explanation.facts as { gapMinutes?: unknown } | undefined)?.gapMinutes,
  };
}

describe('A3 Jordan connection foundation (real configured AiT world)', () => {
  let fixture: AitFixtureHandle | undefined;
  let clone: AitCloneHandle | undefined;

  after(async () => {
    await clone?.drop().catch(() => undefined);
    await fixture?.drop().catch(() => undefined);
  });

  test('baseline -> D1 safe -> D2 at risk and Case -> D3 impossible', async () => {
    fixture = await buildAitFixtureDatabase({ runBaseline: true });
    clone = await cloneAitFixtureDatabase(fixture.databaseName);
    const { pool, workspaceId } = clone;
    const registry = createM6Registry();

    assert.equal(fixture.baselineEvaluated, 67, 'normal dataset materializer assessed the configured AiT population');
    assert.equal(timeline.baseline.connectionMinutes, 160, 'source timeline records the canonical baseline connection');

    const jordanJourney = await pool.query<{ journey_id: string }>(
      `SELECT j.id AS journey_id
         FROM journeys j
         JOIN travellers t ON t.workspace_id = j.workspace_id AND t.id = j.traveller_id
         JOIN external_record_links l
           ON l.workspace_id = t.workspace_id
          AND l.canonical_subject_kind = 'TRAVELLER'
          AND l.canonical_subject_id = t.id
          AND l.superseded_at IS NULL
         JOIN external_records r ON r.workspace_id = l.workspace_id AND r.id = l.external_record_id
        WHERE j.workspace_id = $1
          AND r.record_type = 'SOURCE_TRAVELLER_DRAFT'
          AND r.external_id = 'ait-draft-09'`,
      [workspaceId],
    );
    assert.equal(jordanJourney.rowCount, 1, 'configured traveller resolves to one canonical journey');
    const journeyId = jordanJourney.rows[0]!.journey_id;

    const inboundService = await pool.query<{ service_id: string }>(
      `SELECT l.canonical_subject_id AS service_id
         FROM external_record_links l
         JOIN external_records r ON r.workspace_id = l.workspace_id AND r.id = l.external_record_id
        WHERE l.workspace_id = $1
          AND l.canonical_subject_kind = 'TRANSPORT_SERVICE'
          AND l.superseded_at IS NULL
          AND r.record_type = 'SOURCE_TRANSPORT_SERVICE'
          AND r.external_id LIKE 'ZG023@%'`,
      [workspaceId],
    );
    assert.equal(inboundService.rowCount, 1, 'configured inbound service resolves from source identity');
    const serviceId = inboundService.rows[0]!.service_id;

    const evidenceSeed = await attachSeedSession(pool, workspaceId, ACTOR, 3);
    const evidenceIds = [takeSeedEvidence(evidenceSeed), takeSeedEvidence(evidenceSeed), takeSeedEvidence(evidenceSeed)];
    await commitSeed(evidenceSeed);

    const pipeline: ReassessmentPipeline = async (claim, assessmentId) => {
      const world = await captureWorld(pool, {
        workspaceId: claim.workspaceId,
        focus: [claim.subject],
        at: claim.kind === 'VIABILITY' ? currentStageAt : AIT_FIXTURE_NOW,
        informationTopics: registry.informationTopics,
      });
      return assessSubject({
        registry,
        world,
        effective: projectEffectiveWorld(world),
        subject: claim.subject,
        now: currentStageAt,
        assessmentId,
      }).result;
    };
    let currentStageAt = AIT_FIXTURE_NOW;
    const commandCtx = {
      workspaceId,
      actorPrincipalId: ACTOR,
      uow: () => new PgUnitOfWork(pool, workspaceId),
      pool,
    };

    const baseline = await currentAssessmentView(pool, workspaceId, { kind: 'JOURNEY', id: journeyId }, 'VIABILITY', AIT_FIXTURE_NOW);
    assert.equal(baseline.status, 'CURRENT');
    let connection = connectionDimension(baseline);
    assert.deepEqual(connection, { verdict: 'PASS', reasonCode: 'connection_meets_minimum', gapMinutes: 160 });
    assert.equal(deriveConnectionViabilityFromEvaluator(connection), 'VIABLE');
    assert.equal(mapConnectionProgression({ viability: 'VIABLE' }), 'CONNECTION_SAFE');
    assert.equal((await pool.query('SELECT id FROM recovery_cases WHERE workspace_id = $1', [workspaceId])).rowCount, 0, 'baseline does not preseed a Case');

    const applyStage = async (delay: DelayStage, evidenceId: string) => {
      currentStageAt = delay.at;
      const revision = await pool.query<{ revision: string }>(
        `SELECT revision::text AS revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2`,
        [workspaceId, serviceId],
      );
      const ingress = await acceptProviderShapedDemoEvent(commandCtx, {
        providerId: 's2-configured-provider-event',
        providerEventId: delay.eventId,
        receivedAt: delay.at,
        disclosedAsSimulatedDemoInput: true,
        payload: {
          subjectKind: 'TRANSPORT_SERVICE',
          subjectId: serviceId,
          expectedRevision: Number(revision.rows[0]!.revision),
          field: 'ESTIMATED',
          arrival: delay.arrTime,
          evidenceId,
        },
      });
      assert.equal(ingress.ok, true, JSON.stringify(ingress));
      if (!ingress.ok) throw new Error('unreachable');
      const drained = await new PgReassessmentWorker(pool, { actorId: ACTOR })
        .drainAvailable(delay.at, pipeline, { workspaceId, maxItems: 100, maxMs: 60_000 });
      assert.equal(drained.stoppedReason, 'EMPTY', JSON.stringify(drained));
      const view = await currentAssessmentView(pool, workspaceId, { kind: 'JOURNEY', id: journeyId }, 'VIABILITY', delay.at);
      assert.equal(view.status, 'CURRENT', JSON.stringify(view.staleness));
      return { ingress, view };
    };

    const d1 = stage('delay_begins_connection_viable');
    assert.equal(d1.connectionRemainingMinutes, 95, 'D1 correction preserves the 90-minute hard minimum');
    const d1Result = await applyStage(d1, evidenceIds[0]!);
    connection = connectionDimension(d1Result.view);
    assert.deepEqual(connection, { verdict: 'PASS', reasonCode: 'connection_meets_minimum', gapMinutes: 95 });
    assert.equal(mapConnectionProgression({ viability: deriveConnectionViabilityFromEvaluator(connection) }), 'CONNECTION_SAFE');
    const d1Escalation = await runCaseEscalation({ ...commandCtx, now: d1.at });
    assert.equal(d1Escalation.opened, 0, JSON.stringify(d1Escalation));

    const d2 = stage('delay_increases_connection_at_risk');
    const d2Result = await applyStage(d2, evidenceIds[1]!);
    connection = connectionDimension(d2Result.view);
    assert.deepEqual(connection, { verdict: 'FAIL', reasonCode: 'connection_below_minimum', gapMinutes: 30 });
    assert.equal(mapConnectionProgression({ viability: deriveConnectionViabilityFromEvaluator(connection) }), 'CONNECTION_AT_RISK');
    const d2Escalation = await runCaseEscalation({ ...commandCtx, now: d2.at });
    assert.equal(d2Escalation.opened, 1, JSON.stringify(d2Escalation));
    const caseId = d2Escalation.outcomes.find((outcome) => outcome.caseId)?.caseId;
    assert.ok(caseId, 'D2 hard FAIL opens a RecoveryCase without a preseeded case');
    const opened = await pool.query<{ lifecycle_status: string; opened_at: Date }>(
      `SELECT lifecycle_status, opened_at FROM recovery_cases WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, caseId],
    );
    assert.deepEqual(opened.rows[0], { lifecycle_status: 'OPEN', opened_at: new Date(d2.at) });

    const d3 = stage('zg053_impossible');
    const d3Result = await applyStage(d3, evidenceIds[2]!);
    connection = connectionDimension(d3Result.view);
    assert.deepEqual(connection, { verdict: 'FAIL', reasonCode: 'connection_broken', gapMinutes: -65 });
    assert.equal(mapConnectionProgression({ viability: deriveConnectionViabilityFromEvaluator(connection) }), 'CONNECTION_IMPOSSIBLE');
    const d3Escalation = await runCaseEscalation({ ...commandCtx, now: d3.at });
    assert.equal(d3Escalation.opened, 0, JSON.stringify(d3Escalation));
    assert.equal(d3Escalation.attached, 1, JSON.stringify(d3Escalation));
    const signals = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM case_signals WHERE workspace_id = $1 AND recovery_case_id = $2`,
      [workspaceId, caseId],
    );
    assert.equal(Number(signals.rows[0]!.n), 2, 'D2 opens and D3 attaches to the same Case');
  });
});
