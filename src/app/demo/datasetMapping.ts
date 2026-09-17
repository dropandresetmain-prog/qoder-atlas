/**
 * Pure mapping rules from the dataset boundary shape onto target ontology
 * values. Everything here is a total function of dataset data — no I/O, no
 * clock, no scenario knowledge — so the mapping decisions are unit-testable
 * on their own and the materializer stays a sequence of commands.
 */
import type {
  DatasetDeclaredTravel,
  DatasetExternalRef,
  DatasetPlace,
  DatasetRule,
} from './datasetSchema.ts';

export class DatasetMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetMappingError';
  }
}

/** Canonical UTC instant. Dataset times carry local offsets; storage does not. */
export function toInstant(value: string, what: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new DatasetMappingError(`${what} is not a parsable instant: ${value}`);
  return new Date(ms).toISOString();
}

/** `[system, value]` key for an external reference the dataset states. */
export function externalRefKey(ref: DatasetExternalRef): string {
  const value = ref.value ?? ref.reference;
  if (!value) throw new DatasetMappingError(`external ref for system ${ref.system} carries neither value nor reference`);
  return `${ref.system}:${value}`;
}

export function externalRefValue(ref: DatasetExternalRef): string {
  const value = ref.value ?? ref.reference;
  if (!value) throw new DatasetMappingError(`external ref for system ${ref.system} carries neither value nor reference`);
  return value;
}

/**
 * Index every way the dataset names a place: its own id and each declared
 * external reference. Travel refers to places through these, never through a
 * generated UUID.
 */
export function indexPlaceAliases(places: readonly DatasetPlace[]): Map<string, string> {
  const index = new Map<string, string>();
  const claim = (alias: string, placeId: string): void => {
    const existing = index.get(alias);
    if (existing !== undefined && existing !== placeId) {
      throw new DatasetMappingError(`place alias ${alias} names both ${existing} and ${placeId}`);
    }
    index.set(alias, placeId);
  };
  for (const place of places) {
    claim(`place-id:${place.id}`, place.id);
    for (const ref of place.externalRefs) claim(externalRefKey(ref), place.id);
  }
  return index;
}

/** Resolve a travel reference to a dataset place id, or fail loudly. */
export function resolveDatasetPlace(aliases: Map<string, string>, ref: DatasetExternalRef): string {
  const direct = aliases.get(externalRefKey(ref));
  if (direct !== undefined) return direct;
  throw new DatasetMappingError(`no place in the dataset answers to ${externalRefKey(ref)}`);
}

/** Transport modes the target model has; anything else is an explicit gap. */
const TRANSPORT_MODE: Record<string, 'AIR' | 'RAIL' | 'ROAD' | 'SEA'> = {
  FLIGHT: 'AIR',
  AIR: 'AIR',
  RAIL: 'RAIL',
  TRAIN: 'RAIL',
  ROAD: 'ROAD',
  CAR: 'ROAD',
  COACH: 'ROAD',
  FERRY: 'SEA',
  SEA: 'SEA',
};

export function transportMode(mode: string): 'AIR' | 'RAIL' | 'ROAD' | 'SEA' {
  const mapped = TRANSPORT_MODE[mode.toUpperCase()];
  if (!mapped) throw new DatasetMappingError(`transport mode ${mode} has no target TransportService mode`);
  return mapped;
}

/**
 * `TransportService.operator` names who operates the service. In the
 * `flight-number` namespace the operating designator is the leading carrier
 * code of the published number — a deterministic read of that namespace's own
 * format, done at the boundary. Any other namespace (or an unparsable value)
 * keeps the stated reference verbatim rather than guessing.
 */
export function serviceOperator(ref: DatasetExternalRef): string {
  const value = externalRefValue(ref);
  if (ref.system !== 'flight-number') return value;
  const designator = /^([A-Z][A-Z0-9]|[A-Z0-9][A-Z]|[A-Z]{3})\s?\d{1,4}[A-Z]?$/.exec(value.toUpperCase());
  return designator?.[1] ?? value;
}

/**
 * Service identity: the same published service is one TransportService no
 * matter how many travellers declare it. Keyed by what the dataset states
 * about the service itself, never by a traveller or booking.
 */
export function serviceKey(leg: Extract<DatasetDeclaredTravel, { itemKind: 'TRANSPORT_LEG' }>): string {
  return [
    externalRefKey(leg.carrierRef),
    toInstant(leg.scheduledDeparture, 'scheduledDeparture'),
    externalRefKey(leg.originRef),
    externalRefKey(leg.destinationRef),
  ].join('|');
}

