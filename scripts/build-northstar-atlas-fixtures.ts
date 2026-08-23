/**
 * Generates sanitized, deterministic test-local Atlas recording fixtures used
 * by test/northstar-atlas-replay.test.ts.
 *
 * Run: `node --experimental-strip-types scripts/build-northstar-atlas-fixtures.ts`
 * Idempotent: writes the same bytes every time.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { recordingIdFor } from '../src/providers/recordingStore.ts';

const OFFER_ID = 'opaque-routing-identifier-001';
const SEARCH = {
  origin: { system: 'IATA', value: 'MNL' },
  destination: { system: 'IATA', value: 'CEB' },
  departureDate: '2026-09-05',
  passengers: { adults: 1 },
};

const searchId = recordingIdFor('atlas', 'search', SEARCH);
const verifyId = recordingIdFor('atlas', 'verify', { offerId: OFFER_ID });
const fareId = recordingIdFor('atlas', 'fare_rules', { offerId: OFFER_ID });

const RECORDED_AT = '2026-08-23T00:00:00.000Z';

const searchRaw = {
  status: 0,
  msg: null,
  routings: [
    {
      routingIdentifier: OFFER_ID,
      fid: 'synthetic-fid-search',
      currency: 'USD',
      adultPrice: 100,
      adultTax: 20,
      childPrice: 80,
      childTax: 16,
      infantPrice: 10,
      infantTax: 0,
      expireTime: '2026-08-24T00:00:00Z',
      refreshTime: '2026-08-23T00:00:00Z',
      fromSegments: [
        {
          carrier: 'XX',
          operatingCarrier: 'XX',
          flightNumber: 'XX101',
          depAirport: 'MNL',
          arrAirport: 'CEB',
          depTime: '202609052000',
          arrTime: '202609052130',
          duration: 90,
          cabin: '',
          cabinClass: 1,
          fareFamily: 'Cheapest',
          seatCount: 9,
          segmentIndex: 1,
        },
      ],
      retSegments: [],
      riskSellout: false,
      rule: {
        changesRules: [
          {
            changesFee: 0,
            changesStatus: 'T',
            currency: 'USD',
            revNoshow: 'T',
            revNoshowFee: 0,
            ruleDetailList: [
              { amount: 0, currency: 'USD', status: 'T', startMinute: 0, endMinute: -525600 },
            ],
          },
        ],
        refundRules: [
          {
            refundFee: 0,
            refundStatus: 'T',
            refundMethod: null,
            currency: 'USD',
            refNoshow: 'T',
            refNoshowFee: 0,
            ruleDetailList: [
              { amount: 0, currency: 'USD', status: 'T', startMinute: 0, endMinute: -525600 },
            ],
          },
        ],
        baggageElements: [
          { baggagePiece: 1, baggageWeight: 7, baggageSize: '56*36*23cm', baggageType: 'CabinBaggageOverheadLocker', passengerType: 0, segmentNo: 1 },
        ],
        hasBaggage: 1,
      },
    },
  ],
};

const verifyRaw = {
  status: 0,
  msg: 'success',
  sessionId: 'synthetic-session-id',
  maxSeats: 9,
  priceChange: {
    isPriceChange: false,
    newAdultPrice: 100,
    newAdultTax: 20,
    newChildPrice: 80,
    newChildTax: 16,
    newInfantPrice: 10,
    newInfantTax: 0,
    originalAdultPrice: 100,
    originalAdultTax: 20,
    originalChildPrice: 80,
    originalChildTax: 16,
    originalInfantPrice: 10,
    originalInfantTax: 0,
  },
  bookingRequirement: {
    passenger: {
      name: { required: true, type: 'string' },
      birthday: { required: true, type: 'string' },
      nationality: { required: true, type: 'string' },
    },
  },
  routing: searchRaw.routings[0],
};

const fareRaw = verifyRaw;

function writeRecording(relativePath: string, id: string, operation: string, raw: unknown): void {
  const path = join('test', 'fixtures', 'recordings', relativePath);
  mkdirSync(dirname(path), { recursive: true });
  const recording = {
    id,
    providerId: 'atlas',
    operation,
    recordedAt: RECORDED_AT,
    sanitized: true as const,
    raw,
  };
  writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`, 'utf8');
  process.stdout.write(`wrote ${path} (id=${id})\n`);
}

writeRecording(`atlas/search/${searchId}.json`, searchId, 'search', searchRaw);
writeRecording(`atlas/verify/${verifyId}.json`, verifyId, 'verify', verifyRaw);
writeRecording(`atlas/fare_rules/${fareId}.json`, fareId, 'fare_rules', fareRaw);
