/**
 * NORTHSTAR M6 — `m6.credentials`: credential selection per intended visit
 * (M6_EVALUATOR_CONTRACT.md §2 L4). Dimension `credential_selection` (B).
 *
 * Decides whether the credential editions the Journey selected for each
 * intended visit are a presentable, consistent document set — owned by the
 * traveller, the selected edition of that credential, not revoked/suspended,
 * valid through the visit, one passport per visit, the same passport for the
 * same jurisdiction, and every visa/e-authorisation linked to the selected
 * passport. It does not decide legal entry (that is `m6.entry`).
 *
 * The subject registry has no credential / intended-visit kinds, so their ids
 * are carried as typed facts and the credential evidence as EVIDENCE_RECORD
 * refs; relatedSubjects name the Traveller and the visited Jurisdiction.
 */
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { CausalExplanation, EvidenceRef, Uncertainty } from '../../../contracts/v2/assessment/explanation.ts';
import type { WCredentialSelection } from '../../world/world.ts';
import type { EvaluationContext, Evaluator, EvaluatorOutput } from '../evaluator.ts';
import { dimension, explain, notApplicable } from '../explain.ts';
import {
  dateOnOrAfterLocalDate,
  ENTRY_AUTHORISATION_KINDS,
  EXPIRY_REQUIRED_KINDS,
  IDENTITY_DOCUMENT_KIND,
  linkToPassports,
  resolveSelection,
  selectionsForVisit,
  usableSelection,
  visitsOfJourney,
} from '../encounters.ts';

export const CREDENTIALS_EVALUATOR_ID = 'm6.credentials';
const DIMENSION = 'credential_selection';

type Facts = Record<string, string | number | boolean | null>;

function uniqueEvidence(refs: EvidenceRef[]): EvidenceRef[] {
  return [...new Map(refs.map((r) => [`${r.kind}:${r.id}:${r.detail ?? ''}`, r])).values()].sort((a, b) => `${a.kind}:${a.id}:${a.detail ?? ''}`.localeCompare(`${b.kind}:${b.id}:${b.detail ?? ''}`));
}

