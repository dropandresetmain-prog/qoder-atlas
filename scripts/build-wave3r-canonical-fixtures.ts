/**
 * Generates sanitized, deterministic test-local Atlas recording fixtures for
 * the Wave 3R canonical programme (evt-w3-demo) Tier-A flows. Same discipline
 * as build-northstar-convergence-fixtures.ts: synthetic corridors only, no
 * real city/airline content, identical bytes on every run.
 *
 * Corridors (all destination SYN, the canonical event gateway):
 *  - NRT/LHR/JFK/LAX/CDG -> SYN on 2026-09-06: initial planning for the five
 *    Tier-A travellers AND recovery re-search evidence (the deterministic
 *    fallback planner re-searches a failed leg's own route and date).
 *  - LHR -> SYN on 2026-09-07: window-shift evidence for an arriveBy target
 *    on 2026-09-07 (S4-class request).
 *  - HND -> SYN on 2026-09-06: origin-substitution evidence for a declared
 *    departure-gateway change (S7-class request).
 *
 * Run: `node --experimental-strip-types scripts/build-wave3r-canonical-fixtures.ts`
 * Idempotent: writes the same bytes every time.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordingIdFor } from '../src/providers/recordingStore.ts';

const RECORDED_AT = '2026-08-25T00:00:00.000Z';
const OUT_DIR = 'test/fixtures/recordings';

interface CorridorSpec {
  origin: string;
  destination: string;
  /** Atlas airport-local wall-clock schedule strings (YYYYMMDDHHmm). */
  depTime: string;
  arrTime: string;
  departureDate: string;
  /** Stable label used for synthetic flight identifiers. */
  label: string;
  /** Synthetic adult fare (USD); per-corridor variety, no market meaning. */
  adultPrice: number;
}

/** Synthetic direct routing for one corridor/date. */
function searchRaw(spec: CorridorSpec) {
  const offerId = `opaque-routing-canonical-${spec.label}`;
  return {
    status: 0,
    msg: null,
    routings: [
      {
        routingIdentifier: offerId,
        fid: `synthetic-fid-${spec.label}`,
        currency: 'USD',
        adultPrice: spec.adultPrice,
        adultTax: 25,
        childPrice: 110,
        childTax: 20,
        infantPrice: 12,
        infantTax: 0,
        expireTime: '2026-09-30T00:00:00Z',
        refreshTime: RECORDED_AT,
        fromSegments: [
          {
            carrier: 'XX',
            operatingCarrier: 'XX',
            flightNumber: `XX9${spec.label.replaceAll('-', '')}`,
            depAirport: spec.origin,
            arrAirport: spec.destination,
            depTime: spec.depTime,
            arrTime: spec.arrTime,
            duration: 720,
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

function searchQuery(origin: string, destination: string, departureDate: string) {
  return {
    origin: { system: 'airport-code', value: origin },
    destination: { system: 'airport-code', value: destination },
    departureDate,
    passengers: { adults: 1 },
  };
}

const TIER_A_ORIGINS: Array<{ origin: string; label: string; price: number }> = [
  { origin: 'NRT', label: 'nrt-syn-20260906', price: 140 },
  { origin: 'LHR', label: 'lhr-syn-20260906', price: 155 },
  { origin: 'JFK', label: 'jfk-syn-20260906', price: 170 },
  { origin: 'LAX', label: 'lax-syn-20260906', price: 160 },
  { origin: 'CDG', label: 'cdg-syn-20260906', price: 150 },
];

const fixtures: Fixture[] = [];

// Initial planning (event window opens 2026-09-07; search targets 2026-09-06)
// and recovery re-search for a failed leg on the same route/date. Departure is
// airport-local morning; arrival is the next morning at the event gateway.
for (const entry of TIER_A_ORIGINS) {
  fixtures.push({
    operation: 'search',
    request: searchQuery(entry.origin, 'SYN', '2026-09-06'),
    raw: searchRaw({
      origin: entry.origin,
      destination: 'SYN',
      depTime: '202609061000',
      arrTime: '202609070830',
      departureDate: '2026-09-06',
      label: entry.label,
      adultPrice: entry.price,
    }),
  });
}

// Window-shift evidence: arriveBy on 2026-09-07 re-searches the corridor for
// that departure date; arrival must precede the requested arriveBy instant.
fixtures.push({
  operation: 'search',
  request: searchQuery('LHR', 'SYN', '2026-09-07'),
  raw: searchRaw({
    origin: 'LHR',
    destination: 'SYN',
    depTime: '202609070100',
    arrTime: '202609071030',
    departureDate: '2026-09-07',
    label: 'lhr-syn-20260907',
    adultPrice: 180,
  }),
});

// Origin-substitution evidence: a declared departure-gateway change re-plans
// the arrival corridor from the new gateway on the leg's current date.
fixtures.push({
  operation: 'search',
  request: searchQuery('HND', 'SYN', '2026-09-06'),
  raw: searchRaw({
    origin: 'HND',
    destination: 'SYN',
    depTime: '202609061100',
    arrTime: '202609070900',
    departureDate: '2026-09-06',
    label: 'hnd-syn-20260906',
    adultPrice: 145,
  }),
});

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
