/**
 * Mission 3 §2A — bounded sandbox probe: is Atlas voidQuotation.do genuinely
 * read-only (R1's unresolved question)?
 *
 * Protocol (NEVER submits a cancellation):
 *   1. retrieveOrder            — baseline; must be TICKETED
 *   2. quoteCancellation        — first quote
 *   3. retrieveOrder            — must still be TICKETED, unchanged
 *   4. retrieveCancellationStatus — must observe NO cancellation request
 *   5. quoteCancellation        — repeat quote (detects quote-side locking)
 *   6. retrieveOrder            — must still be TICKETED
 *
 * Verdict:
 *   READ_ONLY     — order state unchanged throughout and no cancellation
 *                   request ever appears; repeat quoting does not lock.
 *   SIDE_EFFECTING — any provider-side cancellation state appears, the order
 *                   leaves TICKETED, or repeat quoting is refused because a
 *                   cancellation is "already in progress".
 *
 * Usage: node --experimental-strip-types scripts/atlas-voidquote-readonly-probe.ts <orderRef>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config/config.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import {
  AtlasFlightTransactionAdapter,
  isAtlasSandboxBaseUrl,
} from '../src/providers/atlas/transactionAdapter.ts';

interface ProbeStep {
  step: string;
  timestamp: string;
  result: unknown;
}

async function main(): Promise<void> {
  const orderRef = process.argv[2];
  if (!orderRef) throw new Error('usage: atlas-voidquote-readonly-probe.ts <orderRef>');

  const config = loadConfig();
  const { baseUrl, clientId, clientSecret } = config.providers.atlas;
  if (!baseUrl || !clientId || !clientSecret) throw new Error('Atlas credentials ABSENT — probe refused');
  if (!isAtlasSandboxBaseUrl(baseUrl)) throw new Error('Atlas base URL is NOT the sandbox host — probe refused');

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

  const steps: ProbeStep[] = [];
  const record = (step: string, result: unknown): void => {
    steps.push({ step, timestamp: new Date().toISOString(), result });
    process.stdout.write(`${step}: ${JSON.stringify(result)}\n`);
  };

  // 1. Baseline observation.
  const baseline = await adapter.retrieveOrder({ orderRef });
  record('1_baseline_retrieve', baseline);
  if (!baseline.ok || baseline.data.status !== 'TICKETED') {
    throw new Error(`probe requires a TICKETED order; observed ${baseline.ok ? baseline.data.status : baseline.error.code}`);
  }

  // 2. First cancellation quote.
  const quote1 = await adapter.quoteCancellation({ orderRef });
  record('2_first_quote', quote1);

  // 3. Order state after the quote.
  const afterQuote1 = await adapter.retrieveOrder({ orderRef });
  record('3_retrieve_after_first_quote', afterQuote1);

  // 4. Cancellation-request observation: a read-only quote must NOT create one.
  const cancelStatus = await adapter.retrieveCancellationStatus({ orderRef });
  record('4_cancel_status_after_quote', cancelStatus);

  // 5. Repeat quote: detects whether quoting locks/flags the order.
  const quote2 = await adapter.quoteCancellation({ orderRef });
  record('5_second_quote', quote2);

  // 6. Final order-state observation.
  const afterQuote2 = await adapter.retrieveOrder({ orderRef });
  record('6_retrieve_after_second_quote', afterQuote2);

  // Verdict (deterministic from observations).
  const stateUnchanged =
    afterQuote1.ok && afterQuote1.data.status === 'TICKETED' &&
    afterQuote2.ok && afterQuote2.data.status === 'TICKETED';
  const noCancellationRequest =
    // Fail closed: only a SUCCESSFUL status query observing NO cancellation
    // request (normalized as UNKNOWN) counts as evidence of no side effect.
    cancelStatus.ok && cancelStatus.data.status === 'UNKNOWN';
  const repeatQuoteUnblocked =
    quote2.ok && (quote2.data.availability === 'AVAILABLE' || quote2.data.availability === quoteAvailability(quote1));

  const verdict = stateUnchanged && noCancellationRequest && repeatQuoteUnblocked
    ? 'READ_ONLY'
    : 'SIDE_EFFECTING';

  mkdirSync(resolve('output'), { recursive: true });
  const report = {
    probe: 'atlas-voidQuotation-readonly',
    generatedAt: new Date().toISOString(),
    host: new URL(baseUrl).hostname,
    orderRef,
    verdict,
    criteria: { stateUnchanged, noCancellationRequest, repeatQuoteUnblocked },
    steps,
  };
  writeFileSync(resolve('output/atlas-voidquote-readonly-probe.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`VERDICT: ${verdict}\n`);
  if (verdict !== 'READ_ONLY') process.exitCode = 2;
}

/** Availability of a quote result, for comparison. */
function quoteAvailability(result: { ok: boolean; data?: { availability?: string } }): string | undefined {
  return result.ok ? result.data?.availability : undefined;
}

main().catch((error) => {
  process.stderr.write(`PROBE FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
