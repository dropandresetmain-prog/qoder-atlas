/**
 * NORTHSTAR M6 — registered entry/transit predicate library and the Kleene
 * three-valued rule-expression evaluator (M6_EVALUATOR_CONTRACT.md §2 L4).
 *
 * A predicate id is executable only because it is registered here; an
 * unregistered id evaluates UNKNOWN `predicate_unsupported`
 * (UNSUPPORTED_EVALUATION), never PASS. Every threshold, code, class and
 * purpose comes from the rule edition's parameters — this module holds no
 * legal fact. Missing inputs (no selected passport, no expiry, incomplete
 * travel history, unknown airside facts) are UNKNOWN with a typed uncertainty.
 *
 * Pure: no I/O, no clock read; `now` is injected through the context.
 */
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import type { EvidenceRef, Uncertainty } from '../../contracts/v2/assessment/explanation.ts';
import { rulePredicateRegistry, type RuleExpression, type RulePredicateRegistry } from '../../domain/v2/knowledge/information.ts';
import type { CapturedWorld, WCredential, WCredentialVersion } from '../world/world.ts';
import {
  addDays,
  dateOnOrAfterLocalDate,
  dateOnOrBeforeLocalDate,
  DAY_MS,
  ENTRY_AUTHORISATION_KINDS,
  IDENTITY_DOCUMENT_KIND,
  inclusiveOverlapDays,
  kleeneAll,
  kleeneAny,
  kleeneNot,
  linkToPassports,
  possibleLocalDates,
  resolveSelection,
  usableSelection,
  visitsOfJourney,
  type Encounter,
  type Tri,
} from './encounters.ts';

export type FactValue = string | number | boolean | null;

export interface PredicateContext {
  world: CapturedWorld;
  now: Instant;
  journeyId: string;
  travellerId: string;
  encounter: Encounter;
}

export interface PredicateOutcome {
  status: Tri;
  /** Registered snake_case reason code of this leaf. */
  reasonCode: string;
  facts: Record<string, FactValue>;
  uncertainty: Uncertainty[];
  evidence: EvidenceRef[];
  related: TypedRef[];
}

export type EntryPredicate = (parameters: Record<string, unknown>, context: PredicateContext) => PredicateOutcome;

/** ---- outcome helpers ------------------------------------------------------ */

const traveller = (ctx: PredicateContext): TypedRef => ({ kind: 'TRAVELLER', id: ctx.travellerId });

function outcome(status: Tri, reasonCode: string, extra: Partial<Omit<PredicateOutcome, 'status' | 'reasonCode'>> = {}): PredicateOutcome {
  return { status, reasonCode, facts: extra.facts ?? {}, uncertainty: extra.uncertainty ?? [], evidence: extra.evidence ?? [], related: extra.related ?? [] };
}

function unknown(reasonCode: string, kind: Uncertainty['kind'], code: string, ctx: PredicateContext, extra: Partial<Omit<PredicateOutcome, 'status' | 'reasonCode'>> = {}): PredicateOutcome {
  return outcome('UNKNOWN', reasonCode, { ...extra, uncertainty: [...(extra.uncertainty ?? []), { kind, code, subjectRef: traveller(ctx) }] });
}

const invalidParameters = (ctx: PredicateContext, name: string) =>
  unknown('predicate_parameters_invalid', 'UNSUPPORTED_EVALUATION', 'rule_parameters', ctx, { facts: { invalidParameter: name } });

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' && v.length > 0) ? [...value] as string[] : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

const credentialEvidence = (version: WCredentialVersion): EvidenceRef[] => (version.evidenceId ? [{ kind: 'EVIDENCE_RECORD', id: version.evidenceId, detail: 'credential_version' }] : []);

type Presented = { credential: WCredential; version: WCredentialVersion };

function presented(ctx: PredicateContext): Presented[] {
  return ctx.encounter.selections
    .map((s) => resolveSelection(ctx.world, s))
    .filter((r): r is typeof r & Presented => usableSelection(r, ctx.travellerId))
    .map((r) => ({ credential: r.credential, version: r.version }));
}

/** The single selected passport of the encounter, or the UNKNOWN outcome explaining why there is none. */
function selectedPassport(ctx: PredicateContext): { passport: Presented } | { outcome: PredicateOutcome } {
  const passports = presented(ctx).filter((p) => p.credential.kind === IDENTITY_DOCUMENT_KIND);
  if (passports.length === 0) return { outcome: unknown('passport_not_selected', 'MISSING_INPUT', 'selected_passport', ctx) };
  if (passports.length > 1) {
    return { outcome: unknown('ambiguous_identity_document', 'MISSING_INPUT', 'selected_passport', ctx, { facts: { selectedPassportCount: passports.length } }) };
  }
  return { passport: passports[0]! };
}

