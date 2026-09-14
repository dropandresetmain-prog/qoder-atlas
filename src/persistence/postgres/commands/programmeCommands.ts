/**
 * NORTHSTAR v2 — Event / Programme / ProgrammeItem / Participation /
 * ResourceAssignment command handlers over `PgUnitOfWork` (M4 lane).
 *
 * Follows the one accepted handler precedent M2's `travelCommands.ts`
 * established: a params object in, an `ExecuteOutcome<Result>` out, the
 * `DomainCommandEnvelope` built inside the handler from a canonical hash of
 * the validated payload, and a callback returning either
 * `{ ok: true, value, receipt }` or `{ ok: false, conflict }`.
 *
 * Division of labour (mirrors M2): `PgEventRepository` / `PgProgrammeRepository`
 * / `PgResourceAssignmentRepository` do typed-row SQL only; this file owns the
 * transaction's shape (`createRoot`/`registerChildSubject`, compare-and-set
 * `advanceHead`, `appendAuditTrail`, `buildReceipt`).
 *
 * Aggregate ownership (M4 brief §C/§D, DATA_STRUCTURE_LOGICAL_SCHEMA.md §5):
 *  - EVENT is its own root; PROGRAMME is its own root;
 *  - PROGRAMME_ITEM and PARTICIPATION are children registered under their
 *    owning Programme's aggregate — exactly like JOURNEY_ITEM under JOURNEY —
 *    so a schedule/place move, cancellation, reinstatement, or participation
 *    change advances exactly ONE revision counter: the Programme's. This is
 *    the concrete mechanism behind "a programme move must become one
 *    canonical state change" (M4 brief).
 *
 * Retry safety (C1 amendment c, reused from M2): `execute` may run the
 * callback more than once, so every UUID and derived value is produced
 * *before* the callback and nothing non-deterministic happens inside it.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainCommandEnvelopeSchema, type DomainCommandEnvelope } from '../../../contracts/v2/command/domainCommand.ts';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import type { ActorContext } from '../../../contracts/v2/repository/people.ts';
import type { OptionalWindow } from '../../../contracts/v2/repository/travel.ts';
import { SubjectIdSchema, type ExpectedRevision, type RootRevision, type TypedRef } from '../../../domain/v2/shared/identity.ts';
import { typedConflict, type TypedConflict } from '../../../domain/v2/shared/errors.ts';
import { InstantIntervalSchema } from '../../../domain/v2/shared/time.ts';
import {
  EventSchema,
  ProgrammeSchema,
  ProgrammeItemSchema,
  ParticipationSchema,
  ResourceAssignmentSchema,
  ProgrammeItemLifecycleSchema,
  type Event,
  type Programme,
  type ProgrammeItem,
  type ProgrammeItemLifecycle,
  type Participation,
  type ResourceAssignment,
} from '../../../domain/v2/programmes/programme.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import {
  advanceHead,
  appendAuditTrail,
  buildReceipt,
  createRoot,
  registerChildSubject,
  lockedRevisionOf,
  missingHeadConflict,
  staleRevisionConflict,
  type AdvancedRoot,
} from '../commandSupport.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';
import { PgEventRepository, PgProgrammeRepository } from '../repositories/pgProgrammeRepository.ts';
import { PgResourceAssignmentRepository } from '../repositories/pgResourceAssignmentRepository.ts';
import { currentTransactionClient } from '../transactionContext.ts';

const SCHEMA_VERSION = '1';
const WindowSchema = InstantIntervalSchema;

export interface CommandIdentity {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
}

function refOf(kind: TypedRef['kind'], id: string): TypedRef {
  return { kind, id };
}

function buildEnvelope(params: {
  commandType: string;
  identity: CommandIdentity;
  payload: unknown;
  expectedAggregateRevisions?: ExpectedRevision[];
  evidenceRefs?: string[];
}): DomainCommandEnvelope {
  return DomainCommandEnvelopeSchema.parse({
    commandType: params.commandType,
    schemaVersion: SCHEMA_VERSION,
    workspaceId: params.identity.workspaceId,
    actorPrincipalId: params.identity.actorPrincipalId,
    idempotencyKey: params.identity.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(params.payload),
    expectedAggregateRevisions: params.expectedAggregateRevisions ?? [],
    typedPayload: params.payload,
    evidenceRefs: params.evidenceRefs ?? [],
  });
}

/** Same database-error mapping M2's travelCommands.ts uses, reused verbatim (frozen error vocabulary, docs/refactor/CONTRACTS.md). */
function databaseConflict(error: unknown, subjectRefs: TypedRef[]): TypedConflict {
  const code = (error as { code?: unknown }).code;
  const constraint = (error as { constraint?: unknown }).constraint;
  const message = error instanceof Error ? error.message : String(error);
  const where = typeof constraint === 'string' && constraint.length > 0 ? ` [constraint: ${constraint}]` : '';
  if (code === '23505') return typedConflict('DUPLICATE_REGISTRATION', `${message}${where}`, subjectRefs);
  if (code === '23503' || code === '23514' || code === '23502' || code === '23501' || code === 'P0001') {
    return typedConflict('VALIDATION_FAILED', `${message}${where}`, subjectRefs);
  }
  throw error;
}

async function guarded<T>(refs: TypedRef[], body: () => Promise<ExecuteOutcome<T>>): Promise<ExecuteOutcome<T>> {
  try {
    return await body();
  } catch (error) {
    return { ok: false, conflict: databaseConflict(error, refs) };
  }
}

function rejectedPayload(commandType: string, error: z.ZodError): ExecuteOutcome<never> {
  return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `${commandType} payload rejected: ${error.message}`) };
}

function refusedSubjectRefs(commandType: string, refs: TypedRef[]): ExecuteOutcome<never> | undefined {
  const malformed = refs.filter((ref) => !SubjectIdSchema.safeParse(ref.id).success);
  if (malformed.length === 0) return undefined;
  return {
    ok: false,
    conflict: typedConflict(
      'VALIDATION_FAILED',
      `${commandType} payload rejected: ${malformed.map((r) => `${r.kind}:${JSON.stringify(r.id)}`).join(', ')} ${
        malformed.length === 1 ? 'is' : 'are'
      } not a valid subject id`,
      malformed,
    ),
  };
}

