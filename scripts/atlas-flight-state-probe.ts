/**
 * S1 setup — bounded READ-ONLY probe of the Atlas incident/reconciliation
 * surface (`POST /event/getPageList.do`) through the SAME adapter path the
 * application uses (AtlasFlightStateReader, LIVE mode, no writeDir: nothing
 * is persisted by the probe itself).
 *
 * Purpose: truthful evidence of what the sandbox incident surface returns
 * for the AiT S1 booking references BEFORE the S1 RECORD run, so provider
 * limitations are known and recorded honestly.
 *
 * Usage: node --experimental-strip-types scripts/atlas-flight-state-probe.ts [orderRef ...]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config/config.ts';
import { sanitizeRaw } from '../src/providers/sanitize.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import { isAtlasSandboxBaseUrl } from '../src/providers/atlas/transactionAdapter.ts';
import { AtlasFlightStateReader } from '../src/providers/atlas/stateReader.ts';

const DEFAULT_REFS = ['MNSYN10', 'MNSYN11', 'MNSYN13', 'MNSYN14', 'MNSYN15', 'MNSYN30'];

async function main(): Promise<void> {
  const refs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_REFS;

  const config = loadConfig();
  const { baseUrl, clientId, clientSecret } = config.providers.atlas;
  if (!baseUrl || !clientId || !clientSecret) throw new Error('Atlas credentials ABSENT — probe refused');
  if (!isAtlasSandboxBaseUrl(baseUrl)) throw new Error('Atlas base URL is NOT the sandbox host — probe refused');

  // LIVE mode with a read-only store: observe only, persist nothing here.
  const store = new FileRecordingStore({ readDirs: ['fixtures/recordings'] });
  const reader = new AtlasFlightStateReader({
    mode: 'LIVE',
    store,
    baseUrl,
    clientId,
    clientSecret,
    timeoutMs: 60_000,
  });

  const secrets = [clientId, clientSecret];
  const results: Array<{ orderReference: string; at: string; ok: boolean; detail: unknown }> = [];
  for (const orderReference of refs) {
    const at = new Date().toISOString();
    const read = await reader.readFlightStates({ orderReference });
    const detail = read.ok
      ? { stateCount: read.data.states.length, states: read.data.states, meta: read.meta }
      : { error: read.error, meta: read.meta };
    results.push({ orderReference, at, ok: read.ok, detail: sanitizeRaw(detail, secrets) });
    process.stdout.write(
      `${orderReference}: ${read.ok ? `ok states=${read.data.states.length}` : `error ${read.error.category}/${read.error.code}`}\n`,
    );
  }

  mkdirSync(resolve('output'), { recursive: true });
  const report = sanitizeRaw(
    {
      probe: 'atlas-flight-state-readonly',
      generatedAt: new Date().toISOString(),
      host: new URL(baseUrl).hostname,
      operation: 'flight_state_query',
      endpoint: 'POST /event/getPageList.do',
      orderReferences: refs,
      results,
    },
    secrets,
  );
  writeFileSync(resolve('output/atlas-flight-state-probe.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write('REPORT: output/atlas-flight-state-probe.json\n');
}

main().catch((error) => {
  process.stderr.write(`PROBE FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
