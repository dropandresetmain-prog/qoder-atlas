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
    // Synthetic Batik geometry (WiT seed). Not Atlas provider-backed.
    // Baseline original: ID7159. S1 pack synthesizes cancel→ID7153 reprotection.
    legs: (pnr) => [
      flightLeg({
        origin: 'CGK',
        dest: 'SIN',
        dep: '2026-09-30T17:45:00+07:00',
        arr: '2026-09-30T20:30:00+08:00',
        flight: 'ID7159',
        pnr,
      }),
    ],
  },
  /** Non-cohort managed CGK travellers (e.g. Nadia): distinct from ID7159 disruption ticket. */
  CGK_NON_COHORT: {
    legs: (pnr) => [
      flightLeg({
        origin: 'CGK',
        dest: 'SIN',
        dep: '2026-09-29T19:30:00+07:00',
        arr: '2026-09-29T22:15:00+08:00',
        flight: 'ID7128',
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
        dep: '2026-09-30T06:10:00+08:00',
        arr: '2026-09-30T07:05:00+08:00',
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

/** Shared 1 Oct ~10:30 SGT arrival — clears afternoon slots (≥13:30) under 150min, fails 11:30. */
const LATE_MORNING_SIN_ARRIVAL = '2026-10-01T10:30:00+08:00';

/** Per-origin same-day inbound using existing MN/TR/AK naming patterns (synthetic). */
const LATE_MORNING_OCT1_BY_ORIGIN = {
  BKK: { flight: 'TR626', dep: '2026-10-01T07:00:00+07:00' },
  AMS: { flight: 'MN239', dep: '2026-10-01T01:20:00+02:00' },
  MAD: { flight: 'MN251', dep: '2026-10-01T00:45:00+02:00' },
  NRT: { flight: 'TR897', dep: '2026-10-01T06:30:00+09:00' },
  LHR: { flight: 'MN237', dep: '2026-10-01T00:05:00+01:00' },
  ICN: { flight: 'MN257', dep: '2026-10-01T06:05:00+09:00' },
  SYD: { flight: 'TR013', dep: '2026-10-01T06:45:00+10:00' },
  BOM: { flight: 'MN263', dep: '2026-10-01T00:30:00+05:30' },
};

function lateMorningOct1Legs(origin, pnr) {
  const spec = LATE_MORNING_OCT1_BY_ORIGIN[origin];
  if (!spec) {
    throw new Error(`No late-morning 1 Oct corridor for origin ${origin}`);
  }
  return [
    flightLeg({
      origin,
      dest: 'SIN',
      dep: spec.dep,
      arr: LATE_MORNING_SIN_ARRIVAL,
      flight: spec.flight,
      pnr,
    }),
  ];
}

/** Managed travellers whose inbound must fail the 11:30 overlay after ID7153-class arrivals. */
const LATE_MORNING_OCT1_DRAFTS = new Set([
  'ait-draft-33', // Aisha — build-interview REQUIRED speaker
  'ait-draft-35', // Jonas — recovery-fireside REQUIRED speaker
  'ait-draft-32', // Carlos — day1-close REQUIRED host
  'ait-draft-37', // David — trust-research REQUIRED speaker (debate-only otherwise)
  'ait-draft-39', // Zara — search-chat REQUIRED speaker (debate-only otherwise)
  'ait-draft-36', // Nina — distribution-debate REQUIRED referee
]);

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
    origin === 'CGK'
      ? 'ID'
      : origin === 'LAX'
      ? 'ZG'
      : origin === 'CGK'
        ? 'ID'
        : origin === 'HND' || origin === 'NRT'
          ? 'TR'
          : origin === 'BKK' || origin === 'SYD' || origin === 'SGN'
            ? 'TR'
            : origin === 'MNL' || origin === 'HKG'
              ? 'AK'
              : 'MN';
  return `${prefix}SYN${n}`;
}

function hotelFor(draftId) {
  // Overflow cohort: roughly every third managed traveller
  const n = Number(draftId.replace('ait-draft-', ''));
  if ([31, 35, 38, 9, 14].includes(n)) return 'place-hotel-bayview'; // heroes + hospitality contact on primary
  return n % 3 === 0 ? 'place-hotel-harbourline' : 'place-hotel-bayview';
}

function stayWindow(draftId) {
  // Jordan baseline destination stay starts on arrival eve (29 Sep); recovered
  // TR885 path shifts usable nights to 30 Sep — consequence must be visible.
  if (draftId === 'ait-draft-09') {
    return {
      checkIn: '2026-09-29T15:00:00+08:00',
      checkOut: '2026-10-03T11:00:00+08:00',
    };
  }
  return {
    checkIn: '2026-09-29T15:00:00+08:00',
    checkOut: '2026-10-03T11:00:00+08:00',
  };
}

const prog = JSON.parse(fs.readFileSync(PROGRAMME, 'utf8'));

// Keep the fixture's embedded policy mirror aligned with the input pack.
for (const ruleSet of prog.context.ruleSets || []) {
  for (const rule of ruleSet.rules || []) {
    if (rule.kind !== 'MIN_BUFFER') continue;
    rule.description = rule.description
      .replace(/6 hours|360-minute|360min|360 minutes/gi, '150-minute');
    if (rule.buffer) {
      rule.buffer.expectedMinutes = 150;
      rule.buffer.minimumMinutes = 150;
      // conservativeMinutes is pack-stated (180) and is NOT overridden here:
      // the fixture mirrors the pack's policy numbers; materialization reads
      // minimumMinutes first, which is the 150-minute engine rule.
    }
  }
}

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

  const headline = findCmt('cmt-ait-d1-headline-interview');
  headline.startsAt = timed('2026-10-01T11:30:00+08:00');
  headline.endsAt = timed('2026-10-01T12:00:00+08:00');

  // Elena free for headline 11:30–12:00: move ota-chat earlier.
  const ota = findCmt('cmt-ait-d1-ota-chat');
  ota.startsAt = timed('2026-10-01T10:40:00+08:00');
  ota.endsAt = timed('2026-10-01T11:00:00+08:00');

  // Daniel local CHANGEABLE swap counterpart (new commitment — see WIT_SEED_DECISIONS.md).
  let localHost = cmts.find((x) => x.id === 'cmt-ait-d1-local-host-session');
  if (!localHost) {
    localHost = {
      id: 'cmt-ait-d1-local-host-session',
      anchorEventId: 'evt-ait-2026',
      title: 'Operator Marketplace Roundtable',
      kind: 'SESSION',
      startsAt: timed('2026-10-01T14:30:00+08:00'),
      endsAt: timed('2026-10-01T15:00:00+08:00'),
      placeId: 'place-mbs',
    };
    cmts.push(localHost);
  } else {
    localHost.anchorEventId = localHost.anchorEventId || 'evt-ait-2026';
    localHost.kind = localHost.kind || 'SESSION';
    localHost.title = 'Operator Marketplace Roundtable';
    localHost.startsAt = timed('2026-10-01T14:30:00+08:00');
    localHost.endsAt = timed('2026-10-01T15:00:00+08:00');
    localHost.placeId = 'place-mbs';
  }

  const fireside = findCmt('cmt-ait-d1-recovery-fireside');
  fireside.startsAt = timed('2026-10-01T15:30:00+08:00');
  fireside.endsAt = timed('2026-10-01T16:00:00+08:00');

  const search = findCmt('cmt-ait-d1-search-chat');
  search.startsAt = timed('2026-10-01T16:05:00+08:00');
  search.endsAt = timed('2026-10-01T16:25:00+08:00');

  // Felix Day-1 REQUIRED later slot (Amendment B): viable after 10:30 arrival.
  const agentic = findCmt('cmt-ait-d1-agentic-provocation');
  agentic.startsAt = timed('2026-10-01T16:30:00+08:00');
  agentic.endsAt = timed('2026-10-01T16:40:00+08:00');
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
      ...(t.notes || []).filter(
        (n) => !/Northstar|arranged travel|S3 programme|local co-host/i.test(n),
      ),
      'Local co-host; self-arranged. S3 swap counterpart on cmt-ait-d1-local-host-session (14:30 CHANGEABLE).',
    ];
    t.anchorCommitmentIds = Array.from(
      new Set([...(t.anchorCommitmentIds || []), 'cmt-ait-d1-local-host-session']),
    );
    const eng = t.engagementImportance || [];
    const withoutLocal = eng.filter((e) => e.commitmentId !== 'cmt-ait-d1-local-host-session');
    withoutLocal.push({
      commitmentId: 'cmt-ait-d1-local-host-session',
      role: 'HOST',
      importance: 'REQUIRED',
      flexibility: 'CHANGEABLE',
    });
    t.engagementImportance = withoutLocal;
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

// Jordan: no morning lab; SG nationality; finals + awards only
{
  const jordan = travellers.find((x) => x.draftId === 'ait-draft-09');
  if (jordan) {
    jordan.nationalityCodes = ['SG'];
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
      'Hackathon finalist (Team Waypoint); LAX ZIPAIR connection hero (S2); SG nationality; unbound from morning lab; evening finals 20:45 required; awards 2 Oct',
    ];
  }
}

// Felix: remove morning india-fireside REQUIRED; keep later agentic + Day-2 panel
{
  const felix = travellers.find((x) => x.draftId === 'ait-draft-03');
  if (felix) {
    felix.anchorCommitmentIds = (felix.anchorCommitmentIds || []).filter(
      (id) => id !== 'cmt-ait-d1-india-fireside',
    );
    if (!felix.anchorCommitmentIds.includes('cmt-ait-d1-agentic-provocation')) {
      felix.anchorCommitmentIds.push('cmt-ait-d1-agentic-provocation');
    }
    felix.engagementImportance = (felix.engagementImportance || []).filter(
      (e) => e.commitmentId !== 'cmt-ait-d1-india-fireside',
    );
    const agentic = felix.engagementImportance.find(
      (e) => e.commitmentId === 'cmt-ait-d1-agentic-provocation',
    );
    if (agentic) {
      agentic.role = 'SPEAKER';
      agentic.importance = 'REQUIRED';
      agentic.flexibility = 'FIXED';
    } else {
      felix.engagementImportance.push({
        commitmentId: 'cmt-ait-d1-agentic-provocation',
        role: 'SPEAKER',
        importance: 'REQUIRED',
        flexibility: 'FIXED',
      });
    }
    felix.notes = [
      'CGK inbound cohort peer; Day-1 REQUIRED agentic provocation 16:30 (viable after ID7153 10:30); Day-2 ota-panel',
    ];
  }
}

// Elevate payments panellists to REQUIRED
for (const draftId of ['ait-draft-11', 'ait-draft-30']) {
  const t = travellers.find((x) => x.draftId === draftId);
  if (!t) continue;
  for (const e of t.engagementImportance || []) {
    if (e.commitmentId === 'cmt-ait-d1-payments-panel') {
      e.importance = 'REQUIRED';
    }
  }
}

{
  // Elena is local, has no inbound readiness dependency, and is free between
  // the 10:10 fireside and her 11:30 headline slot.
  const localInterviewer = travellers.find((x) => x.draftId === 'ait-draft-01');
  if (localInterviewer) {
    localInterviewer.engagementImportance = [
      ...(localInterviewer.engagementImportance || []).filter(
        (e) => e.commitmentId !== 'cmt-ait-d1-india-fireside',
      ),
      {
        commitmentId: 'cmt-ait-d1-india-fireside',
        role: 'INTERVIEWER',
        importance: 'REQUIRED',
        flexibility: 'CHANGEABLE',
      },
    ];
    localInterviewer.anchorCommitmentIds = Array.from(
      new Set([
        ...(localInterviewer.anchorCommitmentIds || []),
        'cmt-ait-d1-india-fireside',
      ]),
    );
  }
}

// Jonas notes + Sarah notes
{
  const jonas = travellers.find((x) => x.draftId === 'ait-draft-35');
  if (jonas) {
    jonas.notes = [
      'Recovery-platform founder; Day 1 fireside 15:30 (stage exclusivity after Daniel local-host); Concorde stay; Sunday extension is traveller-funded',
    ];
  }
  const sarah = travellers.find((x) => x.draftId === 'ait-draft-14');
  if (sarah) {
    sarah.notes = [
      'Headline interview speaker, Day 1 11:30 — S1 critical under 150min readiness after ID7153 10:30; S3 bilateral swap with Daniel local-host 14:30',
    ];
  }
}

// --- CP1: Daniel-only viable programme swap (seed/data) ---
function dropEngagement(traveller, commitmentId) {
  if (!traveller) return;
  traveller.engagementImportance = (traveller.engagementImportance || []).filter(
    (e) => e.commitmentId !== commitmentId,
  );
  traveller.anchorCommitmentIds = (traveller.anchorCommitmentIds || []).filter(
    (id) => id !== commitmentId,
  );
}

function addEngagement(traveller, entry) {
  if (!traveller) return;
  dropEngagement(traveller, entry.commitmentId);
  traveller.engagementImportance = [...(traveller.engagementImportance || []), entry];
  traveller.anchorCommitmentIds = Array.from(
    new Set([...(traveller.anchorCommitmentIds || []), entry.commitmentId]),
  );
}

{
  const elena = travellers.find((x) => x.draftId === 'ait-draft-01');
  dropEngagement(elena, 'cmt-ait-d1-day1-close');
  dropEngagement(elena, 'cmt-ait-d1-distribution-debate');

  const hugo = travellers.find((x) => x.draftId === 'ait-draft-16');
  dropEngagement(hugo, 'cmt-ait-d1-trust-research');

  const ethan = travellers.find((x) => x.draftId === 'ait-draft-34');
  dropEngagement(ethan, 'cmt-ait-d1-search-chat');

  addEngagement(travellers.find((x) => x.draftId === 'ait-draft-37'), {
    commitmentId: 'cmt-ait-d1-trust-research',
    role: 'SPEAKER',
    importance: 'REQUIRED',
    flexibility: 'FIXED',
  });
  addEngagement(travellers.find((x) => x.draftId === 'ait-draft-39'), {
    commitmentId: 'cmt-ait-d1-search-chat',
    role: 'SPEAKER',
    importance: 'REQUIRED',
    flexibility: 'FIXED',
  });
  addEngagement(travellers.find((x) => x.draftId === 'ait-draft-32'), {
    commitmentId: 'cmt-ait-d1-day1-close',
    role: 'HOST',
    importance: 'REQUIRED',
    flexibility: 'FIXED',
  });
  addEngagement(travellers.find((x) => x.draftId === 'ait-draft-36'), {
    commitmentId: 'cmt-ait-d1-distribution-debate',
    role: 'REFEREE',
    importance: 'REQUIRED',
    flexibility: 'FIXED',
  });

  const victor = travellers.find((x) => x.draftId === 'ait-draft-06');
  if (victor) {
    for (const e of victor.engagementImportance || []) {
      if (e.commitmentId === 'cmt-ait-d1-distribution-debate') {
        e.importance = 'PREFERRED';
        e.flexibility = 'CHANGEABLE';
      }
    }
  }

  const nadia = travellers.find((x) => x.draftId === 'ait-draft-19');
  if (nadia) {
    nadia.notes = [
      ...(nadia.notes || []).filter((n) => !/stay-only|ID7159 cohort/i.test(n)),
      'Founder; hotel-stack fireside Day 0; ticketed CGK→SIN on ID7128 (outside ID7159 disruption cohort)',
    ];
  }
}

// Assign declared travel for all NORTHSTAR_ARRANGED
//
// S1 supplier-disruption SSOT: exactly five CGK travellers are ticketed on the
// synthetic Batik ID7159 baseline (data/ait-demo-input-pack/scenarios/
// s1-supplier-disruption/inputs/baseline-itineraries.json, and the schedule
// change lists exactly those five ticketedManagedTravellers). The CGK corridor
// template must NOT sweep in every Jakarta-origin managed traveller — a sixth
// phantom ticket would contradict the disruption event's blast radius.
const CGK_ID7159_COHORT = new Set([
  'ait-draft-14', // Sarah Lim — Day-1 headline interview (S1 critical)
  'ait-draft-03', // Felix Hartono — Day-1 agentic provocation
  'ait-draft-10', // Arjun Mehta — India fireside
  'ait-draft-11', // Siti Rahman — payments panel
  'ait-draft-30', // Mei Chen — payments panel
]);

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
  let legs;
  if (origin === 'CGK' && !CGK_ID7159_COHORT.has(t.draftId)) {
    legs = CORRIDORS.CGK_NON_COHORT.legs(pnr);
  } else if (t.draftId === 'ait-draft-09') {
    legs = CORRIDORS.LAX.legs('ZGSYN09');
  } else if (t.draftId === 'ait-draft-38' && existingLegs.length >= 2) {
    legs = existingLegs.map((l) => ({
      ...l,
      bookingRef: l.bookingRef || { system: 'pnr', reference: pnr },
    }));
  } else if (t.draftId === 'ait-draft-35') {
    const outbound =
      existingLegs.find((l) => l.originRef?.value === 'SIN') ||
      CORRIDORS.AMS.legs(pnr).find((l) => l.originRef?.value === 'SIN');
    legs = [...lateMorningOct1Legs(origin, pnr), ...(outbound ? [outbound] : [])];
  } else if (LATE_MORNING_OCT1_DRAFTS.has(t.draftId)) {
    legs = lateMorningOct1Legs(origin, pnr);
  } else {
    legs = corridor.legs(pnr);
  }

  t.declaredTravel = legs.length > 0 ? [...legs, stay({ placeId, ...sw })] : [stay({ placeId, ...sw })];
  withStays++;
  if (legs.length > 0) withFlights++;
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

// --- Input-pack / acceptance-manifest SSOT sync ---
// Keep the pack deliberately data-driven: the fixture remains the canonical
// promoted world, while scenario-local files carry provenance and narrative.
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function replaceStrings(value, replacements) {
  if (typeof value === 'string') {
    return replacements.reduce(
      (result, [from, to]) =>
        // Regex entries are whole-word guards (e.g. /\bRESCHEDULE\b/g) so
        // re-running the reconciliation cannot corrupt enum values like
        // changeKind: 'RESCHEDULED'.
        typeof from === 'string' ? result.split(from).join(to) : result.replace(from, to),
      value,
    );
  }
  if (Array.isArray(value)) return value.map((item) => replaceStrings(item, replacements));
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      value[key] = replaceStrings(child, replacements);
    }
  }
  return value;
}