type HeadGate = { ok: true; revision: number } | { ok: false; conflict: TypedConflict };

function headOrConflict(lockedHeads: RootRevision[], ref: TypedRef): HeadGate {
  const revision = lockedRevisionOf(lockedHeads, ref.id);
  return revision === undefined ? { ok: false, conflict: missingHeadConflict(ref) } : { ok: true, revision };
}

async function advanceOrConflict(ref: TypedRef, workspaceId: string, fromRevision: number): Promise<HeadGate> {
  const next = await advanceHead({ workspaceId, aggregateId: ref.id, fromRevision });
  return next === undefined ? { ok: false, conflict: staleRevisionConflict(ref, fromRevision) } : { ok: true, revision: next };
}

function transitionConflict<S extends string>(
  table: Record<S, readonly S[]>,
  from: S,
  to: S,
  label: string,
  refs: TypedRef[],
): TypedConflict | undefined {
  if (from === to || table[from].includes(to)) return undefined;
  const allowed = table[from];
  return typedConflict(
    'VALIDATION_FAILED',
    `${label} cannot move from ${from} to ${to}${allowed.length > 0 ? `; allowed: ${allowed.join(', ')}` : `; ${from} is terminal`}`,
    refs,
  );
}

const LIFECYCLE_TRANSITIONS: Record<'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED', readonly ('DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED')[]> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * §5 "cancellation is canonical, reinstatement explicit": CANCELLED is not
 * terminal here (unlike Trip/Journey/Event/Programme lifecycle above) — a
 * caller must submit a distinct, explicit command to leave it, and the DB's
 * `programme_items_scheduled_requires_window` CHECK still blocks landing on
 * SCHEDULED without a live window.
 */
const PROGRAMME_ITEM_TRANSITIONS: Record<ProgrammeItemLifecycle, readonly ProgrammeItemLifecycle[]> = {
  DRAFT: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: ['DRAFT', 'SCHEDULED'],
};

// --- Event commands -----------------------------------------------------------

const CreateEventPayloadSchema = z.strictObject({
  title: z.string().min(1),
  organiserOrganisationId: SubjectIdSchema.optional(),
  lifecycleStatus: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED']).default('DRAFT'),
});

export interface CreateEventParams extends CommandIdentity {
  title: string;
  organiserOrganisationId?: string;
  lifecycleStatus?: Event['lifecycleStatus'];
  eventId?: string;
  evidenceRefs?: string[];
}

export interface EventCommandValue {
  eventId: string;
  revision: number;
  lifecycleStatus: Event['lifecycleStatus'];
}

