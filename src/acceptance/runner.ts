/**
 * Generic acceptance scenario runner.
 *
 * Orchestration/evidence tooling only: executes declarative manifests through
 * real HTTP/application boundaries. Contains no recovery or business
 * decisions — Northstar decides what submitted inputs mean.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { loadConfig, type AppConfig } from '../config/config.ts';
import { composeAppRuntime } from '../app/compose.ts';
import { createAppServer } from '../server/http.ts';
import { sanitizeRaw } from '../providers/sanitize.ts';
import { EvidenceBuilder, type ScenarioEvidence } from './evidence.ts';
import { hashDirectory, hashFile, hashValue } from './hashes.ts';
import {
  loadAcceptanceManifest,
  resolveManifestPath,
  resolvePackPath,
  type ManifestStep,
} from './manifest.ts';
import { adapterModeFor, isSimulatedExternal, type ScenarioExecutionMode } from './modes.ts';
import { runPreflight, type PreflightReport } from './preflight.ts';

export interface RunnerOptions {
  manifestPath: string;
  /** Override run mode (must still be declared in manifest boundaries for LIVE claims). */
  mode?: ScenarioExecutionMode;
  cwd?: string;
  evidenceDir?: string;
  /** When set, talk to an already-running server instead of embedding one. */
  baseUrl?: string;
  /** Skip preflight (tests may supply a known-good env). */
  skipPreflight?: boolean;
  /** Inject config (tests). */
  config?: AppConfig;
  env?: Record<string, string | undefined>;
  secrets?: ReadonlyArray<string>;
}

export interface RunnerResult {
  evidence: ScenarioEvidence;
  evidencePath: string;
  preflight?: PreflightReport;
  baseUrl: string;
}

type Bindings = Record<string, string>;

interface HttpResult {
  status: number;
  body: unknown;
  latencyMs: number;
}

/**
 * Execute one acceptance manifest end-to-end through HTTP product surfaces.
 */
export async function runAcceptanceManifest(options: RunnerOptions): Promise<RunnerResult> {
  const cwd = options.cwd ?? process.cwd();
  const manifestPath = resolveManifestPath(options.manifestPath, cwd);
  const manifest = loadAcceptanceManifest(manifestPath);
  const mode = options.mode ?? manifest.mode;
  const evidenceDir = options.evidenceDir ?? join(cwd, 'output', 'acceptance');
  mkdirSync(evidenceDir, { recursive: true });

  const preflight = options.skipPreflight
    ? undefined
    : runPreflight({
        manifestPath,
        cwd,
        evidenceDir,
        ...(options.config ? { config: options.config } : {}),
        ...(options.env ? { env: options.env } : {}),
      });
  if (preflight && !preflight.ok) {
    const failed = preflight.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`);
    throw new Error(`preflight failed:\n${failed.join('\n')}`);
  }

  const config =
    options.config ??
    AppConfigWithMode(
      loadConfig(options.env ?? process.env, cwd),
      adapterModeFor(mode),
    );

  const globalPath = resolvePackPath(manifestPath, manifest.globalInputPack.path);
  const localPath = resolvePackPath(manifestPath, manifest.localInputPack.path);
  const builder = new EvidenceBuilder({
    runId: `run_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    scenarioId: manifest.scenarioId,
    gitSha: readGitSha(cwd),
    mode,
    globalInputPack: {
      packId: manifest.globalInputPack.packId,
      version: manifest.globalInputPack.version,
      hash: hashDirectory(globalPath) ?? hashFile(globalPath),
    },
    localInputPack: {
      packId: manifest.localInputPack.packId,
      version: manifest.localInputPack.version,
      hash: hashDirectory(localPath) ?? hashFile(localPath),
    },
  });
  builder.mergeCanonicalIds(manifest.expect);

  for (const boundary of manifest.boundaries) {
    builder.addInputProvenance({
      mode: boundary.mode,
      simulatedExternal: isSimulatedExternal(boundary.mode),
      source: boundary.seam,
      ...(boundary.note ? {} : {}),
    });
  }

  let baseUrl = options.baseUrl;
  let closeServer: (() => Promise<void>) | undefined;
  let composedDbClose: (() => void) | undefined;

  if (!baseUrl) {
    const composed = await composeAppRuntime(config);
    const server = createAppServer(config, composed.endpoints);
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    composedDbClose = () => composed.db.close();
    closeServer = () =>
      new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
  }

  const bindings: Bindings = {
    scenarioId: manifest.scenarioId,
    mode,
  };
  for (const id of manifest.expect.travellerIds) bindings[`traveller:${id}`] = id;
  for (const id of manifest.expect.tripIds) bindings[`trip:${id}`] = id;
  for (const id of manifest.expect.anchorEventIds) bindings[`anchor:${id}`] = id;

  const secrets = options.secrets ?? collectSecrets(config);

  try {
    for (const step of manifest.steps) {
      await executeStep({
        step,
        baseUrl: baseUrl!,
        bindings,
        builder,
        secrets,
        mode,
      });
    }
  } catch (error) {
    builder.fail(error instanceof Error ? error.message : String(error));
  } finally {
    if (closeServer) await closeServer();
    if (composedDbClose) composedDbClose();
  }

  const evidence = builder.finish();
  const evidencePath = join(evidenceDir, `${evidence.scenarioId}_${evidence.runId}.json`);
  const sanitized = sanitizeRaw(evidence, secrets);
  writeFileSync(evidencePath, `${JSON.stringify(sanitized, null, 2)}\n`, 'utf8');
  return { evidence, evidencePath, baseUrl: baseUrl!, ...(preflight ? { preflight } : {}) };
}

