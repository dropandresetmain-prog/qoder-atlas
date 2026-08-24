/**
 * Wave 3R Mission 3 §7 — flight-event ingress full chain over the REAL
 * public boundary.
 *
 * Chain proven: POST /api/events/atlas -> raw inbox persistence -> dedupe ->
 * Atlas normalization -> ASSERTED signal (ADR-044 ceiling) -> correlation ->
 * impact/recovery (case + strategies) — never a direct processDisruption
 * shortcut.
 *
 * Source labelling (honest): Atlas cannot generate a callback on demand in
 * this sandbox, so the delivery is a provider-shaped SIMULATED SOURCE EVENT
 * posted through the real ingress — NOT a genuine webhook delivery.
 *
 * Run: node --experimental-strip-types scripts/wave3r-flight-ingress-live.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import { AppConfigSchema } from '../src/config/config.ts';
import { createAppServer } from '../src/server/http.ts';
import { composeAppRuntime } from '../src/app/compose.ts';

interface EvidenceStep {
  step: string;
  timestamp: string;
  result: Record<string, unknown>;
}

const evidence: EvidenceStep[] = [];

function record(step: string, result: Record<string, unknown>): void {
  evidence.push({ step, timestamp: new Date().toISOString(), result });
  process.stdout.write(`${step}: ${JSON.stringify(result)}\n`);
}

async function postJson(
  base: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Provider-shaped Atlas event (event/getPageList.do record shape), synthetic identity. */
function atlasEvent(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    eventId: 'evt-m3-ingress-0001',
    orderNo: 'FL-A-1001', // correlates to the seeded scenario trip's bookingRef.reference
    eventType: 'FLIGHT_CANCELLATION',
    eventStatus: 1,
    eventTime: '2026-09-12T06:00:00+00:00',
    createTime: '2026-09-12T06:00:00+00:00',
    airline: 'XX',
    pnr: 'PNR001',
    paxName: 'Test Traveller',
    paxEmail: 'traveller@example.test',
    ...overrides,
  };
}

