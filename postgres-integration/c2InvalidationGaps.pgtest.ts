/**
 * C2 targeted-fix regressions (AN-1 / AN-2 / AN-3) against real PostgreSQL.
 *
 * Proves only the three Act Now invalidation/capture gaps returned by C2 review.
 * Scenario facts live in this file only (no Sarah/demo hardcoding in domain code).
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { attachSeedSession, beginSeed, commitSeed, takeSeedEvidence, type SeedSession } from './m2Seed.ts';
import {
  seedOrganisation,
  seedReservation,
  seedReservationAllocation,
  seedReservationLine,
  seedResource,
} from './m3Seed.ts';
import {
  KnowledgeFixture,
  seedBooking,
  seedIntendedVisit,
  seedJourney,
  seedJurisdictionWithPlaces,
  seedService,
  seedTransportIntent,
  seedTraveller,
  seedTrip,
} from './m6WorldSeed.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { createBudget } from '../src/persistence/postgres/commands/arrangementCommands.ts';
import { createRuleSet } from '../src/persistence/postgres/commands/knowledgeCommands.ts';
import { evaluateImpact } from '../src/persistence/postgres/world/pgEvaluation.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { currentAssessmentView } from '../src/persistence/postgres/world/pgAssessments.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';
import { groupEvaluator } from '../src/resolution/evaluation/evaluators/group.ts';
import type { AssessmentDimension, AssessmentResult } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import type { TypedRef } from '../src/domain/v2/shared/identity.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-07-01T00:00:00.000Z';
const INTERVAL = { start: '2031-07-10T12:00:00.000Z', end: '2031-07-10T18:00:00.000Z' };
const registry = createM6Registry();

function mustOk<T>(outcome: ExecuteOutcome<T>): T {
  if (!outcome.ok) throw new Error(`${outcome.conflict.kind}: ${outcome.conflict.message}`);
  return outcome.value;
}

const journeyRef = (id: string): TypedRef => ({ kind: 'JOURNEY', id });

function dim(assessment: AssessmentResult, name: string): AssessmentDimension {
  const found = assessment.dimensions.find((d) => d.dimension === name);
  assert.ok(found, `dimension ${name}`);
  return found;
}

async function assertStatus(expected: string, pool: Pool, workspaceId: string, journeyId: string): Promise<void> {
  const view = await currentAssessmentView(pool, workspaceId, journeyRef(journeyId), 'VIABILITY', NOW);
  assert.equal(view.status, expected, JSON.stringify({ status: view.status, staleness: view.staleness, openWork: view.openWork }));
}

/** RESOURCE_USE reservation line with a timed interval on a shared Resource. */
async function seedResourceUseBooking(
  seed: SeedSession,
  params: { travellerId: string; resourceId: string; interval?: { start: string; end: string } },
): Promise<{ reservationId: string; lineId: string }> {
  const reservationId = await seedReservation(seed, { travellerId: params.travellerId, reservationType: 'RESOURCE_USE' });
  const lineId = await seedReservationLine(seed, { reservationId, productType: 'RESOURCE_USE', resourceId: params.resourceId });
  const window = params.interval ?? INTERVAL;
  await seed.client.query(
    `UPDATE resource_use_line_details
        SET use_interval_start = $3, use_interval_end = $4
      WHERE workspace_id = $1 AND line_id = $2`,
    [seed.workspaceId, lineId, window.start, window.end],
  );
  await seedReservationAllocation(seed, { reservationId, lineId, travellerId: params.travellerId });
  return { reservationId, lineId };
}

function capacityFacts(assessment: AssessmentResult): { verdict: string; usage: number | undefined; reasonCode: string | undefined } {
  const d = dim(assessment, 'resource_capacity');
  const explanation = d.explanations[0];
  return {
    verdict: d.verdict,
    usage: typeof explanation?.facts.usage === 'number' ? explanation.facts.usage : undefined,
    reasonCode: explanation?.reasonCode,
  };
}

/* -------------------------------------------------------------------------- */
/* AN-1 — shared resource capacity capture + invalidation                     */
/* -------------------------------------------------------------------------- */