const PACK_ROOT = path.join(ROOT, 'data/ait-demo-input-pack');
const GLOBAL_ROOT = path.join(PACK_ROOT, 'global');
const SCENARIO_ROOT = path.join(PACK_ROOT, 'scenarios');
const MANIFEST_ROOT = path.join(ROOT, 'fixtures/acceptance/manifests');

// Anchor timings and programme sessions are copied by commitment id so the
// input pack cannot silently retain a retired time window.
{
  const anchorPackFile = path.join(GLOBAL_ROOT, 'anchor-event.json');
  const anchorPack = readJson(anchorPackFile);
  const fixtureCommitments = new Map(
    prog.context.anchorEvent.commitments.map((commitment) => [commitment.id, commitment]),
  );
  const packCommitments = anchorPack.anchorEvent.commitments;
  for (const commitment of packCommitments) {
    const fixture = fixtureCommitments.get(commitment.id);
    if (!fixture) continue;
    commitment.startsAt = fixture.startsAt;
    commitment.endsAt = fixture.endsAt;
    commitment.title = fixture.title;
    commitment.placeId = fixture.placeId;
  }
  if (!packCommitments.some((commitment) => commitment.id === 'cmt-ait-d1-local-host-session')) {
    const localHost = fixtureCommitments.get('cmt-ait-d1-local-host-session');
    if (localHost) {
      packCommitments.push({
        ...localHost,
        anchorEventId: anchorPack.anchorEventId,
      });
    }
  }
  writeJson(anchorPackFile, anchorPack);

  const programmeFile = path.join(GLOBAL_ROOT, 'programme.json');
  const programmePack = readJson(programmeFile);
  const fixtureTimes = new Map(
    prog.context.anchorEvent.commitments.map((commitment) => [
      commitment.id,
      [commitment.startsAt.value.slice(11, 16), commitment.endsAt.value.slice(11, 16)],
    ]),
  );
  for (const day of programmePack.days) {
    for (const session of day.sessions) {
      const times = fixtureTimes.get(session.commitmentId);
      if (times) session.time = `${times[0]}-${times[1]}`;
    }
  }
  const roles = new Map(
    programmePack.roleAssignments.map((assignment) => [assignment.commitmentId, assignment]),
  );
  const india = roles.get('cmt-ait-d1-india-fireside');
  if (india) {
    india.roles = india.roles.map((role) =>
      role.role === 'INTERVIEWER' ? { ...role, draftIds: ['ait-draft-01'] } : role,
    );
  }
  const localHost = roles.get('cmt-ait-d1-local-host-session');
  if (localHost) localHost.roles = [{ role: 'HOST', draftIds: ['ait-draft-02'] }];
  const trust = roles.get('cmt-ait-d1-trust-research');
  if (trust) trust.roles = [{ role: 'SPEAKER', draftIds: ['ait-draft-37'] }];
  const searchChat = roles.get('cmt-ait-d1-search-chat');
  if (searchChat) {
    searchChat.roles = searchChat.roles.map((role) =>
      role.role === 'SPEAKER' ? { ...role, draftIds: ['ait-draft-39'] } : role,
    );
  }
  const day1Close = roles.get('cmt-ait-d1-day1-close');
  if (day1Close) day1Close.roles = [{ role: 'HOST', draftIds: ['ait-draft-32'] }];
  const debate = roles.get('cmt-ait-d1-distribution-debate');
  if (debate) {
    debate.roles = debate.roles.map((role) => {
      if (role.role === 'REFEREE') {
        return { ...role, draftIds: ['ait-draft-06', 'ait-draft-36'] };
      }
      return role;
    });
  }
  writeJson(programmeFile, programmePack);
}

