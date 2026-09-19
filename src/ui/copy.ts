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
  READY: 'Confirmed',
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
  RESOLVED: 'The trip is back on track and this case is closed.',
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
// Case workspace (approved C1–C6) — section headings and fixed copy.
// ---------------------------------------------------------------------------

/** External/source fact heading (Pass 2 — distinct from downstream impact). */
export const CASE_WHAT_HAPPENED_TITLE = 'What happened';

/** Lead callout heading above the change summary (C1); resolved-case section. */
export const CASE_WHAT_CHANGED_TITLE = 'What changed';

/** Downstream consequence heading (Pass 2 — Northstar-computed impact). */
export const CASE_DOWNSTREAM_IMPACT_TITLE = 'What this affects';

/** Impact list heading (approved C1 wording; alias for downstream impact). */
export const CASE_AFFECTED_TITLE = CASE_DOWNSTREAM_IMPACT_TITLE;

/** Progressive status/evidence timeline (Pass 2). */
export const CASE_STATUS_TIMELINE_TITLE = 'How this unfolded';

/** Selected recovery section when a proposal is staged (Pass 2). */
export const CASE_SELECTED_RECOVERY_TITLE = 'Selected recovery';

/** Checks-list heading (approved C1 wording). */
export const CASE_CHECKS_TITLE = 'What we checked';

/** In-flight activity list heading (approved C2 wording). */
export const CASE_ACTIVITY_TITLE = 'What Northstar is doing right now';

/** Past-tense activity heading once every recorded action is done. */
export const CASE_ACTIVITY_DONE_TITLE = 'What Northstar did';

/** Skeleton panel heading while options are still being scored (C2). */
export const CASE_OPTIONS_FORMING_TITLE = 'Options take shape here';

/** Skeleton panel footnote (approved C2 wording). */
export const CASE_OPTIONS_FORMING_NOTE =
  'Workable options will appear here once the checks are complete.';

/** Options heading when every candidate was rejected (approved C5 wording). */
export const CASE_OPTIONS_ALL_REJECTED_TITLE = 'What was considered — and why none of them work';

/** Lead callout heading when planning exhausted every automated path (C5). */
export const CASE_EXHAUSTED_TITLE = 'No safe automatic fix — Northstar has stopped rather than gamble';

/** Lead callout heading while waiting on an approval decision (C4). */
export const CASE_WAITING_DECISION_TITLE = 'Waiting on a decision';

/** Count-aware options heading (approved C3 wording pattern). */
export function caseOptionsHeading(count: number): string {
  return count === 1 ? 'One way this could go' : `${count} ways this could go`;
}

/** Approval panel heading (approved C4 wording). */
export const CASE_APPROVAL_TITLE = 'What you\u2019re approving';

/** Ink rail card label while the commitment is still at stake (C1–C5). */
export const CASE_COMMITMENT_AT_STAKE_LABEL = 'The commitment at stake';

/** Ink rail card label once the trip is recovered (approved C6 wording). */
export const CASE_COMMITMENT_HELD_LABEL = 'The commitment that held';

/** Inline fallback heading when no structured commitment card exists. */
export const CASE_COMMITMENT_FALLBACK_TITLE = 'Must not be missed';

/**
 * Standing authority explainer (approved rail card, C1–C5). Describes the
 * authority model generically — the concrete cap figure is case data and
 * belongs to the projected rail sections, never to fixed copy.
 */
export const CASE_AUTHORITY_TITLE = 'Authority';
export const CASE_AUTHORITY_COPY =
  'Northstar checks who is allowed to approve each change before anything is applied. Some changes are already authorised by policy; others wait for the organiser or traveller. Every action is recorded.';

/** Case badge derivations beyond the raw trip status (approved C3/C4/C5). */
export const CASE_BADGE_OPTIONS_READY = 'Options on the table';
/** Staged proposal waiting on the correct principal — not option-picking. */
export const CASE_BADGE_APPROVAL_NEEDED = 'Awaiting approval';
export const CASE_BADGE_HUMAN_DECISION = 'Needs organiser decision';

