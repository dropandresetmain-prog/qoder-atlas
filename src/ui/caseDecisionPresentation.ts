/**
 * A3 decision presentation. This is a read-only projection, not a planner:
 * preserve the recorded recommendation, distinguish quoted spend from possible
 * loss, and keep incomplete research incomplete. No provider calls or writes.
 */
import type {
  PlanningCandidateView, PlanningCostComparisonView, RecoveryCaseView,
  RecoveryStrategyView,
} from '../contracts/v2/product/readModels.ts';
import { dedupeStrategies, plain } from '../app/target/adapters/caseWorkspacePresenter.ts';
import { CASE_EFFECT_PHRASE, CASE_REASON_SENTENCE } from './copy.ts';

/** @deprecated Do not use as a global disable reason; prefer decisionActionState(). */
export const A3_EXECUTION_PAUSE = 'This review is read-only. Approval and execution are not enabled, so no changes can be submitted here.';

export function decisionText(value: string | undefined, fallback: string): string {
  return plain(value) ?? fallback;
}

/**
 * Consequential control availability for the recorded recommendation only.
 * Absence of an execution blocker means the composed approve path may run;
 * the server still resolves the principal and grant coverage. Missing
 * recommendation or an explicit blocker fails closed in the UI.
 */
export type DecisionActionState =
  | { readonly kind: 'none' }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'blocked'; readonly reason: string; readonly code: string }
  | { readonly kind: 'ready'; readonly strategyRef: string };

export function decisionActionState(view: RecoveryCaseView): DecisionActionState {
  if (!['OPEN', 'AWAITING_AUTHORITY'].includes(view.status)) return { kind: 'none' };
  const options = decisionOptions(view);
  if (!options.recommended) {
    return {
      kind: 'unavailable',
      reason: options.issue ?? 'A current recommendation is not identified in the supplied evidence.',
    };
  }
  const blocker = options.recommended.executionBlocker;
  if (blocker) {
    return {
      kind: 'blocked',
      code: blocker.code,
      reason: decisionText(blocker.message, 'This option cannot be executed by this runtime yet.'),
    };
  }
  return { kind: 'ready', strategyRef: options.recommended.strategyRef };
}

/** Display source times in their supplied zone; never infer a traveller's zone. */
export function decisionTime(value: string, zone?: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Time not supplied';
  const format = (timeZone: string): string => new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone, timeZoneName: 'short',
  }).format(date);
  try { return format(zone || 'UTC'); } catch { return format('UTC'); }
}

/** A typed ref may wrap the same exact ID. Substring/suffix matches are unsafe. */
export function sameStrategy(ref: string | undefined, id: string): boolean {
  return ref === id || ref === `RECOVERY_STRATEGY:${id}`;
}

export function decisionOptions(view: RecoveryCaseView): {
  recommended?: RecoveryStrategyView;
  alternatives: RecoveryStrategyView[];
  issue?: string;
} {
  if (!['OPEN', 'AWAITING_AUTHORITY'].includes(view.status)) return { alternatives: [] };
  const eligible = view.strategies.filter((s) => s.viability === 'VIABLE'
    && (s.status === 'EVALUATED' || s.status === 'PROPOSED'));
  const ref = view.planningEvidence?.recommendation?.recommended.ref;
  // Preserve the existing deduplication for programme-only proposals. Provider
  // offers are not merged by effect shape: two prices/properties may share it.
  const hasProviderChange = (s: RecoveryStrategyView): boolean => s.changes.some((c) =>
    c.effectKind === 'SELECT_OFFER' || c.effectKind === 'ADD_JOURNEY_STAY');
  const viable = [...dedupeStrategies(eligible.filter((s) => !hasProviderChange(s)), ref),
    ...eligible.filter(hasProviderChange)];
  const recommended = viable.find((s) => sameStrategy(ref, s.strategyRef));
  // A blocked recommendation remains the recommendation. Do not silently
  // substitute a different option merely because it could be executed sooner.
  return {
    ...(recommended ? { recommended } : {}),
    alternatives: viable.filter((s) => s !== recommended).sort((a, b) => a.optionNumber - b.optionNumber),
    ...(!recommended && viable.length ? { issue: 'Viable options are available, but a current recommendation is not identified in the supplied evidence.' } : {}),
  };
}

export function candidateFor(view: RecoveryCaseView, strategy: RecoveryStrategyView): PlanningCandidateView | undefined {
  return view.planningEvidence?.candidates.find((c) => sameStrategy(c.strategyRef, strategy.strategyRef));
}

export function decisionTitle(strategy: RecoveryStrategyView): string {
  const kinds = new Set(strategy.changes.map((c) => c.effectKind));
  if (kinds.has('SELECT_OFFER')) return kinds.has('ADD_JOURNEY_STAY')
    ? 'Replace the flight and arrange accommodation' : 'Book replacement travel';
  if (kinds.has('CHANGE_PROGRAMME_ITEM_TIME')) return 'Reschedule the programme commitment';
  if (kinds.has('ADD_JOURNEY_STAY')) return 'Arrange replacement accommodation';
  return 'Proposed whole-trip recovery';
}

