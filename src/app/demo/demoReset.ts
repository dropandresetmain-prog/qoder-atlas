/**
 * Demo reset: return ONE configured demo workspace to its healthy provisioned
 * baseline.
 *
 * Why this is not a "generic wipe":
 *  - it is refused unless a demo dataset is configured for the runtime AND the
 *    reset gate is open (`demoResetGate`), so a runtime with no demo dataset
 *    can never reach it;
 *  - every DELETE is `WHERE workspace_id = $1` for the ONE configured demo
 *    workspace. No other workspace's row is ever addressed;
 *  - the table list is not free-form: it is exactly the base tables of the
 *    `public` schema that carry a `workspace_id` column, minus an explicit
 *    exclusion list (`EXCLUDED_TABLES`), ordered child-before-parent from the
 *    live foreign-key graph. Introspection (rather than a hand-kept list)
 *    means a new workspace-scoped table added by a later migration is reset
 *    too instead of silently surviving and corrupting the baseline;
 *  - the delete runs in ONE transaction under a session advisory lock (so two
 *    resets, or a reset and itself, can never interleave).
 *
 * Many domain tables are append-only by design (`forbid_mutation` triggers),
 * so a DELETE is rejected by those triggers. Inside the reset transaction —
 * and only there — `session_replication_role = replica` suspends triggers
 * (immutability, scope-generation bump, revision counters). This needs a role
 * that may set it (superuser on the local/demo database). If the role cannot,
 * the reset REFUSES (`UNSUPPORTED`) and changes nothing: the transaction is
 * rolled back. It never falls back to a weaker method.
 *
 * After the delete the world is rebuilt by the SAME deterministic boot
 * provisioning (dataset materialization, baseline evaluation, workspace
 * authority), which is why reset-twice yields an identical baseline: every
 * object id and idempotency key derives from the dataset identity.
 */
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import { datasetDirectoryFromEnv } from './datasetLoader.ts';
import { provisionConfiguredDataset } from './provisionDataset.ts';
import { runBaselineEvaluation } from './baselineEvaluation.ts';
import { provisionWorkspaceAuthority } from '../target/workspaceAuthority.ts';
import { tryAcquireWorkspaceOperationLease } from '../target/workspaceOperationLease.ts';

/**
 * Tables that carry `workspace_id` but are NOT demo-mutated world state:
 * migration bookkeeping for the offline legacy import.
 */
export const EXCLUDED_TABLES: ReadonlySet<string> = new Set(['legacy_id_map']);

export type DemoResetGate =
  | { open: true; datasetDirectory: string }
  | { open: false; code: 'DEMO_DATASET_NOT_CONFIGURED' | 'DEMO_RESET_DISABLED'; message: string };

/**
 * Gate: a demo dataset must be configured (that is what makes a workspace a
 * demo workspace) and `APP_ENVIRONMENT` must be a demo/dev/local one
 * (the only values the config accepts) unless the operator switched the reset
 * off with `NORTHSTAR_DEMO_RESET=disabled`.
 */
export function demoResetGate(env: NodeJS.ProcessEnv = process.env): DemoResetGate {
  const datasetDirectory = datasetDirectoryFromEnv(env);
  if (datasetDirectory === undefined) {
    return {
      open: false,
      code: 'DEMO_DATASET_NOT_CONFIGURED',
      message: 'Demo reset is only available on a runtime configured with a demo dataset (NORTHSTAR_DEMO_DATASET_DIR).',
    };
  }
  const environment = (env.APP_ENVIRONMENT ?? 'local').trim().toLowerCase() || 'local';
  const flag = (env.NORTHSTAR_DEMO_RESET ?? '').trim().toLowerCase();
  if (flag === 'disabled' || flag === '0' || flag === 'false' || !['local', 'dev', 'demo'].includes(environment)) {
    return {
      open: false,
      code: 'DEMO_RESET_DISABLED',
      message: 'Demo reset is disabled on this runtime.',
    };
  }
  return { open: true, datasetDirectory };
}