// Programme importance is an explicit input, not inferred from role names.
{
  const file = path.join(GLOBAL_ROOT, 'programme-importance.json');
  const importance = readJson(file);
  importance.entries = importance.entries.filter(
    (entry) =>
      !(entry.draftId === 'ait-draft-03' && entry.commitmentId === 'cmt-ait-d1-india-fireside') &&
      !(entry.draftId === 'ait-draft-09' && entry.commitmentId === 'cmt-ait-d0-hackathon-lab') &&
      !(entry.draftId === 'ait-draft-16' && entry.commitmentId === 'cmt-ait-d1-trust-research') &&
      !(entry.draftId === 'ait-draft-25' && entry.commitmentId === 'cmt-ait-d1-trust-research') &&
      !(entry.draftId === 'ait-draft-34' && entry.commitmentId === 'cmt-ait-d1-search-chat') &&
      !(entry.draftId === 'ait-draft-04' && entry.commitmentId === 'cmt-ait-d1-search-chat') &&
      !(
        entry.draftId === 'ait-draft-01' &&
        (entry.commitmentId === 'cmt-ait-d1-day1-close' ||
          entry.commitmentId === 'cmt-ait-d1-distribution-debate')
      ),
  );
  const upsert = (entry) => {
    const index = importance.entries.findIndex(
      (candidate) =>
        candidate.draftId === entry.draftId && candidate.commitmentId === entry.commitmentId,
    );
    if (index >= 0) importance.entries[index] = { ...importance.entries[index], ...entry };
    else importance.entries.push(entry);
  };
  upsert({
    draftId: 'ait-draft-03',
    commitmentId: 'cmt-ait-d1-agentic-provocation',
    role: 'SPEAKER',
    importance: 'REQUIRED',
    flexibility: 'FIXED',
  });
  upsert({
    draftId: 'ait-draft-02',
    commitmentId: 'cmt-ait-d1-local-host-session',
    role: 'HOST',
    importance: 'REQUIRED',
    flexibility: 'CHANGEABLE',
  });
  for (const draftId of ['ait-draft-11', 'ait-draft-30']) {
    upsert({
      draftId,
      commitmentId: 'cmt-ait-d1-payments-panel',
      role: 'PANELLIST',
      importance: 'REQUIRED',
      flexibility: 'CHANGEABLE',
    });
  }
  upsert({
    draftId: 'ait-draft-37',
    commitmentId: 'cmt-ait-d1-trust-research',
    role: 'SPEAKER',
    importance: 'REQUIRED',
    flexibility: 'FIXED',
  });
  upsert({
    draftId: 'ait-draft-39',
    commitmentId: 'cmt-ait-d1-search-chat',
    role: 'SPEAKER',
    importance: 'REQUIRED',
    flexibility: 'FIXED',
  });
  upsert({
    draftId: 'ait-draft-32',
    commitmentId: 'cmt-ait-d1-day1-close',
    role: 'HOST',
    importance: 'REQUIRED',
    flexibility: 'FIXED',
  });
  upsert({
    draftId: 'ait-draft-36',
    commitmentId: 'cmt-ait-d1-distribution-debate',
    role: 'REFEREE',
    importance: 'REQUIRED',
    flexibility: 'FIXED',
  });
  upsert({
    draftId: 'ait-draft-06',
    commitmentId: 'cmt-ait-d1-distribution-debate',
    role: 'REFEREE',
    importance: 'PREFERRED',
    flexibility: 'CHANGEABLE',
  });
  writeJson(file, importance);
}

