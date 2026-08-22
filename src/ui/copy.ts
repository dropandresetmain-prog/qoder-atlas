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
  'constraint',
  'planner',
  'schema',
  'mutation',
];
