/**
 * Shared presentation projection helpers (R3A).
 *
 * Pure functions over authoritative entities/trip elements — no scenario
 * branching, no fabricated fields.
 */
import type { EntityId, IsoDateTime } from '../domain/common.ts';
import { compareInstants, instantMillis } from '../domain/common.ts';
import type { AnchorEvent, Place, Traveller } from '../domain/entities.ts';
import type { Engagement, Importance, TransportLeg, TripElement } from '../domain/elements.ts';
import type { Trip } from '../domain/trip.ts';
import type { RecoveryCase } from '../operational/case.ts';
import type { TripSignal } from '../operational/signal.ts';
import type {
  TravellerItineraryRow,
  TravellerProgressRow,
  TravellerThreadMessage,
} from '../ui/traveller-presentation.ts';
import type { AffectedItemView, StatusTimelineEntryView } from '../ui/case-view-model.ts';
import { CHAIN_TYPE_ICON } from '../ui/components.ts';
import { presentAction, presentSignalChange } from './presentation.ts';
import type { ReadModelDependencies } from './readmodels.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const IMPORTANCE_RANK: Record<Importance, number> = {
  REQUIRED: 0,
  PREFERRED: 1,
  OPTIONAL: 2,
};

const PARTICIPANT_ROLE_LABEL: Record<string, string> = {
  HOST: 'Host',
  MODERATOR: 'Moderator',
  SPEAKER: 'Speaker',
  INTERVIEWER: 'Interviewer',
  PANELLIST: 'Panellist',
  JUDGE: 'Judge',
  DRAGON: 'Dragon',
  REFEREE: 'Referee',
  FINALIST: 'Finalist',
  PARTICIPANT: 'Participant',
  FEATURED: 'Featured speaker',
  FACILITATOR: 'Facilitator',
  COACH: 'Coach',
  CURATOR: 'Curator',
};

const SIGNAL_SOURCE_LABEL: Record<TripSignal['kind'], string> = {
  FLIGHT_CANCELLATION: 'Airline cancellation notice',
  FLIGHT_SCHEDULE_CHANGE: 'Airline schedule update',
  FLIGHT_DELAY: 'Airline delay notice',
  BOOKING_STATE_CHANGE: 'Booking status update',
  PROVIDER_EVENT: 'Travel provider update',
  WEATHER_EVENT: 'Weather watch',
  TRAVELLER_INPUT: 'Traveller message',
  OPERATOR_INPUT: 'Operator update',
  ANCHOR_COMMITMENT_CHANGE: 'Programme change',
  OTHER: 'External update',
};

function wallDateParts(iso: IsoDateTime): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return undefined;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Event-local day label for programme timelines, e.g. "Tue 30 Sep". */
export function formatProgrammeDayLabel(iso: IsoDateTime): string {
  const parts = wallDateParts(iso);
  if (!parts) return iso.slice(0, 10);
  const weekday = WEEKDAYS[new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()]!;
  return `${weekday} ${parts.day} ${MONTHS[parts.month - 1] ?? String(parts.month)}`;
}

/** Activity feed day heading, e.g. "Today · Tue 30 Sep". */
export function formatActivityDayLabel(iso: IsoDateTime, generatedAt: IsoDateTime): string {
  const day = formatProgrammeDayLabel(iso);
  const eventDay = iso.slice(0, 10);
  const today = generatedAt.slice(0, 10);
  return eventDay === today ? `Today · ${day}` : day;
}

/** Event-local short instant, e.g. "30 Sep · 07:25". */
export function formatProgrammeInstant(iso: IsoDateTime): string | undefined {
  const parts = wallDateParts(iso);
  const clock = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!parts || !clock) return undefined;
  return `${parts.day} ${MONTHS[parts.month - 1] ?? String(parts.month)} · ${clock[4]}:${clock[5]}`;
}

