/**
 * B2 — model-neutral semantic extraction seam.
 *
 * Lane B defines the interface and validates outputs against schema; Lane D
 * owns the actual Model Studio runtime and implements `SemanticExtractionClient`
 * at integration. No model client lives in this lane.
 *
 * Extraction DTOs carry raw values only; provenance, authority and
 * uncertainty are attached by the deterministic normalizers, never by the
 * model.
 */
import { z } from 'zod';
import {
  EntityIdSchema,
  MoneySchema,
  type SourceKind,
} from '../domain/common.ts';
import { AccessibilityRequirementKindSchema, AnchorEventKindSchema } from '../domain/entities.ts';
import { RuleSetKindSchema } from '../domain/rules.ts';
import { SignalKindSchema } from '../operational/signal.ts';

export const ExtractionTaskSchema = z.enum([
  'ANCHOR_EVENT',
  'FLIGHT_BOOKING',
  'STAY_BOOKING',
  'RULE_SET',
  'INSURANCE',
  'TRAVELLER_CONTEXT',
  'DISRUPTION_SIGNAL',
]);
export type ExtractionTask = z.infer<typeof ExtractionTaskSchema>;

export interface SemanticExtractionRequest {
  task: ExtractionTask;
  sourceKind: SourceKind;
  uri?: string;
  title?: string;
  content: string;
}

export type SemanticExtractionResult =
  | { ok: true; output: unknown }
  | { ok: false; reason: string };

/** Implemented by Lane D's Model Studio client (D1/D2) at integration. */
export interface SemanticExtractionClient {
  extract(request: SemanticExtractionRequest): Promise<SemanticExtractionResult>;
}

// ---------------------------------------------------------------------------
// Extraction output DTO schemas (validated before any normalization)
// ---------------------------------------------------------------------------

const ExtractedPlaceSchema = z.strictObject({
  name: z.string().optional(),
  timezone: z.string().optional(),
});

const ExtractedCodePlaceSchema = z.strictObject({
  code: z.string(),
  name: z.string().optional(),
  timezone: z.string().optional(),
});

export const ExtractedAnchorEventSchema = z.strictObject({
  name: z.string().optional(),
  kind: AnchorEventKindSchema.optional(),
  venue: ExtractedPlaceSchema.optional(),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  organiserName: z.string().optional(),
  instructions: z.string().optional(),
  /** Rule drafts; ids/sourceIds are assigned deterministically downstream. */
  policyRules: z.array(z.record(z.string(), z.unknown())).optional(),
  engagements: z
    .array(
      z.strictObject({
        title: z.string(),
        startsAt: z.string(),
        endsAt: z.string().optional(),
        role: z.string().optional(),
      }),
    )
    .optional(),
});
export type ExtractedAnchorEvent = z.infer<typeof ExtractedAnchorEventSchema>;

export const ExtractedFlightBookingSchema = z.strictObject({
  carrierCode: z.string().optional(),
  flightNumber: z.string().optional(),
  origin: ExtractedCodePlaceSchema.optional(),
  destination: ExtractedCodePlaceSchema.optional(),
  departure: z.string().optional(),
  arrival: z.string().optional(),
  bookingReference: z.string().optional(),
  /** Booking system/provider name the reference belongs to, when stated. */
  bookingSystem: z.string().optional(),
  /** Reservation status as stated by the source (e.g. CONFIRMED/CANCELLED). */
  bookingStatus: z.string().optional(),
  passengerName: z.string().optional(),
});
export type ExtractedFlightBooking = z.infer<typeof ExtractedFlightBookingSchema>;

export const ExtractedStayBookingSchema = z.strictObject({
  propertyName: z.string().optional(),
  timezone: z.string().optional(),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  bookingReference: z.string().optional(),
  /** Booking system/provider name the reference belongs to, when stated. */
  bookingSystem: z.string().optional(),
  /** Reservation status as stated by the source (e.g. CONFIRMED/CANCELLED). */
  bookingStatus: z.string().optional(),
  policyRules: z.array(z.record(z.string(), z.unknown())).optional(),
});
export type ExtractedStayBooking = z.infer<typeof ExtractedStayBookingSchema>;

export const ExtractedRuleSetSchema = z.strictObject({
  kind: RuleSetKindSchema.optional(),
  name: z.string().optional(),
  ownerOrganisationId: EntityIdSchema.optional(),
  rules: z.array(z.record(z.string(), z.unknown())).default([]),
});
export type ExtractedRuleSet = z.infer<typeof ExtractedRuleSetSchema>;