/** Payer wording for the funding split legend (approved C4). */
export const PAYER_LABEL: Record<'EVENT_ORGANISATION' | 'TRAVELLER' | 'ORGANISATION' | 'OTHER', string> = {
  EVENT_ORGANISATION: 'Programme',
  ORGANISATION: 'Organisation',
  TRAVELLER: 'Traveller',
  OTHER: 'Other',
};

/** Judge-facing principal labels — never expose HUMAN_AGENT enum wording. */
export const AUTHORITY_PRINCIPAL_LABEL: Record<
  'TRAVELLER' | 'ORGANISATION' | 'HUMAN_AGENT',
  string
> = {
  TRAVELLER: 'Traveller',
  ORGANISATION: 'Organisation',
  HUMAN_AGENT: 'Organiser',
};

export function authorityNeededLabel(
  requestedFrom: 'TRAVELLER' | 'ORGANISATION' | 'HUMAN_AGENT',
): string {
  switch (requestedFrom) {
    case 'TRAVELLER':
      return 'Traveller approval required';
    case 'ORGANISATION':
      return 'Organisation approval required';
    case 'HUMAN_AGENT':
      return 'Organisation approval required';
  }
}

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

/** Short label for the endangered-commitments section (approved P2 wording). */
export const PROGRAMME_ENDANGERED_TITLE = 'Endangered commitments';

/** Heading for the programme-level "missing information" panel (approved P1 wording). */
export const PROGRAMME_MISSING_INFO_TITLE = 'Missing traveller information';

/** Affordance: single-traveller intake. */
export const PROGRAMME_INTAKE_ADD_LABEL = 'Add one traveller';

/** Affordance: import an updated traveller sheet (approved footer wording). */
export const PROGRAMME_IMPORT_UPDATED_LABEL = 'Import an updated sheet';

/** Affordance: open the what-if programme-change preview. */
export const PROGRAMME_CHANGE_PREVIEW_LABEL = 'Preview a programme change';

/** Inert affordances shown on the programme footer until wired by the integrator. */
export const PROGRAMME_EXPORT_LABEL = 'Export roster';
export const PROGRAMME_MESSAGE_AFFECTED_LABEL = 'Message affected travellers';

/** Missing-information panel action label (plural-safe for any count). */
export const PROGRAMME_ASK_TRAVELLERS_LABEL = 'Ask these travellers';

/** Section title for the per-day commitment timeline. */
export const PROGRAMME_TIMELINE_TITLE = 'Programme timeline';

/** Column headers for the programme traveller table (approved P1/P2 columns). */
export const PROGRAMME_TABLE_HEADERS = {
  name: 'Traveller',
  role: 'Role',
  arrival: 'Arrival',
  status: 'Status',
} as const;

/**
 * Tile labels for the approved programme summary buckets. The buckets
 * aggregate the frozen ProgrammeStatusSummary fields into the designer's
 * programme-health vocabulary (P1/P2/E1/E2 all use the same six tiles).
 */
export const PROGRAMME_TILE_LABEL = {
  total: 'Travellers',
  /** Used when nothing on the programme needs action — the healthy wording. */
  onTrackCalm: 'Confirmed',
  /** Used whenever any trip is disrupted, at risk, recovering, or waiting. */
  onTrackActive: 'On track',
  watching: 'Watching',
  inRecovery: 'In recovery',
  beingPlanned: 'Being planned',
  unconfirmed: 'Unconfirmed',
  endangered: 'Endangered commitments',
} as const;

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
  'place-hotel-',
  'provider flight state:',
  'schedule_changed',
  // Judge-facing: never expose internal authority enum wording.
  'human agent',
  'human_agent',
  'requires_human_agent',
  // G3R-Closure fix H: raw engine enums and safety-state vocabulary must
  // never reach organiser/traveller screens. These are the underscore-form
  // enum literals (lowercased by the gate) — they can never be natural
  // English, so matching them cannot false-positive on user copy. The raw
  // uppercase status/check enums (FAIL, UNKNOWN, etc.) are already mapped to
  // human wording by CHECK_ICONS / STATUS_LABEL and asserted by DR-8.5b.
  'fully_recovered',
  'recovered_with_loss',
  'escalated_closed',
  // Final production pass: internal ranking/provenance vocabulary must stay
  // out of judge-facing copy as well.
  'search evidence',
  'provider boundary',
  'soft tradeoffs',
  'evidenced option',
  'required arrival buffer',
  // Final polish pass: provider/execution provenance never renders on hero
  // surfaces — it stays in state, audit and debug data only.
  'recorded provider response',
  'live provider response',
  'execution: simulated',
  // R4 (Case parity): raw enum literals, engine vocabulary and machine
  // failure codes that leaked into the PostgreSQL Case surface. All are
  // underscore/compound forms that cannot occur in natural user copy.
  'awaiting_authority',
  'needs_evidence_or_decision',
  'no_recovery_found',
  'stale_retry_required',
  'outcome_unknown',
  'recording_not_found',
  'deterministic comparator',
  'ai-assisted comparator',
  'reconciliation',
  'recovery strategy',
  'strategy_ref',
  'decision-time',
  'reached subject',
];

