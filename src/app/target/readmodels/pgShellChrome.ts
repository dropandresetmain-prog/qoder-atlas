/**
 * Cheap, authoritative shell chrome values (event name + open decision count)
 * for operator pages whose own read model does not carry them (Case, Incident,
 * Traveller). Same definitions the Overview and Decisions pages use:
 *  - event name: the single ACTIVE programme's event title (absent otherwise,
 *    so the shell renders no event select rather than a guess);
 *  - decision count: open cases awaiting authority.
 */
import type { Pool } from '../../../persistence/postgres/pool.ts';
import type { ShellContext } from '../productShell.ts';

export async function loadShellChrome(pool: Pool, workspaceId: string): Promise<ShellContext> {
  const event = await pool.query<{ title: string }>(
    `SELECT e.title
       FROM programmes prog
       JOIN events e ON e.workspace_id = prog.workspace_id AND e.id = prog.event_id
      WHERE prog.workspace_id = $1 AND prog.lifecycle_status = 'ACTIVE'
      LIMIT 2`,
    [workspaceId],
  );
  const decisions = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM recovery_cases
      WHERE workspace_id = $1 AND closed_at IS NULL AND lifecycle_status = 'AWAITING_AUTHORITY'`,
    [workspaceId],
  );
  return {
    ...(event.rowCount === 1 ? { eventName: event.rows[0]!.title } : {}),
    decisionCount: decisions.rows[0]?.n ?? 0,
  };
}
