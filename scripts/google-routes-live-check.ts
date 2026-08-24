/**
 * Wave 3R Mission 3 §6 — Google Routes bounded LIVE check.
 *
 * One bounded route-context call through the EXISTING application adapter
 * (GoogleRoutesAdapter, RECORD mode — the same normalization/recording path
 * REPLAY consumes). Supporting context, not an NS-G3R blocker: a structured
 * failure is recorded honestly and never treated as mission failure.
 *
 * Credentials come from config and are never printed. Evidence is sanitized:
 * normalized RouteContext + capability meta only (no raw payloads, no keys).
 *
 * Run: node --experimental-strip-types scripts/google-routes-live-check.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config/config.ts';
import { GoogleRoutesAdapter } from '../src/providers/googleRoutes/adapter.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const apiKey = config.providers.googleRoutes.apiKey;
  if (!apiKey) throw new Error('GOOGLE_ROUTES_API_KEY ABSENT — refusing LIVE check');

  // Same store topology as the LIVE validation harness: recordings land in
  // the app-owned recordings/ store, never the curated fixtures corpus.
  const store = new FileRecordingStore({
    readDirs: ['fixtures/recordings', 'recordings'],
    writeDir: 'recordings',
  });
  const adapter = new GoogleRoutesAdapter({ mode: 'RECORD', store, apiKey });

  // One bounded synthetic query (airport -> city centre), coordinates only.
  const result = await adapter.getRouteContext({
    origin: { coordinates: { latitude: 1.3644, longitude: 103.9915 } },
    destination: { coordinates: { latitude: 1.2834, longitude: 103.8604 } },
    mode: 'DRIVE',
  });

  const evidence = {
    probe: 'wave3r-mission3-google-routes-live',
    generatedAt: new Date().toISOString(),
    provider: 'google-routes',
    mode: 'RECORD',
    bounded: 'single route-context call; supporting context, not a blocker',
    result: result.ok
      ? {
          ok: true,
          routeContext: result.data,
          meta: { providerId: result.meta.providerId, mode: result.meta.mode },
        }
      : {
          ok: false,
          error: { category: result.error.category, code: result.error.code },
          meta: { providerId: result.meta.providerId, mode: result.meta.mode },
        },
  };

  mkdirSync(resolve('output'), { recursive: true });
  writeFileSync(
    resolve('output/wave3r-mission3-google-routes-live.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write('EVIDENCE WRITTEN output/wave3r-mission3-google-routes-live.json\n');
}

main().catch((error) => {
  process.stderr.write(`GOOGLE ROUTES LIVE CHECK FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
