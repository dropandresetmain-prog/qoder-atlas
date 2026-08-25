/**
 * Build the canonical AiT programme bundle from the integrated AiT demo
 * input pack (data/ait-demo-input-pack).
 *
 * The pack is the authoritative source world; this script performs a purely
 * mechanical, deterministic conversion into the frozen ProgrammeBundleSchema
 * shape that `seedProgrammeBundle` ingests through the SAME validated intake
 * services the HTTP surface uses. It invents no facts:
 *   - roster.json travellers become import drafts;
 *   - itinerary-shaped documents discovered under any scenario inputs/
 *     directory (single baselines or `itineraries[]` collections, keyed by
 *     their own `draftId`) become that traveller's declaredTravel items with
 *     generic place refs (airport-code / place-id);
 *   - booking/order references are harvested from any pack document that
 *     carries them together with a draft/traveller identity (top-level
 *     `pnr`/`orderRefs` + `passenger.draftId`, or `ticketedManagedTravellers`
 *     entries), and attached only to legs whose origin/destination corridor
 *     (and, where stated, flight number) matches the referenced segments.
 *     References are attached verbatim — never suffixed, split or invented;
 *   - programme-importance.json entries become engagementImportance;
 *   - anchor-event.json provides context.anchorEvent + organisation;
 *   - places.json provides context.places;
 *   - organiser-policy.json ruleSets provide context.ruleSets.
 *
 * Input normalization (documented seam behaviour, engine contracts untouched):
 * date-only accommodation dates are converted to the stay place's local
 * midnight using the Place timezone from places.json. Interpretation is
 * conservative (the covered window STARTS at that instant); property-level
 * check-in/out clock times remain UNKNOWN until LIVE hotel enrichment.
 *
 * Anti-hardcoding: nothing branches on scenario ids, traveller names,
 * locations or dates. Baselines and booking references are discovered
 * structurally and attributed purely by the identities they declare.
 *
 * Run: node --experimental-strip-types scripts/build-ait-canonical-programme.ts
 * Idempotent: writes the same bytes for the same pack inputs.
 */
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const PACK_ROOT = 'data/ait-demo-input-pack';

/** Arbitrary JSON document shape at the pack-import boundary (untyped source data). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonDoc = Record<string, any>;

/**
 * Canonical programme output under fixtures/programmes/ so composeAppRuntime
 * boot-seeds this pack as the sole programme world. Rebuild after pack edits:
 *   node --experimental-strip-types scripts/build-ait-canonical-programme.ts
 */
const OUT_DIR = 'fixtures/programmes/ait-summit-2026';

function readJson(path: string): JsonDoc {
  return JSON.parse(readFileSync(join(PACK_ROOT, path), 'utf8'));
}

/** Every JSON document in the pack with its pack-relative path. */
function collectPackDocuments(): Array<{ path: string; doc: JsonDoc }> {
  const docs: Array<{ path: string; doc: JsonDoc }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.json')) {
        try {
          docs.push({ path: relative(PACK_ROOT, full), doc: JSON.parse(readFileSync(full, 'utf8')) });
        } catch {
          // Non-JSON-parseable files are not pack documents; skip silently.
        }
      }
    }
  };
  walk(PACK_ROOT);
  return docs;
}

interface PackLeg {
  flightNumber?: string;
  origin?: string;
  destination?: string;
  departure?: string;
  arrival?: string;
}
interface PackStay {
  placeId?: string;
  checkIn?: string;
  checkOut?: string;
  guests?: number;
}
interface PackBaseline {
  status?: string;
  provenance?: string;
  inboundItinerary?: { segments?: PackLeg[] };
  outboundItinerary?: { segments?: PackLeg[] };
  hotelStay?: PackStay;
  hotel?: PackStay;
}

const BOOKED_STATES = new Set(['TICKETED', 'BOOKED']);
const PLANNING_PROVENANCE = 'SIMULATED_EXTERNAL_EVENT';

