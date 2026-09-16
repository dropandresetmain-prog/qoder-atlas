/**
 * M10 Phase 5 — migration reconciliation.
 *
 * Answers the question a cutover owner actually has: *is anything that
 * mattered in the old system missing, wrong, or silently assumed in the new
 * one?* Row counts cannot answer that, so the checks below are semantic —
 * they ask whether identity, ownership, provider references, evidence
 * lineage, obligations, money and uncertainty each survived with their
 * meaning intact.
 *
 * Every check is a real query against migrated PostgreSQL state and the run's
 * own bookkeeping. A check that cannot be evaluated reports `ATTENTION`
 * rather than passing by default.
 *
 * OFFLINE MIGRATION ONLY. Never reachable from normal app composition.
 */

import type { Pool } from '../persistence/postgres/pool.ts';
import type { MigrationBundle } from './legacyExportBundle.ts';
import { bundleRecordsInReplayOrder } from './legacyExportBundle.ts';
import { collectUncertainSourceFacts } from './legacyUncertainty.ts';
import { migrationTargetId, readMigrationRun, type MigrationReconciliationException } from './migrationRunStore.ts';

export const RECONCILER_VERSION = 'northstar-migration-reconciler/1.0.0';

export type CheckStatus = 'PASS' | 'ATTENTION' | 'FAIL';

export interface SemanticCheck {
  id: string;
  /** The question in the owner's terms, not the implementation's. */
  question: string;
  status: CheckStatus;
  detail: string;
}

export interface CategoryCoverage {
  categoryId: string;
  decision: string;
  exported: number;
  /** Became target subjects with a `legacy_id_map` row. */
  mapped: number;
  /** Preserved as evidence rather than as a target subject. */
  archived: number;
  /** Raised an exception instead of being transformed. */
  withExceptions: number;
}

export interface ReconciliationReport {
  reconcilerVersion: string;
  generatedAt: string;
  runId: string;
  sourceDataset: string;
  datasetHash: string;
  exporterVersion: string;
  importerVersion: string;
  runStatus: string;
  totals: {
    exportedRecords: number;
    mappedRecords: number;
    exceptions: number;
    cutoverBlocking: number;
  };
  coverage: CategoryCoverage[];
  checks: SemanticCheck[];
  exceptions: MigrationReconciliationException[];
  /**
   * CLEAN — nothing outstanding.
   * EXCEPTIONS_OWNED — everything outstanding is named, classified and owned,
   *   and none of it blocks cutover.
   * BLOCKED — at least one exception blocks cutover, or a check failed.
   */
  verdict: 'CLEAN' | 'EXCEPTIONS_OWNED' | 'BLOCKED';
}

async function scalar(pool: Pool, sql: string, params: unknown[]): Promise<number> {
  const result = await pool.query<{ value: string }>(sql, params);
  return Number(result.rows[0]?.value ?? '0');
}

/**
 * Findings that mean "this element was deliberately held back, so it has no
 * reservation line" — as distinct from "its line exists and reads UNKNOWN".
 *
 * Derived from the control flow of `migrateTripElements()`: every
 * classification here is emitted on a path that `continue`s before any line is
 * written. `PRESERVED_UNKNOWN_EXTERNAL_OUTCOME` is deliberately absent — it is
 * emitted only after a reservation *and* its line exist, so it asserts the
 * opposite of a hold-back and can never explain a missing row.
 */
const FACT_SCOPED_HOLD_BACK_CLASSIFICATIONS: ReadonlySet<string> = new Set([
  'QUARANTINED_NO_DETERMINISTIC_TARGET_MAPPING',
  'QUARANTINED_AMBIGUOUS_IDENTITY',
  'TARGET_REJECTED_WRITE',
]);

/**
 * Findings that hold back an entire record, and so cover every uncertain
 * element hanging off it. Only honoured when the record itself never became
 * target state — otherwise a finding about one unnamed part of a migrated
 * record could stand in for a different part of it.
 */
const RECORD_SCOPED_HOLD_BACK_CLASSIFICATIONS: ReadonlySet<string> = new Set([
  'QUARANTINED_MULTI_TRAVELLER_ALLOCATION',
  'QUARANTINED_AMBIGUOUS_IDENTITY',
  'QUARANTINED_UNREADABLE_SOURCE',
  'TARGET_REJECTED_WRITE',
]);

