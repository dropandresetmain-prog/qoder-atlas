import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig } from '../src/config/config.ts';
import { composeTargetRecoveryResearch, RecoveryResearchConfigurationSchema } from '../src/app/composeTargetRecoveryResearch.ts';

test('the demo dataset research file composes without workspace ids', async () => {
  const configurationFile = resolve('fixtures/programmes/ait-summit-2026/recovery-research.json');
  const result = await composeTargetRecoveryResearch({
    config: loadConfig({ ADAPTER_MODE: 'REPLAY' }), cwd: process.cwd(), configurationFile,
    pool: undefined as never, workspaceId: randomUUID(), actorPrincipalId: 'test',
    reviewerPrincipalId: randomUUID(), uow: () => { throw new Error('composition must not write'); },
  });
  assert.ok(result, 'reviewed hotel research composes from the dataset file');
});

test('reviewed recovery composition is absent without explicit configuration', async () => {
  const result = await composeTargetRecoveryResearch({
    config: loadConfig({ ADAPTER_MODE: 'REPLAY' }), cwd: process.cwd(),
    pool: undefined as never, workspaceId: randomUUID(), actorPrincipalId: 'test',
    reviewerPrincipalId: randomUUID(), uow: () => { throw new Error('must not write'); },
  });
  assert.equal(result, undefined);
});

test('explicit source configuration composes read-only HOTEL and rejects duplicate passport choices', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'northstar-reviewed-composition-'));
  try {
    const selection = { travellerSourceRef: 'SOURCE_TRAVELLER_DRAFT:test-person', credentialId: randomUUID(), credentialVersionId: randomUUID(), guestNationality: 'SG' };
    const config = {
      schemaVersion: 1,
      hotelPoliciesFile: resolve('data/ait-demo-input-pack/global/hotel-property-policies.json'),
      entryPoliciesFile: resolve('data/ait-demo-input-pack/global/reviewed-entry-policies.json'),
      sourceConnectionProviderKind: 'configured-source',
      overnightTargets: [{ arrivalAirportSourceRef: 'SOURCE_PLACE:configured-airport', hotelPolicyId: 'hotel-policy-narita-gateway-2026', jurisdictionSourceRef: 'SOURCE_JURISDICTION:configured-country', countryCode: 'JP', entryPolicyId: 'jp-short-visit-sg-passport-2026-09' }],
      passportSelections: [selection],
    };
    assert.equal(RecoveryResearchConfigurationSchema.safeParse({ ...config, passportSelections: [selection, selection] }).success, false);
    const withoutIds = { ...selection, credentialId: undefined, credentialVersionId: undefined };
    assert.equal(RecoveryResearchConfigurationSchema.safeParse({ ...config, passportSelections: [withoutIds] }).success, true);
    assert.equal(RecoveryResearchConfigurationSchema.safeParse({ ...config, passportSelections: [] }).success, false);
    const configurationFile = join(directory, 'research.json');
    await writeFile(configurationFile, JSON.stringify(config));
    const result = await composeTargetRecoveryResearch({
      config: loadConfig({ ADAPTER_MODE: 'REPLAY' }), cwd: process.cwd(), configurationFile,
      pool: undefined as never, workspaceId: randomUUID(), actorPrincipalId: 'test',
      reviewerPrincipalId: randomUUID(), uow: () => { throw new Error('composition must not write'); },
    });
    assert.deepEqual(result?.hotel.metadata.readOnlyOperations, ['hotel.context', 'hotel.search', 'hotel.quote', 'hotel.retrieve']);
    assert.equal(typeof result?.prepare, 'function');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
