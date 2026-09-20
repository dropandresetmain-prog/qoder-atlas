import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSyntheticSandboxEnvironment,
  parseSandboxExecutionInputs,
  SandboxExecutionInputError,
} from '../src/app/demo/sandboxExecutionInputs.ts';

const valid = {
  schemaVersion: 1,
  sandbox: { environment: 'sandbox', marker: 'synthetic-sandbox-inputs' },
  travellers: [{
    sourceRef: 'SOURCE_TRAVELLER_DRAFT:traveller-1',
    bookingIdentity: { gender: 'FEMALE', contactEmail: 'synthetic@example.test', nationality: 'SG' },
  }],
  budgets: [{
    organisationSourceRef: 'SOURCE_ORGANISATION:org-1',
    budget: { id: '11111111-1111-4111-8111-111111111111', purpose: 'sandbox flight booking', amount: { amount: '100.00', currency: 'SGD' } },
    idempotencyKey: 'sandbox-budget-1',
  }],
} as const;

test('sandbox input schema requires the explicit marker and preserves caller-authored values', () => {
  assert.deepEqual(parseSandboxExecutionInputs(valid), valid);
  assert.throws(
    () => assertSyntheticSandboxEnvironment({ ATLAS_ENV: 'production', NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS: '1' }),
    (error: unknown) => error instanceof SandboxExecutionInputError && error.code === 'SANDBOX_REQUIRED',
  );
  assert.throws(
    () => assertSyntheticSandboxEnvironment({ ATLAS_ENV: 'sandbox' }),
    (error: unknown) => error instanceof SandboxExecutionInputError && error.code === 'EXPLICIT_MARKER_REQUIRED',
  );
});

test('malformed, duplicate, and inferred identity inputs fail before database access', () => {
  assert.throws(() => parseSandboxExecutionInputs({ ...valid, travellers: [{ ...valid.travellers[0], sourceRef: valid.travellers[0].sourceRef }, { ...valid.travellers[0] }] }), /duplicate traveller/);
  assert.throws(() => parseSandboxExecutionInputs({ ...valid, travellers: [{ sourceRef: valid.travellers[0].sourceRef, bookingIdentity: { contactEmail: 'synthetic@example.test' } }] }), /strict schema/);
  assert.throws(() => parseSandboxExecutionInputs({ ...valid, budgets: [{ ...valid.budgets[0], budget: { ...valid.budgets[0].budget, amount: { amount: 100, currency: 'SGD' } } }] }), /strict schema/);
  assert.throws(() => parseSandboxExecutionInputs({ ...valid, budgets: [valid.budgets[0], { ...valid.budgets[0], budget: { ...valid.budgets[0].budget, id: '22222222-2222-4222-8222-222222222222' } }] }), /duplicate budget idempotency key/);
  assert.throws(() => parseSandboxExecutionInputs({ ...valid, budgets: [{ ...valid.budgets[0], budget: { ...valid.budgets[0].budget, validFrom: '2030-01-02T00:00:00Z', validUntil: '2030-01-01T00:00:00Z' } }] }), /validUntil must be after validFrom/);
});

test('passport input requires explicit synthetic fields and rejects document custody fields', () => {
  const passport = {
    credentialId: '33333333-3333-4333-8333-333333333333',
    versionId: '44444444-4444-4444-8444-444444444444',
    syntheticDocumentMarker: 'NORTHSTAR-SYNTHETIC-NOT-VALID-FOR-TRAVEL-test-passport',
    issuerCountry: 'SG',
    issueDate: '2030-01-01',
    expiryDate: '2040-01-01',
    issuerStatus: 'UNKNOWN',
    physicallyAvailable: true,
    observedAt: '2030-01-01T00:00:00.000Z',
  } as const;
  assert.deepEqual(parseSandboxExecutionInputs({ ...valid, travellers: [{ ...valid.travellers[0], passport }] }).travellers[0]!.passport, passport);
  assert.throws(() => parseSandboxExecutionInputs({ ...valid, travellers: [{ ...valid.travellers[0], passport: { ...passport, documentKey: 'secret' } }] }), /strict schema/);
});
