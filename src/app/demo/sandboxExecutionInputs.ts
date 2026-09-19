/**
 * Explicit operator provision for synthetic sandbox execution inputs.
 *
 * This boundary accepts only caller-authored values. Source references are
 * resolved through the dataset's external identity map, and every write is
 * preceded by complete validation and conflict checks. It is intentionally
 * not part of demo boot/reset composition.
 */
import { z } from 'zod';
import { ExactMoneySchema } from '../../domain/v2/shared/money.ts';
import { resolveSourceSubjects, SOURCE_RECORD_TYPES } from './externalIdentity.ts';
import { recordTravellerBookingIdentity } from '../../persistence/postgres/execution/providerExecutionInputs.ts';
import { createBudget } from '../../persistence/postgres/commands/arrangementCommands.ts';
import type { UnitOfWork } from '../../contracts/v2/command/unitOfWork.ts';
import type { Pool, PoolClient } from '../../persistence/postgres/pool.ts';

const SourceTravellerRefSchema = z.string().regex(/^SOURCE_TRAVELLER_DRAFT:\S+$/, 'expected SOURCE_TRAVELLER_DRAFT:<source id>');
const SourceOrganisationRefSchema = z.string().regex(/^SOURCE_ORGANISATION:\S+$/, 'expected SOURCE_ORGANISATION:<source id>');
const DateSchema = z.iso.date();
const DateTimeSchema = z.iso.datetime({ offset: true });

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
}

export interface SandboxProvisionReport {
  workspaceId: string;
  connectionId: string;
  travellersCreated: number;
  travellersReused: number;
  budgetsCreated: number;
  budgetsReused: number;
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
  const text = actual instanceof Date ? actual.toISOString().slice(0, 10) : String(actual).slice(0, 10);
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
  };
}
