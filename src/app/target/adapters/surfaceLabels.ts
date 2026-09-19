/**
 * Safe, plain-language labels shared by the Decisions / Activity / Programme /
 * Traveller adapters.
 *
 * Nothing here decides anything: it only turns machine vocabulary (command
 * types, lifecycle enums, record kinds, principal ids, `KIND:uuid` refs) into
 * words a coordinator would use, and refuses to let an identifier through. A
 * value it cannot phrase becomes a neutral sentence, never the raw token.
 */
import type { ActivityGlyphTone } from '../../../ui/operator-surfaces-view-model.ts';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const KIND_REF = /\b[A-Z][A-Z_]{2,}:[^\s,;]+/g;
const SNAKE_WORD = /\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+\b/g;
const RAW_ENUM = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

/** Remove identifiers and raw enum tokens from free text a backend supplied. */
export function scrubText(text: string): string {
  return text
    .replace(KIND_REF, '')
    .replace(UUID, '')
    .replace(SNAKE_WORD, (token) => token.replace(/_/g, ' '))
    .replace(RAW_ENUM, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

/** True when a label is only an identifier or a raw token (nothing human left). */
export function isOpaqueLabel(label: string): boolean {
  return scrubText(label).length === 0;
}

const SUBJECT_NOUN: Record<string, string> = {
  TRAVELLER: 'a traveller',
  JOURNEY: 'a trip',
  JOURNEY_ITEM: 'a trip booking',
  TRIP: 'a trip',
  RECOVERY_CASE: 'a recovery case',
  RECOVERY_STRATEGY: 'a recovery option',
  ACTION_PLAN: 'a recovery plan',
  ACTION_INTENT: 'a recovery step',
  PROGRAMME: 'the programme',
  PROGRAMME_ITEM: 'a programme session',
  PARTICIPATION: 'a session booking',
  TRANSPORT_SERVICE: 'a transport service',
  RESERVATION: 'a booking',
  RESERVATION_LINE: 'a booking',
  EVENT: 'the event',
  PLACE: 'a venue',
  CHANGE_SIGNAL: 'a reported change',
  APPROVAL: 'an approval',
  AUTHORITY_DECISION: 'an approval decision',
};

export function subjectNoun(kind: string | undefined): string {
  return (kind && SUBJECT_NOUN[kind]) || 'a record';
}

interface CommandPhrase {
  /** Sentence after the actor; `{subject}` becomes the subject phrase. */
  text: string;
  tone: ActivityGlyphTone;
  glyph: string;
  sub?: string;
}

const TONE_GLYPH: Record<ActivityGlyphTone, string> = {
  signal: '!',
  work: '◆',
  ask: '?',
  done: '✓',
  info: 'i',
};

function p(text: string, tone: ActivityGlyphTone, sub?: string): CommandPhrase {
  return { text, tone, glyph: TONE_GLYPH[tone], ...(sub ? { sub } : {}) };
}

const COMMAND_PHRASES: Record<string, CommandPhrase> = {
  CHANGE_SIGNAL_RECORDED: p('noticed a change affecting {subject}', 'signal'),
  CHANGE_SIGNAL_COMPLETED: p('finished checking what a change means for {subject}', 'work'),
  EXTERNAL_SCHEDULE_OBSERVATION_RECORDED: p('recorded a schedule update for {subject}', 'signal'),
  TRANSPORT_SERVICE_OBSERVED: p('recorded a live update for {subject}', 'signal'),
  RESERVATION_LINE_OBSERVED: p('recorded a live update for {subject}', 'signal'),
  RECOVERY_CASE_OPENED: p('opened a recovery case for {subject}', 'signal'),
  RECOVERY_CASE_LINKED: p('linked {subject} to a recovery case', 'work'),
  RECOVERY_CASE_ATTENTION_OPENED: p('flagged {subject} as needing attention', 'signal'),
  RECOVERY_CASE_ATTENTION_RESOLVED: p('cleared the attention flag for {subject}', 'done'),
  RECOVERY_CASE_PHASE_CHANGED: p('moved the recovery for {subject} to its next stage', 'work'),
  RECOVERY_CASE_ORIGINAL_GRAPH_CAPTURED: p('saved the original trip picture for {subject}', 'info'),
  RECOVERY_PLANNING_ATTEMPT_PERSISTED: p('started comparing recovery options for {subject}', 'work'),
  RECOVERY_PLANNING_COMPLETED: p('finished comparing recovery options for {subject}', 'work'),
  RECOVERY_STRATEGY_PERSISTED: p('prepared a recovery option for {subject}', 'work'),
  ACTION_PLAN_CREATED: p('prepared a recovery plan for {subject}', 'work'),
  AUTHORITY_DECISION_ISSUED: p('checked who may approve the plan for {subject}', 'ask'),
  APPROVAL_RECORDED: p('recorded an approval for {subject}', 'done'),
  APPROVAL_REVOKED: p('withdrew an approval for {subject}', 'signal'),
  EXECUTION_ATTEMPT_PREPARED: p('got a recovery step ready for {subject}', 'work'),
  EXECUTION_INTERNAL_CLAIMED: p('started applying a recovery step for {subject}', 'work'),
  EXECUTION_INTERNAL_OBSERVED: p('confirmed a recovery step for {subject}', 'done'),
  EXECUTION_INTERNAL_REPLAY: p('confirmed a recovery step for {subject}', 'done'),
  RECOVERY_CASE_RESOLVED: p('closed the recovery for {subject}', 'done'),
  PROGRAMME_ITEM_SCHEDULE_CHANGED: p('changed the schedule of {subject}', 'signal'),
  PROGRAMME_ITEM_SCHEDULE_AUTHORITY_SET: p('set who controls the schedule of {subject}', 'info'),
  PROGRAMME_ITEM_ADDED: p('added {subject} to the programme', 'info'),
  PROGRAMME_CREATED: p('set up the programme', 'info'),
  PARTICIPATION_ADDED: p('added someone to {subject}', 'info'),
  PARTICIPATION_UPDATED: p('updated who attends {subject}', 'info'),
  JOURNEY_CREATED: p('set up the trip for {subject}', 'info'),
  JOURNEY_ITEM_ADDED: p('added a booking to {subject}', 'info'),
  JOURNEY_ITEM_UPDATED: p('updated a booking on {subject}', 'info'),
  TRIP_CREATED: p('set up a trip', 'info'),
  TRAVELLER_RECORDED: p('added a traveller to the programme', 'info'),
  TRAVELLER_NAME_ADDED: p('recorded a name for {subject}', 'info'),
  RESERVATION_CREATED: p('recorded a booking for {subject}', 'info'),
  RESERVATION_ALLOCATED: p('assigned a booking to {subject}', 'info'),
  TRANSPORT_SERVICE_CREATED: p('recorded a transport service', 'info'),
  EVIDENCE_RECORDED: p('saved a supporting record for {subject}', 'info'),
  SOURCE_RECORDED: p('saved where a piece of information came from', 'info'),
  BUDGET_COMMITMENT_CREATED: p('committed budget for {subject}', 'info'),
};

/** Capitalise the first letter (used for detail lines humanised from codes). */
export function sentenceCase(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** Plain wording for a per-person check result (operator surfaces). */
export const CHECK_RESULT_LABEL: Record<'PASS' | 'FAIL' | 'UNKNOWN', string> = {
  PASS: 'Works',
  FAIL: 'Does not work',
  UNKNOWN: 'Not confirmed',
};

function fallbackPhrase(command: string): CommandPhrase {
  const words = command.toLowerCase().split('_').filter(Boolean);
  const verb = words.at(-1) ?? 'updated';
  const past = /(ed|d)$/.test(verb) ? verb : 'updated';
  const noun = words.slice(0, -1).join(' ') || 'record';
  const tone: ActivityGlyphTone = 'info';
  return p(`${past} ${noun} for {subject}`, tone);
}

export function activityPhrase(command: string, subjectPhrase: string): CommandPhrase {
  const phrase = COMMAND_PHRASES[command] ?? fallbackPhrase(command);
  return { ...phrase, text: phrase.text.replace('{subject}', subjectPhrase) };
}

/** Case lifecycle -> what the coordinator should understand about it. */
export const CASE_WAIT_TEXT: Record<string, string> = {
  OPEN: 'Northstar is checking how the change affects the trip.',
  PLANNING: 'Northstar is comparing recovery options for the trip.',
  AWAITING_AUTHORITY: 'A recovery plan is ready and needs an organiser to approve it.',
  EXECUTING: 'The approved recovery is being applied and checked.',
  RESOLVED: 'The trip has been recovered.',
  CLOSED: 'This case is closed.',
  CANCELLED: 'This case was cancelled.',
};

export const CASE_STAGE_LABEL: Record<string, string> = {
  OPEN: 'Checking the change',
  PLANNING: 'Comparing options',
  AWAITING_AUTHORITY: 'Waiting for approval',
  EXECUTING: 'Recovery under way',
  RESOLVED: 'Recovered',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export function actorPhrase(actorKind: 'HUMAN' | 'SERVICE' | 'SYSTEM' | undefined): string {
  return actorKind === 'HUMAN' ? 'Organiser' : 'Northstar';
}

/** Age of an instant relative to a reference, e.g. "25m", "3h", "2d". */
export function relativeAge(iso: string, generatedAt: string): string | undefined {
  const ms = Date.parse(generatedAt) - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
