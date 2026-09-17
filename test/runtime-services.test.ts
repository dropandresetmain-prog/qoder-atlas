/**
 * Focused coverage for the R0 runtime-services root (no live Postgres required).
 *
 * `composeRuntimeServices` and `createReassessmentService` are pure
 * composition/lifecycle code over an injected worker and clock, so this file
 * fakes `PgReassessmentWorker` entirely and drives the loop with a short
 * `pollMs`, waiting on observed wakes rather than sleeping fixed amounts.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeRuntimeServices,
  createReassessmentService,
  type RuntimeService,
} from '../src/app/runtimeServices.ts';
import type {
  PgReassessmentWorker,
  ReassessmentDrainResult,
  ReassessmentPipeline,
  ReassessmentWake,
} from '../src/persistence/postgres/world/pgAssessments.ts';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A never-invoked pipeline: the fake worker's `drainAvailable` ignores it. */
const unusedPipeline: ReassessmentPipeline = async () => {
  throw new Error('pipeline must not be called by the fake worker');
};

function fakeWorker(overrides: {
  enqueueDue?: () => Promise<number>;
  drainAvailable?: () => Promise<ReassessmentDrainResult>;
} = {}): PgReassessmentWorker {
  const enqueueDue = overrides.enqueueDue ?? (async () => 0);
  const drainAvailable = overrides.drainAvailable
    ?? (async () => ({ processed: 0, stoppedReason: 'EMPTY' as const, elapsedMs: 0, outcomes: {} }));
  return { enqueueDue, drainAvailable } as unknown as PgReassessmentWorker;
}

async function waitForWakes(getCount: () => number, atLeast: number, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (getCount() < atLeast) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out waiting for ${atLeast} wakes, saw ${getCount()}`);
    }
    await sleep(5);
  }
}

describe('createReassessmentService', () => {
  test('wakes are observed and health().detail accumulates dueEnqueued/processed totals', async () => {
    let n = 0;
    const wakes: ReassessmentWake[] = [];
    const worker = fakeWorker({
      enqueueDue: async () => {
        n += 1;
        return n;
      },
      drainAvailable: async () => ({ processed: n, stoppedReason: 'EMPTY', elapsedMs: 1, outcomes: { COMPLETED: n } }),
    });
    const service = createReassessmentService({
      worker,
      pipeline: unusedPipeline,
      pollMs: 10,
      now: () => new Date().toISOString(),
      onWake: (wake) => wakes.push(wake),
    });

    service.start();
    try {
      await waitForWakes(() => wakes.length, 3);
    } finally {
      service.stop();
    }

    const health = service.health();
    assert.equal(health.name, 'reassessment');
    assert.ok(health.wakes >= 3);
    assert.ok((health.detail.dueEnqueuedTotal as number) >= 1 + 2 + 3);
    assert.ok((health.detail.processedTotal as number) >= 1);
    assert.equal(health.detail.pollMs, 10);
  });

  test('a throwing drainAvailable is captured as lastError without stopping the loop', async () => {
    let calls = 0;
    const wakes: ReassessmentWake[] = [];
    const worker = fakeWorker({
      drainAvailable: async () => {
        calls += 1;
        throw new Error(`boom-${calls}`);
      },
    });
    const service = createReassessmentService({
      worker,
      pipeline: unusedPipeline,
      pollMs: 10,
      now: () => new Date().toISOString(),
      onWake: (wake) => wakes.push(wake),
    });

    service.start();
    try {
      await waitForWakes(() => wakes.length, 3);
    } finally {
      service.stop();
    }

    // The loop kept waking (and calling drainAvailable again) despite the throw.
    assert.ok(calls >= 3);
    const health = service.health();
    assert.match(health.lastError ?? '', /^boom-\d+$/);
    assert.equal(health.state, 'STOPPED');
  });

  test('stop() flips state to STOPPED and no further wakes happen', async () => {
    const wakes: ReassessmentWake[] = [];
    const worker = fakeWorker();
    const service = createReassessmentService({
      worker,
      pipeline: unusedPipeline,
      pollMs: 10,
      now: () => new Date().toISOString(),
      onWake: (wake) => wakes.push(wake),
    });

    service.start();
    await waitForWakes(() => wakes.length, 2);
    assert.equal(service.health().state, 'RUNNING');

    service.stop();
    assert.equal(service.health().state, 'STOPPED');
    const countAtStop = wakes.length;
    await sleep(60);
    assert.equal(wakes.length, countAtStop, 'no wake should fire after stop()');
  });

  test('start() twice does not start two loops', async () => {
    const wakes: ReassessmentWake[] = [];
    const worker = fakeWorker();
    const service = createReassessmentService({
      worker,
      pipeline: unusedPipeline,
      pollMs: 20,
      now: () => new Date().toISOString(),
      onWake: (wake) => wakes.push(wake),
    });

    service.start();
    service.start();
    try {
      // Over several poll intervals, a duplicated loop would roughly double the
      // wake count; a single loop stays close to elapsed/pollMs.
      await sleep(20 * 5 + 30);
    } finally {
      service.stop();
    }
    assert.ok(wakes.length <= 7, `expected roughly one loop's worth of wakes, saw ${wakes.length}`);
  });
});

describe('composeRuntimeServices', () => {
  function recordingService(name: string, log: string[]): RuntimeService {
    let state: 'STOPPED' | 'RUNNING' = 'STOPPED';
    return {
      name,
      start() {
        log.push(`start:${name}`);
        state = 'RUNNING';
      },
      stop() {
        log.push(`stop:${name}`);
        state = 'STOPPED';
      },
      health() {
        return { name, state, wakes: 0, detail: {} };
      },
    };
  }

  test('starts in order and stops in reverse order', () => {
    const log: string[] = [];
    const services = composeRuntimeServices([
      recordingService('a', log),
      recordingService('b', log),
      recordingService('c', log),
    ]);

    services.start();
    services.stop();

    assert.deepEqual(log, ['start:a', 'start:b', 'start:c', 'stop:c', 'stop:b', 'stop:a']);
  });

  test('rejects duplicate service names', () => {
    const log: string[] = [];
    assert.throws(
      () => composeRuntimeServices([recordingService('dup', log), recordingService('dup', log)]),
      /duplicate runtime service dup/,
    );
  });

  test('health() aggregates every service in order', () => {
    const log: string[] = [];
    const services = composeRuntimeServices([recordingService('x', log), recordingService('y', log)]);
    services.start();
    const health = services.health();
    assert.deepEqual(
      health.map((h) => [h.name, h.state]),
      [
        ['x', 'RUNNING'],
        ['y', 'RUNNING'],
      ],
    );
    services.stop();
    assert.deepEqual(
      services.health().map((h) => [h.name, h.state]),
      [
        ['x', 'STOPPED'],
        ['y', 'STOPPED'],
      ],
    );
  });
});
