/**
 * R4 (lane E2) — pure presenter: PostgreSQL v2 `RecoveryCaseView` -> the plain
 * language Case workspace model the legacy Case information architecture needs
 * (header, lead callout, affected list, staged activity, ONE recommended option,
 * approval panel, execution progress, resolution checklist).
 *
 * Contract:
 *  - Pure and deterministic: no I/O, no clock, no scenario/persona/route keys.
 *  - Every sentence is composed from facts the read model actually carries.
 *    Closed codes are mapped through `copy.ts` vocab; anything unmapped falls
 *    back to generic wording — never to a raw code, enum, ref or UUID.
 *  - Free text supplied by the backend is shown only when it passes `plain()`
 *    (no UUID/ISO timestamp/typed ref/enum literal/forbidden vocabulary);
 *    otherwise the raw evidence is left to the Technical details disclosure.
 *  - No chain-of-thought or provider internals are produced here.
 */
import type {
  RecoveryActionView,
  RecoveryCaseView,
  RecoveryStrategyView,
} from '../../../contracts/v2/product/readModels.ts';
import {
  CASE_ACTION_DOMAIN_FALLBACK,
  CASE_ACTION_FALLBACK,
  CASE_ACTION_PHRASE,
  CASE_CHANGE_FALLBACK,
  CASE_CHANGE_TYPE_SENTENCE,
  CASE_COPY,
  CASE_DIMENSION_ACTIVITY,
  CASE_DOMAIN_ACTIVITY,
  CASE_EFFECT_PHRASE,
  CASE_NODE_KIND_NOUN,
  CASE_NODE_STATE_NOTE,
  CASE_REASON_FALLBACK,
  CASE_REASON_SENTENCE,
  CASE_STATUS_BADGE,
  CASE_SUBJECT_KIND_NOUN,
  CASE_TOOL_ACTIVITY,
  CASE_TOOL_FALLBACK,
  FORBIDDEN_UI_TERMS,
  UUID_PATTERN,
} from '../../../ui/copy.ts';
import { formatMoney, formatShort } from '../../../ui/html.ts';

export type CasePhase =
  | 'disrupted'
  | 'investigating'
  | 'awaiting_approval'
  | 'executing'
  | 'recovered'
  | 'closed'
  | 'no_plan';

export type Tone = 'ok' | 'watch' | 'alert' | 'active' | 'done' | 'neutral';
export type RowState = 'done' | 'doing' | 'queued' | 'failed' | 'note';

export interface CaseChangeLine {
  readonly kind: 'IN_EFFECT' | 'MOVE' | 'SET' | 'OTHER';
  readonly subject: string;
  readonly subjectRef: string;
  readonly from?: string;
  readonly to?: string;
  readonly toWindow?: string;
  readonly phrase?: string;
}

export interface CaseOptionModel {
  readonly strategyRef: string;
  readonly optionNumber: number;
  readonly title: string;
  readonly changes: readonly CaseChangeLine[];
  readonly people: readonly string[];
  readonly why: readonly string[];
  readonly costLine?: string;
  readonly approverLine: string;
  readonly approvable: boolean;
}

export interface CaseRejectedModel {
  readonly label: string;
  readonly reason: string;
  readonly movements: readonly string[];
  readonly unchangedNote?: string;
}

export interface CaseRow {
  readonly label: string;
  readonly state: RowState;
  readonly note?: string;
}

export interface CaseAffectItem {
  readonly label: string;
  readonly note: string;
  readonly tone: 'alert' | 'watch' | 'neutral';
}

