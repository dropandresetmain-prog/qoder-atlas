/**
 * Final-demo S1→S3 continuity: same tripId NOT_VIABLE before organiser
 * programme RESCHEDULE commit, VIABLE after — one reset only, no scenario-id
 * branching in generic code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  loadAcceptanceManifest,
  runAcceptanceManifest,
} from '../src/acceptance/index.ts';

const MANIFEST = resolve('fixtures/acceptance/manifests/s1-s3-continuity.json');

test('final-demo: S1→S3 continuity manifest loads', () => {
  const manifest = loadAcceptanceManifest(MANIFEST);
  assert.equal(manifest.scenarioId, 'S1-S3-CONTINUITY');
  assert.equal(manifest.steps.filter((s) => s.action.type === 'http' && String((s.action as { path?: string }).path ?? '').includes('/runtime/reset')).length, 1);
  assert.ok(manifest.steps.some((s) => s.id === 'observe_before_s3'));
  assert.ok(manifest.steps.some((s) => s.id === 'observe_after_s3'));
});

test('final-demo: S1→S3 continuity proves same trip NOT_VIABLE → VIABLE', async () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), 's1s3-cont-'));
  const result = await runAcceptanceManifest({
    manifestPath: MANIFEST,
    evidenceDir,
    mode: 'REPLAY',
  });
  assert.equal(result.evidence.ok, true, result.evidence.error);

  const before = result.evidence.steps.find((s) => s.stepId === 'observe_before_s3');
  const mid = result.evidence.steps.find((s) => s.stepId === 'observe_mid_preview');
  const after = result.evidence.steps.find((s) => s.stepId === 'observe_after_s3');
  assert.ok(before?.ok && mid?.ok && after?.ok);

  const beforeBody = before?.response as { remainderViable?: string } | undefined;
  const midBody = mid?.response as { remainderViable?: string } | undefined;
  const afterBody = after?.response as { remainderViable?: string } | undefined;

  assert.equal(beforeBody?.remainderViable, 'NOT_VIABLE');
  assert.equal(midBody?.remainderViable, 'NOT_VIABLE');
  assert.equal(afterBody?.remainderViable, 'VIABLE');

  const commit = result.evidence.steps.find((s) => s.stepId === 's3_commit');
  const commitBody = commit?.response as { processedSignals?: Array<{ tripId?: string }> } | undefined;
  assert.equal(commitBody?.processedSignals?.[1]?.tripId, 'trip-trv-evt-ait-2026-ait-draft-14');
});