export async function createEvent(uow: UnitOfWork, params: CreateEventParams): Promise<ExecuteOutcome<EventCommandValue>> {
  const parsed = CreateEventPayloadSchema.safeParse({
    title: params.title,
    ...(params.organiserOrganisationId ? { organiserOrganisationId: params.organiserOrganisationId } : {}),
    ...(params.lifecycleStatus ? { lifecycleStatus: params.lifecycleStatus } : {}),
  });
  if (!parsed.success) return rejectedPayload('EVENT_CREATED', parsed.error);
  const payload = parsed.data;
  const eventId = params.eventId ?? randomUUID();
  const eventRef = refOf('EVENT', eventId);
  const refused = refusedSubjectRefs('EVENT_CREATED', [eventRef]);
  if (refused) return refused;
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({ commandType: 'EVENT_CREATED', identity: params, payload, evidenceRefs: params.evidenceRefs });
  const events = new PgEventRepository();

  return guarded([eventRef], () =>
    uow.execute<EventCommandValue>(envelope, async () => {
      const event: Event = EventSchema.parse({
        id: eventId,
        revision: 1,
        title: payload.title,
        lifecycleStatus: payload.lifecycleStatus,
        ...(payload.organiserOrganisationId ? { organiserOrganisationId: payload.organiserOrganisationId } : {}),
      });
      await createRoot({ workspaceId: params.workspaceId, id: eventId, kind: 'EVENT' });
      await events.create({ event, actor });
      const value: EventCommandValue = { eventId, revision: 1, lifecycleStatus: event.lifecycleStatus };
      const advanced: AdvancedRoot[] = [{ aggregateRef: eventRef, beforeRevision: null, afterRevision: 1 }];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'EVENT_CREATED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

export interface SetEventLifecycleStatusParams extends CommandIdentity {
  eventId: string;
  expectedRevision: number;
  lifecycleStatus: Event['lifecycleStatus'];
  evidenceRefs?: string[];
}

export async function setEventLifecycleStatus(
  uow: UnitOfWork,
  params: SetEventLifecycleStatusParams,
): Promise<ExecuteOutcome<EventCommandValue>> {
  const eventRef = refOf('EVENT', params.eventId);
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: 'EVENT_LIFECYCLE_STATUS_SET',
    identity: params,
    payload: { lifecycleStatus: params.lifecycleStatus },
    expectedAggregateRevisions: [{ aggregateRef: eventRef, expectedRevision: params.expectedRevision }],
    evidenceRefs: params.evidenceRefs,
  });
  const events = new PgEventRepository();

  return guarded([eventRef], () =>
    uow.execute<EventCommandValue>(envelope, async ({ lockedHeads }) => {
      const head = headOrConflict(lockedHeads, eventRef);
      if (head.ok === false) return { ok: false, conflict: head.conflict };
      const event = await events.load(params.workspaceId, params.eventId);
      if (!event) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `event ${params.eventId} does not exist`, [eventRef]) };
      const illegal = transitionConflict(LIFECYCLE_TRANSITIONS, event.lifecycleStatus, params.lifecycleStatus, `event ${params.eventId}`, [eventRef]);
      if (illegal) return { ok: false, conflict: illegal };
      await events.setLifecycleStatus({ workspaceId: params.workspaceId, eventId: params.eventId, lifecycleStatus: params.lifecycleStatus, actor });
      const advancedHead = await advanceOrConflict(eventRef, params.workspaceId, head.revision);
      if (advancedHead.ok === false) return { ok: false, conflict: advancedHead.conflict };
      const value: EventCommandValue = { eventId: params.eventId, revision: advancedHead.revision, lifecycleStatus: params.lifecycleStatus };
      const advanced: AdvancedRoot[] = [{ aggregateRef: eventRef, beforeRevision: head.revision, afterRevision: advancedHead.revision }];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'EVENT_LIFECYCLE_STATUS_SET', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

// --- Programme commands --------------------------------------------------------

const CreateProgrammePayloadSchema = z.strictObject({
  eventId: SubjectIdSchema,
  title: z.string().min(1),
  lifecycleStatus: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED']).default('DRAFT'),
});

export interface CreateProgrammeParams extends CommandIdentity {
  eventId: string;
  title: string;
  lifecycleStatus?: Programme['lifecycleStatus'];
  programmeId?: string;
  expectedEventRevision?: number;
  evidenceRefs?: string[];
}

export interface ProgrammeCommandValue {
  programmeId: string;
  eventId: string;
  revision: number;
  lifecycleStatus: Programme['lifecycleStatus'];
}

/** An Event may own several Programmes (F07) — creating one never mutates the Event's own revision. */
export async function createProgramme(
  uow: UnitOfWork,
  params: CreateProgrammeParams,
): Promise<ExecuteOutcome<ProgrammeCommandValue>> {
  const parsed = CreateProgrammePayloadSchema.safeParse({
    eventId: params.eventId,
    title: params.title,
    ...(params.lifecycleStatus ? { lifecycleStatus: params.lifecycleStatus } : {}),
  });
  if (!parsed.success) return rejectedPayload('PROGRAMME_CREATED', parsed.error);
  const payload = parsed.data;
  const programmeId = params.programmeId ?? randomUUID();
  const programmeRef = refOf('PROGRAMME', programmeId);
  const eventRef = refOf('EVENT', params.eventId);
  const refused = refusedSubjectRefs('PROGRAMME_CREATED', [programmeRef, eventRef]);
  if (refused) return refused;
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const expected: ExpectedRevision[] =
    params.expectedEventRevision === undefined ? [] : [{ aggregateRef: eventRef, expectedRevision: params.expectedEventRevision }];
  const envelope = buildEnvelope({
    commandType: 'PROGRAMME_CREATED',
    identity: params,
    payload,
    expectedAggregateRevisions: expected,
    evidenceRefs: params.evidenceRefs,
  });
  const events = new PgEventRepository();
  const programmes = new PgProgrammeRepository();

  return guarded([programmeRef, eventRef], () =>
    uow.execute<ProgrammeCommandValue>(envelope, async () => {
      const event = await events.load(params.workspaceId, params.eventId);
      if (!event) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `event ${params.eventId} does not exist`, [eventRef]) };
      }
      const programme: Programme = ProgrammeSchema.parse({
        id: programmeId,
        revision: 1,
        eventId: params.eventId,
        title: payload.title,
        lifecycleStatus: payload.lifecycleStatus,
      });
      await createRoot({ workspaceId: params.workspaceId, id: programmeId, kind: 'PROGRAMME' });
      await programmes.create({ programme, actor });
      const value: ProgrammeCommandValue = { programmeId, eventId: params.eventId, revision: 1, lifecycleStatus: programme.lifecycleStatus };
      const advanced: AdvancedRoot[] = [{ aggregateRef: programmeRef, beforeRevision: null, afterRevision: 1 }];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'PROGRAMME_CREATED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

export interface SetProgrammeLifecycleStatusParams extends CommandIdentity {
  programmeId: string;
  expectedRevision: number;
  lifecycleStatus: Programme['lifecycleStatus'];
  evidenceRefs?: string[];
}

export async function setProgrammeLifecycleStatus(
  uow: UnitOfWork,
  params: SetProgrammeLifecycleStatusParams,
): Promise<ExecuteOutcome<ProgrammeCommandValue>> {
  const programmeRef = refOf('PROGRAMME', params.programmeId);
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: 'PROGRAMME_LIFECYCLE_STATUS_SET',
    identity: params,
    payload: { lifecycleStatus: params.lifecycleStatus },
    expectedAggregateRevisions: [{ aggregateRef: programmeRef, expectedRevision: params.expectedRevision }],
    evidenceRefs: params.evidenceRefs,
  });
  const programmes = new PgProgrammeRepository();

  return guarded([programmeRef], () =>
    uow.execute<ProgrammeCommandValue>(envelope, async ({ lockedHeads }) => {
      const head = headOrConflict(lockedHeads, programmeRef);
      if (head.ok === false) return { ok: false, conflict: head.conflict };
      const programme = await programmes.load(params.workspaceId, params.programmeId);
      if (!programme) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `programme ${params.programmeId} does not exist`, [programmeRef]) };
      }
      const illegal = transitionConflict(LIFECYCLE_TRANSITIONS, programme.lifecycleStatus, params.lifecycleStatus, `programme ${params.programmeId}`, [programmeRef]);
      if (illegal) return { ok: false, conflict: illegal };
      await programmes.setLifecycleStatus({ workspaceId: params.workspaceId, programmeId: params.programmeId, lifecycleStatus: params.lifecycleStatus, actor });
      const advancedHead = await advanceOrConflict(programmeRef, params.workspaceId, head.revision);
      if (advancedHead.ok === false) return { ok: false, conflict: advancedHead.conflict };
      const value: ProgrammeCommandValue = { programmeId: params.programmeId, eventId: programme.eventId, revision: advancedHead.revision, lifecycleStatus: params.lifecycleStatus };
      const advanced: AdvancedRoot[] = [{ aggregateRef: programmeRef, beforeRevision: head.revision, afterRevision: advancedHead.revision }];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'PROGRAMME_LIFECYCLE_STATUS_SET', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

// --- ProgrammeItem commands ----------------------------------------------------

export type ProgrammeItemSeed = Omit<ProgrammeItem, 'id' | 'programmeId' | 'lifecycleStatus' | 'scheduleAuthority'> & {
  id?: string;
  lifecycleStatus?: ProgrammeItemLifecycle;
  scheduleAuthority?: ProgrammeItem['scheduleAuthority'];
};

export interface ProgrammeItemCommandValue {
  programmeItemId: string;
  programmeId: string;
  programmeRevision: number;
}

export interface AddProgrammeItemParams extends CommandIdentity {
  programmeId: string;
  expectedProgrammeRevision: number;
  item: ProgrammeItemSeed;
  evidenceRefs?: string[];
}

/**
 * Writes the item row and registers it as a *child* subject of its Programme
 * (aggregate_id = programmeId), so adding an item advances the Programme's
 * revision — never a second, per-item counter.
 */
export async function addProgrammeItem(
  uow: UnitOfWork,
  params: AddProgrammeItemParams,
): Promise<ExecuteOutcome<ProgrammeItemCommandValue>> {
  const programmeItemId = params.item.id ?? randomUUID();
  const parsedItem = ProgrammeItemSchema.safeParse({
    ...params.item,
    id: programmeItemId,
    programmeId: params.programmeId,
    lifecycleStatus: params.item.lifecycleStatus ?? 'DRAFT',
    scheduleAuthority: params.item.scheduleAuthority ?? 'INTERNAL',
  });
  if (!parsedItem.success) return rejectedPayload('PROGRAMME_ITEM_ADDED', parsedItem.error);
  const item = parsedItem.data;
  const programmeRef = refOf('PROGRAMME', params.programmeId);
  const itemRef = refOf('PROGRAMME_ITEM', programmeItemId);
  const refused = refusedSubjectRefs('PROGRAMME_ITEM_ADDED', [programmeRef, itemRef]);
  if (refused) return refused;
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: 'PROGRAMME_ITEM_ADDED',
    identity: params,
    payload: item,
    expectedAggregateRevisions: [{ aggregateRef: programmeRef, expectedRevision: params.expectedProgrammeRevision }],
    evidenceRefs: params.evidenceRefs,
  });
  const programmes = new PgProgrammeRepository();

  return guarded([programmeRef, itemRef], () =>
    uow.execute<ProgrammeItemCommandValue>(envelope, async ({ lockedHeads }) => {
      const head = headOrConflict(lockedHeads, programmeRef);
      if (head.ok === false) return { ok: false, conflict: head.conflict };
      const programme = await programmes.load(params.workspaceId, params.programmeId);
      if (!programme) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `programme ${params.programmeId} does not exist`, [programmeRef]) };
      }
      await registerChildSubject({ workspaceId: params.workspaceId, id: programmeItemId, kind: 'PROGRAMME_ITEM', aggregateId: params.programmeId });
      await programmes.addItem({ item, actor });
      const advancedHead = await advanceOrConflict(programmeRef, params.workspaceId, head.revision);
      if (advancedHead.ok === false) return { ok: false, conflict: advancedHead.conflict };
      const value: ProgrammeItemCommandValue = { programmeItemId, programmeId: params.programmeId, programmeRevision: advancedHead.revision };
      const advanced: AdvancedRoot[] = [{ aggregateRef: programmeRef, beforeRevision: head.revision, afterRevision: advancedHead.revision }];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'PROGRAMME_ITEM_ADDED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

const ScheduleChangePayloadSchema = z.strictObject({
  window: WindowSchema.nullable().optional(),
  placeId: SubjectIdSchema.nullable().optional(),
  timeZone: z.string().min(1).nullable().optional(),
});

export interface UpdateProgrammeItemScheduleParams extends CommandIdentity {
  programmeItemId: string;
  expectedProgrammeRevision: number;
  /** Explicit null clears the window; omission leaves it alone. */
  window?: OptionalWindow | null;
  placeId?: string | null;
  timeZone?: string | null;
  evidenceRefs?: string[];
}

/**
 * THE one canonical schedule/place-move path (M4 brief §C): every internal
 * time or venue change for a ProgrammeItem goes through this single handler,
 * which advances exactly the owning Programme's revision. Refuses outright
 * when the item's `scheduleAuthority` is EXTERNAL (M4 brief §F) — NORTHSTAR
 * does not rewrite a schedule it does not control; `recordExternalScheduleObservation`
 * is the only accepted path for that case.
 */
export async function updateProgrammeItemSchedule(
  uow: UnitOfWork,
  params: UpdateProgrammeItemScheduleParams,
): Promise<ExecuteOutcome<ProgrammeItemCommandValue>> {
  const parsed = ScheduleChangePayloadSchema.safeParse({
    ...(params.window !== undefined ? { window: params.window } : {}),
    ...(params.placeId !== undefined ? { placeId: params.placeId } : {}),
    ...(params.timeZone !== undefined ? { timeZone: params.timeZone } : {}),
  });
  if (!parsed.success) return rejectedPayload('PROGRAMME_ITEM_SCHEDULE_CHANGED', parsed.error);
  const changes = parsed.data;
  const itemRef = refOf('PROGRAMME_ITEM', params.programmeItemId);
  const refused = refusedSubjectRefs('PROGRAMME_ITEM_SCHEDULE_CHANGED', [itemRef]);
  if (refused) return refused;
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const programmes = new PgProgrammeRepository();

  if (Object.keys(changes).length === 0) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `no schedule fields supplied for ${params.programmeItemId}`, [itemRef]) };
  }

  const programmeId = await programmes.programmeIdForItem(params.workspaceId, params.programmeItemId);
  if (!programmeId) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `programme item ${params.programmeItemId} does not exist`, [itemRef]) };
  }
  const programmeRef = refOf('PROGRAMME', programmeId);
  const envelope = buildEnvelope({
    commandType: 'PROGRAMME_ITEM_SCHEDULE_CHANGED',
    identity: params,
    payload: { programmeItemId: params.programmeItemId, ...changes },
    expectedAggregateRevisions: [{ aggregateRef: programmeRef, expectedRevision: params.expectedProgrammeRevision }],
    evidenceRefs: params.evidenceRefs,
  });

  return guarded([programmeRef, itemRef], () =>
    uow.execute<ProgrammeItemCommandValue>(envelope, async ({ lockedHeads }) => {
      const head = headOrConflict(lockedHeads, programmeRef);
      if (head.ok === false) return { ok: false, conflict: head.conflict };
      const item = await programmes.loadItem(params.workspaceId, params.programmeItemId);
      if (!item) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `programme item ${params.programmeItemId} does not exist`, [itemRef]) };
      }
      if ((item.scheduleAuthority ?? 'INTERNAL') === 'EXTERNAL') {
        return {
          ok: false,
          conflict: typedConflict(
            'AUTHORITY_DENIED',
            `programme item ${params.programmeItemId} schedule is externally owned; NORTHSTAR cannot rewrite it directly (M4 §F) — record an observation instead`,
            [itemRef],
          ),
        };
      }
      await programmes.updateItemSchedule({
        workspaceId: params.workspaceId,
        programmeItemId: params.programmeItemId,
        window: changes.window === undefined ? undefined : changes.window,
        placeId: changes.placeId === undefined ? undefined : changes.placeId,
        timeZone: changes.timeZone === undefined ? undefined : changes.timeZone,
        actor,
      });
      const advancedHead = await advanceOrConflict(programmeRef, params.workspaceId, head.revision);
      if (advancedHead.ok === false) return { ok: false, conflict: advancedHead.conflict };
      const value: ProgrammeItemCommandValue = { programmeItemId: params.programmeItemId, programmeId, programmeRevision: advancedHead.revision };
      const advanced: AdvancedRoot[] = [{ aggregateRef: programmeRef, beforeRevision: head.revision, afterRevision: advancedHead.revision }];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'PROGRAMME_ITEM_SCHEDULE_CHANGED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

