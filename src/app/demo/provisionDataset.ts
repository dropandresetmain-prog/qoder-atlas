/**
 * Idempotent dataset provisioning.
 *
 * Boot must not recreate a world it already has, must not layer a second
 * world on top of the first, and must not silently accept different content
 * under the same dataset identity. The decision uses one durable fact: a
 * dataset-level `source_records` capture whose `source_identity` is the
 * dataset key and whose `content_hash` is the hash of the dataset's bytes.
 *
 *  - marker absent            -> materialize, then write the marker last.
 *  - marker present, same hash -> already provisioned; reuse it.
 *  - marker present, other hash -> fail visibly (DATASET_CONTENT_CONFLICT).
 *
 * The marker is written last on purpose: a run interrupted part-way leaves no
 * marker, so the next boot materializes again — and because every object id
 * and every command idempotency key is derived deterministically from the
 * dataset (see DatasetIdentityMinter), that second run replays the committed
 * commands from the idempotency ledger and only executes what never ran. A
 * resumed provisioning therefore completes the same world rather than
 * duplicating any part of it.
 */
import type { Pool } from '../../persistence/postgres/pool.ts';
import { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import { recordSource } from '../../persistence/postgres/commands/knowledgeCommands.ts';
import { DatasetIdentityMinter } from './datasetIds.ts';
import { datasetDirectoryFromEnv, loadDataset, type LoadedDataset } from './datasetLoader.ts';
import { materializeDataset, type MaterializationReport } from './materializeDataset.ts';

export class DatasetContentConflictError extends Error {
  readonly code = 'DATASET_CONTENT_CONFLICT';
  readonly datasetKey: string;
  readonly provisionedHash: string;
  readonly loadedHash: string;
  constructor(datasetKey: string, provisionedHash: string, loadedHash: string) {
    super(
      `dataset ${datasetKey} is already provisioned from different content ` +
        `(provisioned ${provisionedHash.slice(0, 16)}…, loaded ${loadedHash.slice(0, 16)}…). ` +
        'Refusing to layer a second world into the same workspace: provision the new content into a fresh workspace/database.',
    );
    this.name = 'DatasetContentConflictError';
    this.datasetKey = datasetKey;
    this.provisionedHash = provisionedHash;
    this.loadedHash = loadedHash;
  }
}

export type ProvisionOutcome =
  | { status: 'MATERIALIZED'; datasetKey: string; contentHash: string; report: MaterializationReport }
  | { status: 'ALREADY_PROVISIONED'; datasetKey: string; contentHash: string }
  | { status: 'NOT_CONFIGURED' };

export function datasetProvisioningIdentity(datasetKey: string): string {
  return `northstar:dataset:${datasetKey}`;
}

interface ProvisionParams {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  dataset: LoadedDataset;
}

async function readMarker(
  pool: Pool,
  workspaceId: string,
  datasetKey: string,
): Promise<{ contentHash: string } | undefined> {
  const result = await pool.query<{ content_hash: string }>(
    `SELECT content_hash FROM source_records WHERE workspace_id = $1 AND source_identity = $2 LIMIT 1`,
    [workspaceId, datasetProvisioningIdentity(datasetKey)],
  );
  const row = result.rows[0];
  return row ? { contentHash: row.content_hash } : undefined;
}

/** Provision one already-loaded dataset into one workspace, exactly once. */
export async function provisionDataset(params: ProvisionParams): Promise<ProvisionOutcome> {
  const { pool, workspaceId, actorPrincipalId, dataset } = params;
  const existing = await readMarker(pool, workspaceId, dataset.datasetKey);
  if (existing) {
    if (existing.contentHash !== dataset.contentHash) {
      throw new DatasetContentConflictError(dataset.datasetKey, existing.contentHash, dataset.contentHash);
    }
    return { status: 'ALREADY_PROVISIONED', datasetKey: dataset.datasetKey, contentHash: dataset.contentHash };
  }

  const report = await materializeDataset({ pool, workspaceId, actorPrincipalId, dataset });

  const ids = new DatasetIdentityMinter(workspaceId, dataset.datasetKey);
  const marker = await recordSource(new PgUnitOfWork(pool, workspaceId), {
    workspaceId,
    actorPrincipalId,
    idempotencyKey: ids.key('dataset-marker'),
    sourceId: ids.id('dataset-marker'),
    sourceIdentity: datasetProvisioningIdentity(dataset.datasetKey),
    receivedAt: new Date().toISOString(),
    contentHash: dataset.contentHash,
    contentType: 'application/vnd.northstar.demo-dataset+json',
    captureMetadata: {
      datasetKey: dataset.datasetKey,
      files: dataset.contributingFiles,
      counts: report.counts,
      connectionId: report.connectionId,
    },
  });
  if (!marker.ok) {
    throw new Error(
      `dataset ${dataset.datasetKey} materialized but its provisioning marker failed: ` +
        `${marker.conflict.kind} ${marker.conflict.message}`,
    );
  }

  return { status: 'MATERIALIZED', datasetKey: dataset.datasetKey, contentHash: dataset.contentHash, report };
}

/**
 * Boot-time entry point: provision the configured dataset, or do nothing when
 * none is configured. The browser is never involved — a read request cannot
 * reach this path.
 */
export async function provisionConfiguredDataset(params: {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<ProvisionOutcome> {
  const directory = datasetDirectoryFromEnv(params.env ?? process.env);
  if (!directory) return { status: 'NOT_CONFIGURED' };
  const dataset = await loadDataset(directory);
  return provisionDataset({
    pool: params.pool,
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    dataset,
  });
}
