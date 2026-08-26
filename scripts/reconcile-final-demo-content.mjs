/**
 * Reconcile fixtures/programmes/ait-summit-2026/programme.json
 * to docs/FINAL_DEMO_CONTENT_SSOT.md. Content-only; no src/** edits.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const PROGRAMME = path.join(ROOT, 'fixtures/programmes/ait-summit-2026/programme.json');

const OBS = '2026-08-26T12:00:00+00:00';
const SRC = 'src-syn-ait-event';

function timed(value) {
  return { value, sourceId: SRC, authority: 'AUTHORITATIVE', observedAt: OBS };
}

function flightLeg({ origin, dest, dep, arr, flight, pnr, flex = 'CHANGEABLE' }) {
  return {
    itemKind: 'TRANSPORT_LEG',
    mode: 'FLIGHT',
    originRef: { system: 'airport-code', value: origin },
    destinationRef: { system: 'airport-code', value: dest },
    scheduledDeparture: dep,
    scheduledArrival: arr,
    carrierRef: { system: 'flight-number', value: flight },
    bookingRef: { system: 'pnr', reference: pnr },
    flexibility: flex,
    reservationState: 'CONFIRMED',
  };
}

function stay({ placeId, checkIn, checkOut }) {
  return {
    itemKind: 'STAY',
    stayPlaceRef: { system: 'place-id', value: placeId },
    checkIn,
    checkOut,
    reservationState: 'CONFIRMED',
  };
}

/** Corridor templates keyed by origin IATA — provider-backed where evidence exists. */
const CORRIDORS = {
  LAX: {
    legs: (pnr) => [
      flightLeg({
        origin: 'LAX',
        dest: 'NRT',
        dep: '2026-09-28T10:55:00-07:00',
        arr: '2026-09-29T14:10:00+09:00',
        flight: 'ZG023',
        pnr,
      }),
      flightLeg({
        origin: 'NRT',
        dest: 'SIN',
        dep: '2026-09-29T16:50:00+09:00',
        arr: '2026-09-29T23:00:00+08:00',
        flight: 'ZG053',
        pnr,
      }),
    ],
  },
  CGK: {
    legs: (pnr) => [
      flightLeg({
        origin: 'CGK',
        dest: 'SIN',
        dep: '2026-09-30T05:15:00+07:00',
        arr: '2026-09-30T07:25:00+08:00',
        flight: 'MN310',
        pnr,
      }),
    ],
  },
  HND: {
    legs: (pnr) => [
      flightLeg({
        origin: 'HND',
        dest: 'SIN',
        dep: '2026-09-29T02:20:00+09:00',
        arr: '2026-09-29T08:20:00+08:00',
        flight: 'TR883',
        pnr,
      }),
    ],
  },
  NRT: {
    legs: (pnr) => [
      flightLeg({
        origin: 'NRT',
        dest: 'SIN',
        dep: '2026-09-29T16:50:00+09:00',
        arr: '2026-09-29T23:00:00+08:00',
        flight: 'ZG053',
        pnr,
      }),
    ],
  },
  KUL: {
    legs: (pnr) => [
      flightLeg({
        origin: 'KUL',
        dest: 'SIN',
        dep: '2026-09-30T08:10:00+08:00',
        arr: '2026-09-30T09:05:00+08:00',
        flight: 'MN228',
        pnr,
      }),
    ],
  },
  CNX: {
    legs: (pnr) => [
      flightLeg({
        origin: 'CNX',
        dest: 'SIN',
        dep: '2026-09-29T13:30:00+07:00',
        arr: '2026-09-29T16:30:00+08:00',
        flight: 'MN235',
        pnr,
      }),
    ],
  },
  BKK: {
    legs: (pnr) => [
      flightLeg({
        origin: 'BKK',
        dest: 'SIN',
        dep: '2026-09-29T10:55:00+07:00',
        arr: '2026-09-29T14:25:00+08:00',
        flight: 'TR625',
        pnr,
      }),
    ],
  },
  MNL: {
    legs: (pnr) => [
      flightLeg({
        origin: 'MNL',
        dest: 'SIN',
        dep: '2026-09-29T13:15:00+08:00',
        arr: '2026-09-29T20:00:00+08:00',
        flight: 'AK583',
        pnr,
      }),
    ],
  },
  HKG: {
    legs: (pnr) => [
      flightLeg({
        origin: 'HKG',
        dest: 'SIN',
        dep: '2026-09-29T11:55:00+08:00',
        arr: '2026-09-30T07:15:00+08:00',
        flight: 'AK139',
        pnr,
      }),
    ],
  },
  SYD: {
    legs: (pnr) => [
      flightLeg({
        origin: 'SYD',
        dest: 'SIN',
        dep: '2026-09-28T13:00:00+10:00',
        arr: '2026-09-28T19:30:00+08:00',
        flight: 'TR011',
        pnr,
      }),
    ],
  },
  ICN: {
    legs: (pnr) => [
      flightLeg({
        origin: 'ICN',
        dest: 'SIN',
        dep: '2026-09-29T23:40:00+09:00',
        arr: '2026-09-30T04:55:00+08:00',
        flight: 'MN258',
        pnr,
      }),
    ],
  },
  SGN: {
    legs: (pnr) => [
      flightLeg({
        origin: 'SGN',
        dest: 'SIN',
        dep: '2026-09-29T07:10:00+07:00',
        arr: '2026-09-29T10:15:00+08:00',
        flight: 'VJ813',
        pnr,
      }),
    ],
  },
  DEL: {
    legs: (pnr) => [
      flightLeg({
        origin: 'DEL',
        dest: 'SIN',
        dep: '2026-09-29T22:10:00+05:30',
        arr: '2026-09-30T06:05:00+08:00',
        flight: 'MN260',
        pnr,
      }),
    ],
  },
  BOM: {
    legs: (pnr) => [
      flightLeg({
        origin: 'BOM',
        dest: 'SIN',
        dep: '2026-09-29T23:15:00+05:30',
        arr: '2026-09-30T07:20:00+08:00',
        flight: 'MN262',
        pnr,
      }),
    ],
  },
  LHR: {
    legs: (pnr) => [
      flightLeg({
        origin: 'LHR',
        dest: 'SIN',
        dep: '2026-09-29T10:15:00+01:00',
        arr: '2026-09-30T06:25:00+08:00',
        flight: 'MN245',
        pnr,
      }),
      flightLeg({
        origin: 'SIN',
        dest: 'LHR',
        dep: '2026-10-02T23:55:00+08:00',
        arr: '2026-10-03T06:40:00+01:00',
        flight: 'MN244',
        pnr,
      }),
    ],
  },
  AMS: {
    legs: (pnr) => [
      flightLeg({
        origin: 'AMS',
        dest: 'SIN',
        dep: '2026-09-29T12:00:00+02:00',
        arr: '2026-09-30T06:35:00+08:00',
        flight: 'MN241',
        pnr,
      }),
      flightLeg({
        origin: 'SIN',
        dest: 'AMS',
        dep: '2026-10-02T23:30:00+08:00',
        arr: '2026-10-03T06:20:00+02:00',
        flight: 'MN240',
        pnr,
      }),
    ],
  },
  FRA: {
    legs: (pnr) => [
      flightLeg({
        origin: 'FRA',
        dest: 'SIN',
        dep: '2026-09-29T11:40:00+02:00',
        arr: '2026-09-30T06:10:00+08:00',
        flight: 'MN243',
        pnr,
      }),
      flightLeg({
        origin: 'SIN',
        dest: 'FRA',
        dep: '2026-10-02T23:10:00+08:00',
        arr: '2026-10-03T06:05:00+02:00',
        flight: 'MN242',
        pnr,
      }),
    ],
  },
  CDG: {
    legs: (pnr) => [
      flightLeg({
        origin: 'CDG',
        dest: 'SIN',
        dep: '2026-09-29T11:00:00+02:00',
        arr: '2026-09-30T05:55:00+08:00',
        flight: 'MN247',
        pnr,
      }),
    ],
  },
  MAD: {
    legs: (pnr) => [
      flightLeg({
        origin: 'MAD',
        dest: 'SIN',
        dep: '2026-09-29T10:30:00+02:00',
        arr: '2026-09-30T06:40:00+08:00',
        flight: 'MN249',
        pnr,
      }),
    ],
  },
  AKL: {
    legs: (pnr) => [
      flightLeg({
        origin: 'AKL',
        dest: 'SIN',
        dep: '2026-09-28T23:55:00+12:00',
        arr: '2026-09-29T06:10:00+08:00',
        flight: 'MN255',
        pnr,
      }),
    ],
  },
};

