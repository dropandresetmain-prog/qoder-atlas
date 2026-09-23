/**
 * Provider stay-element ids must accept opaque Nuitée booking refs (incl. leading `-`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isOpaqueProviderStayElementId } from '../src/app/targetStayReplacementContext.ts';

test('Nuitée booking ids that start with a hyphen are accepted as stay elements', () => {
  assert.equal(isOpaqueProviderStayElementId('-hCa0gm5w'), true);
  assert.equal(isOpaqueProviderStayElementId('DpnZRH43H'), true);
  assert.equal(isOpaqueProviderStayElementId(''), false);
  assert.equal(isOpaqueProviderStayElementId('bad id'), false);
});
