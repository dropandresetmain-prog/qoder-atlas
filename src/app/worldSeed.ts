/**
 * World-seed policy: separates acceptance-harness scenario fixtures from the
 * canonical programme demo world without hardcoding scenario ids in domain
 * logic.
 *
 * Companion file `world-seed.json` beside `scenario.json`:
 *   { "role": "acceptance_harness" }  — skipped when WORLD_SEED_MODE=programme
 *   { "role": "demo_world" }          — always eligible for boot/reset seed
 * Absent file ⇒ treated as demo_world (back-compat for existing harnesses).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { AppConfig } from '../config/config.ts';

export const WorldSeedRoleSchema = z.enum(['demo_world', 'acceptance_harness']);
export type WorldSeedRole = z.infer<typeof WorldSeedRoleSchema>;

export const WorldSeedPolicySchema = z.strictObject({
  role: WorldSeedRoleSchema.default('demo_world'),
});
export type WorldSeedPolicy = z.infer<typeof WorldSeedPolicySchema>;

export type WorldSeedMode = 'full' | 'programme';

/** Resolve boot/reset world-seed mode from config + optional env override. */
export function resolveWorldSeedMode(
  config: Pick<AppConfig, 'environment' | 'worldSeedMode'>,
): WorldSeedMode {
  if (config.worldSeedMode) return config.worldSeedMode;
  // Deployed demo defaults to the canonical programme world only.
  return config.environment === 'demo' ? 'programme' : 'full';
}

/** Read optional companion policy; missing file => demo_world. */
export function loadWorldSeedPolicy(scenarioDir: string): WorldSeedPolicy {
  const path = join(scenarioDir, 'world-seed.json');
  if (!existsSync(path)) return { role: 'demo_world' };
  return WorldSeedPolicySchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Whether a scenario directory should participate in empty-store boot / reset
 * seeding for the active world-seed mode.
 */
export function shouldBootSeedScenario(scenarioDir: string, mode: WorldSeedMode): boolean {
  if (mode === 'full') return true;
  const policy = loadWorldSeedPolicy(scenarioDir);
  return policy.role !== 'acceptance_harness';
}