function originFromTraveller(t) {
  const legs = (t.declaredTravel || []).filter((x) => x.itemKind === 'TRANSPORT_LEG');
  const inbound = legs.find((l) => l.destinationRef?.value === 'SIN') || legs[0];
  if (inbound?.originRef?.value) return inbound.originRef.value;
  const home = t.homeLocationText || '';
  const m = home.match(/\(([A-Z]{3})\)/);
  if (m) return m[1];
  const map = {
    Jakarta: 'CGK',
    Tokyo: 'HND',
    Manila: 'MNL',
    'Hong Kong': 'HKG',
    London: 'LHR',
    'Kuala Lumpur': 'KUL',
    Paris: 'CDG',
    Seoul: 'ICN',
    Delhi: 'DEL',
    Mumbai: 'BOM',
    'Ho Chi Minh': 'SGN',
    Madrid: 'MAD',
    Auckland: 'AKL',
    Amsterdam: 'AMS',
    Frankfurt: 'FRA',
    Bangkok: 'BKK',
    'Chiang Mai': 'CNX',
    Sydney: 'SYD',
    'Los Angeles': 'LAX',
  };
  for (const [k, v] of Object.entries(map)) if (home.includes(k)) return v;
  return null;
}

function pnrFor(draftId, origin) {
  const n = draftId.replace('ait-draft-', '');
  const prefix =
    origin === 'LAX' ? 'ZG' : origin === 'HND' || origin === 'NRT' ? 'TR' : origin === 'BKK' || origin === 'SYD' || origin === 'SGN' ? 'TR' : origin === 'MNL' || origin === 'HKG' ? 'AK' : 'MN';
  return `${prefix}SYN${n}`;
}

