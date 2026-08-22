/**
 * D2 — structured semantic interpretation over the D1 Model Studio client
 * (FR-03, FR-17).
 *
 * Precedence (deterministic, mirrors ADR-014):
 *   EXPLICIT instruction > explicit trip preference > explicit persistent
 *   preference > latent inference. Latent preferences remain soft signals.
 *
 * Hard rules enforced here, regardless of model classification:
 * - accessibility is a REQUIREMENT, never merely a latent preference;
 * - legal/entry facts require authoritative-source evidence elsewhere in the
 *   pipeline; semantics never fabricates them;
 * - operational estimates and semantic consequence judgments retain their
 *   uncertainty;
 * - insufficient evidence yields explicit UNKNOWN/absence, never fabrication.
 */
import { z } from 'zod';
import type { IsoDateTime, UncertaintyRecord } from '../domain/common.ts';
import {
  PREFERENCE_PRECEDENCE,
  type Preference,
  type PreferenceOriginKind,
} from '../domain/preferences.ts';
import { newId } from '../util/ids.ts';
import type { ModelCallMeta, ModelCallResult, ModelError, ModelStudioClient, ModelTask } from './client.ts';
import {
  ConsequenceAssessmentsModelSchema,
  type ConsequenceAssessmentModel,
  ExplicitInstructionsModelSchema,
  type ExplicitInstructionModel,
  LatentPreferenceCandidatesModelSchema,
  type PreferenceCandidateModel,
  ObjectiveInterpretationModelSchema,
  UncertaintyIdentificationModelSchema,
} from './schemas.ts';

export type IntelligenceResult<T> =
  | { ok: true; value: T; meta: ModelCallMeta }
  | { ok: false; error: ModelError; meta: ModelCallMeta };

export interface InterpretedObjective {
  objective?: string;
  explicit: boolean;
  originKind?: PreferenceOriginKind;
  ambiguities: string[];
  insufficientEvidence: boolean;
}

export interface ResolvedPreference {
  /** Deterministically ranked: highest precedence first. */
  rankedPreferences: Preference[];
  /** Accessibility/legal items reclassified out of the preference track. */
  requirementStatements: string[];
  /** Latent statements that conflict with a dominating explicit statement. */
  conflicts: string[];
}

export interface SemanticServiceOptions {
  client: ModelStudioClient;
  idFactory?: (prefix: string) => string;
}

export class SemanticService {
  private readonly client: ModelStudioClient;
  private readonly idFactory: (prefix: string) => string;

  constructor(options: SemanticServiceOptions) {
    this.client = options.client;
    this.idFactory = options.idFactory ?? newId;
  }

  async interpretObjective(rawText: string): Promise<IntelligenceResult<InterpretedObjective>> {
    return this.callTask({
      id: 'semantics_objective',
      systemPrompt: OBJECTIVE_SYSTEM_PROMPT,
      userPrompt: `Interpret the objective in this text:\n${rawText}`,
      schema: ObjectiveInterpretationModelSchema,
    });
  }

  async interpretExplicitInstructions(rawText: string): Promise<IntelligenceResult<ExplicitInstructionModel[]>> {
    const result = await this.callTask({
      id: 'semantics_explicit_instructions',
      systemPrompt: EXPLICIT_INSTRUCTION_SYSTEM_PROMPT,
      userPrompt: `Extract explicit instructions from this text:\n${rawText}`,
      schema: ExplicitInstructionsModelSchema,
    });
    if (!result.ok) return result;
    return { ok: true, value: result.value.instructions, meta: result.meta };
  }

