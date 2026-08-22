/**
 * B2 — normalization of validated extraction DTOs into schema-shaped
 * proposals: places, anchor events, transport legs, stays, engagements and
 * disruption signals.
 *
 * Everything here is deterministic: provenance/authority come from the
 * SourceRecord, never from the extractor. Missing or ambiguous data becomes
 * absent optional fields, UNKNOWN reservation state, or explicit uncertainty —
 * never fabricated certainty. Documented deterministic defaults are used where
 * the frozen schema requires a value the source does not state.
 */
import {
  IsoDateTimeSchema,
  type EntityId,
  type EntityType,
  type IsoDateTime,
} from '../domain/common.ts';
import { ReservationStateSchema, type ReservationState } from '../domain/elements.ts';
import { ENTITY_SCHEMA_BY_TYPE, type MutationOperation, type MutationOrigin } from '../operational/mutation.ts';
import { TripSignalSchema } from '../operational/signal.ts';
import {
  addUncertainty,
  emptyArtifacts,
  pushProposal,
  type IngestionArtifacts,
  type NormalizationEnv,
} from './artifacts.ts';
import { hashId } from './ids.ts';
import { ruleDraftsToRuleSet } from './ruleSets.ts';
import type {
  ExtractedAnchorEvent,
  ExtractedFlightBooking,
  ExtractedSignal,
  ExtractedStayBooking,
} from './semantic.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseInstant(
  env: NormalizationEnv,
  artifacts: IngestionArtifacts,
  raw: string | undefined,
  what: string,
): IsoDateTime | undefined {
  if (raw === undefined) return undefined;
  const parsed = IsoDateTimeSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  addUncertainty(artifacts, env, `${what} is not a valid ISO-8601 timestamp with UTC offset: ${raw}`, 'MEDIUM');
  return undefined;
}

/** Fact wrapper carrying source/authority/freshness from the source record. */
function fact(value: IsoDateTime, env: NormalizationEnv) {
  return {
    value,
    sourceId: env.source.id,
    authority: env.source.authority,
    observedAt: env.now,
  };
}

/**
 * Validate an entity payload against the frozen ENTITY_SCHEMA_BY_TYPE registry
 * and push it as an UPSERT_ENTITY proposal. Invalid payloads become
 * uncertainty; they never reach the mutation service.
 */
function pushEntityProposal(
  artifacts: IngestionArtifacts,
  env: NormalizationEnv,
  origin: MutationOrigin,
  entityType: EntityType,
  entity: unknown,
  rationale: string,
): boolean {
  const parsed = ENTITY_SCHEMA_BY_TYPE[entityType].safeParse(entity);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    addUncertainty(artifacts, env, `${entityType} payload failed schema validation: ${issues.join('; ')}`, 'HIGH');
    return false;
  }
  const operations: MutationOperation[] = [
    {
      op: 'UPSERT_ENTITY',
      entityType,
      id: (parsed.data as { id: EntityId }).id,
      data: parsed.data,
    },
  ];
  pushProposal(artifacts, env, origin, operations, rationale);
  return true;
}

function parseReservationStatus(raw: string | undefined): ReservationState | undefined {
  if (!raw) return undefined;
  const parsed = ReservationStateSchema.safeParse(raw.trim().toUpperCase());
  return parsed.success ? parsed.data : undefined;
}

// ---------------------------------------------------------------------------
// Anchor events (webpage/schedule/briefing)
// ---------------------------------------------------------------------------

