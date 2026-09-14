/**
 * NORTHSTAR M6 — `m6.information`: travel advisory / condition awareness and
 * organisation response (M6_EVALUATOR_CONTRACT.md §2 L4). Dimension
 * `advisories` (blocking). Topics `ADVISORY`, `CONDITION`.
 *
 * Exposure is the union of the Journey's intended-visit jurisdictions
 * (window = visit dates) and the jurisdictions of its active effective
 * items' places (window = the item's own interval). An information version
 * is an applicable advisory/condition when it is not retracted, not
 * superseded by a captured later edition of the same record (as of `now`),
 * and at least one of its scopes matches the exposure: the scope's
 * jurisdiction is one the Journey is exposed to (or the scope's subject is
 * the Journey/Traveller) with the scope's own exposure window overlapping
 * the matched exposure entry's window.
 *
 * Each applicable advisory is then run through the Journey's responsible
 * organisation(s) (`journey.responsibilityOrganisationId`, the Trip's
 * `businessContextOrganisationId`): rule assignments to that organisation
 * whose rule set `policyFamily` is `advisory_response`, resolved to the
 * pinned or current edition exactly as `m6.entry` resolves requirement
 * editions. Every rule in that edition whose expression is
 * `PREDICATE advisory.source_severity_in {severities, publisher_organisation_ids?}`
 * and matches this advisory's source severity (and publisher, when the
 * parameter is given) decides the response from the RULE's own severity:
 * MANDATORY/PROHIBITIVE ⇒ FAIL, ADVISORY ⇒ UNKNOWN, INFORMATIONAL ⇒ PASS.
 * An applicable advisory with no matching response rule is UNKNOWN
 * (UNSUPPORTED_EVALUATION) — legal feasibility is never waived and neither
 * is an unassessed risk. Conflicting publishers are never merged: every
 * applicable advisory from every publisher is reported on its own.
 *
 * No applicable advisory falls back to knowledge coverage: complete,
 * unexpired coverage of both topics for every exposed jurisdiction ⇒ PASS;
 * otherwise UNKNOWN. A place whose jurisdiction cannot be resolved can never
 * prove the traveller unaffected, so it always contributes its own UNKNOWN.
 */
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { Instant } from '../../../domain/v2/shared/time.ts';
import type { CausalExplanation, EvidenceRef, Uncertainty } from '../../../contracts/v2/assessment/explanation.ts';
import type { MissingCoverage } from '../../../contracts/v2/scope/readScope.ts';
import type { CapturedWorld, WCoverage, WInformationVersion, WJourney, WRuleSetVersion, WTrip } from '../../world/world.ts';
import type { EvaluationContext, Evaluator, EvaluatorOutput } from '../evaluator.ts';
import { dimension, earliestAfter, explain, notApplicable } from '../explain.ts';
import { jurisdictionsOfPlace, visitsOfJourney, within, type Tri } from '../encounters.ts';
import { coverageEvidence, coverageFor, retracted, supersededAt } from './entry.ts';

export const INFORMATION_EVALUATOR_ID = 'm6.information';
const DIMENSION = 'advisories';
const TOPICS = ['ADVISORY', 'CONDITION'] as const;
const RESPONSE_POLICY_FAMILY = 'advisory_response';
const SELECTABLE_EDITION_STATUSES: readonly string[] = ['PUBLISHED', 'SUPERSEDED'];
const RESPONSE_PREDICATE_ID = 'advisory.source_severity_in';

type Facts = Record<string, string | number | boolean | null>;
type Interval = { start: Instant | null; end: Instant | null };

const RESPONSE_SEVERITY_VERDICT: Readonly<Record<string, { status: Tri; reasonCode: string }>> = {
  MANDATORY: { status: 'FAIL', reasonCode: 'policy_requires_avoidance' },
  PROHIBITIVE: { status: 'FAIL', reasonCode: 'policy_requires_avoidance' },
  ADVISORY: { status: 'UNKNOWN', reasonCode: 'policy_requires_review' },
  INFORMATIONAL: { status: 'PASS', reasonCode: 'advisory_noted' },
};

function uniqueEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  return [...new Map(refs.map((r) => [`${r.kind}:${r.id}:${r.detail ?? ''}`, r])).values()].sort((a, b) =>
    `${a.kind}:${a.id}:${a.detail ?? ''}`.localeCompare(`${b.kind}:${b.id}:${b.detail ?? ''}`));
}

/** Half-open interval overlap; a null bound is open-ended (never the deciding side). */
function intervalsOverlap(a: Interval, b: Interval): boolean {
  const aStart = a.start === null ? -Infinity : Date.parse(a.start);
  const aEnd = a.end === null ? Infinity : Date.parse(a.end);
  const bStart = b.start === null ? -Infinity : Date.parse(b.start);
  const bEnd = b.end === null ? Infinity : Date.parse(b.end);
  return aStart < bEnd && bStart < aEnd;
}

/** ---- exposure -------------------------------------------------------------- */

interface ExposureEntry {
  jurisdictionId: string;
  window: Interval;
}

interface UnresolvedPlace {
  placeId: string;
  itemId: string;
}

interface Exposure {
  entries: ExposureEntry[];
  unresolved: UnresolvedPlace[];
}

function exposureOf(world: CapturedWorld, journey: WJourney, projected: { items: { active: boolean; startPlaceId: string | null; endPlaceId: string | null; start: { value: Instant | null }; end: { value: Instant | null }; itemRef: TypedRef }[] }): Exposure {
  const entries: ExposureEntry[] = [];
  const unresolved: UnresolvedPlace[] = [];

  for (const visit of visitsOfJourney(world, journey.id)) {
    entries.push({ jurisdictionId: visit.jurisdictionId, window: { start: visit.intended.start, end: visit.intended.end } });
  }

  for (const item of projected.items.filter((i) => i.active)) {
    const places = [...new Set([item.startPlaceId, item.endPlaceId].filter((p): p is string => p !== null))];
    const window: Interval = { start: item.start.value, end: item.end.value };
    for (const placeId of places) {
      const jurisdictions = jurisdictionsOfPlace(world, placeId);
      if (jurisdictions.length === 0) { unresolved.push({ placeId, itemId: item.itemRef.id }); continue; }
      for (const jurisdictionId of jurisdictions) entries.push({ jurisdictionId, window });
    }
  }

  return { entries, unresolved: [...new Map(unresolved.map((u) => [u.placeId, u])).values()].sort((a, b) => a.placeId.localeCompare(b.placeId)) };
}

/** ---- applicable advisories/conditions --------------------------------------- */

interface MatchedAdvisory {
  iv: WInformationVersion;
  jurisdictionIds: string[];
}

function applicableAdvisories(world: CapturedWorld, journey: WJourney, now: Instant, exposure: ExposureEntry[], boundaries: (Instant | null)[]): MatchedAdvisory[] {
  const journeyRef: TypedRef = { kind: 'JOURNEY', id: journey.id };
  const travellerRef: TypedRef = { kind: 'TRAVELLER', id: journey.travellerId };
  const out: MatchedAdvisory[] = [];

  const candidates = world.informationVersions
    .filter((iv) => iv.subtype === 'ADVISORY' || iv.subtype === 'CONDITION')
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const iv of candidates) {
    boundaries.push(iv.effective.start, iv.effective.end);
    if (retracted(world, iv) || supersededAt(world, iv, now)) continue;

    const matchedJurisdictions = new Set<string>();
    for (const scope of iv.scopes) {
      const subjectMatches = scope.subject !== null
        && ((scope.subject.kind === 'JOURNEY' && scope.subject.id === journeyRef.id) || (scope.subject.kind === 'TRAVELLER' && scope.subject.id === travellerRef.id));
      for (const e of exposure) {
        const jurisdictionMatches = scope.jurisdictionId !== null && scope.jurisdictionId === e.jurisdictionId;
        if (!jurisdictionMatches && !subjectMatches) continue;
        if (intervalsOverlap(scope.exposure, e.window)) matchedJurisdictions.add(e.jurisdictionId);
      }
    }
    if (matchedJurisdictions.size > 0) out.push({ iv, jurisdictionIds: [...matchedJurisdictions].sort() });
  }
  return out;
}

/** ---- organisation response --------------------------------------------------- */

