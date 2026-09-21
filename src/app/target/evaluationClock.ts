/**
 * Workspace-scoped evaluation clock (A5 CP3 / FIX3).
 *
 * One authoritative scenario/evaluation "now" for reassessment, case
 * lifecycle, recovery progression, and planning basis. Default is wall
 * clock. Controlled demo operation persists CONTROLLED + controlled_now and
 * injects the same getter into boot workers.
 *
 * Does NOT replace operational timestamps (provider observedAt, receipts,
 * modelActivities.observedAt, completionClock, read-model generatedAt).
 */
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';

export type EvaluationClockMode = 'WALL' | 'CONTROLLED';

export interface EvaluationClockSnapshot {
  mode: EvaluationClockMode;
  controlledNow: Instant | null;
  updatedAt: Instant | null;
}

export interface WorkspaceEvaluationClock {
  /** Synchronous evaluation instant for injected periodic/drain/pipeline workers. */
  now(): Instant;
  /** Reload durable mode/controlled_now from PostgreSQL into the local cache. */
  refresh(): Promise<EvaluationClockSnapshot>;
  /** Persist CONTROLLED mode at `instant` and update the local cache. */
  advanceTo(instant: Instant): Promise<EvaluationClockSnapshot>;
  /** Persist WALL mode (clear controlled_now) and update the local cache. */
  useWall(): Promise<EvaluationClockSnapshot>;
  snapshot(): EvaluationClockSnapshot;
}

function wallNow(): Instant {
  return new Date().toISOString();
}

function assertInstant(value: string, label: string): Instant {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new RangeError(`invalid ${label}: ${value}`);
  return value as Instant;
}

/**
 * Resolve evaluation now from a durable snapshot. WALL (or missing row) →
 * wall clock; CONTROLLED → controlled_now.
 */
export function resolveEvaluationNow(
  snapshot: EvaluationClockSnapshot | null | undefined,
  wall: Instant = wallNow(),
): Instant {
  if (snapshot?.mode === 'CONTROLLED' && snapshot.controlledNow) {
    return snapshot.controlledNow;
  }
  return wall;
}

export async function readEvaluationClock(
  pool: Pool,
  workspaceId: string,
): Promise<EvaluationClockSnapshot> {
  const result = await pool.query<{
    mode: EvaluationClockMode;
    controlled_now: Date | string | null;
    updated_at: Date | string | null;
  }>(
    `SELECT mode, controlled_now, updated_at
       FROM workspace_evaluation_clocks
      WHERE workspace_id = $1`,
    [workspaceId],
  );
  const row = result.rows[0];
  if (!row) {
    return { mode: 'WALL', controlledNow: null, updatedAt: null };
  }
  return {
    mode: row.mode,
    controlledNow: row.controlled_now
      ? assertInstant(new Date(row.controlled_now).toISOString(), 'controlled_now')
      : null,
    updatedAt: row.updated_at
      ? assertInstant(new Date(row.updated_at).toISOString(), 'updated_at')
      : null,
  };
}

export async function writeControlledEvaluationClock(
  pool: Pool,
  workspaceId: string,
  controlledNow: Instant,
): Promise<EvaluationClockSnapshot> {
  const instant = assertInstant(controlledNow, 'controlledNow');
  await pool.query(
    `INSERT INTO workspace_evaluation_clocks (workspace_id, mode, controlled_now, updated_at)
     VALUES ($1, 'CONTROLLED', $2::timestamptz, now())
     ON CONFLICT (workspace_id) DO UPDATE
       SET mode = 'CONTROLLED',
           controlled_now = EXCLUDED.controlled_now,
           updated_at = now()`,
    [workspaceId, instant],
  );
  return readEvaluationClock(pool, workspaceId);
}

export async function writeWallEvaluationClock(
  pool: Pool,
  workspaceId: string,
): Promise<EvaluationClockSnapshot> {
  await pool.query(
    `INSERT INTO workspace_evaluation_clocks (workspace_id, mode, controlled_now, updated_at)
     VALUES ($1, 'WALL', NULL, now())
     ON CONFLICT (workspace_id) DO UPDATE
       SET mode = 'WALL',
           controlled_now = NULL,
           updated_at = now()`,
    [workspaceId],
  );
  return readEvaluationClock(pool, workspaceId);
}

/**
 * Runtime-owned evaluation clock: durable in PostgreSQL, cached for sync
 * injection into reassessment / periodic / coordinator seams.
 */
export async function createWorkspaceEvaluationClock(
  pool: Pool,
  workspaceId: string,
): Promise<WorkspaceEvaluationClock> {
  let cached: EvaluationClockSnapshot = await readEvaluationClock(pool, workspaceId);

  const clock: WorkspaceEvaluationClock = {
    now() {
      return resolveEvaluationNow(cached);
    },
    async refresh() {
      cached = await readEvaluationClock(pool, workspaceId);
      return cached;
    },
    async advanceTo(instant) {
      cached = await writeControlledEvaluationClock(pool, workspaceId, instant);
      return cached;
    },
    async useWall() {
      cached = await writeWallEvaluationClock(pool, workspaceId);
      return cached;
    },
    snapshot() {
      return { ...cached };
    },
  };
  return clock;
}

/** Normalize coordinator `deps.now` which may be a frozen Instant or a live getter. */
export function resolveCoordinatorNow(
  depsNow: Instant | (() => Instant) | undefined,
  inputNow: Instant | undefined,
  wall: Instant = wallNow(),
): Instant {
  if (inputNow) return inputNow;
  if (typeof depsNow === 'function') return depsNow();
  if (depsNow) return depsNow;
  return wall;
}