async function executeStep(input: {
  step: ManifestStep;
  baseUrl: string;
  bindings: Bindings;
  builder: EvidenceBuilder;
  secrets: ReadonlyArray<string>;
  mode: ScenarioExecutionMode;
}): Promise<void> {
  const { step, baseUrl, bindings, builder, secrets, mode } = input;
  const startedAt = new Date().toISOString();
  const action = step.action;

  try {
    let http: HttpResult;
    let provenanceMode: ScenarioExecutionMode = mode;
    let source = String(action.type);
    let requestPayload: unknown;

    switch (action.type) {
      case 'http': {
        provenanceMode = action.provenance ?? mode;
        source = `http:${action.method}:${action.path}`;
        requestPayload = action.body;
        http = await invokeHttp(baseUrl, {
          method: action.method,
          path: substituteString(action.path, bindings),
          body: substituteValue(action.body, bindings),
          query: action.query
            ? Object.fromEntries(
                Object.entries(action.query).map(([k, v]) => [k, substituteString(v, bindings)]),
              )
            : undefined,
        });
        assertStatus(http.status, action.expectStatus, step.id, http.body);
        applyCaptures(action.capture, http.body, bindings);
        break;
      }
      case 'traveller_message': {
        provenanceMode = action.provenance ?? mode;
        source = 'http:POST:/api/traveller/change-request';
        requestPayload = {
          travellerId: substituteString(action.travellerId, bindings),
          tripId: substituteString(action.tripId, bindings),
          text: substituteString(action.text, bindings),
          at: action.at,
        };
        http = await invokeHttp(baseUrl, {
          method: 'POST',
          path: '/api/traveller/change-request',
          body: requestPayload,
        });
        assertStatus(http.status, action.expectStatus, step.id, http.body);
        applyCaptures(action.capture, http.body, bindings);
        break;
      }
      case 'ui_action': {
        provenanceMode = action.provenance ?? mode;
        const resolved = resolveUiAction(action.kind, action.params, action.at, bindings);
        source = `ui:${action.kind}:${resolved.path}`;
        requestPayload = resolved.body;
        http = await invokeHttp(baseUrl, {
          method: resolved.method,
          path: resolved.path,
          body: resolved.body,
        });
        assertStatus(http.status, action.expectStatus, step.id, http.body);
        applyCaptures(action.capture, http.body, bindings);
        break;
      }
      case 'simulated_external_event': {
        provenanceMode = 'SIMULATED_EXTERNAL_EVENT';
        source = `simulated_external_event:${action.path}`;
        requestPayload = action.body;
        http = await invokeHttp(baseUrl, {
          method: 'POST',
          path: substituteString(action.path, bindings),
          body: substituteValue(action.body, bindings),
          query: action.query
            ? Object.fromEntries(
                Object.entries(action.query).map(([k, v]) => [k, substituteString(v, bindings)]),
              )
            : undefined,
        });
        assertStatus(http.status, action.expectStatus, step.id, http.body);
        applyCaptures(action.capture, http.body, bindings);
        if (!builder.current().incomingTrigger) {
          builder.setIncomingTrigger({
            kind: 'SIMULATED_EXTERNAL_EVENT',
            path: action.path,
            body: sanitizeRaw(requestPayload, secrets),
          });
        }
        break;
      }
      case 'observe': {
        source = `observe:${action.path}`;
        http = await invokeHttp(baseUrl, {
          method: 'GET',
          path: substituteString(action.path, bindings),
        });
        assertStatus(http.status, action.expectStatus, step.id, http.body);
        applyCaptures(action.capture, http.body, bindings);
        break;
      }
      default: {
        const _exhaustive: never = action;
        throw new Error(`unknown action: ${JSON.stringify(_exhaustive)}`);
      }
    }

    const finishedAt = new Date().toISOString();
    const responseSanitized = sanitizeRaw(http.body, secrets);
    const provenance = {
      mode: provenanceMode,
      simulatedExternal: isSimulatedExternal(provenanceMode),
      source,
    };

    builder.addExternalCall({
      stepId: step.id,
      operation: source,
      requestSummary: sanitizeRaw(summarize(requestPayload), secrets),
      responseRef: `step:${step.id}:response`,
      provenance,
      ok: http.status >= 200 && http.status < 300,
      status: http.status,
      latencyMs: http.latencyMs,
    });

    harvestIds(http.body, builder);
    harvestStageFields(step.id, action.type, http.body, builder, finishedAt);

    if (action.type === 'http' && action.path.includes('/runtime/reset')) {
      builder.setResetChecksum(hashValue(http.body));
    }

    builder.recordStep({
      stepId: step.id,
      ...(step.description ? { description: step.description } : {}),
      startedAt,
      finishedAt,
      ok: true,
      actionType: action.type,
      provenance,
      request: sanitizeRaw(requestPayload, secrets),
      response: responseSanitized,
    });
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    builder.recordStep({
      stepId: step.id,
      ...(step.description ? { description: step.description } : {}),
      startedAt,
      finishedAt,
      ok: false,
      actionType: step.action.type,
      error: message,
    });
    throw error;
  }
}

