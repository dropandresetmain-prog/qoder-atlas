/**
 * E1 — single source of truth for user-facing language (FR-12, FR-13, DEMO.md).
 *
 * Every screen derives status wording from this module so the UI can never
 * drift into internal vocabulary. DEMO.md user-facing rules: no graph node,
 * TripSignal, dependency propagation, RecoveryStrategy, evaluator, etc.
 * The `FORBIDDEN_UI_TERMS` list backs the automated jargon gate in tests.
 */
import type { ReadModelStatus, RemainderViability } from '../contracts/readmodels.ts';

/** Visual tone bucket; maps to CSS classes, never to copy. */
export type StatusTone = 'ok' | 'watch' | 'alert' | 'active' | 'done' | 'neutral';

export const STATUS_LABEL: Record<ReadModelStatus, string> = {
  READY: 'Ready',
  PLANNING: 'Trip being planned',
  NEEDS_TRAVELLER_INFO: 'Needs traveller details',
  CHANGE_REQUESTED: 'Change requested',
  AT_RISK: 'At risk',
  DISRUPTED: 'Needs attention',
  RECOVERING: 'Recovery under way',
  RESOLVED: 'Recovered',
  UNKNOWN: 'Unconfirmed',
};

export const STATUS_TONE: Record<ReadModelStatus, StatusTone> = {
  READY: 'ok',
  PLANNING: 'active',
  NEEDS_TRAVELLER_INFO: 'watch',
  CHANGE_REQUESTED: 'active',
  AT_RISK: 'watch',
  DISRUPTED: 'alert',
  RECOVERING: 'active',
  RESOLVED: 'done',
  UNKNOWN: 'neutral',
};

/** One-line plain-language explanation shown next to operator status badges. */
export const STATUS_EXPLANATION: Record<ReadModelStatus, string> = {
  READY: 'Everything on this trip is confirmed and on track.',
  PLANNING: 'The traveller is confirmed; we are building the first workable trip plan.',
  NEEDS_TRAVELLER_INFO: 'We are waiting on details from the traveller before we can finish onboarding.',
  CHANGE_REQUESTED: 'The traveller asked for a change; options are being checked against the current trip.',
  AT_RISK: 'Something may still go wrong; we are watching it closely.',
  DISRUPTED: 'Plans changed and part of this trip no longer works as booked.',
  RECOVERING: 'We are actively working on a replacement plan.',
  RESOLVED: 'The trip has been rebuilt and confirmed.',
  UNKNOWN: 'There is not enough confirmed information to say yet.',
};

/** Traveller hero headline per trip status. Never claims success it cannot prove. */
export const TRAVELLER_HEADLINE: Record<ReadModelStatus, string> = {
  READY: 'You are all set',
  PLANNING: 'We are planning your trip',
  NEEDS_TRAVELLER_INFO: 'We need a few details from you',
  CHANGE_REQUESTED: 'We are looking into your request',
  AT_RISK: 'Heads up about your trip',
  DISRUPTED: 'Your trip needs attention',
  RECOVERING: 'We are working on your trip',
  RESOLVED: 'Your trip is updated',
  UNKNOWN: 'We are still checking your trip',
};

/** Subline shown under the traveller hero headline. */
export const TRAVELLER_SUBLINE: Record<ReadModelStatus, string> = {
  READY: 'All of your bookings are confirmed. Nothing needs your attention.',
  PLANNING: 'No bookings are confirmed yet. We will show options as soon as they are checked.',
  NEEDS_TRAVELLER_INFO: 'Please share the details we asked for so we can complete your plan.',
  CHANGE_REQUESTED: 'Nothing has been changed yet. We will come back with options and any decisions needed.',
  AT_RISK: 'Part of your trip may be affected. We are keeping an eye on it.',
  DISRUPTED: 'Something changed and part of your trip no longer works as planned.',
  RECOVERING: 'We are finding a new plan and will only ask you when we need you.',
  RESOLVED: 'Here is your new plan and what it means for the rest of your trip.',
  UNKNOWN: 'We do not have confirmed details yet. We will not guess.',
};

export const VIABILITY_LABEL: Record<RemainderViability, string> = {
  VIABLE: 'Looks good',
  AT_RISK: 'May be affected',
  NOT_VIABLE: 'Does not work yet',
  UNKNOWN: 'Still checking',
};

export const VIABILITY_EXPLANATION: Record<RemainderViability, string> = {
  VIABLE: 'The rest of your trip still works with the new plan.',
  AT_RISK: 'The rest of your trip may be affected; we are watching it.',
  NOT_VIABLE: 'The rest of your trip does not work yet; we are still on it.',
  UNKNOWN: 'We have not confirmed the rest of your trip yet.',
};

