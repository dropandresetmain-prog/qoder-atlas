/**
 * E1 — user journeys + UI state inventory.
 *
 * The journey questions and the state catalogue are data, not prose: tests
 * prove every frozen envelope state and every frozen ReadModelStatus is
 * covered, and screens are derived from the same vocabulary (copy.ts), so
 * swapping fixtures for real application read models (E3) cannot redesign
 * the information architecture.
 */
import type { ReadModelState, ReadModelStatus } from '../contracts/readmodels.ts';

/** Operator journey: questions the dashboard/case screens must answer. */
export const OPERATOR_QUESTIONS = [
  'Who is ready?',
  'Who is at risk?',
  'Who is disrupted?',
  'What changed?',
  'What is affected downstream?',
  'What is the system doing?',
  'What decision is required?',
  'What remains uncertain?',
  'Has the trip actually been recovered?',
] as const;
export type OperatorQuestion = (typeof OPERATOR_QUESTIONS)[number];

/** Traveller journey: questions the mobile trip page must answer. */
export const TRAVELLER_QUESTIONS = [
  'Am I okay?',
  'What changed?',
  'What matters now?',
  'What are you doing about it?',
  'What do you need from me?',
  'Is the rest of my trip viable?',
] as const;
export type TravellerQuestion = (typeof TRAVELLER_QUESTIONS)[number];

/** Discriminable UI states beyond raw statuses (decisions, outcomes). */
export type UiStateTrigger =
  | ReadModelState
  | ReadModelStatus
  | 'AWAITING_TRAVELLER_INPUT'
  | 'AWAITING_ORGANISATION_APPROVAL'
  | 'RESOLVED_FULLY'
  | 'RESOLVED_WITH_LOSS';

export interface UiStateSpec {
  id: string;
  surface: 'OPERATOR' | 'TRAVELLER' | 'BOTH';
  trigger: UiStateTrigger;
  /** Plain-language meaning; may surface directly in the UI. */
  userMeaning: string;
  /** Journey questions this state must answer on its surface. */
  answers: readonly (OperatorQuestion | TravellerQuestion)[];
}

export const UI_STATE_INVENTORY: readonly UiStateSpec[] = [
  {
    id: 'loading',
    surface: 'BOTH',
    trigger: 'LOADING',
    userMeaning: 'We are loading your latest trip information.',
    answers: ['Am I okay?', 'Who is ready?'],
  },
  {
    id: 'error',
    surface: 'BOTH',
    trigger: 'ERROR',
    userMeaning: 'We cannot show the latest information right now. Nothing about the trip has been changed by this.',
    answers: ['Am I okay?', 'What remains uncertain?'],
  },
  {
    id: 'ready',
    surface: 'BOTH',
    trigger: 'READY',
    userMeaning: 'Everything is confirmed and on track.',
    answers: ['Who is ready?', 'Am I okay?', 'Is the rest of my trip viable?'],
  },
  {
    id: 'at-risk',
    surface: 'BOTH',
    trigger: 'AT_RISK',
    userMeaning: 'Something may still go wrong; being watched closely.',
    answers: ['Who is at risk?', 'Am I okay?', 'What are you doing about it?'],
  },
  {
    id: 'disrupted',
    surface: 'BOTH',
    trigger: 'DISRUPTED',
    userMeaning: 'Plans changed and part of the trip no longer works as booked.',
    answers: [
      'Who is disrupted?',
      'What changed?',
      'What is affected downstream?',
      'Am I okay?',
      'What matters now?',
    ],
  },
  {
    id: 'recovering',
    surface: 'BOTH',
    trigger: 'RECOVERING',
    userMeaning: 'A replacement plan is actively being worked.',
    answers: ['What is the system doing?', 'What are you doing about it?', 'What matters now?'],
  },
  {
    id: 'resolved',
    surface: 'BOTH',
    trigger: 'RESOLVED',
    userMeaning: 'The trip has been rebuilt and confirmed.',
    answers: ['Has the trip actually been recovered?', 'Am I okay?', 'Is the rest of my trip viable?'],
  },
  {
    id: 'unknown',
    surface: 'BOTH',
    trigger: 'UNKNOWN',
    userMeaning: 'Not enough confirmed information yet; never presented as certainty.',
    answers: ['What remains uncertain?', 'Am I okay?'],
  },
  {
    id: 'awaiting-traveller-input',
    surface: 'BOTH',
    trigger: 'AWAITING_TRAVELLER_INPUT',
    userMeaning: 'A choice or confirmation is needed from the traveller before continuing.',
    answers: ['What decision is required?', 'What do you need from me?'],
  },
  {
    id: 'awaiting-organisation-approval',
    surface: 'OPERATOR',
    trigger: 'AWAITING_ORGANISATION_APPROVAL',
    userMeaning: 'The organisation must approve an option (for example extra cost) before it can proceed.',
    answers: ['What decision is required?', 'What is the system doing?'],
  },
  {
    id: 'resolved-fully',
    surface: 'BOTH',
    trigger: 'RESOLVED_FULLY',
    userMeaning: 'The trip was recovered with everything originally planned kept.',
    answers: ['Has the trip actually been recovered?', 'Am I okay?', 'Is the rest of my trip viable?'],
  },
  {
    id: 'resolved-with-loss',
    surface: 'BOTH',
    trigger: 'RESOLVED_WITH_LOSS',
    userMeaning: 'The trip was recovered, but something could not be kept; shown honestly.',
    answers: ['Has the trip actually been recovered?', 'What changed?', 'Is the rest of my trip viable?'],
  },
];

/**
 * All triggers that must be covered at least once by the inventory.
 * `LOADED` is deliberately absent: it is the envelope's data-carrier state,
 * rendered through the status/decision/outcome entries above (tests assert
 * every other ReadModelState and every ReadModelStatus is covered).
 */
export const REQUIRED_UI_TRIGGERS: readonly UiStateTrigger[] = [
  'LOADING',
  'ERROR',
  'READY',
  'AT_RISK',
  'DISRUPTED',
  'RECOVERING',
  'RESOLVED',
  'UNKNOWN',
  'AWAITING_TRAVELLER_INPUT',
  'AWAITING_ORGANISATION_APPROVAL',
  'RESOLVED_FULLY',
  'RESOLVED_WITH_LOSS',
];