export function normalizeExtractedAnchorEvent(
  env: NormalizationEnv,
  extracted: ExtractedAnchorEvent,
  origin: MutationOrigin,
): IngestionArtifacts {
  const artifacts = emptyArtifacts();

  // Venue place (context-level; usable even without a trip yet).
  let venuePlaceId: EntityId | undefined;
  if (extracted.venue && (extracted.venue.name || extracted.venue.timezone)) {
    venuePlaceId = hashId('place', env.source.id, extracted.venue.name ?? '', 'VENUE');
    pushEntityProposal(
      artifacts,
      env,
      origin,
      'PLACE',
      {
        id: venuePlaceId,
        ...(extracted.venue.name ? { name: extracted.venue.name } : {}),
        kind: 'VENUE',
        ...(extracted.venue.timezone ? { timezone: extracted.venue.timezone } : {}),
      },
      'Event venue place from ingested source',
    );
  }

  const name = extracted.name ?? env.source.title;
  if (!name) {
    addUncertainty(artifacts, env, 'Anchor event name could not be determined from source', 'HIGH');
    return artifacts;
  }
  const startsAt = parseInstant(env, artifacts, extracted.startsAt, 'Anchor event start');
  const endsAt = parseInstant(env, artifacts, extracted.endsAt, 'Anchor event end');
  if (!startsAt || !endsAt) {
    addUncertainty(
      artifacts,
      env,
      'Anchor event time window is incomplete or unparseable; event entity was not created',
      'HIGH',
    );
    return artifacts;
  }

  let organiserId: EntityId | undefined;
  if (extracted.organiserName) {
    organiserId = hashId('org', env.source.id, extracted.organiserName);
    pushEntityProposal(
      artifacts,
      env,
      origin,
      'ORGANISATION',
      { id: organiserId, name: extracted.organiserName, roles: ['EVENT_ORGANISER'] },
      'Event organiser organisation from ingested source',
    );
  }

  const anchorId = hashId('anchor', env.source.id, name, startsAt);
  pushEntityProposal(
    artifacts,
    env,
    origin,
    'ANCHOR_EVENT',
    {
      id: anchorId,
      name,
      kind: extracted.kind ?? 'OTHER',
      ...(venuePlaceId ? { placeId: venuePlaceId } : {}),
      window: { startsAt, endsAt },
      ...(organiserId ? { organiserOrganisationId: organiserId } : {}),
      ...(extracted.instructions
        ? { instructions: fact(extracted.instructions, env) }
        : {}),
      sourceIds: [env.source.id],
    },
    'Anchor event from ingested source',
  );

  if (extracted.policyRules && extracted.policyRules.length > 0) {
    const ruleSet = ruleDraftsToRuleSet(env, artifacts, {
      kind: 'EVENT',
      name: `${name} policy`,
      ownerOrganisationId: organiserId,
      rules: extracted.policyRules,
    });
    if (ruleSet) artifacts.ruleSets.push(ruleSet);
  }

  if (extracted.engagements && extracted.engagements.length > 0) {
    if (!env.context.tripId) {
      addUncertainty(
        artifacts,
        env,
        'Engagements were extracted but no trip context is available to attach them',
        'MEDIUM',
      );
      return artifacts;
    }
    for (const engagement of extracted.engagements) {
      const engagementStart = parseInstant(env, artifacts, engagement.startsAt, `Engagement "${engagement.title}" start`);
      if (!engagementStart) continue;
      const engagementEnd = parseInstant(env, artifacts, engagement.endsAt, `Engagement "${engagement.title}" end`);
      pushEntityProposal(
        artifacts,
        env,
        origin,
        'TRIP_ELEMENT',
        {
          id: hashId('el-eng', env.source.id, engagement.title, engagementStart),
          tripId: env.context.tripId,
          elementKind: 'ENGAGEMENT',
          // Documented deterministic defaults: scheduled anchor-event
          // engagements are treated as required and fixed unless explicit
          // instructions/objectives say otherwise downstream.
          importance: 'REQUIRED',
          flexibility: 'FIXED',
          reservationState: 'NONE',
          data: {
            title: engagement.title,
            ...(venuePlaceId ? { placeId: venuePlaceId } : {}),
            startsAt: fact(engagementStart, env),
            ...(engagementEnd ? { endsAt: fact(engagementEnd, env) } : {}),
            anchorEventId: anchorId,
            ...(engagement.role ? { participantRole: engagement.role } : {}),
          },
        },
        'Engagement element from ingested anchor-event source',
      );
    }
  }
  return artifacts;
}

// ---------------------------------------------------------------------------
// Flight booking confirmations
// ---------------------------------------------------------------------------