function passportFacts(p: Presented): Record<string, FactValue> {
  return { passportCredentialId: p.credential.id, passportVersionId: p.version.id, passportExpiryDate: p.version.expiryDate, passportIssuingStateCode: p.version.issuingStateCode };
}

/** ---- predicates ----------------------------------------------------------- */

const nationalityIn: EntryPredicate = (parameters, ctx) => {
  const codes = stringList(parameters.codes);
  if (!codes) return invalidParameters(ctx, 'codes');
  const selected = selectedPassport(ctx);
  if ('outcome' in selected) return selected.outcome;
  const { passport } = selected;
  const evidence = credentialEvidence(passport.version);
  const state = passport.version.issuingStateCode;
  if (!state) return unknown('passport_issuing_state_unknown', 'MISSING_INPUT', 'passport_issuing_state', ctx, { facts: passportFacts(passport), evidence });
  return outcome(codes.includes(state) ? 'PASS' : 'FAIL', codes.includes(state) ? 'nationality_in_codes' : 'nationality_not_in_codes', { facts: passportFacts(passport), evidence });
};

const passportValidDaysAfterExit: EntryPredicate = (parameters, ctx) => {
  const days = nonNegativeInteger(parameters.days);
  if (days === undefined) return invalidParameters(ctx, 'days');
  const selected = selectedPassport(ctx);
  if ('outcome' in selected) return selected.outcome;
  const { passport } = selected;
  const facts = { ...passportFacts(passport), requiredDaysAfterExit: days, exit: ctx.encounter.exit };
  const evidence = credentialEvidence(passport.version);
  if (!passport.version.expiryDate) return unknown('credential_expiry_unknown', 'MISSING_INPUT', 'credential_expiry', ctx, { facts, evidence });
  if (!ctx.encounter.exit) return unknown('encounter_exit_unknown', 'MISSING_INPUT', 'encounter_exit', ctx, { facts, evidence });
  const status = dateOnOrAfterLocalDate(passport.version.expiryDate, ctx.encounter.exit, days);
  if (status === 'UNKNOWN') return unknown('local_date_ambiguous', 'MISSING_INPUT', 'local_validity_date', ctx, { facts, evidence });
  return outcome(status, status === 'PASS' ? 'passport_valid_long_enough' : 'passport_expires_too_soon', { facts, evidence });
};

