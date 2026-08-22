/**
 * I1 — Lane D Model Studio client adapted onto Lane B's
 * `SemanticExtractionClient` seam. This is the ONLY model client in the
 * application; no second client is implemented (I1 directive).
 *
 * Failure is data: any model error (unconfigured, unavailable, invalid
 * output) becomes `{ ok: false, reason }` so ingestion records honest
 * uncertainty instead of crashing or guessing. Output validation stays with
 * Lane B (`validateExtraction`) — the adapter forwards raw validated values.
 */
import { EXTRACTION_OUTPUT_SCHEMA, type SemanticExtractionClient, type SemanticExtractionRequest } from '../ingest/semantic.ts';
import type { ModelStudioClient, ModelTask } from '../intelligence/client.ts';

const EXTRACTION_SYSTEM_PROMPT = `You extract structured facts from one travel-related source document.
Respond with a single JSON object matching the required schema for the task.
Extract only what the source actually states; never invent values.
Omit optional fields when the source does not provide them.
Timestamps must be ISO-8601 with an explicit UTC offset when the source gives one.`;

function buildUserPrompt(request: SemanticExtractionRequest): string {
  const header = [
    `Extraction task: ${request.task}`,
    `Source kind: ${request.sourceKind}`,
    request.title ? `Title: ${request.title}` : undefined,
    request.uri ? `URI: ${request.uri}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');
  return `${header}\n\nSource content:\n${request.content}`;
}

/**
 * Wrap a Model Studio client as the ingestion extraction seam. Task prompts
 * are generic; schema enforcement comes from the frozen extraction DTOs.
 */
export function modelStudioExtractionClient(client: ModelStudioClient): SemanticExtractionClient {
  return {
    async extract(request: SemanticExtractionRequest) {
      const task: ModelTask<unknown> = {
        id: `extraction_${request.task.toLowerCase()}`,
        systemPrompt: EXTRACTION_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(request),
        schema: EXTRACTION_OUTPUT_SCHEMA[request.task],
      };
      const result = await client.call(task);
      if (!result.ok) {
        return { ok: false, reason: `${result.error.category}:${result.error.code}` };
      }
      return { ok: true, output: result.value };
    },
  };
}