export function normalizeExtractedFlightBooking(
  env: NormalizationEnv,
  extracted: ExtractedFlightBooking,
  origin: MutationOrigin,
): IngestionArtifacts {
  const artifacts = emptyArtifacts();

  const airportPlace = (
    place: { code: string; name?: string; timezone?: string } | undefined,
    role: 'origin' | 'destination',
  ): EntityId | undefined => {
    if (!place) {
      addUncertainty(artifacts, env, `Flight ${role} airport was not extracted`, 'MEDIUM');
      return undefined;
    }
    const placeId = hashId('place', env.source.id, place.code, 'AIRPORT');
    pushEntityProposal(
      artifacts,
      env,
      origin,
      'PLACE',
      {
        id: placeId,
        ...(place.name ? { name: place.name } : {}),
        kind: 'AIRPORT',
        ...(place.timezone ? { timezone: place.timezone } : {}),
        externalRefs: [{ system: 'IATA', value: place.code }],
      },
      `Flight ${role} airport from ingested booking confirmation`,
    );
    return placeId;
  };

  const originPlaceId = airportPlace(extracted.origin, 'origin');
  const destinationPlaceId = airportPlace(extracted.destination, 'destination');
  if (!originPlaceId || !destinationPlaceId) return artifacts;

  if (!env.context.tripId) {
    addUncertainty(
      artifacts,
      env,
      'Flight booking was extracted but no trip context is available to attach the transport leg',
      'HIGH',
    );
    return artifacts;
  }

  const statedStatus = parseReservationStatus(extracted.bookingStatus);
  const reservationState: ReservationState =
    statedStatus ?? (env.source.kind === 'BOOKING_CONFIRMATION' ? 'CONFIRMED' : 'UNKNOWN');
  if (reservationState === 'UNKNOWN') {
    addUncertainty(artifacts, env, 'Flight reservation state was not stated; treated as UNKNOWN', 'LOW');
  }

  const departure = parseInstant(env, artifacts, extracted.departure, 'Flight departure');
  const arrival = parseInstant(env, artifacts, extracted.arrival, 'Flight arrival');
  if (!departure && !arrival) {
    addUncertainty(
      artifacts,
      env,
      'Flight booking carries no extractable departure/arrival times; schedule remains UNKNOWN',
      'MEDIUM',
    );
  }

  const elementId = hashId(
    'el-flight',
    env.source.id,
    extracted.flightNumber ?? '',
    extracted.origin?.code ?? '',
    departure ?? '',
  );
  pushEntityProposal(
    artifacts,
    env,
    origin,
    'TRIP_ELEMENT',
    {
      id: elementId,
      tripId: env.context.tripId,
      elementKind: 'TRANSPORT_LEG',
      // Documented deterministic defaults: a booked leg is required; change
      // terms are unknown until fare rules are verified, so it stays FIXED.
      importance: 'REQUIRED',
      flexibility: 'FIXED',
      reservationState,
      data: {
        mode: 'FLIGHT',
        originPlaceId,
        destinationPlaceId,
        ...(departure ? { scheduledDeparture: fact(departure, env) } : {}),
        ...(arrival ? { scheduledArrival: fact(arrival, env) } : {}),
        ...(extracted.bookingReference
          ? {
              bookingRef: {
                system: extracted.bookingSystem ?? 'UNSPECIFIED',
                reference: extracted.bookingReference,
              },
            }
          : {}),
        ...(extracted.carrierCode ? { carrierRef: { system: 'IATA', value: extracted.carrierCode } } : {}),
      },
    },
    'Flight transport leg from ingested booking confirmation',
  );

  addUncertainty(
    artifacts,
    env,
    'Change/refund terms are not part of the confirmation itself; fare rules must be verified before changing this leg',
    'LOW',
  );
  if (extracted.passengerName && !env.context.travellerId) {
    addUncertainty(
      artifacts,
      env,
      `Passenger name "${extracted.passengerName}" could not be bound to a known traveller identity`,
      'LOW',
    );
  }
  return artifacts;
}

// ---------------------------------------------------------------------------
// Stay (hotel) booking confirmations
// ---------------------------------------------------------------------------

