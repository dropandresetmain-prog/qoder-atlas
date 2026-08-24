/**
 * DR-3 — Atlas-specific normalizer: raw wire event -> generic
 * ExternalProviderEventEnvelope + TripSignal[] (ExternalFlightEventNormalizer,
 * frozen in src/contracts/capabilities.ts).
 *
 * ADR-044 ceiling, enforced here at the source: Atlas's delivery channel
 * documents no inbound signature/HMAC (docs/reality-validation/
 * WAVE3R_CAPABILITY_REALITY_REPORT.md §5), so every event this normalizer
 * produces is ASSERTED authority at best — the envelope schema itself
 * excludes AUTHORITATIVE, and every TripSignal built here is explicitly
 * ASSERTED, never CONNECTED/AUTHORITATIVE. Downstream, the existing
 * fact-authority ladder (src/engine/mutation.ts, enforceFactAuthority) is
 * what keeps this from ever overriding higher-authority observed state —
 * this normalizer does not, and must not, need to know that mechanism.
 *
 * Atlas wire vocabulary (eventType keyword classification, orderNo/pnr
 * shape) stays entirely in this file and eventTypes.ts.
 */
import type { TripSignal, SignalKind } from '../../operational/signal.ts';
import { IsoDateTimeSchema } from '../../domain/common.ts';
import type {
  ExternalFlightEventNormalizer,
  ExternalProviderEventEnvelope,
  ProviderEventCategory,
} from '../../contracts/capabilities.ts';
import { capabilityError, capabilityOk, type CapabilityResult } from '../../contracts/envelope.ts';
import { hashId } from '../../ingest/ids.ts';
import { AtlasFlightEventSchema } from './eventTypes.ts';
import { ATLAS_PROVIDER_ID } from './adapter.ts';

/**
 * Atlas documents no enum for `eventType` (only the incident-list record
 * shape). Classify by keyword rather than guessing an exhaustive vocabulary;
 * an unrecognized shape degrades to OTHER, never a crash or a fabricated
 * category.
 */
function classifyCategory(eventType: string): ProviderEventCategory {
  const upper = eventType.toUpperCase();
  if (upper.includes('CANCEL')) return 'FLIGHT_CANCELLATION';
  if (upper.includes('DELAY')) return 'FLIGHT_DELAY';
  if (upper.includes('SCHEDULE') || upper.includes('CHANGE') || upper.includes('RESCHEDUL')) {
    return 'FLIGHT_SCHEDULE_CHANGE';
  }
  if (upper.includes('TICKET')) return 'TICKETING';
  if (upper.includes('ORDER') || upper.includes('STATUS') || upper.includes('STATE')) {
    return 'ORDER_STATE_CHANGE';
  }
  return 'OTHER';
}

const CATEGORY_TO_SIGNAL_KIND: Record<ProviderEventCategory, SignalKind> = {
  FLIGHT_CANCELLATION: 'FLIGHT_CANCELLATION',
  FLIGHT_SCHEDULE_CHANGE: 'FLIGHT_SCHEDULE_CHANGE',
  FLIGHT_DELAY: 'FLIGHT_DELAY',
  TICKETING: 'BOOKING_STATE_CHANGE',
  ORDER_STATE_CHANGE: 'PROVIDER_EVENT',
  OTHER: 'OTHER',
};

/** Best-effort ISO-8601 parse; Atlas's own timestamp format is undocumented. */
function toIsoOrUndefined(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const parsed = IsoDateTimeSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export class AtlasFlightEventNormalizer implements ExternalFlightEventNormalizer {
  readonly providerId = ATLAS_PROVIDER_ID;

  async normalize(
    raw: unknown,
  ): Promise<CapabilityResult<{ envelope: ExternalProviderEventEnvelope; signals: TripSignal[] }>> {
    const requestedAt = new Date().toISOString();
    const meta = { providerId: this.providerId, mode: 'REPLAY' as const, requestedAt };

    const parsed = AtlasFlightEventSchema.safeParse(raw);
    if (!parsed.success) {
      return capabilityError(
        {
          category: 'INVALID_REQUEST',
          code: 'invalid_atlas_event_payload',
          message: parsed.error.issues
            .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
            .join('; '),
        },
        meta,
      );
    }

    const event = parsed.data;
    const category = classifyCategory(event.eventType);
    const occurredAt = toIsoOrUndefined(event.eventTime) ?? toIsoOrUndefined(event.createTime);
    const receivedAt = requestedAt;
    const providerOrderRefs = [event.orderNo, ...(event.pnr ? [event.pnr] : [])];

    const envelope: ExternalProviderEventEnvelope = {
      providerId: this.providerId,
      providerEventId: event.eventId,
      receivedAt,
      ...(occurredAt ? { occurredAt } : {}),
      providerOrderRefs,
      category,
      // ADR-044: the schema itself excludes AUTHORITATIVE; an unauthenticated
      // delivery channel is normalized at ASSERTED at best.
      providerAuthority: 'ASSERTED',
      payload: {
        eventType: event.eventType,
        ...(event.eventStatus !== undefined ? { eventStatus: event.eventStatus } : {}),
        ...(event.airline ? { airline: event.airline } : {}),
        ...(event.depTime ? { depTime: event.depTime } : {}),
        ...(event.pnr ? { pnr: event.pnr } : {}),
        ...(event.paxName ? { paxName: event.paxName } : {}),
        ...(event.confirmedResult ? { confirmedResult: event.confirmedResult } : {}),
        ...(event.confirmedRemark ? { confirmedRemark: event.confirmedRemark } : {}),
      },
    };

    const departure = toIsoOrUndefined(event.depTime);
    const signal: TripSignal = {
      id: hashId('sig-atlas-event', event.eventId),
      kind: CATEGORY_TO_SIGNAL_KIND[category],
      occurredAt: occurredAt ?? receivedAt,
      receivedAt,
      sourceId: hashId('src-atlas-event', event.eventId),
      // ADR-044 ceiling: never AUTHORITATIVE/CONNECTED for an unauthenticated
      // delivery — the existing fact-authority ladder (enforceFactAuthority)
      // is what keeps this from outranking observed provider truth.
      authority: 'ASSERTED',
      confidence: 0.6,
      summary: `A supplier reported a ${category === 'OTHER' ? 'flight event' : category.toLowerCase().replace(/_/g, ' ')}`,
      // tripId/subjectRef are deliberately absent: correlation from
      // providerOrderRefs to a trip element is a distinct, generic step
      // (src/app/eventIngest.ts) — not this provider adapter's job.
      payload: {
        event: category,
        providerId: this.providerId,
        providerEventId: event.eventId,
        providerOrderRefs,
        ...(departure ? { scheduledDeparture: departure } : {}),
      },
    };

    return capabilityOk({ envelope, signals: [signal] }, meta);
  }
}
