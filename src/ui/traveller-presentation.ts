/**
 * E2 — traveller presentation layer (UI-local prop shape).
 *
 * The frozen TravellerTripView carries *what is true*; this shape carries
 * *how the concierge surface presents it* — destination photography, the
 * commitment card lines, and per-option rich detail for choice requests.
 * Everything here is optional: renderers fall back to plain language and
 * plain buttons when a presentation detail is absent, and no fallback ever
 * fabricates trip facts.
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
}

export interface TravellerPresentation {
  /** Destination photography for the hero. Relative URL; omitted = ink gradient. */
  heroImageUrl?: string;
  /** Alt text for the hero image. */
  heroImageAlt?: string;
  commitmentCard?: TravellerCommitmentCard;
  optionDetails?: Record<string, TravellerOptionDetail>;
  /** Human to contact, e.g. "Ana from the events team". */
  contactName?: string;
}
