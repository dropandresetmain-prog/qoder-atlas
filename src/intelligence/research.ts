/**
 * D2 — sourced web research behind the frozen ResearchCapability seam
 * (FR-17, ADR-015, ARCHITECTURE.md §14).
 *
 * Posture: the plain Model Studio chat-completions surface used by this lane
 * does not provide a verifiable sourced-web-research tool, so research stays
 * provider-neutral:
 * - `ResearchSource` is the seam any sourced backend (Model Studio with an
 *   enabled search tool, a replay store, a future research provider) can
 *   implement;
 * - `ModelStudioResearchSource` obtains findings through the D1 client with
 *   strict schema validation — findings are claims with provenance fields,
 *   never accepted truth;
 * - `ScriptedResearchSource` replays saved/scripted sourced findings for
 *   routine tests and credential-free runs;
 * - `ResearchService` implements the frozen ResearchCapability and applies
 *   the deterministic acceptance rules from `interpretResearchFindings`:
 *   legal/entry facts are accepted ONLY with an AUTHORITATIVE claim plus
 *   source URIs; insufficiently sourced legal claims are downgraded to
 *   INFERRED findings carrying their rejection reason as uncertainty, so the
 *   loop stays informed without ever treating the claim as a legal fact;
 *   operational estimates keep their uncertainty.
 */
import type {
  CapabilityDescriptor,
  EntryResearchQuery,
  LocalContextResearchQuery,
  ResearchCapability,
  ResearchFinding,
  ResearchOutcome,
} from '../contracts/capabilities.ts';
import {
  capabilityError,
  capabilityOk,
  type AdapterMode,
  type CapabilityMeta,
  type CapabilityResult,
} from '../contracts/envelope.ts';
import type { IsoDateTime } from '../domain/common.ts';
import { MODEL_STUDIO_PROVIDER_ID, toCapabilityErrorCategory, type ModelError, type ModelStudioClient } from './client.ts';
import { RawResearchFindingsModelSchema, type RawResearchFindingModel } from './schemas.ts';
import { interpretResearchFindings } from './semantics.ts';

/** Structured result from a research backend; failure is data, not a throw. */
export type ResearchSourceResult =
  | { ok: true; findings: RawResearchFindingModel[]; insufficientEvidence: boolean }
  | { ok: false; error: ModelError };

/** Provider-neutral research seam: any sourced backend plugs in here. */
export interface ResearchSource {
  readonly mode: AdapterMode;
  entryRequirements(query: EntryResearchQuery): Promise<ResearchSourceResult>;
  localContext(query: LocalContextResearchQuery): Promise<ResearchSourceResult>;
}

/**
 * Research through the Model Studio client. Findings are schema-validated
 * model claims; acceptance rules are applied deterministically downstream.
 */
export class ModelStudioResearchSource implements ResearchSource {
  readonly mode: AdapterMode;
  private readonly client: ModelStudioClient;

  constructor(client: ModelStudioClient) {
    this.client = client;
    this.mode = client.mode;
  }

  async entryRequirements(query: EntryResearchQuery): Promise<ResearchSourceResult> {
    return this.research(ENTRY_RESEARCH_SYSTEM_PROMPT, JSON.stringify(query));
  }

  async localContext(query: LocalContextResearchQuery): Promise<ResearchSourceResult> {
    return this.research(LOCAL_CONTEXT_RESEARCH_SYSTEM_PROMPT, JSON.stringify(query));
  }

  private async research(systemPrompt: string, userPrompt: string): Promise<ResearchSourceResult> {
    const result = await this.client.call({
      id: 'research_findings',
      systemPrompt,
      userPrompt,
      schema: RawResearchFindingsModelSchema,
    });
    if (!result.ok) return { ok: false, error: result.error };
    return {
      ok: true,
      findings: result.value.findings,
      insufficientEvidence: result.value.insufficientEvidence,
    };
  }
}

/**
 * Replay/test-double research source. Queued results are consumed in order
 * per research kind; an exhausted queue is a structured UNAVAILABLE error.
 */
export class ScriptedResearchSource implements ResearchSource {
  readonly mode = 'REPLAY' as const;
  private readonly entryResponses: ResearchSourceResult[];
  private readonly localResponses: ResearchSourceResult[];

  constructor(options: { entry?: ResearchSourceResult[]; local?: ResearchSourceResult[] }) {
    this.entryResponses = [...(options.entry ?? [])];
    this.localResponses = [...(options.local ?? [])];
  }

  async entryRequirements(_query: EntryResearchQuery): Promise<ResearchSourceResult> {
    return this.next(this.entryResponses);
  }

  async localContext(_query: LocalContextResearchQuery): Promise<ResearchSourceResult> {
    return this.next(this.localResponses);
  }