function resolveUiAction(
  kind: string,
  params: Record<string, unknown>,
  at: string | undefined,
  bindings: Bindings,
): { method: 'GET' | 'POST'; path: string; body?: unknown } {
  const p = (key: string): string => {
    const value = params[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`ui_action ${kind} requires string param ${key}`);
    }
    return substituteString(value, bindings);
  };

  switch (kind) {
    case 'organiser_preview':
      return {
        method: 'POST',
        path: `/api/programme/${p('anchorEventId')}/change-preview`,
        body: {
          commitmentId: p('commitmentId'),
          changeKind: params['changeKind'] ?? 'RESCHEDULED',
          newStartsAt: p('newStartsAt'),
          newEndsAt: p('newEndsAt'),
          at: at ?? p('at'),
        },
      };
    case 'organiser_commit':
      return {
        method: 'POST',
        path: `/api/programme/${p('anchorEventId')}/change-commit`,
        body: {
          commitmentId: p('commitmentId'),
          changeKind: params['changeKind'] ?? 'RESCHEDULED',
          newStartsAt: p('newStartsAt'),
          newEndsAt: p('newEndsAt'),
          at: at ?? p('at'),
        },
      };
    case 'traveller_approve':
      return {
        method: 'POST',
        path: `/api/cases/${p('caseId')}/traveller-decision`,
        body: { decision: 'APPROVED', ...(params['note'] ? { note: params['note'] } : {}) },
      };
    case 'traveller_decline':
      return {
        method: 'POST',
        path: `/api/cases/${p('caseId')}/traveller-decision`,
        body: { decision: 'DECLINED', ...(params['note'] ? { note: params['note'] } : {}) },
      };
    case 'traveller_text':
      return {
        method: 'POST',
        path: '/api/traveller/change-request',
        body: {
          travellerId: p('travellerId'),
          tripId: p('tripId'),
          text: p('text'),
          at: at ?? p('at'),
        },
      };
    default:
      throw new Error(`unsupported ui_action kind: ${kind}`);
  }
}

