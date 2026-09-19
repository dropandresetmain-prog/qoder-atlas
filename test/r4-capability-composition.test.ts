/**
 * R4 / G01 — advertised capability families === really composed families.
 * Pure (no PostgreSQL). Proves the phantom HOTEL/TRANSFER/RESEARCH set is gone
 * and provider-backed domains fail closed UNAVAILABLE when no adapter is composed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config/config.ts';
import { derivedCapabilities } from '../src/app/target/recoveryPlanningCoordinator.ts';
import { capabilitiesForComposition, composeTransportFamilies } from '../src/app/targetProviderFamilies.ts';
import { defaultRecoveryDomainRegistry } from '../src/resolution/planning/recoveryDomains.ts';
import { recoveryDomainContext } from '../src/resolution/planning/recoveryDomains.ts';
import { resolveRecoveryDomainDecisions } from '../src/contracts/v2/planning/recoveryDomain.ts';
import type { CapabilityFamily } from '../src/operational/strategy.ts';

const ALL_BLOCKING = [
  'programme_participation', 'connection_feasibility', 'overnight_accommodation',
  'support_continuity', 'advisories',
];

function decisions(availableCapabilities: readonly CapabilityFamily[]) {
  return new Map(resolveRecoveryDomainDecisions(
    defaultRecoveryDomainRegistry(),
    recoveryDomainContext({ failingSubjectKinds: ['JOURNEY'], blockingDimensionCodes: ALL_BLOCKING, affectedObjectKinds: [], availableCapabilities }),
  ).map((d) => [d.domainId, d]));
}

test('coordinator default: no transport => no capability; transport => FLIGHT only', () => {
  assert.deepEqual([...derivedCapabilities(undefined)], []);
  assert.deepEqual([...derivedCapabilities({ transport: () => undefined })], ['FLIGHT']);
  assert.deepEqual([...capabilitiesForComposition({})], []);
  assert.deepEqual([...capabilitiesForComposition({ transportPlanning: {} })], ['FLIGHT']);
});

test('no composed family: provider-backed domains fail closed UNAVAILABLE, non-provider domains stay available', () => {
  const d = decisions(derivedCapabilities(undefined));
  for (const domain of ['TRANSPORT', 'STAY', 'TRANSFER', 'INFORMATION_RESEARCH'] as const) {
    assert.equal(d.get(domain)?.disposition, 'UNAVAILABLE', domain);
    assert.equal(d.get(domain)?.reasonCode, 'capability_unavailable', domain);
  }
  assert.equal(d.get('PROGRAMME')?.disposition, 'INVESTIGATED');
  assert.equal(d.get('SUPPORT_COORDINATION')?.disposition, 'INVESTIGATED');
});

test('transport composed: only TRANSPORT becomes investigable; HOTEL/TRANSFER/RESEARCH never advertised', () => {
  const caps = derivedCapabilities({ transport: () => undefined });
  const d = decisions(caps);
  assert.equal(d.get('TRANSPORT')?.disposition, 'INVESTIGATED');
  for (const domain of ['STAY', 'TRANSFER', 'INFORMATION_RESEARCH'] as const) {
    assert.equal(d.get(domain)?.disposition, 'UNAVAILABLE', domain);
  }
  for (const family of ['HOTEL', 'TRANSFER', 'RESEARCH'] as const) assert.ok(!caps.includes(family));
});

test('boot composition: REPLAY composes FLIGHT only; LIVE without credentials composes nothing; injected composer is honoured', () => {
  const replay = composeTransportFamilies(loadConfig({ ADAPTER_MODE: 'REPLAY', PG_TARGET_WORKSPACE_ID: randomUUID() }), process.cwd());
  assert.deepEqual([...replay.availableCapabilities], ['FLIGHT']);
  assert.ok(replay.transportPlanning);

  const live = composeTransportFamilies(
    loadConfig({ ADAPTER_MODE: 'LIVE', PG_TARGET_WORKSPACE_ID: randomUUID() }, mkdtempSync(join(tmpdir(), 'r4-g01-'))),
    process.cwd(),
  );
  assert.deepEqual([...live.availableCapabilities], []);
  assert.equal(live.transportPlanning, undefined);

  const none = composeTransportFamilies(loadConfig({ ADAPTER_MODE: 'REPLAY', PG_TARGET_WORKSPACE_ID: randomUUID() }), process.cwd(), undefined, { composeTransport: () => undefined });
  assert.deepEqual([...none.availableCapabilities], []);
});
