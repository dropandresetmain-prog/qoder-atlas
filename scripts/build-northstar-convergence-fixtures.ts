/**
 * Generates sanitized, deterministic test-local Atlas recording fixtures for
 * the NS-G2 convergence paths (0: initial planning, A: window shift, B:
 * provider disruption). Synthetic airport codes HOM/EVT only — no real
 * city/airline content.
 *
 * Run: `node --experimental-strip-types scripts/build-northstar-convergence-fixtures.ts`
 * Idempotent: writes the same bytes every time.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordingIdFor } from '../src/providers/recordingStore.ts';

const RECORDED_AT = '2026-08-23T00:00:00.000Z';
const OUT_DIR = 'test/fixtures/recordings';

/** One synthetic routing: HOM -> EVT departing 20:00 arriving 21:30 local. */
function searchRaw(offerId: string, depTime: string, arrTime: string, dateLabel: string) {
  return {
    status: 0,
    msg: null,
    routings: [
      {
        routingIdentifier: offerId,
        fid: `synthetic-fid-${dateLabel}`,
        currency: 'USD',
        adultPrice: 140,
        adultTax: 25,
        childPrice: 110,
        childTax: 20,
        infantPrice: 12,
        infantTax: 0,
        expireTime: '2026-08-30T00:00:00Z',
        refreshTime: '2026-08-23T00:00:00Z',
        fromSegments: [
          {
            carrier: 'XX',
            operatingCarrier: 'XX',
            flightNumber: `XX2${dateLabel.replaceAll('-', '')}`,
            depAirport: 'HOM',
            arrAirport: 'EVT',
            depTime,
            arrTime,
            duration: 90,
            cabin: '',
            cabinClass: 1,
            fareFamily: 'Synthetic',
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
              ruleDetailList: [{ amount: 0, currency: 'USD', status: 'T', startMinute: 0, endMinute: -525600 }],
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
              ruleDetailList: [{ amount: 0, currency: 'USD', status: 'T', startMinute: 0, endMinute: -525600 }],
            },
          ],
          baggageElements: [],
          hasBaggage: 0,
        },
      },
    ],
  };
}

interface Fixture {
  operation: string;
  request: Record<string, unknown>;
  raw: unknown;
}

// Arrival search on the day before the event window (path 0 + path B re-search).
const ARRIVAL_QUERY = {
  origin: { system: 'airport-code', value: 'HOM' },
  destination: { system: 'airport-code', value: 'EVT' },
  departureDate: '2026-09-06',
  passengers: { adults: 1 },
};
// Window-shift search two days earlier (path A).
const SHIFT_QUERY = {
  origin: { system: 'airport-code', value: 'HOM' },
  destination: { system: 'airport-code', value: 'EVT' },
  departureDate: '2026-09-04',
  passengers: { adults: 1 },
};

const fixtures: Fixture[] = [
  {
    operation: 'search',
    request: ARRIVAL_QUERY,
    raw: searchRaw('opaque-routing-convergence-arrival', '202609062000', '202609062130', '2026-09-06'),
  },
  {
    operation: 'search',
    request: SHIFT_QUERY,
    raw: searchRaw('opaque-routing-convergence-shift', '202609042000', '202609042130', '2026-09-04'),
  },
];

for (const fixture of fixtures) {
  const id = recordingIdFor('atlas', fixture.operation, fixture.request);
  const dir = join(OUT_DIR, 'atlas', fixture.operation);
  mkdirSync(dir, { recursive: true });
  const recording = {
    id,
    providerId: 'atlas',
    operation: fixture.operation,
    recordedAt: RECORDED_AT,
    sanitized: true,
    raw: fixture.raw,
  };
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(recording, null, 2)}\n`);
  console.log(`wrote atlas/${fixture.operation}/${id}.json`);
}