/**
 * Raw UPPER_CASE engine enums that must never appear in VISIBLE case text
 * (data-* attributes and the Technical details disclosure are exempt).
 * Case-sensitive on purpose: the same words in sentence case are natural copy.
 */
export const FORBIDDEN_UI_ENUM_PATTERN =
  /\b(?:PASS|FAIL|UNKNOWN|VIABLE|NOT_VIABLE|EVALUATED|PROPOSED|SELECTED|AUTHORIZED|EXECUTING|RECONCILING|COMPLETED|OUTCOME_UNKNOWN|OPEN|PLANNING|RESOLVED|SUPERSEDED|CANCELLED|CLOSED|AWAITING_AUTHORITY|REJECTED_DETERMINISTIC|REJECTED_VALIDATION|VIABLE_NOT_RECOMMENDED|RECOMMENDED|HEALTHY|AFFECTED|FAILED|CHANGED)\b/;

/** A canonical UUID anywhere in visible text is a leaked internal identifier. */
export const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// ---------------------------------------------------------------------------
// R4 Case workspace vocabulary (PostgreSQL v2 read model -> plain language).
// Closed maps keyed on the read model's closed codes. Anything not covered
// falls back to the generic wording here — never to the raw code.
// ---------------------------------------------------------------------------

export const CASE_COPY = {
  backToOverview: '← Back to Overview',
  backToOverviewButton: 'Back to Overview',
  whatThisAffects: 'What this affects',
  healthyContext: (n: number) =>
    n === 1 ? '1 other part of the trip is unaffected.' : `${n} other parts of the trip are unaffected.`,
  activityDoing: 'What NORTHSTAR is doing',
  activityDone: 'What NORTHSTAR did',
  recoveryOptions: 'Recovery options',
  recommended: 'Recommended',
  otherOptionsConsidered: 'Other options considered',
  technicalDetails: 'Technical details',
  whatYoureApproving: 'What you’re approving',
  whatWeChecked: 'What we checked',
  checkedFootnote: 'Checked against the fixed parts of the trip (event times, bookings and policy limits).',
  decline: 'Decline',
  escalate: 'Hand off to a person',
  findRecovery: 'Find a recovery',
  findRecoveryHint:
    'NORTHSTAR will re-check the whole trip, compare safe fixes and tell you who needs to approve what before anything is changed.',
  nothingChangesUntil: 'Nothing changes until you approve.',
  graphHeading: 'How the trip is affected',
  graphResolvedNote:
    'Current shows the trip after recovery. Original keeps how the disruption looked when it was found.',
  noPlanTitle: 'No safe automatic fix yet',
  noPlanBody:
    'NORTHSTAR stopped rather than gamble with the trip. Nothing has been changed. A person needs to decide the next step.',
  executingTitle: 'Applying the approved recovery',
  executingBody:
    'NORTHSTAR is applying the approved change, confirming each result and re-checking the trip. Nothing is marked as recovered until it has been checked.',
  recoveredTitle: 'Trip recovered',
  closedTitle: 'This case is closed',
  investigatingTitle: 'Checking the trip',
  investigatingBody: 'NORTHSTAR is re-checking the whole trip and comparing safe ways to fix it. Nothing has been changed.',
  waitingTitle: 'Waiting on a decision',
  happenedTitle: 'What happened',
  errorTitle: 'This case cannot be displayed yet',
  errorBody: 'The details are unavailable right now. Please refresh in a moment.',
} as const;

