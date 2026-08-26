/**
 * E2 — traveller presentation layer (UI-local prop shape).
 *
 * The frozen TravellerTripView carries *what is true*; this shape carries
 * *how the concierge surface presents it* — destination photography, the
 * commitment card, itinerary rows, progress checks, thread messages, and
 * per-option rich detail. Everything here is optional: renderers fall back
 * to plain language when a presentation detail is absent, and no fallback
 * ever fabricates trip facts.
 *
 * Integrator contract: `optionDetails` is keyed by the exact option string
 * of `TravellerInputRequest.options` so the mapping survives re-ordering.
 */

/** A journey line inside a rich option card, e.g. "LHR 11:35 → SIN 07:55". */
export interface TravellerOptionRoute {
  /** Origin code + departure, e.g. "LHR 11:35". */
  from: string;
  /** Destination code + arrival, e.g. "SIN 07:55". */
  to: string;
  /** Service summary, e.g. "Direct" or "1 stop · Bangkok". */
  stops: string;
}

/** Rich presentation for one choice option (keyed by the option string). */
export interface TravellerOptionDetail {
  /** What the option does to the commitment: 'keeps' | 'breaks' | 'unknown'. */
  commitmentEffect: 'keeps' | 'breaks' | 'unknown';
  route?: TravellerOptionRoute;
  /** Plain-language consequence, e.g. "Arrives the evening before your talk." */
  note?: string;
  /** Flag chip, e.g. "Recommended". */
  flag?: string;
}

/** The commitment card content (the ink object on the traveller screen). */
export interface TravellerCommitmentCard {
  /** Small label, e.g. "The reason for the trip". */
  label: string;
  /** Serif title, e.g. "Your talk at Innovation Summit 2026". */
  title: string;
  /** Mono meta line, e.g. "16 Sep · 09:00 · Main hall". */
  meta?: string;
  /** When true, card uses the healthy `.is-ok` treatment. */
  ok?: boolean;
}

/** One itinerary row (approved `.itin-row`). */
export interface TravellerItineraryRow {
  icon: string;
  title: string;
  sub?: string;
  stateLabel: string;
  stateTone: 'ok' | 'bad' | 'watch' | 'neutral';
  /** Struck-through prior booking (shown next to the replacement). */
  struck?: boolean;
}

/** One staged progress row (approved `.check-row`). */
export interface TravellerProgressRow {
  state: 'done' | 'doing' | 'queued' | 'failed';
  text: string;
  detail?: string;
}

/** One message in the traveller thread (approved T7). */
export interface TravellerThreadMessage {
  from: 'ns' | 'me';
  meta: string;
  body: string;
}

/**
 * Optional override for the remainder-viability block when the projection
 * can supply a richer one-liner than the generic VIABILITY_* copy.
 */
export interface TravellerViabilityPresentation {
  /** Strong lead, e.g. "You'll land 9h 40m before the rehearsal." */
  lead: string;
  /** Supporting sentence after the lead. */
  detail?: string;
}

export interface TravellerPresentation {
  /** Destination photography for the hero. Relative URL; omitted = ink gradient. */
  heroImageUrl?: string;
  /** Alt text for the hero image. */
  heroImageAlt?: string;
  /** Programme / event name shown in the traveller topbar. */
  eventName?: string;
  /** Traveller display name for the footer. */
  travellerName?: string;
  /** Hero kicker override (approved T1–T7 wording). */
  heroKicker?: string;
  /** Kicker tone: green (ok), vermilion (bad), or default brass/paper. */
  heroKickerTone?: 'ok' | 'bad';
  /** Hero headline override. */
  heroHeadline?: string;
  /** Hero supporting sentence override. */
  heroSubline?: string;
  commitmentCard?: TravellerCommitmentCard;
  /** Itinerary section heading, e.g. "Your trip" / "What changed". */
  itineraryHeading?: string;
  itinerary?: TravellerItineraryRow[];
  /** Progress section heading, e.g. "What Northstar is doing". */
  progressHeading?: string;
  progress?: TravellerProgressRow[];
  /** Optional plain note under progress rows, e.g. "Nothing needed from you yet." */
  progressNote?: string;
  /** When true, show skeleton placeholders while options are forming (T3). */
  optionsSkeleton?: boolean;
  /** Note under the options skeleton. */
  optionsSkeletonNote?: string;
  /** Richer viability copy when available; otherwise frozen remainderViable. */
  viability?: TravellerViabilityPresentation;
  /** Hide the generic viability block (e.g. choice screens that omit it). */
  hideViability?: boolean;
  /** Message thread (T7); when present, thread replaces the default card stack. */
  messages?: TravellerThreadMessage[];
  /** Composer placeholder. */
  composerPlaceholder?: string;
  optionDetails?: Record<string, TravellerOptionDetail>;
  /** Human to contact, e.g. "Ana from the events team". */
  contactName?: string;
  /** Extra note under choice cards. */
  choiceNote?: string;
}
