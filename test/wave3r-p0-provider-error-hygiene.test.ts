/**
 * Wave 3R Mission 2 / Phase 0 — P0.3 provider error hygiene.
 *
 * Permanently pins the contract: raw provider HTTP body text and free-text
 * `msg` fields NEVER persist into RecoveryCase errors or audit state. Provider
 * failures surface as provider id + category + structured code + bounded
 * summary + retryability only.
 *
 * The tests feed a hostile provider error echoing PII and credentials through
 * the REAL Atlas transaction adapter (LIVE seam, stubbed fetch), the composed
 * provider-backed executor, and the full RecoveryExecutionService — then
 * assert the persisted case and audit projections are clean.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDatabase } from '../src/persistence/database.ts';
import { SqliteAuditRepository, SqliteCaseRepository, SqliteSignalRepository, SqliteTripRepository } from '../src/persistence/repositories.ts';
import { SqliteEntityStore } from '../src/persistence/entityStore.ts';
import { SqlMutationService } from '../src/engine/mutation.ts';
import { CaseService } from '../src/engine/case.ts';
import { CaseVerifier, DeterministicObservationService } from '../src/engine/observation.ts';
import {
  RecoveryExecutionService,
  type RecoveryExecutionDependencies,
} from '../src/app/recoveryExecution.ts';
import { createProviderBackedExecutor, type FlightBookingDossier } from '../src/app/providerExecution.ts';
import { AtlasFlightTransactionAdapter } from '../src/providers/atlas/transactionAdapter.ts';
import { FileRecordingStore } from '../src/providers/recordingStore.ts';
import { capabilityOk, type CapabilityResult } from '../src/contracts/envelope.ts';
import type {
  CapabilityDescriptor,
  FareRulesOutcome,
  FlightCapability,
  FlightSearchOutcome,
  FlightSearchQuery,
  FlightVerifyOutcome,
  FlightVerifyQuery,
} from '../src/contracts/capabilities.ts';
import type { ActionIntent, AuthorisedExecution, AuthorityDecision } from '../src/operational/intent.ts';
import type { ExecutorService } from '../src/contracts/services.ts';

const AT = '2026-09-12T19:00:00+09:00';

// Fake PII / credentials a hostile provider might echo back in an error.
const FAKE_PASSPORT = 'E12345678';
const FAKE_CARD = '4111111111111111';
const FAKE_SECRET = 'sk-live-atlas-9f3e2d1c';
const HOSTILE_MSG =
  `booking failed for traveller passport ${FAKE_PASSPORT} card ${FAKE_CARD}; ` +
  `check credentials ${FAKE_SECRET} and retry`;
const SECRETS = [FAKE_PASSPORT, FAKE_CARD, FAKE_SECRET];

function hostileAdapter(fetchImpl: typeof fetch): AtlasFlightTransactionAdapter {
  const writeDir = mkdtempSync(join(tmpdir(), 'atlas-p03-'));
  return new AtlasFlightTransactionAdapter({
    mode: 'LIVE',
    store: new FileRecordingStore({ readDirs: [writeDir], writeDir }),
    baseUrl: 'https://sandbox.atriptech.com',
    clientId: 'cid',
    clientSecret: 'csecret',
    fetchImpl,
  });
}

function verifyCapability(): FlightCapability {
  const descriptor: CapabilityDescriptor = {
    family: 'FLIGHT',
    providerId: 'atlas',
    mode: 'LIVE',
    supportedOperations: ['flight.search', 'flight.verify', 'flight.fare_rules'],
    maxSideEffectLevel: 'READ_ONLY',
  };
  return {
    descriptor,
    async searchFlights(_q: FlightSearchQuery): Promise<CapabilityResult<FlightSearchOutcome>> {
      throw new Error('unused');
    },
    async verifyOffer(_q: FlightVerifyQuery): Promise<CapabilityResult<FlightVerifyOutcome>> {
      return capabilityOk(
        { status: 'VERIFIED', workflowState: { sessionId: 'sess-p03' } },
        { providerId: 'atlas', mode: 'LIVE', requestedAt: AT },
      );
    },
    async getFareRules(_q: FlightVerifyQuery): Promise<CapabilityResult<FareRulesOutcome>> {
      throw new Error('unused');
    },
  };
}

const DOSSIER: FlightBookingDossier = {
  passengers: [{ givenName: 'Test', familyName: 'Traveller', dateOfBirth: '1990-01-01', gender: 'FEMALE' }],
  contact: { name: 'Traveller/Test' },
  paymentRef: 'atlas-sandbox-balance',
};

function fallbackExecutor(): ExecutorService {
  return {
    execute: async (execution: AuthorisedExecution) => ({
      id: `exec-${execution.intent.id}`,
      intentId: execution.intent.id,
      executedAt: AT,
      status: 'SUCCESS',
      provenance: 'SIMULATED',
    }),
  };
}

test('P0.3-1: hostile non-zero provider status never reaches persisted case/audit state', async () => {
  const transactions = hostileAdapter(async () =>
    new Response(JSON.stringify({ status: 5, msg: HOSTILE_MSG }), { status: 200 }),
  );
  const executor = createProviderBackedExecutor({
    fallback: fallbackExecutor(),
    mode: 'LIVE',
    flight: verifyCapability(),
    flightTransactions: transactions,
    flightDossier: () => DOSSIER,
    ticketingPoll: { attempts: 1, delayMs: 1 },
    sleep: async () => undefined,
    now: () => AT,
  });

  // Full application persistence: case + audit are the projections under test.
  const db = openDatabase(':memory:');
  const harness = {
    trips: new SqliteTripRepository(db),
    cases: new SqliteCaseRepository(db),
    signals: new SqliteSignalRepository(db),
    audit: new SqliteAuditRepository(db),
    entities: new SqliteEntityStore(db),
  };
  const mutations = new SqlMutationService({ db, trips: harness.trips, entities: harness.entities });
  const deps: RecoveryExecutionDependencies = {
    cases: harness.cases,
    audit: harness.audit,
    authority: { decide: async () => ({ id: 'auth_p03', intentId: 'int_p03', outcome: 'AUTO_APPROVED', decidedAt: AT, ruleTrace: [], conditions: [] }) },
    executor,
    observation: new DeterministicObservationService({ mutations }),
    verifier: new CaseVerifier({ trips: harness.trips, signals: harness.signals, entities: harness.entities }),
    trips: harness.trips,
    entities: harness.entities,
  };
  const service = new RecoveryExecutionService(deps);

  const caseService = new CaseService({ cases: harness.cases });
  await caseService.open({ id: 'case_p03', tripId: 'trip_p03', openedAt: AT });
  await caseService.transition('case_p03', 'ASSESSING', AT);
  await caseService.transition('case_p03', 'PLANNING', AT);
  await caseService.transition('case_p03', 'READY_TO_EXECUTE', AT);

  const intent: ActionIntent = {
    id: 'int_p03',
    caseId: 'case_p03',
    operation: 'flight.change',
    capability: 'FLIGHT',
    parameters: { bookingRefs: [{ system: 'flight-provider', reference: 'offer-p03' }] },
    sideEffectLevel: 'MONEY_MOVING',
    spendExposure: { currency: 'USD', amount: 250 },
    evidenceRefs: [],
    status: 'AUTHORISED',
    createdAt: AT,
  };
  const authority: AuthorityDecision = {
    id: 'auth_p03',
    intentId: 'int_p03',
    outcome: 'AUTO_APPROVED',
    decidedAt: AT,
    ruleTrace: [],
    conditions: [],
  };

  const executed = await service.executeEnvelope({ intent, authority }, 'trip_p03', AT);
  assert.equal(executed.executed, true);
  assert.ok(executed.result, 'provider failure is honest execution evidence');
  assert.equal(executed.result.status, 'FAILURE');
  assert.equal(executed.result.providerId, 'atlas');
  // Structured triage data survives (the adapter's provider status code in
  // the outcome detail); the free-text msg does not.
  assert.equal(executed.result.error?.code, 'order_create_refused');
  assert.match(executed.result.error?.message ?? '', /provider status 5/);
  for (const secret of SECRETS) {
    assert.ok(!JSON.stringify(executed.result).includes(secret), `execution result must not echo ${secret}`);
  }

  // Persisted projections: case executionResults + the audit chain.
  const recoveryCase = (await harness.cases.getCase('case_p03'))!;
  assert.equal(recoveryCase.executionResults.length, 1);
  const caseProjection = JSON.stringify(recoveryCase);
  for (const secret of SECRETS) {
    assert.ok(!caseProjection.includes(secret), `persisted case state must not carry ${secret}`);
  }
  const auditEntries = await harness.audit.query({ subject: 'trip_p03' });
  assert.ok(auditEntries.length > 0);
  const auditProjection = JSON.stringify(auditEntries);
  for (const secret of SECRETS) {
    assert.ok(!auditProjection.includes(secret), `audit projection must not carry ${secret}`);
  }
  db.close();
});

test('P0.3-2: HTTP error bodies are never echoed into capability errors', async () => {
  const transactions = hostileAdapter(async () =>
    new Response(JSON.stringify({ status: 5, msg: HOSTILE_MSG }), { status: 422 }),
  );
  const result = await transactions.quoteCancellation({ orderRef: 'ord-p03', clientReference: 'int_p03' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.category, 'INVALID_REQUEST');
    assert.equal(result.error.code, 'atlas_http_422');
    for (const secret of SECRETS) {
      assert.ok(!result.error.message.includes(secret), `HTTP error must not echo ${secret}`);
    }
    assert.match(result.error.message, /HTTP 422/);
  }
});

test('P0.3-3: failed-order outcome detail carries the provider status, never its free text', async () => {
  const transactions = hostileAdapter(async () =>
    new Response(JSON.stringify({ status: 5, msg: HOSTILE_MSG, orderNo: null }), { status: 200 }),
  );
  const result = await transactions.createOrder({
    offerId: 'offer-p03',
    passengers: DOSSIER.passengers,
    contact: DOSSIER.contact,
    workflowState: { sessionId: 'sess-p03' },
    clientReference: 'int_p03',
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.status, 'FAILED');
    assert.match(result.data.detail ?? '', /provider status 5/);
    for (const secret of SECRETS) {
      assert.ok(!(result.data.detail ?? '').includes(secret), `outcome detail must not echo ${secret}`);
    }
  }
});
