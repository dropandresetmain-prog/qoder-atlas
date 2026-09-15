/**
 * Resolve arrival-to-commitment readiness minutes from authoritative
 * constraints / MIN_BUFFER policy — never from scenario constants.
 *
 * Applicability (Amendment A): REQUIRED engagements that declare a venue
 * placeId are treated as physical-presence commitments. No role-name list.
 */
import type { EntityId } from '../domain/common.ts';
import type { Constraint } from '../domain/constraints.ts';
import type { Engagement } from '../domain/elements.ts';
import type { PolicyRule, RuleSet } from '../domain/rules.ts';
import type { Trip } from '../domain/trip.ts';

/** True when the engagement is a REQUIRED physical-presence commitment. */
export function isRequiredPhysicalPresenceEngagement(engagement: Engagement): boolean {
  return engagement.importance === 'REQUIRED' && engagement.data.placeId !== undefined;
}

/**
 * Minutes required between inbound arrival evidence and engagement start.
 * Prefer a persisted TEMPORAL constraint bound to this engagement; otherwise
 * fall back to a programme-wide MIN_BUFFER rule when the engagement qualifies.
 */
export function resolveArrivalBufferMinutes(input: {
  engagement: Engagement;
  constraints?: readonly Constraint[];
  ruleSets?: readonly RuleSet[];
  governingRuleSetIds?: readonly EntityId[];
}): number | undefined {
  const fromConstraint = bufferMinutesFromConstraints(input.engagement, input.constraints ?? []);
  if (fromConstraint !== undefined) return fromConstraint;

  if (!isRequiredPhysicalPresenceEngagement(input.engagement)) return undefined;

  return bufferMinutesFromRuleSets(input.ruleSets ?? [], input.governingRuleSetIds);
}

function bufferMinutesFromConstraints(
  engagement: Engagement,
  constraints: readonly Constraint[],
): number | undefined {
  const matching = constraints.filter(
    (constraint) =>
      constraint.kind === 'TEMPORAL' &&
      constraint.refs.some((ref) => ref.id === engagement.id) &&
      typeof constraint.parameters?.['minBufferMinutes'] === 'number',
  );
  matching.sort((a, b) => a.id.localeCompare(b.id));
  const minutes = matching[0]?.parameters?.['minBufferMinutes'];
  return typeof minutes === 'number' && Number.isFinite(minutes) ? minutes : undefined;
}

export function bufferMinutesFromRuleSets(
  ruleSets: readonly RuleSet[],
  governingRuleSetIds?: readonly EntityId[],
): number | undefined {
  const scoped =
    governingRuleSetIds && governingRuleSetIds.length > 0
      ? ruleSets.filter((ruleSet) => governingRuleSetIds.includes(ruleSet.id))
      : [...ruleSets];
  scoped.sort((a, b) => a.id.localeCompare(b.id));
  for (const ruleSet of scoped) {
    const readiness = ruleSet.rules
      .filter(
        (rule): rule is Extract<PolicyRule, { kind: 'PROGRAMME_ARRIVAL_READINESS' }> =>
          rule.kind === 'PROGRAMME_ARRIVAL_READINESS' && rule.appliesTo.length === 0,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    if (readiness[0]) {
      return readiness[0].buffer.minimumMinutes ?? readiness[0].buffer.expectedMinutes;
    }
    const candidates = ruleSet.rules
      .filter(
        (rule): rule is Extract<PolicyRule, { kind: 'MIN_BUFFER' }> =>
          rule.kind === 'MIN_BUFFER' && rule.appliesTo.length === 0,
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    const rule = candidates[0];
    if (rule) {
      return rule.buffer.minimumMinutes ?? rule.buffer.expectedMinutes;
    }
  }
  return undefined;
}

/** Governing rule-set ids attached to the trip (deterministic order). */
export function tripGoverningRuleSetIds(trip: Trip): EntityId[] {
  return [...trip.governedByRuleSetIds].sort((a, b) => a.localeCompare(b));
}
