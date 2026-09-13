/**
 * NORTHSTAR M2 lane P — people, governance and credential domain commands.
 *
 * These are the only writers for the tables `PgTravellerRepository` and
 * `PgGovernanceRepository` touch. Every state change enters through a
 * `DomainCommandEnvelope` carrying `expectedAggregateRevisions`, so a stale write
 * is a typed `STALE_AGGREGATE_REVISION` conflict rather than a silent overwrite
 * (DATA_STRUCTURE_LOGICAL_SCHEMA.md §11.1), and every one of them appends
 * `change_records` + `outbox` and returns a committed `CommandReceipt`.
 *
 * The shape is the accepted M1 precedent in `workspaceCommands.ts`, lifted into a
 * helper because this lane has fourteen handlers doing the same five steps:
 * validate payload -> build envelope -> let `PgUnitOfWork` claim idempotency and
 * lock/verify revisions -> write typed rows and CAS the head -> audit + receipt.
 *
 * Replay safety (C1 amendment c): every UUID, derived edition number default and
 * `issuedAt`/`acceptedAt`/`recordedAt` instant is computed *before*
 * `uow.execute`, because `execute` may run the callback again on a serializable
 * retry. Nothing here performs provider, network or irreversible work.
 *
 * F05 is preserved by construction: `recordTravellerRelationship` and
 * `assignResponsibility` never write `authority_grants`, `grant_actions` or
 * `grant_scopes`, and `issueAuthorityGrant` is the only path that does.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  DomainCommandEnvelopeSchema,
  type DomainCommandEnvelope,
} from '../../../contracts/v2/command/domainCommand.ts';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import type { ExpectedRevision, SubjectKind, TypedRef } from '../../../domain/v2/shared/identity.ts';
import { ProtectedDataRefSchema, TypedRefSchema } from '../../../domain/v2/shared/identity.ts';
import { compareInstants, DateIntervalSchema, InstantSchema, LocalDateSchema } from '../../../domain/v2/shared/time.ts';
import { typedConflict, type TypedConflict, type TypedResult } from '../../../domain/v2/shared/errors.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import {
  advanceHead,
  appendAuditTrail,
  buildReceipt,
  createRoot,
  missingHeadConflict,
  staleRevisionConflict,
  lockedRevisionOf,
  type AdvancedRoot,
} from '../commandSupport.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';
import { PgTravellerRepository, type TravelHistoryRecord } from '../repositories/pgTravellerRepository.ts';
import { PgGovernanceRepository } from '../repositories/pgGovernanceRepository.ts';

const SCHEMA_VERSION = '1';

/** Columns typed `uuid` in 0010-0029 are validated as UUIDs, not free-form subject ids. */
const Uuid = z.uuid();
const NameKindInput = z.enum(['LEGAL', 'DISPLAY', 'PREFERRED', 'OTHER']);
const ChannelKindInput = z.enum(['EMAIL', 'PHONE', 'POSTAL_ADDRESS', 'OTHER']);
const AssertionTypeInput = z.enum([
  'CITIZENSHIP',
  'RESIDENCY',
  'ACCESSIBILITY_NEED',
  'SUPPORT_NEED',
  'CONTACT_PREFERENCE',
]);
const CredentialKindInput = z.enum(['PASSPORT', 'VISA', 'E_AUTHORISATION', 'RESIDENCE_PERMIT', 'HEALTH_CREDENTIAL']);
const RelationshipTypeInput = z.enum(['PARENT_GUARDIAN', 'SPOUSE_PARTNER', 'PEER', 'ASSISTANT']);
const ResponsibilityRoleInput = z.enum(['OPERATOR', 'ARRANGER', 'SERVICER', 'PAYER', 'DUTY_OF_CARE']);
const LinkTypeInput = z.enum(['VISA_TO_PASSPORT', 'PERMIT_TO_PASSPORT']);
/**
 * The contract's `TypedRefSchema` accepts any registry-safe id, but every column
 * this lane writes through a TypedRef is typed `uuid` (0010-0029). Refining the
 * frozen schema keeps a malformed id a typed validation conflict instead of a
 * raw `22P02` from PostgreSQL.
 */
const RegistryTypedRefSchema = TypedRefSchema.refine((ref) => Uuid.safeParse(ref.id).success, {
  message: 'id must be a UUID: every registry-backed column in this lane is typed uuid',
});

/** Shared envelope fields every command in this lane is submitted with. */
export interface PeopleCommandContext {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
}

interface SubmitSpec<R> {
  uow: UnitOfWork;
  commandType: string;
  destinationKind: string;
  context: PeopleCommandContext;
  /** Already zod-parsed; it is what the canonical payload hash is computed from. */
  payload: Record<string, unknown>;
  expectedAggregateRevisions?: ExpectedRevision[];
  representedPartyId?: string;
  evidenceRefs?: string[];
  body: (ctx: {
    envelope: DomainCommandEnvelope;
    lockedHeads: { aggregateRef: TypedRef; revision: number }[];
  }) => Promise<TypedResult<{ value: R; advanced: AdvancedRoot[] }>>;
}

/**
 * Builds the envelope, runs the handler body inside `PgUnitOfWork.execute`, then
 * appends the audit trail and builds the receipt. A `false` from the body is a
 * typed conflict: the transaction rolls back and nothing is written.
 */
async function submitCommand<R>(spec: SubmitSpec<R>): Promise<ExecuteOutcome<R>> {
  const envelope = DomainCommandEnvelopeSchema.parse({
    commandType: spec.commandType,
    schemaVersion: SCHEMA_VERSION,
    workspaceId: spec.context.workspaceId,
    actorPrincipalId: spec.context.actorPrincipalId,
    ...(spec.representedPartyId === undefined ? {} : { representedPartyId: spec.representedPartyId }),
    idempotencyKey: spec.context.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(spec.payload),
    expectedAggregateRevisions: spec.expectedAggregateRevisions ?? [],
    typedPayload: spec.payload,
    evidenceRefs: spec.evidenceRefs ?? [],
  });

  return spec.uow.execute<R>(envelope, async (ctx) => {
    const outcome = await spec.body({ envelope, lockedHeads: ctx.lockedHeads });
    if (!outcome.ok) return outcome;
    const { value, advanced } = outcome.value;
    await appendAuditTrail({
      envelope,
      advanced,
      destinationKind: spec.destinationKind,
      payload: value,
    });
    return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
  });
}

/** Registers a brand-new root subject: head first, then the registry row. */
async function createNewRoot(params: {
  workspaceId: string;
  id: string;
  kind: SubjectKind;
}): Promise<AdvancedRoot> {
  await createRoot(params);
  return {
    aggregateRef: { kind: params.kind, id: params.id },
    beforeRevision: null,
    afterRevision: 1,
  };
}

/**
 * Compare-and-set on an existing root using the revision `PgUnitOfWork` already
 * locked and verified, so a concurrent mover becomes a typed conflict.
 */
async function advanceExistingRoot(params: {
  workspaceId: string;
  aggregateRef: TypedRef;
  lockedHeads: { aggregateRef: TypedRef; revision: number }[];
}): Promise<TypedResult<AdvancedRoot>> {
  const locked = lockedRevisionOf(params.lockedHeads, params.aggregateRef.id);
  if (locked === undefined) return { ok: false, conflict: missingHeadConflict(params.aggregateRef) };
  const next = await advanceHead({
    workspaceId: params.workspaceId,
    aggregateId: params.aggregateRef.id,
    fromRevision: locked,
  });
  if (next === undefined) return { ok: false, conflict: staleRevisionConflict(params.aggregateRef, locked) };
  return {
    ok: true,
    value: { aggregateRef: params.aggregateRef, beforeRevision: locked, afterRevision: next },
  };
}