// Roster common fields mirror the promoted fixture. This intentionally leaves
// declaredTravel out of the roster pack; travel belongs to the programme build.
{
  const file = path.join(GLOBAL_ROOT, 'roster.json');
  const roster = readJson(file);
  const rosterById = new Map(roster.importDraft.travellers.map((traveller) => [traveller.draftId, traveller]));
  for (const traveller of prog.importDraft.travellers) {
    const target = rosterById.get(traveller.draftId);
    if (!target) continue;
    for (const key of [
      'displayName',
      'identity',
      'homeLocationText',
      'nationalityCodes',
      'notes',
      'anchorCommitmentIds',
      'travelArrangement',
    ]) {
      if (traveller[key] !== undefined) target[key] = traveller[key];
    }
  }
  writeJson(file, roster);
}

// Jordan's synthetic booking dossier is SG and spans the baseline arrival eve
// through the canonical 3 Oct checkout. The recovered 30 Sep arrival can
// therefore invalidate the first Singapore night through generic stay logic.
{
  const file = path.join(GLOBAL_ROOT, 'booking-dossiers.json');
  const dossiers = readJson(file);
  const flight = dossiers.dossiers.flight.find((item) => item.draftId === 'ait-draft-09');
  if (flight?.passengers?.[0]) flight.passengers[0].nationality = 'SG';
  const hotel = dossiers.dossiers.hotel.find((item) => item.draftId === 'ait-draft-09');
  if (hotel) {
    hotel.checkIn = '2026-09-29T15:00:00+08:00';
    hotel.checkOut = '2026-10-03T11:00:00+08:00';
  }
  writeJson(file, dossiers);
}

