/**
 * Runtime services — the ONE place background workers are composed (R0).
 *
 * Before R0 the reassessment loop was started in two places
 * (`composeTargetApplication` optionally, `composeTargetBoot` actually), had
 * no health signal and swallowed every error. Every durable worker the
 * runtime runs is now listed here with the same tiny lifecycle
 * (`start`/`stop`/`health`), so adding a worker (execution, external
 * reconciliation, ...) is one registration, not a new ad-hoc timer, and
 * `/api/v2/health` can report what is actually running.
 *
 * Nothing here knows any scenario or provider. Tests compose the same module
 * with an injected pipeline and clock.
 */
import type { Instant } from '../domain/v2/shared/time.ts';
import {
  startReassessmentDrainLoop,
  type PgReassessmentWorker,
  type ReassessmentDrainLoopOptions,
  type ReassessmentDrainResult,
  type ReassessmentPipeline,
  type ReassessmentWake,
} from '../persistence/postgres/world/pgAssessments.ts';

export type RuntimeServiceState = 'STOPPED' | 'RUNNING';

export interface RuntimeServiceHealth {
  name: string;
  state: RuntimeServiceState;
  wakes: number;
  lastWakeAt?: Instant;
  lastError?: string;
  /** Service-specific, bounded, JSON-safe detail. */
  detail: Record<string, unknown>;
}

export interface RuntimeService {
  readonly name: string;
  start(): void;
  stop(): void;
  health(): RuntimeServiceHealth;
}

export interface RuntimeServices {
  readonly services: readonly RuntimeService[];
  start(): void;
  stop(): void;
  health(): RuntimeServiceHealth[];
}

export interface ReassessmentServiceOptions extends Omit<ReassessmentDrainLoopOptions, 'observe'> {
  worker: PgReassessmentWorker;
  pipeline: ReassessmentPipeline;
  /** Optional sink for wake reports (boot logs non-empty drains; tests capture). */
  onWake?: (wake: ReassessmentWake) => void;
}

/** Durable reassessment: clock-expiry scheduling + bounded drain of runnable work, on an idle cadence. */
export function createReassessmentService(options: ReassessmentServiceOptions): RuntimeService {
  const { worker, pipeline, onWake, ...loop } = options;
  let stop: (() => void) | undefined;
  let wakes = 0;
  let lastWakeAt: Instant | undefined;
  let lastError: string | undefined;
  let lastDrain: ReassessmentDrainResult | undefined;
  let lastDueEnqueued = 0;
  let processedTotal = 0;
  let dueEnqueuedTotal = 0;

  return {
    name: 'reassessment',
    start() {
      if (stop) return;
      stop = startReassessmentDrainLoop(worker, pipeline, {
        ...loop,
        observe(wake) {
          wakes += 1;
          lastWakeAt = wake.at;
          lastError = wake.error;
          lastDueEnqueued = wake.dueEnqueued;
          dueEnqueuedTotal += wake.dueEnqueued;
          if (wake.drain) {
            lastDrain = wake.drain;
            processedTotal += wake.drain.processed;
          }
          onWake?.(wake);
        },
      });
    },
    stop() {
      stop?.();
      stop = undefined;
    },
    health() {
      return {
        name: 'reassessment',
        state: stop ? 'RUNNING' : 'STOPPED',
        wakes,
        ...(lastWakeAt ? { lastWakeAt } : {}),
        ...(lastError ? { lastError } : {}),
        detail: {
          pollMs: loop.pollMs ?? null,
          processedTotal,
          dueEnqueuedTotal,
          lastDueEnqueued,
          lastDrain: lastDrain
            ? { processed: lastDrain.processed, stoppedReason: lastDrain.stoppedReason, elapsedMs: lastDrain.elapsedMs, outcomes: lastDrain.outcomes }
            : null,
        },
      };
    },
  };
}

/** Composes the runtime's background services. Order is start order; stop runs in reverse. */
export function composeRuntimeServices(services: readonly RuntimeService[]): RuntimeServices {
  const names = new Set<string>();
  for (const service of services) {
    if (names.has(service.name)) throw new Error(`duplicate runtime service ${service.name}`);
    names.add(service.name);
  }
  return {
    services,
    start() {
      for (const service of services) service.start();
    },
    stop() {
      for (const service of [...services].reverse()) service.stop();
    },
    health() {
      return services.map((service) => service.health());
    },
  };
}
