/**
 * A4 CP4a focused tests: credential visit-scope aggregation, boardability
 * clock that eliminates same-night recovery, and property-vs-place stay labels.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { persistStayExecutionBindings } from '../src/persistence/postgres/execution/stayExecutionInputs.ts';
import { correlatedTransportOffers } from '../src/resolution/planning/proposers/transportProposer.ts';
import { transportRequestId, type TransportCorridor } from '../src/resolution/planning/transportCorridors.ts';
import { materialCandidateFromEvaluation } from '../src/resolution/planning/decisionEvidence.ts';
import { emptyWorld, id } from './support/m6World.ts';
import { ScenarioChangeSchema } from '../src/contracts/v2/scenario/scenarioChange.ts';
import type { CapturedWorld, WJourney } from '../src/resolution/world/world.ts';
import type { PlanningToolResult } from '../src/contracts/v2/planning/planningTool.ts';

const TIMELINE = fileURLToPath(
  new URL('../data/ait-demo-input-pack/scenarios/s2-missed-connection/inputs/progressive-delay-timeline.json', import.meta.url),
);

test('credential visit scope is read from credential_selection_visits, not a missing column', async () => {
  const visitId = id();
  const journeyId = id();
  const selectionId = id();
  const credentialId = id();
  const credentialVersionId = id();
  const offerId = 'stay-offer:test-scope';
  const proposedItemId = id();
  const placeId = id();
  const sqlLog: string[] = [];

  const db = {
    async query(sql: string, params?: unknown[]) {
      sqlLog.push(sql);
      if (sql.includes('external_connections')) return { rows: [{ id: id() }], rowCount: 1 };
      if (sql.includes('credential_selection_visits')) {
        assert.ok(sql.includes('credential_selections'));
        assert.ok(sql.includes('array_agg'));
        assert.ok(!/FROM\s+credential_selections\s+WHERE[\s\S]*ANY\(\s*scope_intended_visit_ids\s*\)/i.test(sql));
        assert.equal(params?.[2], visitId);
        return {
          rows: [{
            id: selectionId,
            credential_id: credentialId,
            credential_version_id: credentialVersionId,
            scope_intended_visit_ids: [visitId],
          }],
          rowCount: 1,
        };
      }
      if (sql.includes('INSERT INTO stay_execution_bindings')) {
        const approvedVisit = JSON.parse(String(params?.[20]));
        assert.equal(approvedVisit.kind, 'EXISTING');
        assert.deepEqual(approvedVisit.credentialSelection.scopeIntendedVisitIds, [visitId]);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const written = await persistStayExecutionBindings(db as never, {
    workspaceId: id(),
    actorId: 'principal:test',
    recoveryCaseId: id(),
    strategies: [{
      id: id(),
      scenarioChange: {
        effects: [{
          effectKind: 'ADD_JOURNEY_STAY',
          journeyId,
          proposedJourneyItemId: proposedItemId,
          orderKey: '000025',
          offerId,
          offerPrice: { amount: '117.29', currency: 'USD' },
          visit: { kind: 'EXISTING', visitId },
        }],
      },
    } as never],
    quotedStays: [{
      baseCandidateKey: 'base',
      journeyId,
      context: {
        placeId,
        stayWindow: { start: '2026-09-30T07:00:00.000Z', end: '2026-10-03T03:00:00.000Z' },
        provenance: { providerId: 'nuitee', mode: 'RECORD', observedAt: '2026-09-20T16:16:01.776Z', sourceRefs: ['src'] },
        proposedJourneyItemId: proposedItemId,
        orderKey: '000025',
        visit: { kind: 'EXISTING', visitId },
      },
      offer: {
        offerId,
        placeId,
        stayWindow: { start: '2026-09-30T07:00:00.000Z', end: '2026-10-03T03:00:00.000Z' },
        price: { amount: '117.29', currency: 'USD' },
        propertyName: 'Alternate Property',
      },
      provider: {
        propertyId: 'property-alt',
        rateId: 'rate-1',
        quoteId: 'quote-1',
        searchRequestFingerprint: 'fp',
        quoteProvenance: { providerId: 'nuitee', mode: 'RECORD', observedAt: '2026-09-20T16:16:01.776Z', sourceRefs: ['src'] },
      },
    }],
  });

  assert.equal(written, 1);
  assert.ok(sqlLog.some((sql) => sql.includes('credential_selection_visits')));
});

test('planning now after evening departure drops same-night boardable offers', () => {
  const corridor = {
    journeyItemId: 'item-onward',
    journeyId: 'journey-1',
    origin: { system: 'IATA', value: 'AAA' },
    destination: { system: 'IATA', value: 'BBB' },
    originPlaceId: 'place-origin',
    destinationPlaceId: 'place-dest',
    departureDate: '2026-09-29',
    passengers: { adults: 1 },
  } as TransportCorridor;

  const requestId = transportRequestId(corridor);
  const toolResults = [{
    requestId,
    operation: 'flight.search',
    status: 'SUCCEEDED',
    normalizedEvidence: {
      offers: [
        {
          offerId: 'evening',
          availability: 'AVAILABLE',
          totalPrice: { amount: 181.83, currency: 'USD' },
          segments: [{
            origin: { system: 'IATA', value: 'AAA' },
            destination: { system: 'IATA', value: 'BBB' },
            departure: '2026-09-29T21:15:00+09:00',
            arrival: '2026-09-30T05:20:00+08:00',
            carrierCode: 'XX',
          }],
        },
        {
          offerId: 'morning',
          availability: 'AVAILABLE',
          totalPrice: { amount: 83.35, currency: 'USD' },
          segments: [{
            origin: { system: 'IATA', value: 'AAA' },
            destination: { system: 'IATA', value: 'BBB' },
            departure: '2026-09-30T08:20:00+09:00',
            arrival: '2026-09-30T14:35:00+08:00',
            carrierCode: 'XX',
          }],
        },
      ],
    },
    provenance: { providerId: 'atlas', mode: 'RECORD', observedAt: '2026-09-20T16:15:00.000Z', sourceRefs: [] },
    uncertainty: [],
  }] as unknown as PlanningToolResult[];

  const beforeClose = correlatedTransportOffers({
    corridors: [corridor],
    toolResults,
    now: '2026-09-29T18:05:00+09:00',
    maxOffersPerCorridor: 6,
  });
  assert.equal(beforeClose.offers.length, 2, 'both evening and morning remain boardable before window close');

  const afterClose = correlatedTransportOffers({
    corridors: [corridor],
    toolResults,
    now: '2026-09-29T21:30:00+09:00',
    maxOffersPerCorridor: 6,
  });
  assert.equal(afterClose.offers.length, 1);
  assert.equal(afterClose.offers[0]?.rawOfferId, 'morning');
});

test('S2 timeline documents planningNow for overnight-required stages', () => {
  const timeline = JSON.parse(readFileSync(TIMELINE, 'utf8')) as {
    stages: Array<{ id: string; planningNow?: string; connectionRemainingMinutes?: number }>;
  };
  const closing = timeline.stages.find((s) => s.id === 'same_night_window_closing');
  const overnight = timeline.stages.find((s) => s.id === 'overnight_narita_necessary');
  const impossible = timeline.stages.find((s) => s.id === 'zg053_impossible');
  assert.ok(closing?.planningNow);
  assert.ok(overnight?.planningNow);
  assert.equal(impossible?.connectionRemainingMinutes, -65);
  assert.ok(Date.parse(closing!.planningNow!) >= Date.parse('2026-09-29T21:00:00+09:00'));
});

test('stay proposal keeps place context and surfaces quoted property label', () => {
  const journeyId = id();
  const placeId = id();
  const travellerId = id();
  const world = emptyWorld();
  world.travellers.push({ id: travellerId, revision: 1 } as never);
  world.journeys.push({
    id: journeyId, revision: 1, tripId: id(), travellerId, lifecycleStatus: 'ACTIVE', intendedWindow: null, responsibilityOrganisationId: null,
  } as WJourney);
  world.places.push({
    id: placeId, name: 'Destination Place Hotel Label', timeZone: 'Asia/Singapore', kind: 'ACCOMMODATION', externalRefs: [],
  } as never);

  const proposedItemId = id();
  const change = ScenarioChangeSchema.parse({
    id: id(),
    recoveryStrategyId: id(),
    strategyVersion: 1,
    affectedSubjectRefs: [{ kind: 'JOURNEY', id: journeyId }],
    basisAssessmentId: id(),
    effects: [{
      effectKind: 'ADD_JOURNEY_STAY',
      journeyId,
      proposedJourneyItemId: proposedItemId,
      orderKey: '000025',
      offerId: 'stay-offer:alt',
      offerPrice: { amount: '117.29', currency: 'USD' },
      visit: {
        kind: 'PROPOSED',
        proposedVisitId: id(),
        jurisdictionId: id(),
        purpose: 'summit',
        intendedWindow: { start: '2030-06-02T07:00:00.000Z', end: '2030-06-05T03:00:00.000Z' },
        credentialSelections: [{
          proposedSelectionId: id(),
          credentialId: id(),
          credentialVersionId: id(),
        }],
      },
    }],
  });

  const proposedWorld: CapturedWorld = {
    ...world,
    journeyItems: [{
      id: proposedItemId,
      journeyId,
      kind: 'STAY',
      orderKey: '000025',
      lifecycleStatus: 'PLANNED',
      flexible: false,
      intendedWindow: { start: '2030-06-02T07:00:00.000Z', end: '2030-06-05T03:00:00.000Z' },
      desiredOriginPlaceId: null,
      desiredDestinationPlaceId: null,
      selectedServiceId: null,
      intendedPlaceId: placeId,
      requiredNights: 3,
      participationId: null,
      standaloneTitle: 'Quoted Alternate Property',
      standaloneWindow: null,
      resourceId: null,
      intendedLocationPlaceId: null,
    }],
  };

  const material = materialCandidateFromEvaluation({
    candidateKey: 'cand-1',
    proposerId: 'proposer.test',
    domainId: 'TRANSPORT',
    recommended: true,
    result: {
      strategy: {
        id: id(),
        viability: 'VIABLE',
        status: 'EVALUATED',
        scenarioChange: change,
        candidateAssessmentResults: [],
        candidateAssessments: [],
        requiredAuthorityScopes: [],
        assumptions: [],
        requiredUnknowns: [],
      } as never,
      proposedWorld,
      canonicalUntouched: true,
      baselineAssessments: [],
      viabilityDecisions: [],
    },
  });

  assert.equal(material.proposal?.stays[0]?.placeLabel, 'Destination Place Hotel Label');
  assert.equal(material.proposal?.stays[0]?.propertyLabel, 'Quoted Alternate Property');
});
