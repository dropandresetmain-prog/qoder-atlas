/**
 * Deterministic final-demo content coherence gate.
 * Authority: docs/FINAL_DEMO_CONTENT_SSOT.md
 */
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();
const PROGRAMME = path.join(ROOT, 'fixtures/programmes/ait-summit-2026/programme.json');

interface DeclaredItem {
  itemKind: string;
  originRef?: { value?: string };
  destinationRef?: { value?: string };
  carrierRef?: { value?: string };
  scheduledArrival?: string;
  stayPlaceRef?: { value?: string };
  checkIn?: string;
  checkOut?: string;
}

interface Traveller {
  draftId: string;
  displayName?: string;
  homeLocationText?: string;
  nationalityCodes?: string[];
  anchorCommitmentIds?: string[];
  engagementImportance?: Array<{
    commitmentId: string;
    importance?: string;
    flexibility?: string;
  }>;
  travelArrangement?: string;
  declaredTravel?: DeclaredItem[];
  notes?: string[];
  identity?: { email?: string };
}

interface Commitment {
  id: string;
  startsAt: { value: string };
  endsAt: { value: string };
}

interface Place {
  id: string;
  name: string;
  coordinates?: { latitude?: number; longitude?: number };
  externalRefs?: Array<{ system?: string; value?: string }>;
}

interface Programme {
  context: {
    places: Place[];
    anchorEvent: { commitments: Commitment[] };
    ruleSets: Array<{ rules: Array<Record<string, unknown>> }>;
  };
  importDraft: { travellers: Traveller[] };
}

const HERO_FAMILIES: Record<string, string[]> = {
  S2: ['ait-draft-09'],
  S1: ['ait-draft-14', 'ait-draft-10', 'ait-draft-11', 'ait-draft-30'],
  S3_locals: ['ait-draft-01', 'ait-draft-02'],
  S7: ['ait-draft-38'],
  S5: ['ait-draft-35'],
};

const TIER_A: string[] = [
  ...(HERO_FAMILIES.S2 ?? []),
  ...(HERO_FAMILIES.S1 ?? []),
  ...(HERO_FAMILIES.S7 ?? []),
  ...(HERO_FAMILIES.S5 ?? []),
];

const PROVIDER_HOTELS = new Set(['place-hotel-bayview', 'place-hotel-harbourline']);
const REAL_HOTEL_NAMES: Record<string, string> = {
  'place-hotel-bayview': 'Concorde Hotel Singapore',
  'place-hotel-harbourline': 'Hotel Grand Pacific',
};

function load(): Programme {
  return JSON.parse(fs.readFileSync(PROGRAMME, 'utf8')) as Programme;
}

function minutesBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 60000;
}

function inboundArrival(t: Traveller): string | null {
  const legs = (t.declaredTravel ?? []).filter(
    (x) => x.itemKind === 'TRANSPORT_LEG' && x.destinationRef?.value === 'SIN',
  );
  if (!legs.length) return null;
  return legs[legs.length - 1]?.scheduledArrival ?? null;
}

function cmt(prog: Programme, id: string): Commitment {
  const found = prog.context.anchorEvent.commitments.find((c) => c.id === id);
  assert.ok(found, `missing commitment ${id}`);
  return found;
}

test('final-demo content: 67 / 42 / 25 population', () => {
  const prog = load();
  const ts = prog.importDraft.travellers;
  assert.equal(ts.length, 67);
  const managed = ts.filter((t) => t.travelArrangement === 'NORTHSTAR_ARRANGED');
  const self = ts.filter((t) => t.travelArrangement !== 'NORTHSTAR_ARRANGED');
  assert.equal(managed.length, 42);
  assert.equal(self.length, 25);
});

test('final-demo content: no unintended hero family person overlap', () => {
  const names = Object.keys(HERO_FAMILIES);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const aName = names[i]!;
      const bName = names[j]!;
      if (
        (aName === 'S1' && bName === 'S3_locals') ||
        (aName === 'S3_locals' && bName === 'S1')
      ) {
        continue;
      }
      const a = new Set(HERO_FAMILIES[aName]);
      const b = new Set(HERO_FAMILIES[bName]);
      for (const id of a) {
        assert.equal(b.has(id), false, `overlap ${id} between ${aName} and ${bName}`);
      }
    }
  }
  assert.ok(HERO_FAMILIES.S1!.includes('ait-draft-14'));
});

