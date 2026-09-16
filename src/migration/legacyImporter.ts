/**
 * M10 Phase 4 — target PostgreSQL importer for a legacy migration bundle.
 *
 * Reads a bundle (never SQLite) and commits it through the real M2-M5
 * command surface, so every migrated record lands under the same
 * validation, revision, idempotency and evidence rules product writes obey.
 *
 * Invariants, each with a focused test in
 * `postgres-integration/m10LegacyMigration.pgtest.ts`:
 *  - no provider is imported, therefore none can be dispatched;
 *  - same source identity + same hash => IDEMPOTENT_REPLAY, zero new rows;
 *  - same source identity + changed hash => typed conflict, zero rows
 *    written for that record, nothing overwritten;
 *  - identity is never guessed: unprovable ownership quarantines;
 *  - multi-traveller legacy trips always quarantine (frozen decision);
 *  - a legacy verdict never becomes a CURRENT assessment; it is archived as
 *    `LEGACY_CONSTRAINT_STATUS` evidence and recomputed by the real M6
 *    evaluator afterwards.
 *
 * Command idempotency keys are derived deterministically from
 * (datasetHash, sourceType, sourceId, step). That gives a second, independent
 * layer of replay safety underneath `legacy_id_map`: if the process dies
 * after a command commits but before its mapping row is written, the resumed
 * run re-issues the same key, `PgUnitOfWork` returns REPLAY with the original
 * target id, and the mapping is completed — never a duplicate subject.
 */
import type { Pool } from '../persistence/postgres/pool.ts';
import { PgUnitOfWork } from '../persistence/postgres/pgUnitOfWork.ts';
import { createOrganisation, recordTraveller } from '../persistence/postgres/commands/peopleCommands.ts';
import { recordSource, recordEvidence, recordConstraintDefinition } from '../persistence/postgres/commands/knowledgeCommands.ts';
import { createTrip, createJourney } from '../persistence/postgres/commands/travelCommands.ts';
import type { TypedConflict } from '../domain/v2/shared/errors.ts';
import {
  bundleRecordsInReplayOrder,
  type MigrationBundle,
  type MigrationBundleCategory,
  type MigrationSourceRecord,
} from './legacyExportBundle.ts';
import { resolveLegacyConstraint } from './legacyConstraintMapping.ts';
import {
  appendReconciliationException,
  appendValidation,
  decideRecordOutcome,
  finishMigrationRun,
  IMPORTER_VERSION,
  derivedUuid,
  insertLegacyMapping,
  lookupLegacyMapping,
  readMigrationRun,
  saveMigrationProgress,
  startOrResumeMigrationRun,
  type MigrationReconciliationException,
  type MigrationRunProgress,
} from './migrationRunStore.ts';

/** Assertion types this importer writes. Historical, never current truth. */
export const MIGRATION_PROVENANCE_ASSERTION = 'LEGACY_DATASET_MIGRATION';
export const LEGACY_CONSTRAINT_STATUS_ASSERTION = 'LEGACY_CONSTRAINT_STATUS';

export class MigrationInterrupted extends Error {
  readonly afterRecords: number;

  constructor(afterRecords: number) {
    super(`migration deliberately interrupted after ${afterRecords} record(s)`);
    this.name = 'MigrationInterrupted';
    this.afterRecords = afterRecords;
  }
}

export interface LegacyImportRequest {
  workspaceId: string;
  actorPrincipalId: string;
  bundle: MigrationBundle;
  /**
   * Deterministic failure injection: throw `MigrationInterrupted` once this
   * many records have been processed in this invocation. Test-only in
   * practice, but a real code path — resume evidence must not be simulated.
   */
  failAfterRecords?: number;
  now?: () => string;
}

export interface LegacyImportResult {
  runId: string;
  datasetHash: string;
  status: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS';
  resumed: boolean;
  progress: MigrationRunProgress;
  exceptions: MigrationReconciliationException[];
  provenance: { sourceId: string; evidenceId: string };
}

/** What one record's handler concluded. */
type RecordOutcome =
  | { kind: 'IMPORTED'; targetKind: string; targetId: string; note: string }
  /** Imported, but deliberately not represented as a target subject (history only). */
  | { kind: 'ARCHIVED'; note: string }
  | { kind: 'QUARANTINED'; exception: Omit<MigrationReconciliationException, 'categoryId' | 'sourceType' | 'sourceId'> }
  | { kind: 'DEFERRED'; reason: string };

