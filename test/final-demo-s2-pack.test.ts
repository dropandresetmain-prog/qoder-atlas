/**
 * Lane-local S2 pack shape: LAX→NRT→SIN baseline + ZGSYN09 PNR harvest inputs.
 * Does not touch shared globals or programme fixtures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = join(process.cwd(), 'data/ait-demo-input-pack/scenarios/s2-missed-connection');

test('dossier-only rebuild preserves programme enrichment and maps source identity on this platform', () => {
  const parent = resolve(tmpdir());
  const isolated = mkdtempSync(join(parent, 'northstar-dossiers-'));
  try {
    cpSync(join(process.cwd(), 'data/ait-demo-input-pack'), join(isolated, 'data/ait-demo-input-pack'), { recursive: true });
    const output = join(isolated, 'fixtures/programmes/ait-summit-2026');
    mkdirSync(output, { recursive: true });
    const acceptedProgramme = '{"acceptedEnrichment":"must remain byte-identical"}\n';
    writeFileSync(join(output, 'programme.json'), acceptedProgramme);
    const run = () => execFileSync(process.execPath, [
      join(process.cwd(), 'scripts/build-ait-canonical-programme.ts'), '--dossiers-only',
    ], { cwd: isolated, encoding: 'utf8' });
    assert.match(run(), /2 booking dossiers; programme unchanged/);
    assert.equal(readFileSync(join(output, 'programme.json'), 'utf8'), acceptedProgramme);
    const bytes = readFileSync(join(output, 'booking-dossiers.json'), 'utf8');
    const generated = JSON.parse(bytes);
    const source = JSON.parse(readFileSync(join(isolated, 'data/ait-demo-input-pack/global/booking-dossiers.json'), 'utf8'));
    assert.deepEqual(generated.flight[0].passengers, source.dossiers.flight[0].passengers);
    assert.equal(generated.flight[0].passengers[0].nationality, 'SG');
    assert.deepEqual(generated.hotel[0].guestNames, source.dossiers.hotel[0].guestNames);
    run();
    assert.equal(readFileSync(join(output, 'booking-dossiers.json'), 'utf8'), bytes);
    assert.equal(readFileSync(join(output, 'programme.json'), 'utf8'), acceptedProgramme);
  } finally {
    assert.ok(resolve(isolated).startsWith(parent + sep + 'northstar-dossiers-'));
    rmSync(isolated, { recursive: true, force: true });
  }
});

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as Record<string, unknown>;
}

test('S2 baseline is ZIPAIR LAX→NRT→SIN with SG Jordan and arrival-eve stay', () => {
  const baseline = readJson('inputs/baseline-itinerary.json');
  assert.equal(baseline.draftId, 'ait-draft-09');
  const inbound = baseline.inboundItinerary as { segments: Array<Record<string, string>> };
  assert.equal(inbound.segments.length, 2);
  assert.deepEqual(
    {
      flightNumber: inbound.segments[0]?.flightNumber,
      origin: inbound.segments[0]?.origin,
      destination: inbound.segments[0]?.destination,
      departure: inbound.segments[0]?.departure,
      arrival: inbound.segments[0]?.arrival,
    },
    {
      flightNumber: 'ZG023',
      origin: 'LAX',
      destination: 'NRT',
      departure: '2026-09-28T10:55:00-07:00',
      arrival: '2026-09-29T14:10:00+09:00',
    },
  );
  assert.deepEqual(
    {
      flightNumber: inbound.segments[1]?.flightNumber,
      origin: inbound.segments[1]?.origin,
      destination: inbound.segments[1]?.destination,
      departure: inbound.segments[1]?.departure,
      arrival: inbound.segments[1]?.arrival,
    },
    {
      flightNumber: 'ZG053',
      origin: 'NRT',
      destination: 'SIN',
      departure: '2026-09-29T16:50:00+09:00',
      arrival: '2026-09-29T23:00:00+08:00',
    },
  );
  const hotel = baseline.hotelStay as { checkIn: string; checkOut: string };
  assert.equal(hotel.checkIn, '2026-09-29T15:00:00+08:00');
  assert.equal(hotel.checkOut, '2026-10-03T11:00:00+08:00');
  const entry = readJson('inputs/entry-requirements-context.json');
  assert.deepEqual((entry.assumedNationality as { codes: string[] }).codes, ['SG']);
});

test('S2 provider rebooking state carries ZGSYN09 and airline-default TR867', () => {
  const state = readJson('inputs/provider-rebooking-state.json');
  assert.equal(state.pnr, 'ZGSYN09');
  const segments = state.segments as Array<Record<string, string>>;
  assert.ok(segments.some((s) => s.status === 'MISSED_CONNECTION' && s.flightNumber === 'ZG053'));
  assert.ok(segments.some((s) => s.status === 'REBOOKED_INVOLUNTARY' && s.flightNumber === 'TR867'));
});

test('S2 progressive timeline documents six stages and reconcile snapshot flag', () => {
  const timeline = readJson('inputs/progressive-delay-timeline.json');
  assert.equal(timeline.pnr, 'ZGSYN09');
  const stages = timeline.stages as Array<Record<string, unknown>>;
  assert.ok(stages.length >= 6);
  assert.ok(stages.some((s) => s.id === 'zg053_impossible' && s.reconcileSnapshot === true));
});