const linkedVisaValid: EntryPredicate = (parameters, ctx) => {
  const issuingStates = stringList(parameters.issuing_state_codes);
  if (!issuingStates) return invalidParameters(ctx, 'issuing_state_codes');
  const classes = parameters.classes === undefined ? undefined : stringList(parameters.classes);
  if (parameters.classes !== undefined && !classes) return invalidParameters(ctx, 'classes');
  const { at, exit } = ctx.encounter;

  const authorisations = presented(ctx).filter((p) => ENTRY_AUTHORISATION_KINDS.includes(p.credential.kind));
  // An authorisation whose issuing state is unknown might be the relevant one.
  const candidates = authorisations.filter((p) => p.version.issuingStateCode === null || issuingStates.includes(p.version.issuingStateCode));
  const evidence = candidates.flatMap((c) => credentialEvidence(c.version));
  const baseFacts: Record<string, FactValue> = { candidateAuthorisationCount: candidates.length, classesRequired: classes !== undefined };
  if (candidates.length === 0) return outcome('FAIL', 'linked_visa_missing', { facts: baseFacts });

  const selected = selectedPassport(ctx);
  if ('outcome' in selected) return { ...selected.outcome, evidence: [...selected.outcome.evidence, ...evidence], facts: { ...selected.outcome.facts, ...baseFacts } };
  const { passport } = selected;
  if (!exit || !at) return unknown('encounter_exit_unknown', 'MISSING_INPUT', 'encounter_exit', ctx, { facts: baseFacts, evidence });

  const perCandidate = candidates.map((c) => {
    const link = linkToPassports(ctx.world, ctx.travellerId, c.credential.id, [passport.credential.id], at, exit);
    const statusValid: Tri = c.version.issuerStatus === 'REVOKED' || c.version.issuerStatus === 'SUSPENDED' ? 'FAIL' : c.version.issuerStatus === 'UNKNOWN' ? 'UNKNOWN' : 'PASS';
    const checks: Record<string, Tri> = {
      issuingState: c.version.issuingStateCode === null ? 'UNKNOWN' : 'PASS',
      issuerStatus: statusValid,
      linkedToSelectedPassport: link.status,
      issuedByEntry: dateOnOrBeforeLocalDate(c.version.issueDate, at),
      validThroughExit: c.version.expiryDate === null ? 'UNKNOWN' : dateOnOrAfterLocalDate(c.version.expiryDate, exit),
      classPermitted: classes === undefined ? 'PASS' : c.version.visaClass === null ? 'UNKNOWN' : classes.includes(c.version.visaClass) ? 'PASS' : 'FAIL',
    };
    return { c, link, checks, status: kleeneAll(Object.values(checks)) };
  });
  const status = kleeneAny(perCandidate.map((p) => p.status));
  const facts: Record<string, FactValue> = { ...baseFacts, ...passportFacts(passport) };
  perCandidate.forEach((p, index) => {
    facts[`authorisation.${index}.credentialVersionId`] = p.c.version.id;
    facts[`authorisation.${index}.status`] = p.status;
    for (const [check, value] of Object.entries(p.checks)) facts[`authorisation.${index}.${check}`] = value;
  });
  const linkEvidence: EvidenceRef[] = perCandidate.flatMap((p) => p.link.links.map((l): EvidenceRef => ({ kind: 'EVIDENCE_RECORD', id: l.evidenceId, detail: 'credential_link' })));
  const allEvidence = [...evidence, ...credentialEvidence(passport.version), ...linkEvidence];
  if (status === 'UNKNOWN') {
    const unknownChecks = [...new Set(perCandidate.filter((p) => p.status === 'UNKNOWN').flatMap((p) => Object.entries(p.checks).filter(([, v]) => v === 'UNKNOWN').map(([k]) => k)))].sort();
    return outcome('UNKNOWN', 'linked_visa_validity_unknown', {
      facts: { ...facts, unknownChecks: unknownChecks.join(',') },
      evidence: allEvidence,
      uncertainty: [{ kind: 'MISSING_INPUT', code: 'linked_visa_validity', subjectRef: traveller(ctx) }],
    });
  }
  return outcome(status, status === 'PASS' ? 'linked_visa_valid' : 'linked_visa_not_valid', { facts, evidence: allEvidence });
};

const purposeIn: EntryPredicate = (parameters, ctx) => {
  const purposes = stringList(parameters.purposes);
  if (!purposes) return invalidParameters(ctx, 'purposes');
  const { purpose } = ctx.encounter;
  if (purpose === null) return unknown('encounter_purpose_unknown', 'MISSING_INPUT', 'encounter_purpose', ctx);
  const ok = purposes.includes(purpose);
  return outcome(ok ? 'PASS' : 'FAIL', ok ? 'purpose_permitted' : 'purpose_not_permitted', { facts: { purpose } });
};

const stayDaysAtMost: EntryPredicate = (parameters, ctx) => {
  const days = nonNegativeInteger(parameters.days);
  if (days === undefined) return invalidParameters(ctx, 'days');
  const { stayDays } = ctx.encounter;
  if (stayDays === null) return unknown('encounter_exit_unknown', 'MISSING_INPUT', 'encounter_exit', ctx);
  const ok = stayDays <= days;
  return outcome(ok ? 'PASS' : 'FAIL', ok ? 'stay_within_limit' : 'stay_exceeds_limit', { facts: { stayDays, maximumStayDays: days } });
};

/**
 * Cumulative days in the jurisdiction within `[exit − window_days, exit]`
 * from sourced travel history, plus earlier intended visits of this Journey
 * to the jurisdiction, plus this stay. History completeness is a recorded
 * claim: at least one WINDOW_COMPLETE row whose [entryDate, exitDate] covers
 * the window up to the earlier of this entry and now. Missing history is
 * never zero days. Because the civil exit date depends on an unknown zone,
 * a lower and an upper bound are computed; only an unambiguous bound decides.
 */