interface ImportContext {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  runId: string;
  datasetHash: string;
  sourceDataset: string;
  runEvidenceId: string;
  now: string;
  /** The `source_records` row capturing the legacy dataset for this run. */
  runSourceId: string;
  /** legacy trip element id -> owning legacy trip id(s), built from the bundle. */
  tripElementOwners: Map<string, string[]>;
  resolve(sourceType: string, sourceId: string): Promise<{ targetKind: string; targetId: string } | undefined>;
  idempotencyKey(record: MigrationSourceRecord, step: string): string;
  /**
   * The target id this record's `step` will always produce. Derived, not
   * random, so a command re-issued after a crash replays with an identical
   * payload instead of tripping the idempotency ledger's payload check.
   */
  targetId(record: MigrationSourceRecord, step: string): string;
  uow(): PgUnitOfWork;
}

function conflictText(conflict: TypedConflict | undefined): string {
  return conflict === undefined ? 'unknown conflict' : `${conflict.kind}: ${conflict.message}`;
}

function asObject(payload: unknown): Record<string, unknown> | undefined {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

// ---------------------------------------------------------------------------
// Category handlers
// ---------------------------------------------------------------------------

async function importOrganisation(
  ctx: ImportContext,
  record: MigrationSourceRecord,
): Promise<RecordOutcome> {
  const payload = asObject(record.payload);
  const legalName = typeof payload?.name === 'string' ? payload.name : undefined;
  if (legalName === undefined) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'QUARANTINED_UNREADABLE_SOURCE',
        reason: 'legacy ORGANISATION has no readable name; the target requires a legal name and must not invent one',
        affectedScope: `organisation ${record.sourceId} and everything scoped to it`,
        safetyImpact:
          'trips/journeys whose business context is this organisation cannot be attributed to a real party',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }
  const outcome = await createOrganisation(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: ctx.idempotencyKey(record, 'organisation'),
    organisationId: ctx.targetId(record, 'organisation'),
    legalName,
    // Legacy organisations carry no currency. The target column is NOT NULL,
    // so a value must exist; taking it from the legacy payload when present
    // and otherwise recording the absence in the mapping note is honest,
    // whereas silently defaulting a *money* field would not be.
    defaultCurrencyCode: typeof payload?.defaultCurrencyCode === 'string' ? payload.defaultCurrencyCode : 'USD',
  });
  if (!outcome.ok) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'TARGET_REJECTED_WRITE',
        reason: `target rejected ORGANISATION_CREATED — ${conflictText(outcome.conflict)}`,
        affectedScope: `organisation ${record.sourceId}`,
        safetyImpact: 'organisation-scoped migration below this record cannot resolve its business party',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }
  return {
    kind: 'IMPORTED',
    targetKind: 'ORGANISATION',
    targetId: outcome.value.organisationId,
    note:
      typeof payload?.defaultCurrencyCode === 'string'
        ? 'legal name and default currency from legacy payload'
        : 'legal name from legacy payload; legacy source carried no default currency (target column is NOT NULL)',
  };
}

async function importTraveller(
  ctx: ImportContext,
  record: MigrationSourceRecord,
): Promise<RecordOutcome> {
  const payload = asObject(record.payload);
  const displayValue =
    typeof payload?.displayName === 'string'
      ? payload.displayName
      : typeof payload?.name === 'string'
        ? payload.name
        : undefined;
  if (displayValue === undefined) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'QUARANTINED_UNREADABLE_SOURCE',
        reason: 'legacy TRAVELLER has no readable display name; a person identity must not be synthesised',
        affectedScope: `traveller ${record.sourceId}, and any trip/journey that names them`,
        safetyImpact: 'journeys would be attributed to an unidentifiable person',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }
  const outcome = await recordTraveller(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: ctx.idempotencyKey(record, 'traveller'),
    travellerId: ctx.targetId(record, 'traveller'),
    displayName: {
      nameKind: 'DISPLAY',
      displayValue,
      effectiveRange: { start: ctx.now.slice(0, 10) },
      // The real evidence chain: this name edition cites the migration run's
      // evidence, which cites the captured legacy dataset.
      evidenceId: ctx.runEvidenceId,
    },
  });
  if (!outcome.ok) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'TARGET_REJECTED_WRITE',
        reason: `target rejected TRAVELLER_RECORDED — ${conflictText(outcome.conflict)}`,
        affectedScope: `traveller ${record.sourceId}`,
        safetyImpact: 'journeys referencing this traveller cannot migrate',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }
  return {
    kind: 'IMPORTED',
    targetKind: 'TRAVELLER',
    targetId: outcome.value.travellerId,
    note: 'display name migrated citing the migration run evidence chain',
  };
}