export interface SetProgrammeItemLifecycleStatusParams extends CommandIdentity {
  programmeItemId: string;
  expectedProgrammeRevision: number;
  lifecycleStatus: ProgrammeItemLifecycle;
  evidenceRefs?: string[];
}

/** Covers both cancellation and explicit reinstatement (M4 brief §E) through one typed transition table. */
export async function setProgrammeItemLifecycleStatus(
  uow: UnitOfWork,
  params: SetProgrammeItemLifecycleStatusParams,
): Promise<ExecuteOutcome<ProgrammeItemCommandValue>> {
  const parsed = ProgrammeItemLifecycleSchema.safeParse(params.lifecycleStatus);
  if (!parsed.success) return rejectedPayload('PROGRAMME_ITEM_LIFECYCLE_STATUS_SET', parsed.error);
  const itemRef = refOf('PROGRAMME_ITEM', params.programmeItemId);
  const programmes = new PgProgrammeRepository();
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };

  const programmeId = await programmes.programmeIdForItem(params.workspaceId, params.programmeItemId);
  if (!programmeId) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `programme item ${params.programmeItemId} does not exist`, [itemRef]) };
  }
  const programmeRef = refOf('PROGRAMME', programmeId);
  const envelope = buildEnvelope({
    commandType: 'PROGRAMME_ITEM_LIFECYCLE_STATUS_SET',
    identity: params,
    payload: { programmeItemId: params.programmeItemId, lifecycleStatus: params.lifecycleStatus },
    expectedAggregateRevisions: [{ aggregateRef: programmeRef, expectedRevision: params.expectedProgrammeRevision }],
    evidenceRefs: params.evidenceRefs,
  });

  return guarded([programmeRef, itemRef], () =>
    uow.execute<ProgrammeItemCommandValue>(envelope, async ({ lockedHeads }) => {
      const head = headOrConflict(lockedHeads, programmeRef);
      if (head.ok === false) return { ok: false, conflict: head.conflict };
      const item = await programmes.loadItem(params.workspaceId, params.programmeItemId);
      if (!item) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `programme item ${params.programmeItemId} does not exist`, [itemRef]) };
      }
      const illegal = transitionConflict(PROGRAMME_ITEM_TRANSITIONS, item.lifecycleStatus, params.lifecycleStatus, `programme item ${params.programmeItemId}`, [itemRef]);
      if (illegal) return { ok: false, conflict: illegal };
      if (params.lifecycleStatus === 'SCHEDULED' && !item.window) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `programme item ${params.programmeItemId} has no window to reinstate into SCHEDULED`, [itemRef]),
        };
      }
      await programmes.setItemLifecycleStatus({ workspaceId: params.workspaceId, programmeItemId: params.programmeItemId, lifecycleStatus: params.lifecycleStatus, actor });
      const advancedHead = await advanceOrConflict(programmeRef, params.workspaceId, head.revision);
      if (advancedHead.ok === false) return { ok: false, conflict: advancedHead.conflict };
      const value: ProgrammeItemCommandValue = { programmeItemId: params.programmeItemId, programmeId, programmeRevision: advancedHead.revision };
      const advanced: AdvancedRoot[] = [{ aggregateRef: programmeRef, beforeRevision: head.revision, afterRevision: advancedHead.revision }];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'PROGRAMME_ITEM_LIFECYCLE_STATUS_SET', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

