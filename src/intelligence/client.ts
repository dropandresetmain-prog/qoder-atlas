/**
 * D1 — smallest reliable Alibaba Model Studio / Qwen client for the MVP
 * (FR-07, ARCHITECTURE.md §14).
 *
 * Design rules:
 * - OpenAI-compatible chat-completions surface (DashScope-compatible);
 * - credentials are optional at application startup — an unconfigured client
 *   returns a structured NOT_CONFIGURED error, it never throws at construction;
 * - every call returns a structured ModelCallResult; external/model failure is
 *   data, never an exception that can crash a RecoveryCase (NFR-03);
 * - schema-constrained output: model text is parsed and validated with Zod;
 *   invalid model output is rejected (INVALID_OUTPUT), never repaired by
 *   guessing;
 * - retry only when bounded and safe (retryable transport categories, capped
 *   attempts); invalid output is fail-closed without retry;
 * - the API key never appears in error messages, meta or logs.
 *
 * Saved/replayed model outputs: tests inject `ScriptedModelTransport` with
 * committed saved responses (test/fixtures/model-outputs). The validation
 * path is identical for live and replayed text — there is no separate demo
 * parse path (ADR-008 spirit applied to the model boundary).
 */
import { z } from 'zod';

export const MODEL_STUDIO_PROVIDER_ID = 'model-studio';
export const MODEL_STUDIO_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
/** Cheap runtime default for plumbing; override via MODEL_STUDIO_MODEL. */
export const MODEL_STUDIO_DEFAULT_MODEL = 'qwen-flash';

export const ModelErrorCategorySchema = z.enum([
  'NOT_CONFIGURED',
  'AUTH',
  'NETWORK',
  'TIMEOUT',
  'RATE_LIMITED',
  'PROVIDER_ERROR',
  'INVALID_OUTPUT',
  'UNAVAILABLE',
]);
export type ModelErrorCategory = z.infer<typeof ModelErrorCategorySchema>;

export const ModelErrorSchema = z.strictObject({
  category: ModelErrorCategorySchema,
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().optional(),
});
export type ModelError = z.infer<typeof ModelErrorSchema>;

export interface ModelCallMeta {
  providerId: string;
  model: string;
  /** LIVE = real model call; REPLAY = saved/scripted model output. */
  mode: 'LIVE' | 'REPLAY';
  attempt: number;
  latencyMs?: number;
}

/** Structured result envelope: model failure is data, not a crash. */
export type ModelCallResult<T> =
  | { ok: true; value: T; rawText: string; meta: ModelCallMeta }
  | { ok: false; error: ModelError; meta: ModelCallMeta };

// ---------------------------------------------------------------------------
// Transport seam
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  /** JSON object output is always requested; enforcement is on our side. */
  responseFormat: 'json_object';
}

export interface CompletionResponse {
  contentText: string;
}

/**
 * Transport error with a mapped category. Transports MUST NOT include
 * credentials in the message.
 */
export class ModelTransportError extends Error {
  readonly category: ModelErrorCategory;
  readonly code: string;
  readonly retryable?: boolean;

  constructor(category: ModelErrorCategory, code: string, message: string, retryable?: boolean) {
    super(message);
    this.name = 'ModelTransportError';
    this.category = category;
    this.code = code;
    this.retryable = retryable;
  }
}

export interface ModelTransport {
  readonly mode: 'LIVE' | 'REPLAY';
  complete(request: CompletionRequest, timeoutMs: number): Promise<CompletionResponse>;
}

/**
 * HTTP transport for the OpenAI-compatible Model Studio surface.
 * Never includes the API key in thrown errors or metadata.
 */
