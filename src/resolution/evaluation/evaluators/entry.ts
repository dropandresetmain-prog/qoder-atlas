/**
 * NORTHSTAR M6 — `m6.entry`: legal entry and transit feasibility per derived
 * encounter (M6_EVALUATOR_CONTRACT.md §2 L4; closure §8).
 *
 * Dimensions `entry_feasibility` (ENTRY encounters) and `transit_feasibility`
 * (TRANSIT encounters), both blocking. For each encounter at jurisdiction J
 * and instant `at`:
 *
 *  1. applicable requirement editions — rule assignments for J valid at `at`
 *     whose rule set family is `entry` / `transit` (pinned edition, else the
 *     PUBLISHED/SUPERSEDED edition in effect at `at`, highest edition number),
 *     plus the editions referenced by REGULATORY information versions for the
 *     topic that are in effect at `at`, scoped to J, and neither retracted nor
 *     superseded. A future-effective edition does not apply before its start;
 *     every candidate boundary after `now` feeds `nextInvalidationAt`;
 *  2. each edition's expression and MANDATORY/PROHIBITIVE rules are evaluated
 *     with Kleene logic over the registered predicate library;
 *  3. verdict: any FAIL ⇒ FAIL `requirement_not_met`; any UNKNOWN ⇒ UNKNOWN
 *     (leaf reason); all PASS ⇒ PASS `requirements_met` only with complete,
 *     unexpired coverage for the topic and J, else UNKNOWN
 *     `requirement_coverage_incomplete`. No applicable edition ⇒ PASS only
 *     with such coverage.
 *
 * Organisation approval, objective waivers and corporate policy are never
 * read: legal feasibility cannot be waived.
 */
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { Instant } from '../../../domain/v2/shared/time.ts';
import type { CausalExplanation, EvidenceRef, Uncertainty } from '../../../contracts/v2/assessment/explanation.ts';
import type { MissingCoverage } from '../../../contracts/v2/scope/readScope.ts';
import { coverageSupportsUnqualifiedPass, type KnowledgeCoverageCompleteness } from '../../../domain/v2/knowledge/information.ts';
import type { CapturedWorld, WCoverage, WInformationVersion, WJourney, WRuleSetVersion } from '../../world/world.ts';
import type { EvaluationContext, Evaluator, EvaluatorOutput } from '../evaluator.ts';
import { dimension, earliestAfter, explain, notApplicable } from '../explain.ts';
import { deriveEncounters, kleeneAll, resolveSelection, within, type Encounter, type Tri } from '../encounters.ts';
import { evaluateRuleExpression, type LeafOutcome, type PredicateContext } from '../entryPredicates.ts';

export const ENTRY_EVALUATOR_ID = 'm6.entry';

const DIMENSION = { ENTRY: 'entry_feasibility', TRANSIT: 'transit_feasibility' } as const;
const TOPIC = { ENTRY: 'ENTRY_REQUIREMENT', TRANSIT: 'TRANSIT_REQUIREMENT' } as const;
const POLICY_FAMILY = { ENTRY: 'entry', TRANSIT: 'transit' } as const;
const SELECTABLE_EDITION_STATUSES: readonly string[] = ['PUBLISHED', 'SUPERSEDED'];
const BINDING_RULE_SEVERITIES: readonly string[] = ['MANDATORY', 'PROHIBITIVE'];

type Facts = Record<string, string | number | boolean | null>;
type Kind = Encounter['kind'];

const refKey = (r: EvidenceRef) => `${r.kind}:${r.id}:${r.detail ?? ''}`;
function uniqueEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  return [...new Map(refs.map((r) => [refKey(r), r])).values()].sort((a, b) => refKey(a).localeCompare(refKey(b)));
}

/** ---- knowledge applicability ------------------------------------------------ */

export interface ApplicableEdition {
  edition: WRuleSetVersion;
  assignmentIds: string[];
  informationVersionIds: string[];
}

export interface RequirementLookup {
  editions: ApplicableEdition[];
  informationVersions: WInformationVersion[];
  /** Referenced / pinned edition ids that were not captured. */
  missingEditionIds: string[];
  /** Assignments whose rule set has no captured edition at all (family cannot be established). */
  uncapturedRuleSetIds: string[];
  /** Assignments narrowed by a population predicate this evaluator cannot evaluate. */
  populationAssignmentIds: string[];
  /** Instants after which applicability may change. */
  boundaries: (Instant | null)[];
}

