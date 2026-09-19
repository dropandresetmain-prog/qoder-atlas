#!/usr/bin/env node
/**
 * Opt-in CLI for caller-authored synthetic sandbox execution inputs.
 *
 * Required configuration is explicit and environment-only: the input file,
 * target workspace/actor/connection and sandbox marker. This script never
 * participates in boot or reset composition.
 */
import { readFile } from 'node:fs/promises';
import { createTargetPool } from '../src/persistence/postgres/pool.ts';
import { loadPostgresTargetConfig } from '../src/persistence/postgres/config.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { provisionSandboxExecutionInputs } from '../src/app/demo/sandboxExecutionInputs.ts';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const inputPath = required('NORTHSTAR_SANDBOX_INPUTS_FILE');
const workspaceId = required('PG_TARGET_WORKSPACE_ID');
const actorPrincipalId = required('PG_TARGET_ACTOR_ID');
const connectionId = required('NORTHSTAR_SANDBOX_INPUT_CONNECTION_ID');
const input = JSON.parse(await readFile(inputPath, 'utf8')) as unknown;
const pool = createTargetPool(loadPostgresTargetConfig());

try {
  const report = await provisionSandboxExecutionInputs({
    db: pool,
    uow: () => new PgUnitOfWork(pool, workspaceId),
    workspaceId,
    actorPrincipalId,
    connectionId,
    input,
    env: process.env,
  });
  console.log(JSON.stringify({
    status: 'APPLIED',
    workspaceId: report.workspaceId,
    connectionId: report.connectionId,
    travellersCreated: report.travellersCreated,
    travellersReused: report.travellersReused,
    budgetsCreated: report.budgetsCreated,
    budgetsReused: report.budgetsReused,
  }));
} finally {
  await pool.end();
}
