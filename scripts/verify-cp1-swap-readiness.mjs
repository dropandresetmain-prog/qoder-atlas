/**
 * CP1 verification: Day-1 sessions after 11:30 and 11:30 overlay readiness.
 * Read-only; prints required participants, inbound arrival, 150min @ 11:30.
 */
import fs from 'fs';

const BUFFER_MIN = 150;
const OVERLAY_START = new Date('2026-10-01T11:30:00+08:00');
const prog = JSON.parse(
  fs.readFileSync('fixtures/programmes/ait-summit-2026/programme.json', 'utf8'),
);
const importance = JSON.parse(
  fs.readFileSync('data/ait-demo-input-pack/global/programme-importance.json', 'utf8'),
);

const travellers = new Map(
  prog.importDraft.travellers.map((t) => [t.draftId, t]),
);

const requiredByCmt = new Map();
for (const entry of importance.entries) {
  if (entry.importance !== 'REQUIRED') continue;
  const list = requiredByCmt.get(entry.commitmentId) ?? [];
  list.push(entry);
  requiredByCmt.set(entry.commitmentId, list);
}

function sinArrival(traveller) {
  if (traveller.travelArrangement !== 'NORTHSTAR_ARRANGED') return null;
  const legs = (traveller.declaredTravel || []).filter((x) => x.itemKind === 'TRANSPORT_LEG');
  const inbound = legs.find((l) => l.destinationRef?.value === 'SIN');
  return inbound?.scheduledArrival ?? null;
}

function allowsSlot(arrivalIso, slotStart) {
  if (!arrivalIso) return { ok: true, reason: 'local/no-inbound' };
  const ready = new Date(new Date(arrivalIso).getTime() + BUFFER_MIN * 60_000);
  const ok = ready <= slotStart;
  return {
    ok,
    readyAt: ready.toISOString(),
    gapMin: Math.round((slotStart - new Date(arrivalIso)) / 60_000),
  };
}

const day1 = prog.context.anchorEvent.commitments
  .filter((c) => c.startsAt?.value?.startsWith('2026-10-01'))
  .sort((a, b) => a.startsAt.value.localeCompare(b.startsAt.value));

console.log('Overlay slot: 11:30 SGT; buffer 150min\n');

for (const cmt of day1) {
  const start = new Date(cmt.startsAt.value);
  if (start <= OVERLAY_START) continue;
  const required = requiredByCmt.get(cmt.id) ?? [];
  console.log(`${cmt.id} @ ${cmt.startsAt.value.slice(11, 16)} — ${cmt.title}`);
  if (required.length === 0) {
    console.log('  (no REQUIRED entries)\n');
    continue;
  }
  for (const r of required) {
    const t = travellers.get(r.draftId);
    const arr = sinArrival(t);
    const at1130 = allowsSlot(arr, OVERLAY_START);
    const atOriginal = allowsSlot(arr, start);
    console.log(
      `  ${r.draftId} ${t?.displayName} role=${r.role} home=${t?.homeLocationText}`,
    );
    console.log(`    arrival: ${arr ?? 'LOCAL'} | 11:30 overlay: ${at1130.ok ? 'OK' : 'FAIL'} (${JSON.stringify(at1130)})`);
    console.log(`    original slot: ${atOriginal.ok ? 'OK' : 'FAIL'}`);
  }
  console.log('');
}
