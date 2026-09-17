/**
 * T3 — assessment -> RecoveryCase escalation through the normal runtime seam.
 *
 * Proves against real PostgreSQL (0100, 0124):
 *  - a current blocking FAIL opens exactly one case, links the subject, and a
 *    rerun of the pass is a no-op (durable, idempotent reconcile-from-state);
 *  - PASS / UNKNOWN never open a case;
 *  - a change signal's consequence (command under the signal -> trigger ->
 *    reassessment -> FAIL) opens a case whose cause is that signal, and the
 *    case read model exposes the cause, the causal path and the DISRUPTION
 *    node from authoritative rows;
 *  - a later FAIL of the same subject attaches (with its own signal) to the
 *    open case instead of opening a second one.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { beginSeed, commitSeed, type SeedSession } from './m2Seed.ts';
import { seedJourney, seedJurisdictionWithPlaces, seedService, seedTransportIntent, seedTraveller, seedTrip } from './m6WorldSeed.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { PgReassessmentWorker, currentAssessmentView, saveAssessment, type ReassessmentPipeline } from '../src/persistence/postgres/world/pgAssessments.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import { assessSubject, createEvaluatorRegistry } from '../src/resolution/evaluation/assess.ts';
import type { Evaluator } from '../src/resolution/evaluation/evaluator.ts';
import { dimension, explain } from '../src/resolution/evaluation/explain.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';
import { recordChangeSignal, completeChangeSignal } from '../src/persistence/postgres/commands/changeSignalCommands.ts';
import { updateTripDetails } from '../src/persistence/postgres/commands/travelCommands.ts';
import { runCaseEscalation, escalationCaseId } from '../src/app/target/caseEscalation.ts';
import { loadRecoveryCaseFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-05-01T00:00:00.000Z';
const ACTOR = 'principal:t3-test';

/** Verdict the test evaluator reports per Journey — a test control, not a scenario. */
const verdictFor = new Map<string, 'PASS' | 'FAIL' | 'UNKNOWN'>();

const controlled: Evaluator = {
  id: 'test.controlled', version: '1', assessmentKind: 'VIABILITY', subjectKinds: ['JOURNEY'], dimensions: ['controlled_requirement'], informationTopics: [],
  evaluate: (subject) => {
    const status = verdictFor.get(subject.id) ?? 'UNKNOWN';
    return {
      dimensions: [dimension({
        dimension: 'controlled_requirement',
        blocking: true,
        explanations: [explain({
          evaluatorId: 'test.controlled', dimension: 'controlled_requirement', status, reasonCode: status === 'FAIL' ? 'requirement_not_met' : 'requirement_checked',
          cause: { kind: 'WORLD_STATE' }, affectedSubject: subject, facts: { requiredMinutes: 150, availableMinutes: status === 'FAIL' ? 60 : 200 },
        })],
      })],
      evidence: [], missingCoverage: [],
    };
  },
};
const registry = createEvaluatorRegistry([controlled]);

interface Fixture { pool: Pool; seed: SeedSession; journey: TypedRef; tripId: string }

async function fixture(): Promise<Fixture> {
  const pool = await sharedTestPool();
  const seed = await beginSeed(pool, 'T3 escalation fixture');
  const geo = await seedJurisdictionWithPlaces(seed, { name: 'Regime', places: [{ name: 'A', placeType: 'STATION' }, { name: 'B', placeType: 'STATION' }] });
  const travellerId = (await seedTraveller(seed)).travellerId;
  const tripId = await seedTrip(seed);
  const journeyId = await seedJourney(seed, { tripId, travellerId });
  const serviceId = await seedService(seed, { mode: 'RAIL', operator: 'Operator', originPlaceId: geo.placeIds[0]!, destinationPlaceId: geo.placeIds[1]!, published: { departure: '2031-05-02T08:00:00.000Z', arrival: '2031-05-02T09:00:00.000Z' } });
  await seedTransportIntent(seed, { journeyId, orderKey: '010', originPlaceId: geo.placeIds[0]!, destinationPlaceId: geo.placeIds[1]!, selectedServiceId: serviceId });
  await commitSeed(seed);
  return { pool, seed, journey: { kind: 'JOURNEY', id: journeyId }, tripId };
}

const pipeline = (f: Fixture): ReassessmentPipeline => async (claim, assessmentId) => {
  const world = await captureWorld(f.pool, { workspaceId: claim.workspaceId, focus: [claim.subject], at: NOW, informationTopics: registry.informationTopics });
  return assessSubject({ registry, world, effective: projectEffectiveWorld(world), subject: claim.subject, now: NOW, assessmentId }).result;
};