function isBookedBaseline(candidate: PackBaseline): boolean {
  if (candidate.provenance === PLANNING_PROVENANCE) return false;
  // An explicit non-booked status marks planning state; absence of status is
  // accepted only because the pack's booking-plan baselines carry none.
  if (typeof candidate.status === 'string' && !BOOKED_STATES.has(candidate.status.toUpperCase())) {
    return false;
  }
  return true;
}

/**
 * Discover every booked/organiser-planned baseline in the pack indexed by the
 * draftId it declares. Handles both shapes the pack uses:
 *   - a single object carrying `draftId` + itinerary/stay fields;
 *   - a collection `{ itineraries: [...] }` whose members carry the same shape.
 */
function discoverBaselines(docs: Array<{ path: string; doc: JsonDoc }>): Map<string, PackBaseline> {
  const byDraft = new Map<string, PackBaseline>();
  const consider = (candidate: JsonDoc, source: string): void => {
    if (!candidate || typeof candidate !== 'object') return;
    const isItineraryShape =
      typeof candidate.draftId === 'string' &&
      (candidate.inboundItinerary !== undefined ||
        candidate.outboundItinerary !== undefined ||
        candidate.segments !== undefined ||
        candidate.hotelStay !== undefined ||
        candidate.hotel !== undefined);
    if (!isItineraryShape) return;
    if (!isBookedBaseline(candidate)) return;
    if (byDraft.has(candidate.draftId)) {
      throw new Error(`conflicting baselines for ${candidate.draftId} (${source})`);
    }
    byDraft.set(candidate.draftId, candidate as PackBaseline);
  };
  for (const { path, doc } of docs) {
    consider(doc, path);
    if (Array.isArray(doc?.itineraries)) {
      for (const member of doc.itineraries) consider(member, path);
    }
  }
  return byDraft;
}

/**
 * Harvested provider booking identity: the reference verbatim, plus the
 * segment evidence the source declared for it (corridor tokens like
 * "KUL-SIN", optionally with a flight number).
 */
interface HarvestedRef {
  reference: string;
  corridors: Array<{ origin: string; destination: string; flightNumber?: string }>;
}
interface HarvestedBookingIdentity {
  refs: HarvestedRef[];
  /** Source paths the identity came from (for build warnings). */
  sources: string[];
}

/** Parse a provider segment token such as "MNL-SIN MN204" or "SYD-KUL MN202 (unaffected)". */
function parseSegmentToken(token: string): { origin: string; destination: string; flightNumber?: string } | undefined {
  const corridorMatch = token.match(/\b([A-Za-z]{3})\s*[-–>]{1,2}\s*([A-Za-z]{3})\b/);
  if (!corridorMatch) return undefined;
  const flightMatch = token.match(/\b([A-Z]{2}\d{1,4}[A-Z]?)\b/);
  return {
    origin: corridorMatch[1]!.toUpperCase(),
    destination: corridorMatch[2]!.toUpperCase(),
    ...(flightMatch ? { flightNumber: flightMatch[1]!.toUpperCase() } : {}),
  };
}

/**
 * Collect provider booking/order references for every draft they name.
 * Recognized structures (all pack conventions, applied generically):
 *   - `{ passenger: { draftId }, pnr: "X" | orderRefs: [...], segments: [...] }`
 *   - `{ ticketedManagedTravellers: [{ draftId, pnr, segments: ["ORG-DST FLT"] }] }`
 * Segment evidence keeps whatever form the source used: structured leg objects
 * (origin/destination/flightNumber) or descriptive tokens.
 */