export interface SetProgrammeItemScheduleAuthorityParams extends CommandIdentity {
  programmeItemId: string;
  expectedProgrammeRevision: number;
  scheduleAuthority: 'INTERNAL' | 'EXTERNAL';
  externalSourceRef?: string | null;
  evidenceRefs?: string[];
}

/** Explicit meta-decision of *who* controls this item's schedule (M4 brief §F) — never inferred from an observation. */
export async function setProgrammeItemScheduleAuthority(
  uow: UnitOfWork,
  params: SetProgrammeItemScheduleAuthorityParams,
): Promise<ExecuteOutcome<ProgrammeItemCommandValue>> {
  const itemRef = refOf('PROGRAMME_ITEM', params.programmeItemId);
  const programmes = new PgProgrammeRepository();
  if (params.scheduleAuthority === 'INTERNAL' && params.externalSourceRef) {
    return {
      ok: false,
      conflict: typedConflict('VALIDATION_FAILED', `externalSourceRef supplied while requesting INTERNAL authority for ${params.programmeItemId}`, [itemRef]),
    };
  }
  const programmeId = await programmes.programmeIdForItem(params.workspaceId, params.programmeItemId);
  if (!programmeId) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `programme item ${params.programmeItemId} does not exist`, [itemRef]) };
  }
  const programmeRef = refOf('PROGRAMME', programmeId);
  const envelope = buildEnvelope({
    commandType: 'PROGRAMME_ITEM_SCHEDULE_AUTHORITY_SET',
    identity: params,
    payload: { programmeItemId: params.programmeItemId, scheduleAuthority: params.scheduleAuthority, externalSourceRef: params.externalSourceRef ?? null },
    expectedAggregateRevisions: [{ aggregateRef: programmeRef, expectedRevision: params.expectedProgrammeRevision }],
    evidenceRefs: params.evidenceRefs,
  });

  return guarded([programmeRef, itemRef], () =>
    uow.execute<ProgrammeItemCommandValue>(envelope, async ({ lockedHeads }) => {
      const head = headOrConflict(lockedHeads, programmeRef);
      if (head.ok === false) return { ok: false, conflict: head.conflict };
      const client = currentTransactionClient();
      const result = await client.query(
        `UPDATE programme_items SET schedule_authority = $3, external_source_ref = $4, updated_at = now()
          WHERE workspace_id = $1 AND id = $2`,
        [params.workspaceId, params.programmeItemId, params.scheduleAuthority, params.externalSourceRef ?? null],
      );
      if (result.rowCount !== 1) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `programme item ${params.programmeItemId} does not exist`, [itemRef]) };
      }
      const advancedHead = await advanceOrConflict(programmeRef, params.workspaceId, head.revision);
      if (advancedHead.ok === false) return { ok: false, conflict: advancedHead.conflict };
      const value: ProgrammeItemCommandValue = { programmeItemId: params.programmeItemId, programmeId, programmeRevision: advancedHead.revision };
      const advanced: AdvancedRoot[] = [{ aggregateRef: programmeRef, beforeRevision: head.revision, afterRevision: advancedHead.revision }];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'PROGRAMME_ITEM_SCHEDULE_AUTHORITY_SET', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