function validationConflict(message: string, subjectRefs: TypedRef[] = []): TypedResult<never> {
  return { ok: false, conflict: typedConflict('VALIDATION_FAILED', message, subjectRefs) };
}

function duplicateConflict(message: string, subjectRefs: TypedRef[]): TypedResult<never> {
  return { ok: false, conflict: typedConflict('DUPLICATE_REGISTRATION', message, subjectRefs) };
}

function notOk<R>(conflict: TypedConflict): TypedResult<R> {
  return { ok: false, conflict };
}

const travellerRef = (id: string): TypedRef => ({ kind: 'TRAVELLER', id });

// ---------------------------------------------------------------------------
// Traveller identity
// ---------------------------------------------------------------------------

const NameEditionInput = z.strictObject({
  id: Uuid.optional(),
  nameKind: NameKindInput,
  displayValue: z.string().min(1),
  familyName: z.string().min(1).optional(),
  givenName: z.string().min(1).optional(),
  effectiveRange: DateIntervalSchema,
  evidenceId: Uuid,
});

const ContactEditionInput = z.strictObject({
  id: Uuid.optional(),
  channel: ChannelKindInput,
  maskedLabel: z.string().min(1),
  protectedValue: ProtectedDataRefSchema,
  effectiveRange: DateIntervalSchema,
  evidenceId: Uuid,
});

const RecordTravellerPayloadSchema = z.strictObject({
  travellerId: Uuid.optional(),
  displayName: NameEditionInput,
  contacts: z.array(ContactEditionInput).optional(),
});

export interface RecordTravellerParams extends PeopleCommandContext {
  travellerId?: string;
  displayName: z.input<typeof NameEditionInput>;
  contacts?: z.input<typeof ContactEditionInput>[];
}

export interface TravellerRecordedResult {
  travellerId: string;
  displayNameId: string;
  revision: number;
}

/**
 * A Traveller is a stable person: the command writes the identity row and its
 * first name edition together (0012's TRAVELLER subtype checker requires the
 * display name to exist and to belong to this person).
 */
