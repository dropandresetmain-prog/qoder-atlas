/**
 * R4 / G08 — compose Model Studio / Qwen into the normal PostgreSQL target boot.
 *
 * Honest rules:
 * - Composition depends on Model Studio credentials, NOT on Atlas ADAPTER_MODE.
 *   Atlas REPLAY must not silence a configured Qwen client (parity audit G08).
 * - Unconfigured → undefined (fail closed; planning continues without AI).
 * - OpenRouter remains out of scope for R4 (G19 Accept Risk).
 */
import type { AppConfig } from '../config/config.ts';
import {
  IntelligenceClient,
  MODEL_STUDIO_DEFAULT_BASE_URL,
  MODEL_STUDIO_DEFAULT_MODEL,
  MODEL_STUDIO_PROVIDER_ID,
} from '../intelligence/client.ts';

export function composeTargetIntelligence(config: AppConfig): IntelligenceClient | undefined {
  const studio = config.providers.modelStudio;
  const apiKey = studio.apiKey?.trim();
  if (!apiKey) return undefined;
  return new IntelligenceClient({
    providerId: MODEL_STUDIO_PROVIDER_ID,
    apiKey,
    model: studio.model ?? MODEL_STUDIO_DEFAULT_MODEL,
    baseUrl: studio.baseUrl ?? MODEL_STUDIO_DEFAULT_BASE_URL,
    timeoutMs: studio.timeoutMs ?? 45_000,
  });
}
