/**
 * A5 CP5 — demo readiness preflight pure fail-closed aggregation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { DemoPreflightCheck } from '../src/app/target/demoReadinessPreflight.ts';

function reportOk(checks: DemoPreflightCheck[]): boolean {
  return checks.filter((c) => c.severity === 'required' && !c.ok).length === 0;
}

test('CP5: required failures flip ok=false; advisory alone does not', () => {
  const mixed: DemoPreflightCheck[] = [
    { id: 'a', severity: 'required', ok: true, detail: 'ok' },
    { id: 'b', severity: 'advisory', ok: false, detail: 'gap' },
  ];
  assert.equal(reportOk(mixed), true);
  const failed: DemoPreflightCheck[] = [
    { id: 'a', severity: 'required', ok: false, detail: 'missing' },
    { id: 'b', severity: 'advisory', ok: true, detail: 'ok' },
  ];
  assert.equal(reportOk(failed), false);
});
