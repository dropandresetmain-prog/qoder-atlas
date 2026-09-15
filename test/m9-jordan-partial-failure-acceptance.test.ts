/**
 * Jordan fixture-backed multi-stay partial-failure acceptance.
 *
 * Booking identities come from docs/work/WIT_JORDAN_CONCORDE_CAPTURE_REPORT.md
 * (committed Nuitée sandbox RECORD). Application logic stays generic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { capabilityError, capabilityOk, type CapabilityMeta, type CapabilityResult } from '../src/contracts/envelope.ts';
import type {
  CapabilityDescriptor,
  HotelActionOutcome,
  HotelActionQuery,
  HotelBookQuery,
  HotelBookingOutcome,
  HotelBookingStatusView,
  HotelCapability,
  HotelQuoteOutcome,
  HotelQuoteQuery,
  HotelRetrieveQuery,
  HotelSearchOutcome,
  HotelSearchQuery,
  StayContext,
  StayContextQuery,
} from '../src/contracts/capabilities.ts';
import type { ActionIntent, AuthorisedExecution, AuthorityDecision, ExecutionResult } from '../src/operational/intent.ts';
import type { ExecutorService } from '../src/contracts/services.ts';
import type { Money } from '../src/domain/common.ts';
import {
  createProviderBackedExecutor,
  type HotelReplacementDossier,
} from '../src/app/providerExecution.ts';
import {
  deriveDuplicateBookingExposure,
  derivePartialRecovery,
} from '../src/app/target/readmodels/recoveryActionProjection.ts';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';
import type { RecoveryActionFact } from '../src/app/target/readmodels/types.ts';

const AT = '2026-09-29T18:00:00+09:00';
const CAPTURE = join(process.cwd(), 'docs/work/WIT_JORDAN_CONCORDE_CAPTURE_REPORT.md');
const NUITE_DIR = join(process.cwd(), 'fixtures/recordings/nuitee');

function meta(mode: 'LIVE' | 'REPLAY' = 'REPLAY'): CapabilityMeta {
  return { providerId: 'nuitee', mode, requestedAt: AT };
}

function ok<T>(data: T): CapabilityResult<T> {
  return capabilityOk(data, meta('REPLAY'));
}

function capabilityErr<T>(code: string): CapabilityResult<T> {
  return capabilityError({ category: 'PROVIDER_ERROR', code, message: `structured failure ${code}` }, meta('REPLAY'));
}

function captureBookings(): {
  displacedBookingId: string;
  replacementBookingId: string;
  displacedCost: Money;
  replacementCost: Money;
} {
  const text = readFileSync(CAPTURE, 'utf8');
  const displaced = /"bookingId":\s*"(O6vdr7G2T)"/.exec(text)?.[1];
  const replacement = /"bookingId":\s*"(vW4k_j-53)"/.exec(text)?.[1];
  assert.ok(displaced, 'capture report lists baseline Concorde bookingId');
  assert.ok(replacement, 'capture report lists recovered Concorde bookingId');
  return {
    displacedBookingId: displaced,
    replacementBookingId: replacement,
    displacedCost: { currency: 'USD', amount: 743.74 },
    replacementCost: { currency: 'USD', amount: 576.75 },
  };
}

interface FakeHotelScript {
  quote?: CapabilityResult<HotelQuoteOutcome>;
  book?: CapabilityResult<HotelBookingOutcome>;
  retrieve?: Array<CapabilityResult<HotelBookingStatusView>>;
  cancel?: CapabilityResult<HotelActionOutcome>;
}

function fakeHotel(script: FakeHotelScript) {
  const calls = { quote: 0, book: 0, retrieve: 0, cancel: 0 };
  const hotel: HotelCapability = {
    descriptor: {
      family: 'HOTEL',
      providerId: 'nuitee',
      mode: 'REPLAY',
      supportedOperations: ['hotel.quote', 'hotel.book', 'hotel.retrieve', 'hotel.cancel'],
      maxSideEffectLevel: 'MONEY_MOVING',
    } as CapabilityDescriptor,
    async getStayContext(_q: StayContextQuery): Promise<CapabilityResult<StayContext>> {
      return capabilityErr('not_used');
    },
    async searchHotels(_q: HotelSearchQuery): Promise<CapabilityResult<HotelSearchOutcome>> {
      return capabilityErr('not_used');
    },
    async quoteRate(_q: HotelQuoteQuery): Promise<CapabilityResult<HotelQuoteOutcome>> {
      calls.quote += 1;
      return script.quote ?? capabilityErr('hotel_quote_unscripted');
    },
    async bookStay(_q: HotelBookQuery): Promise<CapabilityResult<HotelBookingOutcome>> {
      calls.book += 1;
      return script.book ?? capabilityErr('hotel_book_unscripted');
    },
    async modifyStay(_q: HotelActionQuery): Promise<CapabilityResult<HotelActionOutcome>> {
      return capabilityErr('hotel_modify_unused');
    },
    async retrieveBooking(_q: HotelRetrieveQuery): Promise<CapabilityResult<HotelBookingStatusView>> {
      const index = calls.retrieve;
      calls.retrieve += 1;
      const sequence = script.retrieve ?? [];
      return sequence[Math.min(index, sequence.length - 1)] ?? capabilityErr('hotel_retrieve_unscripted');
    },
    async cancelStay(_q: HotelActionQuery): Promise<CapabilityResult<HotelActionOutcome>> {
      calls.cancel += 1;
      return script.cancel ?? capabilityErr('hotel_cancel_unscripted');
    },
  };
  return { hotel, calls };
}

function authorityFor(intent: ActionIntent): AuthorityDecision {
  return {
    id: `auth_${intent.id}`,
    intentId: intent.id,
    outcome: 'AUTO_APPROVED',
    decidedAt: AT,
    ruleTrace: [],
    conditions: [],
  };
}

function envelope(intent: ActionIntent): AuthorisedExecution {
  return { intent, authority: authorityFor(intent) };
}

function recordingFallback(): { executor: ExecutorService } {
  return {
    executor: {
      async execute(execution: AuthorisedExecution): Promise<ExecutionResult> {
        return {
          id: `exec_fallback_${execution.intent.id}`,
          intentId: execution.intent.id,
          executedAt: AT,
          status: 'FAILURE',
          provenance: 'REPLAY',
          error: { code: 'fallback', message: 'unused' },
        };
      },
    },
  };
}

function withFrozenCeiling(inner: ExecutorService, ceiling: Money | undefined): ExecutorService {
  return {
    execute: (execution: AuthorisedExecution) =>
      inner.execute({
        ...execution,
        intent: ceiling
          ? { ...execution.intent, spendExposure: ceiling }
          : (() => {
              const intent: Record<string, unknown> = { ...execution.intent };
              delete intent['spendExposure'];
              return intent as unknown as ActionIntent;
            })(),
      }),
  };
}

function hotelIntent(): ActionIntent {
  return {
    id: 'int_jordan_concorde_replace',
    caseId: 'case-jordan-partial',
    strategyId: 'strat_jordan_multi_stay',
    operation: 'hotel.modify',
    capability: 'HOTEL',
    parameters: {},
    sideEffectLevel: 'MONEY_MOVING',
    priceDelta: { currency: 'USD', amount: 576.75 },
    spendExposure: { currency: 'USD', amount: 576.75 },
    evidenceRefs: [],
    status: 'AUTHORISED',
    createdAt: AT,
  };
}

test('Jordan fixture: committed Concorde Nuitée RECORD artifacts are present', () => {
  const bookings = captureBookings();
  const required = [
    'search/rec_4c1b376be4f1c0863cb0a2f425c1c485.json',
    'search/rec_dd9573dc25c6f872bb575d455bb8846f.json',
    'quote/rec_4cc6b77d64b00d2cc20aaac3d2b1860f.json',
    'quote/rec_77f3614418b8cabb5d89924a000a6bf8.json',
    'book/rec_8b55a4d7eedd8b54491f969796d0c166.json',
    'book/rec_cb93729e167c584d3fa8fa2bfe61c984.json',
    'retrieve/rec_cfa220ae62a7446e0e6d18d0e579d114.json',
    'retrieve/rec_aa8a09b95dda04bf95653b3bf8dbba26.json',
    'cancel/rec_46a614b7fa4632f500a92d655d7d0ab7.json',
    'cancel/rec_5676fcdd134f0c0c1e6a6fb775b812cd.json',
  ];
  for (const rel of required) {
    assert.ok(existsSync(join(NUITE_DIR, rel)), `missing ${rel}`);
  }
  assert.equal(bookings.displacedBookingId, 'O6vdr7G2T');
  assert.equal(bookings.replacementBookingId, 'vW4k_j-53');
});

test('Jordan fixture: replacement CONFIRMED + cancel FAILED → duplicate exposure, unresolved', async () => {
  const bookings = captureBookings();
  const dossier: HotelReplacementDossier = {
    replacementRateId: 'fixture-rate',
    guestNames: ['Traveller'],
    displacedBookingId: bookings.displacedBookingId,
  };
  const { hotel, calls } = fakeHotel({
    quote: ok({ status: 'QUOTED', quoteId: '-lnkAlDVD', quotedPrice: bookings.replacementCost }),
    book: ok({
      confirmed: true,
      bookingId: bookings.replacementBookingId,
      totalPrice: bookings.replacementCost,
      provenance: 'REPLAY',
    }),
    retrieve: [
      ok({ bookingId: bookings.replacementBookingId, status: 'CONFIRMED' }),
      ok({
        bookingId: bookings.displacedBookingId,
        status: 'CONFIRMED',
        cancellationFee: bookings.displacedCost,
      }),
    ],
    cancel: ok({ confirmed: false, provenance: 'REPLAY' }),
  });
  const executor = withFrozenCeiling(
    createProviderBackedExecutor({
      fallback: recordingFallback().executor,
      mode: 'REPLAY',
      hotel,
      hotelDossier: () => dossier,
      now: () => AT,
    }),
    { currency: 'USD', amount: 600 },
  );
  const result = await executor.execute(envelope(hotelIntent()));
  assert.equal(result.status, 'FAILURE');
  assert.equal(result.error?.code, 'displaced_stay_not_cancelled');
  assert.equal(calls.cancel, 1);
  const effects = result.observedEffects as Record<string, unknown>;
  assert.equal(effects['duplicateBookingExposure'], true);
  assert.equal((effects['replacementBooking'] as { bookingId: string }).bookingId, bookings.replacementBookingId);
  assert.equal((effects['displacedBooking'] as { bookingId: string }).bookingId, bookings.displacedBookingId);

  const actions: RecoveryActionFact[] = [
    {
      actionRef: 'book-replacement',
      domain: 'stay',
      capability: 'hotel.book',
      subjectRefs: [`booking:${bookings.replacementBookingId}`],
      cost: { amount: String(bookings.replacementCost.amount), currency: 'USD' },
      authorityState: 'granted',
      dependencyOrder: 0,
      executionState: 'COMPLETED',
      observationResult: 'CONFIRMED',
    },
    {
      actionRef: 'cancel-displaced',
      domain: 'stay',
      capability: 'hotel.cancel',
      subjectRefs: [`booking:${bookings.displacedBookingId}`],
      cost: { amount: String(bookings.displacedCost.amount), currency: 'USD' },
      authorityState: 'granted',
      dependencyOrder: 1,
      dependsOnActionRefs: ['book-replacement'],
      executionState: 'FAILED',
      observationResult: 'FAILED',
    },
  ];
  assert.deepEqual(derivePartialRecovery(actions).succeeded, ['book-replacement']);
  assert.deepEqual(derivePartialRecovery(actions).failed, ['cancel-displaced']);
  assert.ok(deriveDuplicateBookingExposure(actions).length >= 1);
  const view = projectRecoveryCase({
    generatedAt: AT,
    projectionRevision: 1,
    changedVisibleRefs: actions.map((a) => a.actionRef),
    currentSemanticState: 'AFFECTED',
    nodes: [],
    edges: [],
    caseRef: 'case-jordan-partial',
    status: 'EXECUTING',
    changeSummary: 'destination stay cancel failed after replacement confirmed',
    bookingServiceState: { label: 'Stays', state: 'AFFECTED' },
    tripViability: { label: 'Whole-trip', verdict: 'FAIL' },
    strategies: [],
    authorityState: 'recorded',
    executionState: 'partial',
    reconciliationState: 'reconciling',
    recoveryActions: actions,
    uncertainty: ['duplicate booking exposure'],
  });
  assert.equal(view.status, 'EXECUTING');
  assert.ok(view.duplicateBookingExposure.length >= 1);
  assert.ok(view.partialRecovery);
});

test('Jordan fixture: cancel observed CANCELLED → SUCCESS', async () => {
  const bookings = captureBookings();
  const dossier: HotelReplacementDossier = {
    replacementRateId: 'fixture-rate',
    guestNames: ['Traveller'],
    displacedBookingId: bookings.displacedBookingId,
  };
  const { hotel, calls } = fakeHotel({
    quote: ok({ status: 'QUOTED', quoteId: '-lnkAlDVD', quotedPrice: bookings.replacementCost }),
    book: ok({
      confirmed: true,
      bookingId: bookings.replacementBookingId,
      totalPrice: bookings.replacementCost,
      provenance: 'REPLAY',
    }),
    retrieve: [
      ok({ bookingId: bookings.replacementBookingId, status: 'CONFIRMED' }),
      ok({
        bookingId: bookings.displacedBookingId,
        status: 'CANCELLED',
        cancellationFee: bookings.displacedCost,
      }),
    ],
    cancel: ok({ confirmed: true, reference: bookings.displacedBookingId, provenance: 'REPLAY' }),
  });
  const executor = withFrozenCeiling(
    createProviderBackedExecutor({
      fallback: recordingFallback().executor,
      mode: 'REPLAY',
      hotel,
      hotelDossier: () => dossier,
      now: () => AT,
    }),
    { currency: 'USD', amount: 600 },
  );
  const result = await executor.execute(envelope(hotelIntent()));
  assert.equal(result.status, 'SUCCESS');
  assert.equal(calls.cancel, 1);
  const effects = result.observedEffects as Record<string, unknown>;
  assert.equal((effects['replacementBooking'] as { status: string }).status, 'CONFIRMED');
  assert.equal((effects['displacedBooking'] as { status: string }).status, 'CANCELLED');
});
