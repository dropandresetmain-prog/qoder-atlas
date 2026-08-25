/**
 * Generic scenario-run evidence artifact.
 *
 * Distinguishes simulated event sources from real downstream provider
 * execution. Scenario IDs appear only as orchestration metadata.
 */
import { z } from 'zod';
import { EntityIdSchema, IsoDateTimeSchema } from '../domain/common.ts';
import { ScenarioExecutionModeSchema } from './modes.ts';

export const EvidenceProvenanceSchema = z.strictObject({
  mode: ScenarioExecutionModeSchema,
  /** True when this seam is an approved simulated external ingress. */
  simulatedExternal: z.boolean(),
  source: z.string().min(1),
  providerId: z.string().optional(),
  recordingId: z.string().optional(),
  recordedAt: IsoDateTimeSchema.optional(),
});
export type EvidenceProvenance = z.infer<typeof EvidenceProvenanceSchema>;

export const EvidenceExternalCallSchema = z.strictObject({
  stepId: z.string(),
  operation: z.string(),
  requestSummary: z.unknown().optional(),
  responseRef: z.string().optional(),
  provenance: EvidenceProvenanceSchema,
  ok: z.boolean(),
  status: z.number().optional(),
  latencyMs: z.number().optional(),
});
export type EvidenceExternalCall = z.infer<typeof EvidenceExternalCallSchema>;

export const EvidenceStateTransitionSchema = z.strictObject({
  stepId: z.string(),
  at: IsoDateTimeSchema,
  summary: z.string(),
  detail: z.unknown().optional(),
});
export type EvidenceStateTransition = z.infer<typeof EvidenceStateTransitionSchema>;

export const ScenarioEvidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  runId: z.string().min(1),
  /** Orchestration metadata only. */
  scenarioId: z.string().min(1),
  gitSha: z.string().min(1),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema.optional(),
  durationMs: z.number().nonnegative().optional(),
  mode: ScenarioExecutionModeSchema,
  resetReseedChecksum: z.string().optional(),
  globalInputPack: z.strictObject({
    packId: z.string(),
    version: z.string(),
    hash: z.string().optional(),
  }),
  localInputPack: z.strictObject({
    packId: z.string(),
    version: z.string(),
    hash: z.string().optional(),
  }),
  /** Exact provenance of each external/native input submitted. */
  inputProvenance: z.array(EvidenceProvenanceSchema).default([]),
  canonicalIds: z
    .strictObject({
      anchorEventIds: z.array(EntityIdSchema).default([]),
      travellerIds: z.array(EntityIdSchema).default([]),
      tripIds: z.array(EntityIdSchema).default([]),
      caseIds: z.array(EntityIdSchema).default([]),
    })
    .default({ anchorEventIds: [], travellerIds: [], tripIds: [], caseIds: [] }),
  incomingTrigger: z.unknown().optional(),
  externalToolCalls: z.array(EvidenceExternalCallSchema).default([]),
  sanitizedProviderResponseRefs: z.array(z.string()).default([]),
  stateTransitions: z.array(EvidenceStateTransitionSchema).default([]),
  impactBlastRadius: z.unknown().optional(),
  strategies: z.unknown().optional(),
  viabilityResults: z.unknown().optional(),
  policyAuthorityResult: z.unknown().optional(),
  approvalDecision: z.unknown().optional(),
  actionExecution: z.unknown().optional(),
  providerObservation: z.unknown().optional(),
  finalCaseState: z.unknown().optional(),
  finalTripViability: z.unknown().optional(),
  unresolvedUncertainty: z.unknown().optional(),
  /** Every SIMULATED seam explicitly identified. */
  simulatedSeams: z.array(z.string()).default([]),
  steps: z
    .array(
      z.strictObject({
        stepId: z.string(),
        description: z.string().optional(),
        startedAt: IsoDateTimeSchema,
        finishedAt: IsoDateTimeSchema,
        ok: z.boolean(),
        actionType: z.string(),
        provenance: EvidenceProvenanceSchema.optional(),
        request: z.unknown().optional(),
        response: z.unknown().optional(),
        error: z.string().optional(),
      }),
    )
    .default([]),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type ScenarioEvidence = z.infer<typeof ScenarioEvidenceSchema>;