const historyDaysWithinWindowAtMost: EntryPredicate = (parameters, ctx) => {
  const days = nonNegativeInteger(parameters.days);
  if (days === undefined) return invalidParameters(ctx, 'days');
  const windowDays = nonNegativeInteger(parameters.window_days);
  if (windowDays === undefined) return invalidParameters(ctx, 'window_days');
  const { encounter, world } = ctx;
  if (!encounter.jurisdictionId || !encounter.at || !encounter.exit || encounter.stayDays === null) {
    return unknown('encounter_exit_unknown', 'MISSING_INPUT', 'encounter_exit', ctx);
  }
  const exitDates = possibleLocalDates(encounter.exit);
  const entryDates = possibleLocalDates(encounter.at);
  const nowDates = possibleLocalDates(ctx.now);
  if (!exitDates || !entryDates || !nowDates) return unknown('encounter_exit_unknown', 'MISSING_INPUT', 'encounter_exit', ctx);

  const widestStart = addDays(exitDates.earliest, -windowDays);
  const narrowestStart = addDays(exitDates.latest, -windowDays);
  const historyEnd = addDays(entryDates.earliest, -1) < nowDates.earliest ? addDays(entryDates.earliest, -1) : nowDates.earliest;
  const rows = world.travelHistory.filter((h) => h.travellerId === ctx.travellerId).sort((a, b) => a.id.localeCompare(b.id));
  const evidence: EvidenceRef[] = rows.map((h) => ({ kind: 'EVIDENCE_RECORD', id: h.evidenceId, detail: 'travel_history' }));
  const baseFacts: Record<string, FactValue> = { maximumDays: days, windowDays, stayDays: encounter.stayDays, windowStartEarliest: widestStart, historyRequiredThrough: historyEnd };

  const completeRow = rows.find((h) => h.coverageClaim === 'WINDOW_COMPLETE' && h.entryDate !== null && h.exitDate !== null && h.entryDate <= widestStart && h.exitDate >= historyEnd);
  if (!completeRow) {
    return unknown('travel_history_incomplete', 'INCOMPLETE_COVERAGE', 'travel_history', ctx, { facts: baseFacts, evidence });
  }

  const inJurisdiction = rows.filter((h) => h.jurisdictionId === encounter.jurisdictionId);
  const openEnded = inJurisdiction.filter((h) => h.entryDate === null || h.exitDate === null);
  if (openEnded.some((h) => (h.exitDate ?? exitDates.latest) >= widestStart && (h.entryDate ?? widestStart) <= exitDates.latest)) {
    return unknown('travel_history_incomplete', 'MISSING_INPUT', 'travel_history_dates', ctx, { facts: { ...baseFacts, openEndedHistoryRows: openEnded.length }, evidence });
  }
  const dated = inJurisdiction.filter((h): h is typeof h & { entryDate: string; exitDate: string } => h.entryDate !== null && h.exitDate !== null);
  let maxHistory = dated.reduce((sum, h) => sum + inclusiveOverlapDays(h.entryDate, h.exitDate, widestStart, exitDates.latest), 0);
  let minHistory = dated.reduce((sum, h) => sum + inclusiveOverlapDays(h.entryDate, h.exitDate, narrowestStart, exitDates.earliest), 0);

  // Earlier intended visits of this Journey to the same jurisdiction count as planned presence.
  const exitMs = Date.parse(encounter.exit);
  const atMs = Date.parse(encounter.at);
  for (const visit of visitsOfJourney(world, ctx.journeyId)) {
    if (visit.id === encounter.visitId || visit.jurisdictionId !== encounter.jurisdictionId) continue;
    const start = Date.parse(visit.intended.start);
    const end = Math.min(Date.parse(visit.intended.end), atMs);
    if (end <= start) continue;
    const overlapMax = end - Math.max(start, exitMs - (windowDays + 1) * DAY_MS);
    const overlapMin = end - Math.max(start, exitMs - (windowDays - 1) * DAY_MS);
    if (overlapMax > 0) maxHistory += Math.ceil(overlapMax / DAY_MS);
    if (overlapMin > 0) minHistory += Math.floor(overlapMin / DAY_MS);
  }

  const maxTotal = maxHistory + encounter.stayDays;
  const minTotal = minHistory + encounter.stayDays;
  const facts = { ...baseFacts, cumulativeDaysLowerBound: minTotal, cumulativeDaysUpperBound: maxTotal, completenessHistoryId: completeRow.id };
  if (maxTotal <= days) return outcome('PASS', 'cumulative_stay_within_limit', { facts, evidence });
  if (minTotal > days) return outcome('FAIL', 'cumulative_stay_exceeds_limit', { facts, evidence });
  return unknown('local_date_ambiguous', 'MISSING_INPUT', 'local_validity_date', ctx, { facts, evidence });
};

const airsideConfirmed: EntryPredicate = (_parameters, ctx) =>
  unknown('airside_facts_unavailable', 'MISSING_INPUT', 'airside_transit_facts', ctx, {
    facts: { airsideFactsKnown: ctx.encounter.airsideFactsKnown },
    related: ctx.encounter.placeId ? [{ kind: 'PLACE', id: ctx.encounter.placeId }] : [],
  });

/** ---- registry --------------------------------------------------------------- */