describe('C2 AN-1: shared resource capacity capture and invalidation', () => {
  test('per-Journey capture sees peer usage; B booking invalidates A; Resource and Journey captures agree', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'C2 AN-1 resource capacity');
    const resourceId = await seedResource(seed, 'EQUIPMENT');
    await seed.client.query(`UPDATE resources SET capacity = 1 WHERE workspace_id = $1 AND id = $2`, [seed.workspaceId, resourceId]);

    const travellerA = (await seedTraveller(seed)).travellerId;
    const journeyA = await seedJourney(seed, { tripId: await seedTrip(seed), travellerId: travellerA });
    await seedResourceUseBooking(seed, { travellerId: travellerA, resourceId });
    await commitSeed(seed);
    const ws = seed.workspaceId;

    const first = await evaluateImpact(pool, {
      workspaceId: ws, focus: [journeyRef(journeyA)], now: NOW, registry, persist: { actorId: seed.actorId },
    });
    const a0 = first.assessments.find((a) => a.subjects[0]?.subjectRef.id === journeyA);
    assert.ok(a0);
    assert.deepEqual(capacityFacts(a0), { verdict: 'PASS', usage: 1, reasonCode: 'capacity_within_limit' });
    await assertStatus('CURRENT', pool, ws, journeyA);

    // Traveller B / Trip B books the same Resource over the same interval.
    const s = await attachSeedSession(pool, ws, seed.actorId);
    const travellerB = (await seedTraveller(s)).travellerId;
    await seedJourney(s, { tripId: await seedTrip(s), travellerId: travellerB });
    await seedResourceUseBooking(s, { travellerId: travellerB, resourceId });
    await commitSeed(s);

    await assertStatus('PENDING_REASSESSMENT', pool, ws, journeyA);

    const second = await evaluateImpact(pool, {
      workspaceId: ws, focus: [journeyRef(journeyA)], now: NOW, registry, persist: { actorId: seed.actorId },
    });
    const a1 = second.assessments.find((a) => a.subjects[0]?.subjectRef.id === journeyA);
    assert.ok(a1);
    assert.deepEqual(capacityFacts(a1), { verdict: 'FAIL', usage: 2, reasonCode: 'capacity_exceeded' });

    // Resource-focused capture and Journey-A-focused capture agree on capacity.
    const journeyWorld = await captureWorld(pool, { workspaceId: ws, focus: [journeyRef(journeyA)], at: NOW, informationTopics: registry.informationTopics });
    const resourceWorld = await captureWorld(pool, {
      workspaceId: ws, focus: [{ kind: 'RESOURCE', id: resourceId }], at: NOW, informationTopics: registry.informationTopics,
    });
    const journeyEval = groupEvaluator.evaluate(journeyRef(journeyA), {
      now: NOW, world: journeyWorld, effective: projectEffectiveWorld(journeyWorld),
    });
    // Resource focus must still reach Journey A via registered allocation edges.
    assert.ok(resourceWorld.journeys.some((j) => j.id === journeyA), 'Resource focus reaches Journey A');
    const resourceEval = groupEvaluator.evaluate(journeyRef(journeyA), {
      now: NOW, world: resourceWorld, effective: projectEffectiveWorld(resourceWorld),
    });
    const journeyCapacity = journeyEval.dimensions.find((d) => d.dimension === 'resource_capacity');
    const resourceCapacity = resourceEval.dimensions.find((d) => d.dimension === 'resource_capacity');
    assert.equal(journeyCapacity?.verdict, 'FAIL');
    assert.equal(resourceCapacity?.verdict, 'FAIL');
    assert.equal(journeyCapacity?.explanations[0]?.facts.usage, 2);
    assert.equal(resourceCapacity?.explanations[0]?.facts.usage, 2);
    assert.equal(journeyWorld.reservationLines.filter((l) => l.resourceId === resourceId).length, 2);
    assert.ok(!journeyWorld.journeys.some((j) => j.travellerId === travellerB), 'peer Journey is not invented into A-focused capture');
  });

  test('cancelling a peer resource line invalidates a capacity-dependent CURRENT assessment', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'C2 AN-1 lifecycle invalidation');
    const resourceId = await seedResource(seed, 'ROOM');
    await seed.client.query(`UPDATE resources SET capacity = 1 WHERE workspace_id = $1 AND id = $2`, [seed.workspaceId, resourceId]);

    const travellerA = (await seedTraveller(seed)).travellerId;
    const journeyA = await seedJourney(seed, { tripId: await seedTrip(seed), travellerId: travellerA });
    await seedResourceUseBooking(seed, { travellerId: travellerA, resourceId });

    const travellerB = (await seedTraveller(seed)).travellerId;
    await seedJourney(seed, { tripId: await seedTrip(seed), travellerId: travellerB });
    const peer = await seedResourceUseBooking(seed, { travellerId: travellerB, resourceId });
    await commitSeed(seed);

    const over = await evaluateImpact(pool, {
      workspaceId: seed.workspaceId, focus: [journeyRef(journeyA)], now: NOW, registry, persist: { actorId: seed.actorId },
    });
    assert.equal(capacityFacts(over.assessments.find((a) => a.subjects[0]?.subjectRef.id === journeyA)!).verdict, 'FAIL');
    await assertStatus('CURRENT', pool, seed.workspaceId, journeyA);

    // Re-open a write session to cancel the peer line (counts toward usage while CONFIRMED).
    const s = await attachSeedSession(pool, seed.workspaceId, seed.actorId);
    const evidence = takeSeedEvidence(s);
    await s.client.query(
      `UPDATE reservation_lines
          SET observed_status = 'CANCELLED', observed_status_at = $3, observation_evidence_id = $4
        WHERE workspace_id = $1 AND id = $2`,
      [seed.workspaceId, peer.lineId, NOW, evidence],
    );
    await commitSeed(s);

    await assertStatus('PENDING_REASSESSMENT', pool, seed.workspaceId, journeyA);
    const after = await evaluateImpact(pool, {
      workspaceId: seed.workspaceId, focus: [journeyRef(journeyA)], now: NOW, registry, persist: { actorId: seed.actorId },
    });
    assert.deepEqual(capacityFacts(after.assessments.find((a) => a.subjects[0]?.subjectRef.id === journeyA)!), {
      verdict: 'PASS', usage: 1, reasonCode: 'capacity_within_limit',
    });
  });
});

