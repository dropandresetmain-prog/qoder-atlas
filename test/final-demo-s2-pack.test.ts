/**
 * Lane-local S2 pack shape: LAX→NRT→SIN baseline + ZGSYN09 PNR harvest inputs.
 * Does not touch shared globals or programme fixtures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'data/ait-demo-input-pack/scenarios/s2-missed-connection');

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as Record<string, unknown>;
}

test('S2 baseline itinerary is ZIPAIR LAX→NRT→SIN with draftId ait-draft-09', () => {
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
});

test('S2 provider rebooking state carries ZGSYN09 and airline morning TR885-class', () => {
  const state = readJson('inputs/provider-rebooking-state.json');
  assert.equal(state.pnr, 'ZGSYN09');
  const segments = state.segments as Array<Record<string, string>>;
  assert.ok(segments.some((s) => s.status === 'MISSED_CONNECTION' && s.flightNumber === 'ZG053'));
  assert.ok(segments.some((s) => s.status === 'REBOOKED_INVOLUNTARY' && s.flightNumber === 'TR885'));
});

test('S2 progressive timeline documents six stages and reconcile snapshot flag', () => {
  const timeline = readJson('inputs/progressive-delay-timeline.json');
  assert.equal(timeline.pnr, 'ZGSYN09');
  const stages = timeline.stages as Array<Record<string, unknown>>;
  assert.ok(stages.length >= 6);
  assert.ok(stages.some((s) => s.id === 'zg053_impossible' && s.reconcileSnapshot === true));
});