  private next(queue: ResearchSourceResult[]): ResearchSourceResult {
    const next = queue.shift();
    if (next === undefined) {
      return {
        ok: false,
        error: { category: 'UNAVAILABLE', code: 'research_script_exhausted', message: 'no scripted research result left' },
      };
    }
    return next;
  }
}

export interface ResearchServiceOptions {
  source: ResearchSource;
  providerId?: string;
  /** Injectable clock for meta timestamps; deterministic in tests. */
  now?: () => IsoDateTime;
}

/** Frozen-contract ResearchCapability over any ResearchSource. */
export class ResearchService implements ResearchCapability {
  readonly descriptor: CapabilityDescriptor;
  private readonly source: ResearchSource;
  private readonly providerId: string;
  private readonly now: () => IsoDateTime;

  constructor(options: ResearchServiceOptions) {
    this.source = options.source;
    this.providerId = options.providerId ?? MODEL_STUDIO_PROVIDER_ID;
    this.now = options.now ?? ((): IsoDateTime => new Date().toISOString());
    this.descriptor = {
      family: 'RESEARCH',
      providerId: this.providerId,
      mode: options.source.mode,
      supportedOperations: ['research.entry_requirements', 'research.local_context'],
      // Research is information only; it never crosses the action boundary.
      maxSideEffectLevel: 'READ_ONLY',
    };
  }

  async researchEntryRequirements(query: EntryResearchQuery): Promise<CapabilityResult<ResearchOutcome>> {
    return this.toCapabilityResult(await this.source.entryRequirements(query));
  }

  async researchLocalContext(query: LocalContextResearchQuery): Promise<CapabilityResult<ResearchOutcome>> {
    return this.toCapabilityResult(await this.source.localContext(query));
  }

  private toCapabilityResult(result: ResearchSourceResult): CapabilityResult<ResearchOutcome> {
    const meta: CapabilityMeta = {
      providerId: this.providerId,
      mode: this.source.mode,
      requestedAt: this.now(),
    };
    if (!result.ok) {
      return capabilityError(
        {
          category: toCapabilityErrorCategory(result.error.category),
          code: result.error.code,
          message: result.error.message,
          retryable: result.error.retryable,
        },
        meta,
      );
    }
    return capabilityOk({ findings: toResearchFindings(result.findings) }, meta);
  }
}

/**
 * Deterministic normalization of raw model/replay findings into the frozen
 * ResearchFinding shape. Legal/entry claims that lack authoritative sourcing
 * are downgraded to INFERRED with their rejection reason as uncertainty —
 * visible to the loop, but never usable as a legal fact under the fact
 * authority ladder.
 */
export function toResearchFindings(raw: RawResearchFindingModel[]): ResearchFinding[] {
  const interpretation = interpretResearchFindings(raw);
  return raw.map((finding, index): ResearchFinding => {
    // Aligned per-finding decision; a missing decision fails closed.
    const decision = interpretation.decisions[index] ?? {
      accepted: false,
      reason: 'research finding lacked an interpretation decision',
    };
    if (decision.accepted) {
      const missingEvidenceNote =
        finding.kind === 'OPERATIONAL_ESTIMATE' && finding.uncertainty === undefined && finding.sourceUris.length === 0
          ? 'operational estimate carries no sourcing or uncertainty information'
          : finding.uncertainty;
      return {
        statement: finding.statement,
        kind: finding.kind,
        authority: finding.authorityClaim,
        sourceUris: finding.sourceUris,
        confidence: finding.confidence,
        uncertainty: missingEvidenceNote,
      };
    }
    return {
      statement: finding.statement,
      kind: 'LEGAL_ENTRY_FACT',
      authority: 'INFERRED',
      sourceUris: finding.sourceUris,
      confidence: finding.confidence,
      uncertainty: decision.reason ?? 'legal/entry claim requires authoritative sourcing',
    };
  });
}

const ENTRY_RESEARCH_SYSTEM_PROMPT = `You research entry/visa requirements for a trip and report sourced findings.
Respond with a single JSON object matching the required schema.
Classify each finding:
- LEGAL_ENTRY_FACT only for legal/entry rules, and only with authorityClaim AUTHORITATIVE plus sourceUris citing the official/authoritative source;
- OPERATIONAL_ESTIMATE for practical estimates (e.g. immigration processing times), always with honest uncertainty.
Never state a legal/entry fact without authoritative sourcing; if you lack it, report the gap via insufficientEvidence or uncertainty instead of guessing.
If evidence is insufficient, set insufficientEvidence=true and return no fabricated findings.`;

const LOCAL_CONTEXT_RESEARCH_SYSTEM_PROMPT = `You research local operational context (transport, venues, timing) for trip recovery.
Respond with a single JSON object matching the required schema.
Findings are normally OPERATIONAL_ESTIMATE with sourceUris where available and honest uncertainty.
Do not present estimates as verified facts; if evidence is insufficient, set insufficientEvidence=true rather than fabricate.`;