/* -------------------------------------------------------------------------- */
/* AN-2 — budget insertion invalidates funding                                */
/* -------------------------------------------------------------------------- */

async function seedFundedResourceBooking(
  seed: SeedSession,
  params: { orgId: string; travellerId: string; amount: string },
): Promise<{ journeyId: string; reservationId: string }> {
  const journeyId = await seedJourney(seed, { tripId: await seedTrip(seed), travellerId: params.travellerId });
  const reservationId = await seedReservation(seed, { organisationId: params.orgId, reservationType: 'RESOURCE_USE' });
  const resourceId = await seedResource(seed, 'EQUIPMENT');
  const lineId = await seedReservationLine(seed, { reservationId, productType: 'RESOURCE_USE', resourceId });
  await seed.client.query(
    `UPDATE resource_use_line_details SET use_interval_start = $3, use_interval_end = $4 WHERE workspace_id = $1 AND line_id = $2`,
    [seed.workspaceId, lineId, INTERVAL.start, INTERVAL.end],
  );
  await seedReservationAllocation(seed, { reservationId, lineId, travellerId: params.travellerId });
  await seed.client.query(
    `INSERT INTO cost_allocations
       (workspace_id, id, reservation_id, payer_organisation_id, entry_kind, amount, currency, created_by_actor_id)
     VALUES ($1, $2, $3, $4, 'INTENDED', $5::numeric, 'USD', $6)`,
    [seed.workspaceId, randomUUID(), reservationId, params.orgId, params.amount, seed.actorId],
  );
  return { journeyId, reservationId };
}