/** Compact opened-at label for case rails. */
export function formatCaseOpenedAt(iso: IsoDateTime): string {
  const parts = wallDateParts(iso);
  const clock = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!parts || !clock) return formatProgrammeInstant(iso) ?? iso.slice(0, 16);
  return `${parts.day} ${MONTHS[parts.month - 1] ?? String(parts.month)}, ${clock[4]}:${clock[5]}`;
}

export function humanizeParticipantRole(role: string): string {
  return PARTICIPANT_ROLE_LABEL[role] ?? role.charAt(0) + role.slice(1).toLowerCase().replace(/_/g, ' ');
}

export function signalSourceLabel(signal: TripSignal | undefined): string | undefined {
  if (!signal) return undefined;
  const summary = signal.summary?.trim();
  const looksInternal = summary
    ? /provider\s+(flight|stay)\s+state\s*:|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/i.test(summary)
    : true;
  if (summary && !looksInternal) return summary;
  return SIGNAL_SOURCE_LABEL[signal.kind];
}

function placeCode(place: Place | undefined): string | undefined {
  if (!place) return undefined;
  return place.externalRefs.find((ref) => ref.system === 'airport-code')?.value ?? place.name;
}

function primaryEngagementRole(trip: Trip): string | undefined {
  const engagements = trip.elements.filter(
    (element): element is Engagement => element.elementKind === 'ENGAGEMENT',
  );
  const ranked = [...engagements].sort((a, b) => {
    const diff = IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance];
    if (diff !== 0) return diff;
    return a.data.startsAt.value.localeCompare(b.data.startsAt.value);
  });
  for (const engagement of ranked) {
    if (engagement.data.participantRole) return humanizeParticipantRole(engagement.data.participantRole);
  }
  return undefined;
}

export async function projectTravellerRoleLine(
  deps: ReadModelDependencies,
  tripId: EntityId,
  travellerId: EntityId,
): Promise<string | undefined> {
  const trip = await deps.snapshot.trips.getTrip(tripId);
  if (!trip) return undefined;
  const travellerEntry = await deps.snapshot.entities.get('TRAVELLER', travellerId);
  if (travellerEntry?.entityType !== 'TRAVELLER') return undefined;
  const traveller: Traveller = travellerEntry.entity;

  const note = traveller.communicationPreference?.split(';')[0]?.trim();
  if (note) return sanitizeRoleLine(note);

  return primaryEngagementRole(trip);
}

