/**
 * B2 — deterministic structured-input mapping.
 *
 * Already-structured payloads bypass model interpretation entirely (B1/B2
 * requirement): they are schema-validated and mapped straight into the same
 * normalizers the semantic path uses. Dispatch is by an explicit `schema`
 * hint when present, otherwise by source kind with deterministic probing —
 * never by content keywords or scenario semantics.
 */
import { z } from 'zod';
import { IsoDateTimeSchema } from '../domain/common.ts';
import { TripSignalSchema } from '../operational/signal.ts';
import {
  addUncertainty,
  deterministicProposalOrigin,
  emptyArtifacts,
  mergeArtifacts,
  type IngestionArtifacts,
  type NormalizationEnv,
} from './artifacts.ts';
import { hashId } from './ids.ts';
import {
  normalizeExtractedFlightBooking,
  normalizeExtractedStayBooking,
} from './normalize.ts';
import {
  ExtractedFlightBookingSchema,
  ExtractedInsuranceSchema,
  ExtractedRuleSetSchema,
  ExtractedStayBookingSchema,
  type ExtractedFlightBooking,
  type ExtractedStayBooking,
} from './semantic.ts';
import {
  normalizeResearchFindings,
  normalizeStructuredTravellerContext,
} from './travellerContext.ts';
import { normalizeExtractedInsurance, normalizeExtractedRuleSet } from './ruleSets.ts';

// ---------------------------------------------------------------------------
// Structured payload schemas
// ---------------------------------------------------------------------------

export const StructuredSchemaHintSchema = z.enum([
  'TRAVELLER_CONTEXT',
  'RESEARCH_FINDINGS',
  'FLIGHT_BOOKING',
  'STAY_BOOKING',
  'RULE_SET',
  'INSURANCE',
  'PROVIDER_FLIGHT_STATE',
  'PROVIDER_STAY_STATE',
]);
export type StructuredSchemaHint = z.infer<typeof StructuredSchemaHintSchema>;

/** Optional explicit dispatch: `{ schema: <hint>, payload: {...} }`. */
export const StructuredEnvelopeSchema = z.strictObject({
  schema: StructuredSchemaHintSchema,
  payload: z.unknown(),
});

/** Provider-published flight state (already provider-neutral structured data). */
export const StructuredProviderFlightStateSchema = z.strictObject({
  bookingReference: z.string().optional(),
  carrierCode: z.string().optional(),
  flightNumber: z.string().optional(),
  status: z.enum(['CONFIRMED', 'CANCELLED', 'DELAYED', 'SCHEDULE_CHANGED', 'UNKNOWN']).default('UNKNOWN'),
  occurredAt: IsoDateTimeSchema.optional(),
  newDeparture: IsoDateTimeSchema.optional(),
  newArrival: IsoDateTimeSchema.optional(),
  notes: z.string().optional(),
});
export type StructuredProviderFlightState = z.infer<typeof StructuredProviderFlightStateSchema>;

/** Provider-published stay state. */
export const StructuredProviderStayStateSchema = z.strictObject({
  bookingReference: z.string().optional(),
  status: z.enum(['CONFIRMED', 'MODIFIED', 'CANCELLED', 'UNKNOWN']).default('UNKNOWN'),
  occurredAt: IsoDateTimeSchema.optional(),
  newCheckIn: IsoDateTimeSchema.optional(),
  newCheckOut: IsoDateTimeSchema.optional(),
  notes: z.string().optional(),
});
export type StructuredProviderStayState = z.infer<typeof StructuredProviderStayStateSchema>;

// ---------------------------------------------------------------------------
// Provider state -> deterministic signals (no model involved)
// ---------------------------------------------------------------------------

function emitFlightStateSignal(
  env: NormalizationEnv,
  artifacts: IngestionArtifacts,
  state: StructuredProviderFlightState,
): void {
  const kind =
    state.status === 'CANCELLED'
      ? 'FLIGHT_CANCELLATION'
      : state.status === 'DELAYED'
        ? 'FLIGHT_DELAY'
        : state.status === 'SCHEDULE_CHANGED'
          ? 'FLIGHT_SCHEDULE_CHANGE'
          : 'BOOKING_STATE_CHANGE';
  artifacts.signals.push(
    TripSignalSchema.parse({
      id: hashId('signal', env.source.id, kind, JSON.stringify(state)),
      kind,
      occurredAt: state.occurredAt ?? env.now,
      receivedAt: env.now,
      sourceId: env.source.id,
      authority: env.source.authority,
      ...(env.context.tripId ? { tripId: env.context.tripId } : {}),
      summary: `Provider flight state: ${state.status}`,
      payload: {
        ...state,
        // Deterministic mapping into the generic schedule vocabulary the
        // signal pipeline consumes: a retimed provider state asserts new
        // departure/arrival facts for the affected transport element.
        ...(state.newDeparture ? { scheduledDeparture: state.newDeparture } : {}),
        ...(state.newArrival ? { scheduledArrival: state.newArrival } : {}),
      },
    }),
  );
}

