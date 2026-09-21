/**
 * A5 CP5 — demo readiness preflight (read-only, fail-closed).
 *
 * Reports whether a PostgreSQL workspace is structurally capable of reaching
 * approval/execution. Does not provision state, bypass authority/budget,
 * refresh quotes, or perform destructive bookings.
 *
 * Scenario-specific expected travellers (if any) are supplied by the caller
 * via options — application logic does not branch on hero names.
 */
import { loadConfig, hasLiveCredentials, type AppConfig } from '../../config/config.ts';
import type { Pool } from '../../persistence/postgres/pool.ts';
import { readEvaluationClock } from './evaluationClock.ts';
import { datasetProvisioningIdentity } from '../demo/provisionDataset.ts';
import { composeTargetIntelligence } from '../composeTargetIntelligence.ts';
import { composeOfferExecution } from './externalOfferExecution.ts';
import { composeStayExecution } from './externalStayExecution.ts';
import { ATLAS_SANDBOX_HOST } from '../../providers/atlas/transactionAdapter.ts';
import { workspacePrincipalId } from './workspaceAuthority.ts';
import { loadGrantsForPrincipal } from '../../persistence/postgres/execution/storedExecutionGate.ts';
import { AUTHORIZE_ACTION_KIND, DISPATCH_ACTION_KIND } from '../../resolution/authority/authorize.ts';

export interface DemoPreflightCheck {
  id: string;
  severity: 'required' | 'advisory';
  ok: boolean;
  detail: string;
}

export interface DemoPreflightReport {
  ok: boolean;
  workspaceId: string;
  checks: DemoPreflightCheck[];
  /** Convenience projection for operators. */
  summary: {
    requiredFailed: string[];
    advisoryFailed: string[];
  };
}

export interface DemoPreflightOptions {
  pool: Pool;
  workspaceId: string;
  /** When set, require a matching northstar:dataset:<key> source_records marker. */
  expectedDatasetKey?: string;
  /**
   * Optional display-name tokens that must each match at least one traveller
   * name in the workspace (case-insensitive contains). Supplied by harness /
   * operator config — never hardcoded in this module.
   */
  requiredTravellerNameTokens?: readonly string[];
  /** Minimum travellers / journeys for multi-subject demo coexistence. */
  minTravellers?: number;
  minJourneys?: number;
  cwd?: string;
  config?: AppConfig;
  env?: NodeJS.ProcessEnv;
  /** Wall clock for grant validity reads only. */
  now?: string;
}

function check(
  id: string,
  severity: 'required' | 'advisory',
  ok: boolean,
  detail: string,
): DemoPreflightCheck {
  return { id, severity, ok, detail };
}

async function count(pool: Pool, sql: string, params: unknown[]): Promise<number> {
  const result = await pool.query<{ n: string | number }>(sql, params);
  return Number(result.rows[0]?.n ?? 0);
}

/**
 * Run the read-only demo readiness preflight. `ok` is false when any
 * `required` check fails. Advisory checks never flip `ok` alone.
 */