async function main(): Promise<void> {
  const config = AppConfigSchema.parse({
    environment: 'local',
    adapterMode: 'REPLAY',
    sqlitePath: ':memory:',
    fixturesDir: resolve('fixtures'),
    providers: { atlas: { env: 'sandbox' }, modelStudio: {}, googleRoutes: {} },
  });
  const composed = await composeAppRuntime(config);
  const server = createAppServer(config, composed.endpoints);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const at = '2026-09-12T06:05:00+00:00';

    // 1. Delivery through the real public ingress.
    const first = await postJson(base, `/api/events/atlas?at=${encodeURIComponent(at)}`, atlasEvent());
    if (first.status !== 200 || first.body['status'] !== 'ACCEPTED') {
      throw new Error(`ingress delivery not ACCEPTED: ${first.status} ${JSON.stringify(first.body)}`);
    }
    const results = first.body['results'] as Array<{ tripId: string; caseId: string; caseStatus: string }>;
    record('ingress.delivery_accepted', {
      sourceLabel: 'SIMULATED SOURCE EVENT',
      httpStatus: first.status,
      outcomeStatus: first.body['status'],
      providerEventId: first.body['providerEventId'],
      correlatedTripId: results[0]?.tripId,
      caseId: results[0]?.caseId,
      caseStatus: results[0]?.caseStatus,
    });
    if (!results[0]?.caseId) throw new Error('no recovery case opened from ingress delivery');

    // 2. Raw inbox persistence (persisted BEFORE processing).
    const inboxRows = composed.db
      .prepare('SELECT provider_id, provider_event_id, processed_status FROM provider_event_inbox')
      .all() as Array<{ provider_id: string; provider_event_id: string; processed_status: string }>;
    record('ingress.raw_inbox', {
      rowCount: inboxRows.length,
      providerId: inboxRows[0]?.provider_id,
      providerEventId: inboxRows[0]?.provider_event_id,
      processedStatus: inboxRows[0]?.processed_status,
    });
    if (inboxRows.length !== 1 || inboxRows[0]!.provider_id !== 'atlas') {
      throw new Error('raw inbox persistence broken');
    }

    // 3. ASSERTED ceiling on the unauthenticated delivery channel (ADR-044).
    const recoveryCase = await composed.readDeps.cases.getCase(results[0]!.caseId);
    if (!recoveryCase) throw new Error('case not readable through repository');
    const signal = await composed.readDeps.signals.getSignal(recoveryCase.triggeredBySignalIds[0]!);
    if (!signal) throw new Error('triggering signal not persisted');
    record('ingress.signal_asserted', {
      signalId: signal.id,
      kind: signal.kind,
      authority: signal.authority,
      payloadFields: Object.keys(signal.payload),
    });
    if (signal.authority !== 'ASSERTED') {
      throw new Error(`signal authority must be ASSERTED, got ${signal.authority}`);
    }

    // 4. Impact/recovery: the case is visible through the ordinary projection
    //    with strategies (recovery) attached.
    const caseRes = await fetch(`${base}/api/cases/${results[0]!.caseId}`);
    const caseBody = (await caseRes.json()) as Record<string, unknown>;
    record('ingress.case_projection', {
      httpStatus: caseRes.status,
      tripId: caseBody['tripId'],
      status: caseBody['status'],
      whatChanged: caseBody['whatChanged'],
      optionsCount: Array.isArray(caseBody['options']) ? (caseBody['options'] as unknown[]).length : 0,
      affectedItemsCount: Array.isArray(caseBody['affectedItems']) ? (caseBody['affectedItems'] as unknown[]).length : 0,
    });

    // 5. Dedupe: redelivery of the same providerEventId changes nothing.
    const casesBefore = (composed.db.prepare('SELECT COUNT(*) as n FROM cases').get() as { n: number }).n;
    const second = await postJson(base, `/api/events/atlas?at=${encodeURIComponent(at)}`, atlasEvent());
    const inboxAfter = composed.db.prepare('SELECT COUNT(*) as n FROM provider_event_inbox').get() as { n: number };
    const casesAfter = (composed.db.prepare('SELECT COUNT(*) as n FROM cases').get() as { n: number }).n;
    record('ingress.dedupe_redelivery', {
      httpStatus: second.status,
      outcomeStatus: second.body['status'],
      inboxRowCount: inboxAfter.n,
      casesBefore,
      casesAfter,
    });
    if (second.body['status'] !== 'DUPLICATE' || inboxAfter.n !== 1 || casesAfter !== casesBefore) {
      throw new Error('dedupe broken: redelivery produced duplicate state');
    }

    // 6. Fail-closed boundaries: uncorrelatable order + garbage payload.
    const uncorrelated = await postJson(
      base,
      '/api/events/atlas',
      atlasEvent({ eventId: 'evt-m3-ingress-unknown', orderNo: 'NO-SUCH-ORDER-REF' }),
    );
    record('ingress.correlation_fail_closed', {
      httpStatus: uncorrelated.status,
      outcomeStatus: uncorrelated.body['status'],
    });
    if (uncorrelated.status !== 422 || uncorrelated.body['status'] !== 'CORRELATION_FAILED') {
      throw new Error('uncorrelatable delivery must fail structurally, never guess a trip');
    }

    const garbage = await postJson(base, '/api/events/atlas', { garbage: true });
    record('ingress.invalid_payload_fail_closed', {
      httpStatus: garbage.status,
      outcomeStatus: garbage.body['status'],
      issuesCount: Array.isArray(garbage.body['issues']) ? (garbage.body['issues'] as unknown[]).length : 0,
    });
    if (garbage.status !== 400 || garbage.body['status'] !== 'INVALID_PAYLOAD') {
      throw new Error('garbage payload must fail structurally');
    }

    record('ingress.verdict', { fullChain: 'PASS', sourceLabel: 'SIMULATED SOURCE EVENT' });
  } finally {
    await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
    composed.db.close();
  }

  mkdirSync(resolve('output'), { recursive: true });
  writeFileSync(
    resolve('output/wave3r-mission3-flight-ingress-live.json'),
    `${JSON.stringify(
      {
        probe: 'wave3r-mission3-flight-ingress-live',
        generatedAt: new Date().toISOString(),
        sourceLabel: 'SIMULATED SOURCE EVENT (provider-shaped; Atlas cannot generate a callback on demand)',
        boundary: 'POST /api/events/atlas (real public ingress)',
        steps: evidence,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  process.stdout.write('EVIDENCE WRITTEN output/wave3r-mission3-flight-ingress-live.json\n');
}

main().catch((error) => {
  try {
    mkdirSync(resolve('output'), { recursive: true });
    writeFileSync(
      resolve('output/wave3r-mission3-flight-ingress-live.partial.json'),
      `${JSON.stringify({ probe: 'wave3r-mission3-flight-ingress-live', aborted: String(error), steps: evidence }, null, 2)}\n`,
      'utf8',
    );
  } catch {
    // Evidence persistence must never mask the primary error.
  }
  process.stderr.write(`FLIGHT INGRESS VALIDATION FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
