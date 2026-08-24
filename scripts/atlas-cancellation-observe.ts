/**
 * Mission 3 §4 — bounded READ-ONLY observation of a submitted Atlas
 * cancellation. Polls cancellation status + order state until a final state
 * (CANCELLED / REJECTED) is observed or the window closes; PROCESSING at the
 * end of the window is reported truthfully. Never submits anything.
 *
 * Usage: node --experimental-strip-types scripts/atlas-cancellation-observe.ts <orderRef>
 */
import { loadConfig } from '../src/config/config.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import {
  AtlasFlightTransactionAdapter,
  isAtlasSandboxBaseUrl,
} from '../src/providers/atlas/transactionAdapter.ts';

const MAX_ATTEMPTS = 12;
const DELAY_MS = 10_000;

async function main(): Promise<void> {
  const orderRef = process.argv[2];
  if (!orderRef) throw new Error('usage: atlas-cancellation-observe.ts <orderRef>');

  const config = loadConfig();
  const { baseUrl, clientId, clientSecret } = config.providers.atlas;
  if (!baseUrl || !clientId || !clientSecret) throw new Error('Atlas credentials ABSENT — observation refused');
  if (!isAtlasSandboxBaseUrl(baseUrl)) throw new Error('Atlas base URL is NOT the sandbox host — observation refused');

  // LIVE mode: observe only, persist nothing (no writeDir).
  const store = new FileRecordingStore({ readDirs: ['fixtures/recordings'] });
  const adapter = new AtlasFlightTransactionAdapter({
    mode: 'LIVE',
    store,
    baseUrl,
    clientId,
    clientSecret,
    timeoutMs: 60_000,
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const status = await adapter.retrieveCancellationStatus({ orderRef });
    const order = await adapter.retrieveOrder({ orderRef });
    const summary = {
      attempt,
      cancellation: status.ok
        ? { status: status.data.status, expectedReturn: status.data.expectedReturn, detail: status.data.detail }
        : { error: status.error.code },
      order: order.ok ? { orderStatus: order.data.status } : { error: order.error.code },
    };
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    const final =
      status.ok && (status.data.status === 'CANCELLED' || status.data.status === 'REJECTED');
    if (final) {
      process.stdout.write(`FINAL: ${summary.cancellation.status}\n`);
      return;
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  process.stdout.write('WINDOW CLOSED: cancellation still not final; reported truthfully\n');
  process.exitCode = 2;
}

main().catch((error) => {
  process.stderr.write(`OBSERVATION FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