const s1Root = path.join(SCENARIO_ROOT, 's1-supplier-disruption');
const oldS1Event = path.join(s1Root, 'inputs/airline-schedule-change-mn310.json');
const newS1Event = path.join(s1Root, 'inputs/airline-schedule-change-id7159.json');
if (fs.existsSync(oldS1Event)) fs.renameSync(oldS1Event, newS1Event);
for (const file of [
  path.join(s1Root, 'scenario.json'),
  path.join(s1Root, 'inputs/baseline-itineraries.json'),
  path.join(s1Root, 'inputs/alternative-services-inventory.json'),
  newS1Event,
]) {
  if (!fs.existsSync(file)) continue;
  const value = replaceStrings(readJson(file), [
    ['airline-schedule-change-mn310.json', 'airline-schedule-change-id7159.json'],
    ['MN310', 'ID7159'],
    ['src-sim-airline-mn', 'src-sim-airline-id'],
    ['Meridian Airways', 'Batik Air'],
    ['09:20', '11:30'],
    ['360min', '150min'],
    ['360min', '150min'],
    ['360 minutes', '150 minutes'],
    ['6h40m', '6h40m'],
    ['S3 RESCHEDULE', 'S3 bilateral Sarah↔Daniel swap'],
    [
      'Group B (Felix Hartono / ait-draft-03, Day-1 india-fireside 10:10) fails the retimed arrival but has a viable earlier CGK→SIN Atlas/SIMULATED offer that planning can propose; ',
      'Felix Hartono / ait-draft-03 remains VIABLE for the Day-1 agentic provocation at 16:30; ',
    ],
  ]);
  if (file === newS1Event) {
    value.carrier = { code: 'ID', name: 'Batik Air (simulated)' };
    value.eventId = 'sim-id-evt-20260921-cgk-001';
  }
  if (file.endsWith(`${path.sep}s1-supplier-disruption${path.sep}scenario.json`)) {
    const felix = value.affectedTravellers.find((traveller) => traveller.draftId === 'ait-draft-03');
    if (felix) {
      felix.impactClass = 'VIABLE';
      felix.group = 'A';
      felix.reason =
        'ID7153 arrives 10:30; Felix’s REQUIRED/FIXED agentic provocation starts 16:30, leaving 360 minutes and clearing the 150-minute buffer.';
    }
    value.expectedReasoningHooks = value.expectedReasoningHooks.map((hook) =>
      hook
        .replace(
          'Group B: airline reprotection insufficient; planner searches the disrupted CGK→SIN corridor; viability engine accepts only offers that restore the buffer for THAT traveller\'s commitment.',
          'All four peers, including Felix at the 16:30 agentic provocation, remain VIABLE under the same ID7153 reprotection.',
        )
        .replace(
          'Group C: no feasible travel-only strategy for the current headline slot; surface organiser programme change (S3 bilateral Sarah↔Daniel swap) rather than invent certainty.',
          'Sarah is the only NOT_VIABLE traveller; surface the organiser programme change (S3 bilateral Sarah↔Daniel swap) rather than invent certainty.',
        ),
    );
    const sarah = value.affectedTravellers.find((traveller) => traveller.draftId === 'ait-draft-14');
    if (sarah) {
      sarah.reason = sarah.reason.replace(
        'S3 must RESCHEDULE the commitment later (no engagement-swap API).',
        'S3 must use the bilateral Sarah↔Daniel programme swap.',
      );
    }
  }
  writeJson(file, value);
}