function emitStayStateSignal(
  env: NormalizationEnv,
  artifacts: IngestionArtifacts,
  state: StructuredProviderStayState,
): void {
  artifacts.signals.push(
    TripSignalSchema.parse({
      id: hashId('signal', env.source.id, 'BOOKING_STATE_CHANGE', JSON.stringify(state)),
      kind: 'BOOKING_STATE_CHANGE',
      occurredAt: state.occurredAt ?? env.now,
      receivedAt: env.now,
      sourceId: env.source.id,
      authority: env.source.authority,
      ...(env.context.tripId ? { tripId: env.context.tripId } : {}),
      summary: `Provider stay state: ${state.status}`,
      payload: { ...state },
    }),
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

/**
 * Deterministically map a structured payload to normalized artifacts.
 * `origin` reflects the source class (MANUAL -> HUMAN, PROVIDER_STATE ->
 * PROVIDER, otherwise SYSTEM); no AI is involved on this path.
 */
export function normalizeStructuredInput(
  env: NormalizationEnv,
  structured: Record<string, unknown>,
): IngestionArtifacts {
  const artifacts = emptyArtifacts();
  const origin = deterministicProposalOrigin(env.source.kind);

  const envelope = StructuredEnvelopeSchema.safeParse(structured);
  const hint: StructuredSchemaHint | undefined = envelope.success ? envelope.data.schema : undefined;
  const payload: unknown = envelope.success ? envelope.data.payload : structured;

  const effectiveHint = hint ?? defaultHintForKind(env, artifacts, structured);
  if (!effectiveHint) return artifacts;

  switch (effectiveHint) {
    case 'TRAVELLER_CONTEXT':
      return mergeIntoAll(artifacts, normalizeStructuredTravellerContext(env, payload, origin));
    case 'RESEARCH_FINDINGS':
      return mergeIntoAll(artifacts, normalizeResearchFindings(env, payload));
    case 'FLIGHT_BOOKING': {
      const parsed = ExtractedFlightBookingSchema.safeParse(payload);
      if (!parsed.success) {
        addUncertainty(
          artifacts,
          env,
          `Structured flight booking payload failed schema validation: ${formatIssues(parsed.error)}`,
          'HIGH',
        );
        return artifacts;
      }
      return mergeIntoAll(artifacts, normalizeExtractedFlightBooking(env, parsed.data as ExtractedFlightBooking, origin));
    }
    case 'STAY_BOOKING': {
      const parsed = ExtractedStayBookingSchema.safeParse(payload);
      if (!parsed.success) {
        addUncertainty(
          artifacts,
          env,
          `Structured stay booking payload failed schema validation: ${formatIssues(parsed.error)}`,
          'HIGH',
        );
        return artifacts;
      }
      return mergeIntoAll(artifacts, normalizeExtractedStayBooking(env, parsed.data as ExtractedStayBooking, origin));
    }
    case 'RULE_SET': {
      const parsed = ExtractedRuleSetSchema.safeParse(payload);
      if (!parsed.success) {
        addUncertainty(
          artifacts,
          env,
          `Structured rule set payload failed schema validation: ${formatIssues(parsed.error)}`,
          'HIGH',
        );
        return artifacts;
      }
      return mergeIntoAll(artifacts, normalizeExtractedRuleSet(env, parsed.data));
    }
    case 'INSURANCE': {
      const parsed = ExtractedInsuranceSchema.safeParse(payload);
      if (!parsed.success) {
        addUncertainty(
          artifacts,
          env,
          `Structured insurance payload failed schema validation: ${formatIssues(parsed.error)}`,
          'HIGH',
        );
        return artifacts;
      }
      return mergeIntoAll(artifacts, normalizeExtractedInsurance(env, parsed.data));
    }
    case 'PROVIDER_FLIGHT_STATE': {
      const parsed = StructuredProviderFlightStateSchema.safeParse(payload);
      if (!parsed.success) {
        addUncertainty(
          artifacts,
          env,
          `Structured provider flight state failed schema validation: ${formatIssues(parsed.error)}`,
          'HIGH',
        );
        return artifacts;
      }
      emitFlightStateSignal(env, artifacts, parsed.data);
      return artifacts;
    }
    case 'PROVIDER_STAY_STATE': {
      const parsed = StructuredProviderStayStateSchema.safeParse(payload);
      if (!parsed.success) {
        addUncertainty(
          artifacts,
          env,
          `Structured provider stay state failed schema validation: ${formatIssues(parsed.error)}`,
          'HIGH',
        );
        return artifacts;
      }
      emitStayStateSignal(env, artifacts, parsed.data);
      return artifacts;
    }
  }
}

/**
 * Kind-based fallback when no explicit hint is given: deterministic probing of
 * the payload against the candidate schemas for the source kind.
 */
function defaultHintForKind(
  env: NormalizationEnv,
  artifacts: IngestionArtifacts,
  structured: Record<string, unknown>,
): StructuredSchemaHint | undefined {
  switch (env.source.kind) {
    case 'RESEARCH':
      return 'RESEARCH_FINDINGS';
    case 'PROVIDER_STATE': {
      if (StructuredProviderFlightStateSchema.safeParse(structured).success) return 'PROVIDER_FLIGHT_STATE';
      if (StructuredProviderStayStateSchema.safeParse(structured).success) return 'PROVIDER_STAY_STATE';
      addUncertainty(
        artifacts,
        env,
        'Provider state payload matched no known structured schema; nothing was normalized',
        'HIGH',
      );
      return undefined;
    }
    case 'BOOKING_CONFIRMATION': {
      if (ExtractedFlightBookingSchema.safeParse(structured).success) return 'FLIGHT_BOOKING';
      if (ExtractedStayBookingSchema.safeParse(structured).success) return 'STAY_BOOKING';
      addUncertainty(
        artifacts,
        env,
        'Structured booking confirmation matched neither flight nor stay schema; nothing was normalized',
        'HIGH',
      );
      return undefined;
    }
    default:
      return 'TRAVELLER_CONTEXT';
  }
}

function mergeIntoAll(target: IngestionArtifacts, more: IngestionArtifacts): IngestionArtifacts {
  return mergeArtifacts(target, more);
}
