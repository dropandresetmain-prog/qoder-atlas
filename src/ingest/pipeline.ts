/**
 * B2 — ingestion pipeline orchestrator.
 *
 * Implements the frozen SourceIngestionCapability seam:
 *
 *   source -> parse/extract -> constrained normalized data
 *          -> evidence/provenance/uncertainty
 *          -> validated MutationProposal / RuleSet / TripSignal
 *
 * The pipeline NEVER writes trip state itself (FR-02/FR-04): output is only
 * proposals/rule-sets/signals/uncertainties for the downstream mutation
 * service. Structured inputs take the deterministic path and bypass model
 * interpretation; text/document inputs go through the model-neutral
 * SemanticExtractionClient seam (Lane D supplies the real client).
 */
import { z } from 'zod';
import type { AdapterMode } from '../contracts/envelope.ts';
import { capabilityError, capabilityOk, type CapabilityMeta, type CapabilityResult } from '../contracts/envelope.ts';
import type {
  CapabilityDescriptor,
  IngestionOutcome,
  SourceIngestionCapability,
  SourceInput,
} from '../contracts/capabilities.ts';
import type { SourceRepository } from '../contracts/repositories.ts';
import {
  addUncertainty,
  emptyArtifacts,
  hasSubstance,
  mergeArtifacts,
  type IngestionArtifacts,
  type NormalizationEnv,
} from './artifacts.ts';
import {
  normalizeExtractedAnchorEvent,
  normalizeExtractedFlightBooking,
  normalizeExtractedSignal,
  normalizeExtractedStayBooking,
} from './normalize.ts';
import { normalizeExtractedInsurance, normalizeExtractedRuleSet } from './ruleSets.ts';
import {
  EXTRACTION_TASKS_BY_KIND,
  validateExtraction,
  type ExtractionTask,
  type ExtractedAnchorEvent,
  type ExtractedFlightBooking,
  type ExtractedInsurance,
  type ExtractedRuleSet,
  type ExtractedSignal,
  type ExtractedStayBooking,
  type ExtractedTravellerContext,
  type SemanticExtractionClient,
} from './semantic.ts';
import { SourceInputSchema, materializeSource, systemClock, type Clock, type IngestionContext } from './source.ts';
import { normalizeStructuredInput } from './structured.ts';
import { normalizeExtractedTravellerContext } from './travellerContext.ts';

export const INGESTION_PROVIDER_ID = 'ingestion';

