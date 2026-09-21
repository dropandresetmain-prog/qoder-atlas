/**
 * A5.1 — pure harness stage selection from configured S2 timeline.
 * No PostgreSQL; proves the rehearsal control stays data-driven.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  clockOnlyStages,
  harnessDrivenStages,
  isClockOnlyStage,
  isProviderEventStage,
  loadTimeline,
  providerEventStages,
  type DelayTimeline,
} from '../src/app/demo/progressiveDelayTimeline.ts';

const TIMELINE_PATH = fileURLToPath(
  new URL('../data/ait-demo-input-pack/scenarios/s2-missed-connection/inputs/progressive-delay-timeline.json', import.meta.url),
);

test('A5.1 harness: provider-event stages are data-driven and ordered', () => {
  const timeline = loadTimeline(TIMELINE_PATH);
  const stages = providerEventStages(timeline);
  assert.ok(stages.length >= 3);
  assert.equal(stages[0]?.id, 'delay_begins_connection_viable');
  assert.equal(stages[0]?.connectionRemainingMinutes, 95);
  assert.equal(stages[1]?.id, 'delay_increases_connection_at_risk');
  assert.equal(stages[1]?.connectionRemainingMinutes, 30);
  assert.equal(stages[2]?.id, 'zg053_impossible');
  assert.ok((stages[2]?.connectionRemainingMinutes ?? 0) < 0);
  assert.ok(stages.every((stage) => stage.eventId && stage.arrTime));
});

test('A5.1 harness: overnight planningNow stages are clock-only and harness-driven', () => {
  const timeline = JSON.parse(readFileSync(TIMELINE_PATH, 'utf8')) as DelayTimeline;
  const clock = clockOnlyStages(timeline);
  assert.ok(clock.some((stage) => stage.id === 'overnight_narita_necessary'));
  const overnight = clock.find((stage) => stage.id === 'overnight_narita_necessary');
  assert.equal(overnight?.planningNow, '2026-09-29T21:30:00+09:00');
  assert.equal(providerEventStages(timeline).some((stage) => stage.id === 'overnight_narita_necessary'), false);
  assert.ok(isClockOnlyStage(overnight!));
  assert.equal(isProviderEventStage(overnight!), false);

  const driven = harnessDrivenStages(timeline);
  assert.ok(driven.some((stage) => stage.id === 'overnight_narita_necessary'));
  assert.ok(
    driven.findIndex((stage) => stage.id === 'zg053_impossible')
      < driven.findIndex((stage) => stage.id === 'overnight_narita_necessary'),
    'clock-only overnight follows provider-event stages in harness order',
  );
});
