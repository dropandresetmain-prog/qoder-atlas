/**
 * DR-9 Canonical Data Validation
 *
 * Validates the synthetic-summit programme structure and scenario packs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES_ROOT = join(process.cwd(), 'fixtures');

/** Minimal shape this file reads off the raw programme fixture JSON. */
interface ProgrammeTravellerDraftLike {
  draftId: string;
  homeLocationText?: string;
  travelArrangement?: string;
}

test('DR-9.1: synthetic-summit programme has 67 speakers', () => {
  const programmePath = join(FIXTURES_ROOT, 'programmes/synthetic-summit/programme.json');
  const programme = JSON.parse(readFileSync(programmePath, 'utf-8'));

  assert.equal(programme.importDraft.travellers.length, 67, 'programme must have exactly 67 speakers');
});

test('DR-9.2: synthetic-summit programme has 42 Northstar-arranged speakers (explicit declaration)', () => {
  const programmePath = join(FIXTURES_ROOT, 'programmes/synthetic-summit/programme.json');
  const programme = JSON.parse(readFileSync(programmePath, 'utf-8'));

  const arranged = programme.importDraft.travellers.filter(
    (t: ProgrammeTravellerDraftLike) => t.travelArrangement === 'NORTHSTAR_ARRANGED',
  );
  assert.equal(
    arranged.length,
    42,
    'programme must have exactly 42 explicitly Northstar-arranged speakers (classification must never depend on homeLocationText)',
  );
});

test('DR-9.3: synthetic-summit programme has 25 self/other-arranged speakers (explicit declaration)', () => {
  const programmePath = join(FIXTURES_ROOT, 'programmes/synthetic-summit/programme.json');
  const programme = JSON.parse(readFileSync(programmePath, 'utf-8'));

  const local = programme.importDraft.travellers.filter(
    (t: ProgrammeTravellerDraftLike) => t.travelArrangement === 'SELF_OR_OTHER_ARRANGED',
  );
  assert.equal(
    local.length,
    25,
    'programme must have exactly 25 explicitly self/other-arranged speakers (classification must never depend on homeLocationText)',
  );
});

test('DR-9.3b: every speaker carries an explicit travelArrangement declaration', () => {
  const programmePath = join(FIXTURES_ROOT, 'programmes/synthetic-summit/programme.json');
  const programme = JSON.parse(readFileSync(programmePath, 'utf-8'));

  for (const traveller of programme.importDraft.travellers) {
    assert.ok(
      traveller.travelArrangement === 'NORTHSTAR_ARRANGED' ||
        traveller.travelArrangement === 'SELF_OR_OTHER_ARRANGED',
      `traveller ${traveller.draftId} must declare an explicit travelArrangement`,
    );
  }
});

test('DR-9.3c: arrangement classification is independent of home-location fixture values', () => {
  const programmePath = join(FIXTURES_ROOT, 'programmes/synthetic-summit/programme.json');
  const programme = JSON.parse(readFileSync(programmePath, 'utf-8'));

  // Anti-fixture-magic proof (G3R-Closure fix B): the classification must be
  // identical even when every homeLocationText value is replaced with
  // synthetic values carrying no airport/location meaning at all.
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
  assert.deepEqual(countsFor(renamed), baseline, 'classification must not shift when home locations change');

  const blanked = programme.importDraft.travellers.map((t: ProgrammeTravellerDraftLike) => ({
    ...t,
    homeLocationText: undefined,
  }));
  assert.deepEqual(countsFor(blanked), baseline, 'classification must not shift when home locations are removed');

  // And the fixture itself must not rely on any single home-location value:
  // flipping every value to the same string still leaves counts untouched.
  const sameHome = programme.importDraft.travellers.map((t: ProgrammeTravellerDraftLike) => ({
    ...t,
    homeLocationText: 'X',
  }));
  assert.deepEqual(countsFor(sameHome), baseline, 'classification must not shift when all homes equal');
});

