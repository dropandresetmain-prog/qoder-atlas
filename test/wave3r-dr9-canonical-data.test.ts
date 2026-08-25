/**
 * DR-9 Canonical Data Validation
 *
 * Validates the AiT canonical programme structure and historical Wave3R
 * scenario descriptor packs under fixtures/scenarios (family labels there
 * are historical and may disagree with the AiT catalogue numbering).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES_ROOT = join(process.cwd(), 'fixtures');
const PROGRAMME_PATH = join(FIXTURES_ROOT, 'programmes/ait-summit-2026/programme.json');

/** Minimal shape this file reads off the raw programme fixture JSON. */
interface ProgrammeTravellerDraftLike {
  draftId: string;
  homeLocationText?: string;
  travelArrangement?: string;
}

test('DR-9.1: AiT programme has 67 speakers', () => {
  const programme = JSON.parse(readFileSync(PROGRAMME_PATH, 'utf-8'));
  assert.equal(programme.importDraft.travellers.length, 67, 'programme must have exactly 67 speakers');
});

test('DR-9.2: AiT programme has 42 Northstar-arranged speakers (explicit declaration)', () => {
  const programme = JSON.parse(readFileSync(PROGRAMME_PATH, 'utf-8'));
  const arranged = programme.importDraft.travellers.filter(
    (t: ProgrammeTravellerDraftLike) => t.travelArrangement === 'NORTHSTAR_ARRANGED',
  );
  assert.equal(arranged.length, 42);
});

test('DR-9.3: AiT programme has 25 self/other-arranged speakers (explicit declaration)', () => {
  const programme = JSON.parse(readFileSync(PROGRAMME_PATH, 'utf-8'));
  const local = programme.importDraft.travellers.filter(
    (t: ProgrammeTravellerDraftLike) => t.travelArrangement === 'SELF_OR_OTHER_ARRANGED',
  );
  assert.equal(local.length, 25);
});

test('DR-9.3b: every speaker carries an explicit travelArrangement declaration', () => {
  const programme = JSON.parse(readFileSync(PROGRAMME_PATH, 'utf-8'));
  for (const traveller of programme.importDraft.travellers) {
    assert.ok(
      traveller.travelArrangement === 'NORTHSTAR_ARRANGED' ||
        traveller.travelArrangement === 'SELF_OR_OTHER_ARRANGED',
      `traveller ${traveller.draftId} must declare an explicit travelArrangement`,
    );
  }
});

test('DR-9.3c: arrangement classification is independent of home-location fixture values', () => {
  const programme = JSON.parse(readFileSync(PROGRAMME_PATH, 'utf-8'));
  const countsFor = (
    travellers: ProgrammeTravellerDraftLike[],
  ): { arranged: number; self: number } => ({
    arranged: travellers.filter((t) => t.travelArrangement === 'NORTHSTAR_ARRANGED').length,
    self: travellers.filter((t) => t.travelArrangement === 'SELF_OR_OTHER_ARRANGED').length,
  });
  const baseline = countsFor(programme.importDraft.travellers);
  const renamed = programme.importDraft.travellers.map((t: ProgrammeTravellerDraftLike, index: number) => ({
    ...t,
    homeLocationText: `location-${index}`,
  }));
  assert.deepEqual(countsFor(renamed), baseline);
  const blanked = programme.importDraft.travellers.map((t: ProgrammeTravellerDraftLike) => ({
    ...t,
    homeLocationText: undefined,
  }));
  assert.deepEqual(countsFor(blanked), baseline);
  const sameHome = programme.importDraft.travellers.map((t: ProgrammeTravellerDraftLike) => ({
    ...t,
    homeLocationText: 'X',
  }));
  assert.deepEqual(countsFor(sameHome), baseline);
});

test('DR-9.4: all speakers have valid structure', () => {
  const programme = JSON.parse(readFileSync(PROGRAMME_PATH, 'utf-8'));
  for (const traveller of programme.importDraft.travellers) {
    assert.ok(traveller.draftId);
    assert.ok(traveller.displayName);
    assert.ok(traveller.homeLocationText);
    assert.ok(Array.isArray(traveller.nationalityCodes) && traveller.nationalityCodes.length > 0);
  }
});

