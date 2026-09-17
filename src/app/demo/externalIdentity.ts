/**
 * Source identity -> internal subject mapping for dataset materialization.
 *
 * Every identifier the dataset states (event id, draft id, commitment id,
 * provider booking reference, place id, …) is recorded as an external record
 * on one connection and linked, with evidence, to the canonical subject the
 * materializer created for it. That link is the resolution path: nothing in
 * the application, the tests or a later increment has to know or recompute a
 * generated UUID to find "the object this source id means".
 */
import type { Pool, PoolClient } from '../../persistence/postgres/pool.ts';
import type { UnitOfWork } from '../../contracts/v2/command/unitOfWork.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import {
  createExternalConnection,
  linkExternalRecord,
  observeExternalRecord,
} from '../../persistence/postgres/commands/arrangementCommands.ts';
import type { DatasetIdentityMinter } from './datasetIds.ts';

/** Record types this boundary maps. Opaque strings; no scenario meaning. */
export const SOURCE_RECORD_TYPES = {
  ORGANISATION: 'SOURCE_ORGANISATION',
  EVENT: 'SOURCE_ANCHOR_EVENT',
  PROGRAMME: 'SOURCE_PROGRAMME',
  PROGRAMME_ITEM: 'SOURCE_COMMITMENT',
  PLACE: 'SOURCE_PLACE',
  TRAVELLER: 'SOURCE_TRAVELLER_DRAFT',
  TRIP: 'SOURCE_TRIP',
  JOURNEY: 'SOURCE_JOURNEY',
  TRANSPORT_SERVICE: 'SOURCE_TRANSPORT_SERVICE',
  RESERVATION: 'SOURCE_BOOKING_REFERENCE',
  RULE_SET: 'SOURCE_RULE_SET',
  JURISDICTION: 'SOURCE_JURISDICTION',
} as const;

export interface ExternalIdentityContext {
  workspaceId: string;
  actorPrincipalId: string;
  uow: () => UnitOfWork;
  ids: DatasetIdentityMinter;
  evidenceId: string;
  observedAt: string;
}

function mustOk<T>(outcome: { ok: boolean; value?: T; conflict?: unknown }, label: string): T {
  if (!outcome.ok) throw new Error(`dataset materialization step "${label}" failed: ${JSON.stringify(outcome.conflict)}`);
  return outcome.value as T;
}

/**
 * Owns the one connection a dataset's source identities are observed on, and
 * the running revision that every record/link command must pin.
 */
export class SourceIdentityMap {
  private revision = 0;
  private readonly context: ExternalIdentityContext;
  readonly connectionId: string;

  constructor(context: ExternalIdentityContext) {
    this.context = context;
    this.connectionId = context.ids.id('external-connection', 'dataset');
  }

  async open(providerKind: string, organisationId: string): Promise<void> {
    const created = mustOk(
      await createExternalConnection(this.context.uow(), {
        workspaceId: this.context.workspaceId,
        actorPrincipalId: this.context.actorPrincipalId,
        idempotencyKey: this.context.ids.key('external-connection'),
        connection: { id: this.connectionId, organisationId, providerKind },
      }),
      'createExternalConnection',
    );
    this.revision = created.revision;
  }

  /**
   * Record that `externalId` of `recordType` was observed on this connection.
   * The record starts UNVERIFIED: only a separate evidence-backed link may
   * promote it to LINKED (F08), so observing a provider id never by itself
   * claims to have identified the internal object it belongs to.
   */
  async observe(recordType: string, externalId: string): Promise<string> {
    const recordId = this.context.ids.id('external-record', recordType, externalId);
    const observed = mustOk(
      await observeExternalRecord(this.context.uow(), {
        workspaceId: this.context.workspaceId,
        actorPrincipalId: this.context.actorPrincipalId,
        idempotencyKey: this.context.ids.key('external-record', recordType, externalId),
        connectionId: this.connectionId,
        expectedRevision: this.revision,
        record: {
          id: recordId,
          recordType,
          externalId,
          identityState: 'UNVERIFIED',
          observedAt: this.context.observedAt,
        },
      }),
      `observeExternalRecord(${recordType}:${externalId})`,
    );
    this.revision = observed.connectionRevision;
    return observed.recordId;
  }

  /** Bind an observed record to the canonical subject that source id means. */
  async link(recordType: string, externalId: string, subject: TypedRef): Promise<void> {
    const recordId = this.context.ids.id('external-record', recordType, externalId);
    const linked = mustOk(
      await linkExternalRecord(this.context.uow(), {
        workspaceId: this.context.workspaceId,
        actorPrincipalId: this.context.actorPrincipalId,
        idempotencyKey: this.context.ids.key('external-link', recordType, externalId),
        connectionId: this.connectionId,
        expectedRevision: this.revision,
        link: {
          id: this.context.ids.id('external-link', recordType, externalId),
          externalRecordId: recordId,
          canonicalSubject: subject,
          linkKind: 'SYSTEM_OF_RECORD',
          evidenceId: this.context.evidenceId,
          linkedAt: this.context.observedAt,
        },
      }),
      `linkExternalRecord(${recordType}:${externalId})`,
    );
    this.revision = linked.connectionRevision;
  }

  /** Observe `externalId` and bind it to the subject it names, in one step. */
  async map(recordType: string, externalId: string, subject: TypedRef): Promise<void> {
    await this.observe(recordType, externalId);
    await this.link(recordType, externalId, subject);
  }
}

export interface ResolvedSourceSubject {
  recordType: string;
  externalId: string;
  subject: TypedRef;
}

/**
 * Read the live source-identity mapping back out. This is the path callers
 * (including tests) use to go from a source id to the subject it means —
 * never a recomputed or remembered UUID.
 */
export async function resolveSourceSubjects(
  db: Pool | PoolClient,
  workspaceId: string,
  connectionId: string,
): Promise<Map<string, ResolvedSourceSubject>> {
  const rows = await db.query<{
    record_type: string;
    external_id: string;
    canonical_subject_kind: string;
    canonical_subject_id: string;
  }>(
    `SELECT r.record_type, r.external_id, l.canonical_subject_kind, l.canonical_subject_id
       FROM external_record_links l
       JOIN external_records r ON r.workspace_id = l.workspace_id AND r.id = l.external_record_id
      WHERE l.workspace_id = $1 AND r.connection_id = $2 AND l.superseded_at IS NULL
      ORDER BY r.record_type, r.external_id`,
    [workspaceId, connectionId],
  );
  const out = new Map<string, ResolvedSourceSubject>();
  for (const row of rows.rows) {
    out.set(`${row.record_type}:${row.external_id}`, {
      recordType: row.record_type,
      externalId: row.external_id,
      subject: { kind: row.canonical_subject_kind as TypedRef['kind'], id: row.canonical_subject_id },
    });
  }
  return out;
}