export function changeSummary(change: RecoveryStrategyView['changes'][number]): string {
  const label = plain(change.subjectLabel);
  const vocabulary = CASE_EFFECT_PHRASE[change.effectKind];
  const action = vocabulary ? (label ? vocabulary.title.replace('{subject}', label) : vocabulary.generic)
    : label ? `Update ${label}` : 'Update part of the trip';
  if (!change.proposedWindow) return action;
  const next = `${decisionTime(change.proposedWindow.start, change.timeZone)} – ${decisionTime(change.proposedWindow.end, change.timeZone)}`;
  if (!change.currentWindow) return `${action}: ${next}`;
  if (change.currentWindow.start === change.proposedWindow.start && change.currentWindow.end === change.proposedWindow.end) {
    return `${label ?? 'Schedule'} already matches ${next}`;
  }
  return `${action}: ${decisionTime(change.currentWindow.start, change.timeZone)} → ${next}`;
}

type Money = { readonly amount: string; readonly currency: string };
export const decisionMoney = (money: Money): string => `${money.currency} ${money.amount}`;

/**
 * Exact display-only subtotals of already supplied comparison lines. No FX
 * lookup, binary floating-point money, ranking or authority decisions here.
 * Mixed currencies stay separate. Invalid amounts return an explicit absence.
 */
export function sumDisplayedMoney(amounts: readonly Money[]): string[] | undefined {
  if (!amounts.length) return undefined;
  const groups = new Map<string, { units: bigint; precision: number }>();
  for (const money of amounts) {
    if (!/^-?\d{1,30}(?:\.\d{1,12})?$/.test(money.amount) || !/^[A-Z]{3}$/.test(money.currency)) return undefined;
    const precision = money.amount.split('.')[1]?.length ?? 0;
    const units = BigInt(money.amount.replace('.', ''));
    const previous = groups.get(money.currency);
    const p = Math.max(previous?.precision ?? 0, precision);
    groups.set(money.currency, {
      units: (previous ? previous.units * 10n ** BigInt(p - previous.precision) : 0n) + units * 10n ** BigInt(p - precision),
      precision: p,
    });
  }
  return [...groups].map(([currency, { units, precision }]) => {
    const absolute = (units < 0n ? -units : units).toString().padStart(precision + 1, '0');
    const amount = precision ? `${absolute.slice(0, -precision)}.${absolute.slice(-precision)}` : absolute;
    return `${currency} ${units < 0n ? '-' : ''}${amount}`;
  });
}

export function decisionCosts(comparison: PlanningCostComparisonView | undefined) {
  if (!comparison || comparison.status === 'UNAVAILABLE') return {
    spend: [], exposure: [], other: [],
    unavailable: comparison?.status === 'UNAVAILABLE'
      ? decisionText(comparison.reason, 'The required price or currency evidence is unavailable.')
      : 'No cost comparison was supplied. This does not mean the recovery is free.',
  };
  const spend = comparison.lines.filter((line) => line.kind.code === 'SELECT_OFFER' || line.kind.code === 'ADD_JOURNEY_STAY');
  const exposure = comparison.lines.filter((line) => line.kind.code === 'POLICY_PENALTY_ESTIMATE');
  const other = comparison.lines.filter((line) => !spend.includes(line) && !exposure.includes(line));
  return {
    spend, exposure, other, comparison,
    newSpend: sumDisplayedMoney(spend.map((line) => line.homeAmount)),
    providerSpend: sumDisplayedMoney(spend.map((line) => line.providerAmount)),
    potentialLoss: sumDisplayedMoney(exposure.map((line) => line.homeAmount)),
  };
}

