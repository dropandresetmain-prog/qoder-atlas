/**
 * Before first baseline evaluation, bind configured passports to declared
 * intended visits and publish reviewed ENTRY coverage for those visits.
 *
 * Travellers with intended visits otherwise stay overallVerdict=UNKNOWN
 * (credential_selection_missing / requirement_coverage_incomplete) even when
 * connection and programme dimensions PASS — which Overview paints as RED.
 *
 * Reuses the same TargetRecoveryContext prepareExistingVisits path planning
 * uses later; does not invent hero-specific branches.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../../config/config.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import { captureWorld } from '../../persistence/postgres/world/pgCurrentState.ts';
import { createM6Registry } from '../../resolution/evaluation/registry.ts';
import { composeTargetRecoveryResearch } from '../composeTargetRecoveryResearch.ts';

export async function prepareBaselineExistingVisits(params: {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  reviewerPrincipalId: string;
  uow: () => PgUnitOfWork;
  config: AppConfig;
  cwd: string;
  /** Absolute or cwd-relative path to recovery-research.json when known. */
  configurationFile?: string;
  datasetDirectory?: string;
  now: Instant;
}): Promise<'SKIPPED' | 'PREPARED'> {
  const bundled = params.datasetDirectory
    ? join(params.datasetDirectory, 'recovery-research.json')
    : undefined;
  const configurationFile = params.configurationFile?.trim()
    || (bundled && existsSync(bundled) ? bundled : undefined);
  if (!configurationFile) return 'SKIPPED';

  const recoveryResearch = await composeTargetRecoveryResearch({
    config: params.config,
    cwd: params.cwd,
    configurationFile,
    pool: params.pool,
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    uow: params.uow,
    reviewerPrincipalId: params.reviewerPrincipalId,
  });
  if (!recoveryResearch) return 'SKIPPED';

  const journeys = await params.pool.query<{ id: string }>(
    `SELECT id FROM journeys WHERE workspace_id = $1 AND lifecycle_status <> 'CANCELLED' ORDER BY id`,
    [params.workspaceId],
  );
  if (journeys.rowCount === 0) return 'SKIPPED';

  const registry = createM6Registry();
  const world = await captureWorld(params.pool, {
    workspaceId: params.workspaceId,
    focus: journeys.rows.map((row) => ({ kind: 'JOURNEY' as const, id: row.id })),
    at: params.now,
    informationTopics: registry.informationTopics,
  });

  await recoveryResearch.prepare({
    recoveryCaseId: `baseline-existing-visits:${params.workspaceId}`,
    now: params.now,
    world,
    failing: [],
  });
  return 'PREPARED';
}
