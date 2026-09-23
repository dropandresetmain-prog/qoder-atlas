/**
 * Data-driven pacing for founder video playback at provider/intelligence seams.
 */
import { loadConfig } from '../config/config.ts';
import { isDemoPlaybackActive } from '../config/demoPlayback.ts';

const PROVIDER_OPERATION_MS: Readonly<Record<string, number>> = {
  'atlas/verify': 1500,
  'atlas/order_create': 2500,
  'atlas/order_pay': 2500,
  'atlas/order_retrieve': 1200,
  'atlas/search': 800,
  'atlas/flight_state_query': 800,
  'nuitee/search': 800,
  'nuitee/quote': 900,
  'nuitee/book': 3500,
  'nuitee/cancel': 2500,
  'nuitee/retrieve': 1200,
  'nuitee/booking_lookup': 900,
  'nuitee/stay_context': 900,
  'frankfurter/fx.latest': 400,
  'google-routes/route_context': 500,
  'official-documents/document.read': 500,
  'model_studio/chat.completions': 7000,
};

const DEMO_CONTROL_STAGE_MS: Readonly<Record<string, number>> = {
  delay_begins_connection_viable: 2000,
  delay_increases_connection_at_risk: 2500,
  zg053_impossible: 800,
};

export const DEMO_PLAYBACK_AUTHORITY_PREP_MS = 1500;
export const DEMO_PLAYBACK_FINAL_REASSESSMENT_MS = 2500;

function scaledMs(baseMs: number, env: Record<string, string | undefined>): number {
  const config = loadConfig(env);
  const speed = config.demoPlaybackSpeed > 0 ? config.demoPlaybackSpeed : 1;
  return Math.max(0, Math.round(baseMs / speed));
}

export function demoPlaybackEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return isDemoPlaybackActive(loadConfig(env), env);
}

export async function sleepDemoPlaybackMs(
  baseMs: number,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (!demoPlaybackEnabled(env) || baseMs <= 0) return;
  const ms = scaledMs(baseMs, env);
  if (ms <= 0) return;
  await new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));
}

export async function sleepDemoPlaybackProviderOperation(
  providerId: string,
  operation: string,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (!demoPlaybackEnabled(env)) return;
  const key = `${providerId}/${operation}`;
  const base = PROVIDER_OPERATION_MS[key] ?? 600;
  await sleepDemoPlaybackMs(base, env);
}

export async function sleepDemoPlaybackControlStage(
  controlId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const base = DEMO_CONTROL_STAGE_MS[controlId];
  if (base === undefined) return;
  await sleepDemoPlaybackMs(base, env);
}