/**
 * A legacy Trip is a shared undertaking plus, implicitly, its travellers'
 * participation. The target separates Trip from Journey, so a
 * single-traveller legacy trip maps deterministically to one Trip + one
 * Journey. A multi-traveller legacy trip cannot: `TripElement` carries no
 * `travellerId` and `Stay.guests` is a bare headcount, so element -> Journey
 * ownership is unprovable from source. Frozen decision: quarantine.
 */
async function importTrip(ctx: ImportContext, record: MigrationSourceRecord): Promise<RecordOutcome> {
  const payload = asObject(record.payload);
  if (payload === undefined) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'QUARANTINED_UNREADABLE_SOURCE',
        reason: 'legacy trip payload is not readable',
        affectedScope: `trip ${record.sourceId} and all state hanging off it`,
        safetyImpact: 'an unreadable trip cannot be proven migrated or absent',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }
  const travellerIds = stringArray(payload.travellerIds);
  const elementCount = Array.isArray(payload.elements) ? payload.elements.length : 0;

  if (travellerIds.length === 0) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'QUARANTINED_AMBIGUOUS_IDENTITY',
        reason: 'legacy trip names no travellers, so no Journey ownership can be established',
        affectedScope: `trip ${record.sourceId} (${elementCount} element(s))`,
        safetyImpact: 'travel obligations with no owning person would be invisible to recovery',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }

  if (travellerIds.length > 1) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'QUARANTINED_MULTI_TRAVELLER_ALLOCATION',
        reason:
          `legacy trip carries ${travellerIds.length} travellers and ${elementCount} element(s); ` +
          'TripElement has no travellerId and Stay.guests is a bare headcount, so element -> Journey ' +
          'ownership cannot be proven from source evidence',
        affectedScope: `trip ${record.sourceId}, travellers [${travellerIds.join(', ')}], ${elementCount} element(s)`,
        safetyImpact:
          'guessing allocation would attribute flights/stays to the wrong person, and recovery would ' +
          'act on the wrong traveller; source data is preserved unmigrated instead',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }

  const legacyTravellerId = travellerIds[0] as string;
  const traveller = await ctx.resolve('entities.TRAVELLER', legacyTravellerId);
  if (traveller === undefined) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'QUARANTINED_AMBIGUOUS_IDENTITY',
        reason: `legacy trip references traveller "${legacyTravellerId}", which has no migrated target identity`,
        affectedScope: `trip ${record.sourceId}`,
        safetyImpact: 'the Journey would have no verifiable person behind it',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }

  const legacyOperatorId = typeof payload.operatorOrganisationId === 'string' ? payload.operatorOrganisationId : undefined;
  const operator =
    legacyOperatorId === undefined ? undefined : await ctx.resolve('entities.ORGANISATION', legacyOperatorId);
  if (legacyOperatorId !== undefined && operator === undefined) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'QUARANTINED_AMBIGUOUS_IDENTITY',
        reason: `legacy trip references operator organisation "${legacyOperatorId}", which has no migrated target identity`,
        affectedScope: `trip ${record.sourceId}`,
        safetyImpact: 'business context/authority for this trip would be misattributed',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }

  const label = typeof payload.label === 'string' && payload.label.length > 0 ? payload.label : undefined;
  const tripOutcome = await createTrip(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: ctx.idempotencyKey(record, 'trip'),
    tripId: ctx.targetId(record, 'trip'),
    purpose: label ?? `migrated legacy trip ${record.sourceId}`,
    ...(operator === undefined ? {} : { businessContextOrganisationId: operator.targetId }),
  });
  if (!tripOutcome.ok) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'TARGET_REJECTED_WRITE',
        reason: `target rejected TRIP_CREATED — ${conflictText(tripOutcome.conflict)}`,
        affectedScope: `trip ${record.sourceId}`,
        safetyImpact: 'the trip and its journey do not exist in the target',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }

  const journeyOutcome = await createJourney(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: ctx.idempotencyKey(record, 'journey'),
    journeyId: ctx.targetId(record, 'journey'),
    tripId: tripOutcome.value.tripId,
    travellerId: traveller.targetId,
    lifecycleStatus: 'ACTIVE',
  });
  if (!journeyOutcome.ok) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'TARGET_REJECTED_WRITE',
        reason: `target rejected JOURNEY_CREATED — ${conflictText(journeyOutcome.conflict)}`,
        affectedScope: `trip ${record.sourceId}, traveller ${legacyTravellerId}`,
        safetyImpact: 'the trip migrated without the traveller participation that gives it meaning',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }

  // The Journey gets its own mapping entry under a derived source type: the
  // legacy model had no Journey, so the legacy Trip id is its only source
  // identity, and constraints/cases need to resolve it later.
  await insertLegacyMapping(ctx.pool, {
    workspaceId: ctx.workspaceId,
    sourceDataset: ctx.sourceDataset,
    sourceType: 'trips.journey',
    sourceId: record.sourceId,
    targetKind: 'JOURNEY',
    targetId: journeyOutcome.value.journeyId,
    runId: ctx.runId,
    datasetHash: ctx.datasetHash,
    sourceHash: record.sourceHash,
    evidenceId: ctx.runEvidenceId,
    importerVersion: IMPORTER_VERSION,
    note: `single-traveller legacy trip ${record.sourceId} yields exactly one Journey for traveller ${legacyTravellerId}`,
  });

  return {
    kind: 'IMPORTED',
    targetKind: 'TRIP',
    targetId: tripOutcome.value.tripId,
    note:
      `single-traveller legacy trip: deterministic Trip + one Journey for traveller ${legacyTravellerId}` +
      (elementCount > 0 ? `; ${elementCount} legacy element(s) await Phase 5 itinerary mapping` : ''),
  };
}