const DISPOSITION: Record<string, string> = {
  REJECTED_VALIDATION: 'Rejected', REJECTED_DETERMINISTIC: 'Rejected',
  VIABLE_NOT_RECOMMENDED: 'Viable · not selected', RECOMMENDED: 'Recommended',
};
export function rejectionSummary(candidate: PlanningCandidateView): { label: string; status: string; reason: string } {
  const proposal = candidate.proposal;
  const label = proposal?.flights[0]?.label ?? proposal?.stays[0]?.placeLabel ?? candidate.domain.label;
  const failedCommitment = proposal?.programmeChecks?.find((check) => check.verdict === 'FAIL');
  const blocker = proposal?.blockers.find((check) => check.verdict === 'FAIL') ?? proposal?.blockers[0];
  const recordedReason = failedCommitment?.reasonCode ?? blocker?.reasonCode;
  const reason = recordedReason ? CASE_REASON_SENTENCE[recordedReason] : undefined;
  const timings = failedCommitment
    ? [failedCommitment.availableMinutes === undefined ? '' : `Time available: ${failedCommitment.availableMinutes} min`, failedCommitment.requiredMinutes === undefined ? '' : `Time required: ${failedCommitment.requiredMinutes} min`]
    : [blocker?.timing?.gapMinutes === undefined ? '' : `Time available: ${blocker.timing.gapMinutes} min`, blocker?.timing?.requiredMinutes === undefined ? '' : `Time required: ${blocker.timing.requiredMinutes} min`];
  const conciseSource = candidate.reasons.map(plain).find((r): r is string => r !== undefined && r.length <= 240);
  const delta = candidate.outcomeDelta[0];
  const outcomeWord = (value: string | undefined): string | undefined =>
    value === 'PASS' ? 'works' : value === 'FAIL' ? 'does not work' : value === 'UNKNOWN' ? 'not confirmed' : undefined;
  const movement = delta && outcomeWord(delta.baseline) && outcomeWord(delta.candidate)
    ? `${decisionText(delta.subject.label, 'Trip outcome')}: ${outcomeWord(delta.baseline)} → ${outcomeWord(delta.candidate)}` : undefined;
  const fallback = candidate.disposition.code === 'VIABLE_NOT_RECOMMENDED'
    ? 'This option is viable but was not selected in the recorded comparison.'
    : 'The recorded checks did not accept this option. See the detailed evaluation for the reason.';
  const unknownBlocker = proposal?.blockers.find((check) => check.verdict === 'UNKNOWN');
  const unknownReason = unknownBlocker?.reasonCode ? CASE_REASON_SENTENCE[unknownBlocker.reasonCode] : undefined;
  return {
    label: decisionText(label, 'Another recovery option'),
    status: DISPOSITION[candidate.disposition.code ?? ''] ?? 'Not selected',
    reason: reason
      ? `${failedCommitment ? `${decisionText(failedCommitment.label, 'Commitment')}: ` : ''}${reason}${timings.some(Boolean) ? ` (${timings.filter(Boolean).join('; ')})` : ''}.`
      : unknownReason
        ? `${unknownReason}${timings.some(Boolean) ? ` (${timings.filter(Boolean).join('; ')})` : ''}.`
      : movement ?? conciseSource ?? fallback,
  };
}

export interface ResearchGroup {
  key: string; label: string; total: number; succeeded: number; partial: number;
  failed: number; unavailable: number; unconfirmed: number; sources: string[];
}
const TOOL_GROUP: Record<string, readonly [string, string]> = {
  'flight.search': ['flights', 'Replacement flights'],
  'hotel.context': ['stays', 'Accommodation and cancellation terms'],
  'hotel.search': ['stays', 'Accommodation and cancellation terms'],
  'hotel.quote': ['stays', 'Accommodation and cancellation terms'],
  'research.entry_requirements': ['entry', 'Entry requirements'],
  'research.local_context': ['local', 'Local stay requirements'],
};
const MODES: Record<string, string> = { LIVE: 'Live', RECORD: 'Recorded', REPLAY: 'Saved replay', INTERNAL: 'Trip records' };

/** Group attempts without turning partial/failed calls into successful stages. */
export function groupedResearch(view: RecoveryCaseView): ResearchGroup[] {
  const groups = new Map<string, ResearchGroup>();
  const add = (key: string, label: string, status: string | undefined, source: string): void => {
    const group = groups.get(key) ?? { key, label, total: 0, succeeded: 0, partial: 0, failed: 0, unavailable: 0, unconfirmed: 0, sources: [] };
    group.total += 1;
    if (status === 'SUCCEEDED') group.succeeded += 1;
    else if (status === 'PARTIAL') group.partial += 1;
    else if (status === 'FAILED') group.failed += 1;
    else if (status === 'UNAVAILABLE') group.unavailable += 1;
    else group.unconfirmed += 1;
    if (!group.sources.includes(source)) group.sources.push(source);
    groups.set(key, group);
  };
  for (const tool of view.planningEvidence?.tools ?? []) {
    const [key, label] = TOOL_GROUP[tool.tool.code ?? ''] ?? ['other', 'Other supporting research'];
    add(key, label, tool.status.code, tool.status.code === 'UNAVAILABLE' ? 'No provider evidence obtained for the unavailable check' : `${decisionText(tool.provider, 'Provider not recorded')} · ${MODES[tool.provenanceMode.code ?? ''] ?? 'Source mode not recorded'}`);
  }
  for (const model of view.planningEvidence?.modelActivities ?? []) {
    add('model', 'AI review of recovery needs', model.status,
      `${decisionText(model.providerId, 'Provider not recorded')} · ${decisionText(model.model, 'Model not recorded')} · ${MODES[model.mode]}`);
  }
  return [...groups.values()];
}

export function authorityLabel(value: string): string {
  return ({
    PENDING: 'Awaiting approval', AWAITING_AUTHORITY: 'Awaiting authority',
    NOT_REQUESTED: 'Approval not requested', NOT_REQUIRED: 'No additional approval required in the recorded state',
    AUTHORIZED: 'Authority granted', GRANTED: 'Authority granted', APPROVED: 'Approval recorded',
    REJECTED: 'Approval declined', DENIED: 'Authority denied', UNKNOWN: 'Authority not confirmed',
  } as Record<string, string>)[value] ?? (value.toLowerCase() === 'none'
    ? 'No authority decision recorded' : plain(value) ?? 'Authority details not confirmed');
}