function hotelFor(draftId) {
  // Overflow cohort: roughly every third managed traveller
  const n = Number(draftId.replace('ait-draft-', ''));
  if ([31, 35, 38, 9, 14].includes(n)) return 'place-hotel-bayview'; // heroes + hospitality contact on primary
  return n % 3 === 0 ? 'place-hotel-harbourline' : 'place-hotel-bayview';
}

function stayWindow(draftId) {
  if (draftId === 'ait-draft-09') {
    return {
      checkIn: '2026-09-30T15:00:00+08:00',
      checkOut: '2026-10-03T11:00:00+08:00',
    };
  }
  return {
    checkIn: '2026-09-29T15:00:00+08:00',
    checkOut: '2026-10-03T11:00:00+08:00',
  };
}

const prog = JSON.parse(fs.readFileSync(PROGRAMME, 'utf8'));

// --- Places: real hotel names + nuitee refs ---
for (const pl of prog.context.places) {
  if (pl.id === 'place-hotel-bayview') {
    pl.name = 'Concorde Hotel Singapore';
    pl.coordinates = { latitude: 1.300679, longitude: 103.84206 };
    pl.externalRefs = [{ system: 'nuitee-hotel-id', value: 'lp21d9f' }];
  }
  if (pl.id === 'place-hotel-harbourline') {
    pl.name = 'Hotel Grand Pacific';
    pl.coordinates = { latitude: 1.297349, longitude: 103.852837 };
    pl.externalRefs = [{ system: 'nuitee-hotel-id', value: 'lp1e850' }];
  }
}

