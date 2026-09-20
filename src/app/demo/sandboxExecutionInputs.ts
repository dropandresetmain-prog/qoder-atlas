/**
 * Explicit operator provision for synthetic sandbox execution inputs.
 *
 * This boundary accepts only caller-authored values. Source references are
 * resolved through the dataset's external identity map, and every write is
 * preceded by complete validation and conflict checks. It is intentionally
 * not part of demo boot/reset composition.
 */
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { ExactMoneySchema } from '../../domain/v2/shared/money.ts';
import { ProtectedDataRefSchema, type ProtectedDataRef } from '../../domain/v2/shared/identity.ts';
import { resolveSourceSubjects, SOURCE_RECORD_TYPES } from './externalIdentity.ts';
import { isSyntheticSandboxMarker, putSandboxProtectedDocument } from './sandboxProtectedDocuments.ts';
import { recordTravellerBookingIdentity } from '../../persistence/postgres/execution/providerExecutionInputs.ts';
import { createBudget } from '../../persistence/postgres/commands/arrangementCommands.ts';
import { appendCredentialVersion } from '../../persistence/postgres/commands/peopleCommands.ts';
import { recordEvidence, recordSource } from '../../persistence/postgres/commands/knowledgeCommands.ts';
import type { UnitOfWork } from '../../contracts/v2/command/unitOfWork.ts';
import type { Pool, PoolClient } from '../../persistence/postgres/pool.ts';

const SourceTravellerRefSchema = z.string().regex(/^SOURCE_TRAVELLER_DRAFT:\S+$/, 'expected SOURCE_TRAVELLER_DRAFT:<source id>');
const SourceOrganisationRefSchema = z.string().regex(/^SOURCE_ORGANISATION:\S+$/, 'expected SOURCE_ORGANISATION:<source id>');
const DateSchema = z.iso.date();
const DateTimeSchema = z.iso.datetime({ offset: true });
const PassportInputSchema = z.strictObject({
  credentialId: z.uuid(),
  versionId: z.uuid(),
  syntheticDocumentMarker: z.string().min(1).max(176),
  issuerCountry: z.string().regex(/^[A-Z]{2}$/, 'expected ISO 3166-1 alpha-2 uppercase code'),
  issueDate: DateSchema,
  expiryDate: DateSchema,
  issuerStatus: z.enum(['VALID', 'REVOKED', 'SUSPENDED', 'UNKNOWN']),
  physicallyAvailable: z.boolean(),
  observedAt: DateTimeSchema,
});

export const SandboxExecutionInputsFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sandbox: z.strictObject({
    environment: z.literal('sandbox'),
    marker: z.literal('synthetic-sandbox-inputs'),
  }),
  travellers: z.array(z.strictObject({
    sourceRef: SourceTravellerRefSchema,
    bookingIdentity: z.strictObject({
      gender: z.enum(['MALE', 'FEMALE']),
      contactEmail: z.string().email().max(254),
      dateOfBirth: DateSchema.optional(),
      nationality: z.string().regex(/^[A-Z]{2}$/, 'expected ISO 3166-1 alpha-2 uppercase code').optional(),
    }),
    passport: PassportInputSchema.optional(),
  })),
  budgets: z.array(z.strictObject({
    organisationSourceRef: SourceOrganisationRefSchema,
    budget: z.strictObject({
      id: z.uuid(),
      purpose: z.string().trim().min(1),
      amount: ExactMoneySchema,
      validFrom: DateTimeSchema.optional(),
      validUntil: DateTimeSchema.optional(),
    }),
    idempotencyKey: z.string().trim().min(1),
  })),
});

export type SandboxExecutionInputsFile = z.infer<typeof SandboxExecutionInputsFileSchema>;

export class SandboxExecutionInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'SandboxExecutionInputError';
  }
}