  async inferLatentPreferenceCandidates(
    tripContextText: string,
    profileContextText?: string,
  ): Promise<IntelligenceResult<{ candidates: PreferenceCandidateModel[]; requirementStatements: string[] }>> {
    const result = await this.callTask({
      id: 'semantics_latent_preferences',
      systemPrompt: LATENT_PREFERENCE_SYSTEM_PROMPT,
      userPrompt: `Trip context:\n${tripContextText}\n\nProfile context:\n${profileContextText ?? '(none)'}`,
      schema: LatentPreferenceCandidatesModelSchema,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      value: { candidates: result.value.candidates, requirementStatements: result.value.requirementStatements },
      meta: result.meta,
    };
  }

  async assessConsequences(contextText: string): Promise<IntelligenceResult<ConsequenceAssessmentModel[]>> {
    const result = await this.callTask({
      id: 'semantics_consequences',
      systemPrompt: CONSEQUENCE_SYSTEM_PROMPT,
      userPrompt: `Assess the semantic consequences of this situation:\n${contextText}`,
      schema: ConsequenceAssessmentsModelSchema,
    });
    if (!result.ok) return result;
    return { ok: true, value: result.value.assessments, meta: result.meta };
  }

  async identifyUncertainties(contextText: string): Promise<IntelligenceResult<UncertaintyRecord[]>> {
    const result = await this.callTask({
      id: 'semantics_uncertainties',
      systemPrompt: UNCERTAINTY_SYSTEM_PROMPT,
      userPrompt: `Identify what remains uncertain in this situation:\n${contextText}`,
      schema: UncertaintyIdentificationModelSchema,
    });
    if (!result.ok) return result;
    const records = result.value.uncertainties.map((u): UncertaintyRecord => ({
      id: this.idFactory('unc'),
      statement: u.statement,
      aboutRefs: u.aboutRef !== undefined ? [u.aboutRef] : [],
      severity: u.severity,
    }));
    return { ok: true, value: records, meta: result.meta };
  }

  private async callTask<T>(task: ModelTask<T>): Promise<IntelligenceResult<T>> {
    const result: ModelCallResult<T> = await this.client.call(task);
    if (!result.ok) return { ok: false, error: result.error, meta: result.meta };
    return { ok: true, value: result.value, meta: result.meta };
  }
}

/**
 * Deterministic preference resolution (no model call): ranks explicit over
 * latent using the frozen precedence, reclassifies accessibility/legal
 * candidates as requirements, and records latent-vs-explicit conflicts.
 *
 * `issuedAt` comes from the caller (ingestion timestamp); semantics never
 * fabricates timestamps.
 */
export function resolvePreferences(
  candidates: PreferenceCandidateModel[],
  options: { travellerId: string; sourceId: string; issuedAt: IsoDateTime; explicitStatements?: string[] },
): ResolvedPreference {
  const requirementStatements: string[] = [];
  const latentCandidates: PreferenceCandidateModel[] = [];
  for (const candidate of candidates) {
    if (candidate.classification !== 'COMFORT_PREFERENCE') {
      requirementStatements.push(candidate.statement);
    } else {
      latentCandidates.push(candidate);
    }
  }

  const explicitStatements = options.explicitStatements ?? [];
  const rankedPreferences: Preference[] = [
    ...explicitStatements.map(
      (statement, index): Preference => ({
        id: `pref_explicit_${index + 1}`,
        travellerId: options.travellerId,
        statement,
        origin: { kind: 'EXPLICIT_INSTRUCTION', issuedAt: options.issuedAt, issuedBy: options.sourceId },
        status: 'ACTIVE',
        sourceId: options.sourceId,
      }),
    ),
    ...latentCandidates.map(
      (candidate, index): Preference => ({
        id: `pref_latent_${index + 1}`,
        travellerId: options.travellerId,
        statement: candidate.statement,
        origin: {
          kind: 'LATENT_INFERRED',
          evidence: candidate.evidence,
          confidence: candidate.confidence,
          inferredAt: options.issuedAt,
        },
        status: 'ACTIVE',
        sourceId: options.sourceId,
      }),
    ),
  ];
  rankedPreferences.sort((a, b) => PREFERENCE_PRECEDENCE[b.origin.kind] - PREFERENCE_PRECEDENCE[a.origin.kind]);

  const conflicts: string[] = [];
  for (const candidate of latentCandidates) {
    if (candidate.conflictsWith.length > 0) {
      conflicts.push(candidate.statement);
    }
  }

  return { rankedPreferences, requirementStatements, conflicts };
}

/**
 * Deterministic interpretation of already-sourced research findings
 * (ADR-015): legal facts without authoritative sourcing are excluded and
 * surfaced as uncertainty, never accepted, and operational estimates keep
 * their uncertainty. `decisions` is aligned index-by-index with the input.
 */
export interface ResearchFindingDecision {
  accepted: boolean;
  /** Present when a finding was not accepted as stated. */
  reason?: string;
}

export function interpretResearchFindings(
  findings: Array<{
    statement: string;
    kind: 'LEGAL_ENTRY_FACT' | 'OPERATIONAL_ESTIMATE';
    authorityClaim: 'AUTHORITATIVE' | 'CONNECTED' | 'ASSERTED' | 'INFERRED';
    sourceUris: string[];
    uncertainty?: string;
  }>,
): {
  decisions: ResearchFindingDecision[];
  accepted: string[];
  excludedStatements: string[];
  uncertainties: string[];
} {
  const decisions: ResearchFindingDecision[] = [];
  const accepted: string[] = [];
  const excludedStatements: string[] = [];
  const uncertainties: string[] = [];
  for (const finding of findings) {
    if (finding.kind === 'LEGAL_ENTRY_FACT') {
      if (finding.authorityClaim === 'AUTHORITATIVE' && finding.sourceUris.length > 0) {
        accepted.push(finding.statement);
        decisions.push({ accepted: true });
      } else {
        const reason = 'legal/entry claim requires authoritative sourcing';
        excludedStatements.push(finding.statement);
        uncertainties.push(`${reason}: ${finding.statement}`);
        decisions.push({ accepted: false, reason });
      }
    } else {
      accepted.push(finding.statement);
      decisions.push({ accepted: true });
      if (finding.uncertainty !== undefined) uncertainties.push(finding.uncertainty);
    }
  }
  return { decisions, accepted, excludedStatements, uncertainties };
}

const OBJECTIVE_SYSTEM_PROMPT = `You extract a traveller/operator objective from possibly messy text.
Respond with a single JSON object matching the required schema.
If the text contains no recoverable objective, set insufficientEvidence=true and omit objective.
Never invent objectives the text does not support. Record ambiguities instead of guessing.`;

const EXPLICIT_INSTRUCTION_SYSTEM_PROMPT = `You extract explicit instructions (direct requests or commands) from text.
Respond with a single JSON object matching the required schema.
Only explicit statements count: preferences or hints are not instructions.
If no explicit instruction exists, return an empty instructions array or an entry with none=true.`;

const LATENT_PREFERENCE_SYSTEM_PROMPT = `You infer preference candidates from trip and traveller-profile context.
Classify each candidate:
- COMFORT_PREFERENCE for ordinary soft preferences;
- ACCESSIBILITY_REQUIREMENT for accessibility needs;
- LEGAL_OR_ENTRY_REQUIREMENT for legal, visa or entry-rule matters.
Accessibility and legal/entry items are requirements, never latent preferences.
Latent inferences must cite observable evidence and keep confidence honest.
If evidence is insufficient, omit the candidate rather than fabricate it.`;

const CONSEQUENCE_SYSTEM_PROMPT = `You assess the semantic consequences of a travel disruption or change.
Respond with a single JSON object matching the required schema.
Keep every judgment as an estimate with uncertainty where evidence is incomplete.
Never present an operational estimate as a verified fact.`;

const UNCERTAINTY_SYSTEM_PROMPT = `You identify what remains uncertain in a travel recovery situation.
Respond with a single JSON object matching the required schema.
Only list genuine unknowns or stale/missing evidence; never convert them into guesses.
If nothing is uncertain, return an empty uncertainties array.`;

export const SEMANTICS_TASK_SCHEMAS = {
  objective: ObjectiveInterpretationModelSchema,
  explicitInstructions: ExplicitInstructionsModelSchema,
  latentPreferences: LatentPreferenceCandidatesModelSchema,
  consequences: ConsequenceAssessmentsModelSchema,
  uncertainties: UncertaintyIdentificationModelSchema,
} satisfies Record<string, z.ZodType<unknown>>;