export class HttpModelTransport implements ModelTransport {
  readonly mode = 'LIVE' as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, apiKey: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async complete(request: CompletionRequest, timeoutMs: number): Promise<CompletionResponse> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          response_format: { type: request.responseFormat },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new ModelTransportError('TIMEOUT', 'model_timeout', 'model call exceeded time limit', true);
      }
      throw new ModelTransportError('NETWORK', 'model_network', 'model endpoint unreachable', true);
    }

    if (!response.ok) {
      const status = response.status;
      if (status === 401 || status === 403) {
        throw new ModelTransportError('AUTH', `model_http_${status}`, 'model service rejected credentials', false);
      }
      if (status === 429) {
        throw new ModelTransportError('RATE_LIMITED', 'model_rate_limited', 'model service rate limited', true);
      }
      if (status >= 500) {
        throw new ModelTransportError('PROVIDER_ERROR', `model_http_${status}`, 'model service error', true);
      }
      throw new ModelTransportError('PROVIDER_ERROR', `model_http_${status}`, 'model service rejected request', false);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new ModelTransportError('PROVIDER_ERROR', 'model_empty_content', 'model returned no usable content', false);
    }
    return { contentText: content };
  }
}

/**
 * Scripted transport for routine tests and saved-output replay. Responses are
 * consumed in order; each entry is raw model text or a transport error.
 */
export class ScriptedModelTransport implements ModelTransport {
  readonly mode = 'REPLAY' as const;
  readonly requests: CompletionRequest[] = [];
  private readonly responses: Array<string | ModelTransportError>;

  constructor(responses: Array<string | ModelTransportError>) {
    this.responses = responses;
  }

  async complete(request: CompletionRequest, _timeoutMs: number): Promise<CompletionResponse> {
    this.requests.push(request);
    const next = this.responses.shift();
    if (next === undefined) {
      throw new ModelTransportError('UNAVAILABLE', 'script_exhausted', 'no scripted response left', false);
    }
    if (next instanceof ModelTransportError) throw next;
    return { contentText: next };
  }
}

/**
 * Placeholder transport when no credentials and no explicit transport were
 * provided. Mode is LIVE so the client's NOT_CONFIGURED guard engages; the
 * transport itself also fails structured rather than reaching the network.
 */
export class UnconfiguredModelTransport implements ModelTransport {
  readonly mode = 'LIVE' as const;

  async complete(_request: CompletionRequest, _timeoutMs: number): Promise<CompletionResponse> {
    throw new ModelTransportError(
      'NOT_CONFIGURED',
      'model_studio_credentials_missing',
      'Model Studio credentials are not configured',
      false,
    );
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface ModelStudioClientOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  transport?: ModelTransport;
  /** Per-attempt time limit. */
  timeoutMs?: number;
  /** Total attempts including the first; bounded retry only. */
  maxAttempts?: number;
}

export interface ModelTask<T> {
  /** Stable task identifier, used for replay correlation and prompts. */
  id: string;
  systemPrompt: string;
  userPrompt: string;
  /** Output is only accepted when it validates against this schema. */
  schema: z.ZodType<T>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 2;

export class ModelStudioClient {
  readonly model: string;
  readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly transport: ModelTransport;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(options: ModelStudioClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? MODEL_STUDIO_DEFAULT_MODEL;
    this.baseUrl = options.baseUrl ?? MODEL_STUDIO_DEFAULT_BASE_URL;
    this.transport =
      options.transport ??
      (this.apiKey !== undefined
        ? new HttpModelTransport(this.baseUrl, this.apiKey)
        : new UnconfiguredModelTransport());
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  }

  /** True when enough configuration exists for a real model call. */
  isConfigured(): boolean {
    return this.apiKey !== undefined && this.apiKey !== '';
  }

  /**
   * Raw completion passthrough for seams that perform their own JSON/schema
   * validation (e.g. programme intake extraction). Fails closed in LIVE mode
   * when no credentials are configured — never reaches the network.
   */
  async complete(request: CompletionRequest, timeoutMs: number): Promise<CompletionResponse> {
    if (!this.isConfigured() && this.transport.mode === 'LIVE') {
      throw new ModelTransportError(
        'NOT_CONFIGURED',
        'model_studio_credentials_missing',
        'Model Studio credentials are not configured',
        false,
      );
    }
    return this.transport.complete(request, timeoutMs);
  }

