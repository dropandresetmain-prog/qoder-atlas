/**
 * M9 3B — TR867 vs TR885 proven with the real evaluator, not fixture
 * inventory presence.
 *
 * Both are real M7 SELECT_OFFER strategies evaluated through the real M6
 * registry (`evaluateRecoveryStrategy` -> `createM6Registry()` ->
 * `participationEvaluator`'s programme-arrival-readiness check). The
 * candidate's own published arrival time is what decides viability — the
 * strategy never consults a fixture "expected outcome" field.
 *
 * TR867: arrival 20:45 against a 20:45 REQUIRED physical-presence commitment
 * needing 150 minutes readiness -> available 0 -> NOT_VIABLE.
 * TR885: arrival 14:35 against the same commitment -> available ~370 ->
 * VIABLE.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { beginSeed, commitSeed } from './m2Seed.ts';
import { openRecoveryCase } from '../src/persistence/postgres/commands/m8AuthorityCommands.ts';
import { PgUnitOfWork, type ExecuteOutcome } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { evaluateRecoveryStrategy } from '../src/resolution/scenarios/evaluate.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import { emptyWorld } from '../test/support/m6World.ts';
import type { WJourney, WJourneyItem, WProgrammeItem, WParticipation, WTransportService } from '../src/resolution/world/world.ts';
import type { WorldSnapshotManifest } from '../src/contracts/v2/scope/readScope.ts';

after(async () => {
  const pool = await sharedTestPool();
  await pool.end();
});

const NOW = '2031-09-29T00:00:00.000Z';
const FINALS_WINDOW = { start: '2031-09-29T20:45:00.000Z', end: '2031-09-29T21:45:00.000Z' };
const READINESS_MINUTES = 150;

function mustOk<T>(o: ExecuteOutcome<T>): T {
  if (!o.ok) assert.fail(`${o.conflict.kind}: ${o.conflict.message}`);
  return o.value;
}
function emptyManifest(): WorldSnapshotManifest {
  return { evaluatedAt: NOW, evaluatorVersions: [], aggregateReads: [], scopeReads: [], evidenceReads: [], coverageReads: [], missingCoverage: [] };
}

describe('M9 3B onward replacement flight viability (real evaluator)', () => {
  test('TR867 (arrives exactly at the deadline) -> NOT_VIABLE; TR885 (arrives ~370min early) -> VIABLE', async () => {
    const pool = await sharedTestPool();
    const seed = await beginSeed(pool, 'M9 3B replacement flight viability');
    await commitSeed(seed);
    const uow = () => new PgUnitOfWork(pool, seed.workspaceId);
    const opened = mustOk(await openRecoveryCase(uow(), {
      workspaceId: seed.workspaceId, actorPrincipalId: seed.actorId, idempotencyKey: randomUUID(), openedAt: NOW,
    }));

    const journeyId = randomUUID();
    const tripId = randomUUID();
    const travellerId = randomUUID();
    const itemId = randomUUID();
    const programmeItemId = randomUUID();
    const participationId = randomUUID();
    const originPlaceId = 'onward-origin';
    const destPlaceId = 'onward-destination'; // same place as the REQUIRED commitment — no transfer needed

    const journey: WJourney = {
      id: journeyId, revision: 1, tripId, travellerId, lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null,
    };
    const item: WJourneyItem = {
      id: itemId, journeyId, kind: 'TRANSPORT', orderKey: '010', lifecycleStatus: 'ACTIVE', flexible: true, intendedWindow: null,
      desiredOriginPlaceId: originPlaceId, desiredDestinationPlaceId: destPlaceId, selectedServiceId: null, intendedPlaceId: null,
      requiredNights: null, participationId: null, standaloneTitle: null, standaloneWindow: null, resourceId: null, intendedLocationPlaceId: null,
    };
    const programmeItem: WProgrammeItem = {
      id: programmeItemId, programmeId: randomUUID(), title: 'Finals', itemType: 'SESSION', placeId: destPlaceId,
      window: FINALS_WINDOW, lifecycleStatus: 'SCHEDULED', scheduleAuthority: 'INTERNAL',
      operatingRequirements: { requiresPhysicalPresence: true, readinessBufferMinutes: READINESS_MINUTES },
    };
    const participation: WParticipation = {
      id: participationId, programmeItemId, travellerId, obligation: 'REQUIRED', accepted: true, preparationWindow: null,
    };

    function candidateService(arrival: string): WTransportService {
      return {
        id: randomUUID(), revision: 1, mode: 'AIR', operator: 'op', originPlaceId, destinationPlaceId: destPlaceId,
        published: {
          departure: { value: '2031-09-29T10:00:00.000Z', observedAt: '2031-09-01T00:00:00.000Z', evidenceId: null },
          arrival: { value: arrival, observedAt: '2031-09-01T00:00:00.000Z', evidenceId: null },
        },
        estimated: { departure: null, arrival: null },
        actual: { departure: null, arrival: null },
      };
    }

    const jurisdictionId = randomUUID();
    const reservationId = randomUUID();
    const lineId = randomUUID();

    async function evaluateCandidate(service: WTransportService) {
      const world = emptyWorld({
        journeys: [journey], journeyItems: [item], transportServices: [service],
        programmeItems: [programmeItem], participations: [participation],
        // Real exposure/coverage/booking data so advisories and
        // supplier_fulfilment resolve to a real PASS instead of leaving this
        // active TRANSPORT item's evaluation blocked on UNKNOWN — the test
        // targets programme-arrival-readiness, but overall viability is
        // genuinely whole-person.
        jurisdictions: [{ id: jurisdictionId, revision: 1, name: 'Test regime', regimeKind: 'STATE' }],
        placeJurisdictions: [
          { placeId: originPlaceId, jurisdictionId, basis: 'AREA_MEMBERSHIP', areaVersionId: randomUUID(), evidenceId: null },
          { placeId: destPlaceId, jurisdictionId, basis: 'AREA_MEMBERSHIP', areaVersionId: randomUUID(), evidenceId: null },
        ],
        coverage: (['ADVISORY', 'CONDITION', 'ENTRY_REQUIREMENT', 'TRANSIT_REQUIREMENT'] as const).map((topic) => ({
          id: randomUUID(), topic, queryBounds: { jurisdictionId }, edition: `edition:${randomUUID()}`,
          watermark: null, completeness: 'COMPLETE', limitations: [], expiresAt: null, evidenceId: null,
        })),
        reservations: [{
          id: reservationId, revision: 1, reservationType: 'TRANSPORT', observedStatus: 'CONFIRMED',
          observedStatusAt: NOW, responsibleOrganisationId: null, responsibleTravellerId: travellerId,
        }],
        reservationLines: [{
          id: lineId, reservationId, productType: 'TRANSPORT', observedStatus: 'CONFIRMED', observedStatusAt: NOW,
          evidenceId: null, transportServiceId: service.id, resourceId: null, placeId: null, interval: null,
        }],
        allocations: [{ id: randomUUID(), reservationId, lineId, travellerId, journeyItemId: itemId, role: 'PASSENGER', quantity: 1 }],
        focus: [{ kind: 'JOURNEY_ITEM', id: itemId }],
      });
      const offerId = randomUUID();
      const scenarioChange = ScenarioChangeSchema.parse({
        id: randomUUID(), recoveryStrategyId: randomUUID(), strategyVersion: 1,
        affectedSubjectRefs: [{ kind: 'JOURNEY_ITEM', id: itemId }],
        basisAssessmentId: randomUUID(),
        effects: [{ effectKind: 'SELECT_OFFER', journeyItemId: itemId, offerId }],
      });
      const evaluated = evaluateRecoveryStrategy({
        recoveryCaseId: opened.caseId, baseWorld: world, baseManifest: emptyManifest(),
        basisAssessmentId: scenarioChange.basisAssessmentId, scenarioChange, now: NOW,
        resolvedOffers: [{ offerId, transportServiceId: service.id }],
      });
      assert.equal(evaluated.ok, true, JSON.stringify(evaluated));
      if (!evaluated.ok) throw new Error('unreachable');
      return evaluated.value.strategy;
    }

    // --- TR867: arrival == commitment start; 0 of the required 150 minutes. ---
    const tr867 = candidateService('2031-09-29T20:45:00.000Z');
    const strategy867 = await evaluateCandidate(tr867);
    const journeyResult867 = strategy867.candidateAssessmentResults.find((r) => r.subjects[0]?.subjectRef.id === journeyId);
    assert.ok(journeyResult867);
    const readinessDim867 = journeyResult867!.dimensions.find((d) => d.dimension === 'programme_participation');
    assert.ok(readinessDim867);
    assert.equal(readinessDim867!.verdict, 'FAIL');
    assert.equal(readinessDim867!.explanations[0]?.reasonCode, 'insufficient_arrival_readiness');
    assert.equal(readinessDim867!.explanations[0]?.facts.availableMinutes, 0);
    assert.equal(readinessDim867!.explanations[0]?.facts.requiredMinutes, READINESS_MINUTES);
    assert.equal(strategy867.viability, 'NOT_VIABLE');

    // --- TR885: arrival well before the commitment; ~370 available minutes. ---
    const tr885 = candidateService('2031-09-29T14:35:00.000Z');
    const strategy885 = await evaluateCandidate(tr885);
    const journeyResult885 = strategy885.candidateAssessmentResults.find((r) => r.subjects[0]?.subjectRef.id === journeyId);
    assert.ok(journeyResult885);
    const readinessDim885 = journeyResult885!.dimensions.find((d) => d.dimension === 'programme_participation');
    assert.ok(readinessDim885);
    assert.equal(readinessDim885!.verdict, 'PASS');
    // Readiness itself passed (370 >= 150 required); with no further departing
    // item to check afterward, the dimension's terminal explanation is the
    // "nothing else to fail against" PASS, whose facts carry the same 370
    // minutes of slack under `slackMinutes` (reach.readyAt -> commitment start).
    assert.equal(readinessDim885!.explanations[0]?.reasonCode, 'participation_feasible');
    assert.equal(readinessDim885!.explanations[0]?.facts.slackMinutes, 370);
    assert.equal(strategy885.viability, 'VIABLE');
  });
});
