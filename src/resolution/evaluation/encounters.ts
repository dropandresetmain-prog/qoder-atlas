/**
 * NORTHSTAR M6 — border / entry / transit encounter derivation (pure).
 *
 * M6_EVALUATOR_CONTRACT.md §2 L4 "Encounters", shared by `m6.credentials` and
 * `m6.entry`. Feasibility is never a property of a traveller ("canEnter"):
 * it is decided per encounter — one jurisdiction, one instant, one purpose,
 * one set of selected credential editions — derived from the Journey's
 * intended visits and its effective transport route.
 *
 *  - every intended visit is an encounter (TRANSIT when `transitIntent`);
 *  - consecutive active transport items A→B whose connection point lies in a
 *    jurisdiction J that no intended visit covers at A's arrival derive a
 *    TRANSIT encounter with no selections and `airsideFactsKnown: false`
 *    (a connecting place alone never proves airside transit);
 *  - a connection point whose jurisdiction cannot be resolved derives an
 *    encounter with `jurisdictionId: null` (evaluated UNKNOWN, never PASS).
 *
 * Also hosts the date and three-valued helpers both evaluators share.
 * Document validity is a calendar date without a zone; the visit is an
 * instant. The civil date of an instant is only known within the range of
 * real-world UTC offsets, so comparisons are three-valued and a boundary
 * that depends on the unknown zone is UNKNOWN rather than a guessed PASS/FAIL.
 */
import type { Instant } from '../../domain/v2/shared/time.ts';
import type { CapturedWorld, WCredential, WCredentialLink, WCredentialSelection, WCredentialVersion, WIntendedVisit } from '../world/world.ts';
import type { EffectiveJourney } from '../world/effectiveTypes.ts';
import { stableHash } from './explain.ts';

export const DAY_MS = 86_400_000;

/** Kleene three-valued truth value, spelled as verdicts. */
export type Tri = 'PASS' | 'FAIL' | 'UNKNOWN';

export function kleeneAll(values: readonly Tri[]): Tri {
  if (values.length === 0) return 'UNKNOWN';
  if (values.includes('FAIL')) return 'FAIL';
  if (values.includes('UNKNOWN')) return 'UNKNOWN';
  return 'PASS';
}

export function kleeneAny(values: readonly Tri[]): Tri {
  if (values.length === 0) return 'UNKNOWN';
  if (values.includes('PASS')) return 'PASS';
  if (values.includes('UNKNOWN')) return 'UNKNOWN';
  return 'FAIL';
}

export function kleeneNot(value: Tri): Tri {
  return value === 'PASS' ? 'FAIL' : value === 'FAIL' ? 'PASS' : 'UNKNOWN';
}

/** ---- calendar dates ------------------------------------------------------ */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Widest civil offsets in use: UTC−12:00 … UTC+14:00. */
const MIN_OFFSET_MS = -12 * 3_600_000;
const MAX_OFFSET_MS = 14 * 3_600_000;