const s2Root = path.join(SCENARIO_ROOT, 's2-missed-connection');
for (const file of [
  path.join(s2Root, 'scenario.json'),
  path.join(s2Root, 'inputs/baseline-itinerary.json'),
  path.join(s2Root, 'inputs/provider-rebooking-state.json'),
  path.join(s2Root, 'inputs/recovery-options-inventory.json'),
  path.join(s2Root, 'inputs/progressive-delay-timeline.json'),
  path.join(s2Root, 'inputs/entry-requirements-context.json'),
]) {
  const value = replaceStrings(readJson(file), [
    ['United States', 'Singapore'],
    ['"US"', '"SG"'],
    ['US passport', 'Singapore passport'],
    ['nationality": "US"', 'nationality": "SG"'],
    ['nationality": "US"', 'nationality": "SG"'],
    ['15:10', '20:45'],
    ['360min', '150min'],
    ['360 minutes', '150 minutes'],
    ['360 ≥ 360', '370 ≥ 150'],
    ['no change required', 'can be affected when arrival moves to 30 Sep'],
    ['TR885-class', 'TR885'],
  ]);
  if (file.endsWith('entry-requirements-context.json')) {
    value.assumedNationality = {
      codes: ['SG'],
      note: 'Jordan Hale is seeded as Singapore nationality; authoritative entry evidence remains UNKNOWN until decision time.',
    };
    value.toolHint.parameters.nationality = 'SG';
  }
  if (file.endsWith('baseline-itinerary.json')) {
    value.hotelStay.checkIn = '2026-09-29T15:00:00+08:00';
    value.hotelStay.checkOut = '2026-10-03T11:00:00+08:00';
  }
  writeJson(file, value);
}

