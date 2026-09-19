/**
 * R4 shell runtime — pure region-patch planning and revision/action helpers.
 * These functions are stringified into the browser script; tests import the same source.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionKey,
  hashString,
  planRegionPatch,
  revisionUnchanged,
  renderShellRuntimeScript,
} from '../src/ui/shellRuntime.ts';
import { casePollingScript } from '../src/ui/casePolling.ts';

test('hashString is stable', () => {
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
});

test('revisionUnchanged guards on projection revision, not cursor', () => {
  assert.equal(revisionUnchanged('r1', 'r1'), true);
  assert.equal(revisionUnchanged('r1', 'r2'), false);
  assert.equal(revisionUnchanged(null, 'r1'), false);
});

test('planRegionPatch holds graph when scene hash unchanged', () => {
  const plan = planRegionPatch(
    { graph: { hash: 'a', graph: true, scene: 's1' }, copy: { hash: 'c1' } },
    { graph: { hash: 'CHANGED', graph: true, scene: 's1' }, copy: { hash: 'c2' } },
  );
  assert.deepEqual(plan.heldGraph, ['graph']);
  assert.deepEqual(plan.patch, ['copy']);
});

test('planRegionPatch replaces graph when scene hash changes', () => {
  const plan = planRegionPatch(
    { graph: { hash: 'a', graph: true, scene: 's1' } },
    { graph: { hash: 'a', graph: true, scene: 's2' } },
  );
  assert.deepEqual(plan.patch, ['graph']);
  assert.deepEqual(plan.heldGraph, []);
});

test('actionKey distinguishes recover attempts', () => {
  assert.equal(actionKey('recover', 'c1', 's1'), actionKey('recover', 'c1', 's1'));
  assert.notEqual(actionKey('recover', 'c1', 's1'), actionKey('recover', 'c1', 's2'));
});

test('renderShellRuntimeScript is document-level: data-action + region patch, no main replace', () => {
  const script = renderShellRuntimeScript({ intervalMs: 4000 });
  assert.ok(script.includes('data-action'));
  assert.ok(script.includes('data-poll-region') || script.includes('poll-region') || script.includes('planRegionPatch') || script.includes('heldGraph'));
  assert.ok(script.includes('reset-demo') || script.includes('reset-demo'));
  assert.ok(!script.includes('WebSocket'));
  assert.ok(!script.includes('EventSource'));
});

test('trigger-disruption posts zero body bytes so the disclosed event file is used', () => {
  const script = renderShellRuntimeScript({ intervalMs: 4000 });
  assert.ok(script.includes('emptyBody'));
  assert.ok(script.includes('airline-rebooking'));
  // Must not unconditionally POST '{}' for every action (that breaks file load).
  assert.match(script, /if\s*\(\s*!spec\.emptyBody\s*\)/);
});

test('casePollingScript only configures the shell poller (no outerHTML main swap)', () => {
  const script = casePollingScript({ caseRef: 'CASE-001' });
  assert.ok(script.includes('CASE-001'));
  assert.ok(script.includes('__northstarPollConfig'));
  assert.ok(script.includes('sinceCursor') || script.includes('cursorParam'));
  assert.ok(!script.includes('outerHTML'));
  assert.ok(!script.includes('WebSocket'));
});
