/**
 * Checkpoint 2 seed truth: Atlas-recorded Sarah flight facts, a simulated
 * reprotection event, and Jordan delay gaps that the connection evaluator
 * classifies. No traveller or stage branch in application logic.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ReviewedEntryPolicySchema } from '../src/resolution/planning/reviewedEntryEvidence.ts';
import { evaluateRuleExpression, type PredicateContext } from '../src/resolution/evaluation/entryPredicates.ts';
import type { Encounter } from '../src/resolution/evaluation/encounters.ts';
import type { WCredential, WCredentialSelection, WCredentialVersion } from '../src/resolution/world/world.ts';
import { normalizeStayContext } from '../src/providers/hotel/nuiteeAdapter.ts';
import { emptyWorld, id } from './support/m6World.ts';

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8'));
}

function compactLocal(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso);
  assert.ok(match, iso);
  return `${match[1]!.replace(/-/g, '')}${match[2]}${match[3]}`;
}

function atlasSegment(recordingId: string, flightNumber: string, depTime: string): { depTime: string; arrTime: string; depAirport: string; arrAirport: string } {
  const recording = readJson(`../recordings/atlas/search/${recordingId}.json`) as {
    raw: { routings: Array<{ fromSegments: Array<{ flightNumber: string; depTime: string; arrTime: string; depAirport: string; arrAirport: string }> }> };
  };
  for (const routing of recording.raw.routings) {
    const segment = routing.fromSegments.find((entry) => entry.flightNumber === flightNumber && entry.depTime === depTime);
    if (segment && routing.fromSegments.length === 1) return segment;
  }
  assert.fail(`Atlas recording ${recordingId} has no direct ${flightNumber} at ${depTime}`);
}

test('Sarah service facts match checked-in Atlas recordings; the reprotection event stays simulated', () => {
  const event = readJson('../data/ait-demo-input-pack/scenarios/s1-supplier-disruption/inputs/airline-schedule-change-id7159.json') as {
    provenance: string;
    flight: { flightNumber: string; originalSchedule: { departure: string; arrival: string }; newSchedule: { departure: string; arrival: string } };
  };
  const programme = readJson('../fixtures/programmes/ait-summit-2026/programme.json') as {
    importDraft: { travellers: Array<{ declaredTravel: Array<{ itemKind: string; carrierRef?: { value: string }; scheduledDeparture?: string; scheduledArrival?: string }> }> };
  };
  assert.equal(event.provenance, 'SIMULATED_EXTERNAL_EVENT');

  const original = atlasSegment('rec_d40b625e84e68b27deab3fbb52e27c2e', 'ID7159', compactLocal(event.flight.originalSchedule.departure));
  assert.equal(original.depAirport, 'CGK');
  assert.equal(original.arrAirport, 'SIN');
  assert.equal(original.arrTime, compactLocal(event.flight.originalSchedule.arrival));

  const replacement = atlasSegment('rec_b615f4f1bca688f781fe2ee3cdc39720', 'ID7153', compactLocal(event.flight.newSchedule.departure));
  assert.equal(replacement.depAirport, 'CGK');
  assert.equal(replacement.arrAirport, 'SIN');
  assert.equal(replacement.arrTime, compactLocal(event.flight.newSchedule.arrival));

  const seeded = programme.importDraft.travellers.flatMap((traveller) => traveller.declaredTravel)
    .filter((item) => item.itemKind === 'TRANSPORT_LEG' && item.carrierRef?.value === 'ID7159');
  assert.equal(seeded.length, 5);
  assert.ok(seeded.every((item) => item.scheduledDeparture === event.flight.originalSchedule.departure));
  assert.ok(seeded.every((item) => item.scheduledArrival === event.flight.originalSchedule.arrival));
});

test('Jordan delay stages stay above, just below, then physically short of the 90-minute minimum', () => {
  const timeline = readJson('../data/ait-demo-input-pack/scenarios/s2-missed-connection/inputs/progressive-delay-timeline.json') as {
    baseline: { connectionMinutes: number };
    stages: Array<{ id: string; arrTime: string; connectionRemainingMinutes: number }>;
  };
  const onward = Date.parse('2026-09-29T16:50:00+09:00');
  const gap = (id: string) => {
    const stage = timeline.stages.find((entry) => entry.id === id);
    assert.ok(stage);
    return Math.round((onward - Date.parse(stage.arrTime)) / 60000);
  };
  assert.equal(timeline.baseline.connectionMinutes, 160);
  assert.equal(gap('delay_begins_connection_viable'), 95);
  const tight = gap('delay_increases_connection_at_risk');
  assert.ok(tight >= 80 && tight <= 85, `D2 gap ${tight} should sit just below 90 minutes`);
  assert.ok(gap('zg053_impossible') < 0);
});

test('reviewed SG passport Japan short-visit policy passes the seeded conditions and fails a different nationality', () => {
  const policies = readJson('../data/ait-demo-input-pack/global/reviewed-entry-policies.json') as unknown[];
  const policy = ReviewedEntryPolicySchema.parse(policies[0]);
  const travellerId = id();
  const journeyId = id();
  const credentialId = id();
  const versionId = id();
  const credential: WCredential = { id: credentialId, travellerId, kind: 'PASSPORT', issuerCountry: 'SG', currentVersionId: versionId };
  const version: WCredentialVersion = {
    id: versionId, credentialId, kind: 'PASSPORT', editionNumber: 1, issueDate: '2020-01-01', expiryDate: '2030-01-01',
    issuerStatus: 'VALID', physicallyAvailable: true, evidenceId: id(), issuingStateCode: 'SG', visaClass: null,
    permittedActivities: [], entriesAllowed: null, permittedStayDays: null,
  };
  const selection: WCredentialSelection = { id: id(), journeyId, credentialId, credentialVersionId: versionId, intendedVisitIds: ['visit-1'] };
  const encounter: Encounter = {
    id: 'enc', kind: 'ENTRY', origin: 'INTENDED_VISIT', jurisdictionId: 'jp', at: '2026-09-29T15:00:00+09:00',
    exit: '2026-09-30T11:00:00+09:00', purpose: 'transit_overnight', stayDays: 1, visitId: 'visit-1', selections: [selection],
    airsideFactsKnown: false, placeId: null, arrivingItemId: null, departingItemId: null,
  };
  const context = (issuingStateCode: string): PredicateContext => ({
    world: emptyWorld({
      credentials: [credential],
      credentialVersions: [{ ...version, issuingStateCode }],
    }),
    now: '2026-09-20T00:00:00+08:00',
    journeyId,
    travellerId,
    encounter,
  });
  assert.equal(evaluateRuleExpression(policy.expression, context('SG')).status, 'PASS');
  assert.equal(evaluateRuleExpression(policy.expression, context('US')).status, 'FAIL');
});

test('Jordan four-night stay carries only a source-booking reference; the provider baseline binds its real cancel tier', () => {
  const programme = readJson('../fixtures/programmes/ait-summit-2026/programme.json') as {
    context: { places: Array<{ id: string; externalRefs?: Array<{ system: string; value: string }> }> };
    importDraft: { travellers: Array<{ draftId: string; declaredTravel: Array<{ itemKind: string; stayPlaceRef?: { value: string }; checkIn?: string; checkOut?: string; bookingRef?: { system: string; reference: string } }> }> };
  };
  const stay = programme.importDraft.travellers.find((traveller) => traveller.draftId === 'ait-draft-09')
    ?.declaredTravel.find((item) => item.itemKind === 'STAY');
  assert.ok(stay);
  assert.equal(stay.stayPlaceRef?.value, 'place-hotel-lyf-bugis');
  assert.equal(stay.checkIn, '2026-09-29T15:00:00+08:00');
  assert.equal(stay.checkOut, '2026-10-03T11:00:00+08:00');
  // The dataset never hardcodes a provider booking identity: it carries only a
  // source-binding reference. providerStayBaseline resolves the real provider
  // booking (and its real cancel tier) at bootstrap time.
  assert.equal(stay.bookingRef?.system, 'source-booking-ref');
  assert.equal(stay.bookingRef?.reference, 'ait-draft-09-destination-stay');
  const place = programme.context.places.find((entry) => entry.id === 'place-hotel-lyf-bugis');
  assert.equal(place?.externalRefs?.find((ref) => ref.system === 'nuitee-hotel-id')?.value, 'lp6d67d');
  assert.equal(
    programme.importDraft.travellers.filter((traveller) => traveller.declaredTravel.some((item) => item.stayPlaceRef?.value === 'place-hotel-bayview')).length > 0,
    true,
  );

  const research = readJson('../fixtures/programmes/ait-summit-2026/recovery-research.json') as {
    stayReplacementBinding?: { sourceBookingReference?: string };
  };
  assert.equal(research.stayReplacementBinding?.sourceBookingReference, stay.bookingRef?.reference);

  // The recovery-research binding is resolved against the fresh sandbox
  // booking the provider-baseline bootstrap actually attaches (DpnZRH43H),
  // not a hardcoded historical booking id or fixture.
  const recording = readJson('../recordings/nuitee/stay_context/rec_90f019777a2ae8c099191e1e4176e70d.json') as {
    raw: Parameters<typeof normalizeStayContext>[0];
  };
  const context = normalizeStayContext(recording.raw);
  assert.equal(context.cancellation?.refundable, true);
  assert.equal(context.cancellation?.deadline, '2026-09-26T10:00:00Z');
  assert.deepEqual(context.cancellation?.fee, { amount: 955.69, currency: 'USD' });
  assert.deepEqual(context.bookedTotal, { amount: 955.69, currency: 'USD' });
});