function harvestBookingIdentity(docs: Array<{ path: string; doc: JsonDoc }>): Map<string, HarvestedBookingIdentity> {
  const byDraft = new Map<string, HarvestedBookingIdentity>();
  const addRef = (draftId: string, ref: HarvestedRef, source: string): void => {
    const existing = byDraft.get(draftId) ?? { refs: [], sources: [] };
    if (!existing.refs.some((candidate) => candidate.reference === ref.reference)) {
      existing.refs.push(ref);
    }
    if (!existing.sources.includes(source)) existing.sources.push(source);
    byDraft.set(draftId, existing);
  };

  for (const { path, doc } of docs) {
    if (!doc || typeof doc !== 'object') continue;

    // Shape A: provider-state style — one passenger, reference + segments.
    const passengerDraft =
      typeof doc.passenger?.draftId === 'string'
        ? doc.passenger.draftId
        : typeof doc.draftId === 'string'
          ? doc.draftId
          : undefined;
    const topRef =
      typeof doc.pnr === 'string'
        ? doc.pnr
        : typeof doc.orderRef === 'string'
          ? doc.orderRef
          : undefined;
    if (passengerDraft && topRef) {
      const corridors: HarvestedRef['corridors'] = [];
      for (const segment of Array.isArray(doc.segments) ? doc.segments : []) {
        if (typeof segment?.origin === 'string' && typeof segment?.destination === 'string') {
          corridors.push({
            origin: segment.origin.toUpperCase(),
            destination: segment.destination.toUpperCase(),
            ...(typeof segment.flightNumber === 'string'
              ? { flightNumber: segment.flightNumber.toUpperCase() }
              : {}),
          });
        } else if (typeof segment === 'string') {
          const parsed = parseSegmentToken(segment);
          if (parsed) corridors.push(parsed);
        }
      }
      addRef(passengerDraft, { reference: topRef, corridors }, path);
    }

    // Shape B: managed-traveller lists naming several drafts.
    for (const managed of Array.isArray(doc.ticketedManagedTravellers) ? doc.ticketedManagedTravellers : []) {
      if (typeof managed?.draftId !== 'string' || typeof managed?.pnr !== 'string') continue;
      const corridors: HarvestedRef['corridors'] = [];
      for (const token of Array.isArray(managed.segments) ? managed.segments : []) {
        if (typeof token !== 'string') continue;
        const parsed = parseSegmentToken(token);
        if (parsed) corridors.push(parsed);
      }
      addRef(managed.draftId, { reference: managed.pnr, corridors }, path);
    }
  }
  return byDraft;
}

/**
 * Attach harvested references to one draft's legs by segment evidence. A leg
 * receives a reference only when a harvested corridor matches its
 * origin/destination (and flight number where the evidence states one).
 * Ambiguity (two different references claim the same leg) fails closed: the
 * leg keeps NO reference and a warning is reported. References are attached
 * verbatim — a real PNR covering several segments stays one reference.
 */
function attachBookingRefs(
  legs: Array<PackLeg & { booking?: HarvestedRef }>,
  identity: HarvestedBookingIdentity | undefined,
): { warnings: string[] } {
  const warnings: string[] = [];
  if (!identity) return { warnings };
  for (const [index, leg] of legs.entries()) {
    const candidates = identity.refs.filter((ref) =>
      ref.corridors.some(
        (corridor) =>
          corridor.origin === leg.origin?.toUpperCase() &&
          corridor.destination === leg.destination?.toUpperCase() &&
          (corridor.flightNumber === undefined ||
            leg.flightNumber === undefined ||
            corridor.flightNumber === leg.flightNumber.toUpperCase()),
      ),
    );
    const distinct = [...new Set(candidates.map((candidate) => candidate.reference))];
    if (distinct.length > 1) {
      warnings.push(
        `leg ${index + 1} (${leg.origin}-${leg.destination}) claimed by ${distinct.length} references (${distinct.join(', ')}); left without booking identity`,
      );
      continue;
    }
    if (distinct.length === 1) leg.booking = candidates[0];
  }
  return { warnings };
}

/** Offset (ms) of a timezone at the given instant (Intl-based, DST-aware). */
function timezoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(instantMs))
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instantMs;
}

/**
 * INPUT NORMALIZATION (pack->bundle seam only): a date-only accommodation
 * date becomes the instant of local midnight in the stay place's timezone,
 * emitted as UTC ISO. Deterministic for a given pack + tz database. The
 * interpretation is deliberately conservative (window start-of-day); real
 * property check-in/out times stay unknown to the engine.
 */
