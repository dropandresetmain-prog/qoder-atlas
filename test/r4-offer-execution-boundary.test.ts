/**
 * R4-F2 boundary guard: the ONLY target-runtime code that may call the Atlas
 * consequential operations (createOrder / payOrder / submitCancellation) is the
 * external offer execution module, which runs strictly behind the stored
 * authority gate + durable attempt. Planner, intelligence, resolution and every
 * other target module can never reach a provider mutation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const CONSEQUENTIAL = /\.(createOrder|payOrder|submitCancellation)\s*\(/;
const ALLOWED = new Set(['src/app/target/externalOfferExecution.ts']);
// The retired SQLite-root composition keeps its own executor; it is not reachable from the PG target boot.
const LEGACY = new Set(['src/app/providerExecution.ts', 'src/app/compose.ts', 'src/providers/atlas/transactionAdapter.ts']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

test('no target-runtime module other than the gated external execution module can call a provider mutation', () => {
  const offenders: string[] = [];
  for (const file of walk(join(ROOT, 'src'))) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (ALLOWED.has(rel) || LEGACY.has(rel)) continue;
    if (CONSEQUENTIAL.test(readFileSync(file, 'utf8'))) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

test('the PG target boot does not import the legacy provider-backed executor', () => {
  const boot = readFileSync(join(ROOT, 'src/app/composeTargetBoot.ts'), 'utf8');
  assert.equal(/providerExecution\.ts|from '\.\/compose\.ts'/.test(boot), false);
});

test('the external execution module only mutates after the stored gate and durable DISPATCHING transition (structure)', () => {
  const source = readFileSync(join(ROOT, 'src/app/target/externalOfferExecution.ts'), 'utf8');
  const prepare = source.indexOf('createPreparedExecutionAttempt(ctx.uow()');
  const dispatch = source.indexOf('worker.dispatchClaimed(');
  const mutate = source.indexOf('deps.transactions.createOrder(');
  assert.ok(prepare > 0 && dispatch > prepare, 'gate + durable PREPARED attempt precede dispatch');
  assert.ok(mutate > 0, 'the dispatcher is the only mutation site');
  const worker = readFileSync(join(ROOT, 'src/persistence/postgres/execution/pgExecutionWorker.ts'), 'utf8');
  assert.ok(worker.indexOf("to: 'DISPATCHING'") < worker.indexOf('await params.dispatcher(claim)'), 'DISPATCHING is committed before the dispatcher runs');
});

import { requiredAuthorityScope } from '../src/persistence/postgres/execution/storedExecutionGate.ts';

test('B1: a JOURNEY_ITEM requirement is dropped only when its own owning journey is required', () => {
  const item = { kind: 'JOURNEY_ITEM', id: 'item-2' } as never;
  const j1 = { kind: 'JOURNEY', id: 'j1' } as never;
  const j2 = { kind: 'JOURNEY', id: 'j2' } as never;
  const kinds = (refs: { kind: string; id: string }[]) => refs.map((r) => `${r.kind}:${r.id}`);
  // item owned by j2, but only j1 is resolved: the item stays required (no weaker authority).
  assert.deepEqual(kinds(requiredAuthorityScope([item], [j1], new Map([['item-2', 'j2']]))), ['JOURNEY:j1', 'JOURNEY_ITEM:item-2']);
  // unknown owner: fail closed.
  assert.ok(kinds(requiredAuthorityScope([item], [j1])).includes('JOURNEY_ITEM:item-2'));
  // owner resolved: the item is covered by its journey.
  assert.deepEqual(kinds(requiredAuthorityScope([item], [j1, j2], new Map([['item-2', 'j2']]))), ['JOURNEY:j1', 'JOURNEY:j2']);
  // OFFER refs are never independent requirements.
  assert.deepEqual(kinds(requiredAuthorityScope([{ kind: 'OFFER', id: 'o' } as never], [j1])), ['JOURNEY:j1']);
});