export interface EvidenceBuilderOptions {
  runId: string;
  scenarioId: string;
  gitSha: string;
  mode: ScenarioEvidence['mode'];
  globalInputPack: ScenarioEvidence['globalInputPack'];
  localInputPack: ScenarioEvidence['localInputPack'];
  startedAt?: string;
}

/** Mutable builder that accumulates a ScenarioEvidence document. */
export class EvidenceBuilder {
  private readonly evidence: ScenarioEvidence;

  constructor(options: EvidenceBuilderOptions) {
    this.evidence = {
      schemaVersion: 1,
      runId: options.runId,
      scenarioId: options.scenarioId,
      gitSha: options.gitSha,
      startedAt: options.startedAt ?? new Date().toISOString(),
      mode: options.mode,
      globalInputPack: options.globalInputPack,
      localInputPack: options.localInputPack,
      inputProvenance: [],
      canonicalIds: { anchorEventIds: [], travellerIds: [], tripIds: [], caseIds: [] },
      externalToolCalls: [],
      sanitizedProviderResponseRefs: [],
      stateTransitions: [],
      simulatedSeams: [],
      steps: [],
      ok: true,
    };
  }

  setResetChecksum(checksum: string): void {
    this.evidence.resetReseedChecksum = checksum;
  }

  addInputProvenance(provenance: EvidenceProvenance): void {
    this.evidence.inputProvenance.push(provenance);
    if (provenance.simulatedExternal) {
      const label = `${provenance.source}:${provenance.mode}`;
      if (!this.evidence.simulatedSeams.includes(label)) {
        this.evidence.simulatedSeams.push(label);
      }
    }
  }

  mergeCanonicalIds(partial: Partial<ScenarioEvidence['canonicalIds']>): void {
    const cur = this.evidence.canonicalIds;
    if (partial.anchorEventIds) cur.anchorEventIds = unique([...cur.anchorEventIds, ...partial.anchorEventIds]);
    if (partial.travellerIds) cur.travellerIds = unique([...cur.travellerIds, ...partial.travellerIds]);
    if (partial.tripIds) cur.tripIds = unique([...cur.tripIds, ...partial.tripIds]);
    if (partial.caseIds) cur.caseIds = unique([...cur.caseIds, ...partial.caseIds]);
  }

  setIncomingTrigger(trigger: unknown): void {
    this.evidence.incomingTrigger = trigger;
  }

  addExternalCall(call: EvidenceExternalCall): void {
    this.evidence.externalToolCalls.push(call);
    if (call.responseRef) {
      this.evidence.sanitizedProviderResponseRefs.push(call.responseRef);
    }
    if (call.provenance.simulatedExternal) {
      const label = `${call.provenance.source}:${call.provenance.mode}`;
      if (!this.evidence.simulatedSeams.includes(label)) {
        this.evidence.simulatedSeams.push(label);
      }
    }
  }

  addStateTransition(transition: EvidenceStateTransition): void {
    this.evidence.stateTransitions.push(transition);
  }

  recordStep(step: ScenarioEvidence['steps'][number]): void {
    this.evidence.steps.push(step);
    if (!step.ok) this.evidence.ok = false;
  }

  patch(fields: Partial<ScenarioEvidence>): void {
    Object.assign(this.evidence, fields);
  }

  fail(message: string): void {
    this.evidence.ok = false;
    this.evidence.error = message;
  }

  finish(): ScenarioEvidence {
    const finishedAt = new Date().toISOString();
    this.evidence.finishedAt = finishedAt;
    this.evidence.durationMs = Date.parse(finishedAt) - Date.parse(this.evidence.startedAt);
    return ScenarioEvidenceSchema.parse(this.evidence);
  }

  current(): ScenarioEvidence {
    return this.evidence;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