/** True when a captured later edition of the same record supersedes `version` by instant `at`. */
export function supersededAt(world: CapturedWorld, version: WInformationVersion, at: Instant): boolean {
  return world.informationVersions.some((other) => other.id !== version.id && other.retractsId === null
    && (other.supersedesId === version.id || (other.recordId === version.recordId && other.sequence > version.sequence))
    && (other.effective.start === null || Date.parse(other.effective.start) <= Date.parse(at)));
}

export function retracted(world: CapturedWorld, version: WInformationVersion): boolean {
  return version.retractsId !== null || world.informationVersions.some((other) => other.retractsId === version.id);
}

function requirementsFor(world: CapturedWorld, journey: WJourney, kind: Kind, jurisdictionId: string, at: Instant): RequirementLookup {
  const trip = world.trips.find((t) => t.id === journey.tripId);
  const organisations = new Set([journey.responsibilityOrganisationId, trip?.businessContextOrganisationId].filter((o): o is string => typeof o === 'string'));
  const family = POLICY_FAMILY[kind];
  const lookup: RequirementLookup = { editions: [], informationVersions: [], missingEditionIds: [], uncapturedRuleSetIds: [], populationAssignmentIds: [], boundaries: [] };
  const byEdition = new Map<string, ApplicableEdition>();
  const addEdition = (edition: WRuleSetVersion, via: { assignmentId?: string; informationVersionId?: string }) => {
    const entry = byEdition.get(edition.id) ?? { edition, assignmentIds: [], informationVersionIds: [] };
    if (via.assignmentId) entry.assignmentIds.push(via.assignmentId);
    if (via.informationVersionId) entry.informationVersionIds.push(via.informationVersionId);
    byEdition.set(edition.id, entry);
  };

  const assignments = world.ruleAssignments.filter((a) => a.jurisdictionId === jurisdictionId).sort((a, b) => a.id.localeCompare(b.id));
  for (const assignment of assignments) {
    const versions = world.ruleSetVersions.filter((v) => v.ruleSetId === assignment.ruleSetId);
    const pinned = assignment.ruleSetVersionId ? world.ruleSetVersions.find((v) => v.id === assignment.ruleSetVersionId) : undefined;
    const familyVersions = versions.filter((v) => v.policyFamily === family);
    if (assignment.ruleSetVersionId ? pinned && pinned.policyFamily !== family : versions.length > 0 && familyVersions.length === 0) continue;
    // Narrowed assignments that do not concern this Journey.
    if (assignment.subject && !(assignment.subject.kind === 'JOURNEY' && assignment.subject.id === journey.id) && !(assignment.subject.kind === 'TRAVELLER' && assignment.subject.id === journey.travellerId)) continue;
    if (assignment.organisationId && !organisations.has(assignment.organisationId)) continue;

    lookup.boundaries.push(assignment.valid.start, assignment.valid.end);
    if (!within(assignment.valid, at)) continue;
    if (assignment.populationPredicateId) { lookup.populationAssignmentIds.push(assignment.id); continue; }

    if (assignment.ruleSetVersionId) {
      if (!pinned) lookup.missingEditionIds.push(assignment.ruleSetVersionId);
      else addEdition(pinned, { assignmentId: assignment.id });
      continue;
    }
    if (versions.length === 0) { lookup.uncapturedRuleSetIds.push(assignment.ruleSetId); continue; }
    const selectable = familyVersions.filter((v) => SELECTABLE_EDITION_STATUSES.includes(v.status));
    for (const v of selectable) lookup.boundaries.push(v.effective.start, v.effective.end);
    const current = selectable.filter((v) => within(v.effective, at)).sort((a, b) => b.editionNumber - a.editionNumber || a.id.localeCompare(b.id))[0];
    if (current) addEdition(current, { assignmentId: assignment.id });
  }

  const informationVersions = world.informationVersions
    .filter((iv) => iv.subtype === 'REGULATORY' && iv.topic === TOPIC[kind])
    .filter((iv) => iv.regulatoryJurisdictionId === jurisdictionId || iv.scopes.some((s) => s.jurisdictionId === jurisdictionId))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const iv of informationVersions) {
    lookup.boundaries.push(iv.effective.start, iv.effective.end);
    if (retracted(world, iv) || supersededAt(world, iv, at) || !within(iv.effective, at)) continue;
    lookup.informationVersions.push(iv);
    const edition = iv.regulatoryRuleSetVersionId ? world.ruleSetVersions.find((v) => v.id === iv.regulatoryRuleSetVersionId) : undefined;
    if (!edition) lookup.missingEditionIds.push(iv.regulatoryRuleSetVersionId ?? `information:${iv.id}`);
    else addEdition(edition, { informationVersionId: iv.id });
  }
  // Superseding editions become boundaries too (they may start after now).
  for (const iv of world.informationVersions.filter((x) => x.subtype === 'REGULATORY' && x.topic === TOPIC[kind])) lookup.boundaries.push(iv.effective.start);

  lookup.editions = [...byEdition.values()].sort((a, b) => a.edition.id.localeCompare(b.edition.id));
  lookup.missingEditionIds = [...new Set(lookup.missingEditionIds)].sort();
  lookup.uncapturedRuleSetIds = [...new Set(lookup.uncapturedRuleSetIds)].sort();
  return lookup;
}