function dateOnlyToLocalMidnightIso(dateOnly: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return dateOnly;
  const naiveUtc = Date.parse(`${dateOnly}T00:00:00Z`);
  let guess = naiveUtc;
  for (let i = 0; i < 3; i += 1) {
    guess = naiveUtc - timezoneOffsetMs(guess, timeZone);
  }
  return new Date(guess).toISOString();
}

const roster = readJson('global/roster.json');
const anchorEventDoc = readJson('global/anchor-event.json');
const placesDoc = readJson('global/places.json');
const policyDoc = readJson('global/organiser-policy.json');
const importanceDoc = readJson('global/programme-importance.json');

const packDocuments = collectPackDocuments();
const baselinesByDraft = discoverBaselines(packDocuments);
const bookingsByDraft = harvestBookingIdentity(packDocuments);

const timezoneByPlaceId = new Map<string, string>(
  (placesDoc.places ?? [])
    .filter((place: JsonDoc) => typeof place?.id === 'string' && typeof place?.timezone === 'string')
    .map((place: JsonDoc) => [place.id, place.timezone]),
);

/** One pack leg -> generic declared TRANSPORT_LEG item (booking refs attached later). */
function legToDeclared(leg: PackLeg & { booking?: HarvestedRef }): JsonDoc | undefined {
  if (!leg.origin || !leg.destination || !leg.departure || !leg.arrival) return undefined;
  return {
    itemKind: 'TRANSPORT_LEG',
    mode: 'FLIGHT',
    originRef: { system: 'airport-code', value: leg.origin },
    destinationRef: { system: 'airport-code', value: leg.destination },
    scheduledDeparture: leg.departure,
    scheduledArrival: leg.arrival,
    carrierRef: leg.flightNumber ? { system: 'flight-number', value: leg.flightNumber } : undefined,
    bookingRef: leg.booking ? { system: 'pnr', reference: leg.booking.reference } : undefined,
    flexibility: 'CHANGEABLE',
    reservationState: 'CONFIRMED',
  };
}

let stayDatesNormalized = 0;
let legsTotal = 0;
let staysTotal = 0;
let legsMissingBookingIdentity = 0;

/**
 * Convert one traveller's baseline into declaredTravel items. Legs keep the
 * baseline's order so multi-leg journeys stay deterministic; a hotel stay
 * becomes one STAY item with date-only dates normalized to place-local
 * midnight (see normalization note above).
 */
function declaredTravelFor(baseline: PackBaseline | undefined, draftId: string): unknown[] {
  if (!baseline) return [];
  const items: unknown[] = [];
  // Baselines express legs either as directional itineraries or as one flat
  // `segments` collection (the pack's shared-itinerary form).
  const legs: Array<PackLeg & { booking?: HarvestedRef }> = [
    ...(baseline.inboundItinerary?.segments ?? []),
    ...(baseline.outboundItinerary?.segments ?? []),
    ...(Array.isArray((baseline as JsonDoc).segments) ? (baseline as JsonDoc).segments : []),
  ];
  legsTotal += legs.length;
  const { warnings } = attachBookingRefs(legs, bookingsByDraft.get(draftId));
  for (const warning of warnings) console.warn(`[${draftId}] ${warning}`);
  legsMissingBookingIdentity += legs.filter((leg) => leg.origin && !leg.booking).length;
  for (const leg of legs) {
    const declared = legToDeclared(leg);
    if (declared) items.push(declared);
  }
  const stay = baseline.hotelStay ?? baseline.hotel;
  if (stay?.placeId && stay.checkIn && stay.checkOut) {
    const timeZone = timezoneByPlaceId.get(stay.placeId);
    if (!timeZone) {
      throw new Error(`stay place ${stay.placeId} (${draftId}) has no timezone in places.json; refusing to normalize dates`);
    }
    const checkIn = dateOnlyToLocalMidnightIso(stay.checkIn, timeZone);
    const checkOut = dateOnlyToLocalMidnightIso(stay.checkOut, timeZone);
    if (checkIn !== stay.checkIn || checkOut !== stay.checkOut) stayDatesNormalized += 1;
    staysTotal += 1;
    items.push({
      itemKind: 'STAY',
      stayPlaceRef: { system: 'place-id', value: stay.placeId },
      checkIn,
      checkOut,
      ...(typeof stay.guests === 'number' ? { guests: stay.guests } : {}),
      reservationState: 'CONFIRMED',
    });
  }
  return items;
}