/** Role descriptor shown on operator surfaces; strips internal scenario tokens. */
function sanitizeRoleLine(text: string): string {
  return text
    .replace(/\s*[—–-]\s*S\d+\s+critical\b/gi, ' — critical')
    .replace(/\s*[—–-]\s*S\d+\b/g, '')
    .replace(/\bS\d+\s+critical\b/g, 'critical')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function projectTravellerArrivalSummary(
  deps: ReadModelDependencies,
  tripId: EntityId,
  travellerId: EntityId,
): Promise<string | undefined> {
  const trip = await deps.snapshot.trips.getTrip(tripId);
  if (!trip) return undefined;
  const travellerEntry = await deps.snapshot.entities.get('TRAVELLER', travellerId);
  if (travellerEntry?.entityType !== 'TRAVELLER') return undefined;
  const traveller: Traveller = travellerEntry.entity;

  const places = new Map<string, Place>();
  for (const entry of await deps.snapshot.entities.list('PLACE')) {
    if (entry.entityType === 'PLACE') places.set(entry.entity.id, entry.entity);
  }

  const legs = trip.elements
    .filter(
      (element): element is TransportLeg =>
        element.elementKind === 'TRANSPORT_LEG' && element.data.scheduledArrival !== undefined,
    )
    .sort((a, b) => compareInstants(a.data.scheduledArrival!.value, b.data.scheduledArrival!.value));

  if (legs.length === 0) {
    return traveller.travelArrangement === 'SELF_OR_OTHER_ARRANGED' ? 'Local' : undefined;
  }

  const inbound = legs[legs.length - 1]!;
  const arrival = inbound.data.scheduledArrival!.value;
  const when = formatProgrammeInstant(arrival);
  const code = placeCode(places.get(inbound.data.destinationPlaceId));
  if (when && code) return `${when} · ${code}`;
  return when ?? code;
}

function elementMoment(element: TripElement): IsoDateTime | undefined {
  if (element.elementKind === 'TRANSPORT_LEG') {
    return element.data.scheduledDeparture?.value ?? element.data.scheduledArrival?.value;
  }
  if (element.elementKind === 'STAY') return element.data.checkIn.value;
  return element.data.startsAt.value;
}

function itineraryIcon(element: TripElement): string {
  if (element.elementKind === 'TRANSPORT_LEG') {
    return element.data.mode === 'FLIGHT' ? CHAIN_TYPE_ICON.FLIGHT : CHAIN_TYPE_ICON.GROUND;
  }
  if (element.elementKind === 'STAY') return CHAIN_TYPE_ICON.STAY;
  return CHAIN_TYPE_ICON.COMMITMENT;
}

function itineraryState(
  element: TripElement,
  affected: ReadonlySet<string>,
): Pick<TravellerItineraryRow, 'stateLabel' | 'stateTone'> {
  if (element.status === 'INVALID' || element.reservationState === 'CANCELLED') {
    return { stateLabel: 'Broken', stateTone: 'bad' };
  }
  if (element.status === 'AT_RISK' || affected.has(element.id)) {
    return { stateLabel: 'At risk', stateTone: 'watch' };
  }
  if (element.reservationState === 'UNKNOWN' || element.status === 'UNKNOWN') {
    return { stateLabel: '?', stateTone: 'neutral' };
  }
  if (element.reservationState === 'HELD') {
    return { stateLabel: 'Held', stateTone: 'watch' };
  }
  if (element.elementKind === 'ENGAGEMENT') {
    return { stateLabel: element.importance === 'REQUIRED' ? 'Set' : 'Planned', stateTone: 'ok' };
  }
  return { stateLabel: 'Confirmed', stateTone: 'ok' };
}

function transportTitle(leg: TransportLeg, places: ReadonlyMap<string, Place>): string {
  const origin = placeCode(places.get(leg.data.originPlaceId));
  const destination = placeCode(places.get(leg.data.destinationPlaceId));
  if (origin && destination) return `${origin} → ${destination}`;
  return leg.data.mode === 'FLIGHT' ? 'Flight' : 'Transfer';
}

function transportSub(leg: TransportLeg): string | undefined {
  const departure = leg.data.scheduledDeparture?.value;
  const arrival = leg.data.scheduledArrival?.value;
  const dep = departure ? formatProgrammeInstant(departure) : undefined;
  const arr = arrival ? formatProgrammeInstant(arrival) : undefined;
  if (dep && arr) return `${dep} → ${arr}`;
  return dep ?? arr;
}

function staySub(stay: Extract<TripElement, { elementKind: 'STAY' }>): string | undefined {
  const checkIn = formatProgrammeInstant(stay.data.checkIn.value);
  const checkOut = formatProgrammeInstant(stay.data.checkOut.value);
  if (checkIn && checkOut) return `${checkIn} → ${checkOut}`;
  return checkIn ?? checkOut;
}

export function projectTravellerItinerary(
  trip: Trip,
  places: ReadonlyMap<string, Place>,
  recoveryCase: RecoveryCase | undefined,
  event?: AnchorEvent,
): TravellerItineraryRow[] {
  const affected = new Set(recoveryCase?.affectedElementIds ?? []);
  const ordered = [...trip.elements].sort((a, b) => {
    const aMoment = elementMoment(a);
    const bMoment = elementMoment(b);
    if (aMoment && bMoment) return compareInstants(aMoment, bMoment);
    if (aMoment) return -1;
    if (bMoment) return 1;
    return 0;
  });

  return ordered.map((element) => {
    const state = itineraryState(element, affected);
    if (element.elementKind === 'TRANSPORT_LEG') {
      return {
        icon: itineraryIcon(element),
        title: transportTitle(element, places),
        ...(transportSub(element) ? { sub: transportSub(element) } : {}),
        ...state,
        ...(element.reservationState === 'CANCELLED' || element.status === 'INVALID' ? { struck: true } : {}),
      };
    }
    if (element.elementKind === 'STAY') {
      const place = places.get(element.data.placeId);
      return {
        icon: itineraryIcon(element),
        title: place?.name ?? 'Hotel stay',
        ...(staySub(element) ? { sub: staySub(element) } : {}),
        ...state,
      };
    }
    const commitment = element.data.anchorCommitmentId
      ? event?.commitments.find((candidate) => candidate.id === element.data.anchorCommitmentId)
      : undefined;
    const place = element.data.placeId ? places.get(element.data.placeId) : undefined;
    const meta = [formatProgrammeInstant(element.data.startsAt.value), place?.name].filter(Boolean).join(' · ');
    return {
      icon: itineraryIcon(element),
      title: `Event: ${commitment?.title ?? element.data.title}`,
      ...(meta ? { sub: meta } : {}),
      ...state,
    };
  });
}

export function projectTravellerProgress(recoveryCase: RecoveryCase | undefined): TravellerProgressRow[] {
  if (!recoveryCase) return [];
  const queued = recoveryCase.actionIntents.filter(
    (intent) => intent.status !== 'EXECUTED' && intent.status !== 'FAILED' && intent.status !== 'REJECTED',
  ).length;
  return recoveryCase.actionIntents.map((intent, index, _all) => {
    const state =
      intent.status === 'EXECUTED'
        ? 'done'
        : intent.status === 'EXECUTING'
          ? 'doing'
          : intent.status === 'FAILED' || intent.status === 'REJECTED'
            ? 'failed'
            : 'queued';
    const result = recoveryCase.executionResults.find((candidate) => candidate.intentId === intent.id);
    const detail =
      result?.executedAt
        ? formatProgrammeInstant(result.executedAt)?.split(' · ').pop()
        : state === 'doing' && queued > 1
          ? `${queued - index} left`
          : undefined;
    return {
      state,
      text: presentAction(intent.operation),
      ...(detail ? { detail } : {}),
    };
  });
}

function describeElementLabel(element: TripElement, places: ReadonlyMap<string, Place>): string {
  if (element.elementKind === 'TRANSPORT_LEG') return transportTitle(element, places);
  if (element.elementKind === 'STAY') return places.get(element.data.placeId)?.name ?? 'Stay';
  return `Event: ${element.data.title}`;
}

function elementImpactState(element: TripElement, affected: ReadonlySet<string>): AffectedItemView['state'] {
  if (element.status === 'INVALID' || element.reservationState === 'CANCELLED') return 'BROKEN';
  if (element.status === 'AT_RISK' || affected.has(element.id)) return 'AT_RISK';
  if (element.status === 'UNKNOWN' || element.reservationState === 'UNKNOWN') return 'UNKNOWN';
  return 'INTACT';
}

/** Chronological evidence log from trip signals — never fabricated. */

const TIMELINE_SCHEDULE_KINDS = new Set<TripSignal['kind']>([
  'FLIGHT_SCHEDULE_CHANGE',
  'FLIGHT_DELAY',
  'FLIGHT_CANCELLATION',
]);

function formatDelayMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

/**
 * Real flight-state timing detail for a schedule signal, from the signal's
 * structured payload plus the affected leg's authoritative endpoints.
 * Delta lines appear only when the payload actually carries a previous
 * scheduled instant — nothing is inferred or fabricated.
 */
function flightTimingDetail(
  signal: TripSignal,
  context: { places: ReadonlyMap<string, Place>; trip: Trip } | undefined,
): string | undefined {
  if (!TIMELINE_SCHEDULE_KINDS.has(signal.kind)) return undefined;
  const payload = signal.payload ?? {};
  const iso = (key: string): IsoDateTime | undefined => {
    const value = payload[key];
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? (value as IsoDateTime) : undefined;
  };
  const newArrival = iso('newArrival');
  const newDeparture = iso('newDeparture');
  const previousArrival = iso('previousArrival');
  if (!newArrival && !newDeparture) return undefined;

  const flightNumber = typeof payload['flightNumber'] === 'string' ? payload['flightNumber'].trim() : '';
  const carrierCode = typeof payload['carrierCode'] === 'string' ? payload['carrierCode'].trim() : '';
  // The provider flight number often already embeds the carrier code
  // ("ZG023" for carrier "ZG") — never double-prefix.
  const flight =
    flightNumber && carrierCode && flightNumber.toUpperCase().startsWith(carrierCode.toUpperCase())
      ? flightNumber
      : [carrierCode, flightNumber].filter(Boolean).join('') || undefined;

  const leg = signal.subjectRef?.id
    ? context?.trip.elements.find(
        (element): element is TransportLeg =>
          element.id === signal.subjectRef?.id && element.elementKind === 'TRANSPORT_LEG',
      )
    : undefined;
  const destination = leg && context ? placeCode(context.places.get(leg.data.destinationPlaceId)) : undefined;
  const origin = leg && context ? placeCode(context.places.get(leg.data.originPlaceId)) : undefined;
  const clock = (value: IsoDateTime): string | undefined =>
    formatProgrammeInstant(value)?.split(' · ')[1] ?? formatProgrammeInstant(value);

  const parts: string[] = [];
  if (previousArrival && newArrival) {
    const minutes = Math.round((instantMillis(newArrival) - instantMillis(previousArrival)) / 60_000);
    if (minutes > 0) parts.push(`Flight delayed by ${formatDelayMinutes(minutes)}.`);
  }
  if (newArrival && destination) {
    parts.push(`New timing: ${flight ?? 'the flight'} arrives in ${destination} at ${clock(newArrival) ?? newArrival}.`);
  } else if (newDeparture && origin) {
    parts.push(`New timing: ${flight ?? 'the flight'} departs ${origin} at ${clock(newDeparture) ?? newDeparture}.`);
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

export function projectStatusTimeline(
  signals: readonly TripSignal[],
  recoveryCase?: RecoveryCase,
  input?: {
    connectionImpossible?: boolean;
    /** Endpoint/airport resolution for flight-timing details. */
    timing?: { places: ReadonlyMap<string, Place>; trip: Trip };
  },
): StatusTimelineEntryView[] {
  if (signals.length === 0) return [];
  const sorted = [...signals].sort((a, b) => compareInstants(a.occurredAt, b.occurredAt));
  const progressive = sorted.filter((signal) => TIMELINE_SCHEDULE_KINDS.has(signal.kind));
  const source = progressive.length > 1 ? progressive : sorted.length > 1 ? sorted : [];

  const entries: StatusTimelineEntryView[] = source.map((signal, index) => {
    const isLast = index === source.length - 1;
    const detail = flightTimingDetail(signal, input?.timing);
    const tone: StatusTimelineEntryView['tone'] = isLast
      ? input?.connectionImpossible
        ? 'alert'
        : 'watch'
      : 'neutral';
    return {
      id: `timeline-${signal.id}`,
      at: signal.occurredAt,
      label: presentSignalChange(signal),
      ...(detail ? { detail } : {}),
      tone,
    };
  });

  if (
    recoveryCase &&
    recoveryCase.status !== 'DETECTED' &&
    recoveryCase.status !== 'RESOLVED' &&
    entries.length > 0
  ) {
    entries.push({
      id: `timeline-recovery-${recoveryCase.id}`,
      at: recoveryCase.openedAt,
      label: 'Northstar opened recovery',
      tone: 'watch',
    });
  }

  return entries;
}

/** Rich per-item impact rows for case "What this affects". */
export function projectAffectedItemViews(
  trip: Trip,
  recoveryCase: RecoveryCase,
  places: ReadonlyMap<string, Place>,
): AffectedItemView[] {
  const affected = new Set(recoveryCase.affectedElementIds);
  const ids = new Set<string>([
    ...recoveryCase.affectedElementIds,
    ...trip.elements.filter((element) => element.status === 'INVALID' || element.status === 'AT_RISK').map((e) => e.id),
  ]);
  return [...ids]
    .map((id) => trip.elements.find((element) => element.id === id))
    .filter((element): element is TripElement => Boolean(element))
    .map((element) => {
      const state = elementImpactState(element, affected);
      let detail: string | undefined;
      if (element.elementKind === 'TRANSPORT_LEG') detail = transportSub(element);
      if (element.elementKind === 'STAY') detail = staySub(element);
      if (element.elementKind === 'ENGAGEMENT') {
        detail = formatProgrammeInstant(element.data.startsAt.value);
      }
      return {
        label: describeElementLabel(element, places),
        ...(detail ? { detail } : {}),
        state,
      };
    });
}

/** Short consequence chip from objective/rejection evidence — never scenario-specific. */
export function optionFlagsFromEvidence(input: {
  feasible: boolean;
  criticalObjectiveAtRisk?: string;
  rejectionReason?: string;
}): string[] {
  const flags: string[] = [];
  if (input.feasible && input.criticalObjectiveAtRisk) {
    const clause = input.criticalObjectiveAtRisk.split(/[—–.-]/)[0]?.trim();
    if (clause) flags.push(clause.length > 48 ? `${clause.slice(0, 45)}…` : clause);
  }
  if (!input.feasible && input.rejectionReason) {
    const clause = input.rejectionReason.split(/[.!]/)[0]?.trim();
    if (clause) flags.push(clause.length > 48 ? `${clause.slice(0, 45)}…` : clause);
  }
  return flags;
}

/** Thread messages from traveller signals and recorded approvals — no invented chat. */
export function projectTravellerThreadMessages(
  signals: readonly TripSignal[],
  recoveryCase: RecoveryCase | undefined,
  travellerName: string | undefined,
): TravellerThreadMessage[] {
  const messages: TravellerThreadMessage[] = [];
  for (const signal of signals) {
    if (signal.kind !== 'TRAVELLER_INPUT') continue;
    const body = signal.summary?.trim();
    if (!body) continue;
    messages.push({
      from: 'me',
      meta: formatProgrammeInstant(signal.occurredAt) ?? signal.occurredAt.slice(11, 16),
      body,
    });
  }
  if (recoveryCase) {
    for (const decision of recoveryCase.authorityDecisions) {
      if (decision.outcome !== 'REQUIRES_TRAVELLER' || !decision.approval) continue;
      const verdict = decision.approval.decision === 'APPROVED' ? 'Approved' : 'Declined';
      messages.push({
        from: 'me',
        meta: formatProgrammeInstant(decision.approval.decidedAt) ?? decision.approval.decidedAt.slice(11, 16),
        body: `${verdict} the proposed change.`,
      });
    }
    const pending = recoveryCase.authorityDecisions.find(
      (decision) => decision.outcome === 'REQUIRES_TRAVELLER' && decision.approval === undefined,
    );
    if (pending) {
      messages.push({
        from: 'ns',
        meta: formatProgrammeInstant(pending.decidedAt) ?? pending.decidedAt.slice(11, 16),
        body: `Hi${travellerName ? ` ${travellerName.split(' ')[0]}` : ''} — we need your decision on the proposed change.`,
      });
    }
  }
  for (const signal of signals) {
    if (signal.kind === 'TRAVELLER_INPUT') continue;
    const body = presentSignalChange(signal);
    messages.push({
      from: 'ns',
      meta: formatProgrammeInstant(signal.occurredAt) ?? signal.occurredAt.slice(11, 16),
      body,
    });
  }
  return messages;
}