export function parseSandboxExecutionInputs(value: unknown): SandboxExecutionInputsFile {
  const parsed = SandboxExecutionInputsFileSchema.safeParse(value);
  if (!parsed.success) {
    throw new SandboxExecutionInputError('INVALID_INPUT', 'sandbox execution input file failed its strict schema validation');
  }
  const travellerRefs = new Set<string>();
  for (const item of parsed.data.travellers) {
    if (travellerRefs.has(item.sourceRef)) throw new SandboxExecutionInputError('DUPLICATE_INPUT', `duplicate traveller source reference ${item.sourceRef}`);
    travellerRefs.add(item.sourceRef);
  }
  const budgetIds = new Set<string>();
  const budgetIdempotencyKeys = new Set<string>();
  for (const item of parsed.data.budgets) {
    if (budgetIds.has(item.budget.id)) throw new SandboxExecutionInputError('DUPLICATE_INPUT', `duplicate budget id ${item.budget.id}`);
    if (budgetIdempotencyKeys.has(item.idempotencyKey)) throw new SandboxExecutionInputError('DUPLICATE_INPUT', `duplicate budget idempotency key ${item.idempotencyKey}`);
    if (item.budget.validFrom && item.budget.validUntil && Date.parse(item.budget.validUntil) <= Date.parse(item.budget.validFrom)) {
      throw new SandboxExecutionInputError('INVALID_INPUT', `budget ${item.budget.id} validUntil must be after validFrom`);
    }
    budgetIds.add(item.budget.id);
    budgetIdempotencyKeys.add(item.idempotencyKey);
  }
  return parsed.data;
}

export function assertSyntheticSandboxEnvironment(env: Record<string, string | undefined>): void {
  if (env.ATLAS_ENV !== 'sandbox') {
    throw new SandboxExecutionInputError('SANDBOX_REQUIRED', 'synthetic execution inputs require ATLAS_ENV=sandbox');
  }
  if (env.NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS !== '1') {
    throw new SandboxExecutionInputError('EXPLICIT_MARKER_REQUIRED', 'set NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS=1 to opt into synthetic execution inputs');
  }
}

type Queryable = Pick<Pool | PoolClient, 'query'>;

export interface SandboxProvisionParams {
  db: Pool | PoolClient;
  uow: () => UnitOfWork;
  workspaceId: string;
  actorPrincipalId: string;
  connectionId: string;
  input: unknown;
  env?: Record<string, string | undefined>;
  documentKey?: Uint8Array;
  documentKeyId?: string;
}

export interface SandboxProvisionReport {
  workspaceId: string;
  connectionId: string;
  travellersCreated: number;
  travellersReused: number;
  budgetsCreated: number;
  budgetsReused: number;
  passportsCreated: number;
  passportsReused: number;
}

function normalizeDecimal(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  const normalizedFraction = fraction.replace(/0+$/, '');
  return `${whole!.replace(/^(-?)0+(?=\d)/, '$1')}${normalizedFraction ? `.${normalizedFraction}` : ''}`;
}

function sameInstant(actual: Date | string | null, expected: string | undefined): boolean {
  if (actual === null || expected === undefined) return actual === null && expected === undefined;
  const parsed = new Date(actual);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === new Date(expected).toISOString();
}

function sameDate(actual: Date | string | null, expected: string | undefined): boolean {
  if (actual === null || expected === undefined) return actual === null && expected === undefined;
  const text = actual instanceof Date
    ? `${actual.getFullYear()}-${String(actual.getMonth() + 1).padStart(2, '0')}-${String(actual.getDate()).padStart(2, '0')}`
    : String(actual).slice(0, 10);
  return text === expected;
}

function subjectIdFor(
  mapping: Map<string, { recordType: string; externalId: string; subject: { kind: string; id: string } }>,
  sourceRef: string,
  expectedType: string,
  expectedKind: string,
): string {
  const found = mapping.get(sourceRef);
  if (!found || found.recordType !== expectedType || found.subject.kind !== expectedKind) {
    throw new SandboxExecutionInputError('UNKNOWN_SOURCE_REF', `source reference ${sourceRef} is not linked to the expected canonical subject`);
  }
  return found.subject.id;
}