function evaluate(subject: TypedRef, { world }: EvaluationContext): EvaluatorOutput {
  if (subject.kind !== 'JOURNEY') return { dimensions: [notApplicable(DIMENSION)], evidence: [], missingCoverage: [] };
  const journey = world.journeys.find((j) => j.id === subject.id);
  const visits = visitsOfJourney(world, subject.id);
  const base = () => ({ evaluatorId: CREDENTIALS_EVALUATOR_ID, dimension: DIMENSION, affectedSubject: subject });

  if (!journey) {
    if (visits.length === 0) return { dimensions: [notApplicable(DIMENSION)], evidence: [], missingCoverage: [] };
    const e = explain({
      ...base(), status: 'UNKNOWN', reasonCode: 'journey_not_captured', cause: { kind: 'MISSING_INFORMATION', subjectRef: subject },
      uncertainty: [{ kind: 'MISSING_INPUT', code: 'journey', subjectRef: subject }],
    });
    return { dimensions: [dimension({ dimension: DIMENSION, explanations: [e] })], evidence: [], missingCoverage: [] };
  }
  if (visits.length === 0) return { dimensions: [notApplicable(DIMENSION)], evidence: [], missingCoverage: [] };

  const travellerRef: TypedRef = { kind: 'TRAVELLER', id: journey.travellerId };
  const explanations: CausalExplanation[] = [];
  /** jurisdiction -> visitId -> selected passport credential ids */
  const passportsByJurisdiction = new Map<string, Map<string, string[]>>();

  for (const visit of visits) {
    const jurisdictionRef: TypedRef = { kind: 'JURISDICTION', id: visit.jurisdictionId };
    const visitFacts: Facts = { visitId: visit.id, jurisdictionId: visit.jurisdictionId, visitStart: visit.intended.start, visitEnd: visit.intended.end, transitIntent: visit.transitIntent };
    const push = (status: 'PASS' | 'FAIL' | 'UNKNOWN', reasonCode: string, facts: Facts, extra: { evidence?: EvidenceRef[]; uncertainty?: Uncertainty[]; cause?: CausalExplanation['cause'] } = {}) => {
      explanations.push(explain({
        ...base(), status, reasonCode,
        cause: extra.cause ?? { kind: status === 'UNKNOWN' ? 'MISSING_INFORMATION' : 'WORLD_STATE', subjectRef: travellerRef },
        relatedSubjects: [travellerRef, jurisdictionRef],
        evidenceRefs: extra.evidence ?? [],
        facts: { ...visitFacts, ...facts },
        uncertainty: extra.uncertainty ?? [],
      }));
    };

    const selections = selectionsForVisit(world, journey.id, visit.id);
    if (selections.length === 0) {
      push('UNKNOWN', 'credential_selection_missing', {}, { uncertainty: [{ kind: 'MISSING_INPUT', code: 'credential_selection', subjectRef: subject }] });
      continue;
    }

    const resolved = selections.map((s) => resolveSelection(world, s));
    for (const r of resolved) {
      const sel: WCredentialSelection = r.selection;
      const facts: Facts = { selectionId: sel.id, credentialId: sel.credentialId, credentialVersionId: sel.credentialVersionId, credentialKind: r.credential?.kind ?? null, expiryDate: r.version?.expiryDate ?? null, issuerStatus: r.version?.issuerStatus ?? null };
      const evidence: EvidenceRef[] = r.version?.evidenceId ? [{ kind: 'EVIDENCE_RECORD', id: r.version.evidenceId, detail: 'credential_version' }] : [];
      if (!r.credential || !r.version) {
        push('UNKNOWN', 'credential_not_captured', facts, { uncertainty: [{ kind: 'MISSING_INPUT', code: 'credential_version', subjectRef: travellerRef }] });
        continue;
      }
      let issues = 0;
      if (r.credential.travellerId !== journey.travellerId) { push('FAIL', 'credential_not_travellers', { ...facts, credentialTravellerId: r.credential.travellerId }, { evidence }); issues += 1; }
      if (r.version.credentialId !== r.credential.id) { push('FAIL', 'version_mismatch', { ...facts, versionCredentialId: r.version.credentialId }, { evidence }); issues += 1; }
      if (r.version.issuerStatus === 'REVOKED' || r.version.issuerStatus === 'SUSPENDED') { push('FAIL', 'credential_not_valid', facts, { evidence }); issues += 1; }
      else if (r.version.issuerStatus !== 'VALID') {
        push('UNKNOWN', 'credential_status_unknown', facts, { evidence, uncertainty: [{ kind: 'MISSING_INPUT', code: 'credential_issuer_status', subjectRef: travellerRef }] });
        issues += 1;
      }
      if (r.version.expiryDate === null) {
        if (EXPIRY_REQUIRED_KINDS.includes(r.credential.kind)) {
          push('UNKNOWN', 'credential_expiry_unknown', facts, { evidence, uncertainty: [{ kind: 'MISSING_INPUT', code: 'credential_expiry', subjectRef: travellerRef }] });
          issues += 1;
        }
      } else {
        // Valid through the visit: expiry date not before the visit's end date.
        const through = dateOnOrAfterLocalDate(r.version.expiryDate, visit.intended.end);
        if (through === 'FAIL') { push('FAIL', 'credential_expires_during_visit', facts, { evidence, cause: { kind: 'CLOCK', subjectRef: travellerRef } }); issues += 1; }
        else if (through === 'UNKNOWN') {
          push('UNKNOWN', 'local_date_ambiguous', facts, { evidence, uncertainty: [{ kind: 'MISSING_INPUT', code: 'local_validity_date', subjectRef: travellerRef }] });
          issues += 1;
        }
      }
      if (issues === 0) push('PASS', 'credential_valid_for_visit', facts, { evidence });
    }

    const usable = resolved.filter((r) => usableSelection(r, journey.travellerId));
    const passports = usable.filter((r) => r.credential.kind === IDENTITY_DOCUMENT_KIND);
    const passportIds = [...new Set(passports.map((p) => p.credential.id))].sort();
    if (passportIds.length > 1) {
      push('FAIL', 'ambiguous_identity_document', { selectedPassportCount: passportIds.length, selectedPassportCredentialIds: passportIds.join(',') });
    }
    if (passportIds.length > 0) {
      const byVisit = passportsByJurisdiction.get(visit.jurisdictionId) ?? new Map<string, string[]>();
      byVisit.set(visit.id, passportIds);
      passportsByJurisdiction.set(visit.jurisdictionId, byVisit);
    }

    for (const authorisation of usable.filter((r) => ENTRY_AUTHORISATION_KINDS.includes(r.credential.kind))) {
      const link = linkToPassports(world, journey.travellerId, authorisation.credential.id, passportIds, visit.intended.start, visit.intended.end);
      const facts: Facts = { credentialId: authorisation.credential.id, credentialVersionId: authorisation.version.id, credentialKind: authorisation.credential.kind, selectedPassportCredentialIds: passportIds.join(','), linkCount: link.links.length };
      const evidence: EvidenceRef[] = [
        ...(authorisation.version.evidenceId ? [{ kind: 'EVIDENCE_RECORD' as const, id: authorisation.version.evidenceId, detail: 'credential_version' }] : []),
        ...link.links.map((l) => ({ kind: 'EVIDENCE_RECORD' as const, id: l.evidenceId, detail: 'credential_link' })),
      ];
      if (link.status === 'FAIL') push('FAIL', 'visa_not_linked_to_selected_passport', facts, { evidence });
      else if (link.status === 'UNKNOWN') push('UNKNOWN', 'local_date_ambiguous', facts, { evidence, uncertainty: [{ kind: 'MISSING_INPUT', code: 'local_validity_date', subjectRef: travellerRef }] });
      else push('PASS', 'visa_linked_to_selected_passport', facts, { evidence });
    }
  }

  for (const [jurisdictionId, byVisit] of [...passportsByJurisdiction.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sets = [...byVisit.entries()].sort(([a], [b]) => a.localeCompare(b));
    const distinct = [...new Set(sets.map(([, ids]) => ids.join(',')))];
    if (sets.length > 1 && distinct.length > 1) {
      const jurisdictionRef: TypedRef = { kind: 'JURISDICTION', id: jurisdictionId };
      explanations.push(explain({
        evaluatorId: CREDENTIALS_EVALUATOR_ID, dimension: DIMENSION, status: 'FAIL', reasonCode: 'inconsistent_passport_across_encounters',
        cause: { kind: 'WORLD_STATE', subjectRef: travellerRef }, affectedSubject: subject, relatedSubjects: [travellerRef, jurisdictionRef],
        facts: {
          jurisdictionId, visitCount: sets.length,
          ...Object.fromEntries(sets.flatMap(([visitId, ids], index) => [[`visit.${index}.visitId`, visitId], [`visit.${index}.passportCredentialIds`, ids.join(',')]])),
        },
      }));
    }
  }

  const evidence = uniqueEvidence(explanations.flatMap((e) => e.evidenceRefs));
  return { dimensions: [dimension({ dimension: DIMENSION, explanations })], evidence, missingCoverage: [] };
}

export const credentialsEvaluator: Evaluator = {
  id: CREDENTIALS_EVALUATOR_ID,
  version: '1',
  assessmentKind: 'VIABILITY',
  subjectKinds: ['JOURNEY'],
  dimensions: [DIMENSION],
  informationTopics: [],
  evaluate,
};