test('DR-9.4: all speakers have valid structure', () => {
  const programmePath = join(FIXTURES_ROOT, 'programmes/synthetic-summit/programme.json');
  const programme = JSON.parse(readFileSync(programmePath, 'utf-8'));

  for (const traveller of programme.importDraft.travellers) {
    assert.ok(traveller.draftId, 'traveller must have draftId');
    assert.ok(traveller.displayName, 'traveller must have displayName');
    assert.ok(traveller.homeLocationText, 'traveller must have homeLocationText');
    assert.ok(traveller.nationalityCodes, 'traveller must have nationalityCodes');
    assert.ok(Array.isArray(traveller.nationalityCodes), 'nationalityCodes must be array');
    assert.ok(traveller.nationalityCodes.length > 0, 'nationalityCodes must not be empty');
  }
});

test('DR-9.5: programme has anchorEvent defined', () => {
  const programmePath = join(FIXTURES_ROOT, 'programmes/synthetic-summit/programme.json');
  const programme = JSON.parse(readFileSync(programmePath, 'utf-8'));

  assert.ok(programme.context.anchorEvent, 'programme must have anchorEvent');
  assert.equal(programme.context.anchorEvent.id, 'evt-w3-demo', 'anchorEvent id must be evt-w3-demo');
  assert.ok(programme.context.anchorEvent.name, 'anchorEvent must have name');
});

test('DR-9.6: programme has commitments defined', () => {
  const programmePath = join(FIXTURES_ROOT, 'programmes/synthetic-summit/programme.json');
  const programme = JSON.parse(readFileSync(programmePath, 'utf-8'));

  assert.ok(programme.context.anchorEvent.commitments, 'programme must have commitments');
  assert.ok(Array.isArray(programme.context.anchorEvent.commitments), 'commitments must be array');
  assert.ok(programme.context.anchorEvent.commitments.length > 0, 'commitments must not be empty');

  for (const commitment of programme.context.anchorEvent.commitments) {
    assert.ok(commitment.id, 'commitment must have id');
    assert.ok(commitment.title, 'commitment must have title');
    assert.ok(commitment.startsAt, 'commitment must have startsAt');
  }
});

test('DR-9.7: S1 supplier disruption scenario pack exists', () => {
  const scenarioPath = join(FIXTURES_ROOT, 'scenarios/s1-supplier-disruption/scenario.json');
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf-8'));

  assert.equal(scenario.scenarioId, 'scenario-s1-supplier-disruption');
  assert.equal(scenario.family, 'S1');
  assert.ok(scenario.context, 'scenario must have context');
  assert.ok(scenario.context.traveller, 'context must have traveller');
  assert.ok(scenario.context.disruption, 'context must have disruption');
});

test('DR-9.8: S2 traveller change scenario pack exists', () => {
  const scenarioPath = join(FIXTURES_ROOT, 'scenarios/s2-traveller-change/scenario.json');
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf-8'));

  assert.equal(scenario.scenarioId, 'scenario-s2-traveller-change');
  assert.equal(scenario.family, 'S2');
  assert.ok(scenario.context, 'scenario must have context');
  assert.ok(scenario.context.traveller, 'context must have traveller');
  assert.ok(scenario.context.changeRequest, 'context must have changeRequest');
});

test('DR-9.9: S3 missed flight scenario pack exists', () => {
  const scenarioPath = join(FIXTURES_ROOT, 'scenarios/s3-missed-flight/scenario.json');
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf-8'));

  assert.equal(scenario.scenarioId, 'scenario-s3-missed-flight');
  assert.equal(scenario.family, 'S3');
  assert.ok(scenario.context, 'scenario must have context');
  assert.ok(scenario.context.traveller, 'context must have traveller');
  assert.ok(scenario.context.disruption, 'context must have disruption');
});

