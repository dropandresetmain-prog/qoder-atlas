/**
 * Generates the curated Atlas REPLAY recordings used by the deterministic
 * Scenario A demo loop (fixtures only — application code never sees these
 * facts). Recording ids are computed with the same recordingIdFor() the
 * REPLAY runner uses, so replay resolution is exact.
 *
 * The recorded requests mirror what the planning loop dispatches:
 * - search: the full FlightSearchQuery for the disrupted leg's route/date;
 * - verify / fare_rules: exactly `{ offerId }` (adapter recording shape).
 *
 * Schedule strings are Atlas airport-local `YYYYMMDDHHmm`; the shared
 * normalizer converts them with the application-supplied timezone resolver
 * (ADR-028). The recordings live with the scenario fixture bundle so the
 * curated Lane C evidence set under fixtures/recordings stays untouched.
 * Run: node scripts/generate-atlas-replay-recordings.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FlightSearchQuery } from '../src/contracts/capabilities.ts';
import { recordingIdFor } from '../src/providers/recordingStore.ts';

const ROOT = resolve('fixtures/scenarios/anchor-event-speaker/recordings/atlas');
const RECORDED_AT = '2026-09-12T18:30:00.000+09:00';

// Generic request shape for the disrupted outbound leg (ICN -> NRT 2026-09-13).
const searchQuery: FlightSearchQuery = {
  origin: { system: 'iata', value: 'ICN' },
  destination: { system: 'iata', value: 'NRT' },
  departureDate: '2026-09-13',
  passengers: { adults: 1 },
};

const changeAllowed = {
  changesRules: [{ changesFee: 50, changesStatus: 'T', currency: 'USD' }],
  refundRules: [{ refundFee: 90, refundStatus: 'F', currency: 'USD' }],
};

// Three replacement routings; prices are per-adult fare + tax components.
const morningCheap = {
  routingIdentifier: 'ATLSBX-20260914-KE711-E7',
  currency: 'USD',
  adultPrice: 128,
  adultTax: 34.1,
  fromSegments: [
    {
      carrier: 'KE',
      flightNumber: '711',
      depAirport: 'ICN',
      arrAirport: 'NRT',
      depTime: '202609140905',
      arrTime: '202609141135',
      duration: 150,
      cabinClass: 1,
      fareFamily: 'ECON_SAVER',
      seatCount: 7,
    },
  ],
  retSegments: [],
  rule: changeAllowed,
};

const eveningFeasible = {
  routingIdentifier: 'ATLSBX-20260913-OZ104-E3',
  currency: 'USD',
  adultPrice: 210,
  adultTax: 32.6,
  fromSegments: [
    {
      carrier: 'OZ',
      flightNumber: '104',
      depAirport: 'ICN',
      arrAirport: 'NRT',
      depTime: '202609131825',
      arrTime: '202609132055',
      duration: 150,
      cabinClass: 1,
      fareFamily: 'ECON_FLEX',
      seatCount: 5,
    },
  ],
  retSegments: [],
  rule: changeAllowed,
};

const afternoonFeasible = {
  routingIdentifier: 'ATLSBX-20260913-KE705-B1',
  currency: 'USD',
  adultPrice: 375,
  adultTax: 41.9,
  fromSegments: [
    {
      carrier: 'KE',
      flightNumber: '705',
      depAirport: 'ICN',
      arrAirport: 'NRT',
      depTime: '202609131405',
      arrTime: '202609131640',
      duration: 155,
      cabinClass: 1,
      fareFamily: 'ECON_STANDARD',
      seatCount: 9,
    },
  ],
  retSegments: [],
  rule: changeAllowed,
};

const searchBody = {
  status: 0,
  msg: null,
  routings: [morningCheap, eveningFeasible, afternoonFeasible],
};

// Verify + fare_rules share the verify.do body; the verified offer is the
// feasible evening routing (no price change -> VERIFIED).
const verifyBody = {
  status: 0,
  msg: null,
  sessionId: 'atlsbx-sess-i3demo-0001',
  routing: eveningFeasible,
};

function writeRecording(operation: string, request: unknown, raw: unknown): string {
  const id = recordingIdFor('atlas', operation, request);
  const recording = {
    id,
    providerId: 'atlas',
    operation,
    recordedAt: RECORDED_AT,
    sanitized: true,
    raw,
  };
  const dir = join(ROOT, operation);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(recording, null, 2)}\n`, 'utf8');
  return `${operation}/${id}`;
}

const written = [
  writeRecording('search', searchQuery, searchBody),
  writeRecording('verify', { offerId: eveningFeasible.routingIdentifier }, verifyBody),
  writeRecording('fare_rules', { offerId: eveningFeasible.routingIdentifier }, verifyBody),
];
process.stdout.write(`${written.join('\n')}\n`);