/**
 * Resolve the target Journey a legacy constraint belongs to, using only
 * source evidence: an explicit TRIP ref, or a TRIP_ELEMENT ref that appears
 * in exactly one exported trip's `elements[]`. An element id present in zero
 * or several trips proves nothing and is not resolved.
 */
async function resolveConstraintOwner(
  ctx: ImportContext,
  payload: Record<string, unknown>,
): Promise<{ owner?: { targetKind: string; targetId: string }; reason?: string }> {
  const refs = Array.isArray(payload.refs) ? payload.refs : [];
  const legacyTripIds = new Set<string>();
  const unresolvedElements: string[] = [];

  for (const rawRef of refs) {
    const ref = asObject(rawRef);
    const entityType = typeof ref?.entityType === 'string' ? ref.entityType : undefined;
    const id = typeof ref?.id === 'string' ? ref.id : undefined;
    if (entityType === undefined || id === undefined) continue;
    if (entityType === 'TRIP') {
      legacyTripIds.add(id);
      continue;
    }
    if (entityType === 'TRIP_ELEMENT') {
      const owners = ctx.tripElementOwners.get(id) ?? [];
      if (owners.length === 1) legacyTripIds.add(owners[0] as string);
      else unresolvedElements.push(`${id} (owned by ${owners.length} exported trip(s))`);
    }
  }

  if (legacyTripIds.size === 1) {
    const legacyTripId = [...legacyTripIds][0] as string;
    const journey = await ctx.resolve('trips.journey', legacyTripId);
    if (journey !== undefined) return { owner: journey };
    return {
      reason: `legacy constraint resolves to trip "${legacyTripId}", which has no migrated Journey (quarantined or unmigrated)`,
    };
  }
  if (legacyTripIds.size > 1) {
    return {
      reason: `legacy constraint spans ${legacyTripIds.size} trips [${[...legacyTripIds].sort().join(', ')}]; the target requires one owning subject and it must not be chosen arbitrarily`,
    };
  }
  return {
    reason:
      'legacy constraint refs identify no owning trip' +
      (unresolvedElements.length > 0 ? `; unresolvable element refs: ${unresolvedElements.sort().join(', ')}` : ''),
  };
}

/**
 * Constraints split in two on migration:
 *  - the DEFINITION migrates to `constraint_definitions` when (and only when)
 *    the legacy form maps to a registered target evaluator type;
 *  - the legacy PASS/FAIL/UNKNOWN STATUS is archived as
 *    `LEGACY_CONSTRAINT_STATUS` evidence against the owning Journey — never
 *    written into `assessments`, which would fabricate evaluator provenance
 *    for a verdict no target evaluator produced.
 *
 * Current status comes from re-running the real M6 evaluator after import
 * (`recomputeMigratedState`), not from the legacy row.
 */