describe('C2 AN-2: budget insertion invalidates funding', () => {
  test('inserting a tighter applicable budget invalidates PASS and reassessment FAILs', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'C2 AN-2 budget insertion');
    const orgId = await seedOrganisation(seed, 'USD');
    const travellerId = (await seedTraveller(seed)).travellerId;
    const { journeyId } = await seedFundedResourceBooking(seed, { orgId, travellerId, amount: '100.00' });
    await commitSeed(seed);

    const budget1 = randomUUID();
    mustOk(await createBudget(new PgUnitOfWork(pool, seed.workspaceId), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      budget: { id: budget1, organisationId: orgId, purpose: 'primary', amount: { amount: '500.00', currency: 'USD' } },
    }));

    const first = await evaluateImpact(pool, {
      workspaceId: seed.workspaceId, focus: [journeyRef(journeyId)], now: NOW, registry, persist: { actorId: seed.actorId },
    });
    const funding0 = dim(first.assessments.find((a) => a.subjects[0]?.subjectRef.id === journeyId)!, 'funding');
    assert.equal(funding0.verdict, 'PASS', JSON.stringify(funding0.explanations.map((e) => e.reasonCode)));
    assert.ok(funding0.explanations.some((e) => e.reasonCode === 'within_budget'));
    await assertStatus('CURRENT', pool, seed.workspaceId, journeyId);

    mustOk(await createBudget(new PgUnitOfWork(pool, seed.workspaceId), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      budget: { id: randomUUID(), organisationId: orgId, purpose: 'tight-threshold', amount: { amount: '50.00', currency: 'USD' } },
    }));

    await assertStatus('PENDING_REASSESSMENT', pool, seed.workspaceId, journeyId);

    const second = await evaluateImpact(pool, {
      workspaceId: seed.workspaceId, focus: [journeyRef(journeyId)], now: NOW, registry, persist: { actorId: seed.actorId },
    });
    const funding1 = dim(second.assessments.find((a) => a.subjects[0]?.subjectRef.id === journeyId)!, 'funding');
    assert.equal(funding1.verdict, 'FAIL', JSON.stringify(funding1.explanations.map((e) => ({ code: e.reasonCode, facts: e.facts }))));
    assert.ok(funding1.explanations.some((e) => e.reasonCode === 'budget_exceeded'));
  });

  test('updating or deleting an applicable budget cannot leave a prior funding assessment CURRENT', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'C2 AN-2 budget update/delete');
    const orgId = await seedOrganisation(seed, 'USD');
    const travellerId = (await seedTraveller(seed)).travellerId;
    const { journeyId } = await seedFundedResourceBooking(seed, { orgId, travellerId, amount: '100.00' });
    await commitSeed(seed);

    const budgetId = randomUUID();
    mustOk(await createBudget(new PgUnitOfWork(pool, seed.workspaceId), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      budget: { id: budgetId, organisationId: orgId, purpose: 'sole', amount: { amount: '500.00', currency: 'USD' } },
    }));

    await evaluateImpact(pool, {
      workspaceId: seed.workspaceId, focus: [journeyRef(journeyId)], now: NOW, registry, persist: { actorId: seed.actorId },
    });
    await assertStatus('CURRENT', pool, seed.workspaceId, journeyId);

    const s = await attachSeedSession(pool, seed.workspaceId, seed.actorId);
    await s.client.query(`UPDATE budgets SET amount = 40.00 WHERE workspace_id = $1 AND id = $2`, [seed.workspaceId, budgetId]);
    await commitSeed(s);
    await assertStatus('PENDING_REASSESSMENT', pool, seed.workspaceId, journeyId);

    await evaluateImpact(pool, {
      workspaceId: seed.workspaceId, focus: [journeyRef(journeyId)], now: NOW, registry, persist: { actorId: seed.actorId },
    });
    await assertStatus('CURRENT', pool, seed.workspaceId, journeyId);

    const s2 = await attachSeedSession(pool, seed.workspaceId, seed.actorId);
    await s2.client.query(`DELETE FROM budgets WHERE workspace_id = $1 AND id = $2`, [seed.workspaceId, budgetId]);
    await commitSeed(s2);
    await assertStatus('PENDING_REASSESSMENT', pool, seed.workspaceId, journeyId);
  });
});

/* -------------------------------------------------------------------------- */
/* AN-3 — RuleSet without edition still records invalidation hook             */
/* -------------------------------------------------------------------------- */