/** Plain status badge per case status (never the raw enum). */
export const CASE_STATUS_BADGE: Record<string, { label: string; tone: 'ok' | 'watch' | 'alert' | 'active' | 'done' | 'neutral' }> = {
  OPEN: { label: 'Needs attention', tone: 'alert' },
  PLANNING: { label: 'Finding a recovery', tone: 'active' },
  AWAITING_AUTHORITY: { label: 'Awaiting approval', tone: 'watch' },
  EXECUTING: { label: 'Recovery under way', tone: 'active' },
  RESOLVED: { label: 'Recovered', tone: 'done' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  SUPERSEDED: { label: 'Replaced by a newer case', tone: 'neutral' },
};

/** What changed, keyed on the change signal's closed type code. */
export const CASE_CHANGE_TYPE_SENTENCE: Record<string, string> = {
  TRANSPORT_SCHEDULE_OBSERVED: 'A booked service changed its schedule.',
  TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION:
    'A booked service was cancelled and the traveller was moved onto a replacement.',
};
export const CASE_CHANGE_FALLBACK = 'Something changed on a booking that this trip relies on.';

/** Why it matters, keyed on the evaluator's registered reason codes. */
export const CASE_REASON_SENTENCE: Record<string, string> = {
  arrives_after_deadline: 'the new timing means arriving too late',
  arrival_time_unknown: 'the arrival time is no longer confirmed',
  no_route_to_place: 'there is no confirmed way to get there',
  transfer_time_unknown: 'the transfer time is not confirmed',
  connection_broken: 'the connection no longer works',
  connection_below_minimum: 'there is not enough time to connect',
  connection_time_unknown: 'the connection time is not confirmed',
  route_discontinuity: 'the journey no longer joins up',
  overnight_unaccommodated: 'there is no confirmed place to stay overnight',
  overnight_gap_time_unknown: 'the overnight gap is not confirmed',
  booking_invalid: 'a booking is no longer valid',
  booking_missing: 'a booking is missing',
  booking_state_unknown: 'a booking is not confirmed',
  service_selected_not_booked: 'a chosen service has not been booked yet',
  insufficient_arrival_readiness: 'there is not enough time to be ready on arrival',
  departs_before_item_ends: 'the departure is before the session ends',
  programme_item_cancelled: 'a programme session was cancelled',
  attend_target_cancelled: 'a session to attend was cancelled',
  attend_target_unscheduled: 'a session to attend has no time set',
  no_active_assignment: 'a required role has nobody assigned',
  assignment_does_not_satisfy_requirement: 'an assignment no longer meets its requirement',
  capacity_exceeded: 'a capacity limit would be exceeded',
};
export const CASE_REASON_FALLBACK = 'part of the trip no longer works';

/** Deterministic check dimensions -> plain "Checking ..." activity rows. */
export const CASE_DIMENSION_ACTIVITY: Record<string, string> = {
  arrival_readiness: 'Checking arrival timing',
  connection_feasibility: 'Checking connections',
  booking_validity: 'Checking bookings',
  supplier_fulfilment: 'Checking supplier confirmations',
  overnight_accommodation: 'Checking overnight stays',
  programme_participation: 'Checking programme commitments',
  optional_participation: 'Checking optional sessions',
  hard_objectives: 'Checking must-have goals',
  soft_objectives: 'Checking preferences',
  waived_objectives: 'Checking accepted trade-offs',
  transfer_fit: 'Checking ground transfers',
  stay_coverage: 'Checking accommodation cover',
};

/** Research domains -> plain activity rows (done wording; doing/unavailable derived). */
export const CASE_DOMAIN_ACTIVITY: Record<string, { checking: string; unavailable: string }> = {
  TRANSPORT: { checking: 'Checking replacement travel', unavailable: 'Replacement travel could not be checked' },
  STAY: { checking: 'Checking accommodation', unavailable: 'Accommodation could not be checked' },
  TRANSFER: { checking: 'Checking ground transfers', unavailable: 'Ground transfers could not be checked' },
  PROGRAMME: { checking: 'Checking programme flexibility', unavailable: 'Programme flexibility could not be checked' },
  SUPPORT_COORDINATION: { checking: 'Checking support cover', unavailable: 'Support cover could not be checked' },
  INFORMATION_RESEARCH: { checking: 'Researching supporting information', unavailable: 'Supporting information could not be researched' },
};

/** Read-only research tools -> plain activity rows. */
export const CASE_TOOL_ACTIVITY: Record<string, { checking: string; unavailable: string; note: string }> = {
  'flight.search': {
    checking: 'Checking replacement flights',
    unavailable: 'Replacement flights could not be checked',
    note: 'No flight availability was obtained, so no replacement flight is being suggested.',
  },
};
export const CASE_TOOL_FALLBACK = { checking: 'Researching options', unavailable: 'Some research could not be completed', note: '' };

/** Recovery effects -> plain phrasing. `{subject}` is the item's own title. */
export const CASE_EFFECT_PHRASE: Record<string, { title: string; generic: string }> = {
  CHANGE_PROGRAMME_ITEM_TIME: { title: 'Move {subject}', generic: 'Change a programme time' },
  SELECT_OFFER: { title: 'Rebook {subject}', generic: 'Book a replacement flight' },
  PROPOSE_ALLOCATION: { title: 'Reserve space for {subject}', generic: 'Reserve a place on a replacement booking' },
  ALTER_JOURNEY_ITEM_INTENT: { title: 'Adjust {subject}', generic: 'Adjust part of the journey' },
  CHANGE_SUPPORT_ASSIGNMENT: { title: 'Reassign {subject}', generic: 'Reassign support cover' },
  WAIVE_OBJECTIVE: { title: 'Accept missing {subject}', generic: 'Accept missing one goal' },
};

/** Nouns for a typed subject kind when no human title exists. */
export const CASE_SUBJECT_KIND_NOUN: Record<string, string> = {
  JOURNEY: 'the trip',
  JOURNEY_ITEM: 'a part of the journey',
  PROGRAMME_ITEM: 'a programme session',
  RESERVATION_LINE: 'a booking',
  CONSTRAINT_DEFINITION: 'a requirement',
  OBJECTIVE: 'a goal',
};

/** Execution capability -> plain progress phrasing (present, past). */
export const CASE_ACTION_PHRASE: Record<string, { doing: string; done: string }> = {
  'programme.schedule': { doing: 'Updating the programme schedule', done: 'Updated the programme schedule' },
  'flight.book': { doing: 'Booking the replacement flight', done: 'Booked the replacement flight' },
  'hotel.book': { doing: 'Updating the hotel booking', done: 'Updated the hotel booking' },
  'transfer.book': { doing: 'Updating the airport transfer', done: 'Updated the airport transfer' },
};
export const CASE_ACTION_DOMAIN_FALLBACK: Record<string, { doing: string; done: string }> = {
  PROGRAMME: { doing: 'Updating the programme', done: 'Updated the programme' },
  TRANSPORT: { doing: 'Updating the travel booking', done: 'Updated the travel booking' },
  STAY: { doing: 'Updating the accommodation', done: 'Updated the accommodation' },
  TRANSFER: { doing: 'Updating the ground transfer', done: 'Updated the ground transfer' },
};
export const CASE_ACTION_FALLBACK = { doing: 'Applying a change', done: 'Applied a change' };

/** Ldg node kind -> noun shown when a node label is missing or looks internal. */
export const CASE_NODE_KIND_NOUN: Record<string, string> = {
  SERVICE_BOOKING: 'Booked service',
  TRAVELLER: 'Traveller',
  TIMING: 'Timing',
  TRANSFER_STAY: 'Transfer or stay',
  PROGRAMME_COMMITMENT: 'Programme commitment',
};

/** Ldg semantic state -> short plain note in the "What this affects" list. */
export const CASE_NODE_STATE_NOTE: Record<string, string> = {
  FAILED: 'No longer works',
  AFFECTED: 'Affected',
  CHANGED: 'Changed',
  UNKNOWN: 'Not confirmed yet',
  PROPOSED: 'Proposed change',
  ACTIVE: 'In progress',
  RECOVERED: 'Recovered',
  HEALTHY: 'Unaffected',
};