async function assessNow(f: Fixture) {
  const world = await captureWorld(f.pool, { workspaceId: f.seed.workspaceId, focus: [f.journey], at: NOW, informationTopics: registry.informationTopics });
  const { result } = assessSubject({ registry, world, effective: projectEffectiveWorld(world), subject: f.journey, now: NOW, assessmentId: randomUUID() });
  await saveAssessment(f.pool, f.seed.workspaceId, result, ACTOR);
  return result;
}

function escalate(f: Fixture) {
  return runCaseEscalation({ pool: f.pool, workspaceId: f.seed.workspaceId, actorPrincipalId: ACTOR, uow: () => new PgUnitOfWork(f.pool, f.seed.workspaceId), now: NOW });
}

async function casesFor(f: Fixture) {
  return (await f.pool.query<{ id: string; lifecycle_status: string }>(
    `SELECT rc.id, rc.lifecycle_status FROM case_subjects cs JOIN recovery_cases rc ON rc.workspace_id = cs.workspace_id AND rc.id = cs.recovery_case_id
      WHERE cs.workspace_id = $1 AND cs.subject_kind = $2 AND cs.subject_id = $3 ORDER BY rc.opened_at`,
    [f.seed.workspaceId, f.journey.kind, f.journey.id],
  )).rows;
}

async function tripRevision(f: Fixture): Promise<number> {
  const r = await f.pool.query<{ revision: string }>('SELECT revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2', [f.seed.workspaceId, f.tripId]);
  return Number(r.rows[0]!.revision);
}