describe('C2 AN-3: RuleSet without captured edition still invalidates on publish', () => {
  test('UNKNOWN rule_edition_not_captured becomes PENDING when the first edition is published', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'C2 AN-3 ruleset edition hook');
    const origin = await seedJurisdictionWithPlaces(seed, { name: 'Origin regime', places: [{ name: 'Origin airport', placeType: 'AIRPORT' }] });
    const host = await seedJurisdictionWithPlaces(seed, { name: 'Host regime', places: [{ name: 'Host airport', placeType: 'AIRPORT' }] });
    const travellerId = (await seedTraveller(seed)).travellerId;
    const journeyId = await seedJourney(seed, { tripId: await seedTrip(seed), travellerId });
    const flight = await seedService(seed, {
      operator: 'Carrier', originPlaceId: origin.placeIds[0]!, destinationPlaceId: host.placeIds[0]!,
      published: { departure: '2031-07-02T06:00:00.000Z', arrival: '2031-07-02T12:00:00.000Z' },
    });
    const item = await seedTransportIntent(seed, {
      journeyId, orderKey: '010', originPlaceId: origin.placeIds[0]!, destinationPlaceId: host.placeIds[0]!, selectedServiceId: flight,
    });
    await seedBooking(seed, { travellerId, serviceId: flight, journeyItemId: item });
    await seedIntendedVisit(seed, {
      journeyId, jurisdictionId: host.jurisdictionId, purpose: 'BUSINESS',
      start: '2031-07-02T12:00:00.000Z', end: '2031-07-05T12:00:00.000Z',
    });
    await commitSeed(seed);

    const knowledge = new KnowledgeFixture(pool, seed);
    const organisationId = await knowledge.organisation('Policy publisher', 'EUR');
    await knowledge.coverage({ topic: 'ENTRY_REQUIREMENT', completeness: 'COMPLETE', jurisdictionId: host.jurisdictionId });

    // Draft edition is not captured (reader only loads PUBLISHED/SUPERSEDED).
    const draft = mustOk(await createRuleSet(new PgUnitOfWork(pool, seed.workspaceId), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(),
      issuerRef: { kind: 'ORGANISATION', id: organisationId }, policyFamily: 'entry', editionNumber: 1, status: 'DRAFT',
      expression: { operator: 'PREDICATE', predicateId: 'journey.purpose_in', parameters: { purposes: ['LEISURE'] } },
      rules: [],
    }));

    await knowledge.assignRule({
      ruleSetId: draft.ruleSetId, jurisdictionId: host.jurisdictionId, validFrom: '2030-01-01T00:00:00.000Z',
    });

    const first = await evaluateImpact(pool, {
      workspaceId: seed.workspaceId, focus: [journeyRef(journeyId)], now: NOW, registry, persist: { actorId: seed.actorId },
    });
    const entry0 = dim(first.assessments.find((a) => a.subjects[0]?.subjectRef.id === journeyId)!, 'entry_feasibility');
    assert.equal(entry0.verdict, 'UNKNOWN');
    assert.ok(entry0.explanations.some((e) => e.reasonCode === 'rule_edition_not_captured'), JSON.stringify(entry0.explanations.map((e) => e.reasonCode)));
    await assertStatus('CURRENT', pool, seed.workspaceId, journeyId);

    // Manifest must have recorded RULE_SET scope even with no captured edition.
    const world = await captureWorld(pool, {
      workspaceId: seed.workspaceId, focus: [journeyRef(journeyId)], at: NOW, informationTopics: registry.informationTopics,
    });
    assert.ok(
      world.manifest.scopeReads.some((s) => s.scopeKind === 'RULE_SET' && s.scopeId === draft.ruleSetId),
      'RULE_SET scope recorded for referenced RuleSet without edition',
    );
    assert.equal(world.ruleSetVersions.filter((v) => v.ruleSetId === draft.ruleSetId).length, 0);

    // Publish the draft → RULE_SET advances → prior UNKNOWN is no longer CURRENT.
    const s = await attachSeedSession(pool, seed.workspaceId, seed.actorId);
    await s.client.query(
      `UPDATE rule_set_versions
          SET status = 'PUBLISHED', published_at = $3, published_by_actor_id = $4
        WHERE workspace_id = $1 AND id = $2`,
      [seed.workspaceId, draft.versionId, NOW, seed.actorId],
    );
    await commitSeed(s);

    await assertStatus('PENDING_REASSESSMENT', pool, seed.workspaceId, journeyId);

    const second = await evaluateImpact(pool, {
      workspaceId: seed.workspaceId, focus: [journeyRef(journeyId)], now: NOW, registry, persist: { actorId: seed.actorId },
    });
    const entry1 = dim(second.assessments.find((a) => a.subjects[0]?.subjectRef.id === journeyId)!, 'entry_feasibility');
    assert.equal(entry1.verdict, 'FAIL', JSON.stringify(entry1.explanations.map((e) => e.reasonCode)));
    assert.ok(entry1.explanations.some((e) => e.reasonCode === 'requirement_not_met'));
  });
});