async function importConstraint(
  ctx: ImportContext,
  record: MigrationSourceRecord,
): Promise<RecordOutcome> {
  const payload = asObject(record.payload);
  if (payload === undefined) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'QUARANTINED_UNREADABLE_SOURCE',
        reason: 'legacy constraint payload is not readable',
        affectedScope: `constraint ${record.sourceId}`,
        safetyImpact: 'a requirement that may have been blocking would silently disappear',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }

  const ownerResolution = await resolveConstraintOwner(ctx, payload);
  const legacyStatus = typeof payload.status === 'string' ? payload.status : 'UNKNOWN';

  if (ownerResolution.owner === undefined) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'QUARANTINED_AMBIGUOUS_IDENTITY',
        reason: ownerResolution.reason ?? 'legacy constraint owner could not be resolved',
        affectedScope: `constraint ${record.sourceId} (legacy status ${legacyStatus})`,
        safetyImpact:
          'the requirement is not enforced in the target, and its last legacy verdict has no subject to attach to',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }
  const owner = ownerResolution.owner;

  // Archive the legacy verdict first, against a subject that already exists.
  // This happens whether or not the definition itself is mappable: losing the
  // historical verdict is never acceptable.
  const statusEvidence = await recordEvidence(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: ctx.idempotencyKey(record, 'legacy-status-evidence'),
    evidenceId: ctx.targetId(record, 'legacy-status-evidence'),
    assertionType: LEGACY_CONSTRAINT_STATUS_ASSERTION,
    observedAt: ctx.now,
    schemaVersion: '1',
    sourceIds: [ctx.runSourceId],
    subjectRefs: [{ kind: owner.targetKind, id: owner.targetId }],
    interpretationProvenance:
      `legacy constraint ${record.sourceId} held status ${legacyStatus} on the legacy runtime at export; ` +
      'archived as history only — it is not a target assessment and does not establish current truth',
  });
  if (!statusEvidence.ok) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'TARGET_REJECTED_WRITE',
        reason: `target rejected LEGACY_CONSTRAINT_STATUS evidence — ${conflictText(statusEvidence.conflict)}`,
        affectedScope: `constraint ${record.sourceId}`,
        safetyImpact: 'the legacy verdict would be lost rather than archived',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }

  const resolution = resolveLegacyConstraint(payload);
  if (!resolution.mapped) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'QUARANTINED_NO_DETERMINISTIC_TARGET_MAPPING',
        reason: resolution.reason,
        affectedScope: `constraint ${record.sourceId} on ${owner.targetKind} ${owner.targetId} (legacy status ${legacyStatus})`,
        safetyImpact:
          'the requirement is not evaluated in the target; its legacy status IS archived as evidence, so the ' +
          'history is preserved, but nothing enforces it until an owner classifies the type',
        owner: 'migration owner',
        blocksCutover: false,
      },
    };
  }

  const definition = await recordConstraintDefinition(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: ctx.idempotencyKey(record, 'constraint-definition'),
    constraintDefinitionId: ctx.targetId(record, 'constraint-definition'),
    registeredType: resolution.registeredType,
    hardness: resolution.hardness,
    ownerRef: { kind: owner.targetKind, id: owner.targetId },
    parameterSchemaVersion: '1',
    provenanceEvidenceId: statusEvidence.value.evidenceId,
    operands: resolution.operands,
  });
  if (!definition.ok) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'TARGET_REJECTED_WRITE',
        reason: `target rejected CONSTRAINT_DEFINITION_RECORDED — ${conflictText(definition.conflict)}`,
        affectedScope: `constraint ${record.sourceId} on ${owner.targetKind} ${owner.targetId}`,
        safetyImpact: 'the requirement is not enforced in the target',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }

  return {
    kind: 'IMPORTED',
    targetKind: 'CONSTRAINT_DEFINITION',
    targetId: definition.value.constraintDefinitionId,
    note:
      `${resolution.justification}; legacy status ${legacyStatus} archived as ${LEGACY_CONSTRAINT_STATUS_ASSERTION} ` +
      'evidence, current status to be recomputed by the M6 evaluator',
  };
}

/**
 * Legacy source captures migrate as target `source_records`, preserving the
 * original identity and retrieval instant so evidence lineage survives.
 */