// Keep the four delay phases explicit while preserving the existing
// zg053_impossible id used by the runtime acceptance manifest.
{
  const file = path.join(s2Root, 'inputs/progressive-delay-timeline.json');
  const timeline = readJson(file);
  const impossible = timeline.stages.find((stage) => stage.id === 'zg053_impossible');
  if (impossible) impossible.phase = 'D3';
  // Upsert, never append: re-running this reconciliation must not
  // accumulate duplicate D4 stages.
  const d4Index = timeline.stages.findIndex((stage) => stage.id === 'D4_connection_missed');
  const d4 = {
    id: 'D4_connection_missed',
    at: '2026-09-29T17:20:00+09:00',
    eventId: 'sim-zg-evt-s2-delay-04',
    eventType: 'MISSED_CONNECTION',
    transfer: {
      inboundArrival: '2026-09-29T17:55:00+09:00',
      onwardDeparture: '2026-09-29T16:50:00+09:00',
      connectionRemainingMinutes: -65,
    },
    narrative: 'D4: transfer is missed; reported TR867 airline default and TR885 Northstar recovery are evaluated against the 20:45 finals.',
  };
  if (d4Index >= 0) timeline.stages[d4Index] = d4;
  else timeline.stages.push(d4);
  writeJson(file, timeline);
}

// S3 is a bilateral swap, never a one-commitment reschedule to an arbitrary
// 15:30 slot.
for (const file of [
  path.join(SCENARIO_ROOT, 's3-event-change-preview/scenario.json'),
  path.join(SCENARIO_ROOT, 's3-event-change-preview/inputs/counterfactual-preview.json'),
  path.join(SCENARIO_ROOT, 's3-event-change-preview/inputs/organiser-change-request.json'),
]) {
  const value = replaceStrings(readJson(file), [
    ['RESCHEDULE headline interview to 15:30–16:00', 'swap Sarah headline 11:30–12:00 with Daniel local-host 14:30–15:00'],
    ['RESCHEDULE-to-15:30', 'bilateral Sarah↔Daniel swap'],
    ['Approximate \'swap with later local slot\' via RESCHEDULE only.', 'Execute the Sarah↔Daniel swap as two explicit programme changes.'],
    ['09:20', '11:30'],
    ['360min', '150min'],
    ['360 minutes', '150 minutes'],
    ['same trip\'s engagement starts 15:30', 'same trip\'s engagement starts 14:30'],
  ]);
  writeJson(file, value);
}