  /** Transport mode (LIVE vs REPLAY) for capability descriptors/meta. */
  get mode(): 'LIVE' | 'REPLAY' {
    return this.transport.mode;
  }

  async call<T>(task: ModelTask<T>): Promise<ModelCallResult<T>> {
    const baseMeta: ModelCallMeta = {
      providerId: MODEL_STUDIO_PROVIDER_ID,
      model: this.model,
      mode: this.transport.mode,
      attempt: 0,
    };

    if (!this.isConfigured() && this.transport.mode === 'LIVE') {
      return {
        ok: false,
        error: {
          category: 'NOT_CONFIGURED',
          code: 'model_studio_credentials_missing',
          message: 'Model Studio credentials are not configured; live intelligence is unavailable',
        },
        meta: baseMeta,
      };
    }

    let lastError: ModelError | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const meta: ModelCallMeta = { ...baseMeta, attempt };
      const startedAt = Date.now();
      let rawText: string;
      try {
        const response = await this.transport.complete(
          {
            model: this.model,
            messages: [
              { role: 'system', content: task.systemPrompt },
              { role: 'user', content: task.userPrompt },
            ],
            responseFormat: 'json_object',
          },
          this.timeoutMs,
        );
        rawText = response.contentText;
      } catch (error) {
        const transportError =
          error instanceof ModelTransportError
            ? error
            : new ModelTransportError('PROVIDER_ERROR', 'model_unexpected', 'unexpected model transport failure', false);
        lastError = {
          category: transportError.category,
          code: transportError.code,
          // Credentials must never surface in error data.
          message: transportError.message,
          retryable: transportError.retryable,
        };
        if (transportError.retryable && attempt < this.maxAttempts) continue;
        return { ok: false, error: lastError, meta: { ...meta, latencyMs: Date.now() - startedAt } };
      }

      const parsed = parseModelJson(rawText);
      if (parsed === undefined) {
        // Malformed JSON: fail closed, no guessing, no retry.
        return {
          ok: false,
          error: {
            category: 'INVALID_OUTPUT',
            code: 'model_output_not_json',
            message: 'model output was not valid JSON',
          },
          meta: { ...meta, latencyMs: Date.now() - startedAt },
        };
      }
      const validated = task.schema.safeParse(parsed);
      if (!validated.success) {
        // Schema violation: fail closed. The summary is structural only; it
        // never echoes raw model content.
        return {
          ok: false,
          error: {
            category: 'INVALID_OUTPUT',
            code: 'model_output_schema_rejected',
            message: `model output failed schema validation (${validated.error.issues.length} issue(s))`,
          },
          meta: { ...meta, latencyMs: Date.now() - startedAt },
        };
      }
      return { ok: true, value: validated.data, rawText, meta: { ...meta, latencyMs: Date.now() - startedAt } };
    }

    return {
      ok: false,
      error: lastError ?? {
        category: 'UNAVAILABLE',
        code: 'model_unavailable',
        message: 'model call failed for an unknown bounded-retry reason',
      },
      meta: { ...baseMeta, attempt: this.maxAttempts },
    };
  }
}

/**
 * Extracts a JSON value from model text, tolerating code fences and
 * surrounding prose. Returns undefined rather than guessing on failure.
 */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const candidates: string[] = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1] !== undefined) candidates.push(fenced[1].trim());
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

/** Maps a ModelError category onto the shared capability error vocabulary. */
export function toCapabilityErrorCategory(
  category: ModelErrorCategory,
): 'NOT_CONFIGURED' | 'AUTH' | 'NETWORK' | 'TIMEOUT' | 'RATE_LIMITED' | 'INVALID_REQUEST' | 'PROVIDER_ERROR' | 'UNAVAILABLE' {
  switch (category) {
    case 'INVALID_OUTPUT':
      return 'INVALID_REQUEST';
    default:
      return category;
  }
}