export interface CoverageCheck {
  complete: boolean;
  records: WCoverage[];
  uncertainty: Uncertainty[];
}

export interface CoverageContext {
  journeyId: string;
  visitId: string | null;
}

function validCoverageScopeId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function coverageMatchesContext(coverage: WCoverage, context: CoverageContext | undefined): boolean {
  const bounds = coverage.queryBounds;
  const hasJourneyScope = Object.prototype.hasOwnProperty.call(bounds, 'journeyId');
  const hasVisitScope = Object.prototype.hasOwnProperty.call(bounds, 'visitId');
  if (!hasJourneyScope && !hasVisitScope) return true;
  if (!context) return false;
  if (hasJourneyScope && (!validCoverageScopeId(bounds.journeyId) || !validCoverageScopeId(context.journeyId) || bounds.journeyId !== context.journeyId)) return false;
  if (hasVisitScope && (!validCoverageScopeId(bounds.visitId) || !validCoverageScopeId(context.visitId) || bounds.visitId !== context.visitId)) return false;
  return true;
}

/** Complete, limitation-free, unexpired coverage for `topic` bounded to the jurisdiction. */
export function coverageFor(world: CapturedWorld, topic: string, jurisdictionId: string, now: Instant, context?: CoverageContext): CoverageCheck {
  const records = world.coverage.filter((c) => c.topic === topic && c.queryBounds.jurisdictionId === jurisdictionId && coverageMatchesContext(c, context)).sort((a, b) => a.id.localeCompare(b.id));
  const unexpired = (c: WCoverage) => c.expiresAt === null || Date.parse(c.expiresAt) > Date.parse(now);
  const complete = records.some((c) => unexpired(c) && coverageSupportsUnqualifiedPass({ completeness: c.completeness as KnowledgeCoverageCompleteness, completenessLimitations: c.limitations }));
  const subjectRef: TypedRef = { kind: 'JURISDICTION', id: jurisdictionId };
  const code = topic.toLowerCase();
  const uncertainty: Uncertainty[] = complete ? []
    : records.length === 0 ? [{ kind: 'MISSING_COVERAGE', code, subjectRef }]
      : records.every((c) => !unexpired(c)) ? [{ kind: 'STALE_INPUT', code, subjectRef }]
        : [{ kind: 'INCOMPLETE_COVERAGE', code, subjectRef }];
  return { complete, records, uncertainty };
}

export function coverageEvidence(records: WCoverage[]): EvidenceRef[] {
  return records.flatMap((c): EvidenceRef[] => [{ kind: 'KNOWLEDGE_COVERAGE', id: c.id }, ...(c.evidenceId ? [{ kind: 'EVIDENCE_RECORD' as const, id: c.evidenceId, detail: 'coverage' }] : [])]);
}

/** ---- evaluation --------------------------------------------------------------- */

interface EditionOutcome {
  applicable: ApplicableEdition;
  status: Tri;
  decisive: LeafOutcome[];
  leaves: LeafOutcome[];
}

function evaluateEdition(applicable: ApplicableEdition, ctx: PredicateContext): EditionOutcome {
  const { edition } = applicable;
  const parts = [edition.expression, ...edition.rules.filter((r) => r.severity !== null && BINDING_RULE_SEVERITIES.includes(r.severity)).map((r) => r.expression)]
    .map((expression) => evaluateRuleExpression(expression, ctx));
  const status = kleeneAll(parts.map((p) => p.status));
  const decisive = status === 'PASS' ? parts.flatMap((p) => p.decisive) : parts.filter((p) => p.status === status).flatMap((p) => p.decisive);
  return { applicable, status, decisive, leaves: parts.flatMap((p) => p.leaves) };
}

