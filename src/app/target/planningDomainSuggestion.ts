/**
 * Bounded AI domain suggestion for recovery planning (freeze C3 hybrid seam).
 *
 * AI may propose additional RecoveryDomainIds from semantic context. The
 * deterministic registry ALWAYS re-validates applicability + capabilities —
 * suggestions never invent a domain or bypass fail-closed rules.
 *
 * No traveller/event/route/scenario hardcoding: the prompt carries only
 * closed-vocabulary dimension codes, subject kinds, and object kinds.
 */
import { z } from 'zod';
import type { IntelligenceClient } from '../../intelligence/client.ts';
import {
  RecoveryDomainIdSchema,
  type RecoveryDomainId,
  type RecoveryDomainContext,
} from '../../contracts/v2/planning/recoveryDomain.ts';

const SuggestionSchema = z.strictObject({
  suggestedDomains: z.array(RecoveryDomainIdSchema).max(6),
  rationale: z.string().max(400).optional(),
});

export type DomainSuggestionInput = {
  context: RecoveryDomainContext;
  /** Domains already activated deterministically — AI may only ADD. */
  alreadyInvestigated: readonly RecoveryDomainId[];
};

export type DomainSuggestionResult = {
  suggestedDomains: readonly RecoveryDomainId[];
  /** Provider/model identity for planning evidence / logs (never chain-of-thought). */
  meta?: { providerId: string; model: string; mode: 'LIVE' | 'REPLAY' };
  rationale?: string;
};

const SYSTEM = `You assist a travel-recovery planner by suggesting which recovery domains may be relevant.
Return JSON only. suggestedDomains must be a subset of:
TRANSPORT, STAY, TRANSFER, PROGRAMME, SUPPORT_COORDINATION, INFORMATION_RESEARCH.
Suggest ONLY domains that the failure semantics could justify beyond the already-investigated set.
Do not invent domains. Do not include chain-of-thought. Keep rationale under 400 characters if present.`;

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

export async function suggestRecoveryDomains(
  client: IntelligenceClient,
  input: DomainSuggestionInput,
): Promise<DomainSuggestionResult> {
  const already = new Set(input.alreadyInvestigated);
  const userPrompt = JSON.stringify({
    failingSubjectKinds: sorted(input.context.failingSubjectKinds),
    blockingDimensionCodes: sorted(input.context.blockingDimensionCodes),
    affectedObjectKinds: sorted(input.context.affectedObjectKinds),
    availableCapabilities: sorted(input.context.availableCapabilities),
    alreadyInvestigated: [...already].sort(),
  });

  const result = await client.call({
    id: 'recovery.domain_suggestion',
    systemPrompt: SYSTEM,
    userPrompt,
    schema: SuggestionSchema,
  });

  if (!result.ok) {
    return { suggestedDomains: [] };
  }

  const suggested = result.value.suggestedDomains.filter((d) => !already.has(d));
  return {
    suggestedDomains: suggested,
    meta: {
      providerId: result.meta.providerId,
      model: result.meta.model,
      mode: result.meta.mode,
    },
    ...(result.value.rationale ? { rationale: result.value.rationale } : {}),
  };
}