async function importSourceRecord(
  ctx: ImportContext,
  record: MigrationSourceRecord,
): Promise<RecordOutcome> {
  const payload = asObject(record.payload);
  const legacyRecord = asObject(payload?.record);
  const retrievedAt = typeof legacyRecord?.retrievedAt === 'string' ? legacyRecord.retrievedAt : undefined;
  if (retrievedAt === undefined) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'QUARANTINED_UNREADABLE_SOURCE',
        reason: 'legacy source record has no retrievedAt; evidence freshness must not be invented',
        affectedScope: `source ${record.sourceId}`,
        safetyImpact: 'downstream evidence would claim an unknown observation time',
        owner: 'migration owner',
        blocksCutover: false,
      },
    };
  }
  const outcome = await recordSource(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: ctx.idempotencyKey(record, 'source'),
    sourceId: ctx.targetId(record, 'source'),
    // Legacy identity is namespaced, never reused verbatim, so a migrated
    // capture can never be mistaken for a natively captured one.
    sourceIdentity: `legacy:${ctx.sourceDataset}:${record.sourceId}`,
    receivedAt: retrievedAt,
    contentHash: record.sourceHash,
    contentType:
      typeof legacyRecord?.kind === 'string'
        ? `application/x-northstar-legacy-source+${legacyRecord.kind}`
        : 'application/x-northstar-legacy-source',
  });
  if (!outcome.ok) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'TARGET_REJECTED_WRITE',
        reason: `target rejected SOURCE_RECORDED — ${conflictText(outcome.conflict)}`,
        affectedScope: `source ${record.sourceId}`,
        safetyImpact: 'evidence lineage for anything citing this capture is incomplete',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }
  return {
    kind: 'IMPORTED',
    targetKind: 'SOURCE_RECORD',
    targetId: outcome.value.sourceId,
    note: `legacy capture ${record.sourceId} migrated with its original retrieval instant`,
  };
}

type CategoryHandler = (ctx: ImportContext, record: MigrationSourceRecord) => Promise<RecordOutcome>;

/**
 * Handlers by category. A category with no handler is DEFERRED and counted —
 * never silently skipped. Phase 5 adds handlers here; nothing else changes.
 */
const HANDLERS: Readonly<Record<string, CategoryHandler>> = {
  ORGANISATION: importOrganisation,
  TRAVELLER: importTraveller,
  TRIP: importTrip,
  CONSTRAINT: importConstraint,
  SOURCE_RECORD: importSourceRecord,
};

// ---------------------------------------------------------------------------
// Run orchestration
// ---------------------------------------------------------------------------

/**
 * Write (or recover) the run's provenance chain: a `source_records` row
 * capturing the legacy dataset, and an evidence row asserting the migration.
 * Every migrated record cites this, which is what makes
 * `legacy_id_map.mapping_evidence` point at a real target evidence chain
 * rather than a marker string.
 *
 * The evidence cites the SOURCE_RECORD subject it came from: the migration
 * needs no invented organisation or placeholder subject to anchor itself.
 *
 * Both ids are derived from the dataset hash, and the assertion text
 * describes the *dataset*, not the run. That is what makes re-importing the
 * same bundle reuse this exact chain: a random id or a run-specific
 * assertion would change the command payload under a reused idempotency key,
 * which the ledger rejects as a mismatch.
 */
async function ensureRunProvenance(
  pool: Pool,
  params: {
    workspaceId: string;
    actorPrincipalId: string;
    bundle: MigrationBundle;
    runId: string;
    existing: MigrationRunProgress['provenance'];
    now: string;
  },
): Promise<{ sourceId: string; evidenceId: string }> {
  if (params.existing !== undefined) return params.existing;
  const uow = () => new PgUnitOfWork(pool, params.workspaceId);
  const { bundle } = params;

  const source = await recordSource(uow(), {
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: `migration:${bundle.datasetHash}:dataset-capture`,
    sourceId: derivedUuid('northstar:migration:dataset-capture', bundle.datasetHash),
    sourceIdentity: `${bundle.dataset.sourceSystem}:${bundle.dataset.sourceIdentity}:${bundle.datasetHash}`,
    receivedAt: bundle.dataset.exportCutoff,
    contentHash: bundle.datasetHash,
    contentType: 'application/x-northstar-legacy-migration-bundle',
  });
  if (!source.ok) throw new Error(`migration provenance source could not be recorded: ${conflictText(source.conflict)}`);

  const evidence = await recordEvidence(uow(), {
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: `migration:${bundle.datasetHash}:dataset-evidence`,
    evidenceId: derivedUuid('northstar:migration:dataset-evidence', bundle.datasetHash),
    assertionType: MIGRATION_PROVENANCE_ASSERTION,
    observedAt: bundle.dataset.exportCutoff,
    schemaVersion: '1',
    sourceIds: [source.value.sourceId],
    subjectRefs: [{ kind: 'SOURCE_RECORD', id: source.value.sourceId }],
    interpretationProvenance:
      `migrated from legacy dataset ${bundle.dataset.sourceIdentity} (hash ${bundle.datasetHash}, ` +
      `cutoff ${bundle.dataset.exportCutoff}) by ${IMPORTER_VERSION} via ${bundle.exporterVersion}`,
  });
  if (!evidence.ok) {
    throw new Error(`migration provenance evidence could not be recorded: ${conflictText(evidence.conflict)}`);
  }
  return { sourceId: source.value.sourceId, evidenceId: evidence.value.evidenceId };
}