// Per-draft importance entries grouped from the pack's flat list.
const importanceByDraft = new Map<string, unknown[]>();
for (const entry of importanceDoc.entries ?? []) {
  const list = importanceByDraft.get(entry.draftId) ?? [];
  list.push({
    commitmentId: entry.commitmentId,
    role: entry.role,
    importance: entry.importance,
    flexibility: entry.flexibility,
  });
  importanceByDraft.set(entry.draftId, list);
}

// Booking identity the pack supplies for drafts that have no discovered
// baseline legs (or whose corridors matched nothing) — reported, never invented.
for (const [draftId, identity] of bookingsByDraft) {
  if (!baselinesByDraft.has(draftId)) {
    console.warn(`booking identity for ${draftId} (${identity.refs.map((r) => r.reference).join(', ')}) names no discovered baseline itinerary`);
  }
}

// Anchor-event commitments must exist before promotion validates drafts.
const commitmentIds = new Set<string>(
  anchorEventDoc.anchorEvent.commitments.map((c: JsonDoc) => c.id as string),
);

let travellersWithTravel = 0;
const travellers = roster.importDraft.travellers.map((traveller: JsonDoc) => {
  const baseline = baselinesByDraft.get(traveller.draftId);
  const declaredTravel = declaredTravelFor(baseline, traveller.draftId);
  if (declaredTravel.length > 0) travellersWithTravel += 1;
  return {
    draftId: traveller.draftId,
    displayName: traveller.displayName,
    identity: traveller.identity ?? {},
    homeLocationText: traveller.homeLocationText,
    nationalityCodes: traveller.nationalityCodes ?? [],
    notes: traveller.notes ?? [],
    accessibilityStatements: traveller.accessibilityStatements ?? [],
    anchorCommitmentIds: (traveller.anchorCommitmentIds ?? []).filter((id: string) =>
      commitmentIds.has(id),
    ),
    travelArrangement: traveller.travelArrangement,
    declaredTravel,
    engagementImportance: importanceByDraft.get(traveller.draftId) ?? [],
  };
});

const unresolvedFromRoster: string[] = roster.importDraft.unresolvedStatements ?? [];

const bundle = {
  context: {
    at: roster.importDraft.receivedAt,
    sourceId: roster.importDraft.sourceId,
    organisation: anchorEventDoc.organisation,
    anchorEvent: anchorEventDoc.anchorEvent,
    places: placesDoc.places,
    ruleSets: policyDoc.ruleSets,
  },
  importDraft: {
    id: roster.importDraft.id,
    anchorEventId: roster.importDraft.anchorEventId,
    channel: roster.importDraft.channel,
    sourceId: roster.importDraft.sourceId,
    receivedAt: roster.importDraft.receivedAt,
    travellers,
    unresolvedStatements: unresolvedFromRoster,
  },
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'programme.json'), `${JSON.stringify(bundle, null, 2)}\n`);
console.log(
  `wrote ${join(OUT_DIR, 'programme.json')}: ${travellers.length} travellers ` +
    `(${travellersWithTravel} with declared travel: ${legsTotal} legs / ${staysTotal} stays; ` +
    `${legsMissingBookingIdentity} legs without booking identity, ` +
    `${stayDatesNormalized} stays normalized from date-only inputs), ` +
    `${bundle.context.places.length} places, ${bundle.context.ruleSets.length} rule sets`,
);