/** Verdict wording for recovery options (operator case detail). */
export const OPTION_VERDICT_LABEL: Record<'VIABLE' | 'NOT_VIABLE' | 'UNKNOWN', string> = {
  VIABLE: 'Works for the trip',
  NOT_VIABLE: 'Rejected',
  UNKNOWN: 'Still being checked',
};

/**
 * G3R-Closure fix H — deterministic presentation mapping for case
 * resolution outcomes. The raw engine enums (FULLY_RECOVERED,
 * RECOVERED_WITH_LOSS, ESCALATED_CLOSED) must never reach user copy; every
 * screen derives its wording from this map. Raw values stay in machine
 * state (data-* attributes, audit, debug surfaces) only.
 */
export const RESOLUTION_OUTCOME_LABEL: Record<'FULLY_RECOVERED' | 'RECOVERED_WITH_LOSS' | 'ESCALATED_CLOSED', string> = {
  FULLY_RECOVERED: 'Trip recovered',
  RECOVERED_WITH_LOSS: 'Trip recovered — with a loss',
  ESCALATED_CLOSED: 'Closed with direct support',
};

// ---------------------------------------------------------------------------
// Northstar programme surface (RV-N10) — labels live next to the others so
// the same user-facing vocabulary drives every screen.
// ---------------------------------------------------------------------------

/** Operator-side heading for the per-AnchorEvent programme surface. */
export const PROGRAMME_HEADING = 'Event programme';

/** Short description under the programme page heading. */
export const PROGRAMME_SUBHEADING =
  'Every traveller travelling to this event, in one place, with the status of each trip.';

/** One-line explanation for the per-status tiles row. */
export const PROGRAMME_TILES_LEGEND = 'Counts by trip status across the whole programme.';

/** Short label for the endangered-commitments section. */
export const PROGRAMME_ENDANGERED_TITLE = 'At-risk shared commitments';

/** Heading for the programme-level "missing information" panel. */
export const PROGRAMME_MISSING_INFO_TITLE = 'Missing information';

/** Affordance: single-traveller intake. */
export const PROGRAMME_INTAKE_ADD_LABEL = 'Add one traveller';

/** Affordance: bulk import of a traveller list. */
export const PROGRAMME_INTAKE_BULK_LABEL = 'Bulk import travellers';

/** Column headers for the programme traveller table. */
export const PROGRAMME_TABLE_HEADERS = {
  name: 'Traveller',
  status: 'Status',
  cases: 'Active cases',
  decisions: 'Decisions needed',
  uncertainties: 'Still unclear',
} as const;

/** Tile label keyed by the ProgrammeStatusSummary field. */
export const PROGRAMME_TILE_LABEL: Record<ProgrammeStatusSummaryTileKeys, string> = {
  total: 'Total travellers',
  ready: 'Ready',
  planning: 'Trip being planned',
  needsTravellerInfo: 'Needs traveller details',
  changeRequested: 'Change requested',
  atRisk: 'At risk',
  disrupted: 'Needs attention',
  recovering: 'Recovery under way',
  awaitingDecision: 'Decisions needed',
  resolved: 'Recovered',
  unknown: 'Unconfirmed',
};

/**
 * Status keys that appear in ProgrammeStatusSummary and have a matching
 * tile label above. Centralised so a future summary field always gets a
 * tile or a deliberate omission, never a missing label.
 */
export type ProgrammeStatusSummaryTileKeys =
  | 'total'
  | 'ready'
  | 'planning'
  | 'needsTravellerInfo'
  | 'changeRequested'
  | 'atRisk'
  | 'disrupted'
  | 'recovering'
  | 'awaitingDecision'
  | 'resolved'
  | 'unknown';

/**
 * Internal terms that must never appear in rendered user-facing output.
 * Matched case-insensitively by the jargon gate test.
 */
export const FORBIDDEN_UI_TERMS: readonly string[] = [
  'graph node',
  'tripsignal',
  'dependency propagation',
  'recoverystrategy',
  'deterministic evaluator',
  'blast radius',
  'ontology',
  'read model',
  'readmodel',
  'scenario overlay',
  'planner',
  'schema',
  'mutation',
  // DR-8: internal identifiers and raw evidence must never reach user copy.
  'atlsbx-',
  'ruletrace',
  'rule trace',
  'caseid',
  'intentid',
  'strategyid',
  'signalid',
  'offerid',
  'provider flight state:',
  'schedule_changed',
  // G3R-Closure fix H: raw engine enums and safety-state vocabulary must
  // never reach organiser/traveller screens. These are the underscore-form
  // enum literals (lowercased by the gate) — they can never be natural
  // English, so matching them cannot false-positive on user copy. The raw
  // uppercase status/check enums (FAIL, UNKNOWN, etc.) are already mapped to
  // human wording by CHECK_ICONS / STATUS_LABEL and asserted by DR-8.5b.
  'fully_recovered',
  'recovered_with_loss',
  'escalated_closed',
];