export const ExtractedInsuranceSchema = z.strictObject({
  name: z.string().optional(),
  coveredReasons: z.array(z.string()).default([]),
  excess: MoneySchema.optional(),
  maxPayout: MoneySchema.optional(),
});
export type ExtractedInsurance = z.infer<typeof ExtractedInsuranceSchema>;

export const PreferenceBasisSchema = z.enum([
  'EXPLICIT_INSTRUCTION',
  'EXPLICIT_PREFERENCE',
  'LATENT',
]);

export const ExtractedPreferenceItemSchema = z.strictObject({
  statement: z.string(),
  basis: PreferenceBasisSchema,
  /** Verbatim evidence for explicit claims; absence demotes the item. */
  quote: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  tripScoped: z.boolean().optional(),
});

export const ExtractedTravellerContextSchema = z.strictObject({
  travellerName: z.string().optional(),
  nationalityCodes: z.array(z.string()).optional(),
  items: z.array(ExtractedPreferenceItemSchema).default([]),
  accessibility: z
    .array(
      z.strictObject({
        kind: AccessibilityRequirementKindSchema.optional(),
        statement: z.string(),
      }),
    )
    .default([]),
});
export type ExtractedTravellerContext = z.infer<typeof ExtractedTravellerContextSchema>;

export const ExtractedSignalSchema = z.strictObject({
  kind: SignalKindSchema,
  occurredAt: z.string().optional(),
  summary: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type ExtractedSignal = z.infer<typeof ExtractedSignalSchema>;

export const EXTRACTION_OUTPUT_SCHEMA: Record<ExtractionTask, z.ZodType> = {
  ANCHOR_EVENT: ExtractedAnchorEventSchema,
  FLIGHT_BOOKING: ExtractedFlightBookingSchema,
  STAY_BOOKING: ExtractedStayBookingSchema,
  RULE_SET: ExtractedRuleSetSchema,
  INSURANCE: ExtractedInsuranceSchema,
  TRAVELLER_CONTEXT: ExtractedTravellerContextSchema,
  DISRUPTION_SIGNAL: ExtractedSignalSchema,
};

export type ValidatedExtraction =
  | { ok: true; value: unknown }
  | { ok: false; issues: string[] };

/** Schema-gate model output: malformed extraction is data, never trusted. */
export function validateExtraction(task: ExtractionTask, output: unknown): ValidatedExtraction {
  const parsed = EXTRACTION_OUTPUT_SCHEMA[task].safeParse(output);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
  };
}

/**
 * Generic routing from source kind to candidate extraction tasks, tried in
 * order. Callers may override with an explicit task hint. Content shape, not
 * scenario semantics, decides which extractor runs.
 */
export const EXTRACTION_TASKS_BY_KIND: Record<SourceKind, ExtractionTask[]> = {
  WEBPAGE: ['ANCHOR_EVENT'],
  EMAIL: ['DISRUPTION_SIGNAL', 'FLIGHT_BOOKING', 'TRAVELLER_CONTEXT'],
  DOCUMENT: ['RULE_SET', 'TRAVELLER_CONTEXT', 'ANCHOR_EVENT'],
  BOOKING_CONFIRMATION: ['FLIGHT_BOOKING', 'STAY_BOOKING'],
  POLICY_DOCUMENT: ['RULE_SET'],
  INSURANCE_DOCUMENT: ['INSURANCE'],
  PROFILE: ['TRAVELLER_CONTEXT'],
  PROVIDER_STATE: [],
  RESEARCH: [],
  MANUAL: ['TRAVELLER_CONTEXT'],
};

/**
 * Deterministic replay double for the extraction seam: serves recorded
 * outputs keyed by task and content marker. Used by tests and REPLAY runs
 * until the Lane D client is wired.
 */
export class RecordedExtractionClient implements SemanticExtractionClient {
  private readonly recordings: Array<{
    task: ExtractionTask;
    contentIncludes?: string;
    output: unknown;
  }>;

  constructor(
    recordings: Array<{ task: ExtractionTask; contentIncludes?: string; output: unknown }>,
  ) {
    this.recordings = recordings;
  }

  async extract(request: SemanticExtractionRequest): Promise<SemanticExtractionResult> {
    const match = this.recordings.find(
      (r) =>
        r.task === request.task &&
        (r.contentIncludes === undefined || request.content.includes(r.contentIncludes)),
    );
    if (!match) return { ok: false, reason: 'no_recording_for_request' };
    return { ok: true, output: structuredClone(match.output) };
  }
}
