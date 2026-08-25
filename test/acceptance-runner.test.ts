/**
 * Acceptance runner / preflight / evidence / extensibility proofs.
 *
 * Proves a new declarative manifest can drive the generic runner without
 * source-code modifications (no scenarioId business switches).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  loadAcceptanceManifest,
  runPreflight,
  runAcceptanceManifest,
  ScenarioEvidenceSchema,
} from '../src/acceptance/index.ts';
import { sanitizeRaw, containsUnsafeMaterial, REDACTED } from '../src/providers/sanitize.ts';
import { FileRecordingStore, runAdapter } from '../src/providers/index.ts';
import type { ProviderAdapter } from '../src/contracts/envelope.ts';

const MANIFESTS_ROOT = resolve('fixtures/acceptance/manifests');
const MANIFEST_FILES = [
  's1-airline-schedule-change.json',
  's2-missed-connection.json',
  's3-organiser-preview.json',
  's4-thursday-morning-arrival.json',
  's5-stay-until-sunday.json',
  's6-switch-hotels.json',
  's7-origin-tokyo.json',
  's8-travel-with-speakers.json',
];

test('acceptance: all S1–S8 manifests load through the generic schema', () => {
  for (const file of MANIFEST_FILES) {
    const manifest = loadAcceptanceManifest(join(MANIFESTS_ROOT, file));
    assert.ok(manifest.scenarioId);
    assert.ok(manifest.steps.length >= 1);
    assert.ok(manifest.boundaries.length >= 1);
  }
});

test('acceptance: preflight passes for S1 REPLAY/SIMULATED manifest', () => {
  const report = runPreflight({
    manifestPath: join(MANIFESTS_ROOT, 's1-airline-schedule-change.json'),
    evidenceDir: mkdtempSync(join(tmpdir(), 'accept-ev-')),
    recordingsDir: mkdtempSync(join(tmpdir(), 'accept-rec-')),
  });
  assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => !c.ok), null, 2));
  assert.ok(report.globalInputPackHash);
  assert.ok(report.localInputPackHash);
});

test('acceptance: preflight rejects missing required LIVE credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'accept-live-'));
  const manifestPath = join(dir, 'manifest.json');
  const packDir = join(dir, 'pack');
  mkdirSync(packDir);
  writeFileSync(join(packDir, 'pack.json'), JSON.stringify({ packId: 'x', version: '1' }));
  writeFileSync(
    manifestPath,
    JSON.stringify({
      scenarioId: 'TMP-LIVE',
      title: 'live credential check',
      mode: 'LIVE',
      globalInputPack: { packId: 'x', version: '1', path: './pack' },
      localInputPack: { packId: 'x', version: '1', path: './pack' },
      boundaries: [{ seam: 'atlas.flight_adapter', mode: 'LIVE' }],
      requiredEnv: ['ATLAS_CLIENT_ID', 'ATLAS_CLIENT_SECRET'],
      requiredProviders: ['atlas'],
      expect: {},
      routeParams: [],
      steps: [
        {
          id: 'noop_observe',
          action: { type: 'observe', path: '/health', expectStatus: 200 },
        },
      ],
    }),
  );
  const report = runPreflight({
    manifestPath,
    evidenceDir: join(dir, 'out'),
    recordingsDir: join(dir, 'rec'),
    env: {},
    config: {
      environment: 'local',
      logLevel: 'info',
      adapterMode: 'LIVE',
      httpPort: 8787,
      sqlitePath: ':memory:',
      recordingsDir: join(dir, 'rec'),
      fixturesDir: 'fixtures',
      providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
    },
  });
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((c) => c.id === 'provider:atlas' && !c.ok));
});

test('acceptance: runner executes S1 simulated ingress + observe via HTTP', async () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), 'accept-s1-'));
  const result = await runAcceptanceManifest({
    manifestPath: join(MANIFESTS_ROOT, 's1-airline-schedule-change.json'),
    evidenceDir,
    skipPreflight: true,
    config: {
      environment: 'local',
      logLevel: 'info',
      adapterMode: 'REPLAY',
      httpPort: 0,
      sqlitePath: ':memory:',
      recordingsDir: mkdtempSync(join(tmpdir(), 'accept-s1-rec-')),
      fixturesDir: resolve('fixtures'),
      providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
    },
  });
  assert.equal(result.evidence.ok, true, result.evidence.error);
  assert.equal(result.evidence.scenarioId, 'S1');
  assert.ok(result.evidence.simulatedSeams.length >= 1);
  assert.ok(result.evidence.canonicalIds.caseIds.length >= 1);
  assert.ok(existsSync(result.evidencePath));
  const parsed = ScenarioEvidenceSchema.parse(JSON.parse(readFileSync(result.evidencePath, 'utf8')));
  assert.equal(parsed.schemaVersion, 1);
  assert.ok(parsed.inputProvenance.some((p) => p.simulatedExternal));
});

test('acceptance: runner executes S3 organiser preview/commit ui_actions', async () => {
  const evidenceDir = mkdtempSync(join(tmpdir(), 'accept-s3-'));
  const result = await runAcceptanceManifest({
    manifestPath: join(MANIFESTS_ROOT, 's3-organiser-preview.json'),
    evidenceDir,
    skipPreflight: true,
    config: {
      environment: 'local',
      logLevel: 'info',
      adapterMode: 'REPLAY',
      httpPort: 0,
      sqlitePath: ':memory:',
      recordingsDir: mkdtempSync(join(tmpdir(), 'accept-s3-rec-')),
      fixturesDir: resolve('fixtures'),
      providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
    },
  });
  assert.equal(result.evidence.ok, true, result.evidence.error);
  assert.ok(result.evidence.steps.some((s) => s.actionType === 'ui_action'));
});

test('acceptance: new manifest runs without source modifications', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'accept-ext-'));
  const packDir = join(dir, 'pack');
  mkdirSync(packDir);
  writeFileSync(join(packDir, 'pack.json'), JSON.stringify({ packId: 'ext', version: '1.0.0' }));
  // Point global pack at real programme so hashes resolve when preflight is used.
  const globalPack = resolve('fixtures/acceptance/packs/global');
  const manifestPath = join(dir, 'ext-manifest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      scenarioId: 'EXT-NEW-MANIFEST',
      title: 'Extensibility proof — observe health only',
      mode: 'REPLAY',
      globalInputPack: { packId: 'northstar-global-programme', version: '1.0.0', path: globalPack },
      localInputPack: { packId: 'ext', version: '1.0.0', path: './pack' },
      boundaries: [{ seam: 'http.health', mode: 'REPLAY' }],
      requiredEnv: [],
      requiredProviders: [],
      expect: { anchorEventIds: [], travellerIds: [], tripIds: [] },
      routeParams: [],
      steps: [
        {
          id: 'reset',
          action: {
            type: 'http',
            method: 'POST',
            path: '/api/runtime/reset',
            body: { at: '2026-09-01T00:00:00+00:00' },
            expectStatus: 200,
          },
        },
        {
          id: 'health',
          action: { type: 'observe', path: '/health', expectStatus: 200 },
        },
      ],
    }),
  );

  const evidenceDir = join(dir, 'evidence');
  const result = await runAcceptanceManifest({
    manifestPath,
    evidenceDir,
    skipPreflight: true,
    config: {
      environment: 'local',
      logLevel: 'info',
      adapterMode: 'REPLAY',
      httpPort: 0,
      sqlitePath: ':memory:',
      recordingsDir: join(dir, 'rec'),
      fixturesDir: resolve('fixtures'),
      providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {}, nuitee: {} },
    },
  });
  assert.equal(result.evidence.ok, true, result.evidence.error);
  assert.equal(result.evidence.scenarioId, 'EXT-NEW-MANIFEST');
  assert.equal(result.evidence.steps.length, 2);
});

test('sanitize: redacts secrets and PII while preserving provider shape', () => {
  const raw = {
    orderNo: 'ORD-1',
    contact: { email: 'person@example.com', phone: '+1-555-0100' },
    cardNumber: '4111111111111111',
    nested: { apiKey: 'super-secret-token-value' },
  };
  const cleaned = sanitizeRaw(raw, ['super-secret-token-value']) as typeof raw;
  assert.equal(cleaned.orderNo, 'ORD-1');
  assert.equal(cleaned.contact.email, REDACTED);
  assert.equal(cleaned.cardNumber, REDACTED);
  assert.equal(cleaned.nested.apiKey, REDACTED);
  assert.equal(containsUnsafeMaterial(cleaned, ['super-secret-token-value']), false);
});

test('RECORD: provider-shaped recording is sanitized and REPLAY-consumable', async () => {
  const writeDir = mkdtempSync(join(tmpdir(), 'accept-record-'));
  const store = new FileRecordingStore({ readDirs: [writeDir], writeDir });
  const secret = 'live-client-secret-xyz';
  const rawPayload = {
    status: 0,
    orderNo: 'SBX-1',
    passengerEmail: 'agent@vendor.test',
    token: secret,
  };

  const recorded: ProviderAdapter<{ q: string }, typeof rawPayload, { orderNo: string }> = {
    providerId: 'test-provider',
    mode: 'RECORD',
    async obtainRaw() {
      return rawPayload;
    },
    normalize(raw) {
      return { orderNo: String((raw as { orderNo: string }).orderNo) };
    },
  };

  const recordResult = await runAdapter(recorded, store, { q: 'SIN' }, { operation: 'search', secrets: [secret] });
  assert.equal(recordResult.ok, true);
  if (!recordResult.ok) return;
  assert.ok(recordResult.meta.recordingId);

  const recordingPath = join(writeDir, 'test-provider', 'search', `${recordResult.meta.recordingId}.json`);
  assert.ok(existsSync(recordingPath));
  const onDisk = JSON.parse(readFileSync(recordingPath, 'utf8')) as {
    sanitized: boolean;
    raw: Record<string, unknown>;
  };
  assert.equal(onDisk.sanitized, true);
  assert.equal(containsUnsafeMaterial(onDisk.raw, [secret]), false);
  assert.equal(onDisk.raw['token'], REDACTED);
  assert.equal(onDisk.raw['passengerEmail'], REDACTED);

  const replay: ProviderAdapter<{ q: string }, typeof rawPayload, { orderNo: string }> = {
    providerId: 'test-provider',
    mode: 'REPLAY',
    async obtainRaw() {
      throw new Error('REPLAY must not call obtainRaw');
    },
    normalize(raw) {
      return { orderNo: String((raw as { orderNo: string }).orderNo) };
    },
  };
  const replayResult = await runAdapter(replay, store, { q: 'SIN' }, { operation: 'search' });
  assert.equal(replayResult.ok, true);
  if (!replayResult.ok) return;
  assert.equal(replayResult.data.orderNo, 'SBX-1');
  assert.equal(replayResult.meta.mode, 'REPLAY');
});