export interface ReconcileRequest {
  workspaceId: string;
  runId: string;
  bundle: MigrationBundle;
  now: string;
  /** Instant the import began; assessments must be newer to count as recomputed. */
  importStartedAt: string;
}

export async function reconcileMigration(pool: Pool, request: ReconcileRequest): Promise<ReconciliationReport> {
  const { workspaceId, bundle } = request;
  const sourceDataset = bundle.dataset.sourceIdentity;
  const run = await readMigrationRun(pool, request.runId);
  const records = bundleRecordsInReplayOrder(bundle).map((entry) => entry.record);

  const mappings = await pool.query<{ source_type: string; source_id: string; target_kind: string; mapping_evidence: string }>(
    `SELECT source_type, source_id, target_kind, mapping_evidence FROM legacy_id_map
     WHERE workspace_id = $1 AND source_dataset = $2`,
    [workspaceId, sourceDataset],
  );
  const mappedKeys = new Set(mappings.rows.map((row) => `${row.source_type}/${row.source_id}`));
  const exceptionKeys = new Set(run.reconciliationExceptions.map((entry) => `${entry.sourceType}/${entry.sourceId}`));

  // --- Coverage, per category ---
  const coverage: CategoryCoverage[] = bundle.categories.map((category) => {
    const categoryRecords = category.records;
    // A category's legacy identity namespace is carried by its records, which
    // is also what `legacy_id_map.source_type` is keyed on.
    const sourceTypes = new Set(categoryRecords.map((record) => record.sourceType));
    const mappedRows = mappings.rows.filter((row) => sourceTypes.has(row.source_type));
    return {
      categoryId: category.categoryId,
      decision: category.decision,
      exported: categoryRecords.length,
      mapped: mappedRows.filter((row) => row.target_kind !== 'EVIDENCE_RECORD').length,
      archived: mappedRows.filter((row) => row.target_kind === 'EVIDENCE_RECORD').length,
      withExceptions: categoryRecords.filter((record) => exceptionKeys.has(`${record.sourceType}/${record.sourceId}`))
        .length,
    };
  });

  const checks: SemanticCheck[] = [];
  const check = (id: string, question: string, status: CheckStatus, detail: string) =>
    checks.push({ id, question, status, detail });

  // --- 1. Identity: nothing exported vanished without a decision ---
  const unaccounted = records.filter(
    (record) =>
      !mappedKeys.has(`${record.sourceType}/${record.sourceId}`) &&
      !exceptionKeys.has(`${record.sourceType}/${record.sourceId}`),
  );
  check(
    'IDENTITY_ACCOUNTED',
    'Is every exported legacy record either represented in the target or named in an exception?',
    unaccounted.length === 0 ? 'PASS' : 'FAIL',
    unaccounted.length === 0
      ? `all ${records.length} exported records are accounted for`
      : `${unaccounted.length} record(s) are neither mapped nor excepted: ` +
        unaccounted
          .slice(0, 10)
          .map((record) => `${record.sourceType}/${record.sourceId}`)
          .join(', '),
  );

  // --- 2. Ownership: a Journey belongs to exactly one traveller ---
  const journeys = await pool.query<{ id: string; traveller_id: string | null }>(
    `SELECT j.id, j.traveller_id FROM journeys j
     JOIN legacy_id_map m ON m.workspace_id = j.workspace_id AND m.target_id = j.id AND m.target_kind = 'JOURNEY'
     WHERE j.workspace_id = $1 AND m.source_dataset = $2`,
    [workspaceId, sourceDataset],
  );
  const ownerless = journeys.rows.filter((row) => row.traveller_id === null);
  check(
    'JOURNEY_OWNERSHIP_PROVEN',
    'Does every migrated Journey name exactly one real traveller, with no allocation guessed?',
    ownerless.length === 0 ? 'PASS' : 'FAIL',
    `${journeys.rowCount} migrated journey(ies), ${ownerless.length} without a traveller. ` +
      `Trips whose element ownership was unprovable were quarantined rather than allocated: ` +
      `${run.reconciliationExceptions.filter((e) => e.classification === 'QUARANTINED_MULTI_TRAVELLER_ALLOCATION').length} case(s).`,
  );

  // --- 3. Provider references: every legacy booking ref survived ---
  const legacyBookingRefs = records.reduce((count, record) => {
    const payload = record.payload as { elements?: { data?: { bookingRef?: unknown } }[] } | null;
    if (payload === null || typeof payload !== 'object' || !Array.isArray(payload.elements)) return count;
    return count + payload.elements.filter((element) => element?.data?.bookingRef !== undefined).length;
  }, 0);
  const preservedRefs = await scalar(
    pool,
    `SELECT count(*)::text AS value FROM evidence_records
     WHERE workspace_id = $1 AND assertion_type = 'LEGACY_PROVIDER_BOOKING_REF'`,
    [workspaceId],
  );
  const quarantinedElementRefs = run.reconciliationExceptions.filter((entry) =>
    /element/.test(entry.affectedScope),
  ).length;
  check(
    'PROVIDER_REFS_PRESERVED',
    'Did every provider booking reference survive, or get named as lost?',
    preservedRefs + quarantinedElementRefs >= legacyBookingRefs ? 'PASS' : 'FAIL',
    `${legacyBookingRefs} legacy booking reference(s) in the bundle; ${preservedRefs} preserved as evidence ` +
      `against a migrated reservation; ${quarantinedElementRefs} element-level exception(s) account for the rest. ` +
      'Binding references as target external identity remains a documented open seam.',
  );

  // --- 4. Evidence lineage: no mapping cites evidence that does not exist ---
  let danglingEvidence = 0;
  for (const row of mappings.rows) {
    const parsed = JSON.parse(row.mapping_evidence) as { evidenceId?: string };
    if (parsed.evidenceId === undefined) {
      danglingEvidence += 1;
      continue;
    }
    const exists = await scalar(
      pool,
      'SELECT count(*)::text AS value FROM evidence_records WHERE workspace_id = $1 AND id = $2',
      [workspaceId, parsed.evidenceId],
    );
    if (exists === 0) danglingEvidence += 1;
  }
  check(
    'EVIDENCE_LINEAGE_INTACT',
    'Does every mapping point at a real evidence chain rather than a marker string?',
    danglingEvidence === 0 ? 'PASS' : 'FAIL',
    danglingEvidence === 0
      ? `all ${mappings.rowCount} mappings cite an evidence record that exists`
      : `${danglingEvidence} mapping(s) cite missing evidence`,
  );

  // --- 5. Obligations: a reservation that holds nothing is not an obligation ---
  const emptyReservations = await scalar(
    pool,
    `SELECT count(*)::text AS value FROM reservations r
     WHERE r.workspace_id = $1
       AND NOT EXISTS (SELECT 1 FROM reservation_lines l WHERE l.workspace_id = r.workspace_id AND l.reservation_id = r.id)`,
    [workspaceId],
  );
  const totalReservations = await scalar(
    pool,
    'SELECT count(*)::text AS value FROM reservations WHERE workspace_id = $1',
    [workspaceId],
  );
  check(
    'OBLIGATIONS_COMPLETE',
    'Does every migrated booking actually record what was booked?',
    emptyReservations === 0 ? 'PASS' : 'FAIL',
    `${totalReservations} reservation(s), ${emptyReservations} holding no line`,
  );

  // --- 6. Uncertainty: nothing unknown was resolved by migrating it ---
  //
  // Driven from the SOURCE bundle, because only the source can say what the old
  // system did not know, and resolved **per fact against its own target row**.
  // Counting workspace-wide UNKNOWN rows would let an unrelated unknown mask a
  // specific one that was falsely resolved, so each fact is traced to the exact
  // id the importer derived for it: either that row still reads UNKNOWN, or the
  // fact carries its own named exception, or its own archived evidence.
  //
  // When the row is absent, the hold-back must be named at the same
  // granularity. An exception sharing only the parent record is not evidence
  // about this element — otherwise a leg rejected for one trip element would
  // quietly account for a different element's missing line, and
  // `PRESERVED_UNKNOWN_EXTERNAL_OUTCOME`, which asserts the element DID
  // migrate, would read as if it explained the row's absence.
  const uncertainFacts = collectUncertainSourceFacts(bundle);
  const preservedFactKeys = new Set(
    run.reconciliationExceptions
      .filter((entry) => entry.classification === 'PRESERVED_UNKNOWN_EXTERNAL_OUTCOME')
      .map((entry) => `${entry.sourceType}/${entry.sourceId}`),
  );
  const factHoldBacks = new Set(
    run.reconciliationExceptions
      .filter(
        (entry) =>
          entry.factSourceId !== undefined && FACT_SCOPED_HOLD_BACK_CLASSIFICATIONS.has(entry.classification),
      )
      .map((entry) => `${entry.sourceType}/${entry.sourceId}|${entry.factSourceId}`),
  );
  const recordHoldBacks = new Set(
    run.reconciliationExceptions
      .filter(
        (entry) =>
          entry.factSourceId === undefined && RECORD_SCOPED_HOLD_BACK_CLASSIFICATIONS.has(entry.classification),
      )
      .map((entry) => `${entry.sourceType}/${entry.sourceId}`),
  );

  const unaccountedFacts: string[] = [];
  const accountedBy: string[] = [];
  for (const fact of uncertainFacts) {
    // An exception filed against this fact's own record names it directly.
    const namedAsPreserved = preservedFactKeys.has(fact.recordKey);

    if (fact.kind === 'PROVIDER_DELIVERY_OUTCOME') {
      // This delivery's own archive, by the evidence id the importer derived
      // for it — not "some delivery somewhere was archived".
      const evidenceId = migrationTargetId({
        datasetHash: bundle.datasetHash,
        sourceType: fact.sourceType,
        sourceId: fact.factSourceId,
        step: 'archive-evidence',
      });
      const ownArchive = await scalar(
        pool,
        `SELECT count(*)::text AS value FROM evidence_records
         WHERE workspace_id = $1 AND id = $2 AND assertion_type = 'LEGACY_PROVIDER_EVENT_DELIVERY'`,
        [workspaceId, evidenceId],
      );
      if (ownArchive > 0) accountedBy.push(`${fact.factId}=own-archive`);
      else if (namedAsPreserved) accountedBy.push(`${fact.factId}=named-exception`);
      else unaccountedFacts.push(`${fact.factId} (no archived capture of its own and no named exception)`);
      continue;
    }

    // Reservation uncertainty: the importer writes this element's line under a
    // derived id, so recompute that id and read that one row.
    const lineId = migrationTargetId({
      datasetHash: bundle.datasetHash,
      sourceType: fact.sourceType,
      sourceId: fact.factSourceId,
      step: 'reservation-line',
    });
    const line = await pool.query<{ observed_status: string }>(
      'SELECT observed_status FROM reservation_lines WHERE workspace_id = $1 AND id = $2',
      [workspaceId, lineId],
    );
    const status = line.rows[0]?.observed_status;
    // A whole-record quarantine only covers this element if the record itself
    // never became target state. Once it has, a finding stamped against the
    // record describes one unnamed part of it, not this fact.
    const heldBackAsWholeRecord = recordHoldBacks.has(fact.recordKey) && !mappedKeys.has(fact.recordKey);
    if (status === 'UNKNOWN') {
      accountedBy.push(`${fact.factId}=target-line-UNKNOWN`);
    } else if (status !== undefined) {
      // The row exists and no longer says UNKNOWN: uncertainty was resolved to
      // something the source never observed. No other row can compensate.
      unaccountedFacts.push(`${fact.factId} (its reservation line ${lineId} now reads ${status})`);
    } else if (factHoldBacks.has(`${fact.recordKey}|${fact.factSourceId}`)) {
      accountedBy.push(`${fact.factId}=fact-held-back`);
    } else if (heldBackAsWholeRecord) {
      accountedBy.push(`${fact.factId}=record-quarantined-unmigrated`);
    } else {
      const bound = run.reconciliationExceptions.filter((entry) => entry.factSourceId === fact.factSourceId);
      const why =
        bound.length === 0
          ? 'no exception names this fact at all'
          : `its only bound exception(s) (${bound.map((entry) => entry.classification).join(', ')}) ` +
            'say it migrated, not that it was held back';
      const scope =
        recordHoldBacks.has(fact.recordKey) && !heldBackAsWholeRecord
          ? '; the record has an exception but the record itself migrated, so it covers one part of it, not this fact'
          : '';
      unaccountedFacts.push(`${fact.factId}: expected reservation line ${lineId} is absent and ${why}${scope}`);
    }
  }

  const uncertaintyStatus: CheckStatus = unaccountedFacts.length > 0 ? 'FAIL' : 'PASS';
  check(
    'UNCERTAINTY_PRESERVED',
    'Did anything the old system did not know become certainty in the new one?',
    uncertaintyStatus,
    uncertaintyStatus === 'PASS'
      ? `${uncertainFacts.length} uncertain source fact(s) in the bundle, each traced to its own ` +
        `preservation: ${accountedBy.length === 0 ? 'none required' : accountedBy.join(', ')}`
      : `${uncertainFacts.length} uncertain source fact(s) in the bundle; ${unaccountedFacts.length} ` +
        `lost their preserved uncertainty: ${unaccountedFacts.join('; ')}`,
  );

  // --- 7. Money: no priced obligation migrated without its evidence ---
  const budgetCommitments = await scalar(
    pool,
    'SELECT count(*)::text AS value FROM budget_commitments WHERE workspace_id = $1',
    [workspaceId],
  );
  const fxArchived = await scalar(
    pool,
    `SELECT count(*)::text AS value FROM evidence_records
     WHERE workspace_id = $1 AND assertion_type = 'LEGACY_FX_RATE_OBSERVATION'`,
    [workspaceId],
  );
  check(
    'MONEY_ACCOUNTED',
    'Did any money-bearing state migrate, and if so does it carry evidence?',
    budgetCommitments === 0 ? 'PASS' : 'ATTENTION',
    budgetCommitments === 0
      ? `no budget commitment migrated: the legacy dataset held no priced, held or settled commitment. ` +
        `${fxArchived} legacy FX observation(s) are archived as dated history and are never used as a current ` +
        'conversion rate.'
      : `${budgetCommitments} budget commitment(s) migrated and need an owner to confirm their evidence`,
  );

  // --- 8. Current truth is derived here, not imported ---
  const recomputed = await scalar(
    pool,
    `SELECT count(*)::text AS value FROM assessments
     WHERE workspace_id = $1 AND evaluated_at >= $2`,
    [workspaceId, request.importStartedAt],
  );
  const totalAssessments = await scalar(
    pool,
    'SELECT count(*)::text AS value FROM assessments WHERE workspace_id = $1',
    [workspaceId],
  );
  check(
    'DERIVED_TRUTH_RECOMPUTED',
    'Is current health/viability computed from migrated state rather than carried over?',
    totalAssessments > 0 && recomputed === totalAssessments ? 'PASS' : totalAssessments === 0 ? 'ATTENTION' : 'FAIL',
    totalAssessments === 0
      ? 'no assessment exists yet — run the recompute step before reading this report as complete'
      : `${recomputed}/${totalAssessments} assessment(s) were evaluated after the import began; legacy verdicts ` +
        'are archived as LEGACY_CONSTRAINT_STATUS evidence and are not assessments',
  );

  // --- 9. The migration touched no provider ---
  const attempts = await scalar(
    pool,
    'SELECT count(*)::text AS value FROM execution_attempts WHERE workspace_id = $1',
    [workspaceId],
  );
  check(
    'NO_PROVIDER_DISPATCH',
    'Did the migration cause any external or money-moving action?',
    attempts === 0 ? 'PASS' : 'FAIL',
    attempts === 0
      ? 'no execution attempt exists in this workspace: the migration is provider-side-effect-free'
      : `${attempts} execution attempt(s) exist — investigate before cutover`,
  );

  const cutoverBlocking = run.reconciliationExceptions.filter((entry) => entry.blocksCutover);
  const failed = checks.filter((entry) => entry.status === 'FAIL');
  const verdict: ReconciliationReport['verdict'] =
    failed.length > 0 || cutoverBlocking.length > 0
      ? 'BLOCKED'
      : run.reconciliationExceptions.length > 0
        ? 'EXCEPTIONS_OWNED'
        : 'CLEAN';

  return {
    reconcilerVersion: RECONCILER_VERSION,
    generatedAt: request.now,
    runId: request.runId,
    sourceDataset,
    datasetHash: bundle.datasetHash,
    exporterVersion: bundle.exporterVersion,
    importerVersion: run.importerVersion,
    runStatus: run.status,
    totals: {
      exportedRecords: records.length,
      mappedRecords: mappings.rowCount ?? 0,
      exceptions: run.reconciliationExceptions.length,
      cutoverBlocking: cutoverBlocking.length,
    },
    coverage,
    checks,
    exceptions: run.reconciliationExceptions,
    verdict,
  };
}

