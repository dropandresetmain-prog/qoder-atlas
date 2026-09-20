import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSyntheticSandboxDocumentEnvironment,
  isSyntheticSandboxMarker,
  SandboxProtectedDocumentError,
} from '../src/app/demo/sandboxProtectedDocuments.ts';

test('synthetic protected-document guard requires the explicit sandbox marker', () => {
  assertSyntheticSandboxDocumentEnvironment({ ATLAS_ENV: 'sandbox', NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS: '1' });
  assert.throws(
    () => assertSyntheticSandboxDocumentEnvironment({ ATLAS_ENV: 'production', NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS: '1' }),
    (error: unknown) => error instanceof SandboxProtectedDocumentError && error.code === 'SANDBOX_REQUIRED',
  );
  assert.throws(
    () => assertSyntheticSandboxDocumentEnvironment({ ATLAS_ENV: 'sandbox' }),
    (error: unknown) => error instanceof SandboxProtectedDocumentError && error.code === 'EXPLICIT_MARKER_REQUIRED',
  );
});

test('only the bounded synthetic marker vocabulary is accepted', () => {
  assert.equal(isSyntheticSandboxMarker('NORTHSTAR-SYNTHETIC-NOT-VALID-FOR-TRAVEL-passport-placeholder-1'), true);
  assert.equal(isSyntheticSandboxMarker('passport-number'), false);
  assert.equal(isSyntheticSandboxMarker('NORTHSTAR-SYNTHETIC-NOT-VALID-FOR-TRAVEL-'), false);
  assert.equal(isSyntheticSandboxMarker(`NORTHSTAR-SYNTHETIC-NOT-VALID-FOR-TRAVEL-${'x'.repeat(129)}`), false);
});