/** Workspace-scoped base tables, child-before-parent (safe DELETE order). */
export async function listResetTables(pool: Pool | { query: Pool['query'] }): Promise<string[]> {
  const tables = await pool.query<{ table_name: string }>(
    `SELECT c.table_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'workspace_id' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name`,
  );
  const names = tables.rows.map((row) => row.table_name).filter((name) => !EXCLUDED_TABLES.has(name));
  const selected = new Set(names);
  const fks = await pool.query<{ child: string; parent: string }>(
    `SELECT cl.relname AS child, pl.relname AS parent
       FROM pg_constraint k
       JOIN pg_class cl ON cl.oid = k.conrelid
       JOIN pg_class pl ON pl.oid = k.confrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
      WHERE k.contype = 'f' AND n.nspname = 'public' AND cl.oid <> pl.oid`,
  );
  // children[parent] = tables that reference parent (must be deleted first).
  const referencedBy = new Map<string, Set<string>>();
  for (const name of names) referencedBy.set(name, new Set());
  for (const fk of fks.rows) {
    if (selected.has(fk.child) && selected.has(fk.parent)) referencedBy.get(fk.parent)!.add(fk.child);
  }
  // Kahn over "parent waits for its children": emit a table once all tables
  // referencing it are already emitted.
  const emitted: string[] = [];
  const done = new Set<string>();
  let remaining = [...names];
  while (remaining.length > 0) {
    const ready = remaining.filter((name) => [...referencedBy.get(name)!].every((child) => done.has(child)));
    // A cycle (should not exist) is broken deterministically; with triggers
    // suspended inside the reset transaction the order is then immaterial.
    const batch = ready.length > 0 ? ready : [remaining[0]!];
    for (const name of batch) {
      emitted.push(name);
      done.add(name);
    }
    remaining = remaining.filter((name) => !done.has(name));
  }
  return emitted;
}

export type DemoResetOutcome =
  | {
      status: 'RESET';
      workspaceId: string;
      tables: string[];
      deletedRows: number;
      provisioning: string;
      baselineEvaluated: number;
      authority: string;
      /** Wall-clock milliseconds per reset phase (diagnostic, not truth). */
      timingsMs: Record<string, number>;
    }
  | { status: 'REFUSED'; code: string; message: string }
  | { status: 'UNSUPPORTED'; code: 'RESET_REQUIRES_TRIGGER_BYPASS'; message: string }
  | { status: 'IN_PROGRESS'; code: 'RESET_IN_PROGRESS'; message: string };

export interface DemoResetParams {
  pool: Pool;
  uow: () => PgUnitOfWork;
  workspaceId: string;
  env?: NodeJS.ProcessEnv;
  now?: () => string;
}

/**
 * Reset is deliberately unavailable once this workspace has any external
 * execution history. A reset would erase the local reconciliation identity
 * while a provider order may continue to exist. This is a safety boundary,
 * not a terminal judgement about the attempt outcome.
 */
export async function findExternalExecutionResetBlocker(
  db: Pick<Pool, 'query'>,
  workspaceId: string,
): Promise<{ capabilityRef: string; status: string } | undefined> {
  const result = await db.query<{ capability_ref: string; status: string }>(
    `SELECT ai.capability_ref, ea.status
       FROM execution_attempts ea
       JOIN action_intents ai
         ON ai.workspace_id = ea.workspace_id AND ai.id = ea.action_intent_id
      WHERE ea.workspace_id = $1 AND ai.capability_ref LIKE 'external:%'
      UNION ALL
     SELECT ai.capability_ref, ea.status
       FROM execution_observations eo
       JOIN execution_attempts ea
         ON ea.workspace_id = eo.workspace_id AND ea.id = eo.attempt_id
       JOIN action_intents ai
         ON ai.workspace_id = ea.workspace_id AND ai.id = ea.action_intent_id
      WHERE eo.workspace_id = $1 AND eo.origin = 'EXTERNAL_PROVIDER'
      LIMIT 1`,
    [workspaceId],
  );
  const row = result.rows[0];
  return row ? { capabilityRef: row.capability_ref, status: row.status } : undefined;
}