/** Reservation identity: the booking reference when stated, else the item itself. */
export function reservationKey(item: DatasetDeclaredTravel, travellerKey: string, index: number): string {
  const bookingRef = item.bookingRef;
  return bookingRef ? `booking:${externalRefKey(bookingRef)}` : `item:${travellerKey}#${index}`;
}

const RESERVATION_STATUS: Record<string, 'HELD' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED'> = {
  CONFIRMED: 'CONFIRMED',
  HELD: 'HELD',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
};

/** Observed supplier status, or UNKNOWN when the dataset states none. */
export function reservationStatus(state: string | undefined): 'HELD' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'UNKNOWN' {
  if (state === undefined) return 'UNKNOWN';
  const mapped = RESERVATION_STATUS[state.toUpperCase()];
  if (!mapped) throw new DatasetMappingError(`reservation state ${state} has no target observed status`);
  return mapped;
}

const LINE_STATUS: Record<string, 'HELD' | 'CONFIRMED' | 'CANCELLED' | 'FULFILLED'> = {
  CONFIRMED: 'CONFIRMED',
  HELD: 'HELD',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'FULFILLED',
};

export function reservationLineStatus(state: string | undefined): 'HELD' | 'CONFIRMED' | 'CANCELLED' | 'FULFILLED' | 'UNKNOWN' {
  if (state === undefined) return 'UNKNOWN';
  const mapped = LINE_STATUS[state.toUpperCase()];
  if (!mapped) throw new DatasetMappingError(`reservation state ${state} has no target line status`);
  return mapped;
}

/** Nights a stay requires, from the interval the dataset states. */
export function stayNights(checkIn: string, checkOut: string): number {
  const start = Date.parse(toInstant(checkIn, 'checkIn'));
  const end = Date.parse(toInstant(checkOut, 'checkOut'));
  const nights = Math.ceil((end - start) / 86_400_000);
  if (!Number.isFinite(nights) || nights < 1) {
    throw new DatasetMappingError(`stay ${checkIn}..${checkOut} does not span at least one night`);
  }
  return nights;
}

/**
 * Participation obligation. The target ontology has exactly three tiers; a
 * dataset importance with no distinct tier maps to the nearest weaker one
 * rather than being promoted. `PREFERRED` and `OPTIONAL` therefore both
 * persist as `OPTIONAL` — see the mapping note in the completion report.
 */
export function participationObligation(importance: string): 'REQUIRED' | 'OPTIONAL' | 'INFORMED' {
  switch (importance.toUpperCase()) {
    case 'REQUIRED':
      return 'REQUIRED';
    case 'PREFERRED':
    case 'OPTIONAL':
      return 'OPTIONAL';
    case 'INFORMED':
      return 'INFORMED';
    default:
      throw new DatasetMappingError(`engagement importance ${importance} has no target obligation`);
  }
}

/** Rule keys are `[a-z][a-z0-9_]*` in the target; dataset ids are kebab text. */
export function ruleKey(id: string): string {
  const key = id.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+/, '').replace(/_+$/, '');
  if (!/^[a-z][a-z0-9_]*$/.test(key)) throw new DatasetMappingError(`rule id ${id} has no valid target rule key`);
  return key;
}

/**
 * Policy family for a dataset rule set. Namespaced so an organiser policy
 * family can never collide with a family an evaluator reserves (`entry`,
 * `transit`, `advisory_response`).
 */
export function policyFamily(kind: string): string {
  return `organiser_${kind.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

/** Predicate id for a dataset rule, in the dataset's own namespace. */
export function rulePredicateId(kind: string): string {
  return `organiser.${kind.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

const RULE_META_KEYS = new Set(['id', 'kind', 'sourceId', 'description']);

/**
 * The rule's stated operands, carried verbatim as bounded predicate
 * parameters. Nothing is interpreted here: an evaluator that registers the
 * predicate reads them, and one that does not answers UNKNOWN
 * `predicate_unsupported`.
 */
export function ruleParameters(rule: DatasetRule): Record<string, unknown> {
  const parameters: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rule)) {
    if (RULE_META_KEYS.has(key)) continue;
    if (value === undefined) continue;
    parameters[key] = value;
  }
  return parameters;
}

/** Minutes stated by a duration-estimate-shaped operand, most conservative first. */
export function statedMinutes(value: unknown): number | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ['minimumMinutes', 'expectedMinutes', 'conservativeMinutes']) {
    const candidate = record[key];
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) return Math.trunc(candidate);
  }
  return undefined;
}

/** Zero-padded order key so journey/programme item ordering is stable and total. */
export function orderKey(index: number): string {
  return String((index + 1) * 10).padStart(6, '0');
}