function deterministicUuid(namespace: string, ...parts: string[]): string {
  const digest = createHash('sha256').update(`northstar:sandbox:${namespace}:${parts.join('|')}`, 'utf8').digest();
  digest[6] = (digest[6]! & 0x0f) | 0x40;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function passportIds(workspaceId: string, travellerId: string, versionId: string): { sourceId: string; evidenceId: string } {
  return {
    sourceId: deterministicUuid('passport-source', workspaceId, travellerId, versionId),
    evidenceId: deterministicUuid('passport-evidence', workspaceId, travellerId, versionId),
  };
}

type PassportItem = z.infer<typeof SandboxExecutionInputsFileSchema>['travellers'][number] & { travellerId: string };
type PassportPlan = {
  item: PassportItem;
  sourceId: string;
  evidenceId: string;
  document?: ProtectedDataRef;
  expectedRevision: number;
  sourceAction: 'create' | 'reuse';
  evidenceAction: 'create' | 'reuse';
  credentialAction: 'create' | 'reuse';
};

function conflict(message: string): never {
  throw new SandboxExecutionInputError('CONFLICTING_EXISTING_INPUT', message);
}

function documentRefMatches(actual: { content_hash: string; document_number_storage_ref: string; document_number_access_policy_id: string }, expected: ProtectedDataRef): boolean {
  return actual.content_hash === expected.contentHash &&
    actual.document_number_storage_ref === expected.storageRef &&
    actual.document_number_access_policy_id === expected.accessPolicyId;
}

async function loadPassportRows(db: Queryable, workspaceId: string, item: PassportItem, sourceId: string, evidenceId: string): Promise<{ credentialAction: 'create' | 'reuse'; sourceAction: 'create' | 'reuse'; evidenceAction: 'create' | 'reuse'; expectedRevision: number }> {
  const passport = item.passport!;
  const version = (await db.query<{
    credential_id: string; traveller_id: string; current_version_id: string; credential_kind: string; issuer_country: string;
    version_id: string; version_kind: string; issue_date: string | Date; expiry_date: string | Date | null;
    issuer_status: string; physically_available: boolean | null; evidence_id: string;
    content_hash: string | null; document_number_storage_ref: string | null; document_number_access_policy_id: string | null;
  }>(
    `SELECT c.id AS credential_id, c.traveller_id, c.current_version_id, c.kind AS credential_kind, c.issuer_country,
            v.id AS version_id, v.kind AS version_kind, v.issue_date, v.expiry_date, v.issuer_status,
            v.physically_available, v.evidence_id, p.document_number_content_hash AS content_hash,
            p.document_number_storage_ref, p.document_number_access_policy_id
       FROM travel_credentials c
       LEFT JOIN credential_versions v ON v.workspace_id = c.workspace_id AND v.credential_id = c.id
       LEFT JOIN passport_details p ON p.workspace_id = v.workspace_id AND p.credential_version_id = v.id
      WHERE c.workspace_id = $1 AND c.id = $2`,
    [workspaceId, passport.credentialId],
  )).rows[0];
  const versionOwner = (await db.query<{ credential_id: string; traveller_id: string }>(
    `SELECT c.id AS credential_id, c.traveller_id
       FROM credential_versions v JOIN travel_credentials c ON c.workspace_id = v.workspace_id AND c.id = v.credential_id
      WHERE v.workspace_id = $1 AND v.id = $2`,
    [workspaceId, passport.versionId],
  )).rows[0];
  if (versionOwner && versionOwner.credential_id !== passport.credentialId) conflict(`passport version ${passport.versionId} belongs to another credential`);
  const head = (await db.query<{ revision: string }>(
    `SELECT revision::text AS revision FROM aggregate_heads WHERE workspace_id = $1 AND aggregate_id = $2`,
    [workspaceId, item.travellerId],
  )).rows[0];
  if (!head) throw new SandboxExecutionInputError('UNKNOWN_TRAVELLER', 'resolved traveller aggregate head is missing');
  if (!version) return { credentialAction: 'create', sourceAction: 'create', evidenceAction: 'create', expectedRevision: Number(head.revision) };
  if (version.traveller_id !== item.travellerId) conflict(`passport credential ${passport.credentialId} belongs to another traveller`);
  if (version.version_id !== passport.versionId || version.current_version_id !== passport.versionId) conflict(`passport credential ${passport.credentialId} has a different current edition`);
  if (version.credential_kind !== 'PASSPORT' || version.version_kind !== 'PASSPORT' || version.issuer_country !== passport.issuerCountry ||
      !sameDate(version.issue_date, passport.issueDate) || !sameDate(version.expiry_date, passport.expiryDate) ||
      version.issuer_status !== passport.issuerStatus || version.physically_available !== passport.physicallyAvailable ||
      version.evidence_id !== evidenceId || version.content_hash === null || version.document_number_storage_ref === null || version.document_number_access_policy_id === null) {
    conflict(`existing passport edition ${passport.versionId} conflicts with the requested metadata`);
  }
  return { credentialAction: 'reuse', sourceAction: 'reuse', evidenceAction: 'reuse', expectedRevision: Number(head.revision) };
}

async function loadSourceAction(db: Queryable, workspaceId: string, sourceId: string, passport: NonNullable<PassportItem['passport']>): Promise<'create' | 'reuse'> {
  const row = (await db.query<{ source_identity: string; received_at: Date | string; content_hash: string; content_type: string }>(
    `SELECT source_identity, received_at, content_hash, content_type FROM source_records WHERE workspace_id = $1 AND id = $2`, [workspaceId, sourceId],
  )).rows[0];
  if (!row) return 'create';
  if (row.source_identity !== 'NORTHSTAR_SYNTHETIC_SANDBOX_PASSPORT' || !sameInstant(row.received_at, passport.observedAt) ||
      row.content_type !== 'application/x-northstar-synthetic-passport-marker') conflict(`existing passport source ${sourceId} conflicts`);
  return 'reuse';
}

async function loadEvidenceAction(db: Queryable, workspaceId: string, evidenceId: string, travellerId: string, sourceId: string, passport: NonNullable<PassportItem['passport']>): Promise<'create' | 'reuse'> {
  const row = (await db.query<{ assertion_type: string; observed_at: Date | string; schema_version: string }>(
    `SELECT assertion_type, observed_at, schema_version FROM evidence_records WHERE workspace_id = $1 AND id = $2`, [workspaceId, evidenceId],
  )).rows[0];
  if (!row) return 'create';
  const links = (await db.query<{ source_record_id: string }>(
    `SELECT source_record_id FROM evidence_sources WHERE workspace_id = $1 AND evidence_record_id = $2`, [workspaceId, evidenceId],
  )).rows.map((value) => value.source_record_id);
  const subjects = (await db.query<{ subject_id: string; subject_kind: string }>(
    `SELECT subject_id, subject_kind FROM evidence_subjects WHERE workspace_id = $1 AND evidence_record_id = $2`, [workspaceId, evidenceId],
  )).rows;
  if (row.assertion_type !== 'SYNTHETIC_SANDBOX_PASSPORT_MARKER' || !sameInstant(row.observed_at, passport.observedAt) ||
      row.schema_version !== 'sandbox-passport/1' || links.length !== 1 || links[0] !== sourceId || subjects.length !== 1 ||
      subjects[0]!.subject_kind !== 'TRAVELLER' || subjects[0]!.subject_id !== travellerId) conflict(`existing passport evidence ${evidenceId} conflicts`);
  return 'reuse';
}

async function assertPassportDocumentRef(db: Queryable, workspaceId: string, versionId: string, document: ProtectedDataRef): Promise<void> {
  const row = (await db.query<{ content_hash: string; document_number_storage_ref: string; document_number_access_policy_id: string }>(
    `SELECT document_number_content_hash AS content_hash, document_number_storage_ref, document_number_access_policy_id
       FROM passport_details WHERE workspace_id = $1 AND credential_version_id = $2`, [workspaceId, versionId],
  )).rows[0];
  if (row && !documentRefMatches(row, document)) conflict(`existing passport document reference for ${versionId} conflicts`);
}

async function assertUniqueMappings(db: Queryable, workspaceId: string, connectionId: string, refs: string[]): Promise<void> {
  if (refs.length === 0) return;
  const pieces = refs.map((ref) => {
    const separator = ref.indexOf(':');
    return { recordType: ref.slice(0, separator), externalId: ref.slice(separator + 1) };
  });
  const result = await db.query<{ record_type: string; external_id: string; links: string; targets: string }>(
    `SELECT r.record_type, r.external_id, count(*)::text AS links,
            count(DISTINCT (l.canonical_subject_kind, l.canonical_subject_id))::text AS targets
       FROM external_records r
       JOIN external_record_links l ON l.workspace_id = r.workspace_id AND l.external_record_id = r.id
      WHERE r.workspace_id = $1 AND r.connection_id = $2
        AND l.superseded_at IS NULL
        AND (r.record_type, r.external_id) IN (SELECT * FROM unnest($3::text[], $4::text[]))
      GROUP BY r.record_type, r.external_id`,
    [workspaceId, connectionId, pieces.map((p) => p.recordType), pieces.map((p) => p.externalId)],
  );
  for (const row of result.rows) {
    if (row.links !== '1' || row.targets !== '1') {
      throw new SandboxExecutionInputError('AMBIGUOUS_SOURCE_REF', `source reference ${row.record_type}:${row.external_id} has ambiguous live identity links`);
    }
  }
}

async function ensureConnection(db: Queryable, workspaceId: string, connectionId: string): Promise<void> {
  const result = await db.query('SELECT 1 FROM external_connections WHERE workspace_id = $1 AND id = $2', [workspaceId, connectionId]);
  if (result.rowCount !== 1) throw new SandboxExecutionInputError('UNKNOWN_CONNECTION', 'configured source connection is not present in this workspace');
}

export async function provisionSandboxExecutionInputs(params: SandboxProvisionParams): Promise<SandboxProvisionReport> {
  assertSyntheticSandboxEnvironment(params.env ?? process.env);
  const input = parseSandboxExecutionInputs(params.input);
  await ensureConnection(params.db, params.workspaceId, params.connectionId);

  const mapping = await resolveSourceSubjects(params.db, params.workspaceId, params.connectionId);
  await assertUniqueMappings(params.db, params.workspaceId, params.connectionId, [
    ...input.travellers.map((item) => item.sourceRef),
    ...input.budgets.map((item) => item.organisationSourceRef),
  ]);

  const travellerWrites = input.travellers.map((item) => ({
    ...item,
    travellerId: subjectIdFor(mapping, item.sourceRef, SOURCE_RECORD_TYPES.TRAVELLER, 'TRAVELLER'),
  }));
  const resolvedTravellerIds = new Set<string>();
  for (const item of travellerWrites) {
    if (resolvedTravellerIds.has(item.travellerId)) {
      throw new SandboxExecutionInputError('DUPLICATE_RESOLVED_TRAVELLER', `multiple source references resolve to traveller ${item.travellerId}`);
    }
    resolvedTravellerIds.add(item.travellerId);
  }
  const budgetWrites = input.budgets.map((item) => ({
    ...item,
    organisationId: subjectIdFor(mapping, item.organisationSourceRef, SOURCE_RECORD_TYPES.ORGANISATION, 'ORGANISATION'),
  }));

  const passportItems = travellerWrites.filter((item): item is PassportItem => item.passport !== undefined);
  const credentialIds = new Set<string>();
  const versionIds = new Set<string>();
  for (const item of passportItems) {
    const passport = item.passport!;
    if (!isSyntheticSandboxMarker(passport.syntheticDocumentMarker)) {
      throw new SandboxExecutionInputError('INVALID_INPUT', 'passport syntheticDocumentMarker is not an accepted synthetic sandbox marker');
    }
    if (credentialIds.has(passport.credentialId) || versionIds.has(passport.versionId)) {
      throw new SandboxExecutionInputError('DUPLICATE_INPUT', 'passport credentialId and versionId must be unique within the input');
    }
    credentialIds.add(passport.credentialId);
    versionIds.add(passport.versionId);
  }
  if (passportItems.length > 0) {
    if (!params.documentKey || params.documentKey.length !== 32 || !params.documentKeyId?.trim()) {
      throw new SandboxExecutionInputError('DOCUMENT_KEY_REQUIRED', 'passport inputs require an explicit 32-byte sandbox document key and key id');
    }
  }

  const passportPlans: PassportPlan[] = [];
  for (const item of passportItems) {
    const ids = passportIds(params.workspaceId, item.travellerId, item.passport!.versionId);
    const status = await loadPassportRows(params.db, params.workspaceId, item, ids.sourceId, ids.evidenceId);
    const sourceAction = await loadSourceAction(params.db, params.workspaceId, ids.sourceId, item.passport!);
    const evidenceAction = await loadEvidenceAction(params.db, params.workspaceId, ids.evidenceId, item.travellerId, ids.sourceId, item.passport!);
    passportPlans.push({ item, ...ids, ...status, sourceAction, evidenceAction });
  }

  // The encrypted marker is durable and idempotent. It is created only after
  // all caller IDs, aliases, and existing canonical rows have been checked.
  for (const plan of passportPlans) {
    plan.document = await putSandboxProtectedDocument({
      db: params.db,
      workspaceId: params.workspaceId,
      actorPrincipalId: params.actorPrincipalId,
      plaintext: plan.item.passport!.syntheticDocumentMarker,
      key: params.documentKey!,
      keyId: params.documentKeyId!,
      env: params.env,
    });
    await assertPassportDocumentRef(params.db, params.workspaceId, plan.item.passport!.versionId, plan.document);
  }

  const identityStatus: Array<{ item: (typeof travellerWrites)[number]; action: 'create' | 'reuse' }> = [];
  for (const item of travellerWrites) {
    const row = (await params.db.query<{ gender: 'MALE' | 'FEMALE'; contact_email: string | null; date_of_birth: Date | string | null; nationality: string | null }>(
      `SELECT gender, contact_email, date_of_birth, nationality
         FROM traveller_booking_identities WHERE workspace_id = $1 AND traveller_id = $2`,
      [params.workspaceId, item.travellerId],
    )).rows[0];
    const expected = item.bookingIdentity;
    if (!row) identityStatus.push({ item, action: 'create' });
    else if (
      row.gender !== expected.gender || row.contact_email !== expected.contactEmail ||
      !sameDate(row.date_of_birth, expected.dateOfBirth) || row.nationality !== (expected.nationality ?? null)
    ) {
      throw new SandboxExecutionInputError('CONFLICTING_EXISTING_INPUT', `existing booking identity conflicts for ${item.sourceRef}`);
    } else identityStatus.push({ item, action: 'reuse' });
  }

  const budgetStatus: Array<{ item: (typeof budgetWrites)[number]; action: 'create' | 'reuse' }> = [];
  for (const item of budgetWrites) {
    const row = (await params.db.query<{ organisation_id: string; purpose: string; amount: string; currency: string; valid_from: Date | string | null; valid_until: Date | string | null }>(
      `SELECT organisation_id, purpose, amount::text AS amount, currency, valid_from, valid_until
         FROM budgets WHERE workspace_id = $1 AND id = $2`,
      [params.workspaceId, item.budget.id],
    )).rows[0];
    const expected = item.budget;
    if (!row) budgetStatus.push({ item, action: 'create' });
    else if (
      row.organisation_id !== item.organisationId || row.purpose !== expected.purpose ||
      normalizeDecimal(row.amount) !== normalizeDecimal(expected.amount.amount) || row.currency !== expected.amount.currency ||
      !sameInstant(row.valid_from, expected.validFrom) || !sameInstant(row.valid_until, expected.validUntil)
    ) {
      throw new SandboxExecutionInputError('CONFLICTING_EXISTING_INPUT', `existing budget conflicts for ${expected.id}`);
    } else budgetStatus.push({ item, action: 'reuse' });
  }

  let budgetsCreated = 0;
  for (const item of budgetStatus) {
    if (item.action === 'reuse') continue;
    const outcome = await createBudget(params.uow(), {
      workspaceId: params.workspaceId,
      actorPrincipalId: params.actorPrincipalId,
      idempotencyKey: item.item.idempotencyKey,
      budget: { id: item.item.budget.id, organisationId: item.item.organisationId, purpose: item.item.budget.purpose, amount: item.item.budget.amount, validFrom: item.item.budget.validFrom, validUntil: item.item.budget.validUntil },
    });
    if (!outcome.ok) throw new SandboxExecutionInputError('WRITE_CONFLICT', `budget command refused ${item.item.budget.id}: ${outcome.conflict.kind}`);
    budgetsCreated++;
  }

  let passportsCreated = 0;
  for (const plan of passportPlans) {
    const passport = plan.item.passport!;
    if (plan.sourceAction === 'create') {
      const source = await recordSource(params.uow(), {
        workspaceId: params.workspaceId,
        actorPrincipalId: params.actorPrincipalId,
        sourceId: plan.sourceId,
        idempotencyKey: `sandbox-passport-source:${passport.versionId}`,
        sourceIdentity: 'NORTHSTAR_SYNTHETIC_SANDBOX_PASSPORT',
        receivedAt: passport.observedAt,
        contentHash: plan.document!.contentHash,
        contentType: 'application/x-northstar-synthetic-passport-marker',
        protectedLocationRef: plan.document!.storageRef,
        rawContentHash: plan.document!.contentHash,
        rawStorageRef: plan.document!.storageRef,
        rawAccessPolicyId: plan.document!.accessPolicyId,
        captureMetadata: { provenance: 'caller-authored synthetic sandbox passport', observedAt: passport.observedAt },
        captureMetadataVersion: 'sandbox-passport/1',
      });
      if (!source.ok) throw new SandboxExecutionInputError('WRITE_CONFLICT', `passport source command refused ${plan.sourceId}: ${source.conflict.kind}`);
    }
    if (plan.evidenceAction === 'create') {
      const evidence = await recordEvidence(params.uow(), {
        workspaceId: params.workspaceId,
        actorPrincipalId: params.actorPrincipalId,
        evidenceId: plan.evidenceId,
        idempotencyKey: `sandbox-passport-evidence:${passport.versionId}`,
        assertionType: 'SYNTHETIC_SANDBOX_PASSPORT_MARKER',
        observedAt: passport.observedAt,
        schemaVersion: 'sandbox-passport/1',
        sourceIds: [plan.sourceId],
        subjectRefs: [{ kind: 'TRAVELLER', id: plan.item.travellerId }],
        interpretationProvenance: 'caller-authored synthetic SANDBOX input',
      });
      if (!evidence.ok) throw new SandboxExecutionInputError('WRITE_CONFLICT', `passport evidence command refused ${plan.evidenceId}: ${evidence.conflict.kind}`);
    }
    if (plan.credentialAction === 'create') {
      const credential = await appendCredentialVersion(params.uow(), {
        workspaceId: params.workspaceId,
        actorPrincipalId: params.actorPrincipalId,
        idempotencyKey: `sandbox-passport-credential:${passport.versionId}`,
        travellerId: plan.item.travellerId,
        credentialId: passport.credentialId,
        versionId: passport.versionId,
        kind: 'PASSPORT',
        issuerCountry: passport.issuerCountry,
        issueDate: passport.issueDate,
        expiryDate: passport.expiryDate,
        issuerStatus: passport.issuerStatus,
        physicallyAvailable: passport.physicallyAvailable,
        evidenceId: plan.evidenceId,
        acceptedAt: passport.observedAt,
        documentNumber: plan.document,
        detail: { kind: 'PASSPORT', documentNumber: plan.document! },
        expectedRevision: plan.expectedRevision,
      });
      if (!credential.ok) throw new SandboxExecutionInputError('WRITE_CONFLICT', `passport credential command refused ${passport.versionId}: ${credential.conflict.kind}`);
      passportsCreated++;
    }
  }

  let travellersCreated = 0;
  for (const item of identityStatus) {
    if (item.action === 'reuse') continue;
    await recordTravellerBookingIdentity(params.db, {
      workspaceId: params.workspaceId,
      actorId: params.actorPrincipalId,
      travellerId: item.item.travellerId,
      ...item.item.bookingIdentity,
    });
    const check = (await params.db.query<{ gender: 'MALE' | 'FEMALE'; contact_email: string | null; date_of_birth: Date | string | null; nationality: string | null }>(
      `SELECT gender, contact_email, date_of_birth, nationality
         FROM traveller_booking_identities WHERE workspace_id = $1 AND traveller_id = $2`,
      [params.workspaceId, item.item.travellerId],
    )).rows[0];
    if (!check || check.gender !== item.item.bookingIdentity.gender || check.contact_email !== item.item.bookingIdentity.contactEmail ||
      !sameDate(check.date_of_birth, item.item.bookingIdentity.dateOfBirth) || check.nationality !== (item.item.bookingIdentity.nationality ?? null)) {
      throw new SandboxExecutionInputError('WRITE_FAILED', `persisted booking identity did not match the requested input for ${item.item.sourceRef}`);
    }
    travellersCreated++;
  }

  return {
    workspaceId: params.workspaceId,
    connectionId: params.connectionId,
    travellersCreated,
    travellersReused: identityStatus.filter((item) => item.action === 'reuse').length,
    budgetsCreated,
    budgetsReused: budgetStatus.filter((item) => item.action === 'reuse').length,
    passportsCreated,
    passportsReused: passportPlans.filter((item) => item.credentialAction === 'reuse').length,
  };
}