interface ResponseEdition {
  edition: WRuleSetVersion;
  assignmentId: string;
  organisationId: string;
}

function responseEditionsFor(world: CapturedWorld, journey: WJourney, trip: WTrip | undefined, now: Instant, boundaries: (Instant | null)[]): ResponseEdition[] {
  const organisations = new Set([journey.responsibilityOrganisationId, trip?.businessContextOrganisationId].filter((o): o is string => typeof o === 'string'));
  const out: ResponseEdition[] = [];
  const assignments = world.ruleAssignments
    .filter((a) => a.organisationId !== null && organisations.has(a.organisationId))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const assignment of assignments) {
    const versions = world.ruleSetVersions.filter((v) => v.ruleSetId === assignment.ruleSetId);
    const pinned = assignment.ruleSetVersionId ? world.ruleSetVersions.find((v) => v.id === assignment.ruleSetVersionId) : undefined;
    const familyVersions = versions.filter((v) => v.policyFamily === RESPONSE_POLICY_FAMILY);
    if (assignment.ruleSetVersionId ? pinned && pinned.policyFamily !== RESPONSE_POLICY_FAMILY : versions.length > 0 && familyVersions.length === 0) continue;
    if (assignment.subject && !(assignment.subject.kind === 'JOURNEY' && assignment.subject.id === journey.id) && !(assignment.subject.kind === 'TRAVELLER' && assignment.subject.id === journey.travellerId)) continue;

    boundaries.push(assignment.valid.start, assignment.valid.end);
    if (!within(assignment.valid, now)) continue;
    if (assignment.populationPredicateId) continue;

    let edition: WRuleSetVersion | undefined;
    if (assignment.ruleSetVersionId) {
      edition = pinned;
    } else {
      const selectable = familyVersions.filter((v) => SELECTABLE_EDITION_STATUSES.includes(v.status));
      for (const v of selectable) boundaries.push(v.effective.start, v.effective.end);
      edition = selectable.filter((v) => within(v.effective, now)).sort((a, b) => b.editionNumber - a.editionNumber || a.id.localeCompare(b.id))[0];
    }
    if (edition && edition.policyFamily === RESPONSE_POLICY_FAMILY) out.push({ edition, assignmentId: assignment.id, organisationId: assignment.organisationId as string });
  }
  return out;
}

interface ResponseMatch {
  status: Tri;
  reasonCode: string;
  ruleId: string;
  ruleKey: string;
  organisationId: string;
  edition: WRuleSetVersion;
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string' && v.length > 0) ? [...value] as string[] : undefined;
}

function matchingResponses(re: ResponseEdition, iv: WInformationVersion): ResponseMatch[] {
  const out: ResponseMatch[] = [];
  for (const rule of re.edition.rules) {
    if (rule.expression.operator !== 'PREDICATE' || rule.expression.predicateId !== RESPONSE_PREDICATE_ID) continue;
    const parameters = rule.expression.parameters ?? {};
    const severities = stringList(parameters.severities);
    if (!severities) continue;
    if (iv.sourceNativeSeverity === null || !severities.includes(iv.sourceNativeSeverity)) continue;
    const publisherIds = stringList(parameters.publisher_organisation_ids);
    if (publisherIds && (iv.publisherOrganisationId === null || !publisherIds.includes(iv.publisherOrganisationId))) continue;
    const mapped = rule.severity !== null ? RESPONSE_SEVERITY_VERDICT[rule.severity] : undefined;
    if (!mapped) continue;
    out.push({ ...mapped, ruleId: rule.id, ruleKey: rule.ruleKey, organisationId: re.organisationId, edition: re.edition });
  }
  return out;
}

/** ---- coverage fallback -------------------------------------------------------- */

interface CoverageAcross {
  complete: boolean;
  records: WCoverage[];
  uncertainty: Uncertainty[];
}