/**
 * In-process single-flight: a second reset for the same workspace while one is
 * running is answered immediately with IN_PROGRESS, without taking a pool
 * connection (the advisory lock below still guards other processes).
 */
const resetsInFlight = new Set<string>();

export async function resetDemoWorkspace(params: DemoResetParams): Promise<DemoResetOutcome> {
  const env = params.env ?? process.env;
  const gate = demoResetGate(env);
  if (!gate.open) return { status: 'REFUSED', code: gate.code, message: gate.message };
  const { workspaceId } = params;
  if (resetsInFlight.has(workspaceId)) {
    return { status: 'IN_PROGRESS', code: 'RESET_IN_PROGRESS', message: 'A demo reset is already running for this workspace.' };
  }
  resetsInFlight.add(workspaceId);
  try {
    return await runReset(params, env);
  } finally {
    resetsInFlight.delete(workspaceId);
  }
}

async function runReset(params: DemoResetParams, env: NodeJS.ProcessEnv): Promise<DemoResetOutcome> {
  const { pool, workspaceId } = params;
  const timingsMs: Record<string, number> = {};
  let phaseStart = Date.now();
  const mark = (phase: string): void => {
    const t = Date.now();
    timingsMs[phase] = t - phaseStart;
    phaseStart = t;
  };

  const lease = await tryAcquireWorkspaceOperationLease(pool, workspaceId);
  if (!lease) {
    return { status: 'IN_PROGRESS', code: 'RESET_IN_PROGRESS', message: 'A reset or external execution cycle is already running for this workspace.' };
  }
  const client = lease.client;
  try {
    mark('lock');
    const external = await findExternalExecutionResetBlocker(client, workspaceId);
    if (external) {
      return {
        status: 'REFUSED',
        code: 'EXTERNAL_EXECUTION_HISTORY_PRESENT',
        message: `Reset is unavailable: ${external.capabilityRef} has durable external execution state (${external.status}). Reconcile and retain the workspace for audit.`,
      };
    }
    const tables = await listResetTables(client);
    let deletedRows = 0;
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL session_replication_role = 'replica'`);
      for (const table of tables) {
        const result = await client.query(`DELETE FROM "${table}" WHERE workspace_id = $1`, [workspaceId]);
        deletedRows += result.rowCount ?? 0;
      }
      await client.query('COMMIT');
      mark('deleteWorkspaceRows');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if ((error as { code?: string }).code === '42501') {
        return {
          status: 'UNSUPPORTED',
          code: 'RESET_REQUIRES_TRIGGER_BYPASS',
          message:
            'The database role cannot suspend append-only triggers for a workspace reset. '
            + 'Nothing was changed. Reset needs a demo/dev database role that may set session_replication_role.',
        };
      }
      throw error;
    }

    // Rebuild the healthy baseline with the same deterministic boot steps.
    const actorPrincipalId = `northstar-boot:${workspaceId}`;
    const provisioning = await provisionConfiguredDataset({ pool, workspaceId, actorPrincipalId, env });
    mark('provisionDataset');
    const baseline = await runBaselineEvaluation({ pool, workspaceId, actorPrincipalId });
    mark('baselineEvaluation');
    const authority = await provisionWorkspaceAuthority({
      pool,
      uow: params.uow,
      workspaceId,
      actorPrincipalId,
      now: (params.now ?? (() => new Date().toISOString()))(),
      operatorAuthSubject: env.NORTHSTAR_OPERATOR_AUTH_SUBJECT?.trim() || undefined,
    });
    mark('workspaceAuthority');
    return {
      status: 'RESET',
      workspaceId,
      tables,
      deletedRows,
      provisioning: provisioning.status,
      baselineEvaluated: baseline.evaluated,
      authority: authority.status,
      timingsMs,
    };
  } finally {
    await lease.release();
  }
}