const LIBRARY = new Map<string, EntryPredicate>([
  ['traveller.nationality_in', nationalityIn],
  ['credential.passport_valid_days_after_exit', passportValidDaysAfterExit],
  ['credential.linked_visa_valid', linkedVisaValid],
  ['journey.purpose_in', purposeIn],
  ['journey.stay_days_at_most', stayDaysAtMost],
  ['history.days_within_window_at_most', historyDaysWithinWindowAtMost],
  ['transit.airside_confirmed', airsideConfirmed],
]);

export const ENTRY_PREDICATES: ReadonlyMap<string, EntryPredicate> = LIBRARY;
export const ENTRY_PREDICATE_IDS: readonly string[] = Object.freeze([...LIBRARY.keys()].sort());
export const entryPredicateRegistry: RulePredicateRegistry = rulePredicateRegistry(ENTRY_PREDICATE_IDS);

/** ---- Kleene expression evaluation ------------------------------------------ */

export interface LeafOutcome extends PredicateOutcome {
  predicateId: string;
}

export interface ExpressionResult {
  status: Tri;
  /** Leaves that decide `status` (for UNKNOWN: the UNKNOWN leaves that keep it undecided). */
  decisive: LeafOutcome[];
  /** Every evaluated leaf, in expression order. */
  leaves: LeafOutcome[];
}

function unsupportedLeaf(predicateId: string, reasonCode: string, code: string, ctx: PredicateContext): LeafOutcome {
  return { predicateId, ...unknown(reasonCode, 'UNSUPPORTED_EVALUATION', code, ctx, { facts: { predicateId } }) };
}

function combine(status: Tri, parts: ExpressionResult[], operator: 'ALL' | 'ANY'): ExpressionResult {
  const leaves = parts.flatMap((p) => p.leaves);
  const wholeSetDecides = (operator === 'ALL' && status === 'PASS') || (operator === 'ANY' && status === 'FAIL');
  const decisive = wholeSetDecides ? parts.flatMap((p) => p.decisive) : parts.filter((p) => p.status === status).flatMap((p) => p.decisive);
  return { status, decisive, leaves };
}

/**
 * ALL: any FAIL ⇒ FAIL, else any UNKNOWN ⇒ UNKNOWN, else PASS.
 * ANY: any PASS ⇒ PASS, else any UNKNOWN ⇒ UNKNOWN, else FAIL.
 * NOT: swaps PASS/FAIL, keeps UNKNOWN.
 * PREDICATE: the registered library; an unregistered id ⇒ UNKNOWN `predicate_unsupported`.
 */
export function evaluateRuleExpression(expression: RuleExpression, ctx: PredicateContext, library: ReadonlyMap<string, EntryPredicate> = ENTRY_PREDICATES): ExpressionResult {
  const node = expression as unknown as Record<string, unknown>;
  switch (expression.operator) {
    case 'PREDICATE': {
      const predicate = library.get(expression.predicateId);
      const parameters = expression.parameters !== null && typeof expression.parameters === 'object' && !Array.isArray(expression.parameters) ? expression.parameters : {};
      const leaf: LeafOutcome = predicate
        ? { predicateId: expression.predicateId, ...predicate(parameters, ctx) }
        : unsupportedLeaf(expression.predicateId, 'predicate_unsupported', 'rule_predicate', ctx);
      return { status: leaf.status, decisive: [leaf], leaves: [leaf] };
    }
    case 'NOT': {
      const inner = evaluateRuleExpression(expression.operand, ctx, library);
      return { status: kleeneNot(inner.status), decisive: inner.decisive, leaves: inner.leaves };
    }
    case 'ALL':
    case 'ANY': {
      if (!Array.isArray(node.operands) || expression.operands.length === 0) {
        const leaf = unsupportedLeaf(expression.operator, 'rule_expression_unsupported', 'rule_expression', ctx);
        return { status: 'UNKNOWN', decisive: [leaf], leaves: [leaf] };
      }
      const parts = expression.operands.map((operand) => evaluateRuleExpression(operand, ctx, library));
      const statuses = parts.map((p) => p.status);
      const status = expression.operator === 'ALL' ? kleeneAll(statuses) : kleeneAny(statuses);
      return combine(status, parts, expression.operator);
    }
    default: {
      const leaf = unsupportedLeaf(typeof node.operator === 'string' && /^[a-z][a-z0-9_.-]*$/.test(node.operator) ? node.operator : 'unknown_operator', 'rule_expression_unsupported', 'rule_expression', ctx);
      return { status: 'UNKNOWN', decisive: [leaf], leaves: [leaf] };
    }
  }
}