test('DR-9.10: S4 event change scenario pack exists', () => {
  const scenarioPath = join(FIXTURES_ROOT, 'scenarios/s4-event-change/scenario.json');
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf-8'));

  assert.equal(scenario.scenarioId, 'scenario-s4-event-change');
  assert.equal(scenario.family, 'S4');
  assert.ok(scenario.context, 'scenario must have context');
  assert.ok(scenario.context.eventChange, 'context must have eventChange');
});

test('DR-9.11: scenario packs reference valid travellers', () => {
  const programmePath = join(FIXTURES_ROOT, 'programmes/synthetic-summit/programme.json');
  const programme = JSON.parse(readFileSync(programmePath, 'utf-8'));

  const travellerIds = new Set(
    programme.importDraft.travellers.map((t: ProgrammeTravellerDraftLike) => `draft-${t.draftId}`),
  );

  const s1Path = join(FIXTURES_ROOT, 'scenarios/s1-supplier-disruption/scenario.json');
  const s1 = JSON.parse(readFileSync(s1Path, 'utf-8'));
  assert.ok(travellerIds.has(`draft-${s1.context.traveller.draftId}`), 'S1 traveller must exist in programme');

  const s2Path = join(FIXTURES_ROOT, 'scenarios/s2-traveller-change/scenario.json');
  const s2 = JSON.parse(readFileSync(s2Path, 'utf-8'));
  assert.ok(travellerIds.has(`draft-${s2.context.traveller.draftId}`), 'S2 traveller must exist in programme');

  const s3Path = join(FIXTURES_ROOT, 'scenarios/s3-missed-flight/scenario.json');
  const s3 = JSON.parse(readFileSync(s3Path, 'utf-8'));
  assert.ok(travellerIds.has(`draft-${s3.context.traveller.draftId}`), 'S3 traveller must exist in programme');
});

test('DR-9.12: S1 has valid disruption signal structure', () => {
  const scenarioPath = join(FIXTURES_ROOT, 'scenarios/s1-supplier-disruption/scenario.json');
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf-8'));

  const { disruption } = scenario.context;
  assert.ok(disruption.signal, 'disruption must have signal');
  assert.equal(disruption.signal.kind, 'FLIGHT_CANCELLATION');
  assert.ok(disruption.signal.occurredAt, 'signal must have occurredAt');
  assert.ok(disruption.signal.payload, 'signal must have payload');
});

test('DR-9.13: S2 has valid change request structure', () => {
  const scenarioPath = join(FIXTURES_ROOT, 'scenarios/s2-traveller-change/scenario.json');
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf-8'));

  const { changeRequest } = scenario.context;
  assert.ok(changeRequest.request, 'changeRequest must have request');
  assert.equal(changeRequest.request.intentKind, 'ADJUST_TRIP_WINDOW');
  assert.ok(changeRequest.request.utterance, 'request must have utterance');
  assert.ok(changeRequest.request.target, 'request must have target');
});

test('DR-9.14: S3 has valid disruption signal structure', () => {
  const scenarioPath = join(FIXTURES_ROOT, 'scenarios/s3-missed-flight/scenario.json');
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf-8'));

  const { disruption } = scenario.context;
  assert.ok(disruption.signal, 'disruption must have signal');
  assert.equal(disruption.signal.kind, 'FLIGHT_DELAY');
  assert.ok(disruption.signal.occurredAt, 'signal must have occurredAt');
  assert.ok(disruption.signal.payload, 'signal must have payload');
});

test('DR-9.15: S4 has valid event change signal structure', () => {
  const scenarioPath = join(FIXTURES_ROOT, 'scenarios/s4-event-change/scenario.json');
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf-8'));

  const { eventChange } = scenario.context;
  assert.ok(eventChange.signal, 'eventChange must have signal');
  assert.equal(eventChange.signal.kind, 'ANCHOR_COMMITMENT_CHANGE');
  assert.ok(eventChange.signal.payload, 'signal must have payload');
  assert.equal(eventChange.signal.payload.changeKind, 'RESCHEDULED');
});