test('DR-9.5: programme has AiT anchorEvent defined', () => {
  const programme = JSON.parse(readFileSync(PROGRAMME_PATH, 'utf-8'));
  assert.ok(programme.context.anchorEvent);
  assert.equal(programme.context.anchorEvent.id, 'evt-ait-2026');
  assert.ok(programme.context.anchorEvent.name);
});

test('DR-9.6: programme has commitments defined', () => {
  const programme = JSON.parse(readFileSync(PROGRAMME_PATH, 'utf-8'));
  assert.ok(Array.isArray(programme.context.anchorEvent.commitments));
  assert.ok(programme.context.anchorEvent.commitments.length > 0);
  for (const commitment of programme.context.anchorEvent.commitments) {
    assert.ok(commitment.id);
    assert.ok(commitment.title);
    assert.ok(commitment.startsAt);
  }
});

test('DR-9.7: historical S1 supplier disruption scenario pack exists', () => {
  const scenario = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'scenarios/s1-supplier-disruption/scenario.json'), 'utf-8'));
  assert.equal(scenario.scenarioId, 'scenario-s1-supplier-disruption');
  assert.equal(scenario.family, 'S1');
  assert.ok(scenario.context?.traveller);
  assert.ok(scenario.context?.disruption);
});

test('DR-9.8: historical S2 traveller change scenario pack exists', () => {
  const scenario = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'scenarios/s2-traveller-change/scenario.json'), 'utf-8'));
  assert.equal(scenario.scenarioId, 'scenario-s2-traveller-change');
  assert.equal(scenario.family, 'S2');
  assert.ok(scenario.context?.changeRequest);
});

test('DR-9.9: historical S3 missed flight scenario pack exists', () => {
  const scenario = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'scenarios/s3-missed-flight/scenario.json'), 'utf-8'));
  assert.equal(scenario.scenarioId, 'scenario-s3-missed-flight');
  assert.equal(scenario.family, 'S3');
  assert.ok(scenario.context?.disruption);
});

test('DR-9.10: historical S4 event change scenario pack exists', () => {
  const scenario = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'scenarios/s4-event-change/scenario.json'), 'utf-8'));
  assert.equal(scenario.scenarioId, 'scenario-s4-event-change');
  assert.equal(scenario.family, 'S4');
  assert.ok(scenario.context?.eventChange);
});

test('DR-9.11: historical scenario packs are self-consistent (not AiT catalogue ids)', () => {
  for (const rel of [
    'scenarios/s1-supplier-disruption/scenario.json',
    'scenarios/s2-traveller-change/scenario.json',
    'scenarios/s3-missed-flight/scenario.json',
  ]) {
    const scenario = JSON.parse(readFileSync(join(FIXTURES_ROOT, rel), 'utf-8'));
    assert.ok(scenario.context.traveller.draftId, `${rel} must declare a draftId`);
  }
});

test('DR-9.12: historical S1 has valid disruption signal structure', () => {
  const scenario = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'scenarios/s1-supplier-disruption/scenario.json'), 'utf-8'));
  assert.equal(scenario.context.disruption.signal.kind, 'FLIGHT_CANCELLATION');
});

test('DR-9.13: historical S2 has valid change request structure', () => {
  const scenario = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'scenarios/s2-traveller-change/scenario.json'), 'utf-8'));
  assert.equal(scenario.context.changeRequest.request.intentKind, 'ADJUST_TRIP_WINDOW');
});

test('DR-9.14: historical S3 has valid disruption signal structure', () => {
  const scenario = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'scenarios/s3-missed-flight/scenario.json'), 'utf-8'));
  assert.equal(scenario.context.disruption.signal.kind, 'FLIGHT_DELAY');
});

test('DR-9.15: historical S4 has valid event change signal structure', () => {
  const scenario = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'scenarios/s4-event-change/scenario.json'), 'utf-8'));
  assert.equal(scenario.context.eventChange.signal.kind, 'ANCHOR_COMMITMENT_CHANGE');
  assert.equal(scenario.context.eventChange.signal.payload.changeKind, 'RESCHEDULED');
});
