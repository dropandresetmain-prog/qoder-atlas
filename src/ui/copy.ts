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
  'Candidates appear here the moment they are scored — nothing half-checked is ever shown as an option.';

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
  'Money-moving changes need the right principal. Within the programme policy, Northstar can proceed with a receipt; above that, the organising team or traveller must approve first. Nothing books silently.';

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
];
