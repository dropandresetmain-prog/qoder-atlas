/**
 * I1 — Lane D Model Studio client adapted onto Lane B's
 * `SemanticExtractionClient` seam. This is the ONLY model client in the
 * application; no second client is implemented (I1 directive).
 *
 * Failure is data: any model error (unconfigured, unavailable, invalid
 * output) becomes `{ ok: false, reason }` so ingestion records honest
 * uncertainty instead of crashing or guessing. Output validation stays with
 * Lane B (`validateExtraction`) — the adapter forwards raw validated values.
 */
import { EXTRACTION_OUTPUT_SCHEMA, type SemanticExtractionClient, type SemanticExtractionRequest } from '../ingest/semantic.ts';
import type { ModelStudioClient, ModelTask } from '../intelligence/client.ts';

/**
 * P0.4: the prompt states the exact target schema and field names for every
 * extraction task so the model performs strict, validated extraction — the
 * output must parse against EXTRACTION_OUTPUT_SCHEMA[task] with no extra
 * keys (strict objects). Enum fields list their complete closed vocabulary.
 */
const EXTRACTION_SYSTEM_PROMPT = `You extract structured facts from one travel-related source document.
Respond with a single JSON object and nothing else (no prose, no markdown, no code fences).
Extract only what the source actually states; never invent values.
The user message names the extraction task. Your JSON must match that task's schema EXACTLY:
strict objects with only the field names listed below (no extra keys), all fields optional
unless marked required. Omit optional fields the source does not provide. Timestamps are
ISO-8601 strings with an explicit UTC offset when the source gives one.

Task ANCHOR_EVENT (schema ExtractedAnchorEvent):
  name?: string; kind?: one of CONFERENCE|CONCERT|RETREAT|TOURNAMENT|WEDDING|OFFSITE|TRADE_MISSION|OTHER;
  venue?: { name?: string; timezone?: string }; startsAt?: string; endsAt?: string;
  organiserName?: string; instructions?: string;
  policyRules?: array of rule-draft objects (raw key/value drafts; ids are assigned downstream, do not invent ids);
  engagements?: array of { title: string (required); startsAt: string (required); endsAt?: string; role?: string }.

Task RULE_SET (schema ExtractedRuleSet):
  kind?: one of SUPPLIER|ORGANISATION|EVENT|ENTRY|INSURANCE|OTHER; name?: string;
  ownerOrganisationId?: string; rules: array of rule-draft objects (default [] when none are stated).
  Rule drafts carry the fields the source states, e.g. { kind, maxAmount: { amount, currency },
  threshold: { amount, currency }, refundable, refundDeadline, appliesTo: [...] }.

Task TRAVELLER_CONTEXT (schema ExtractedTravellerContext) — traveller preferences and
  change-shaped statements:
  travellerName?: string; nationalityCodes?: string[];
  items: array of { statement: string (required); basis: EXPLICIT_INSTRUCTION|EXPLICIT_PREFERENCE|LATENT (required);
    quote?: string (verbatim evidence; include it for explicit claims); confidence?: number 0..1;
    tripScoped?: boolean } (default []);
  accessibility: array of { kind?: MOBILITY|VISUAL|HEARING|COGNITIVE|MEDICAL|OTHER;
    statement: string (required) } (default []). Accessibility is a requirement, never a preference.

Task FLIGHT_BOOKING (schema ExtractedFlightBooking):
  carrierCode?; flightNumber?; origin?: { code: string (required); name?; timezone? };
  destination?: same shape; departure?: string; arrival?: string; bookingReference?; bookingSystem?;
  bookingStatus?: the status word the source states (e.g. CONFIRMED/CANCELLED); passengerName?.

Task STAY_BOOKING (schema ExtractedStayBooking):
  propertyName?; timezone?; checkIn?; checkOut?; bookingReference?; bookingSystem?;
  bookingStatus?: the status word the source states; policyRules?: rule-draft array.

Task INSURANCE (schema ExtractedInsurance):
  name?; coveredReasons: string[] (default []); excess?: { amount: number; currency: string };
  maxPayout?: { amount: number; currency: string }.

Task DISRUPTION_SIGNAL (schema ExtractedSignal):
  kind: one of FLIGHT_CANCELLATION|FLIGHT_SCHEDULE_CHANGE|FLIGHT_DELAY|BOOKING_STATE_CHANGE|PROVIDER_EVENT|WEATHER_EVENT|TRAVELLER_INPUT|OPERATOR_INPUT (required);
  occurredAt?: string; summary?: string; payload?: object of raw key/value facts the source states.`;

function buildUserPrompt(request: SemanticExtractionRequest): string {
  const header = [
    `Extraction task: ${request.task}`,
    `Source kind: ${request.sourceKind}`,
    request.title ? `Title: ${request.title}` : undefined,
    request.uri ? `URI: ${request.uri}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
  return `${header}\n\nSource content:\n${request.content}`;
}

/**
 * Wrap a Model Studio client as the ingestion extraction seam. Task prompts
 * are generic; schema enforcement comes from the frozen extraction DTOs.
 */
export function modelStudioExtractionClient(client: ModelStudioClient): SemanticExtractionClient {
  return {
    async extract(request: SemanticExtractionRequest) {
      const task: ModelTask<unknown> = {
        id: `extraction_${request.task.toLowerCase()}`,
        systemPrompt: EXTRACTION_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(request),
        schema: EXTRACTION_OUTPUT_SCHEMA[request.task],
      };
      const result = await client.call(task);
      if (!result.ok) {
        return { ok: false, reason: `${result.error.category}:${result.error.code}` };
      }
      return { ok: true, output: result.value };
    },
  };
}
