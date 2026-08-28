/**
 * Demo-only populated-world orchestration (R2.2).
 *
 * Drives the frozen R2.1 entry-state contract through existing acceptance
 * manifest steps and normal HTTP/application boundaries. Scenario IDs, manifest
 * paths, and step ids are allowed here — never in domain/engine logic.
 */
import { join, resolve } from 'node:path';
import type { AppConfig } from '../config/config.ts';
import type { IsoDateTime } from '../domain/common.ts';
import { runAcceptanceManifest } from '../acceptance/runner.ts';
import { loadAcceptanceManifest, resolveManifestPath } from '../acceptance/manifest.ts';

/** Single shared reset instant for the populated demo world (§9.1). */
export const POPULATED_DEMO_RESET_AT: IsoDateTime = '2026-09-21T09:00:00+08:00';

/** Resolve anchor event id from the frozen prefix manifests (no literal fixture ids here). */
export function resolvePopulatedDemoAnchorEventId(cwd: string = process.cwd()): string {
  const manifestPath = POPULATED_DEMO_PREFIXES[0]!.manifestPath;
  const manifest = loadAcceptanceManifest(resolveManifestPath(manifestPath, cwd));
  const anchorEventId = manifest.expect.anchorEventIds?.[0];
  if (!anchorEventId) {
    throw new Error(`populated demo: ${manifestPath} missing expect.anchorEventIds[0]`);
  }
  return anchorEventId;
}

/** Judge-facing overview URL after reset (event id from manifest expect). */
export function resolvePopulatedDemoOverviewPath(cwd: string = process.cwd()): string {
  return `/operator?event=${encodeURIComponent(resolvePopulatedDemoAnchorEventId(cwd))}`;
}

/** One scenario prefix in the canonical §9.1 order. */
export interface PopulatedDemoPrefix {
  /** Stable prefix id for evidence/logging (demo-only). */
  id: string;
  manifestPath: string;
  /** Run through this manifest step id inclusive. */
  throughStepId: string;
}

/**
 * Frozen prefix pipeline — order matters (S8 after S1 for draft-30 coexistence).
 * Manifest paths and step ids verified against fixtures/acceptance/manifests.
 */
export const POPULATED_DEMO_PREFIXES: readonly PopulatedDemoPrefix[] = [
  {
    id: 's1',
    manifestPath: 'fixtures/acceptance/manifests/s1-airline-schedule-change.json',
    throughStepId: 'observe_group_a',
  },
  {
    id: 's7',
    manifestPath: 'fixtures/acceptance/manifests/s7-origin-tokyo.json',
    throughStepId: 'begin',
  },
  {
    id: 's4',
    manifestPath: 'fixtures/acceptance/manifests/s4-thursday-morning-arrival.json',
    throughStepId: 'plan',
  },
  {
    id: 's5',
    manifestPath: 'fixtures/acceptance/manifests/s5-stay-until-sunday.json',
    throughStepId: 'begin',
  },
  {
    id: 's6',
    manifestPath: 'fixtures/acceptance/manifests/s6-switch-hotels.json',
    throughStepId: 'plan',
  },
  {
    id: 's8',
    manifestPath: 'fixtures/acceptance/manifests/s8-travel-with-speakers.json',
    throughStepId: 'observe_case',
  },
  {
    id: 's2',
    manifestPath: 'fixtures/acceptance/manifests/s2-missed-connection.json',
    throughStepId: 'zg053_impossible_retiming',
  },
];

export interface PopulatedDemoWorldOptions {
  baseUrl: string;
  config: AppConfig;
  cwd?: string;
  /** When true, semantic manifest assertions are enforced (tests). */
  enforceAssertions?: boolean;
  evidenceDir?: string;
}

export interface PopulatedDemoPrefixOutcome {
  prefixId: string;
  scenarioId: string;
  ok: boolean;
  stepsRun: number;
  evidencePath: string;
  errors: string[];
}

export interface PopulatedDemoWorldOutcome {
  ok: boolean;
  resetAt: IsoDateTime;
  redirectTo: string;
  prefixes: PopulatedDemoPrefixOutcome[];
  error?: string;
}

/** Resolve stop-before step ids for running through `throughStepId` inclusive. */
export function stopBeforeStepIdsForPrefix(
  manifestPath: string,
  throughStepId: string,
  cwd: string = process.cwd(),
): string[] {
  const resolved = resolveManifestPath(manifestPath, cwd);
  const manifest = loadAcceptanceManifest(resolved);
  const index = manifest.steps.findIndex((step) => step.id === throughStepId);
  if (index < 0) {
    throw new Error(`populated demo prefix: unknown throughStepId ${throughStepId} in ${manifestPath}`);
  }
  const next = manifest.steps[index + 1];
  return next ? [next.id] : [];
}

async function invokeSharedReset(baseUrl: string, at: IsoDateTime): Promise<void> {
  const response = await fetch(`${baseUrl}/api/runtime/reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ at }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`populated demo reset failed (${response.status}): ${body}`);
  }
}

/**
 * Single reset → ordered scenario prefixes → populated authoritative state.
 * Uses the live server base URL; does not open a second embedded server.
 */
export async function runPopulatedDemoWorld(
  options: PopulatedDemoWorldOptions,
): Promise<PopulatedDemoWorldOutcome> {
  const cwd = options.cwd ?? resolve('.');
  const evidenceRoot = options.evidenceDir ?? join(cwd, 'output', 'demo-populated-world');
  const prefixes: PopulatedDemoPrefixOutcome[] = [];

  try {
    await invokeSharedReset(options.baseUrl, POPULATED_DEMO_RESET_AT);

    for (const prefix of POPULATED_DEMO_PREFIXES) {
      const stopBeforeStepIds = stopBeforeStepIdsForPrefix(prefix.manifestPath, prefix.throughStepId, cwd);
      const manifestPath = resolveManifestPath(prefix.manifestPath, cwd);
      const manifest = loadAcceptanceManifest(manifestPath);
      const result = await runAcceptanceManifest({
        manifestPath: prefix.manifestPath,
        cwd,
        baseUrl: options.baseUrl,
        skipPreflight: true,
        config: options.config,
        skipStepIds: ['reset'],
        stopBeforeStepIds,
        skipAssertions: options.enforceAssertions !== true,
        evidenceDir: join(evidenceRoot, prefix.id),
      });
      const failed = result.evidence.steps.filter((step) => !step.ok);
      const stepsRun = result.evidence.steps.filter(
        (step) => !String(step.error ?? '').startsWith('skipped:'),
      ).length;
      prefixes.push({
        prefixId: prefix.id,
        scenarioId: manifest.scenarioId,
        ok: result.evidence.ok && failed.length === 0,
        stepsRun,
        evidencePath: result.evidencePath,
        errors: failed.map((step) => `${step.stepId}: ${step.error ?? 'failed'}`),
      });
      if (failed.length > 0) {
    return {
      ok: false,
      resetAt: POPULATED_DEMO_RESET_AT,
      redirectTo: resolvePopulatedDemoOverviewPath(cwd),
      prefixes,
      error: `prefix ${prefix.id} failed: ${failed[0]!.stepId}`,
    };
      }
    }

    return {
      ok: true,
      resetAt: POPULATED_DEMO_RESET_AT,
      redirectTo: resolvePopulatedDemoOverviewPath(cwd),
      prefixes,
    };
  } catch (error) {
    return {
      ok: false,
      resetAt: POPULATED_DEMO_RESET_AT,
      redirectTo: resolvePopulatedDemoOverviewPath(cwd),
      prefixes,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