function evaluateEncounter(world: CapturedWorld, now: Instant, journey: WJourney, subject: TypedRef, e: Encounter, boundaries: (Instant | null)[], missing: MissingCoverage[]): CausalExplanation[] {
  const dim = DIMENSION[e.kind];
  const travellerRef: TypedRef = { kind: 'TRAVELLER', id: journey.travellerId };
  const placeRef: TypedRef[] = e.placeId ? [{ kind: 'PLACE', id: e.placeId }] : [];
  const jurisdictionRef: TypedRef[] = e.jurisdictionId ? [{ kind: 'JURISDICTION', id: e.jurisdictionId }] : [];
  const selected = e.selections.map((s) => resolveSelection(world, s));
  const facts: Facts = {
    encounterId: e.id, encounterKind: e.kind, encounterOrigin: e.origin, jurisdictionId: e.jurisdictionId, at: e.at, exit: e.exit,
    stayDays: e.stayDays, purpose: e.purpose, visitId: e.visitId, placeId: e.placeId, arrivingItemId: e.arrivingItemId, departingItemId: e.departingItemId,
    airsideFactsKnown: e.airsideFactsKnown, selectedCredentialCount: selected.length,
  };
  selected.forEach((s, index) => { facts[`selectedCredentialVersionId.${index}`] = s.selection.credentialVersionId; });
  const credentialEvidence: EvidenceRef[] = selected.flatMap((s) => (s.version?.evidenceId ? [{ kind: 'EVIDENCE_RECORD' as const, id: s.version.evidenceId, detail: 'credential_version' }] : []));
  const placeEvidence: EvidenceRef[] = e.placeId
    ? world.placeJurisdictions.filter((pj) => pj.placeId === e.placeId && pj.evidenceId).map((pj) => ({ kind: 'EVIDENCE_RECORD' as const, id: pj.evidenceId as string, detail: 'place_jurisdiction' }))
    : [];

  const make = (status: Tri, reasonCode: string, cause: CausalExplanation['cause'], extra: { related?: TypedRef[]; evidence?: EvidenceRef[]; facts?: Facts; uncertainty?: Uncertainty[] } = {}) => explain({
    evaluatorId: ENTRY_EVALUATOR_ID, dimension: dim, status, reasonCode, cause, affectedSubject: subject,
    relatedSubjects: [travellerRef, ...jurisdictionRef, ...placeRef, ...(extra.related ?? [])],
    evidenceRefs: [...credentialEvidence, ...placeEvidence, ...(extra.evidence ?? [])],
    facts: { ...facts, ...(extra.facts ?? {}) },
    uncertainty: extra.uncertainty ?? [],
  });

  if (e.jurisdictionId === null) {
    return [make('UNKNOWN', 'encounter_jurisdiction_unresolved', { kind: 'MISSING_INFORMATION', ...(placeRef[0] ? { subjectRef: placeRef[0] } : {}) }, {
      uncertainty: [{ kind: 'UNRESOLVED_LOCATION', code: 'place_jurisdiction', ...(placeRef[0] ? { subjectRef: placeRef[0] } : {}) }],
    })];
  }
  if (e.at === null) {
    return [make('UNKNOWN', 'encounter_time_unknown', { kind: 'MISSING_INFORMATION', subjectRef: subject }, { uncertainty: [{ kind: 'MISSING_INPUT', code: 'encounter_time', subjectRef: subject }] })];
  }

  const lookup = requirementsFor(world, journey, e.kind, e.jurisdictionId, e.at);
  boundaries.push(...lookup.boundaries);
  const topic = TOPIC[e.kind];
  const coverage = coverageFor(world, topic, e.jurisdictionId, now, { journeyId: journey.id, visitId: e.visitId });
  for (const c of coverage.records) boundaries.push(c.expiresAt);
  const jurisdictionSubject: TypedRef = { kind: 'JURISDICTION', id: e.jurisdictionId };

  const knowledgeRelated: TypedRef[] = [
    ...lookup.editions.flatMap((a) => [{ kind: 'RULE_SET' as const, id: a.edition.ruleSetId }, a.edition.issuer]),
    ...lookup.informationVersions.map((iv) => ({ kind: 'INFORMATION_VERSION' as const, id: iv.id })),
  ];
  const knowledgeEvidence: EvidenceRef[] = [
    ...lookup.editions.map((a): EvidenceRef => ({ kind: 'RULE_SET_VERSION', id: a.edition.id })),
    ...lookup.informationVersions.flatMap((iv): EvidenceRef[] => [{ kind: 'INFORMATION_VERSION', id: iv.id }, { kind: 'EVIDENCE_RECORD', id: iv.evidenceId, detail: 'information_version' }]),
    ...coverageEvidence(coverage.records),
  ];
  const knowledgeFacts: Facts = { topic, applicableEditionCount: lookup.editions.length, coverageComplete: coverage.complete };
  lookup.editions.forEach((a, index) => { knowledgeFacts[`editionId.${index}`] = a.edition.id; });
  lookup.informationVersions.forEach((iv, index) => { knowledgeFacts[`informationVersionId.${index}`] = iv.id; });
  coverage.records.forEach((c, index) => { knowledgeFacts[`coverageId.${index}`] = c.id; });
  const withKnowledge = (extra: { related?: TypedRef[]; evidence?: EvidenceRef[]; facts?: Facts; uncertainty?: Uncertainty[] } = {}) => ({
    related: [...knowledgeRelated, ...(extra.related ?? [])],
    evidence: [...knowledgeEvidence, ...(extra.evidence ?? [])],
    facts: { ...knowledgeFacts, ...(extra.facts ?? {}) },
    uncertainty: extra.uncertainty ?? [],
  });

  const explanations: CausalExplanation[] = [];
  for (const id of lookup.missingEditionIds) {
    explanations.push(make('UNKNOWN', 'rule_edition_not_captured', { kind: 'MISSING_INFORMATION', subjectRef: jurisdictionSubject }, withKnowledge({ facts: { missingEditionId: id }, uncertainty: [{ kind: 'MISSING_INPUT', code: 'rule_set_version', subjectRef: jurisdictionSubject }] })));
  }
  for (const id of lookup.uncapturedRuleSetIds) {
    explanations.push(make('UNKNOWN', 'rule_edition_not_captured', { kind: 'MISSING_INFORMATION', subjectRef: { kind: 'RULE_SET', id } }, withKnowledge({ related: [{ kind: 'RULE_SET', id }], facts: { uncapturedRuleSetId: id }, uncertainty: [{ kind: 'MISSING_INPUT', code: 'rule_set_version', subjectRef: { kind: 'RULE_SET', id } }] })));
  }
  for (const id of lookup.populationAssignmentIds) {
    explanations.push(make('UNKNOWN', 'rule_population_unsupported', { kind: 'REQUIREMENT', subjectRef: jurisdictionSubject }, withKnowledge({ facts: { ruleAssignmentId: id }, uncertainty: [{ kind: 'UNSUPPORTED_EVALUATION', code: 'population_predicate', subjectRef: jurisdictionSubject }] })));
  }

  const ctx: PredicateContext = { world, now, journeyId: journey.id, travellerId: journey.travellerId, encounter: e };
  const outcomes = lookup.editions.map((a) => evaluateEdition(a, ctx));
  for (const o of outcomes) {
    const editionRef: TypedRef = { kind: 'RULE_SET', id: o.applicable.edition.ruleSetId };
    const leafEvidence = o.leaves.flatMap((l) => l.evidence);
    const leafRelated = o.leaves.flatMap((l) => l.related);
    const editionFacts: Facts = {
      editionId: o.applicable.edition.id, editionNumber: o.applicable.edition.editionNumber, editionStatus: o.applicable.edition.status, editionVerdict: o.status,
      decisivePredicates: [...new Set(o.decisive.map((d) => d.predicateId))].sort().join(','),
    };
    o.decisive.forEach((leaf, index) => {
      editionFacts[`decisive.${index}.predicateId`] = leaf.predicateId;
      editionFacts[`decisive.${index}.status`] = leaf.status;
      editionFacts[`decisive.${index}.reasonCode`] = leaf.reasonCode;
      for (const [key, value] of Object.entries(leaf.facts)) editionFacts[`decisive.${index}.${key}`] = value;
    });
    if (o.status === 'FAIL') {
      explanations.push(make('FAIL', 'requirement_not_met', { kind: 'REQUIREMENT', subjectRef: editionRef }, withKnowledge({ related: leafRelated, evidence: leafEvidence, facts: editionFacts })));
    } else if (o.status === 'UNKNOWN') {
      const byReason = new Map<string, LeafOutcome[]>();
      for (const leaf of o.decisive.filter((d) => d.status === 'UNKNOWN')) byReason.set(leaf.reasonCode, [...(byReason.get(leaf.reasonCode) ?? []), leaf]);
      for (const [reasonCode, leaves] of [...byReason.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        explanations.push(make('UNKNOWN', reasonCode, { kind: 'MISSING_INFORMATION', subjectRef: editionRef }, withKnowledge({
          related: leafRelated, evidence: leafEvidence, facts: editionFacts, uncertainty: leaves.flatMap((l) => l.uncertainty),
        })));
      }
    }
  }

  const blockedByGaps = lookup.missingEditionIds.length + lookup.uncapturedRuleSetIds.length + lookup.populationAssignmentIds.length > 0;
  if (!blockedByGaps && outcomes.every((o) => o.status === 'PASS')) {
    if (!coverage.complete) {
      missing.push({ subjectRef: jurisdictionSubject, scopeDescription: `${topic} coverage for jurisdiction ${e.jurisdictionId}`, reason: 'SOURCE_INCOMPLETE' });
    }
    const reason = coverage.complete
      ? outcomes.length === 0 ? 'no_applicable_requirement_complete_coverage' : 'requirements_met'
      : 'requirement_coverage_incomplete';
    const leafEvidence = outcomes.flatMap((o) => o.leaves.flatMap((l) => l.evidence));
    explanations.push(make(coverage.complete ? 'PASS' : 'UNKNOWN', reason, { kind: coverage.complete ? 'REQUIREMENT' : 'MISSING_INFORMATION', subjectRef: jurisdictionSubject }, withKnowledge({
      evidence: leafEvidence, uncertainty: coverage.uncertainty,
    })));
  }
  return explanations;
}

function evaluate(subject: TypedRef, { now, world, effective }: EvaluationContext): EvaluatorOutput {
  const none = (): EvaluatorOutput => ({ dimensions: [notApplicable(DIMENSION.ENTRY), notApplicable(DIMENSION.TRANSIT)], evidence: [], missingCoverage: [] });
  if (subject.kind !== 'JOURNEY') return none();
  const journey = world.journeys.find((j) => j.id === subject.id);
  const projected = effective.journeys.find((j) => j.journeyRef.id === subject.id);
  if (!journey || !projected) {
    if (!world.intendedVisits.some((v) => v.journeyId === subject.id)) return none();
    const unknown = (dim: string) => dimension({ dimension: dim, explanations: [explain({
      evaluatorId: ENTRY_EVALUATOR_ID, dimension: dim, status: 'UNKNOWN', reasonCode: 'journey_not_captured', cause: { kind: 'MISSING_INFORMATION', subjectRef: subject },
      affectedSubject: subject, uncertainty: [{ kind: 'MISSING_INPUT', code: 'journey', subjectRef: subject }],
    })] });
    return { dimensions: [unknown(DIMENSION.ENTRY), unknown(DIMENSION.TRANSIT)], evidence: [], missingCoverage: [] };
  }

  const encounters = deriveEncounters(world, projected);
  const boundaries: (Instant | null)[] = [];
  const missingCoverage: MissingCoverage[] = [];
  const dimensions = (['ENTRY', 'TRANSIT'] as const).map((kind) => {
    const matching = encounters.filter((e) => e.kind === kind);
    if (matching.length === 0) return notApplicable(DIMENSION[kind]);
    return dimension({ dimension: DIMENSION[kind], explanations: matching.flatMap((e) => evaluateEncounter(world, now, journey, subject, e, boundaries, missingCoverage)) });
  });
  const evidence = uniqueEvidence(dimensions.flatMap((d) => d.explanations.flatMap((e) => e.evidenceRefs)));
  const uniqueMissing = [...new Map(missingCoverage.map((m) => [`${m.subjectRef?.id ?? ''}|${m.scopeDescription}`, m])).values()];
  const nextInvalidationAt = earliestAfter(now, boundaries);
  return { dimensions, evidence, missingCoverage: uniqueMissing, ...(nextInvalidationAt ? { nextInvalidationAt } : {}) };
}

export const entryEvaluator: Evaluator = {
  id: ENTRY_EVALUATOR_ID,
  version: '1',
  assessmentKind: 'ENTRY',
  subjectKinds: ['JOURNEY'],
  dimensions: [DIMENSION.ENTRY, DIMENSION.TRANSIT],
  informationTopics: [TOPIC.ENTRY, TOPIC.TRANSIT],
  evaluate,
};