function validDate(date: string | null | undefined): date is string {
  return typeof date === 'string' && DATE_RE.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00.000Z`));
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The range of calendar dates `instant` can fall on in any civil time zone. */
export function possibleLocalDates(instant: Instant): { earliest: string; latest: string } | undefined {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) return undefined;
  return {
    earliest: new Date(ms + MIN_OFFSET_MS).toISOString().slice(0, 10),
    latest: new Date(ms + MAX_OFFSET_MS).toISOString().slice(0, 10),
  };
}

/** `date ≥ localDate(instant) + offsetDays` */
export function dateOnOrAfterLocalDate(date: string | null, instant: Instant | null, offsetDays = 0): Tri {
  const range = instant ? possibleLocalDates(instant) : undefined;
  if (!validDate(date) || !range) return 'UNKNOWN';
  if (date >= addDays(range.latest, offsetDays)) return 'PASS';
  if (date < addDays(range.earliest, offsetDays)) return 'FAIL';
  return 'UNKNOWN';
}

/** `date ≤ localDate(instant)` */
export function dateOnOrBeforeLocalDate(date: string | null, instant: Instant | null): Tri {
  const range = instant ? possibleLocalDates(instant) : undefined;
  if (!validDate(date) || !range) return 'UNKNOWN';
  if (date <= range.earliest) return 'PASS';
  if (date > range.latest) return 'FAIL';
  return 'UNKNOWN';
}

/** `date > localDate(instant)` */
export function dateAfterLocalDate(date: string | null, instant: Instant | null): Tri {
  const range = instant ? possibleLocalDates(instant) : undefined;
  if (!validDate(date) || !range) return 'UNKNOWN';
  if (date > range.latest) return 'PASS';
  if (date <= range.earliest) return 'FAIL';
  return 'UNKNOWN';
}

/** Inclusive number of calendar days of [from, to] inside [windowStart, windowEnd] (0 when disjoint). */
export function inclusiveOverlapDays(from: string, to: string, windowStart: string, windowEnd: string): number {
  const start = from > windowStart ? from : windowStart;
  const end = to < windowEnd ? to : windowEnd;
  if (end < start) return 0;
  return Math.round((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / DAY_MS) + 1;
}

/** ---- instants ------------------------------------------------------------ */

export function within(interval: { start: Instant | null; end: Instant | null }, at: Instant): boolean {
  const t = Date.parse(at);
  return (interval.start === null || Date.parse(interval.start) <= t) && (interval.end === null || t < Date.parse(interval.end));
}

/** ---- credentials --------------------------------------------------------- */

export const IDENTITY_DOCUMENT_KIND = 'PASSPORT';
export const ENTRY_AUTHORISATION_KINDS: readonly string[] = ['VISA', 'E_AUTHORISATION'];
export const EXPIRY_REQUIRED_KINDS: readonly string[] = ['PASSPORT', 'VISA', 'E_AUTHORISATION'];
export const PASSPORT_LINK_TYPES: readonly string[] = ['VISA_TO_PASSPORT', 'PERMIT_TO_PASSPORT'];

export interface ResolvedSelection {
  selection: WCredentialSelection;
  credential: WCredential | null;
  version: WCredentialVersion | null;
}

export function resolveSelection(world: CapturedWorld, selection: WCredentialSelection): ResolvedSelection {
  return {
    selection,
    credential: world.credentials.find((c) => c.id === selection.credentialId) ?? null,
    version: world.credentialVersions.find((v) => v.id === selection.credentialVersionId) ?? null,
  };
}

/** A selection the traveller can actually present: captured, owned by the traveller, version of that credential. */
export function usableSelection(resolved: ResolvedSelection, travellerId: string): resolved is ResolvedSelection & { credential: WCredential; version: WCredentialVersion } {
  return resolved.credential !== null && resolved.version !== null
    && resolved.credential.travellerId === travellerId && resolved.version.credentialId === resolved.credential.id;
}

export interface LinkCheck {
  status: Tri;
  links: WCredentialLink[];
}

/**
 * Is `credentialId` linked (VISA_TO_PASSPORT / PERMIT_TO_PASSPORT) to one of
 * `passportCredentialIds`, with the link effective over the visit's dates
 * (`effectiveFrom ≤ entry date`, `effectiveTo` open or after the exit date)?
 * No link row ⇒ FAIL; a date boundary that depends on the zone ⇒ UNKNOWN.
 */
export function linkToPassports(world: CapturedWorld, travellerId: string, credentialId: string, passportCredentialIds: readonly string[], entry: Instant | null, exit: Instant | null): LinkCheck {
  const links = world.credentialLinks
    .filter((l) => l.credentialId === credentialId && passportCredentialIds.includes(l.relatedCredentialId) && l.travellerId === travellerId && PASSPORT_LINK_TYPES.includes(l.linkType))
    .sort((a, b) => `${a.relatedCredentialId}:${a.linkType}:${a.effectiveFrom}`.localeCompare(`${b.relatedCredentialId}:${b.linkType}:${b.effectiveFrom}`));
  if (links.length === 0) return { status: 'FAIL', links };
  const status = kleeneAny(links.map((l) => kleeneAll([
    dateOnOrBeforeLocalDate(l.effectiveFrom, entry),
    l.effectiveTo === null ? 'PASS' : dateAfterLocalDate(l.effectiveTo, exit),
  ])));
  return { status, links };
}

/** ---- encounters ---------------------------------------------------------- */

export interface Encounter {
  /** Deterministic id of the encounter (stable hash of its identity). */
  id: string;
  kind: 'ENTRY' | 'TRANSIT';
  origin: 'INTENDED_VISIT' | 'DERIVED_TRANSIT';
  /** null when the connection point's jurisdiction could not be resolved. */
  jurisdictionId: string | null;
  at: Instant | null;
  exit: Instant | null;
  purpose: string | null;
  /** ceil((exit − at) / 1 day); null when either instant is unknown. */
  stayDays: number | null;
  visitId: string | null;
  selections: WCredentialSelection[];
  /** No airside / terminal / baggage-recheck fact model exists: always false. */
  airsideFactsKnown: boolean;
  /** Connection place of a derived encounter. */
  placeId: string | null;
  arrivingItemId: string | null;
  departingItemId: string | null;
}

export function stayDaysBetween(start: Instant | null, end: Instant | null): number | null {
  if (!start || !end) return null;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isNaN(ms) ? null : Math.max(0, Math.ceil(ms / DAY_MS));
}

export function jurisdictionsOfPlace(world: CapturedWorld, placeId: string | null): string[] {
  if (!placeId) return [];
  return [...new Set(world.placeJurisdictions.filter((pj) => pj.placeId === placeId).map((pj) => pj.jurisdictionId))].sort();
}

export function visitsOfJourney(world: CapturedWorld, journeyId: string): WIntendedVisit[] {
  return world.intendedVisits.filter((v) => v.journeyId === journeyId).sort((a, b) => a.intended.start.localeCompare(b.intended.start) || a.id.localeCompare(b.id));
}

export function selectionsForVisit(world: CapturedWorld, journeyId: string, visitId: string): WCredentialSelection[] {
  return world.credentialSelections.filter((s) => s.journeyId === journeyId && s.intendedVisitIds.includes(visitId)).sort((a, b) => a.id.localeCompare(b.id));
}

function encounter(fields: Omit<Encounter, 'id'>): Encounter {
  const id = stableHash({ origin: fields.origin, kind: fields.kind, visitId: fields.visitId, jurisdictionId: fields.jurisdictionId, placeId: fields.placeId, arrivingItemId: fields.arrivingItemId, departingItemId: fields.departingItemId });
  return { id, ...fields };
}

function visitCovers(visits: readonly WIntendedVisit[], jurisdictionId: string, at: Instant | null): boolean {
  if (at === null) return false; // coverage cannot be proven for an unknown arrival time
  const t = Date.parse(at);
  return visits.some((v) => v.jurisdictionId === jurisdictionId && Date.parse(v.intended.start) <= t && t <= Date.parse(v.intended.end));
}

/** Every encounter of one Journey, in a deterministic order. */
export function deriveEncounters(world: CapturedWorld, journey: EffectiveJourney): Encounter[] {
  const journeyId = journey.journeyRef.id;
  const visits = visitsOfJourney(world, journeyId);
  const out = new Map<string, Encounter>();
  const add = (e: Encounter) => out.set(e.id, e);

  for (const visit of visits) {
    add(encounter({
      kind: visit.transitIntent ? 'TRANSIT' : 'ENTRY', origin: 'INTENDED_VISIT', jurisdictionId: visit.jurisdictionId,
      at: visit.intended.start, exit: visit.intended.end, purpose: visit.purpose, stayDays: stayDaysBetween(visit.intended.start, visit.intended.end),
      visitId: visit.id, selections: selectionsForVisit(world, journeyId, visit.id), airsideFactsKnown: false,
      placeId: null, arrivingItemId: null, departingItemId: null,
    }));
  }

  const transports = journey.items.filter((i) => i.active && i.kind === 'TRANSPORT');
  for (let k = 0; k + 1 < transports.length; k += 1) {
    const a = transports[k]!;
    const b = transports[k + 1]!;
    const derived = (jurisdictionId: string | null, placeId: string | null) => encounter({
      kind: 'TRANSIT', origin: 'DERIVED_TRANSIT', jurisdictionId, at: a.end.value, exit: b.start.value, purpose: null,
      stayDays: stayDaysBetween(a.end.value, b.start.value), visitId: null, selections: [], airsideFactsKnown: false,
      placeId, arrivingItemId: a.itemRef.id, departingItemId: b.itemRef.id,
    });
    const arrivalJurisdictions = jurisdictionsOfPlace(world, a.endPlaceId);
    if (arrivalJurisdictions.length === 0) {
      add(derived(null, a.endPlaceId));
      continue;
    }
    const departureJurisdictions = jurisdictionsOfPlace(world, b.startPlaceId);
    for (const jurisdictionId of arrivalJurisdictions) {
      if (visitCovers(visits, jurisdictionId, a.end.value)) continue;
      if (b.startPlaceId !== a.endPlaceId && departureJurisdictions.length === 0) {
        add(derived(null, b.startPlaceId));
        continue;
      }
      if (departureJurisdictions.includes(jurisdictionId)) add(derived(jurisdictionId, a.endPlaceId));
    }
  }

  const order = { INTENDED_VISIT: 0, DERIVED_TRANSIT: 1 } as const;
  return [...out.values()].sort((x, y) => order[x.origin] - order[y.origin] || (x.at ?? '').localeCompare(y.at ?? '') || x.id.localeCompare(y.id));
}