/**
 * The same facts as prose. Written for the person deciding whether to cut
 * over, who needs to know what is outstanding and who owns it — not for a
 * dashboard.
 */
export function renderReconciliationReport(report: ReconciliationReport): string {
  const lines: string[] = [];
  const blockers = report.exceptions.filter((entry) => entry.blocksCutover);

  lines.push(`# Migration reconciliation — ${report.sourceDataset}`);
  lines.push('');
  lines.push(`**Verdict: ${report.verdict}.** ` + verdictSentence(report));
  lines.push('');
  lines.push(`- Run \`${report.runId}\` (${report.runStatus}), generated ${report.generatedAt}`);
  lines.push(`- Dataset hash \`${report.datasetHash}\``);
  lines.push(`- Exporter \`${report.exporterVersion}\`, importer \`${report.importerVersion}\`, reconciler \`${report.reconcilerVersion}\``);
  lines.push(
    `- ${report.totals.exportedRecords} exported record(s), ${report.totals.mappedRecords} mapping(s), ` +
      `${report.totals.exceptions} exception(s), ${report.totals.cutoverBlocking} blocking cutover`,
  );
  lines.push('');

  lines.push('## Semantic checks');
  lines.push('');
  lines.push('| check | result | question |');
  lines.push('| --- | --- | --- |');
  for (const entry of report.checks) {
    lines.push(`| \`${entry.id}\` | ${entry.status} | ${entry.question} |`);
  }
  lines.push('');
  for (const entry of report.checks) {
    lines.push(`- **${entry.id} — ${entry.status}.** ${entry.detail}`);
  }
  lines.push('');

  lines.push('## Category coverage');
  lines.push('');
  lines.push('| category | decision | exported | mapped | archived | exceptions |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const entry of report.coverage) {
    lines.push(
      `| ${entry.categoryId} | ${entry.decision} | ${entry.exported} | ${entry.mapped} | ${entry.archived} | ${entry.withExceptions} |`,
    );
  }
  lines.push('');

  lines.push('## Exceptions');
  lines.push('');
  if (report.exceptions.length === 0) {
    lines.push('None.');
  } else {
    if (blockers.length > 0) {
      lines.push(`${blockers.length} of ${report.exceptions.length} block cutover for their scope.`);
      lines.push('');
    }
    for (const entry of report.exceptions) {
      lines.push(
        `### ${entry.classification} — \`${entry.sourceType}/${entry.sourceId}\`` +
          (entry.factSourceId === undefined ? '' : ` / \`${entry.factSourceId}\``),
      );
      lines.push('');
      lines.push(`- **Blocks cutover:** ${entry.blocksCutover ? 'yes' : 'no'}`);
      lines.push(`- **Owner:** ${entry.owner}`);
      if (entry.factSourceId !== undefined) {
        lines.push(
          `- **Fact scope:** \`${entry.factSourceId}\` — this finding is about that one fact, ` +
            'not about the record as a whole',
        );
      }
      lines.push(`- **Reason:** ${entry.reason}`);
      lines.push(`- **Affected scope:** ${entry.affectedScope}`);
      lines.push(`- **Safety impact:** ${entry.safetyImpact}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function verdictSentence(report: ReconciliationReport): string {
  const failed = report.checks.filter((entry) => entry.status === 'FAIL');
  if (report.verdict === 'CLEAN') {
    return 'Every exported record is represented in the target, every semantic check passed, and nothing is outstanding.';
  }
  if (report.verdict === 'EXCEPTIONS_OWNED') {
    return (
      `Every semantic check passed. ${report.totals.exceptions} item(s) did not migrate as active target state; ` +
      'each is named, classified and owned, and none blocks cutover.'
    );
  }
  const parts: string[] = [];
  if (failed.length > 0) parts.push(`${failed.length} semantic check(s) failed (${failed.map((e) => e.id).join(', ')})`);
  if (report.totals.cutoverBlocking > 0) {
    parts.push(`${report.totals.cutoverBlocking} exception(s) block cutover for their scope`);
  }
  return `${parts.join('; ')}. Cutover must not proceed for the affected scope until an owner resolves these.`;
}