// Dossier and acceptance metadata are part of the same SSOT sync.
const dossier = readJson(path.join(GLOBAL_ROOT, 'booking-dossiers.json'));
if (dossier.dossiers?.flight?.[0]?.passengers?.[0]) dossier.dossiers.flight[0].passengers[0].nationality = 'SG';
writeJson(path.join(GLOBAL_ROOT, 'booking-dossiers.json'), dossier);

for (const fileName of ['s1-airline-schedule-change.json', 's1-s3-continuity.json']) {
  const file = path.join(MANIFEST_ROOT, fileName);
  const value = replaceStrings(readJson(file), [
    ['s1-supplier-disruption', 's1-supplier-disruption'],
    ['MN310', 'ID7159'],
    ['MN218', 'ID7153'],
    ['09:20', '11:30'],
    ['360min', '150min'],
    ['360 minutes', '150 minutes'],
    // Whole-word only: a bare 'RESCHEDULE' replace corrupts the
    // 'changeKind' enum value 'RESCHEDULED' into nonsense on re-runs.
    [/\bRESCHEDULE\b/g, 'bilateral Sarah↔Daniel swap'],
  ]);
  const ids = value.expect?.travellerIds ?? [];
  const trips = value.expect?.tripIds ?? [];
  const felix = 'trv-evt-ait-2026-ait-draft-03';
  const felixTrip = 'trip-trv-evt-ait-2026-ait-draft-03';
  if (!ids.includes(felix)) ids.splice(1, 0, felix);
  if (!trips.includes(felixTrip)) trips.splice(1, 0, felixTrip);
  value.expect.travellerIds = ids;
  value.expect.tripIds = trips;
  writeJson(file, value);
}

for (const fileName of ['s2-missed-connection.json', 's2-missed-connection-record.json']) {
  const file = path.join(MANIFEST_ROOT, fileName);
  const value = replaceStrings(readJson(file), [
    ['United States', 'Singapore'],
    ['"US"', '"SG"'],
    ['15:10', '20:45'],
    ['TR885-as-default', 'TR867-as-default'],
    ['TR885 airline-default', 'TR867 airline-default'],
    ['TR885-class', 'TR885'],
  ]);
  writeJson(file, value);
}

for (const fileName of ['s3-organiser-preview.json', 's3-organiser-preview-record.json']) {
  const file = path.join(MANIFEST_ROOT, fileName);
  const value = replaceStrings(readJson(file), [
    [/\bRESCHEDULE\b/g, 'bilateral Sarah↔Daniel swap'],
    ['15:30', '14:30'],
    ['09:20', '11:30'],
    ['360min', '150min'],
  ]);
  writeJson(file, value);
}

{
  const file = path.join(ROOT, 'fixtures/acceptance/packs/s1/pack.json');
  const value = readJson(file);
  const felix = 'trv-evt-ait-2026-ait-draft-03';
  const felixTrip = 'trip-trv-evt-ait-2026-ait-draft-03';
  if (!value.expect.travellerIds.includes(felix)) value.expect.travellerIds.splice(1, 0, felix);
  if (!value.expect.tripIds.includes(felixTrip)) value.expect.tripIds.splice(1, 0, felixTrip);
  value.description = 'Local acceptance pack for S1; five synthetic CGK ID7159→ID7153 travellers. Continuity proof: fixtures/acceptance/manifests/s1-s3-continuity.json';
  writeJson(file, value);
}

{
  const file = path.join(ROOT, 'fixtures/acceptance/packs/s2/pack.json');
  const value = readJson(file);
  value.version = '1.2.0';
  value.description =
    'Local acceptance pack for S2 LAX→NRT→SIN progressive missed connection; Jordan is SG, baseline Concorde check-in is 29 Sep and recovery arrival is 30 Sep.';
  value.corridor.airlineDefault = 'TR867';
  value.corridor.northstarCandidate = 'TR885';
  value.corridor.nationality = 'SG';
  value.corridor.hotelStay = {
    checkIn: '2026-09-29T15:00:00+08:00',
    checkOut: '2026-10-03T11:00:00+08:00',
  };
  writeJson(file, value);
}

{
  const file = path.join(ROOT, 'fixtures/acceptance/packs/s3/pack.json');
  const value = readJson(file);
  value.description =
    'Local acceptance pack for S3 bilateral Sarah headline ↔ Daniel local-host swap; facts live in data/ait-demo-input-pack/scenarios/s3-event-change-preview.';
  value.swap = {
    sarah: {
      commitmentId: 'cmt-ait-d1-headline-interview',
      from: '2026-10-01T11:30:00+08:00',
      to: '2026-10-01T14:30:00+08:00',
    },
    daniel: {
      commitmentId: 'cmt-ait-d1-local-host-session',
      from: '2026-10-01T14:30:00+08:00',
      to: '2026-10-01T11:30:00+08:00',
    },
  };
  writeJson(file, value);
}