// --- Commitment timing moves ---
const cmts = prog.context.anchorEvent.commitments;
function findCmt(id) {
  const c = cmts.find((x) => x.id === id);
  if (!c) throw new Error(`missing commitment ${id}`);
  return c;
}

{
  const finals = findCmt('cmt-ait-d0-hackathon-finals');
  finals.title = 'Bootcamp - Agentic Travel Hackathon Finals Showcase (Opening Cocktails)';
  finals.startsAt = timed('2026-09-30T20:45:00+08:00');
  finals.endsAt = timed('2026-09-30T21:05:00+08:00');
  finals.placeId = 'place-panpacific';

  const seedup = findCmt('cmt-ait-d0-seedup-showcase');
  seedup.startsAt = timed('2026-09-30T15:10:00+08:00');
  seedup.endsAt = timed('2026-09-30T15:50:00+08:00');

  const fireside = findCmt('cmt-ait-d1-recovery-fireside');
  fireside.startsAt = timed('2026-10-01T14:30:00+08:00');
  fireside.endsAt = timed('2026-10-01T14:50:00+08:00');

  const search = findCmt('cmt-ait-d1-search-chat');
  search.startsAt = timed('2026-10-01T15:30:00+08:00');
  search.endsAt = timed('2026-10-01T15:50:00+08:00');
}

// --- Travellers ---
const travellers = prog.importDraft.travellers;

for (const id of ['ait-draft-01', 'ait-draft-02', 'ait-draft-05']) {
  const t = travellers.find((x) => x.draftId === id);
  if (!t) throw new Error(`missing ${id}`);
  t.travelArrangement = 'SELF_OR_OTHER_ARRANGED';
  t.declaredTravel = [];
  if (id === 'ait-draft-02') {
    t.notes = [
      ...(t.notes || []).filter((n) => !/Northstar|arranged travel/i.test(n)),
      'Local co-host; self-arranged. S3 programme-side swap / CHANGEABLE afternoon partner.',
    ];
  }
}

// Rewrite 65/66/67 into managed internationals
const rewrites = {
  'ait-draft-65': {
    displayName: 'Maya Krishnan',
    identity: { email: 'maya.krishnan@lotusfare.test', lastName: 'Krishnan' },
    homeLocationText: 'Bangkok (BKK)',
    nationalityCodes: ['TH'],
    notes: ['Product lead, LotusFare; Day-2 indie spotlight panellist; BKK origin Scoot cohort'],
    origin: 'BKK',
  },
  'ait-draft-66': {
    displayName: 'Tom Hughes',
    identity: { email: 'tom.hughes@reefpay.test', lastName: 'Hughes' },
    homeLocationText: 'Sydney (SYD)',
    nationalityCodes: ['AU'],
    notes: ['Partnerships, ReefPay; closing debate panellist; SYD origin Scoot cohort'],
    origin: 'SYD',
  },
  'ait-draft-67': {
    displayName: 'Lea Dubois',
    identity: { email: 'lea.dubois@meridianventures.test', lastName: 'Dubois' },
    homeLocationText: 'Hong Kong (HKG)',
    nationalityCodes: ['FR'],
    notes: ['Investor, Meridian Ventures; closing debate panellist; HKG origin'],
    origin: 'HKG',
  },
};

for (const [id, spec] of Object.entries(rewrites)) {
  const t = travellers.find((x) => x.draftId === id);
  if (!t) throw new Error(`missing ${id}`);
  t.displayName = spec.displayName;
  t.identity = spec.identity;
  t.homeLocationText = spec.homeLocationText;
  t.nationalityCodes = spec.nationalityCodes;
  t.notes = spec.notes;
  t.travelArrangement = 'NORTHSTAR_ARRANGED';
  // Keep existing commitments if any; ensure at least closing-debate style if empty
  if (!t.anchorCommitmentIds?.length) {
    t.anchorCommitmentIds = ['cmt-ait-d2-closing-debate'];
    t.engagementImportance = [
      {
        commitmentId: 'cmt-ait-d2-closing-debate',
        role: 'PANELLIST',
        importance: 'PREFERRED',
        flexibility: 'CHANGEABLE',
      },
    ];
  }
}