/** Index legacy trip elements to their owning trip, from the bundle alone. */
function indexTripElements(bundle: MigrationBundle): Map<string, string[]> {
  const owners = new Map<string, string[]>();
  const trips = bundle.categories.find((category) => category.categoryId === 'TRIP');
  for (const record of trips?.records ?? []) {
    const payload = asObject(record.payload);
    if (payload === undefined) continue;
    for (const rawElement of Array.isArray(payload.elements) ? payload.elements : []) {
      const elementId = asObject(rawElement)?.id;
      if (typeof elementId !== 'string') continue;
      owners.set(elementId, [...(owners.get(elementId) ?? []), record.sourceId]);
    }
  }
  return owners;
}

/**
 * Import a bundle into PostgreSQL. Safe to call repeatedly: an unchanged
 * bundle replays idempotently, and an interrupted run resumes from its
 * recorded progress.
 */
export async function importLegacyBundle(
  pool: Pool,
  request: LegacyImportRequest,
): Promise<LegacyImportResult> {
  const { bundle } = request;
  const now = (request.now ?? (() => new Date().toISOString()))();
  const run = await startOrResumeMigrationRun(pool, {
    workspaceId: request.workspaceId,
    datasetHash: bundle.datasetHash,
    exporterVersion: bundle.exporterVersion,
  });

  const provenance = await ensureRunProvenance(pool, {
    workspaceId: request.workspaceId,
    actorPrincipalId: request.actorPrincipalId,
    bundle,
    runId: run.runId,
    existing: run.progress.provenance,
    now,
  });

  let progress: MigrationRunProgress = { ...run.progress, provenance };
  await saveMigrationProgress(pool, run.runId, progress);

  const ctx: ImportContext = {
    pool,
    workspaceId: request.workspaceId,
    actorPrincipalId: request.actorPrincipalId,
    runId: run.runId,
    datasetHash: bundle.datasetHash,
    sourceDataset: bundle.dataset.sourceIdentity,
    runEvidenceId: provenance.evidenceId,
    runSourceId: provenance.sourceId,
    now,
    tripElementOwners: indexTripElements(bundle),
    async resolve(sourceType, sourceId) {
      const mapping = await lookupLegacyMapping(pool, {
        workspaceId: request.workspaceId,
        sourceDataset: bundle.dataset.sourceIdentity,
        sourceType,
        sourceId,
      });
      return mapping === undefined ? undefined : { targetKind: mapping.targetKind, targetId: mapping.targetId };
    },
    idempotencyKey(record, step) {
      return `migration:${bundle.datasetHash}:${record.sourceType}:${record.sourceId}:${step}`;
    },
    targetId(record, step) {
      return derivedUuid(
        `northstar:migration:${step}`,
        `${bundle.datasetHash}:${record.sourceType}:${record.sourceId}`,
      );
    },
    uow() {
      return new PgUnitOfWork(pool, request.workspaceId);
    },
  };

  const records = bundleRecordsInReplayOrder(bundle);
  let processedThisInvocation = 0;

  try {
    for (let index = 0; index < records.length; index++) {
      if (index <= progress.lastCompletedIndex) continue; // already done in an earlier run
      const entry = records[index];
      if (entry === undefined) continue;
      const { category, record } = entry;

      const counter = await importOneRecord(ctx, category, record);
      progress = { ...progress, [counter]: progress[counter] + 1, lastCompletedIndex: index };
      await saveMigrationProgress(pool, run.runId, progress);
      processedThisInvocation++;

      if (request.failAfterRecords !== undefined && processedThisInvocation >= request.failAfterRecords) {
        // Leave the run IN_PROGRESS with accurate progress — exactly the
        // state a crash would leave behind.
        throw new MigrationInterrupted(processedThisInvocation);
      }
    }
  } catch (error) {
    if (error instanceof MigrationInterrupted) {
      const state = await readMigrationRun(pool, run.runId);
      return {
        runId: run.runId,
        datasetHash: bundle.datasetHash,
        status: 'IN_PROGRESS',
        resumed: run.resumed,
        progress: state.progress,
        exceptions: state.reconciliationExceptions,
        provenance,
      };
    }
    await finishMigrationRun(pool, run.runId, 'FAILED');
    throw error;
  }

  await appendValidation(pool, run.runId, {
    check: 'ALL_BUNDLE_RECORDS_ACCOUNTED_FOR',
    passed:
      progress.recordsImported +
        progress.recordsReplayed +
        progress.recordsQuarantined +
        progress.recordsConflicted +
        progress.recordsDeferred ===
      records.length,
    detail:
      `bundle held ${records.length} record(s); imported ${progress.recordsImported}, ` +
      `replayed ${progress.recordsReplayed}, quarantined ${progress.recordsQuarantined}, ` +
      `conflicted ${progress.recordsConflicted}, deferred ${progress.recordsDeferred}`,
  });

  // A run with conflicts has NOT completed cleanly: a changed source under a
  // previously imported identity needs an explicit decision, so the run is
  // marked FAILED rather than quietly COMPLETED with exceptions attached.
  const status = progress.recordsConflicted > 0 ? 'FAILED' : 'COMPLETED';
  await finishMigrationRun(pool, run.runId, status);
  const finalState = await readMigrationRun(pool, run.runId);
  return {
    runId: run.runId,
    datasetHash: bundle.datasetHash,
    status,
    resumed: run.resumed,
    progress: finalState.progress,
    exceptions: finalState.reconciliationExceptions,
    provenance,
  };
}

