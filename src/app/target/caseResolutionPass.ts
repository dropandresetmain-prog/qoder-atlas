/**
 * Case resolution pass (B1): reassessed truth -> RESOLVED, only through the
 * deterministic resolution gate.
 *
 * For every non-terminal case, `evaluateRecoveryCaseResolution` decides —
 * every assessable subject CURRENT and PASS, no unreconciled execution, no
 * incomplete mandatory action, no proposed-only state — and only an allowed
 * gate commits `resolveRecoveryCase`. A case whose subjects recovered
 * without action (passive resolution) resolves the same way. A case that
 * cannot resolve stays where it is with the gate's reason on record; nothing
 * here relaxes the gate.
 */
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import { resolveRecoveryCase } from '../../persistence/postgres/commands/m9CaseResolutionCommands.ts';
import { evaluateRecoveryCaseResolution } from './recoveryCaseResolution.ts';

export interface ResolutionPassContext {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  uow: () => PgUnitOfWork;
  now?: string;
}

export interface ResolutionOutcome {
  caseId: string;
  status: string;
  result: 'RESOLVED' | 'BLOCKED' | 'FAILED';
  reason?: string;
  detail?: string;
}

export interface ResolutionPassReport {
  at: string;
  candidates: number;
  resolved: number;
  blocked: number;
  failed: number;
  outcomes: ResolutionOutcome[];
}

export async function runCaseResolutionPass(ctx: ResolutionPassContext): Promise<ResolutionPassReport> {
  const now = ctx.now ?? new Date().toISOString();
  const cases = await ctx.pool.query<{ id: string; lifecycle_status: string }>(
    `SELECT id, lifecycle_status FROM recovery_cases
      WHERE workspace_id = $1 AND lifecycle_status NOT IN ('RESOLVED', 'CLOSED', 'CANCELLED', 'SUPERSEDED')
      ORDER BY opened_at, id`,
    [ctx.workspaceId],
  );
  const report: ResolutionPassReport = { at: now, candidates: cases.rows.length, resolved: 0, blocked: 0, failed: 0, outcomes: [] };
  for (const row of cases.rows) {
    const outcome: ResolutionOutcome = { caseId: row.id, status: row.lifecycle_status, result: 'BLOCKED' };
    try {
      const gate = await evaluateRecoveryCaseResolution(ctx.pool, { workspaceId: ctx.workspaceId, recoveryCaseId: row.id, now });
      if (!gate.allowed) {
        outcome.reason = gate.reason;
        outcome.detail = gate.detail;
        report.blocked += 1;
      } else {
        const resolved = await resolveRecoveryCase(ctx.uow(), {
          workspaceId: ctx.workspaceId,
          actorPrincipalId: ctx.actorPrincipalId,
          idempotencyKey: `resolution:${row.id}:${gate.summary.length}:${now}`,
          recoveryCaseId: row.id,
          now,
        });
        if (resolved.ok) {
          outcome.result = 'RESOLVED';
          outcome.status = 'RESOLVED';
          outcome.detail = resolved.value.summary;
          report.resolved += 1;
        } else {
          outcome.result = 'FAILED';
          outcome.detail = `${resolved.conflict.kind}: ${resolved.conflict.message}`;
          report.failed += 1;
        }
      }
    } catch (error) {
      outcome.result = 'FAILED';
      outcome.detail = error instanceof Error ? error.message : String(error);
      report.failed += 1;
    }
    report.outcomes.push(outcome);
  }
  return report;
}