export function normalizeExtractedStayBooking(
  env: NormalizationEnv,
  extracted: ExtractedStayBooking,
  origin: MutationOrigin,
): IngestionArtifacts {
  const artifacts = emptyArtifacts();

  if (!extracted.propertyName && !extracted.timezone) {
    addUncertainty(artifacts, env, 'Stay property could not be identified from source', 'HIGH');
    return artifacts;
  }
  const placeId = hashId('place', env.source.id, extracted.propertyName ?? '', 'HOTEL');
  pushEntityProposal(
    artifacts,
    env,
    origin,
    'PLACE',
    {
      id: placeId,
      ...(extracted.propertyName ? { name: extracted.propertyName } : {}),
      kind: 'HOTEL',
      ...(extracted.timezone ? { timezone: extracted.timezone } : {}),
    },
    'Stay property place from ingested booking confirmation',
  );

  if (!env.context.tripId) {
    addUncertainty(
      artifacts,
      env,
      'Stay booking was extracted but no trip context is available to attach the stay element',
      'HIGH',
    );
    return artifacts;
  }

  const checkIn = parseInstant(env, artifacts, extracted.checkIn, 'Stay check-in');
  const checkOut = parseInstant(env, artifacts, extracted.checkOut, 'Stay check-out');
  if (!checkIn || !checkOut) {
    addUncertainty(
      artifacts,
      env,
      'Stay check-in/check-out times are incomplete or unparseable; stay element was not created',
      'HIGH',
    );
    return artifacts;
  }

  const statedStatus = parseReservationStatus(extracted.bookingStatus);
  const reservationState: ReservationState =
    statedStatus ?? (env.source.kind === 'BOOKING_CONFIRMATION' ? 'CONFIRMED' : 'UNKNOWN');
  if (reservationState === 'UNKNOWN') {
    addUncertainty(artifacts, env, 'Stay reservation state was not stated; treated as UNKNOWN', 'LOW');
  }

  let policyRuleSetIds: EntityId[] = [];
  if (extracted.policyRules && extracted.policyRules.length > 0) {
    const ruleSet = ruleDraftsToRuleSet(env, artifacts, {
      kind: 'SUPPLIER',
      name: `${extracted.propertyName ?? 'Stay'} supplier policy`,
      rules: extracted.policyRules,
    });
    if (ruleSet) {
      artifacts.ruleSets.push(ruleSet);
      policyRuleSetIds = [ruleSet.id];
    }
  } else {
    addUncertainty(
      artifacts,
      env,
      'No supplier policy was ingested with this stay; change/cancellation and no-show terms are UNKNOWN',
      'LOW',
    );
  }

  pushEntityProposal(
    artifacts,
    env,
    origin,
    'TRIP_ELEMENT',
    {
      id: hashId('el-stay', env.source.id, extracted.propertyName ?? '', checkIn),
      tripId: env.context.tripId,
      elementKind: 'STAY',
      // Documented deterministic defaults: booked stays are required; supplier
      // change terms govern flexibility and are only as complete as ingested
      // policy data.
      importance: 'REQUIRED',
      flexibility: 'FIXED',
      reservationState,
      data: {
        placeId,
        checkIn: fact(checkIn, env),
        checkOut: fact(checkOut, env),
        ...(extracted.bookingReference
          ? {
              bookingRef: {
                system: extracted.bookingSystem ?? 'UNSPECIFIED',
                reference: extracted.bookingReference,
              },
            }
          : {}),
        policyRuleSetIds,
      },
    },
    'Stay element from ingested booking confirmation',
  );
  return artifacts;
}

// ---------------------------------------------------------------------------
// Disruption signals
// ---------------------------------------------------------------------------

export function normalizeExtractedSignal(
  env: NormalizationEnv,
  extracted: ExtractedSignal,
): IngestionArtifacts {
  const artifacts = emptyArtifacts();

  let occurredAt: IsoDateTime;
  if (extracted.occurredAt !== undefined) {
    const parsed = IsoDateTimeSchema.safeParse(extracted.occurredAt);
    if (!parsed.success) {
      addUncertainty(
        artifacts,
        env,
        `Signal occurredAt is not a valid ISO-8601 timestamp with UTC offset: ${extracted.occurredAt}; signal discarded`,
        'HIGH',
      );
      return artifacts;
    }
    occurredAt = parsed.data;
  } else {
    occurredAt = env.now;
    addUncertainty(artifacts, env, 'Signal occurredAt was not stated; ingestion time was used', 'LOW');
  }

  artifacts.signals.push(
    TripSignalSchema.parse({
      id: hashId('signal', env.source.id, extracted.kind, occurredAt, extracted.summary ?? ''),
      kind: extracted.kind,
      occurredAt,
      receivedAt: env.now,
      sourceId: env.source.id,
      authority: env.source.authority,
      ...(env.context.tripId ? { tripId: env.context.tripId } : {}),
      ...(extracted.summary ? { summary: extracted.summary } : {}),
      payload: extracted.payload ?? {},
    }),
  );
  return artifacts;
}