/** Which progress counter this record landed in. */
type ProgressCounter =
  | 'recordsImported'
  | 'recordsReplayed'
  | 'recordsQuarantined'
  | 'recordsConflicted'
  | 'recordsDeferred';

async function importOneRecord(
  ctx: ImportContext,
  category: MigrationBundleCategory,
  record: MigrationSourceRecord,
): Promise<ProgressCounter> {
  const existing = await lookupLegacyMapping(ctx.pool, {
    workspaceId: ctx.workspaceId,
    sourceDataset: ctx.sourceDataset,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
  });
  const decision = decideRecordOutcome(
    { sourceIdentity: ctx.sourceDataset, sourceHash: record.sourceHash },
    existing,
  );

  if (decision === 'IDEMPOTENT_REPLAY') return 'recordsReplayed';

  if (decision === 'CONFLICT_REQUIRES_RECONCILIATION') {
    await appendReconciliationException(ctx.pool, ctx.runId, {
      classification: 'CONFLICT_SOURCE_CHANGED_SINCE_IMPORT',
      categoryId: category.categoryId,
      sourceType: record.sourceType,
      sourceId: record.sourceId,
      reason:
        `source identity ${ctx.sourceDataset}/${record.sourceType}/${record.sourceId} was already imported ` +
        `with a different payload hash (previously ${existing?.sourceHash ?? 'unknown'}, now ${record.sourceHash}); ` +
        'no target state was written',
      affectedScope: `${category.categoryId} ${record.sourceId} -> ${existing?.targetKind ?? '?'} ${existing?.targetId ?? '?'}`,
      safetyImpact:
        'overwriting would destroy whichever version is authoritative; the target keeps the already-imported ' +
        'version until an owner decides',
      owner: 'migration owner',
      blocksCutover: true,
    });
    return 'recordsConflicted';
  }

  const handler = HANDLERS[category.categoryId];
  if (handler === undefined) return 'recordsDeferred';

  if (record.rawUnparseableText !== undefined) {
    await appendReconciliationException(ctx.pool, ctx.runId, {
      classification: 'QUARANTINED_UNREADABLE_SOURCE',
      categoryId: category.categoryId,
      sourceType: record.sourceType,
      sourceId: record.sourceId,
      reason: 'legacy payload was not parseable JSON at export; it is preserved in the bundle but cannot be transformed',
      affectedScope: `${category.categoryId} ${record.sourceId}`,
      safetyImpact: 'whatever this row represented is absent from the target and must be reconstructed or accepted lost',
      owner: 'migration owner',
      blocksCutover: true,
    });
    return 'recordsQuarantined';
  }

  const outcome = await handler(ctx, record);
  if (outcome.kind === 'QUARANTINED') {
    await appendReconciliationException(ctx.pool, ctx.runId, {
      ...outcome.exception,
      categoryId: category.categoryId,
      sourceType: record.sourceType,
      sourceId: record.sourceId,
    });
    return 'recordsQuarantined';
  }
  if (outcome.kind === 'DEFERRED') return 'recordsDeferred';
  if (outcome.kind === 'ARCHIVED') return 'recordsImported';

  await insertLegacyMapping(ctx.pool, {
    workspaceId: ctx.workspaceId,
    sourceDataset: ctx.sourceDataset,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    targetKind: outcome.targetKind,
    targetId: outcome.targetId,
    runId: ctx.runId,
    datasetHash: ctx.datasetHash,
    sourceHash: record.sourceHash,
    evidenceId: ctx.runEvidenceId,
    importerVersion: IMPORTER_VERSION,
    note: outcome.note,
  });
  return 'recordsImported';
}