export async function runDemoReadinessPreflight(options: DemoPreflightOptions): Promise<DemoPreflightReport> {
  const checks: DemoPreflightCheck[] = [];
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const config = options.config ?? loadConfig(env, cwd);
  const now = options.now ?? new Date().toISOString();
  const minTravellers = options.minTravellers ?? 2;
  const minJourneys = options.minJourneys ?? 2;

  // --- PostgreSQL workspace presence ---
  const workspaceRows = await options.pool.query<{ id: string }>(
    'SELECT id FROM workspaces WHERE id = $1',
    [options.workspaceId],
  );
  const workspaceOk = workspaceRows.rows.length === 1;
  checks.push(check(
    'postgres_workspace',
    'required',
    workspaceOk,
    workspaceOk ? `workspace ${options.workspaceId} present` : `workspace ${options.workspaceId} missing`,
  ));
  if (!workspaceOk) {
    return finalize(options.workspaceId, checks);
  }

  // --- Dataset marker ---
  if (options.expectedDatasetKey) {
    const identity = datasetProvisioningIdentity(options.expectedDatasetKey);
    const marker = await options.pool.query<{ content_hash: string }>(
      `SELECT content_hash FROM source_records
        WHERE workspace_id = $1 AND source_identity = $2 LIMIT 1`,
      [options.workspaceId, identity],
    );
    const ok = marker.rows.length === 1;
    checks.push(check(
      'dataset_marker',
      'required',
      ok,
      ok
        ? `dataset marker ${identity} present (hash ${marker.rows[0]!.content_hash.slice(0, 12)}…)`
        : `dataset marker ${identity} absent`,
    ));
  } else {
    const anyDataset = await count(
      options.pool,
      `SELECT COUNT(*)::int AS n FROM source_records
        WHERE workspace_id = $1 AND source_identity LIKE 'northstar:dataset:%'`,
      [options.workspaceId],
    );
    checks.push(check(
      'dataset_marker',
      'advisory',
      anyDataset > 0,
      anyDataset > 0
        ? `${anyDataset} dataset marker(s) present`
        : 'no northstar:dataset:* marker (set expectedDatasetKey to require one)',
    ));
  }

  // --- Travellers / journeys coexistence ---
  const travellerCount = await count(
    options.pool,
    'SELECT COUNT(*)::int AS n FROM travellers WHERE workspace_id = $1 AND lifecycle_status = $2',
    [options.workspaceId, 'ACTIVE'],
  );
  const journeyCount = await count(
    options.pool,
    'SELECT COUNT(*)::int AS n FROM journeys WHERE workspace_id = $1 AND lifecycle_status = $2',
    [options.workspaceId, 'ACTIVE'],
  );
  checks.push(check(
    'travellers_present',
    'required',
    travellerCount >= minTravellers,
    `active travellers=${travellerCount} (min ${minTravellers})`,
  ));
  checks.push(check(
    'journeys_present',
    'required',
    journeyCount >= minJourneys,
    `active journeys=${journeyCount} (min ${minJourneys})`,
  ));
  checks.push(check(
    'multi_traveller_coexistence',
    'required',
    travellerCount >= 2 && journeyCount >= 2,
    travellerCount >= 2 && journeyCount >= 2
      ? 'multiple travellers and journeys coexist in one workspace'
      : 'workspace does not yet hold multiple active travellers/journeys',
  ));

  if (options.requiredTravellerNameTokens && options.requiredTravellerNameTokens.length > 0) {
    const names = await options.pool.query<{ display_value: string | null; given_name: string | null; family_name: string | null }>(
      `SELECT display_value, given_name, family_name
         FROM traveller_names
        WHERE workspace_id = $1`,
      [options.workspaceId],
    );
    const haystack = names.rows
      .map((row) => [row.display_value, row.given_name, row.family_name].filter(Boolean).join(' '))
      .join(' | ')
      .toLowerCase();
    for (const token of options.requiredTravellerNameTokens) {
      const needle = token.trim().toLowerCase();
      if (!needle) continue;
      const found = haystack.includes(needle);
      checks.push(check(
        `traveller_name:${needle}`,
        'required',
        found,
        found ? `traveller name token "${token}" found` : `traveller name token "${token}" not found`,
      ));
    }
  }

  // --- Evaluation clock ---
  const clock = await readEvaluationClock(options.pool, options.workspaceId);
  checks.push(check(
    'evaluation_clock',
    'advisory',
    true,
    clock.mode === 'CONTROLLED'
      ? `CONTROLLED at ${clock.controlledNow}`
      : 'WALL (default) — demo overnight stages need CONTROLLED via progression harness',
  ));

  // --- Qwen / Model Studio ---
  const intelligence = composeTargetIntelligence(config);
  checks.push(check(
    'qwen_configured',
    'advisory',
    Boolean(intelligence),
    intelligence
      ? `configured provider=${intelligence.providerId} model=${intelligence.model} mode=${intelligence.mode}`
      : 'MODEL_STUDIO_API_KEY absent — planning continues without AI offer selection',
  ));

  // --- Atlas planning / protected execution ---
  const atlasCreds = hasLiveCredentials(config, 'atlas');
  checks.push(check(
    'atlas_planning_mode',
    'advisory',
    true,
    `ADAPTER_MODE=${config.adapterMode}; atlas credentials=${atlasCreds ? 'present' : 'absent'}`,
  ));
  const offerExecution = composeOfferExecution(config, cwd);
  let atlasHostOk = false;
  try {
    atlasHostOk = Boolean(config.providers.atlas.baseUrl)
      && new URL(config.providers.atlas.baseUrl!).hostname === ATLAS_SANDBOX_HOST;
  } catch {
    atlasHostOk = false;
  }
  checks.push(check(
    'atlas_protected_execution',
    'advisory',
    Boolean(offerExecution),
    offerExecution
      ? `composed (mode=${offerExecution.mode})`
      : `unavailable (needs ADAPTER_MODE=LIVE|RECORD + Atlas sandbox host ${ATLAS_SANDBOX_HOST} + credentials; hostOk=${atlasHostOk})`,
  ));

  // --- Nuitée ---
  const nuiteeCreds = hasLiveCredentials(config, 'nuitee');
  const stayExecution = composeStayExecution(config, cwd);
  checks.push(check(
    'nuitee_planning_execution',
    'advisory',
    Boolean(stayExecution) || config.adapterMode === 'REPLAY',
    stayExecution
      ? `stay execution composed (mode=${stayExecution.mode})`
      : `unavailable (NUITEE credentials=${nuiteeCreds ? 'present' : 'absent'}; adapterMode=${config.adapterMode})`,
  ));

  // --- Booking identities / execution bindings ---
  const bookingIdentities = await count(
    options.pool,
    'SELECT COUNT(*)::int AS n FROM traveller_booking_identities WHERE workspace_id = $1',
    [options.workspaceId],
  );
  const offerBindings = await count(
    options.pool,
    'SELECT COUNT(*)::int AS n FROM offer_execution_bindings WHERE workspace_id = $1',
    [options.workspaceId],
  );
  const stayBindings = await count(
    options.pool,
    'SELECT COUNT(*)::int AS n FROM stay_execution_bindings WHERE workspace_id = $1',
    [options.workspaceId],
  );
  checks.push(check(
    'traveller_booking_identities',
    'advisory',
    bookingIdentities > 0,
    `traveller_booking_identities=${bookingIdentities}`,
  ));
  checks.push(check(
    'execution_bindings',
    'advisory',
    true,
    `offer_execution_bindings=${offerBindings}; stay_execution_bindings=${stayBindings} (populated after planning)`,
  ));

  // --- Budgets ---
  const budgets = await count(
    options.pool,
    `SELECT COUNT(*)::int AS n FROM budgets WHERE workspace_id = $1`,
    [options.workspaceId],
  ).catch(() => -1);
  checks.push(check(
    'spend_budgets',
    'advisory',
    budgets !== 0,
    budgets < 0
      ? 'budgets table not readable in this schema snapshot'
      : `budget rows=${budgets}`,
  ));

  // --- Authority coverage ---
  const operatorId = workspacePrincipalId(options.workspaceId, 'operator');
  const executorId = workspacePrincipalId(options.workspaceId, 'executor');
  const operatorGrants = await loadGrantsForPrincipal(options.pool, options.workspaceId, operatorId, now);
  const executorGrants = await loadGrantsForPrincipal(options.pool, options.workspaceId, executorId, now);
  const authorizeOk = operatorGrants.some((g) => g.actions.includes(AUTHORIZE_ACTION_KIND));
  const dispatchOk = executorGrants.some((g) => g.actions.includes(DISPATCH_ACTION_KIND));
  checks.push(check(
    'authority_authorize',
    'required',
    authorizeOk,
    authorizeOk
      ? `operator ${operatorId} holds authorize grant(s)=${operatorGrants.length}`
      : `operator ${operatorId} lacks action.intent.authorize coverage`,
  ));
  checks.push(check(
    'authority_dispatch',
    'required',
    dispatchOk,
    dispatchOk
      ? `executor ${executorId} holds dispatch grant(s)=${executorGrants.length}`
      : `executor ${executorId} lacks action.intent.dispatch coverage`,
  ));

  // --- Research / quote freshness posture ---
  const researchMode = (env.NORTHSTAR_RECOVERY_RESEARCH_MODE ?? env.ADAPTER_MODE ?? config.adapterMode ?? '').toString();
  const freshQuotes = researchMode === 'LIVE' || researchMode === 'RECORD';
  checks.push(check(
    'provider_quote_freshness',
    'advisory',
    true,
    freshQuotes
      ? `research/adapter mode ${researchMode} can obtain fresh provider quotes`
      : `mode=${researchMode || 'unset'} — approval may require FRESH_PROVIDER_QUOTE_REQUIRED before destructive booking`,
  ));

  // --- Displaced destination stay readiness (structural) ---
  const heldStays = await count(
    options.pool,
    `SELECT COUNT(*)::int AS n
       FROM reservations r
      WHERE r.workspace_id = $1
        AND r.observed_status IN ('HELD', 'CONFIRMED')`,
    [options.workspaceId],
  ).catch(() => -1);
  checks.push(check(
    'displaced_stay_baseline',
    'advisory',
    heldStays !== 0,
    heldStays < 0
      ? 'reservations table not readable'
      : `HELD/CONFIRMED reservations=${heldStays}`,
  ));

  // --- Overnight research config ---
  const researchConfig = Boolean(env.NORTHSTAR_RECOVERY_RESEARCH_CONFIG?.trim());
  checks.push(check(
    'overnight_research_config',
    'advisory',
    researchConfig || config.adapterMode === 'REPLAY',
    researchConfig
      ? 'NORTHSTAR_RECOVERY_RESEARCH_CONFIG present'
      : 'NORTHSTAR_RECOVERY_RESEARCH_CONFIG absent (REPLAY may still plan from recordings)',
  ));

  return finalize(options.workspaceId, checks);
}

function finalize(workspaceId: string, checks: DemoPreflightCheck[]): DemoPreflightReport {
  const requiredFailed = checks.filter((c) => c.severity === 'required' && !c.ok).map((c) => c.id);
  const advisoryFailed = checks.filter((c) => c.severity === 'advisory' && !c.ok).map((c) => c.id);
  return {
    ok: requiredFailed.length === 0,
    workspaceId,
    checks,
    summary: { requiredFailed, advisoryFailed },
  };
}