// Jordan: no morning lab engagement (S2 overnight lane); finals + awards only
{
  const jordan = travellers.find((x) => x.draftId === 'ait-draft-09');
  if (jordan) {
    jordan.anchorCommitmentIds = ['cmt-ait-d0-hackathon-finals', 'cmt-ait-d2-hack-awards'];
    jordan.engagementImportance = [
      {
        commitmentId: 'cmt-ait-d0-hackathon-finals',
        role: 'FINALIST',
        importance: 'REQUIRED',
        flexibility: 'FIXED',
      },
      {
        commitmentId: 'cmt-ait-d2-hack-awards',
        role: 'FINALIST',
        importance: 'REQUIRED',
        flexibility: 'FIXED',
      },
    ];
    jordan.notes = [
      'Hackathon finalist (Team Waypoint); LAX ZIPAIR connection hero (S2); overnight NRT recovery may miss morning lab — evening finals 20:45 remain required; awards 2 Oct',
    ];
  }
}

// Jonas notes + Sarah stay
{
  const jonas = travellers.find((x) => x.draftId === 'ait-draft-35');
  if (jonas) {
    jonas.notes = [
      'Recovery-platform founder; Day 1 fireside 14:30 (S5); Concorde stay; Sunday extension is traveller-funded',
    ];
  }
  const sarah = travellers.find((x) => x.draftId === 'ait-draft-14');
  if (sarah) {
    sarah.notes = [
      'Headline interview speaker, Day 1 09:20 — S1 critical; S3 reschedule target 15:30',
    ];
  }
}

// Assign declared travel for all NORTHSTAR_ARRANGED
let managed = 0;
let withFlights = 0;
let withStays = 0;
for (const t of travellers) {
  if (t.travelArrangement !== 'NORTHSTAR_ARRANGED') continue;
  managed++;
  const origin = originFromTraveller(t);
  if (!origin || origin === 'SIN') {
    throw new Error(`${t.draftId} managed but origin=${origin}`);
  }
  const corridor = CORRIDORS[origin];
  if (!corridor) throw new Error(`No corridor template for ${origin} (${t.draftId})`);
  const pnr = pnrFor(t.draftId, origin);
  const placeId = hotelFor(t.draftId);
  const sw = stayWindow(t.draftId);

  // Preserve hero-specific multi-leg if already richer and matching origin
  const existingLegs = (t.declaredTravel || []).filter((x) => x.itemKind === 'TRANSPORT_LEG');
  let legs = corridor.legs(pnr);
  if (t.draftId === 'ait-draft-09') {
    legs = CORRIDORS.LAX.legs('ZGSYN09');
  }
  if (t.draftId === 'ait-draft-38' && existingLegs.length >= 2) {
    legs = existingLegs.map((l) => ({
      ...l,
      bookingRef: l.bookingRef || { system: 'pnr', reference: pnr },
    }));
  }
  if (t.draftId === 'ait-draft-35' && existingLegs.length >= 2) {
    legs = existingLegs.map((l) => ({
      ...l,
      bookingRef: l.bookingRef || { system: 'pnr', reference: pnr },
    }));
  }

  t.declaredTravel = [...legs, stay({ placeId, ...sw })];
  withFlights++;
  withStays++;
}

const self = travellers.filter((t) => t.travelArrangement !== 'NORTHSTAR_ARRANGED').length;
console.log(
  JSON.stringify(
    {
      total: travellers.length,
      managed,
      self,
      withFlights,
      withStays,
      finals: findCmt('cmt-ait-d0-hackathon-finals').startsAt.value,
      fireside: findCmt('cmt-ait-d1-recovery-fireside').startsAt.value,
      search: findCmt('cmt-ait-d1-search-chat').startsAt.value,
      bayview: prog.context.places.find((p) => p.id === 'place-hotel-bayview').name,
    },
    null,
    2,
  ),
);

fs.writeFileSync(PROGRAMME, JSON.stringify(prog, null, 2) + '\n');
console.log('Wrote', PROGRAMME);