export async function recordTraveller(
  uow: UnitOfWork,
  params: RecordTravellerParams,
): Promise<ExecuteOutcome<TravellerRecordedResult>> {
  const parsed = RecordTravellerPayloadSchema.safeParse({
    travellerId: params.travellerId,
    displayName: params.displayName,
    contacts: params.contacts,
  });
  if (!parsed.success) {
    return {
      ok: false,
      conflict: typedConflict('VALIDATION_FAILED', `TRAVELLER_RECORDED payload rejected: ${parsed.error.message}`),
    };
  }
  const travellerId = parsed.data.travellerId ?? randomUUID();
  const displayNameId = parsed.data.displayName.id ?? randomUUID();
  const contactIds = (parsed.data.contacts ?? []).map((contact) => contact.id ?? randomUUID());
  const payload = { ...parsed.data, travellerId, displayNameId, contactIds };

  return submitCommand<TravellerRecordedResult>({
    uow,
    commandType: 'TRAVELLER_RECORDED',
    destinationKind: 'TRAVELLER_IDENTITY_REGISTERED',
    context: params,
    payload,
    evidenceRefs: [parsed.data.displayName.evidenceId],
    body: async () => {
      const governance = new PgGovernanceRepository(params.workspaceId);
      const repository = new PgTravellerRepository(params.workspaceId);
      const registered = await governance.loadSubject(params.workspaceId, travellerId);
      if (registered) {
        return duplicateConflict(
          `traveller id ${travellerId} is already registered as ${registered.kind}`,
          [travellerRef(travellerId)],
        );
      }
      const root = await createNewRoot({ workspaceId: params.workspaceId, id: travellerId, kind: 'TRAVELLER' });
      await repository.create({
        traveller: {
          id: travellerId,
          workspaceId: params.workspaceId,
          revision: 1,
          displayNameRef: displayNameId,
          lifecycleStatus: 'ACTIVE',
        },
        displayName: { ...parsed.data.displayName, id: displayNameId },
        contacts: (parsed.data.contacts ?? []).map((contact, index) => ({
          ...contact,
          id: contactIds[index] as string,
        })),
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return {
        ok: true,
        value: {
          value: { travellerId, displayNameId, revision: 1 },
          advanced: [root],
        },
      };
    },
  });
}

const AddTravellerNamePayloadSchema = z.strictObject({
  travellerId: Uuid,
  name: NameEditionInput,
});

export interface AddTravellerNameParams extends PeopleCommandContext {
  travellerId: string;
  name: z.input<typeof NameEditionInput>;
  expectedRevision: number;
}

export interface TravellerNameAddedResult {
  travellerId: string;
  nameId: string;
  revision: number;
}

/**
 * Name history is separate from identity: a new edition never rewrites the
 * person, and `travellers.display_name_ref` only moves through an explicit
 * intent (which is not this command).
 */
export async function addTravellerName(
  uow: UnitOfWork,
  params: AddTravellerNameParams,
): Promise<ExecuteOutcome<TravellerNameAddedResult>> {
  const parsed = AddTravellerNamePayloadSchema.safeParse({ travellerId: params.travellerId, name: params.name });
  if (!parsed.success) {
    return {
      ok: false,
      conflict: typedConflict('VALIDATION_FAILED', `TRAVELLER_NAME_ADDED payload rejected: ${parsed.error.message}`),
    };
  }
  const nameId = parsed.data.name.id ?? randomUUID();
  const payload = { ...parsed.data, nameId };
  const expected = [{ aggregateRef: travellerRef(parsed.data.travellerId), expectedRevision: params.expectedRevision }];

  return submitCommand<TravellerNameAddedResult>({
    uow,
    commandType: 'TRAVELLER_NAME_ADDED',
    destinationKind: 'TRAVELLER_NAME_EDITION_APPENDED',
    context: params,
    payload,
    expectedAggregateRevisions: expected,
    evidenceRefs: [parsed.data.name.evidenceId],
    body: async ({ lockedHeads }) => {
      const repository = new PgTravellerRepository(params.workspaceId);
      const traveller = await repository.load(params.workspaceId, parsed.data.travellerId);
      if (!traveller) {
        return notOk(travellerMissing(params.workspaceId, parsed.data.travellerId));
      }
      const advanced = await advanceExistingRoot({
        workspaceId: params.workspaceId,
        aggregateRef: travellerRef(parsed.data.travellerId),
        lockedHeads,
      });
      if (!advanced.ok) return advanced;
      await repository.addName({
        travellerId: parsed.data.travellerId,
        name: { ...parsed.data.name, id: nameId },
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return {
        ok: true,
        value: {
          value: { travellerId: parsed.data.travellerId, nameId, revision: advanced.value.afterRevision },
          advanced: [advanced.value],
        },
      };
    },
  });
}

const AddTravellerContactPayloadSchema = z.strictObject({
  travellerId: Uuid,
  contact: ContactEditionInput,
});

export interface AddTravellerContactParams extends PeopleCommandContext {
  travellerId: string;
  contact: z.input<typeof ContactEditionInput>;
  expectedRevision: number;
}

export interface TravellerContactAddedResult {
  travellerId: string;
  contactId: string;
  revision: number;
}

/** Stores the `(content_hash, storage_ref, access_policy_id)` triple and a renderable mask — never a value. */
export async function addTravellerContact(
  uow: UnitOfWork,
  params: AddTravellerContactParams,
): Promise<ExecuteOutcome<TravellerContactAddedResult>> {
  const parsed = AddTravellerContactPayloadSchema.safeParse({ travellerId: params.travellerId, contact: params.contact });
  if (!parsed.success) {
    return {
      ok: false,
      conflict: typedConflict('VALIDATION_FAILED', `TRAVELLER_CONTACT_ADDED payload rejected: ${parsed.error.message}`),
    };
  }
  const contactId = parsed.data.contact.id ?? randomUUID();
  const payload = { ...parsed.data, contactId };
  const expected = [{ aggregateRef: travellerRef(parsed.data.travellerId), expectedRevision: params.expectedRevision }];

  return submitCommand<TravellerContactAddedResult>({
    uow,
    commandType: 'TRAVELLER_CONTACT_ADDED',
    destinationKind: 'TRAVELLER_CONTACT_PROTECTED_REFERENCE_APPENDED',
    context: params,
    payload,
    expectedAggregateRevisions: expected,
    evidenceRefs: [parsed.data.contact.evidenceId],
    body: async ({ lockedHeads }) => {
      const repository = new PgTravellerRepository(params.workspaceId);
      const traveller = await repository.load(params.workspaceId, parsed.data.travellerId);
      if (!traveller) return notOk(travellerMissing(params.workspaceId, parsed.data.travellerId));
      const advanced = await advanceExistingRoot({
        workspaceId: params.workspaceId,
        aggregateRef: travellerRef(parsed.data.travellerId),
        lockedHeads,
      });
      if (!advanced.ok) return advanced;
      await repository.addContact({
        travellerId: parsed.data.travellerId,
        contact: { ...parsed.data.contact, id: contactId },
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return {
        ok: true,
        value: {
          value: { travellerId: parsed.data.travellerId, contactId, revision: advanced.value.afterRevision },
          advanced: [advanced.value],
        },
      };
    },
  });
}

const AppendProfileAssertionPayloadSchema = z.strictObject({
  travellerId: Uuid,
  assertionId: Uuid.optional(),
  assertionType: AssertionTypeInput,
  effectiveRange: DateIntervalSchema,
  evidenceId: Uuid,
  value: z.record(z.string(), z.unknown()),
  supersedesAssertionId: Uuid.optional(),
});

export interface AppendProfileAssertionParams extends PeopleCommandContext {
  travellerId: string;
  assertionId?: string;
  assertionType: z.infer<typeof AssertionTypeInput>;
  effectiveRange: { start: string; end?: string };
  evidenceId: string;
  value: Record<string, unknown>;
  supersedesAssertionId?: string;
  expectedRevision: number;
}

export interface ProfileAssertionAppendedResult {
  travellerId: string;
  assertionId: string;
  revision: number;
}

/** "Correct an assertion" is a new immutable edition that cites the one it replaces (0013). */
export async function appendProfileAssertion(
  uow: UnitOfWork,
  params: AppendProfileAssertionParams,
): Promise<ExecuteOutcome<ProfileAssertionAppendedResult>> {
  const parsed = AppendProfileAssertionPayloadSchema.safeParse({
    travellerId: params.travellerId,
    assertionId: params.assertionId,
    assertionType: params.assertionType,
    effectiveRange: params.effectiveRange,
    evidenceId: params.evidenceId,
    value: params.value,
    supersedesAssertionId: params.supersedesAssertionId,
  });
  if (!parsed.success) {
    return {
      ok: false,
      conflict: typedConflict('VALIDATION_FAILED', `PROFILE_ASSERTION_APPENDED payload rejected: ${parsed.error.message}`),
    };
  }
  const assertionId = parsed.data.assertionId ?? randomUUID();
  const payload = { ...parsed.data, assertionId };
  const expected = [{ aggregateRef: travellerRef(parsed.data.travellerId), expectedRevision: params.expectedRevision }];

  return submitCommand<ProfileAssertionAppendedResult>({
    uow,
    commandType: 'PROFILE_ASSERTION_APPENDED',
    destinationKind: 'PROFILE_ASSERTION_EDITION_ACCEPTED',
    context: params,
    payload,
    expectedAggregateRevisions: expected,
    evidenceRefs: [parsed.data.evidenceId],
    body: async ({ lockedHeads }) => {
      const repository = new PgTravellerRepository(params.workspaceId);
      const traveller = await repository.load(params.workspaceId, parsed.data.travellerId);
      if (!traveller) return notOk(travellerMissing(params.workspaceId, parsed.data.travellerId));
      const advanced = await advanceExistingRoot({
        workspaceId: params.workspaceId,
        aggregateRef: travellerRef(parsed.data.travellerId),
        lockedHeads,
      });
      if (!advanced.ok) return advanced;
      await repository.appendProfileAssertion({
        assertion: {
          id: assertionId,
          travellerId: parsed.data.travellerId,
          assertionType: parsed.data.assertionType,
          effectiveRange: parsed.data.effectiveRange,
          evidenceId: parsed.data.evidenceId,
          value: parsed.data.value,
          supersedesAssertionId: parsed.data.supersedesAssertionId,
        },
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return {
        ok: true,
        value: {
          value: { travellerId: parsed.data.travellerId, assertionId, revision: advanced.value.afterRevision },
          advanced: [advanced.value],
        },
      };
    },
  });
}

const MergeTravellerPayloadSchema = z.strictObject({
  travellerId: Uuid,
  mergedIntoTravellerId: Uuid,
});

export interface MergeTravellerParams extends PeopleCommandContext {
  travellerId: string;
  mergedIntoTravellerId: string;
  expectedRevision: number;
}

export interface TravellerMergedResult {
  travellerId: string;
  mergedIntoTravellerId: string;
  revision: number;
}

/**
 * Deduplication is an explicit redirect, never an inferred merge: the losing
 * person keeps its identity row and records who survived.
 */
export async function mergeTraveller(
  uow: UnitOfWork,
  params: MergeTravellerParams,
): Promise<ExecuteOutcome<TravellerMergedResult>> {
  const parsed = MergeTravellerPayloadSchema.safeParse({
    travellerId: params.travellerId,
    mergedIntoTravellerId: params.mergedIntoTravellerId,
  });
  if (!parsed.success) {
    return {
      ok: false,
      conflict: typedConflict('VALIDATION_FAILED', `TRAVELLER_MERGED payload rejected: ${parsed.error.message}`),
    };
  }
  const { travellerId, mergedIntoTravellerId } = parsed.data;
  const payload = { ...parsed.data };
  const expected = [{ aggregateRef: travellerRef(travellerId), expectedRevision: params.expectedRevision }];

  return submitCommand<TravellerMergedResult>({
    uow,
    commandType: 'TRAVELLER_MERGED',
    destinationKind: 'TRAVELLER_IDENTITY_REDIRECTED',
    context: params,
    payload,
    expectedAggregateRevisions: expected,
    body: async ({ lockedHeads }) => {
      const repository = new PgTravellerRepository(params.workspaceId);
      if (travellerId === mergedIntoTravellerId) {
        return validationConflict(
          'a Traveller cannot be merged into itself',
          [travellerRef(travellerId)],
        );
      }
      const source = await repository.load(params.workspaceId, travellerId);
      if (!source) return notOk(travellerMissing(params.workspaceId, travellerId));
      if (source.lifecycleStatus !== 'ACTIVE') {
        return duplicateConflict(
          `traveller ${travellerId} is already ${source.lifecycleStatus}; only an ACTIVE identity may be redirected`,
          [travellerRef(travellerId)],
        );
      }
      const survivor = await repository.load(params.workspaceId, mergedIntoTravellerId);
      if (!survivor) return notOk(travellerMissing(params.workspaceId, mergedIntoTravellerId));
      if (survivor.lifecycleStatus !== 'ACTIVE') {
        return validationConflict(
          `merge target ${mergedIntoTravellerId} is ${survivor.lifecycleStatus}, not a surviving ACTIVE identity`,
          [travellerRef(mergedIntoTravellerId)],
        );
      }
      const advanced = await advanceExistingRoot({
        workspaceId: params.workspaceId,
        aggregateRef: travellerRef(travellerId),
        lockedHeads,
      });
      if (!advanced.ok) return advanced;
      const revision = await repository.merge({
        workspaceId: params.workspaceId,
        travellerId,
        mergedIntoTravellerId,
        expectedRevision: advanced.value.beforeRevision ?? 0,
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return {
        ok: true,
        value: {
          value: { travellerId, mergedIntoTravellerId, revision },
          advanced: [advanced.value],
        },
      };
    },
  });
}

const RecordTravelHistoryPayloadSchema = z.strictObject({
  travellerId: Uuid,
  historyId: Uuid.optional(),
  jurisdictionId: Uuid,
  entryDate: LocalDateSchema.optional(),
  exitDate: LocalDateSchema.optional(),
  coverageClaim: z.enum(['PARTIAL', 'WINDOW_COMPLETE']),
  uncertaintyNote: z.string().min(1).optional(),
  evidenceId: Uuid,
  recordedAt: InstantSchema.optional(),
});

export interface RecordTravelHistoryParams extends PeopleCommandContext {
  travellerId: string;
  historyId?: string;
  jurisdictionId: string;
  entryDate?: string;
  exitDate?: string;
  coverageClaim: 'PARTIAL' | 'WINDOW_COMPLETE';
  uncertaintyNote?: string;
  evidenceId: string;
  recordedAt?: string;
  expectedRevision: number;
}

export interface TravelHistoryRecordedResult {
  travellerId: string;
  historyId: string;
  coverageClaim: 'PARTIAL' | 'WINDOW_COMPLETE';
  revision: number;
}

/** Existence of a row never claims dataset completeness; the coverage claim is exactly what the source said. */
export async function recordTravelHistory(
  uow: UnitOfWork,
  params: RecordTravelHistoryParams,
): Promise<ExecuteOutcome<TravelHistoryRecordedResult>> {
  const parsed = RecordTravelHistoryPayloadSchema.safeParse({
    travellerId: params.travellerId,
    historyId: params.historyId,
    jurisdictionId: params.jurisdictionId,
    entryDate: params.entryDate,
    exitDate: params.exitDate,
    coverageClaim: params.coverageClaim,
    uncertaintyNote: params.uncertaintyNote,
    evidenceId: params.evidenceId,
    recordedAt: params.recordedAt,
  });
  if (!parsed.success) {
    return {
      ok: false,
      conflict: typedConflict('VALIDATION_FAILED', `TRAVEL_HISTORY_RECORDED payload rejected: ${parsed.error.message}`),
    };
  }
  const historyId = parsed.data.historyId ?? randomUUID();
  const recordedAt = parsed.data.recordedAt ?? new Date().toISOString();
  const payload = { ...parsed.data, historyId, recordedAt };
  const expected = [{ aggregateRef: travellerRef(parsed.data.travellerId), expectedRevision: params.expectedRevision }];

  return submitCommand<TravelHistoryRecordedResult>({
    uow,
    commandType: 'TRAVEL_HISTORY_RECORDED',
    destinationKind: 'TRAVEL_HISTORY_MOVEMENT_OBSERVED',
    context: params,
    payload,
    expectedAggregateRevisions: expected,
    evidenceRefs: [parsed.data.evidenceId],
    body: async ({ lockedHeads }) => {
      const repository = new PgTravellerRepository(params.workspaceId);
      const traveller = await repository.load(params.workspaceId, parsed.data.travellerId);
      if (!traveller) return notOk(travellerMissing(params.workspaceId, parsed.data.travellerId));
      const advanced = await advanceExistingRoot({
        workspaceId: params.workspaceId,
        aggregateRef: travellerRef(parsed.data.travellerId),
        lockedHeads,
      });
      if (!advanced.ok) return advanced;
      const history: TravelHistoryRecord = {
        id: historyId,
        travellerId: parsed.data.travellerId,
        jurisdictionId: parsed.data.jurisdictionId,
        entryDate: parsed.data.entryDate,
        exitDate: parsed.data.exitDate,
        coverageClaim: parsed.data.coverageClaim,
        uncertaintyNote: parsed.data.uncertaintyNote,
        evidenceId: parsed.data.evidenceId,
        recordedAt,
      };
      await repository.recordHistory({
        history,
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return {
        ok: true,
        value: {
          value: {
            travellerId: parsed.data.travellerId,
            historyId,
            coverageClaim: parsed.data.coverageClaim,
            revision: advanced.value.afterRevision,
          },
          advanced: [advanced.value],
        },
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Relationships (F05: never an authority grant)
// ---------------------------------------------------------------------------

const RecordRelationshipPayloadSchema = z.strictObject({
  relationshipId: Uuid.optional(),
  fromTravellerId: Uuid,
  toTravellerId: Uuid,
  relationshipType: RelationshipTypeInput,
  effectiveRange: DateIntervalSchema,
  evidenceId: Uuid,
});

export interface RecordTravellerRelationshipParams extends PeopleCommandContext {
  relationshipId?: string;
  fromTravellerId: string;
  toTravellerId: string;
  relationshipType: z.infer<typeof RelationshipTypeInput>;
  effectiveRange: { start: string; end?: string };
  evidenceId: string;
}

export interface TravellerRelationshipRecordedResult {
  relationshipId: string;
  revision: number;
}

/**
 * A relationship is its own registry root, so recording one does not advance
 * either Traveller's revision — and it writes nothing into `authority_grants`
 * or `grant_*`: a guardian duty is not a permission (F05).
 */
export async function recordTravellerRelationship(
  uow: UnitOfWork,
  params: RecordTravellerRelationshipParams,
): Promise<ExecuteOutcome<TravellerRelationshipRecordedResult>> {
  const parsed = RecordRelationshipPayloadSchema.safeParse({
    relationshipId: params.relationshipId,
    fromTravellerId: params.fromTravellerId,
    toTravellerId: params.toTravellerId,
    relationshipType: params.relationshipType,
    effectiveRange: params.effectiveRange,
    evidenceId: params.evidenceId,
  });
  if (!parsed.success) {
    return {
      ok: false,
      conflict: typedConflict(
        'VALIDATION_FAILED',
        `TRAVELLER_RELATIONSHIP_RECORDED payload rejected: ${parsed.error.message}`,
      ),
    };
  }
  const relationshipId = parsed.data.relationshipId ?? randomUUID();
  const payload = { ...parsed.data, relationshipId };

  return submitCommand<TravellerRelationshipRecordedResult>({
    uow,
    commandType: 'TRAVELLER_RELATIONSHIP_RECORDED',
    destinationKind: 'TRAVELLER_RELATIONSHIP_FACT_RECORDED',
    context: params,
    payload,
    evidenceRefs: [parsed.data.evidenceId],
    body: async () => {
      const governance = new PgGovernanceRepository(params.workspaceId);
      const repository = new PgTravellerRepository(params.workspaceId);
      if (parsed.data.fromTravellerId === parsed.data.toTravellerId) {
        return validationConflict('a relationship must join two distinct people', [
          travellerRef(parsed.data.fromTravellerId),
        ]);
      }
      for (const id of [parsed.data.fromTravellerId, parsed.data.toTravellerId]) {
        const traveller = await repository.load(params.workspaceId, id);
        if (!traveller) return notOk(travellerMissing(params.workspaceId, id));
      }
      const registered = await governance.loadSubject(params.workspaceId, relationshipId);
      if (registered) {
        return duplicateConflict(
          `relationship id ${relationshipId} is already registered as ${registered.kind}`,
          [{ kind: 'TRAVELLER_RELATIONSHIP', id: relationshipId }],
        );
      }
      const root = await createNewRoot({
        workspaceId: params.workspaceId,
        id: relationshipId,
        kind: 'TRAVELLER_RELATIONSHIP',
      });
      await repository.recordRelationship({
        relationship: {
          id: relationshipId,
          fromTravellerId: parsed.data.fromTravellerId,
          toTravellerId: parsed.data.toTravellerId,
          relationshipType: parsed.data.relationshipType,
          effectiveRange: parsed.data.effectiveRange,
          evidenceId: parsed.data.evidenceId,
        },
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return { ok: true, value: { value: { relationshipId, revision: 1 }, advanced: [root] } };
    },
  });
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

const PassportDetailInputSchema = z.strictObject({
  kind: z.literal('PASSPORT'),
  documentNumber: ProtectedDataRefSchema,
  nationalityCountry: z.string().length(2).optional(),
  machineReadable: z.boolean().optional(),
});

const VisaDetailInputSchema = z.strictObject({
  kind: z.literal('VISA'),
  documentNumber: ProtectedDataRefSchema,
  visaClass: z.string().min(1).optional(),
  permittedActivities: z.array(z.string().min(1)).optional(),
  restrictions: z.string().min(1).optional(),
  entriesAllowed: z.number().int().min(1).optional(),
  permittedStayDays: z.number().int().min(1).optional(),
});

const ResidenceDetailInputSchema = z.strictObject({
  kind: z.literal('RESIDENCE_PERMIT'),
  documentNumber: ProtectedDataRefSchema,
});

const HealthDetailInputSchema = z.strictObject({
  kind: z.literal('HEALTH_CREDENTIAL'),
  documentNumber: ProtectedDataRefSchema,
});

const CredentialDetailInputSchema = z.discriminatedUnion('kind', [
  PassportDetailInputSchema,
  VisaDetailInputSchema,
  ResidenceDetailInputSchema,
  HealthDetailInputSchema,
]);

const AppendCredentialVersionPayloadSchema = z.strictObject({
  travellerId: Uuid,
  credentialId: Uuid,
  versionId: Uuid.optional(),
  kind: CredentialKindInput,
  issuerCountry: z.string().length(2),
  issueDate: LocalDateSchema,
  expiryDate: LocalDateSchema.optional(),
  issuerStatus: z.enum(['VALID', 'REVOKED', 'SUSPENDED', 'UNKNOWN']),
  physicallyAvailable: z.boolean().optional(),
  evidenceId: Uuid,
  acceptedAt: InstantSchema.optional(),
  documentNumber: ProtectedDataRefSchema.optional(),
  detail: CredentialDetailInputSchema.optional(),
}).superRefine((data, ctx) => {
  const detail = data.detail;
  if (detail === undefined) return;
  if (detail.kind !== data.kind) {
    ctx.addIssue({
      code: 'custom',
      path: ['detail'],
      message:
        data.kind === 'E_AUTHORISATION'
          ? 'architecture gap G-P8: E_AUTHORISATION has no typed credential detail table in the frozen 0015 ' +
            `inventory, so a detail of kind '${detail.kind}' has nowhere to go`
          : `detail.kind '${detail.kind}' contradicts credential kind '${data.kind}': the composite FK from ` +
            'each 0015 typed detail table to credential_versions (workspace_id, id, kind) can never be satisfied',
    });
    return;
  }
  if (detail.kind !== 'PASSPORT') return;
  if (detail.nationalityCountry === undefined && detail.machineReadable === undefined) return;
  ctx.addIssue({
    code: 'custom',
    path: ['detail'],
    message:
      'passport_details records neither nationality nor machine-readable facts (architecture gap G-P5), ' +
      'so the value is rejected here rather than dropped during persistence',
  });
});

export interface AppendCredentialVersionParams extends PeopleCommandContext {
  travellerId: string;
  credentialId: string;
  versionId?: string;
  kind: z.infer<typeof CredentialKindInput>;
  issuerCountry: string;
  issueDate: string;
  expiryDate?: string;
  issuerStatus: 'VALID' | 'REVOKED' | 'SUSPENDED' | 'UNKNOWN';
  physicallyAvailable?: boolean;
  evidenceId: string;
  acceptedAt?: string;
  documentNumber?: z.infer<typeof ProtectedDataRefSchema>;
  detail?: z.infer<typeof CredentialDetailInputSchema>;
  expectedRevision: number;
}

export interface CredentialVersionAppendedResult {
  travellerId: string;
  credentialId: string;
  versionId: string;
  editionNumber: number;
  revision: number;
}

/**
 * The first accepted edition creates the Traveller-owned document; a later one
 * only re-points `current_version_id`, because an accepted edition never mutates
 * the edition it supersedes (0014's `forbid_mutation` trigger). The edition number
 * is derived in SQL, never supplied.
 */
export async function appendCredentialVersion(
  uow: UnitOfWork,
  params: AppendCredentialVersionParams,
): Promise<ExecuteOutcome<CredentialVersionAppendedResult>> {
  const parsed = AppendCredentialVersionPayloadSchema.safeParse({
    travellerId: params.travellerId,
    credentialId: params.credentialId,
    versionId: params.versionId,
    kind: params.kind,
    issuerCountry: params.issuerCountry,
    issueDate: params.issueDate,
    expiryDate: params.expiryDate,
    issuerStatus: params.issuerStatus,
    physicallyAvailable: params.physicallyAvailable,
    evidenceId: params.evidenceId,
    acceptedAt: params.acceptedAt,
    documentNumber: params.documentNumber,
    detail: params.detail,
  });
  if (!parsed.success) {
    return {
      ok: false,
      conflict: typedConflict(
        'VALIDATION_FAILED',
        `CREDENTIAL_VERSION_APPENDED payload rejected: ${parsed.error.message}`,
      ),
    };
  }
  const versionId = parsed.data.versionId ?? randomUUID();
  const acceptedAt = parsed.data.acceptedAt ?? new Date().toISOString();
  const payload = { ...parsed.data, versionId, acceptedAt };
  const expected = [{ aggregateRef: travellerRef(parsed.data.travellerId), expectedRevision: params.expectedRevision }];

  return submitCommand<CredentialVersionAppendedResult>({
    uow,
    commandType: 'CREDENTIAL_VERSION_APPENDED',
    destinationKind: 'CREDENTIAL_EDITION_ACCEPTED',
    context: params,
    payload,
    expectedAggregateRevisions: expected,
    evidenceRefs: [parsed.data.evidenceId],
    body: async ({ lockedHeads }) => {
      const repository = new PgTravellerRepository(params.workspaceId);
      const traveller = await repository.load(params.workspaceId, parsed.data.travellerId);
      if (!traveller) return notOk(travellerMissing(params.workspaceId, parsed.data.travellerId));
      const existing = await repository.loadCredential(params.workspaceId, parsed.data.credentialId);
      if (existing && existing.travellerId !== parsed.data.travellerId) {
        return validationConflict(
          `credential ${parsed.data.credentialId} belongs to traveller ${existing.travellerId}, not ${parsed.data.travellerId}`,
          [travellerRef(existing.travellerId)],
        );
      }
      const advanced = await advanceExistingRoot({
        workspaceId: params.workspaceId,
        aggregateRef: travellerRef(parsed.data.travellerId),
        lockedHeads,
      });
      if (!advanced.ok) return advanced;

      const editionNumber = existing
        ? (await repository.listCredentialVersions(params.workspaceId, parsed.data.credentialId)).length + 1
        : 1;
      await repository.recordCredential({
        credential: {
          id: parsed.data.credentialId,
          travellerId: parsed.data.travellerId,
          kind: parsed.data.kind,
          issuerCountry: parsed.data.issuerCountry,
          currentVersionId: versionId,
        },
        version: {
          id: versionId,
          credentialId: parsed.data.credentialId,
          issueDate: parsed.data.issueDate,
          expiryDate: parsed.data.expiryDate,
          issuerStatus: parsed.data.issuerStatus,
          physicallyAvailable: parsed.data.physicallyAvailable,
          evidenceId: parsed.data.evidenceId,
          acceptedAt,
        },
        documentNumber: parsed.data.documentNumber,
        detail: parsed.data.detail,
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return {
        ok: true,
        value: {
          value: {
            travellerId: parsed.data.travellerId,
            credentialId: parsed.data.credentialId,
            versionId,
            editionNumber,
            revision: advanced.value.afterRevision,
          },
          advanced: [advanced.value],
        },
      };
    },
  });
}

const LinkCredentialsPayloadSchema = z.strictObject({
  travellerId: Uuid,
  credentialId: Uuid,
  relatedCredentialId: Uuid,
  linkType: LinkTypeInput,
  evidenceId: Uuid,
  effectiveRange: DateIntervalSchema,
});

export interface LinkCredentialsParams extends PeopleCommandContext {
  travellerId: string;
  credentialId: string;
  relatedCredentialId: string;
  linkType: z.infer<typeof LinkTypeInput>;
  evidenceId: string;
  effectiveRange: { start: string; end?: string };
  expectedRevision: number;
}

export interface CredentialsLinkedResult {
  travellerId: string;
  credentialId: string;
  relatedCredentialId: string;
  revision: number;
}

/** Both documents must belong to this same Traveller; 0016's deferred assertion is the authority. */
export async function linkCredentials(
  uow: UnitOfWork,
  params: LinkCredentialsParams,
): Promise<ExecuteOutcome<CredentialsLinkedResult>> {
  const parsed = LinkCredentialsPayloadSchema.safeParse({
    travellerId: params.travellerId,
    credentialId: params.credentialId,
    relatedCredentialId: params.relatedCredentialId,
    linkType: params.linkType,
    evidenceId: params.evidenceId,
    effectiveRange: params.effectiveRange,
  });
  if (!parsed.success) {
    return {
      ok: false,
      conflict: typedConflict('VALIDATION_FAILED', `CREDENTIALS_LINKED payload rejected: ${parsed.error.message}`),
    };
  }
  const payload = { ...parsed.data };
  const expected = [{ aggregateRef: travellerRef(parsed.data.travellerId), expectedRevision: params.expectedRevision }];

  return submitCommand<CredentialsLinkedResult>({
    uow,
    commandType: 'CREDENTIALS_LINKED',
    destinationKind: 'CREDENTIAL_DOCUMENT_LINK_RECORDED',
    context: params,
    payload,
    expectedAggregateRevisions: expected,
    evidenceRefs: [parsed.data.evidenceId],
    body: async ({ lockedHeads }) => {
      const repository = new PgTravellerRepository(params.workspaceId);
      const traveller = await repository.load(params.workspaceId, parsed.data.travellerId);
      if (!traveller) return notOk(travellerMissing(params.workspaceId, parsed.data.travellerId));
      if (parsed.data.credentialId === parsed.data.relatedCredentialId) {
        return validationConflict('a credential cannot be linked to itself', [
          { kind: 'TRAVELLER', id: parsed.data.travellerId },
        ]);
      }
      const advanced = await advanceExistingRoot({
        workspaceId: params.workspaceId,
        aggregateRef: travellerRef(parsed.data.travellerId),
        lockedHeads,
      });
      if (!advanced.ok) return advanced;
      await repository.linkCredentials({
        link: {
          travellerId: parsed.data.travellerId,
          credentialId: parsed.data.credentialId,
          relatedCredentialId: parsed.data.relatedCredentialId,
          linkType: parsed.data.linkType,
          evidenceId: parsed.data.evidenceId,
          effectiveRange: parsed.data.effectiveRange,
        },
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return {
        ok: true,
        value: {
          value: {
            travellerId: parsed.data.travellerId,
            credentialId: parsed.data.credentialId,
            relatedCredentialId: parsed.data.relatedCredentialId,
            revision: advanced.value.afterRevision,
          },
          advanced: [advanced.value],
        },
      };
    },
  });
}

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

const CreateOrganisationPayloadSchema = z.strictObject({
  organisationId: Uuid.optional(),
  legalName: z.string().min(1),
  displayName: z.string().min(1).optional(),
  /** NOT NULL in 0011; a currency is a business fact, so the caller must state it. */
  defaultCurrencyCode: z.string().length(3),
  lifecycleStatus: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional(),
});

export interface CreateOrganisationParams extends PeopleCommandContext {
  organisationId?: string;
  legalName: string;
  displayName?: string;
  defaultCurrencyCode: string;
  lifecycleStatus?: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

export interface OrganisationCreatedResult {
  organisationId: string;
  revision: number;
}

export async function createOrganisation(
  uow: UnitOfWork,
  params: CreateOrganisationParams,
): Promise<ExecuteOutcome<OrganisationCreatedResult>> {
  const parsed = CreateOrganisationPayloadSchema.safeParse({
    organisationId: params.organisationId,
    legalName: params.legalName,
    displayName: params.displayName,
    defaultCurrencyCode: params.defaultCurrencyCode,
    lifecycleStatus: params.lifecycleStatus,
  });
  if (!parsed.success) {
    return {
      ok: false,
      conflict: typedConflict('VALIDATION_FAILED', `ORGANISATION_CREATED payload rejected: ${parsed.error.message}`),
    };
  }
  const organisationId = parsed.data.organisationId ?? randomUUID();
  const payload = { ...parsed.data, organisationId };

  return submitCommand<OrganisationCreatedResult>({
    uow,
    commandType: 'ORGANISATION_CREATED',
    destinationKind: 'ORGANISATION_PARTY_REGISTERED',
    context: params,
    payload,
    body: async () => {
      const governance = new PgGovernanceRepository(params.workspaceId);
      const registered = await governance.loadSubject(params.workspaceId, organisationId);
      if (registered) {
        return duplicateConflict(
          `organisation id ${organisationId} is already registered as ${registered.kind}`,
          [{ kind: 'ORGANISATION', id: organisationId }],
        );
      }
      const root = await createNewRoot({
        workspaceId: params.workspaceId,
        id: organisationId,
        kind: 'ORGANISATION',
      });
      await governance.createOrganisation({
        organisation: {
          id: organisationId,
          legalName: parsed.data.legalName,
          displayName: parsed.data.displayName,
          defaultCurrencyCode: parsed.data.defaultCurrencyCode,
          lifecycleStatus: parsed.data.lifecycleStatus ?? 'ACTIVE',
        },
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return { ok: true, value: { value: { organisationId, revision: 1 }, advanced: [root] } };
    },
  });
}

const CreatePrincipalPayloadSchema = z.strictObject({
  principalId: Uuid.optional(),
  displayName: z.string().min(1),
  actorType: z.enum(['HUMAN', 'SERVICE', 'SYSTEM']),
  /** NOT NULL and part of the unique auth identity in 0011. */
  authIssuer: z.string().min(1),
  authSubject: z.string().min(1),
});

export interface CreatePrincipalParams extends PeopleCommandContext {
  principalId?: string;
  displayName: string;
  actorType: 'HUMAN' | 'SERVICE' | 'SYSTEM';
  authIssuer: string;
  authSubject: string;
}

export interface PrincipalCreatedResult {
  principalId: string;
  revision: number;
}

export async function createPrincipal(
  uow: UnitOfWork,
  params: CreatePrincipalParams,
): Promise<ExecuteOutcome<PrincipalCreatedResult>> {
  const parsed = CreatePrincipalPayloadSchema.safeParse({
    principalId: params.principalId,
    displayName: params.displayName,
    actorType: params.actorType,
    authIssuer: params.authIssuer,
    authSubject: params.authSubject,
  });
  if (!parsed.success) {
    return {
      ok: false,
      conflict: typedConflict('VALIDATION_FAILED', `PRINCIPAL_CREATED payload rejected: ${parsed.error.message}`),
    };
  }
  const principalId = parsed.data.principalId ?? randomUUID();
  const payload = { ...parsed.data, principalId };

  return submitCommand<PrincipalCreatedResult>({
    uow,
    commandType: 'PRINCIPAL_CREATED',
    destinationKind: 'PRINCIPAL_IDENTITY_REGISTERED',
    context: params,
    payload,
    body: async () => {
      const governance = new PgGovernanceRepository(params.workspaceId);
      const registered = await governance.loadSubject(params.workspaceId, principalId);
      if (registered) {
        return duplicateConflict(
          `principal id ${principalId} is already registered as ${registered.kind}`,
          [{ kind: 'PRINCIPAL', id: principalId }],
        );
      }
      const root = await createNewRoot({ workspaceId: params.workspaceId, id: principalId, kind: 'PRINCIPAL' });
      await governance.createPrincipal({
        principal: {
          id: principalId,
          displayName: parsed.data.displayName,
          actorType: parsed.data.actorType,
          authIssuer: parsed.data.authIssuer,
          authSubject: parsed.data.authSubject,
        },
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return { ok: true, value: { value: { principalId, revision: 1 }, advanced: [root] } };
    },
  });
}

const AssignResponsibilityPayloadSchema = z.strictObject({
  assignmentId: Uuid.optional(),
  organisationId: Uuid,
  subjectRef: RegistryTypedRefSchema,
  role: ResponsibilityRoleInput,
  effectiveRange: DateIntervalSchema,
});

export interface AssignResponsibilityParams extends PeopleCommandContext {
  assignmentId?: string;
  organisationId: string;
  subjectRef: TypedRef;
  role: z.infer<typeof ResponsibilityRoleInput>;
  effectiveRange: { start: string; end?: string };
}

export interface ResponsibilityAssignedResult {
  assignmentId: string;
  subjectRef: TypedRef;
  role: z.infer<typeof ResponsibilityRoleInput>;
  revision: number;
}

/**
 * Responsibility is accountability for a subject, borne by an Organisation
 * party. It writes no grant of any kind: 0018's deferred assertions still prove
 * the referenced subject exists with that exact kind and that the role accepts
 * that kind.
 */
export async function assignResponsibility(
  uow: UnitOfWork,
  params: AssignResponsibilityParams,
): Promise<ExecuteOutcome<ResponsibilityAssignedResult>> {
  const parsed = AssignResponsibilityPayloadSchema.safeParse({
    assignmentId: params.assignmentId,
    organisationId: params.organisationId,
    subjectRef: params.subjectRef,
    role: params.role,
    effectiveRange: params.effectiveRange,
  });
  if (!parsed.success) {
    return {
      ok: false,
      conflict: typedConflict('VALIDATION_FAILED', `RESPONSIBILITY_ASSIGNED payload rejected: ${parsed.error.message}`),
    };
  }
  const assignmentId = parsed.data.assignmentId ?? randomUUID();
  const payload = { ...parsed.data, assignmentId };
  const assignmentRef: TypedRef = { kind: 'RESPONSIBILITY_ASSIGNMENT', id: assignmentId };

  return submitCommand<ResponsibilityAssignedResult>({
    uow,
    commandType: 'RESPONSIBILITY_ASSIGNED',
    destinationKind: 'RESPONSIBILITY_ASSIGNMENT_RECORDED',
    context: params,
    payload,
    body: async () => {
      const governance = new PgGovernanceRepository(params.workspaceId);
      const organisation = await governance.loadOrganisation(params.workspaceId, parsed.data.organisationId);
      if (!organisation) {
        return validationConflict(
          `no organisations row ${parsed.data.organisationId} in workspace ${params.workspaceId}`,
          [{ kind: 'ORGANISATION', id: parsed.data.organisationId }],
        );
      }
      const subject = await governance.loadSubject(params.workspaceId, parsed.data.subjectRef.id);
      if (!subject || subject.kind !== parsed.data.subjectRef.kind) {
        return validationConflict(
          `responsibility subject ${parsed.data.subjectRef.id} is ${subject ? subject.kind : 'absent'}, not ${parsed.data.subjectRef.kind}`,
          [parsed.data.subjectRef],
        );
      }
      const registered = await governance.loadSubject(params.workspaceId, assignmentId);
      if (registered) return duplicateConflict(`assignment id ${assignmentId} is already ${registered.kind}`, [assignmentRef]);
      const root = await createNewRoot({ workspaceId: params.workspaceId, id: assignmentId, kind: 'RESPONSIBILITY_ASSIGNMENT' });
      await governance.assignResponsibility({
        assignment: {
          id: assignmentId,
          organisationId: parsed.data.organisationId,
          subjectRef: parsed.data.subjectRef,
          role: parsed.data.role,
          effectiveRange: parsed.data.effectiveRange,
        },
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return {
        ok: true,
        value: {
          value: {
            assignmentId,
            subjectRef: parsed.data.subjectRef,
            role: parsed.data.role,
            revision: 1,
          },
          advanced: [root],
        },
      };
    },
  });
}

const IssueAuthorityGrantPayloadSchema = z.strictObject({
  grantId: Uuid.optional(),
  principalId: Uuid,
  representedPartyRef: RegistryTypedRefSchema,
  issuedByPrincipalId: Uuid,
  evidenceId: Uuid.optional(),
  issuedAt: InstantSchema.optional(),
  expiresAt: InstantSchema.optional(),
  actions: z.array(z.string().min(1)).min(1),
  scopes: z.array(RegistryTypedRefSchema).min(1),
  limits: z.record(z.string(), z.unknown()).optional(),
  /** The receipt of the command that authorised this grant (GAP(G-P16): no column stores it). */
  authorisingReceipt: z.strictObject({ commandNamespace: z.string().min(1), idempotencyKey: z.string().min(1) }),
});

export interface IssueAuthorityGrantParams extends PeopleCommandContext {
  grantId?: string;
  principalId: string;
  representedPartyRef: TypedRef;
  issuedByPrincipalId: string;
  evidenceId?: string;
  issuedAt?: string;
  expiresAt?: string;
  actions: string[];
  scopes: TypedRef[];
  limits?: Record<string, unknown>;
  authorisingReceipt: { commandNamespace: string; idempotencyKey: string };
  /** Caller's own revision expectations, e.g. the principal and represented-party revisions it computed against. */
  expectedAggregateRevisions: ExpectedRevision[];
}

export interface AuthorityGrantIssuedResult {
  grantId: string;
  actions: string[];
  scopes: TypedRef[];
  authorisingReceipt: { commandNamespace: string; idempotencyKey: string };
  revision: number;
}

/**
 * Authority exists only because a grant says so. The grant is its own root, so
 * issuing one does not advance the principal's or the represented party's
 * revision; a caller that computed against those revisions cites them as
 * expectations and a stale one conflicts before anything is written.
 */
export async function issueAuthorityGrant(
  uow: UnitOfWork,
  params: IssueAuthorityGrantParams,
): Promise<ExecuteOutcome<AuthorityGrantIssuedResult>> {
  const parsed = IssueAuthorityGrantPayloadSchema.safeParse({
    grantId: params.grantId,
    principalId: params.principalId,
    representedPartyRef: params.representedPartyRef,
    issuedByPrincipalId: params.issuedByPrincipalId,
    evidenceId: params.evidenceId,
    issuedAt: params.issuedAt,
    expiresAt: params.expiresAt,
    actions: params.actions,
    scopes: params.scopes,
    limits: params.limits,
    authorisingReceipt: params.authorisingReceipt,
  });
  if (!parsed.success) {
    return {
      ok: false,
      conflict: typedConflict('VALIDATION_FAILED', `AUTHORITY_GRANT_ISSUED payload rejected: ${parsed.error.message}`),
    };
  }
  const grantId = parsed.data.grantId ?? randomUUID();
  const issuedAt = parsed.data.issuedAt ?? new Date().toISOString();
  const payload = { ...parsed.data, grantId, issuedAt };
  const grantRef: TypedRef = { kind: 'AUTHORITY_GRANT', id: grantId };

  return submitCommand<AuthorityGrantIssuedResult>({
    uow,
    commandType: 'AUTHORITY_GRANT_ISSUED',
    destinationKind: 'AUTHORITY_GRANT_EFFECTIVE',
    context: params,
    payload,
    expectedAggregateRevisions: params.expectedAggregateRevisions,
    representedPartyId: parsed.data.representedPartyRef.id,
    ...(parsed.data.evidenceId === undefined ? {} : { evidenceRefs: [parsed.data.evidenceId] }),
    body: async () => {
      const governance = new PgGovernanceRepository(params.workspaceId);
      if (parsed.data.expiresAt !== undefined && Date.parse(parsed.data.expiresAt) <= Date.parse(issuedAt)) {
        return validationConflict('an authority grant must expire strictly after it was issued', [grantRef]);
      }
      for (const principalId of [parsed.data.principalId, parsed.data.issuedByPrincipalId]) {
        const principal = await governance.loadPrincipal(params.workspaceId, principalId);
        if (!principal) {
          return validationConflict(`no principals row ${principalId} in this workspace`, [
            { kind: 'PRINCIPAL', id: principalId },
          ]);
        }
      }
      const registered = await governance.loadSubject(params.workspaceId, grantId);
      if (registered) {
        return duplicateConflict(`grant id ${grantId} is already registered as ${registered.kind}`, [grantRef]);
      }
      const root = await createNewRoot({ workspaceId: params.workspaceId, id: grantId, kind: 'AUTHORITY_GRANT' });
      await governance.issueAuthorityGrant({
        grant: {
          id: grantId,
          principalId: parsed.data.principalId,
          representedPartyRef: parsed.data.representedPartyRef,
          issuedByPrincipalId: parsed.data.issuedByPrincipalId,
          evidenceId: parsed.data.evidenceId,
          issuedAt,
          expiresAt: parsed.data.expiresAt,
          actions: parsed.data.actions,
          scopes: parsed.data.scopes,
          limits: parsed.data.limits,
        },
        receipt: parsed.data.authorisingReceipt,
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return {
        ok: true,
        value: {
          value: {
            grantId,
            actions: parsed.data.actions,
            scopes: parsed.data.scopes,
            authorisingReceipt: parsed.data.authorisingReceipt,
            revision: 1,
          },
          advanced: [root],
        },
      };
    },
  });
}

const RevokeAuthorityGrantPayloadSchema = z.strictObject({
  grantId: Uuid,
  revokedAt: InstantSchema.optional(),
});

export interface RevokeAuthorityGrantParams extends PeopleCommandContext {
  grantId: string;
  revokedAt?: string;
  expectedRevision: number;
}

export interface AuthorityGrantRevokedResult {
  grantId: string;
  revokedAt: string;
  revision: number;
}

/** A revocation is a lifecycle transition on the grant root, so it is a compare-and-set like any other write. */
export async function revokeAuthorityGrant(
  uow: UnitOfWork,
  params: RevokeAuthorityGrantParams,
): Promise<ExecuteOutcome<AuthorityGrantRevokedResult>> {
  const parsed = RevokeAuthorityGrantPayloadSchema.safeParse({ grantId: params.grantId, revokedAt: params.revokedAt });
  if (!parsed.success) {
    return {
      ok: false,
      conflict: typedConflict('VALIDATION_FAILED', `AUTHORITY_GRANT_REVOKED payload rejected: ${parsed.error.message}`),
    };
  }
  const revokedAt = parsed.data.revokedAt ?? new Date().toISOString();
  const payload = { ...parsed.data, revokedAt };
  const grantRef: TypedRef = { kind: 'AUTHORITY_GRANT', id: parsed.data.grantId };
  const expected = [{ aggregateRef: grantRef, expectedRevision: params.expectedRevision }];

  return submitCommand<AuthorityGrantRevokedResult>({
    uow,
    commandType: 'AUTHORITY_GRANT_REVOKED',
    destinationKind: 'AUTHORITY_GRANT_WITHDRAWN',
    context: params,
    payload,
    expectedAggregateRevisions: expected,
    body: async ({ lockedHeads }) => {
      const governance = new PgGovernanceRepository(params.workspaceId);
      const grant = await governance.loadGrant(params.workspaceId, parsed.data.grantId);
      if (!grant) {
        return validationConflict(
          `no authority_grants row ${parsed.data.grantId} in workspace ${params.workspaceId}`,
          [grantRef],
        );
      }
      if (grant.revokedAt !== undefined) {
        return validationConflict(
          `authority grant ${parsed.data.grantId} was already revoked at ${grant.revokedAt}`,
          [grantRef],
        );
      }
      if (compareInstants(revokedAt, grant.issuedAt) < 0) {
        // 0019's `authority_grants_revocation_after_issue` CHECK would abort the
        // whole transaction with a raw 23514 for the same fact.
        return validationConflict(
          `revocation instant ${revokedAt} precedes grant ${parsed.data.grantId} issued_at ${grant.issuedAt}`,
          [grantRef],
        );
      }
      const advanced = await advanceExistingRoot({
        workspaceId: params.workspaceId,
        aggregateRef: grantRef,
        lockedHeads,
      });
      if (!advanced.ok) return advanced;
      await governance.revokeAuthorityGrant({
        workspaceId: params.workspaceId,
        grantId: parsed.data.grantId,
        revokedAt,
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return {
        ok: true,
        value: {
          value: { grantId: parsed.data.grantId, revokedAt, revision: advanced.value.afterRevision },
          advanced: [advanced.value],
        },
      };
    },
  });
}

/** Shared precondition conflict: a Traveller identity that this workspace does not have. */
function travellerMissing(workspaceId: string, travellerId: string): TypedConflict {
  return typedConflict(
    'VALIDATION_FAILED',
    `no travellers row ${travellerId} in workspace ${workspaceId}`,
    [travellerRef(travellerId)],
  );
}