describe('T3 escalation pass (real PostgreSQL)', () => {
  test('a current blocking FAIL opens exactly one case; a rerun is a no-op', async () => {
    const f = await fixture();
    verdictFor.set(f.journey.id, 'FAIL');
    const assessment = await assessNow(f);

    const first = await escalate(f);
    assert.equal(first.opened, 1, JSON.stringify(first));
    assert.equal(first.failed, 0);
    const cases = await casesFor(f);
    assert.equal(cases.length, 1);
    assert.equal(cases[0]!.id, escalationCaseId(f.seed.workspaceId, f.journey, assessment.id), 'deterministic case identity');
    assert.equal(cases[0]!.lifecycle_status, 'OPEN');

    const again = await escalate(f);
    assert.equal(again.opened, 0);
    assert.equal(again.attached, 0);
    assert.equal(again.candidates, 0, 'a linked (subject, assessment) pair is no longer a candidate');
    assert.equal((await casesFor(f)).length, 1);
  });

  test('PASS and UNKNOWN never open a case', async () => {
    const f = await fixture();
    verdictFor.set(f.journey.id, 'PASS');
    await assessNow(f);
    assert.equal((await escalate(f)).opened, 0);
    verdictFor.set(f.journey.id, 'UNKNOWN');
    await assessNow(f);
    const report = await escalate(f);
    assert.equal(report.opened + report.attached, 0);
    assert.equal((await casesFor(f)).length, 0);
  });

  test('a change signal consequence opens a case whose cause and causal path are authoritative', async () => {
    const f = await fixture();
    verdictFor.set(f.journey.id, 'PASS');
    await assessNow(f);
    assert.equal((await escalate(f)).opened, 0, 'healthy baseline opens nothing');
    const uow = new PgUnitOfWork(f.pool, f.seed.workspaceId);

    // The external change arrives: signal first, then its consequence under it.
    const signalId = randomUUID();
    const recorded = await recordChangeSignal(uow, {
      workspaceId: f.seed.workspaceId, actorPrincipalId: ACTOR, idempotencyKey: `signal:${signalId}`,
      changeSignalId: signalId, originKind: 'PROVIDER_EVENT', originKey: `test:${signalId}`, changeType: 'TRIP_PURPOSE_CHANGED',
      contentHash: 'h1', receivedAt: NOW, subjects: [{ kind: 'TRIP', id: f.tripId, role: 'CHANGED_SUBJECT' }],
    });
    assert.equal(recorded.ok, true, JSON.stringify(recorded));
    verdictFor.set(f.journey.id, 'FAIL');
    const changed = await updateTripDetails(uow.underChangeSignal(signalId), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: ACTOR, idempotencyKey: `trip:${signalId}`,
      tripId: f.tripId, expectedRevision: await tripRevision(f), purpose: 'changed by test',
    });
    assert.equal(changed.ok, true, JSON.stringify(changed));
    assert.equal((await completeChangeSignal(uow, { workspaceId: f.seed.workspaceId, actorPrincipalId: ACTOR, idempotencyKey: `done:${signalId}`, changeSignalId: signalId, completedAt: NOW })).ok, true);

    // Normal invalidation + worker, then the escalation pass.
    const worker = new PgReassessmentWorker(f.pool, { actorId: ACTOR });
    const drain = await worker.drainAvailable(NOW, pipeline(f), { workspaceId: f.seed.workspaceId });
    assert.equal(drain.processed, 1, JSON.stringify(drain));
    const view = await currentAssessmentView(f.pool, f.seed.workspaceId, f.journey, 'VIABILITY', NOW);
    assert.equal(view.status, 'CURRENT');
    assert.equal(view.assessment?.overallVerdict, 'FAIL');

    const report = await escalate(f);
    assert.equal(report.opened, 1, JSON.stringify(report));
    assert.equal(report.outcomes[0]?.changeSignalId, signalId, 'the escalating assessment carries the signal that caused it');
    const cases = await casesFor(f);
    assert.equal(cases.length, 1);
    const linked = await f.pool.query<{ change_signal_id: string }>('SELECT change_signal_id FROM case_signals WHERE workspace_id = $1 AND recovery_case_id = $2', [f.seed.workspaceId, cases[0]!.id]);
    assert.deepEqual(linked.rows.map((r) => r.change_signal_id), [signalId]);

    // Read model: cause, causal path and the DISRUPTION node come from rows, not inference.
    const facts = await loadRecoveryCaseFacts(f.pool, f.seed.workspaceId, cases[0]!.id, NOW);
    assert.ok(facts);
    const caseView = projectRecoveryCase(facts);
    assert.equal(caseView.cause?.changeSignalRef, `CHANGE_SIGNAL:${signalId}`);
    assert.equal(caseView.cause?.changeType, 'TRIP_PURPOSE_CHANGED');
    assert.equal(caseView.cause?.applied, true);
    assert.equal(caseView.causalPath.length, 1);
    assert.equal(caseView.causalPath[0]?.dimension, 'controlled_requirement');
    assert.equal(caseView.causalPath[0]?.reasonCode, 'requirement_not_met');
    assert.deepEqual(caseView.causalPath[0]?.facts, { requiredMinutes: 150, availableMinutes: 60 });
    assert.equal(caseView.causalFailureReason, 'controlled_requirement: requirement_not_met');
    assert.ok(caseView.ldg.nodes.some((n) => n.kind === 'DISRUPTION' && n.ref === `CHANGE_SIGNAL:${signalId}`), 'cause node present');
    assert.ok(caseView.ldg.edges.some((e) => e.toRef === `CHANGE_SIGNAL:${signalId}` && e.fromRef === `${f.journey.kind}:${f.journey.id}` && e.kind === 'AFFECTED_BY'), 'subject -> cause edge present');
    assert.equal(caseView.tripViability.verdict, 'FAIL');

    // A second change keeps the subject failing: attach, never a second case.
    const signal2 = randomUUID();
    assert.equal((await recordChangeSignal(uow, {
      workspaceId: f.seed.workspaceId, actorPrincipalId: ACTOR, idempotencyKey: `signal:${signal2}`,
      changeSignalId: signal2, originKind: 'PROVIDER_EVENT', originKey: `test:${signal2}`, changeType: 'TRIP_PURPOSE_CHANGED', contentHash: 'h2', receivedAt: NOW,
    })).ok, true);
    assert.equal((await updateTripDetails(uow.underChangeSignal(signal2), {
      workspaceId: f.seed.workspaceId, actorPrincipalId: ACTOR, idempotencyKey: `trip:${signal2}`, tripId: f.tripId, expectedRevision: await tripRevision(f), purpose: 'changed again',
    })).ok, true);
    assert.equal((await worker.drainAvailable(NOW, pipeline(f), { workspaceId: f.seed.workspaceId })).processed, 1);
    const second = await escalate(f);
    assert.equal(second.opened, 0, JSON.stringify(second));
    assert.equal(second.attached, 1);
    assert.equal((await casesFor(f)).length, 1, 'still one case');
    const linked2 = await f.pool.query<{ change_signal_id: string }>('SELECT change_signal_id FROM case_signals WHERE workspace_id = $1 AND recovery_case_id = $2 ORDER BY change_signal_id', [f.seed.workspaceId, cases[0]!.id]);
    assert.deepEqual(linked2.rows.map((r) => r.change_signal_id).sort(), [signalId, signal2].sort());
  });
});