function coverageAcrossExposure(world: CapturedWorld, jurisdictionIds: readonly string[], now: Instant, boundaries: (Instant | null)[], missingCoverage: MissingCoverage[]): CoverageAcross {
  let complete = true;
  const records: WCoverage[] = [];
  const uncertainty: Uncertainty[] = [];
  for (const topic of TOPICS) {
    for (const jurisdictionId of jurisdictionIds) {
      const cov = coverageFor(world, topic, jurisdictionId, now);
      records.push(...cov.records);
      for (const c of cov.records) boundaries.push(c.expiresAt);
      if (!cov.complete) {
        complete = false;
        uncertainty.push(...cov.uncertainty);
        missingCoverage.push({ subjectRef: { kind: 'JURISDICTION', id: jurisdictionId }, scopeDescription: `${topic} coverage for jurisdiction ${jurisdictionId}`, reason: 'SOURCE_INCOMPLETE' });
      }
    }
  }
  return { complete, records, uncertainty };
}

/** ---- evaluation --------------------------------------------------------------- */

function evaluate(subject: TypedRef, { now, world, effective }: EvaluationContext): EvaluatorOutput {
  const none = (): EvaluatorOutput => ({ dimensions: [notApplicable(DIMENSION)], evidence: [], missingCoverage: [] });
  if (subject.kind !== 'JOURNEY') return none();

  const journey = world.journeys.find((j) => j.id === subject.id);
  const projected = effective.journeys.find((j) => j.journeyRef.id === subject.id);
  if (!journey || !projected) {
    if (!world.intendedVisits.some((v) => v.journeyId === subject.id)) return none();
    const e = explain({
      evaluatorId: INFORMATION_EVALUATOR_ID, dimension: DIMENSION, status: 'UNKNOWN', reasonCode: 'journey_not_captured',
      cause: { kind: 'MISSING_INFORMATION', subjectRef: subject }, affectedSubject: subject,
      uncertainty: [{ kind: 'MISSING_INPUT', code: 'journey', subjectRef: subject }],
    });
    return { dimensions: [dimension({ dimension: DIMENSION, explanations: [e] })], evidence: [], missingCoverage: [] };
  }

  const travellerRef: TypedRef = { kind: 'TRAVELLER', id: journey.travellerId };
  const exposure = exposureOf(world, journey, projected);
  if (exposure.entries.length === 0 && exposure.unresolved.length === 0) return none();

  const boundaries: (Instant | null)[] = [];
  const missingCoverage: MissingCoverage[] = [];
  const explanations: CausalExplanation[] = [];

  for (const u of exposure.unresolved) {
    explanations.push(explain({
      evaluatorId: INFORMATION_EVALUATOR_ID, dimension: DIMENSION, status: 'UNKNOWN', reasonCode: 'exposure_jurisdiction_unresolved',
      cause: { kind: 'MISSING_INFORMATION', subjectRef: { kind: 'PLACE', id: u.placeId } }, affectedSubject: subject,
      relatedSubjects: [travellerRef, { kind: 'PLACE', id: u.placeId }, { kind: 'JOURNEY_ITEM', id: u.itemId }],
      facts: { placeId: u.placeId, itemId: u.itemId },
      uncertainty: [{ kind: 'UNRESOLVED_LOCATION', code: 'place_jurisdiction', subjectRef: { kind: 'PLACE', id: u.placeId } }],
    }));
  }

  const jurisdictionIds = [...new Set(exposure.entries.map((e) => e.jurisdictionId))].sort();
  const applicable = applicableAdvisories(world, journey, now, exposure.entries, boundaries);

  if (applicable.length === 0) {
    if (jurisdictionIds.length > 0) {
      const cov = coverageAcrossExposure(world, jurisdictionIds, now, boundaries, missingCoverage);
      const status: Tri = cov.complete ? 'PASS' : 'UNKNOWN';
      const reasonCode = cov.complete ? 'no_applicable_advisory_complete_coverage' : 'advisory_coverage_incomplete';
      explanations.push(explain({
        evaluatorId: INFORMATION_EVALUATOR_ID, dimension: DIMENSION, status, reasonCode,
        cause: { kind: status === 'PASS' ? 'REQUIREMENT' : 'MISSING_INFORMATION' }, affectedSubject: subject,
        relatedSubjects: [travellerRef, ...jurisdictionIds.map((id): TypedRef => ({ kind: 'JURISDICTION', id }))],
        evidenceRefs: coverageEvidence(cov.records),
        facts: { jurisdictionIds: jurisdictionIds.join(','), topics: TOPICS.join(',') },
        uncertainty: cov.uncertainty,
      }));
    }
  } else {
    const trip = world.trips.find((t) => t.id === journey.tripId);
    const responseEditions = responseEditionsFor(world, journey, trip, now, boundaries);

    for (const m of applicable) {
      const ivEvidence: EvidenceRef[] = [{ kind: 'INFORMATION_VERSION', id: m.iv.id }, { kind: 'EVIDENCE_RECORD', id: m.iv.evidenceId, detail: 'information_version' }];
      const ivRelated: TypedRef[] = [
        travellerRef,
        { kind: 'INFORMATION_VERSION', id: m.iv.id },
        ...m.jurisdictionIds.map((id): TypedRef => ({ kind: 'JURISDICTION', id })),
        ...(m.iv.publisherOrganisationId ? [{ kind: 'ORGANISATION' as const, id: m.iv.publisherOrganisationId }] : []),
      ];
      const ivFacts: Facts = {
        informationVersionId: m.iv.id, informationRecordId: m.iv.recordId, subtype: m.iv.subtype,
        sourceNativeSeverity: m.iv.sourceNativeSeverity, publisherOrganisationId: m.iv.publisherOrganisationId,
        matchedJurisdictionIds: m.jurisdictionIds.join(','),
      };

      const matches = [...new Map(
        responseEditions.flatMap((re) => matchingResponses(re, m.iv))
          .map((r) => [`${r.organisationId}:${r.edition.id}:${r.ruleId}`, r] as const),
      ).values()].sort((a, b) => `${a.organisationId}:${a.ruleId}`.localeCompare(`${b.organisationId}:${b.ruleId}`));

      if (matches.length === 0) {
        explanations.push(explain({
          evaluatorId: INFORMATION_EVALUATOR_ID, dimension: DIMENSION, status: 'UNKNOWN', reasonCode: 'advisory_response_policy_missing',
          cause: { kind: 'MISSING_INFORMATION', subjectRef: { kind: 'INFORMATION_VERSION', id: m.iv.id } }, affectedSubject: subject,
          relatedSubjects: ivRelated, evidenceRefs: ivEvidence, facts: ivFacts,
          uncertainty: [{ kind: 'UNSUPPORTED_EVALUATION', code: 'advisory_response_policy', subjectRef: travellerRef }],
        }));
        continue;
      }
      for (const match of matches) {
        explanations.push(explain({
          evaluatorId: INFORMATION_EVALUATOR_ID, dimension: DIMENSION, status: match.status, reasonCode: match.reasonCode,
          cause: { kind: 'REQUIREMENT', subjectRef: { kind: 'RULE_SET', id: match.edition.ruleSetId } }, affectedSubject: subject,
          relatedSubjects: [...ivRelated, { kind: 'ORGANISATION', id: match.organisationId }, { kind: 'RULE_SET', id: match.edition.ruleSetId }, match.edition.issuer],
          evidenceRefs: [...ivEvidence, { kind: 'RULE_SET_VERSION', id: match.edition.id }],
          facts: { ...ivFacts, organisationId: match.organisationId, ruleSetId: match.edition.ruleSetId, editionId: match.edition.id, ruleId: match.ruleId, ruleKey: match.ruleKey },
        }));
      }
    }
  }

  const evidence = uniqueEvidence(explanations.flatMap((e) => e.evidenceRefs));
  const uniqueMissing = [...new Map(missingCoverage.map((m) => [`${m.subjectRef?.id ?? ''}|${m.scopeDescription}`, m])).values()];
  const nextInvalidationAt = earliestAfter(now, boundaries);
  return {
    dimensions: [dimension({ dimension: DIMENSION, explanations })],
    evidence, missingCoverage: uniqueMissing,
    ...(nextInvalidationAt ? { nextInvalidationAt } : {}),
  };
}

export const informationEvaluator: Evaluator = {
  id: INFORMATION_EVALUATOR_ID,
  version: '1',
  assessmentKind: 'RISK',
  subjectKinds: ['JOURNEY'],
  dimensions: [DIMENSION],
  informationTopics: [...TOPICS],
  evaluate,
};