export interface IngestionDependencies {
  /** Lane D implements this with the Model Studio client; absent until wired. */
  extractionClient?: SemanticExtractionClient;
  sourceRepository?: SourceRepository;
  clock?: Clock;
  mode?: AdapterMode;
  /** Entity binding for this ingestion run (trip/traveller/organisation). */
  context?: IngestionContext;
  /** Explicit extraction task overriding kind-based routing. */
  task?: ExtractionTask;
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

/** Dispatch a validated extraction to its deterministic normalizer. */
function normalizeExtractedTask(
  env: NormalizationEnv,
  task: ExtractionTask,
  value: unknown,
): IngestionArtifacts {
  switch (task) {
    case 'ANCHOR_EVENT':
      return normalizeExtractedAnchorEvent(env, value as ExtractedAnchorEvent, 'AI');
    case 'FLIGHT_BOOKING':
      return normalizeExtractedFlightBooking(env, value as ExtractedFlightBooking, 'AI');
    case 'STAY_BOOKING':
      return normalizeExtractedStayBooking(env, value as ExtractedStayBooking, 'AI');
    case 'RULE_SET':
      return normalizeExtractedRuleSet(env, value as ExtractedRuleSet);
    case 'INSURANCE':
      return normalizeExtractedInsurance(env, value as ExtractedInsurance);
    case 'TRAVELLER_CONTEXT':
      return normalizeExtractedTravellerContext(env, value as ExtractedTravellerContext);
    case 'DISRUPTION_SIGNAL':
      return normalizeExtractedSignal(env, value as ExtractedSignal);
  }
}

async function runExtraction(
  env: NormalizationEnv,
  content: string,
  artifacts: IngestionArtifacts,
  deps: IngestionDependencies,
): Promise<void> {
  const tasks = deps.task ? [deps.task] : EXTRACTION_TASKS_BY_KIND[env.source.kind];
  if (tasks.length === 0) {
    addUncertainty(
      artifacts,
      env,
      `No extraction path is defined for source kind ${env.source.kind}; structured input is required`,
      'LOW',
    );
    return;
  }
  if (!deps.extractionClient) {
    // Pending Lane D (D1) wiring: the seam exists, the client does not yet.
    addUncertainty(
      artifacts,
      env,
      'Text content requires semantic extraction but no extractor is configured; Model Studio client (Lane D1) is not wired yet',
      'MEDIUM',
    );
    return;
  }

  const failures: string[] = [];
  // A validated extraction that still yields no proposals (ambiguous/partial
  // source) carries honest uncertainties; keep the latest such interpretation
  // so ambiguity evidence survives when no task produces substance.
  let bestPartial: IngestionArtifacts | undefined;
  for (const task of tasks) {
    const result = await deps.extractionClient.extract({
      task,
      sourceKind: env.source.kind,
      ...(env.source.uri ? { uri: env.source.uri } : {}),
      ...(env.source.title ? { title: env.source.title } : {}),
      content,
    });
    if (!result.ok) {
      failures.push(`${task}: ${result.reason}`);
      continue;
    }
    const validated = validateExtraction(task, result.output);
    if (!validated.ok) {
      // Malformed model output fails safely: data + uncertainty, never trust.
      addUncertainty(
        artifacts,
        env,
        `Extraction for task ${task} failed schema validation and was discarded: ${validated.issues.join('; ')}`,
        'HIGH',
      );
      continue;
    }
    const produced = normalizeExtractedTask(env, task, validated.value);
    if (hasSubstance(produced)) {
      mergeArtifacts(artifacts, produced);
      return;
    }
    if (produced.uncertainties.length > 0) bestPartial = produced;
    failures.push(`${task}: extraction validated but produced no normalized content`);
  }
  if (bestPartial) {
    mergeArtifacts(artifacts, bestPartial);
    return;
  }
  addUncertainty(
    artifacts,
    env,
    `No recognized structured content could be extracted from this source (tried: ${tasks.join(', ')}${
      failures.length > 0 ? `; ${failures.join(' | ')}` : ''
    })`,
    'MEDIUM',
  );
}

/**
 * Build the Lane B ingestion capability. Ingestion is read-only with respect
 * to authoritative state: it persists source evidence (when a repository is
 * supplied) and emits validated proposals/rules/signals only.
 */
export function createSourceIngestionCapability(
  deps: IngestionDependencies = {},
): SourceIngestionCapability {
  const mode: AdapterMode = deps.mode ?? 'REPLAY';
  const clock = deps.clock ?? systemClock;
  const descriptor: CapabilityDescriptor = {
    family: 'INGESTION',
    providerId: INGESTION_PROVIDER_ID,
    mode,
    supportedOperations: [],
    maxSideEffectLevel: 'READ_ONLY',
  };

  const newMeta = (): CapabilityMeta => ({
    providerId: INGESTION_PROVIDER_ID,
    mode,
    requestedAt: clock(),
  });

  return {
    descriptor,
    async ingest(input: SourceInput): Promise<CapabilityResult<IngestionOutcome>> {
      try {
        const parsed = SourceInputSchema.safeParse(input);
        if (!parsed.success) {
          return capabilityError(
            {
              category: 'INVALID_REQUEST',
              code: 'invalid_source_input',
              message: `SourceInput failed schema validation: ${formatIssues(parsed.error)}`,
            },
            newMeta(),
          );
        }
        const sourceInput = parsed.data;

        const { record, content } = await materializeSource(sourceInput, {
          repository: deps.sourceRepository,
          clock,
        });
        const env: NormalizationEnv = {
          source: record,
          context: deps.context ?? {},
          now: clock(),
        };
        const artifacts = emptyArtifacts();

        if (sourceInput.structured !== undefined) {
          // Deterministic mapping path: structured data never needs a model.
          mergeArtifacts(artifacts, normalizeStructuredInput(env, sourceInput.structured));
        } else if (content && content.trim().length > 0) {
          await runExtraction(env, content, artifacts, deps);
        } else {
          addUncertainty(
            artifacts,
            env,
            'Source carries neither content nor a structured payload; nothing was normalized',
            'MEDIUM',
          );
        }

        return capabilityOk(
          {
            sourceId: record.id,
            proposals: artifacts.proposals,
            ruleSets: artifacts.ruleSets,
            signals: artifacts.signals,
            uncertainties: artifacts.uncertainties,
          },
          newMeta(),
        );
      } catch (error) {
        return capabilityError(
          {
            category: 'PROVIDER_ERROR',
            code: 'ingestion_failed',
            message: error instanceof Error ? error.message : String(error),
          },
          newMeta(),
        );
      }
    },
  };
}