export interface CaseWorkspaceModel {
  readonly caseRef: string;
  readonly phase: CasePhase;
  readonly heading: string;
  readonly firstName?: string;
  readonly statusLabel: string;
  readonly statusTone: Tone;
  readonly generatedAt: string;
  readonly lead: { readonly tone: Tone; readonly title: string; readonly body: string; readonly stake?: string };
  readonly attention?: { readonly title: string; readonly body: string };
  readonly whereItBreaks?: { readonly label: string; readonly phrase: string };
  readonly affects: { readonly items: readonly CaseAffectItem[]; readonly healthyNote?: string };
  readonly activity: { readonly title: string; readonly rows: readonly CaseRow[] };
  readonly recommended?: CaseOptionModel;
  readonly alternatives: readonly CaseOptionModel[];
  readonly considered: readonly CaseRejectedModel[];
  readonly showFindRecovery: boolean;
  readonly noPlan: boolean;
  readonly approval?: {
    readonly changeLines: readonly CaseChangeLine[];
    readonly people: readonly string[];
    readonly authorityLine: string;
    readonly costLine?: string;
    readonly ctaLabel: string;
    readonly strategyRef: string;
  };
  readonly execution?: {
    readonly title: string;
    readonly rows: readonly CaseRow[];
    readonly done: number;
    readonly total: number;
    readonly warnings: readonly string[];
  };
  readonly checked: readonly { readonly ok: boolean | null; readonly label: string }[];
  readonly checkedFootnote?: string;
  readonly resolution?: { readonly title: string; readonly body: string };
  readonly technical: {
    readonly caseStatus: string;
    readonly authorityState: string;
    readonly executionState: string;
    readonly reconciliationState: string;
    readonly strategies: readonly string[];
    readonly planning: readonly string[];
    readonly unmappedSteps: readonly string[];
  };
}

// --------------------------------------------------------------------------
// Text hygiene
// --------------------------------------------------------------------------

const RAW_PATTERNS: readonly RegExp[] = [
  UUID_PATTERN,
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, // ISO instant
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/, // UPPER_SNAKE enum literal
  /\b[A-Z][A-Z_]{2,}:[\w-]{3,}/, // typed ref KIND:id
  /\b[a-z]+(?:\.[a-z]+)+\b(?!\s)/, // dotted capability code (flight.search)
  /\b[a-z]+_[a-z_]+\b/, // snake_case reason code
  /postgres|assembled from/i, // placeholder summaries from the projection layer
];