test('final-demo content: Tier A people have required detail fields', () => {
  const prog = load();
  const byId = new Map(prog.importDraft.travellers.map((t) => [t.draftId, t]));
  for (const id of TIER_A) {
    const t = byId.get(id);
    assert.ok(t, id);
    assert.ok(t.displayName?.includes(' '), `${id} name`);
    assert.ok(t.homeLocationText, `${id} origin`);
    assert.ok((t.nationalityCodes ?? []).length, `${id} nationality`);
    assert.ok((t.anchorCommitmentIds ?? []).length, `${id} commitments`);
    assert.ok((t.engagementImportance ?? []).length, `${id} engagement`);
    assert.equal(t.travelArrangement, 'NORTHSTAR_ARRANGED', id);
    const legs = (t.declaredTravel ?? []).filter((x) => x.itemKind === 'TRANSPORT_LEG');
    const stays = (t.declaredTravel ?? []).filter((x) => x.itemKind === 'STAY');
    assert.ok(legs.length >= 1, `${id} flight`);
    assert.ok(stays.length >= 1, `${id} hotel`);
    assert.ok((t.notes ?? []).length || t.identity?.email, `${id} identity/notes`);
  }
});

test('final-demo content: all 42 managed have flights + provider-backed hotels', () => {
  const prog = load();
  const places = new Map(prog.context.places.map((p) => [p.id, p]));
  for (const id of PROVIDER_HOTELS) {
    const pl = places.get(id);
    assert.ok(pl, id);
    assert.equal(pl.name, REAL_HOTEL_NAMES[id]);
    assert.ok(pl.coordinates?.latitude);
    assert.ok(
      (pl.externalRefs ?? []).some((r) => r.system === 'nuitee-hotel-id'),
      `${id} nuitee ref`,
    );
  }
  const managed = prog.importDraft.travellers.filter(
    (t) => t.travelArrangement === 'NORTHSTAR_ARRANGED',
  );
  assert.equal(managed.length, 42);
  for (const t of managed) {
    const legs = (t.declaredTravel ?? []).filter((x) => x.itemKind === 'TRANSPORT_LEG');
    const stays = (t.declaredTravel ?? []).filter((x) => x.itemKind === 'STAY');
    assert.ok(legs.length >= 1, `${t.draftId} missing flight`);
    assert.ok(
      legs.every((l) => l.carrierRef?.value && l.originRef?.value && l.destinationRef?.value),
      `${t.draftId} incomplete flight`,
    );
    assert.ok(stays.length >= 1, `${t.draftId} missing stay`);
    for (const s of stays) {
      assert.ok(PROVIDER_HOTELS.has(s.stayPlaceRef?.value ?? ''), `${t.draftId} non-portfolio hotel`);
    }
  }
});

test('final-demo content: hero baselines viable before disruption; no impossible overlaps', () => {
  const prog = load();
  const byId = new Map(prog.importDraft.travellers.map((t) => [t.draftId, t]));
  const checks: Array<[string, string]> = [
    ['ait-draft-09', 'cmt-ait-d0-hackathon-finals'],
    ['ait-draft-14', 'cmt-ait-d1-headline-interview'],
    ['ait-draft-38', 'cmt-ait-d1-distribution-debate'],
    ['ait-draft-35', 'cmt-ait-d1-recovery-fireside'],
  ];
  for (const [draftId, cmtId] of checks) {
    const t = byId.get(draftId);
    assert.ok(t, draftId);
    const commitment = cmt(prog, cmtId);
    const arr = inboundArrival(t);
    assert.ok(arr, draftId);
    const gap = minutesBetween(arr, commitment.startsAt.value);
    assert.ok(gap >= 360, `${draftId} baseline gap ${gap} < 360 to ${cmtId}`);
  }

  const jordan = byId.get('ait-draft-09');
  assert.ok(jordan);
  const times = (jordan.anchorCommitmentIds ?? []).map((id) => {
    const commitment = cmt(prog, id);
    return [id, Date.parse(commitment.startsAt.value), Date.parse(commitment.endsAt.value)] as const;
  });
  for (let i = 0; i < times.length; i++) {
    for (let j = i + 1; j < times.length; j++) {
      const a = times[i]!;
      const b = times[j]!;
      assert.ok(a[2] <= b[1] || b[2] <= a[1], `Jordan overlap ${a[0]} vs ${b[0]}`);
    }
  }
});

