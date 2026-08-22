/**
 * B2 — rule-set normalization for policy/insurance/supplier/entry documents.
 *
 * Model-extracted rule drafts are individually validated against the frozen
 * PolicyRule vocabulary; an invalid draft becomes an uncertainty record, never
 * a silently dropped or coerced rule. Rule sets keep source linkage on both
 * the set and every rule (FR-14, FR-18).
 */
import { z } from 'zod';
import type { SourceKind } from '../domain/common.ts';
import {
  PolicyRuleSchema,
  RuleSetSchema,
  type RuleSet,
  type RuleSetKind,
} from '../domain/rules.ts';
import {
  addUncertainty,
  emptyArtifacts,
  type IngestionArtifacts,
  type NormalizationEnv,
} from './artifacts.ts';
import { hashId } from './ids.ts';
import { normalizeRuleDraftTemporals } from './temporal.ts';
import type { ExtractedInsurance, ExtractedRuleSet } from './semantic.ts';

/**
 * Deterministic RuleSet-kind fallback per source class when extraction does
 * not state a kind. This is a source-class ladder, not scenario semantics.
 */
export const RULE_SET_KIND_FALLBACK: Record<SourceKind, RuleSetKind> = {
  WEBPAGE: 'EVENT',
  EMAIL: 'OTHER',
  DOCUMENT: 'OTHER',
  BOOKING_CONFIRMATION: 'SUPPLIER',
  POLICY_DOCUMENT: 'ORGANISATION',
  INSURANCE_DOCUMENT: 'INSURANCE',
  PROFILE: 'OTHER',
  PROVIDER_STATE: 'OTHER',
  RESEARCH: 'ENTRY',
  MANUAL: 'OTHER',
};

/**
 * Assign deterministic ids to a rule-set draft and validate against the frozen
 * schema. ids derive from source + name + kind (+ rule position/kind), so
 * re-ingesting the same document is idempotent.
 */
export function buildRuleSetWithIds(
  env: NormalizationEnv,
  draft: {
    kind: RuleSetKind;
    name: string;
    ownerOrganisationId?: string;
    rules: Array<Record<string, unknown>>;
  },
): { ruleSet?: RuleSet; issues: string[] } {
  const candidate = {
    id: hashId('ruleset', env.source.id, draft.name, draft.kind),
    kind: draft.kind,
    name: draft.name,
    ...(draft.ownerOrganisationId ? { ownerOrganisationId: draft.ownerOrganisationId } : {}),
    sourceId: env.source.id,
    rules: draft.rules.map((rule, index) => ({
      ...rule,
      id: hashId('rule', env.source.id, draft.name, String(index), String(rule['kind'] ?? '')),
      sourceId: env.source.id,
    })),
  };
  const parsed = RuleSetSchema.safeParse(candidate);
  if (parsed.success) return { ruleSet: parsed.data, issues: [] };
  return { issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

/**
 * Validate rule drafts individually; valid drafts become the rule set and
 * invalid drafts become explicit uncertainty. Returns undefined (with an
 * uncertainty recorded) when nothing valid remains.
 */
export function ruleDraftsToRuleSet(
  env: NormalizationEnv,
  artifacts: IngestionArtifacts,
  draft: {
    kind: RuleSetKind;
    name: string;
    ownerOrganisationId?: string;
    rules: Array<Record<string, unknown>>;
  },
): RuleSet | undefined {
  const validRules: Array<Record<string, unknown>> = [];
  for (const rule of draft.rules) {
    // Deterministic temporal normalization before promotion (ADR-040):
    // naive/unnormalized temporals without an explicit timezone context stay
    // invalid and become uncertainty — model sloppiness is never promoted.
    const normalizedRule = normalizeRuleDraftTemporals(rule, env.context.timezone);
    // Pre-validate with the same deterministic ids buildRuleSetWithIds assigns.
    const candidate = {
      ...normalizedRule,
      id: hashId('rule', env.source.id, draft.name, String(validRules.length), String(normalizedRule['kind'] ?? '')),
      sourceId: env.source.id,
    };
    const parsed = PolicyRuleSchema.safeParse(candidate);
    if (parsed.success) {
      validRules.push(normalizedRule);
    } else {
      addUncertainty(
        artifacts,
        env,
        `Policy rule draft failed validation and was not turned into a rule: ${formatIssues(parsed.error)}`,
        'MEDIUM',
      );
    }
  }
  if (validRules.length === 0) {
    addUncertainty(
      artifacts,
      env,
      `No valid rules could be extracted for rule set "${draft.name}"`,
      'MEDIUM',
    );
    return undefined;
  }
  const { ruleSet, issues } = buildRuleSetWithIds(env, { ...draft, rules: validRules });
  if (!ruleSet) {
    addUncertainty(artifacts, env, `Rule set "${draft.name}" failed validation: ${issues.join('; ')}`, 'HIGH');
    return undefined;
  }
  return ruleSet;
}

/** Organization/event policy documents -> validated RuleSet artifacts. */
export function normalizeExtractedRuleSet(
  env: NormalizationEnv,
  extracted: ExtractedRuleSet,
): IngestionArtifacts {
  const artifacts = emptyArtifacts();
  const kind = extracted.kind ?? RULE_SET_KIND_FALLBACK[env.source.kind];
  const name = extracted.name ?? env.source.title ?? 'Policy';
  const ruleSet = ruleDraftsToRuleSet(env, artifacts, {
    kind,
    name,
    ownerOrganisationId: extracted.ownerOrganisationId ?? env.context.organisationId,
    rules: extracted.rules,
  });
  if (ruleSet) artifacts.ruleSets.push(ruleSet);
  return artifacts;
}

/**
 * Insurance documents -> INSURANCE RuleSet with an INSURANCE_COVERAGE rule
 * (FR-18: insurance ingested as data, clauses never hardcoded).
 */
export function normalizeExtractedInsurance(
  env: NormalizationEnv,
  extracted: ExtractedInsurance,
): IngestionArtifacts {
  const artifacts = emptyArtifacts();
  if (extracted.coveredReasons.length === 0) {
    addUncertainty(
      artifacts,
      env,
      'Insurance document extracted without any covered reasons; coverage scope is UNKNOWN',
      'MEDIUM',
    );
  }
  const name = extracted.name ?? env.source.title ?? 'Insurance policy';
  const rule: Record<string, unknown> = {
    kind: 'INSURANCE_COVERAGE',
    coveredReasons: extracted.coveredReasons,
  };
  if (extracted.excess) rule['excess'] = extracted.excess;
  if (extracted.maxPayout) rule['maxPayout'] = extracted.maxPayout;
  const ruleSet = ruleDraftsToRuleSet(env, artifacts, { kind: 'INSURANCE', name, rules: [rule] });
  if (ruleSet) artifacts.ruleSets.push(ruleSet);
  return artifacts;
}
