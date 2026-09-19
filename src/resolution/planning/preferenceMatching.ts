/**
 * G09 — deterministic preference satisfaction. Pure. A comparator preference may
 * carry a data-defined `match` (domains / proposer ids / changed-ref kinds); a candidate
 * "satisfies" it iff every listed criterion holds for the candidate's decision
 * evidence. A preference with no matcher never affects ranking. No model, no
 * scenario branch: the codes returned feed `CandidateComparisonFacts`, and the
 * comparator's precedence (explicit before inferred) does the rest.
 */
import type { ComparatorPreference } from '../../contracts/v2/planning/strategyRecommendation.ts';
import type { MaterialCandidateEvidence } from '../../contracts/v2/planning/recoveryPlanningAttempt.ts';

export function satisfiedPreferenceCodes(
  candidate: Pick<MaterialCandidateEvidence, 'domainId' | 'immediateChangeBlastRadius'> & { proposerId?: string },
  preferences: readonly ComparatorPreference[],
): string[] {
  const changedKinds = new Set((candidate.immediateChangeBlastRadius?.changedRefs ?? []).map((ref) => ref.kind));
  const satisfied: string[] = [];
  for (const pref of preferences) {
    const match = pref.match;
    if (!match) continue;
    const hasCriteria = (match.domains?.length ?? 0) > 0 || (match.changedRefKinds?.length ?? 0) > 0 || (match.proposerIds?.length ?? 0) > 0;
    if (!hasCriteria) continue;
    if (match.domains && match.domains.length > 0 && !match.domains.includes(candidate.domainId)) continue;
    if (match.proposerIds && match.proposerIds.length > 0 && !(candidate.proposerId !== undefined && match.proposerIds.includes(candidate.proposerId))) continue;
    if (match.changedRefKinds && match.changedRefKinds.length > 0 && !match.changedRefKinds.some((k) => changedKinds.has(k as never))) continue;
    if (!satisfied.includes(pref.code)) satisfied.push(pref.code);
  }
  return satisfied;
}