test('final-demo content: S2 timing supports intended recovery stages', () => {
  const prog = load();
  const finals = cmt(prog, 'cmt-ait-d0-hackathon-finals');
  assert.equal(finals.startsAt.value, '2026-09-30T20:45:00+08:00');
  assert.equal(finals.endsAt.value, '2026-09-30T21:05:00+08:00');

  const jordan = prog.importDraft.travellers.find((t) => t.draftId === 'ait-draft-09');
  assert.ok(jordan);
  const legs = (jordan.declaredTravel ?? []).filter((x) => x.itemKind === 'TRANSPORT_LEG');
  assert.equal(legs[0]?.carrierRef?.value, 'ZG023');
  assert.equal(legs[1]?.carrierRef?.value, 'ZG053');
  assert.equal(legs[1]?.scheduledArrival, '2026-09-29T23:00:00+08:00');

  const tr885Arr = '2026-09-30T14:35:00+08:00';
  const tr867Arr = '2026-09-30T20:45:00+08:00';
  assert.ok(minutesBetween(tr885Arr, finals.startsAt.value) >= 360, 'TR885 clears evening finals');
  assert.ok(minutesBetween(tr867Arr, finals.startsAt.value) <= 0, 'TR867 does not clear finals start');

  assert.equal(
    (jordan.anchorCommitmentIds ?? []).includes('cmt-ait-d0-hackathon-lab'),
    false,
    'Jordan must not be bound to morning lab',
  );
  const stay = (jordan.declaredTravel ?? []).find((x) => x.itemKind === 'STAY');
  assert.equal(stay?.checkIn, '2026-09-30T15:00:00+08:00');
});

test('final-demo content: S1 cohort differentiated + S3 programme path free', () => {
  const prog = load();
  const byId = new Map(prog.importDraft.travellers.map((t) => [t.draftId, t]));
  const headline = cmt(prog, 'cmt-ait-d1-headline-interview');
  assert.equal(headline.startsAt.value, '2026-10-01T09:20:00+08:00');

  const rebookArr = '2026-10-01T07:00:00+08:00';
  assert.ok(minutesBetween(rebookArr, headline.startsAt.value) < 360, 'critical fails');

  const payments = cmt(prog, 'cmt-ait-d1-payments-keynote');
  assert.ok(minutesBetween(rebookArr, payments.startsAt.value) >= 360, 'cohort can pass');

  const fireside = cmt(prog, 'cmt-ait-d1-recovery-fireside');
  assert.equal(fireside.startsAt.value, '2026-10-01T14:30:00+08:00');
  const s3TargetStart = Date.parse('2026-10-01T15:30:00+08:00');
  assert.ok(Date.parse(fireside.endsAt.value) <= s3TargetStart, 'fireside must clear S3 15:30');

  const daniel = byId.get('ait-draft-02');
  assert.ok(daniel);
  assert.equal(daniel.travelArrangement, 'SELF_OR_OTHER_ARRANGED');
  assert.ok((daniel.homeLocationText ?? '').includes('Singapore'));
});

test('final-demo content: S7 pre-booking Tokyo-origin cast; S5 funding window', () => {
  const prog = load();
  const oliver = prog.importDraft.travellers.find((t) => t.draftId === 'ait-draft-38');
  assert.ok(oliver);
  assert.ok((oliver.homeLocationText ?? '').includes('London'));
  const legs = (oliver.declaredTravel ?? []).filter((x) => x.itemKind === 'TRANSPORT_LEG');
  assert.ok(legs.some((l) => l.originRef?.value === 'LHR'));
  assert.ok(legs.some((l) => l.destinationRef?.value === 'LHR'), 'return LHR intent');

  const jonas = prog.importDraft.travellers.find((t) => t.draftId === 'ait-draft-35');
  assert.ok(jonas);
  const stay = (jonas.declaredTravel ?? []).find((x) => x.itemKind === 'STAY');
  assert.ok(stay);
  assert.equal(stay.stayPlaceRef?.value, 'place-hotel-bayview');
  assert.equal(stay.checkOut, '2026-10-03T11:00:00+08:00');

  const hotelWindow = prog.context.ruleSets[0]?.rules.find(
    (r) => r.id === 'rule-ait-hotel-funded-window',
  );
  assert.ok(hotelWindow);
  assert.equal(hotelWindow.windowEnd, '2026-10-03T11:00:00+08:00');
  assert.equal(hotelWindow.incrementalPayer, 'TRAVELLER');
});