async function invokeHttp(
  baseUrl: string,
  request: {
    method: string;
    path: string;
    body?: unknown;
    query?: Record<string, string>;
  },
): Promise<HttpResult> {
  const url = new URL(request.path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (request.query) {
    for (const [key, value] of Object.entries(request.query)) {
      url.searchParams.set(key, value);
    }
  }
  const started = performance.now();
  const init: RequestInit = { method: request.method, headers: { accept: 'application/json' } };
  if (request.body !== undefined && request.method !== 'GET') {
    init.headers = { ...init.headers, 'content-type': 'application/json' };
    init.body = JSON.stringify(request.body);
  }
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { status: response.status, body, latencyMs: Math.round(performance.now() - started) };
}

function assertStatus(actual: number, expected: number, stepId: string, body?: unknown): void {
  if (actual !== expected) {
    // Carry the response body into the failure message: engine rejections
    // (4xx) explain themselves there, and evidence for failed steps otherwise
    // records only the error string.
    const detail =
      body === undefined || body === null ? '' : `; response=${JSON.stringify(summarize(body))}`;
    throw new Error(`step ${stepId}: expected HTTP ${expected}, got ${actual}${detail}`);
  }
}

function applyCaptures(
  capture: Record<string, string> | undefined,
  body: unknown,
  bindings: Bindings,
): void {
  if (!capture) return;
  for (const [name, path] of Object.entries(capture)) {
    const value = getPath(body, path);
    if (value === undefined || value === null) {
      throw new Error(`capture ${name} missing at path ${path}`);
    }
    bindings[name] = String(value);
  }
}

function getPath(value: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = value;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const index = Number(part);
      cur = cur[index];
      continue;
    }
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function substituteString(template: string, bindings: Bindings): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.:-]+)\s*\}\}/g, (_match, key: string) => {
    if (!(key in bindings)) {
      throw new Error(`unresolved binding {{${key}}}`);
    }
    return bindings[key]!;
  });
}

function substituteValue(value: unknown, bindings: Bindings): unknown {
  if (typeof value === 'string') return substituteString(value, bindings);
  if (Array.isArray(value)) return value.map((item) => substituteValue(item, bindings));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = substituteValue(child, bindings);
    }
    return out;
  }
  return value;
}

