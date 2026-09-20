#!/usr/bin/env node
/**
 * Opt-in CLI for caller-authored synthetic sandbox execution inputs.
 *
 * Required configuration is explicit and environment-only: the input file,
 * target workspace/actor/connection and sandbox marker. This script never
 * participates in boot or reset composition.
 */
import { readFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { createTargetPool } from '../src/persistence/postgres/pool.ts';
import { loadPostgresTargetConfig } from '../src/persistence/postgres/config.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { parseSandboxExecutionInputs, provisionSandboxExecutionInputs } from '../src/app/demo/sandboxExecutionInputs.ts';

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
const parsedInput = parseSandboxExecutionInputs(input);
const hasPassport = parsedInput.travellers.some((traveller) => traveller.passport !== undefined);
let documentKey: Uint8Array | undefined;
let documentKeyId: string | undefined;
if (hasPassport) {
  const encoded = required('NORTHSTAR_SANDBOX_DOCUMENT_KEY_BASE64');
  documentKey = Buffer.from(encoded, 'base64');
  if (documentKey.length !== 32) throw new Error('NORTHSTAR_SANDBOX_DOCUMENT_KEY_BASE64 must decode to 32 bytes');
  documentKeyId = required('NORTHSTAR_SANDBOX_DOCUMENT_KEY_ID');
}
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
    documentKey,
    documentKeyId,
  });
  console.log(JSON.stringify({
    status: 'APPLIED',
    workspaceId: report.workspaceId,
    connectionId: report.connectionId,
    travellersCreated: report.travellersCreated,
    travellersReused: report.travellersReused,
    budgetsCreated: report.budgetsCreated,
    budgetsReused: report.budgetsReused,
    passportsCreated: report.passportsCreated,
    passportsReused: report.passportsReused,
  }));
} finally {
  await pool.end();
}