/** Backend text is shown only when it reads as ordinary language. */
export function plain(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const value = text.trim();
  if (value.length === 0) return undefined;
  if (RAW_PATTERNS.some((pattern) => pattern.test(value))) return undefined;
  const lower = value.toLowerCase();
  if (FORBIDDEN_UI_TERMS.some((term) => lower.includes(term))) return undefined;
  return value;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function kindOf(ref: string): string {
  const idx = ref.indexOf(':');
  return idx < 0 ? ref : ref.slice(0, idx);
}

function subjectNoun(ref: string): string {
  return CASE_SUBJECT_KIND_NOUN[kindOf(ref)] ?? 'part of the trip';
}

// --------------------------------------------------------------------------
// Identity
// --------------------------------------------------------------------------

function travellerNames(view: RecoveryCaseView): string[] {
  const names: string[] = [];
  for (const [ref, label] of Object.entries(view.subjectLabels)) {
    if (ref.startsWith('JOURNEY:')) {
      const name = plain(label);
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

/** The case's own person: the first blocking subject a strategy resolves, else the first known traveller. */
function primaryTraveller(view: RecoveryCaseView): string | undefined {
  for (const strategy of view.strategies) {
    const first = strategy.resolves.map((r) => plain(r.personLabel)).find((n): n is string => n !== undefined);
    if (first) return first;
  }
  const failing = view.ldg.nodes.find((n) => n.kind === 'TRAVELLER' && (n.semanticState === 'FAILED' || n.semanticState === 'AFFECTED'));
  const fromNode = failing ? plain(failing.label) : undefined;
  return fromNode ?? travellerNames(view)[0];
}

function firstNameOf(name: string | undefined): string | undefined {
  return name?.split(/\s+/)[0];
}

// --------------------------------------------------------------------------
// Phase and status
// --------------------------------------------------------------------------

function viableStrategies(view: RecoveryCaseView): RecoveryStrategyView[] {
  return view.strategies.filter((s) => s.viability === 'VIABLE' && (s.status === 'EVALUATED' || s.status === 'PROPOSED'));
}

function derivePhase(view: RecoveryCaseView): CasePhase {
  switch (view.status) {
    case 'RESOLVED': return 'recovered';
    case 'CLOSED':
    case 'CANCELLED':
    case 'SUPERSEDED': return 'closed';
    case 'EXECUTING': return 'executing';
    case 'PLANNING': return 'investigating';
    case 'AWAITING_AUTHORITY': return viableStrategies(view).length > 0 ? 'awaiting_approval' : 'no_plan';
    case 'OPEN': {
      if (viableStrategies(view).length > 0) return 'awaiting_approval';
      const outcome = view.planningEvidence?.outcome.code;
      return view.planningEvidence && outcome !== 'STALE_RETRY_REQUIRED' ? 'no_plan' : 'disrupted';
    }
  }
}

// --------------------------------------------------------------------------
// What happened
// --------------------------------------------------------------------------

function reasonPhrase(view: RecoveryCaseView): string {
  const step = view.causalPath[0];
  return (step && CASE_REASON_SENTENCE[step.reasonCode]) ?? CASE_REASON_FALLBACK;
}

function whatHappened(view: RecoveryCaseView, who: string | undefined): string {
  const summary = plain(view.changeSummary);
  const change = view.cause ? (CASE_CHANGE_TYPE_SENTENCE[view.cause.changeType] ?? CASE_CHANGE_FALLBACK) : undefined;
  const lead = summary ? sentence(summary) : change;
  const consequence = view.causalPath.length > 0
    ? `As a result${who ? ` for ${who}` : ''}, ${reasonPhrase(view)}.`
    : undefined;
  const parts = [lead, consequence].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(' ') : 'This trip needs attention.';
}

// --------------------------------------------------------------------------
// Options
// --------------------------------------------------------------------------

function changeLine(change: RecoveryStrategyView['changes'][number]): CaseChangeLine {
  const label = plain(change.subjectLabel) ?? subjectNoun(change.subjectRef);
  const base = { subject: label, subjectRef: change.subjectRef };
  if (change.proposedWindow && change.currentWindow) {
    const alreadyInEffect = change.currentWindow.start === change.proposedWindow.start
      && change.currentWindow.end === change.proposedWindow.end;
    if (alreadyInEffect) {
      return { ...base, kind: 'IN_EFFECT', to: change.proposedWindow.start, toWindow: `${formatShort(change.proposedWindow.start)}–${formatShort(change.proposedWindow.end)}` };
    }
    return {
      ...base,
      kind: 'MOVE',
      from: formatShort(change.currentWindow.start),
      to: formatShort(change.proposedWindow.start),
      toWindow: `${formatShort(change.proposedWindow.start)}–${formatShort(change.proposedWindow.end)}`,
    };
  }
  if (change.proposedWindow) {
    return { ...base, kind: 'SET', toWindow: `${formatShort(change.proposedWindow.start)}–${formatShort(change.proposedWindow.end)}` };
  }
  const phrase = CASE_EFFECT_PHRASE[change.effectKind];
  const known = plain(change.subjectLabel) !== undefined;
  return {
    ...base,
    kind: 'OTHER',
    phrase: phrase ? (known ? phrase.title.replace('{subject}', label) : phrase.generic) : `Change ${label}`,
  };
}

function optionTitle(strategy: RecoveryStrategyView, lines: readonly CaseChangeLine[]): string {
  const first = lines[0];
  if (!first) return `Recovery option ${strategy.optionNumber}`;
  const extra = lines.length - 1;
  const tail = extra > 0 ? ` and adjust ${extra} other ${extra === 1 ? 'item' : 'items'}` : '';
  if (first.kind === 'MOVE' || first.kind === 'IN_EFFECT') {
    const at = first.kind === 'MOVE' ? first.to : first.toWindow?.split('–')[0];
    return `Move ${first.subject}${at ? ` to ${at}` : ''}${tail}`;
  }
  if (first.kind === 'SET') return `Reschedule ${first.subject}${tail}`;
  return `${first.phrase ?? `Change ${first.subject}`}${tail}`;
}

function verdictWord(code: string | undefined): string {
  switch (code) {
    case 'PASS': return 'works';
    case 'FAIL': return 'does not work';
    default: return 'is not confirmed';
  }
}

function optionWhy(strategy: RecoveryStrategyView): string[] {
  const lines: string[] = [];
  for (const resolve of strategy.resolves) {
    const name = plain(resolve.personLabel);
    if (!name) continue;
    lines.push(resolve.projectedVerdict === 'PASS'
      ? `${name}’s trip goes from not working to working.`
      : `${name}’s trip ${verdictWord(resolve.projectedVerdict)} with this option.`);
  }
  const summary = strategy.projectedSummary;
  if (summary.total > 0) {
    const parts: string[] = [`${summary.pass} confirmed`];
    if (summary.fail > 0) parts.push(`${summary.fail} still need attention`);
    if (summary.unknown > 0) parts.push(`${summary.unknown} not yet confirmed`);
    lines.push(`We re-checked ${summary.total} parts of the trip against this option: ${parts.join(', ')}.`);
    if (summary.fail === 0) lines.push('Nothing else in the trip breaks.');
  }
  return lines;
}

function aggregateCost(view: RecoveryCaseView): string | undefined {
  return view.aggregateRecoveryCost
    ? formatMoney({ amount: Number(view.aggregateRecoveryCost.amount), currency: view.aggregateRecoveryCost.currency })
    : undefined;
}

function buildOption(view: RecoveryCaseView, strategy: RecoveryStrategyView, terminal: boolean): CaseOptionModel {
  const changes = strategy.changes.map(changeLine);
  const cost = aggregateCost(view);
  const people = [...new Set(strategy.resolves.map((r) => plain(r.personLabel)).filter((n): n is string => n !== undefined))];
  const approvable = !terminal && strategy.viability === 'VIABLE' && (strategy.status === 'EVALUATED' || strategy.status === 'PROPOSED');
  return {
    strategyRef: strategy.strategyRef,
    optionNumber: strategy.optionNumber,
    title: optionTitle(strategy, changes),
    changes,
    people,
    why: optionWhy(strategy),
    ...(cost ? { costLine: `Added cost: ${cost}` } : {}),
    approverLine: approvable ? 'Needs your approval as organiser before anything changes.' : 'Not open for approval.',
    approvable,
  };
}

const REJECTION_SENTENCE: Record<string, string> = {
  REJECTED_VALIDATION: 'This option could not be applied safely.',
  REJECTED_DETERMINISTIC: 'Checking showed this option would not fix the trip.',
  VIABLE_NOT_RECOMMENDED: 'This option works but is not the best fit.',
};

const CANDIDATE_LABEL: Record<string, string> = {
  TRANSPORT: 'A replacement travel option',
  STAY: 'An accommodation change',
  TRANSFER: 'A ground transfer change',
  PROGRAMME: 'A programme change',
  SUPPORT_COORDINATION: 'A support cover change',
  INFORMATION_RESEARCH: 'A research finding',
};

function deltaWord(code: string | undefined): string {
  switch (code) {
    case 'PASS': return 'works';
    case 'FAIL': return 'does not work';
    default: return 'not confirmed';
  }
}

function buildConsidered(view: RecoveryCaseView, shownStrategyRefs: ReadonlySet<string>): CaseRejectedModel[] {
  const out: CaseRejectedModel[] = [];
  for (const candidate of view.planningEvidence?.candidates ?? []) {
    if (candidate.strategyRef && shownStrategyRefs.has(candidate.strategyRef)) continue;
    if (candidate.disposition.code === 'RECOMMENDED') continue;
    const changed = candidate.outcomeDelta.filter((d) => d.direction.code !== 'UNCHANGED');
    const unchanged = candidate.outcomeDelta.length - changed.length;
    const reason = candidate.reasons.map(plain).find((r): r is string => r !== undefined)
      ?? REJECTION_SENTENCE[candidate.disposition.code ?? ''] ?? 'This option was not chosen.';
    out.push({
      label: CANDIDATE_LABEL[candidate.domain.code ?? ''] ?? 'Another option',
      reason: sentence(reason),
      movements: changed.slice(0, 5).map((d) =>
        `${plain(d.subject.label) ?? 'Part of the trip'}: ${deltaWord(d.baseline)} → ${deltaWord(d.candidate)}`),
      ...(unchanged > 0 ? { unchangedNote: `${unchanged} other ${unchanged === 1 ? 'check was' : 'checks were'} unchanged.` } : {}),
    });
  }
  return out;
}

function pickRecommended(view: RecoveryCaseView, viable: RecoveryStrategyView[]): RecoveryStrategyView | undefined {
  const ref = view.planningEvidence?.recommendation?.recommended.ref;
  if (ref) {
    const hit = viable.find((s) => ref === s.strategyRef || ref.endsWith(s.strategyRef));
    if (hit) return hit;
  }
  return [...viable].sort((a, b) => a.optionNumber - b.optionNumber)[0];
}

// --------------------------------------------------------------------------
// Affects
// --------------------------------------------------------------------------

function buildAffects(view: RecoveryCaseView): CaseWorkspaceModel['affects'] {
  const items: CaseAffectItem[] = [];
  let healthy = 0;
  for (const node of view.ldg.nodes) {
    if (node.kind === 'DISRUPTION' || node.kind === 'RECOVERY_PROPOSAL') continue;
    if (node.semanticState === 'HEALTHY' || node.semanticState === 'RECOVERED') {
      healthy += 1;
      continue;
    }
    if (node.semanticState === 'PROPOSED' || node.semanticState === 'ACTIVE') continue;
    const label = plain(node.label) ?? CASE_NODE_KIND_NOUN[node.kind] ?? 'Part of the trip';
    const tone = node.semanticState === 'FAILED' ? 'alert' : node.semanticState === 'UNKNOWN' ? 'neutral' : 'watch';
    items.push({ label, note: CASE_NODE_STATE_NOTE[node.semanticState] ?? 'Affected', tone });
  }
  return { items, ...(healthy > 0 ? { healthyNote: CASE_COPY.healthyContext(healthy) } : {}) };
}

// --------------------------------------------------------------------------
// Activity (planning)
// --------------------------------------------------------------------------

function buildActivity(view: RecoveryCaseView, phase: CasePhase): CaseWorkspaceModel['activity'] {
  const evidence = view.planningEvidence;
  const rows: CaseRow[] = [{ label: 'Trip change received', state: 'done' }];
  const planning = phase === 'investigating';

  for (const domain of evidence?.domains ?? []) {
    const vocab = CASE_DOMAIN_ACTIVITY[domain.domain.code ?? ''];
    if (!vocab) continue;
    const code = domain.disposition.code;
    if (code === 'NOT_APPLICABLE') continue;
    rows.push(code === 'UNAVAILABLE'
      ? { label: vocab.unavailable, state: 'failed' }
      : { label: vocab.checking, state: 'done' });
  }

  for (const tool of evidence?.tools ?? []) {
    const vocab = CASE_TOOL_ACTIVITY[tool.tool.code ?? ''] ?? CASE_TOOL_FALLBACK;
    const ok = tool.status.code === 'SUCCEEDED' || tool.status.code === 'PARTIAL';
    if (ok) {
      rows.push({ label: vocab.checking, state: 'done' });
    } else {
      rows.push({ label: vocab.unavailable, state: 'failed', ...(vocab.note ? { note: vocab.note } : {}) });
    }
  }

  const seen = new Set<string>();
  for (const step of view.causalPath) {
    const label = CASE_DIMENSION_ACTIVITY[step.dimension];
    if (label && !seen.has(label)) {
      seen.add(label);
      rows.push({ label, state: 'done' });
    }
  }

  const candidates = evidence?.candidates ?? [];
  if (candidates.length > 0) {
    const works = candidates.filter((c) => c.disposition.code === 'RECOMMENDED' || c.disposition.code === 'VIABLE_NOT_RECOMMENDED').length;
    rows.push({
      label: 'Comparing safe recovery options',
      state: 'done',
      note: `${candidates.length} considered, ${works} ${works === 1 ? 'works' : 'work'}`,
    });
    if (evidence?.recommendation?.provenance.code === 'AI_ASSISTED') {
      rows.push({ label: 'AI-assisted comparison of the options, confirmed by fixed rules', state: 'done' });
    }
  } else if (planning) {
    rows.push({ label: 'Re-checking the whole trip', state: 'doing' });
    rows.push({ label: 'Comparing safe recovery options', state: 'queued' });
  }

  const finished = phase !== 'investigating' && phase !== 'disrupted';
  return { title: finished ? CASE_COPY.activityDone : CASE_COPY.activityDoing, rows };
}

// --------------------------------------------------------------------------
// Execution
// --------------------------------------------------------------------------

function actionPhrase(action: RecoveryActionView): { doing: string; done: string } {
  return CASE_ACTION_PHRASE[action.capability]
    ?? CASE_ACTION_DOMAIN_FALLBACK[action.domain.toUpperCase()]
    ?? CASE_ACTION_FALLBACK;
}

function actionRow(action: RecoveryActionView): CaseRow {
  const phrase = actionPhrase(action);
  switch (action.executionState) {
    case 'COMPLETED': return { label: phrase.done, state: 'done' };
    case 'EXECUTING': return { label: phrase.doing, state: 'doing' };
    case 'RECONCILING': return { label: `Confirming: ${phrase.doing.charAt(0).toLowerCase()}${phrase.doing.slice(1)}`, state: 'doing' };
    case 'FAILED': return { label: phrase.doing, state: 'failed', note: 'This step did not go through.' };
    case 'REJECTED': return { label: phrase.doing, state: 'failed', note: 'This step was declined.' };
    case 'OUTCOME_UNKNOWN': return { label: phrase.doing, state: 'failed', note: 'The result is not confirmed yet.' };
    case 'SUPERSEDED': return { label: phrase.doing, state: 'note', note: 'Replaced by a newer step.' };
    default: return { label: phrase.doing, state: 'queued' };
  }
}

function buildExecution(view: RecoveryCaseView, phase: CasePhase): CaseWorkspaceModel['execution'] | undefined {
  if (phase !== 'executing' && phase !== 'recovered') return undefined;
  const live = [...view.recoveryActions]
    .filter((a) => a.executionState !== 'SUPERSEDED')
    .sort((a, b) => a.dependencyOrder - b.dependencyOrder);
  const rows: CaseRow[] = live.map(actionRow);
  const done = live.filter((a) => a.executionState === 'COMPLETED').length;
  const allApplied = live.length > 0 && done === live.length;
  if (rows.length === 0) rows.push({ label: 'Preparing to apply the approved change', state: phase === 'recovered' ? 'done' : 'doing' });
  // Truthful: the trip is only "re-checked" once the case reports RESOLVED.
  rows.push(phase === 'recovered'
    ? { label: 'Re-checked the rest of the trip', state: 'done' }
    : { label: 'Re-checking the rest of the trip', state: allApplied ? 'doing' : 'queued' });

  const warnings: string[] = [];
  if (view.duplicateBookingExposure.length > 0) {
    warnings.push('A possible duplicate booking needs a person to check it.');
  }
  if (view.partialRecovery && view.partialRecovery.failed.length > 0) {
    warnings.push('Some steps did not go through, so the recovery is only partly applied.');
  }
  return {
    title: phase === 'recovered' ? 'What NORTHSTAR did' : 'Recovery progress',
    rows,
    done: phase === 'recovered' ? rows.length : done,
    total: rows.length,
    warnings,
  };
}

// --------------------------------------------------------------------------
// Checks
// --------------------------------------------------------------------------

function buildChecked(view: RecoveryCaseView, phase: CasePhase, recommended?: CaseOptionModel): CaseWorkspaceModel['checked'] {
  const out: { ok: boolean | null; label: string }[] = [];
  if (phase === 'recovered') {
    for (const node of view.ldg.nodes) {
      if (node.kind !== 'TRAVELLER') continue;
      const name = plain(node.label);
      if (!name) continue;
      out.push({
        ok: node.semanticState === 'HEALTHY' || node.semanticState === 'RECOVERED' ? true : node.semanticState === 'FAILED' ? false : null,
        label: node.semanticState === 'FAILED' ? `${name}’s trip still needs attention` : `${name}’s trip works again`,
      });
    }
    const applied = view.recoveryActions.filter((a) => a.executionState === 'COMPLETED').length;
    if (applied > 0) out.push({ ok: true, label: `${applied} ${applied === 1 ? 'change was' : 'changes were'} applied and confirmed` });
    if (view.tripViability.verdict === 'PASS') out.push({ ok: true, label: 'The whole trip was re-checked after the change' });
    for (const note of view.uncertainty) {
      const text = plain(note);
      if (text) out.push({ ok: null, label: text });
    }
    return out;
  }
  const strategy = recommended ? view.strategies.find((s) => s.strategyRef === recommended.strategyRef) : undefined;
  if (strategy) {
    for (const resolve of strategy.resolves) {
      const name = plain(resolve.personLabel);
      if (!name) continue;
      out.push({
        ok: resolve.projectedVerdict === 'PASS' ? true : resolve.projectedVerdict === 'FAIL' ? false : null,
        label: resolve.projectedVerdict === 'PASS'
          ? `${name}’s trip works with the recommended option`
          : `${name}’s trip ${verdictWord(resolve.projectedVerdict)} with the recommended option`,
      });
    }
    const s = strategy.projectedSummary;
    if (s.total > 0) {
      out.push({ ok: s.fail === 0 ? true : false, label: `${s.pass} of ${s.total} checked parts of the trip stay confirmed` });
      if (s.unknown > 0) out.push({ ok: null, label: `${s.unknown} could not be confirmed yet` });
    }
  }
  return out;
}

// --------------------------------------------------------------------------
// Technical details (exempt from the language gate, still bounded)
// --------------------------------------------------------------------------

const TECH_ROW_CAP = 40;

function buildTechnical(view: RecoveryCaseView): CaseWorkspaceModel['technical'] {
  const evidence = view.planningEvidence;
  const planning: string[] = [];
  if (evidence) {
    planning.push(`Planning outcome: ${evidence.outcome.label} (attempt ${evidence.attemptRef}, as of ${evidence.asOf})`);
    for (const d of evidence.domains) planning.push(`Domain ${d.domain.label}: ${d.disposition.label}${d.reason ? ` — ${d.reason}` : ''}`);
    for (const t of evidence.tools) planning.push(`Research ${t.tool.label}: ${t.status.label} · ${t.provenanceMode.label}${t.provider ? ` · ${t.provider}` : ''} — ${t.summary}`);
    for (const c of evidence.candidates) {
      planning.push(`Candidate ${c.domain.label} · ${c.proposer.label}: ${c.disposition.label}${c.reasons.length > 0 ? ` — ${c.reasons.join('; ')}` : ''}`);
      const changed = c.outcomeDelta.filter((d) => d.direction.code !== 'UNCHANGED');
      for (const d of changed.slice(0, 8)) planning.push(`  ${d.subject.label}: ${d.baseline ?? 'unknown'} → ${d.candidate}`);
      const unchanged = c.outcomeDelta.length - changed.length;
      if (unchanged > 0) planning.push(`  (${unchanged} unchanged subject${unchanged === 1 ? '' : 's'} not listed)`);
    }
    if (evidence.recommendation) {
      planning.push(`Recommendation provenance: ${evidence.recommendation.provenance.label}`);
      for (const b of evidence.recommendation.basis) planning.push(`Basis (${b.kind.label}): ${b.summary}`);
    }
  }
  return {
    caseStatus: view.status,
    authorityState: view.authorityState,
    executionState: view.executionState,
    reconciliationState: view.reconciliationState,
    strategies: view.strategies.map((s) => `Option ${s.optionNumber}: ${s.strategyRef} v${s.version} · ${s.viability} · ${s.status}`).slice(0, TECH_ROW_CAP),
    planning: planning.slice(0, TECH_ROW_CAP * 2),
    unmappedSteps: (view.focusedGraph?.unmappedCausalSteps ?? []).map((s) => `${s.dimension} / ${s.reasonCode} on ${s.subjectRef} — ${s.reason}`),
  };
}

// --------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------

export function presentCaseWorkspace(view: RecoveryCaseView): CaseWorkspaceModel {
  const phase = derivePhase(view);
  const terminal = phase === 'recovered' || phase === 'closed';
  const name = primaryTraveller(view);
  const first = firstNameOf(name);
  const badge = CASE_STATUS_BADGE[view.status] ?? { label: 'In progress', tone: 'neutral' as Tone };
  // Evidence-derived badge refinements (legacy: never assert what is not evidenced).
  const openAttention = view.attention.find((a) => a.status.code === 'OPEN');
  const statusLabel = phase === 'no_plan' ? 'Needs a person' : phase === 'disrupted' ? 'Disrupted' : badge.label;
  const statusTone: Tone = phase === 'no_plan' ? 'alert' : phase === 'disrupted' ? 'alert' : badge.tone;

  const viable = terminal ? [] : viableStrategies(view);
  const rec = phase === 'awaiting_approval' ? pickRecommended(view, viable) : undefined;
  const recommended = rec ? buildOption(view, rec, false) : undefined;
  const alternatives = rec
    ? viable.filter((s) => s.strategyRef !== rec.strategyRef).map((s) => buildOption(view, s, false))
    : [];
  const shown = new Set(viable.map((s) => s.strategyRef));
  const considered = phase === 'awaiting_approval' || phase === 'no_plan' || phase === 'executing' || phase === 'recovered'
    ? buildConsidered(view, shown)
    : [];

  const happened = whatHappened(view, name);
  const stake = plain(view.criticalCommitment);
  let lead: CaseWorkspaceModel['lead'];
  switch (phase) {
    case 'recovered':
      lead = {
        tone: 'ok',
        title: CASE_COPY.recoveredTitle,
        body: plain(view.resolutionSummary) ?? 'The trip works again and every change was checked.',
      };
      break;
    case 'closed':
      lead = { tone: 'neutral', title: CASE_COPY.closedTitle, body: plain(view.resolutionSummary) ?? happened };
      break;
    case 'executing':
      lead = { tone: 'active', title: CASE_COPY.executingTitle, body: CASE_COPY.executingBody };
      break;
    case 'investigating':
      lead = { tone: 'active', title: CASE_COPY.investigatingTitle, body: `${happened} ${CASE_COPY.investigatingBody}` };
      break;
    case 'awaiting_approval':
      lead = {
        tone: 'watch',
        title: CASE_COPY.waitingTitle,
        body: `${happened}${recommended ? ` NORTHSTAR recommends: ${recommended.title}.` : ''} ${CASE_COPY.nothingChangesUntil}`,
      };
      break;
    case 'no_plan':
      lead = { tone: 'alert', title: CASE_COPY.noPlanTitle, body: `${happened} ${CASE_COPY.noPlanBody}` };
      break;
    case 'disrupted':
      lead = { tone: 'alert', title: CASE_COPY.happenedTitle, body: happened };
      break;
  }
  if (stake && phase !== 'recovered') lead = { ...lead, stake: `At stake: ${stake}` };

  const attentionBody = openAttention ? plain(openAttention.detail) ?? plain(openAttention.reason.label) : undefined;
  const attention = openAttention
    ? { title: 'A person needs to look at this', body: attentionBody ?? 'NORTHSTAR has asked for a person to review this case.' }
    : undefined;

  const breakStep = view.focusedGraph?.firstBreakpoint;
  const whereItBreaks = breakStep
    ? { label: plain(breakStep.label) ?? 'This part of the trip', phrase: CASE_REASON_SENTENCE[breakStep.reasonCode] ?? CASE_REASON_FALLBACK }
    : undefined;

  const execution = buildExecution(view, phase);
  const checked = buildChecked(view, phase, recommended);

  const approval = recommended && recommended.approvable
    ? {
        changeLines: recommended.changes,
        people: recommended.people,
        authorityLine: 'Approval needed: you, as organiser. NORTHSTAR checks who may approve each change and records every action.',
        ...(recommended.costLine ? { costLine: recommended.costLine } : {}),
        ctaLabel: recommended.people.length === 1 && first
          ? `Recover ${first}’s trip`
          : recommended.people.length > 1 ? `Recover ${recommended.people.length} trips` : 'Recover the trip',
        strategyRef: recommended.strategyRef,
      }
    : undefined;

  return {
    caseRef: view.caseRef,
    phase,
    heading: name ?? 'Trip recovery',
    ...(first ? { firstName: first } : {}),
    statusLabel,
    statusTone,
    generatedAt: view.generatedAt,
    lead,
    ...(attention ? { attention } : {}),
    ...(whereItBreaks ? { whereItBreaks } : {}),
    affects: buildAffects(view),
    activity: buildActivity(view, phase),
    ...(recommended ? { recommended } : {}),
    alternatives,
    considered,
    showFindRecovery: phase === 'disrupted',
    noPlan: phase === 'no_plan',
    ...(approval ? { approval } : {}),
    ...(execution ? { execution } : {}),
    checked,
    ...(checked.length > 0 ? { checkedFootnote: CASE_COPY.checkedFootnote } : {}),
    ...(phase === 'recovered'
      ? { resolution: { title: 'This case is resolved', body: 'The trip is up to date. Reopening this case does not restart recovery.' } }
      : {}),
    technical: buildTechnical(view),
  };
}