export interface RecordExternalScheduleObservationParams extends CommandIdentity {
  programmeItemId: string;
  observedWindow?: OptionalWindow;
  observedPlaceId?: string;
  observedLifecycleStatus?: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
  sourceRef: string;
  observedAt: string;
  observationId?: string;
  evidenceRefs?: string[];
}

export interface ExternalObservationCommandValue {
  observationId: string;
  programmeItemId: string;
  conflictsWithCurrent: boolean;
}

/**
 * Captures what an external system reported WITHOUT rewriting `programme_items`
 * (M4 brief §F, DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md "externally owned state
 * is not changed merely because Northstar submitted a request"). This command
 * has no `expectedAggregateRevisions` on the Programme — observing is not a
 * Programme mutation, only a fact captured alongside it.
 */
export async function recordExternalScheduleObservation(
  uow: UnitOfWork,
  params: RecordExternalScheduleObservationParams,
): Promise<ExecuteOutcome<ExternalObservationCommandValue>> {
  const observationId = params.observationId ?? randomUUID();
  const itemRef = refOf('PROGRAMME_ITEM', params.programmeItemId);
  const refused = refusedSubjectIds('EXTERNAL_SCHEDULE_OBSERVATION_RECORDED', [observationId]);
  if (refused) return refused;
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const programmes = new PgProgrammeRepository();
  const payload = {
    programmeItemId: params.programmeItemId,
    observedWindow: params.observedWindow ?? null,
    observedPlaceId: params.observedPlaceId ?? null,
    observedLifecycleStatus: params.observedLifecycleStatus ?? null,
    sourceRef: params.sourceRef,
    observedAt: params.observedAt,
  };
  const envelope = buildEnvelope({ commandType: 'EXTERNAL_SCHEDULE_OBSERVATION_RECORDED', identity: params, payload, evidenceRefs: params.evidenceRefs });

  return guarded([itemRef], () =>
    uow.execute<ExternalObservationCommandValue>(envelope, async () => {
      const item = await programmes.loadItem(params.workspaceId, params.programmeItemId);
      if (!item) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `programme item ${params.programmeItemId} does not exist`, [itemRef]) };
      }
      const conflictsWithCurrent =
        (params.observedWindow !== undefined &&
          (item.window?.start !== params.observedWindow.start || item.window?.end !== params.observedWindow.end)) ||
        (params.observedPlaceId !== undefined && item.placeId !== params.observedPlaceId) ||
        (params.observedLifecycleStatus !== undefined && item.lifecycleStatus !== params.observedLifecycleStatus);
      await programmes.recordExternalObservation({
        id: observationId,
        workspaceId: params.workspaceId,
        programmeItemId: params.programmeItemId,
        observedWindow: params.observedWindow,
        observedPlaceId: params.observedPlaceId,
        observedLifecycleStatus: params.observedLifecycleStatus,
        sourceRef: params.sourceRef,
        observedAt: params.observedAt,
        conflictsWithCurrent,
        actor,
      });
      const value: ExternalObservationCommandValue = { observationId, programmeItemId: params.programmeItemId, conflictsWithCurrent };
      // No aggregate advances: the observation is evidence alongside the Programme, not a Programme mutation.
      await appendAuditTrail({ envelope, advanced: [], destinationKind: 'EXTERNAL_SCHEDULE_OBSERVATION_RECORDED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced: [] }) };
    }),
  );
}

// --- Participation commands -----------------------------------------------------

function refusedSubjectIds(commandType: string, ids: readonly string[]): ExecuteOutcome<never> | undefined {
  const malformed = ids.filter((id) => !SubjectIdSchema.safeParse(id).success);
  if (malformed.length === 0) return undefined;
  return {
    ok: false,
    conflict: typedConflict('VALIDATION_FAILED', `${commandType} payload rejected: ${malformed.map((id) => JSON.stringify(id)).join(', ')} not a valid subject id`),
  };
}

const AddParticipationPayloadSchema = z.strictObject({
  programmeItemId: SubjectIdSchema,
  travellerId: SubjectIdSchema,
  obligation: z.enum(['REQUIRED', 'OPTIONAL', 'INFORMED']),
  preparationWindow: WindowSchema.optional(),
  releaseWindow: WindowSchema.optional(),
  accepted: z.boolean().default(false),
  roles: z.array(z.string().min(1)).default([]),
});