function harvestIds(body: unknown, builder: EvidenceBuilder): void {
  if (!body || typeof body !== 'object') return;
  const record = body as Record<string, unknown>;
  const caseIds: string[] = [];
  const tripIds: string[] = [];
  if (typeof record['caseId'] === 'string') caseIds.push(record['caseId']);
  if (typeof record['tripId'] === 'string') tripIds.push(record['tripId']);
  const results = record['results'];
  if (Array.isArray(results)) {
    for (const item of results) {
      if (item && typeof item === 'object') {
        const row = item as Record<string, unknown>;
        if (typeof row['caseId'] === 'string') caseIds.push(row['caseId']);
        if (typeof row['tripId'] === 'string') tripIds.push(row['tripId']);
      }
    }
  }
  const processed = record['processedSignals'];
  if (Array.isArray(processed)) {
    for (const item of processed) {
      if (item && typeof item === 'object') {
        const row = item as Record<string, unknown>;
        if (typeof row['caseId'] === 'string') caseIds.push(row['caseId']);
        if (typeof row['tripId'] === 'string') tripIds.push(row['tripId']);
      }
    }
  }
  builder.mergeCanonicalIds({ caseIds, tripIds });
}

function harvestStageFields(
  stepId: string,
  actionType: string,
  body: unknown,
  builder: EvidenceBuilder,
  at: string,
): void {
  if (!body || typeof body !== 'object') return;
  const record = body as Record<string, unknown>;

  if (record['severity'] !== undefined || record['directFailureIds'] !== undefined) {
    builder.patch({
      impactBlastRadius: {
        severity: record['severity'],
        directFailureIds: record['directFailureIds'],
        threatenedObjectiveIds: record['threatenedObjectiveIds'],
        affectedCount: Array.isArray(record['affected']) ? record['affected'].length : undefined,
      },
    });
  }
  if (record['strategies'] !== undefined || record['bestStrategyId'] !== undefined) {
    builder.patch({
      strategies: {
        bestStrategyId: record['bestStrategyId'],
        strategies: record['strategies'],
        uncertainties: record['uncertainties'],
        rationale: record['rationale'],
      },
      viabilityResults: {
        feasibleCount: Array.isArray(record['strategies'])
          ? (record['strategies'] as Array<Record<string, unknown>>).filter((s) => s['feasible'] === true).length
          : undefined,
        strategies: record['strategies'],
      },
    });
  }
  if (record['outcome'] !== undefined && record['intentId'] !== undefined) {
    builder.patch({ policyAuthorityResult: { outcome: record['outcome'], intentId: record['intentId'] } });
  }
  if (record['verdict'] !== undefined || record['decision'] !== undefined) {
    builder.patch({ approvalDecision: body });
  }
  if (record['executed'] !== undefined || record['simulated'] !== undefined) {
    builder.patch({
      actionExecution: body,
      providerObservation: {
        simulated: record['simulated'],
        caseStatus: record['caseStatus'],
        resolutionOutcome: record['resolutionOutcome'],
      },
    });
  }
  if (record['status'] !== undefined && record['resolutionOutcome'] !== undefined) {
    builder.patch({ finalCaseState: body });
  }
  if (record['remainderViable'] !== undefined || record['viability'] !== undefined) {
    builder.patch({ finalTripViability: body });
  }
  if (record['uncertainties'] !== undefined) {
    builder.patch({ unresolvedUncertainty: record['uncertainties'] });
  }

  builder.addStateTransition({
    stepId,
    at,
    summary: `${actionType} completed`,
    detail: summarize(body),
  });
}

function summarize(value: unknown): unknown {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value);
  if (text !== undefined && text.length > 4000) {
    return {
      truncated: true,
      sha256: createHash('sha256').update(text).digest('hex'),
      preview: text.slice(0, 500),
    };
  }
  return value;
}

function collectSecrets(config: AppConfig): string[] {
  const values = [
    config.providers.atlas.clientId,
    config.providers.atlas.clientSecret,
    config.providers.modelStudio.apiKey,
    config.providers.googleRoutes.apiKey,
    config.providers.nuitee.apiKey,
  ];
  return values.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function readGitSha(cwd: string): string {
  try {
    return execSync('git rev-parse HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8')
      .trim();
  } catch {
    return 'unknown';
  }
}

function AppConfigWithMode(config: AppConfig, adapterMode: AppConfig['adapterMode']): AppConfig {
  return { ...config, adapterMode };
}