export interface AddParticipationParams extends CommandIdentity {
  programmeItemId: string;
  travellerId: string;
  obligation: Participation['obligation'];
  expectedProgrammeRevision: number;
  preparationWindow?: OptionalWindow;
  releaseWindow?: OptionalWindow;
  accepted?: boolean;
  roles?: string[];
  participationId?: string;
  evidenceRefs?: string[];
}

export interface ParticipationCommandValue {
  participationId: string;
  programmeItemId: string;
  travellerId: string;
  programmeId: string;
  programmeRevision: number;
}

/** Multiple Travellers may hold one Participation each on the same item; §5's uniqueness is (item, Traveller), never a Journey. */
export async function addParticipation(
  uow: UnitOfWork,
  params: AddParticipationParams,
): Promise<ExecuteOutcome<ParticipationCommandValue>> {
  const parsed = AddParticipationPayloadSchema.safeParse({
    programmeItemId: params.programmeItemId,
    travellerId: params.travellerId,
    obligation: params.obligation,
    ...(params.preparationWindow ? { preparationWindow: params.preparationWindow } : {}),
    ...(params.releaseWindow ? { releaseWindow: params.releaseWindow } : {}),
    accepted: params.accepted ?? false,
    roles: params.roles ?? [],
  });
  if (!parsed.success) return rejectedPayload('PARTICIPATION_ADDED', parsed.error);
  const payload = parsed.data;
  const participationId = params.participationId ?? randomUUID();
  const itemRef = refOf('PROGRAMME_ITEM', params.programmeItemId);
  const participationRef = refOf('PARTICIPATION', participationId);
  const travellerRef = refOf('TRAVELLER', params.travellerId);
  const refused = refusedSubjectRefs('PARTICIPATION_ADDED', [itemRef, participationRef, travellerRef]);
  if (refused) return refused;
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const programmes = new PgProgrammeRepository();

  const programmeId = await programmes.programmeIdForItem(params.workspaceId, params.programmeItemId);
  if (!programmeId) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `programme item ${params.programmeItemId} does not exist`, [itemRef]) };
  }
  const programmeRef = refOf('PROGRAMME', programmeId);
  const envelope = buildEnvelope({
    commandType: 'PARTICIPATION_ADDED',
    identity: params,
    payload,
    expectedAggregateRevisions: [{ aggregateRef: programmeRef, expectedRevision: params.expectedProgrammeRevision }],
    evidenceRefs: params.evidenceRefs,
  });

  return guarded([programmeRef, itemRef, participationRef], () =>
    uow.execute<ParticipationCommandValue>(envelope, async ({ lockedHeads }) => {
      const head = headOrConflict(lockedHeads, programmeRef);
      if (head.ok === false) return { ok: false, conflict: head.conflict };
      const participation: Participation = ParticipationSchema.parse({
        id: participationId,
        programmeItemId: payload.programmeItemId,
        travellerId: payload.travellerId,
        obligation: payload.obligation,
        accepted: payload.accepted,
        ...(payload.preparationWindow ? { preparationWindow: payload.preparationWindow } : {}),
        ...(payload.releaseWindow ? { releaseWindow: payload.releaseWindow } : {}),
      });
      await registerChildSubject({ workspaceId: params.workspaceId, id: participationId, kind: 'PARTICIPATION', aggregateId: programmeId });
      await programmes.addParticipation({ participation, roles: payload.roles, actor });
      const advancedHead = await advanceOrConflict(programmeRef, params.workspaceId, head.revision);
      if (advancedHead.ok === false) return { ok: false, conflict: advancedHead.conflict };
      const value: ParticipationCommandValue = { participationId, programmeItemId: params.programmeItemId, travellerId: params.travellerId, programmeId, programmeRevision: advancedHead.revision };
      const advanced: AdvancedRoot[] = [{ aggregateRef: programmeRef, beforeRevision: head.revision, afterRevision: advancedHead.revision }];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'PARTICIPATION_ADDED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

export interface UpdateParticipationParams extends CommandIdentity {
  participationId: string;
  expectedProgrammeRevision: number;
  accepted?: boolean;
  attended?: boolean | null;
  addRole?: string;
  evidenceRefs?: string[];
}

/** "Assignment/acceptance and attendance are separate dimensions" (Closure §4.4) — one handler, both are independent optional changes. */
export async function updateParticipation(
  uow: UnitOfWork,
  params: UpdateParticipationParams,
): Promise<ExecuteOutcome<ParticipationCommandValue>> {
  const participationRef = refOf('PARTICIPATION', params.participationId);
  const programmes = new PgProgrammeRepository();
  if (params.accepted === undefined && params.attended === undefined && params.addRole === undefined) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `no participation fields supplied for ${params.participationId}`, [participationRef]) };
  }
  const programmeId = await programmes.programmeIdForParticipation(params.workspaceId, params.participationId);
  if (!programmeId) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `participation ${params.participationId} does not exist`, [participationRef]) };
  }
  const programmeRef = refOf('PROGRAMME', programmeId);
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: 'PARTICIPATION_UPDATED',
    identity: params,
    payload: { participationId: params.participationId, accepted: params.accepted ?? null, attended: params.attended === undefined ? null : params.attended, addRole: params.addRole ?? null },
    expectedAggregateRevisions: [{ aggregateRef: programmeRef, expectedRevision: params.expectedProgrammeRevision }],
    evidenceRefs: params.evidenceRefs,
  });

  return guarded([programmeRef, participationRef], () =>
    uow.execute<ParticipationCommandValue>(envelope, async ({ lockedHeads }) => {
      const head = headOrConflict(lockedHeads, programmeRef);
      if (head.ok === false) return { ok: false, conflict: head.conflict };
      const participation = await programmes.loadParticipation(params.workspaceId, params.participationId);
      if (!participation) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `participation ${params.participationId} does not exist`, [participationRef]) };
      }
      if (params.accepted !== undefined || params.attended !== undefined) {
        await programmes.updateParticipation({ workspaceId: params.workspaceId, participationId: params.participationId, accepted: params.accepted, attended: params.attended, actor });
      }
      if (params.addRole) {
        await programmes.addParticipationRole({ workspaceId: params.workspaceId, participationId: params.participationId, role: params.addRole, actor });
      }
      const advancedHead = await advanceOrConflict(programmeRef, params.workspaceId, head.revision);
      if (advancedHead.ok === false) return { ok: false, conflict: advancedHead.conflict };
      const value: ParticipationCommandValue = { participationId: params.participationId, programmeItemId: participation.programmeItemId, travellerId: participation.travellerId, programmeId, programmeRevision: advancedHead.revision };
      const advanced: AdvancedRoot[] = [{ aggregateRef: programmeRef, beforeRevision: head.revision, afterRevision: advancedHead.revision }];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'PARTICIPATION_UPDATED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

// --- ResourceAssignment commands -------------------------------------------------

export interface CreateResourceAssignmentParams extends CommandIdentity {
  activityKind: 'PROGRAMME_ITEM' | 'JOURNEY_ITEM';
  activityId: string;
  resourceId: string;
  quantity?: number;
  assignmentId?: string;
  evidenceRefs?: string[];
}

export interface ResourceAssignmentCommandValue {
  assignmentId: string;
  activityKind: 'PROGRAMME_ITEM' | 'JOURNEY_ITEM';
  activityId: string;
  ownerRef: TypedRef;
  ownerRevision: number;
}

/**
 * AT16/§22 reference seam only: validates the activity exists (0058's deferred
 * trigger is the backstop) and advances whichever aggregate owns the activity's
 * schedule — the Programme for a PROGRAMME_ITEM, the Journey for a JOURNEY_ITEM
 * (§5 "references schedule owner ... not a second editable time"). Capacity/
 * exclusivity evaluation is explicitly M3/M6 territory (M4 brief scope §H).
 */
export async function createResourceAssignment(
  uow: UnitOfWork,
  params: CreateResourceAssignmentParams,
): Promise<ExecuteOutcome<ResourceAssignmentCommandValue>> {
  const assignmentId = params.assignmentId ?? randomUUID();
  const parsed = ResourceAssignmentSchema.safeParse({
    id: assignmentId,
    activityId: params.activityId,
    resourceId: params.resourceId,
    quantity: params.quantity ?? 1,
    lifecycleStatus: 'PROPOSED',
  });
  if (!parsed.success) return rejectedPayload('RESOURCE_ASSIGNMENT_CREATED', parsed.error);
  const assignment = parsed.data;
  const activityRef = refOf(params.activityKind, params.activityId);
  const refused = refusedSubjectRefs('RESOURCE_ASSIGNMENT_CREATED', [activityRef]);
  if (refused) return refused;
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const programmes = new PgProgrammeRepository();

  const ownerRef: TypedRef =
    params.activityKind === 'PROGRAMME_ITEM'
      ? refOf('PROGRAMME', (await programmes.programmeIdForItem(params.workspaceId, params.activityId)) ?? '')
      : refOf('JOURNEY', await journeyIdForItem(params.workspaceId, params.activityId));
  if (!ownerRef.id) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `${params.activityKind} ${params.activityId} does not exist`, [activityRef]) };
  }
  const envelope = buildEnvelope({
    commandType: 'RESOURCE_ASSIGNMENT_CREATED',
    identity: params,
    payload: { activityKind: params.activityKind, activityId: params.activityId, resourceId: params.resourceId, quantity: assignment.quantity },
    expectedAggregateRevisions: [],
    evidenceRefs: params.evidenceRefs,
  });
  const resourceAssignments = new PgResourceAssignmentRepository();

  return guarded([ownerRef, activityRef], () =>
    uow.execute<ResourceAssignmentCommandValue>(envelope, async () => {
      await resourceAssignments.create({ assignment, activityKind: params.activityKind, actor });
      const value: ResourceAssignmentCommandValue = { assignmentId, activityKind: params.activityKind, activityId: params.activityId, ownerRef, ownerRevision: 0 };
      // No aggregate revision advances: a resource assignment is its own row,
      // not a rewrite of the schedule owner's time/place (§5).
      await appendAuditTrail({ envelope, advanced: [], destinationKind: 'RESOURCE_ASSIGNMENT_CREATED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced: [] }) };
    }),
  );
}

async function journeyIdForItem(workspaceId: string, journeyItemId: string): Promise<string> {
  const result = await currentTransactionClient().query<{ journey_id: string }>(
    `SELECT journey_id FROM journey_items WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, journeyItemId],
  );
  return result.rows[0]?.journey_id ?? '';
}

export interface SetResourceAssignmentStatusParams extends CommandIdentity {
  assignmentId: string;
  lifecycleStatus: ResourceAssignment['lifecycleStatus'];
  evidenceRefs?: string[];
}

export async function setResourceAssignmentStatus(
  uow: UnitOfWork,
  params: SetResourceAssignmentStatusParams,
): Promise<ExecuteOutcome<{ assignmentId: string; lifecycleStatus: ResourceAssignment['lifecycleStatus'] }>> {
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: 'RESOURCE_ASSIGNMENT_STATUS_SET',
    identity: params,
    payload: { assignmentId: params.assignmentId, lifecycleStatus: params.lifecycleStatus },
    evidenceRefs: params.evidenceRefs,
  });
  const resourceAssignments = new PgResourceAssignmentRepository();

  return guarded([], () =>
    uow.execute(envelope, async () => {
      const existing = await resourceAssignments.load(params.workspaceId, params.assignmentId);
      if (!existing) {
        return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `resource assignment ${params.assignmentId} does not exist`) };
      }
      await resourceAssignments.setLifecycleStatus({ workspaceId: params.workspaceId, assignmentId: params.assignmentId, lifecycleStatus: params.lifecycleStatus, actor });
      const value = { assignmentId: params.assignmentId, lifecycleStatus: params.lifecycleStatus };
      await appendAuditTrail({ envelope, advanced: [], destinationKind: 'RESOURCE_ASSIGNMENT_STATUS_SET', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced: [] }) };
    }),
  );
}
