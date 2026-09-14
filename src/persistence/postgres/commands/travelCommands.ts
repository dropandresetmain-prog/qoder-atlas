/**
 * NORTHSTAR v2 — Trip / Journey / JourneyItem / IntendedVisit / credential
 * selection command handlers over `PgUnitOfWork` (M2 lane T).
 *
 * These are the only entry points that may mutate the tables of 0020-0025, and
 * they follow the one accepted handler precedent (`workspaceCommands.ts`)
 * exactly: a params object in, an `ExecuteOutcome<Result>` out, the
 * `DomainCommandEnvelope` built inside the handler from a canonical hash of the
 * validated payload, and a callback that returns either
 * `{ ok: true, value, receipt }` or `{ ok: false, conflict }`.
 *
 * Division of labour (M2 design freeze, docs/refactor/evidence/M2.md):
 *  - `PgTripRepository` / `PgJourneyRepository` do typed-row SQL only;
 *  - this file owns the transaction's *shape*: `createRoot` /
 *    `registerChildSubject`, the compare-and-set `advanceHead`, `appendAuditTrail`
 *    and `buildReceipt`;
 *  - `TRIP` and `JOURNEY` are roots with their own head, `JOURNEY_ITEM` is a
 *    child registered under its Journey's aggregate, so an item write advances
 *    exactly one revision counter.
 *
 * Two rules the handlers enforce *before* mutating rather than discovering at
 * COMMIT, because §11.1 makes a rejected command a typed outcome:
 *  - F03: an ACTIVE Trip must have a non-cancelled Journey (0021's deferred
 *    assertion is the backstop, the pre-check is the clean failure);
 *  - F06: a Journey may only pin a credential edition belonging to its own
 *    Traveller, scoped only to that Journey's intended visits (0025's deferred
 *    assertion is again the backstop).
 *
 * Retry safety (C1 amendment c): `execute` may run the callback more than once,
 * so every UUID and derived value is produced *before* the callback and nothing
 * non-deterministic or external happens inside it.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainCommandEnvelopeSchema, type DomainCommandEnvelope } from '../../../contracts/v2/command/domainCommand.ts';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import type { ActorContext } from '../../../contracts/v2/repository/people.ts';
import type { OptionalWindow } from '../../../contracts/v2/repository/travel.ts';
import { SubjectIdSchema, type ExpectedRevision, type RootRevision, type SubjectKind, type TypedRef } from '../../../domain/v2/shared/identity.ts';
import { typedConflict, type TypedConflict } from '../../../domain/v2/shared/errors.ts';
import { InstantIntervalSchema } from '../../../domain/v2/shared/time.ts';
import {
  CredentialSelectionSchema,
  IntendedVisitSchema,
  JourneyItemSchema,
  JourneyItemLifecycleSchema,
  JourneySchema,
  LifecycleStatusSchema,
  TripSchema,
  type CredentialSelection,
  type IntendedVisit,
  type Journey,
  type JourneyItem,
  type JourneyItemLifecycle,
  type LifecycleStatus,
  type Trip,
} from '../../../domain/v2/trip/trip.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import {
  advanceHead,
  appendAuditTrail,
  buildReceipt,
  createRoot,
  derivedCommandRef,
  lockedRevisionOf,
  missingHeadConflict,
  registerChildSubject,
  staleRevisionConflict,
  type AdvancedRoot,
} from '../commandSupport.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';
import { PgJourneyRepository } from '../repositories/pgJourneyRepository.ts';
import { PgTripRepository } from '../repositories/pgTripRepository.ts';

const SCHEMA_VERSION = '1';

// --- shared shapes -----------------------------------------------------------

/** Who is submitting, into which workspace, under which once-only key. */
export interface CommandIdentity {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
}

/**
 * A `JourneyItem` before it has identity or a sort key: the caller supplies the
 * kind-specific intent fields only, and the parent Journey is named by the
 * command rather than by the payload, so an item can never claim a Journey the
 * command did not address.
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type JourneyItemSeed = DistributiveOmit<JourneyItem, 'id' | 'orderKey' | 'flexible' | 'journeyId'> & {
  id?: string;
  orderKey?: string;
  flexible?: boolean;
};

export type IntendedVisitSeed = Omit<IntendedVisit, 'id' | 'journeyId' | 'transitIntent'> & {
  id?: string;
  transitIntent?: boolean;
};

export interface TripCommandValue {
  tripId: string;
  revision: number;
  lifecycleStatus: LifecycleStatus;
}

export interface JourneyCommandValue {
  journeyId: string;
  tripId: string;
  travellerId: string;
  revision: number;
  lifecycleStatus: LifecycleStatus;
}

export interface JourneyItemCommandValue {
  journeyItemId: string;
  journeyId: string;
  journeyRevision: number;
}

export interface IntendedVisitCommandValue {
  intendedVisitId: string;
  journeyId: string;
  journeyRevision: number;
}

export interface CredentialSelectionCommandValue {
  selectionId: string;
  journeyId: string;
  credentialId: string;
  credentialVersionId: string;
  journeyRevision: number;
}

const WindowSchema = InstantIntervalSchema;

const TripDetailMutationSchema = z.strictObject({
  purpose: z.string().min(1).optional(),
  intendedWindow: WindowSchema.optional(),
  /** Explicit null clears the business context; omission leaves it alone. */
  businessContextOrganisationId: SubjectIdSchema.nullable().optional(),
});

const JourneyDetailMutationSchema = z.strictObject({
  intendedWindow: WindowSchema.optional(),
  responsibilityOrganisationId: SubjectIdSchema.nullable().optional(),
  lifecycleStatus: LifecycleStatusSchema.optional(),
});

const JourneyItemMutationSchema = z.strictObject({
  orderKey: z.string().min(1).optional(),
  lifecycleStatus: JourneyItemLifecycleSchema.optional(),
  flexible: z.boolean().optional(),
  intendedWindow: WindowSchema.optional(),
});

// --- envelope / conflict plumbing -------------------------------------------

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

/**
 * Maps a rejected database write onto the frozen conflict vocabulary instead of
 * letting a driver stack reach the caller. Unique violations are the
 * duplicate-identity case the vocabulary names; FK, CHECK and the `RAISE
 * EXCEPTION` of a deferred assertion are all "the schema forbids this state",
 * i.e. validation failures. Anything else is a genuine bug and still throws.
 */
function databaseConflict(error: unknown, subjectRefs: TypedRef[]): TypedConflict {
  const code = (error as { code?: unknown }).code;
  const constraint = (error as { constraint?: unknown }).constraint;
  const message = error instanceof Error ? error.message : String(error);
  const where = typeof constraint === 'string' && constraint.length > 0 ? ` [constraint: ${constraint}]` : '';
  if (code === '23505') {
    return typedConflict('DUPLICATE_REGISTRATION', `${message}${where}`, subjectRefs);
  }
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

/**
 * The payload gate every handler below uses: a rejected submission is a typed
 * `VALIDATION_FAILED` returned *before* `uow.execute`, so no advisory lock, head
 * claim or receipt is ever started for a payload the contract refuses. Same
 * message shape the people lane returns.
 */
function rejectedPayload(commandType: string, error: z.ZodError): ExecuteOutcome<never> {
  return {
    ok: false,
    conflict: typedConflict('VALIDATION_FAILED', `${commandType} payload rejected: ${error.message}`),
  };
}

/**
 * The other half of the same rule: the ids a caller supplies are payload too.
 * An addressed ref is checked by `buildEnvelope`, whose schema parse *throws*
 * outside `guarded`, and a pinned new-row id used to be checked only by the
 * domain parse inside the callback. Both would reach the caller as a raw
 * `ZodError` — one that had already opened a transaction in the second case.
 */
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

function refOf(kind: SubjectKind, id: string): TypedRef {
  return { kind, id };
}

/**
 * The same rule for a submitted id that is not a typed reference — a pinned row
 * identity the caller chose, which no payload schema carries.
 */
function refusedSubjectIds(commandType: string, ids: readonly string[]): ExecuteOutcome<never> | undefined {
  const malformed = ids.filter((id) => !SubjectIdSchema.safeParse(id).success);
  if (malformed.length === 0) return undefined;
  return {
    ok: false,
    conflict: typedConflict(
      'VALIDATION_FAILED',
      `${commandType} payload rejected: ${malformed.map((id) => JSON.stringify(id)).join(', ')} ${
        malformed.length === 1 ? 'is' : 'are'
      } not a valid subject id`,
    ),
  };
}

/**
 * A gate on a root's head: either the revision the caller may build on, or the
 * typed conflict that says it must stop. Discriminated on `ok` (rather than
 * probed with `in`) so a handler branch can never widen into
 * `conflict: TypedConflict | undefined`.
 */
type HeadGate = { ok: true; revision: number } | { ok: false; conflict: TypedConflict };

/** The locked head, or the typed conflict saying there is none. */
function headOrConflict(lockedHeads: RootRevision[], ref: TypedRef): HeadGate {
  const revision = lockedRevisionOf(lockedHeads, ref.id);
  return revision === undefined ? { ok: false, conflict: missingHeadConflict(ref) } : { ok: true, revision };
}

/** Compare-and-set the root's head; a concurrent move is a typed conflict. */
async function advanceOrConflict(ref: TypedRef, workspaceId: string, fromRevision: number): Promise<HeadGate> {
  const next = await advanceHead({ workspaceId, aggregateId: ref.id, fromRevision });
  return next === undefined ? { ok: false, conflict: staleRevisionConflict(ref, fromRevision) } : { ok: true, revision: next };
}

/**
 * Lifecycle is a state machine, not a free text column: `COMPLETED` and
 * `CANCELLED` describe what already happened, so no command reopens them. A
 * same-status submission is allowed (it is a no-op transition the caller may
 * still want receipted).
 */
const TRIP_AND_JOURNEY_TRANSITIONS: Record<LifecycleStatus, readonly LifecycleStatus[]> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

const JOURNEY_ITEM_TRANSITIONS: Record<JourneyItemLifecycle, readonly JourneyItemLifecycle[]> = {
  PLANNED: ['ACTIVE', 'COMPLETED', 'DROPPED'],
  ACTIVE: ['COMPLETED', 'DROPPED'],
  COMPLETED: [],
  DROPPED: [],
};

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

/**
 * F03 pre-check for the journey side: cancelling the last non-cancelled
 * participant of an ACTIVE Trip is exactly what 0021 refuses to commit.
 */
async function participationConflict(
  journeys: PgJourneyRepository,
  trips: PgTripRepository,
  params: { workspaceId: string; tripId: string; from: LifecycleStatus; to: LifecycleStatus },
): Promise<TypedConflict | undefined> {
  if (params.from === 'CANCELLED' || params.to !== 'CANCELLED') return undefined;
  const trip = await trips.load(params.workspaceId, params.tripId);
  if (trip?.lifecycleStatus !== 'ACTIVE') return undefined;
  const remaining = await journeys.nonCancelledCountForTrip(params.workspaceId, params.tripId);
  if (remaining > 1) return undefined;
  return typedConflict(
    'VALIDATION_FAILED',
    `journey of trip ${params.tripId} is the last non-cancelled participant; F03 forbids an ACTIVE Trip without participation (0021)`,
    [refOf('TRIP', params.tripId), refOf('JOURNEY', params.tripId)],
  );
}

// --- Trip commands -----------------------------------------------------------

const CreateTripPayloadSchema = z.strictObject({
  purpose: z.string().min(1),
  intendedWindow: WindowSchema.optional(),
  businessContextOrganisationId: SubjectIdSchema.optional(),
  lifecycleStatus: LifecycleStatusSchema.default('DRAFT'),
});

export interface CreateTripParams extends CommandIdentity {
  purpose: string;
  intendedWindow?: OptionalWindow;
  businessContextOrganisationId?: string;
  /** Defaults to DRAFT; an ACTIVE Trip cannot exist before anyone participates. */
  lifecycleStatus?: LifecycleStatus;
  /** Client-generated UUID; a replay reuses it instead of minting a new Trip. */
  tripId?: string;
  evidenceRefs?: string[];
}

export async function createTrip(
  uow: UnitOfWork,
  params: CreateTripParams,
): Promise<ExecuteOutcome<TripCommandValue>> {
  const parsed = CreateTripPayloadSchema.safeParse({
    purpose: params.purpose,
    ...(params.intendedWindow ? { intendedWindow: params.intendedWindow } : {}),
    ...(params.businessContextOrganisationId
      ? { businessContextOrganisationId: params.businessContextOrganisationId }
      : {}),
    ...(params.lifecycleStatus ? { lifecycleStatus: params.lifecycleStatus } : {}),
  });
  if (!parsed.success) return rejectedPayload('TRIP_CREATED', parsed.error);
  const payload = parsed.data;
  // The client-pinned identity is deliberately outside the hashed payload: it
  // names the row rather than describing the mutation.
  const tripId = params.tripId ?? randomUUID();
  const tripRef = refOf('TRIP', tripId);
  const refused = refusedSubjectRefs('TRIP_CREATED', [tripRef]);
  if (refused) return refused;
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: 'TRIP_CREATED',
    identity: params,
    payload,
    evidenceRefs: params.evidenceRefs,
  });
  const trips = new PgTripRepository();

  return guarded([tripRef], () =>
    uow.execute<TripCommandValue>(envelope, async () => {
      if (payload.lifecycleStatus === 'ACTIVE') {
        return {
          ok: false,
          conflict: typedConflict(
            'VALIDATION_FAILED',
            `trip ${tripId} cannot be created ACTIVE: F03 requires a non-cancelled Journey, which cannot exist yet (0021)`,
            [tripRef],
          ),
        };
      }
      const trip: Trip = TripSchema.parse({
        id: tripId,
        workspaceId: params.workspaceId,
        revision: 1,
        purpose: payload.purpose,
        lifecycleStatus: payload.lifecycleStatus,
        ...(payload.intendedWindow ? { intendedWindow: payload.intendedWindow } : {}),
        ...(payload.businessContextOrganisationId
          ? { businessContextOrganisationId: payload.businessContextOrganisationId }
          : {}),
      });
      await createRoot({ workspaceId: params.workspaceId, id: tripId, kind: 'TRIP' });
      await trips.create({ trip, actor });
      const value: TripCommandValue = { tripId, revision: 1, lifecycleStatus: trip.lifecycleStatus };
      const advanced: AdvancedRoot[] = [
        { aggregateRef: tripRef, beforeRevision: null, afterRevision: 1 },
      ];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'TRIP_CREATED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

export interface UpdateTripDetailsParams extends CommandIdentity {
  tripId: string;
  expectedRevision: number;
  purpose?: string;
  intendedWindow?: OptionalWindow;
  businessContextOrganisationId?: string | null;
  evidenceRefs?: string[];
}

export async function updateTripDetails(
  uow: UnitOfWork,
  params: UpdateTripDetailsParams,
): Promise<ExecuteOutcome<TripCommandValue>> {
  const parsed = TripDetailMutationSchema.safeParse({
    ...(params.purpose === undefined ? {} : { purpose: params.purpose }),
    ...(params.intendedWindow ? { intendedWindow: params.intendedWindow } : {}),
    ...(params.businessContextOrganisationId === undefined
      ? {}
      : { businessContextOrganisationId: params.businessContextOrganisationId }),
  });
  if (!parsed.success) return rejectedPayload('TRIP_DETAILS_UPDATED', parsed.error);
  const changes = parsed.data;
  const tripRef = refOf('TRIP', params.tripId);
  const refused = refusedSubjectRefs('TRIP_DETAILS_UPDATED', [tripRef]);
  if (refused) return refused;
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: 'TRIP_DETAILS_UPDATED',
    identity: params,
    payload: changes,
    expectedAggregateRevisions: [{ aggregateRef: tripRef, expectedRevision: params.expectedRevision }],
    evidenceRefs: params.evidenceRefs,
  });
  const trips = new PgTripRepository();

  return guarded([tripRef], () =>
    uow.execute<TripCommandValue>(envelope, async ({ lockedHeads }) => {
      if (Object.keys(changes).length === 0) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `no trip detail fields supplied for ${params.tripId}`, [tripRef]),
        };
      }
      const head = headOrConflict(lockedHeads, tripRef);
      if (head.ok === false) return { ok: false, conflict: head.conflict };
      const trip = await trips.load(params.workspaceId, params.tripId);
      if (!trip) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `trip ${params.tripId} does not exist`, [tripRef]),
        };
      }
      await trips.updateDetails({
        workspaceId: params.workspaceId,
        tripId: params.tripId,
        ...(changes.purpose === undefined ? {} : { purpose: changes.purpose }),
        ...(changes.intendedWindow === undefined ? {} : { intendedWindow: changes.intendedWindow }),
        ...(changes.businessContextOrganisationId === undefined
          ? {}
          : { businessContextOrganisationId: changes.businessContextOrganisationId }),
        actor,
      });
      const advancedHead = await advanceOrConflict(tripRef, params.workspaceId, head.revision);
      if (advancedHead.ok === false) return { ok: false, conflict: advancedHead.conflict };
      const value: TripCommandValue = {
        tripId: params.tripId,
        revision: advancedHead.revision,
        lifecycleStatus: trip.lifecycleStatus,
      };
      const advanced: AdvancedRoot[] = [
        { aggregateRef: tripRef, beforeRevision: head.revision, afterRevision: advancedHead.revision },
      ];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'TRIP_DETAILS_UPDATED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

const SetTripLifecyclePayloadSchema = z.strictObject({ lifecycleStatus: LifecycleStatusSchema });

export interface SetTripLifecycleStatusParams extends CommandIdentity {
  tripId: string;
  expectedRevision: number;
  lifecycleStatus: LifecycleStatus;
  evidenceRefs?: string[];
}

export async function setTripLifecycleStatus(
  uow: UnitOfWork,
  params: SetTripLifecycleStatusParams,
): Promise<ExecuteOutcome<TripCommandValue>> {
  const parsed = SetTripLifecyclePayloadSchema.safeParse({ lifecycleStatus: params.lifecycleStatus });
  if (!parsed.success) return rejectedPayload('TRIP_LIFECYCLE_STATUS_SET', parsed.error);
  const payload = parsed.data;
  const tripRef = refOf('TRIP', params.tripId);
  const refused = refusedSubjectRefs('TRIP_LIFECYCLE_STATUS_SET', [tripRef]);
  if (refused) return refused;
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: 'TRIP_LIFECYCLE_STATUS_SET',
    identity: params,
    payload,
    expectedAggregateRevisions: [{ aggregateRef: tripRef, expectedRevision: params.expectedRevision }],
    evidenceRefs: params.evidenceRefs,
  });
  const trips = new PgTripRepository();
  const journeys = new PgJourneyRepository();

  return guarded([tripRef], () =>
    uow.execute<TripCommandValue>(envelope, async ({ lockedHeads }) => {
      const head = headOrConflict(lockedHeads, tripRef);
      if (head.ok === false) return { ok: false, conflict: head.conflict };
      const trip = await trips.load(params.workspaceId, params.tripId);
      if (!trip) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `trip ${params.tripId} does not exist`, [tripRef]),
        };
      }
      const illegal = transitionConflict(
        TRIP_AND_JOURNEY_TRANSITIONS,
        trip.lifecycleStatus,
        payload.lifecycleStatus,
        `trip ${params.tripId}`,
        [tripRef],
      );
      if (illegal) return { ok: false, conflict: illegal };
      if (payload.lifecycleStatus === 'ACTIVE' && trip.lifecycleStatus !== 'ACTIVE') {
        const participants = await journeys.nonCancelledCountForTrip(params.workspaceId, params.tripId);
        if (participants === 0) {
          return {
            ok: false,
            conflict: typedConflict(
              'VALIDATION_FAILED',
              `trip ${params.tripId} cannot become ACTIVE with no non-cancelled journey (F03, 0021)`,
              [tripRef],
            ),
          };
        }
      }
      await trips.setLifecycleStatus({
        workspaceId: params.workspaceId,
        tripId: params.tripId,
        lifecycleStatus: payload.lifecycleStatus,
        actor,
      });
      const advancedHead = await advanceOrConflict(tripRef, params.workspaceId, head.revision);
      if (advancedHead.ok === false) return { ok: false, conflict: advancedHead.conflict };
      const value: TripCommandValue = {
        tripId: params.tripId,
        revision: advancedHead.revision,
        lifecycleStatus: payload.lifecycleStatus,
      };
      const advanced: AdvancedRoot[] = [
        { aggregateRef: tripRef, beforeRevision: head.revision, afterRevision: advancedHead.revision },
      ];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'TRIP_LIFECYCLE_STATUS_SET', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

// --- Journey commands --------------------------------------------------------

const CreateJourneyPayloadSchema = z.strictObject({
  tripId: SubjectIdSchema,
  travellerId: SubjectIdSchema,
  intendedWindow: WindowSchema.optional(),
  responsibilityOrganisationId: SubjectIdSchema.optional(),
  lifecycleStatus: LifecycleStatusSchema.default('DRAFT'),
  /** Already validated by the domain union before the envelope is built. */
  items: z.array(JourneyItemSchema).optional(),
  intendedVisits: z.array(IntendedVisitSchema).optional(),
});

export interface CreateJourneyParams extends CommandIdentity {
  tripId: string;
  travellerId: string;
  intendedWindow?: OptionalWindow;
  responsibilityOrganisationId?: string;
  lifecycleStatus?: LifecycleStatus;
  items?: JourneyItemSeed[];
  intendedVisits?: IntendedVisitSeed[];
  /** Supply to bind this membership change to the Trip revision actually read. */
  expectedTripRevision?: number;
  journeyId?: string;
  evidenceRefs?: string[];
}

/**
 * One Journey per (Trip, Traveller): a second submission for the same pair is
 * rejected by `journeys_per_traveller_per_trip_uidx` and arrives back as a typed
 * `DUPLICATE_REGISTRATION`, never as a second authoritative itinerary.
 */
export async function createJourney(
  uow: UnitOfWork,
  params: CreateJourneyParams,
): Promise<ExecuteOutcome<JourneyCommandValue>> {
  const journeyId = params.journeyId ?? randomUUID();
  // Identity and every derived value exist before the callback: a serializable
  // retry must reproduce this command byte for byte (C1 amendment c).
  const itemSeeds = (params.items ?? []).map((seed) => ({
    ...seed,
    journeyId,
    id: seed.id ?? randomUUID(),
    orderKey: seed.orderKey ?? (seed.id ?? journeyId),
    flexible: seed.flexible ?? false,
  }));
  const parsedItems = z.array(JourneyItemSchema).safeParse(itemSeeds);
  if (!parsedItems.success) return rejectedPayload('JOURNEY_CREATED', parsedItems.error);
  const items: JourneyItem[] = parsedItems.data;
  const visitSeeds = (params.intendedVisits ?? []).map((seed) => ({
    ...seed,
    journeyId,
    id: seed.id ?? randomUUID(),
    transitIntent: seed.transitIntent ?? false,
  }));
  const parsedVisits = z.array(IntendedVisitSchema).safeParse(visitSeeds);
  if (!parsedVisits.success) return rejectedPayload('JOURNEY_CREATED', parsedVisits.error);
  const intendedVisits: IntendedVisit[] = parsedVisits.data;
  const parsedPayload = CreateJourneyPayloadSchema.safeParse({
    tripId: params.tripId,
    travellerId: params.travellerId,
    ...(params.intendedWindow ? { intendedWindow: params.intendedWindow } : {}),
    ...(params.responsibilityOrganisationId ? { responsibilityOrganisationId: params.responsibilityOrganisationId } : {}),
    ...(params.lifecycleStatus ? { lifecycleStatus: params.lifecycleStatus } : {}),
    items,
    intendedVisits,
  });
  if (!parsedPayload.success) return rejectedPayload('JOURNEY_CREATED', parsedPayload.error);
  const payload = parsedPayload.data;

  const journeyRef = refOf('JOURNEY', journeyId);
  const tripRef = refOf('TRIP', params.tripId);
  const refused = refusedSubjectRefs('JOURNEY_CREATED', [journeyRef, tripRef]);
  if (refused) return refused;
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const expected: ExpectedRevision[] =
    params.expectedTripRevision === undefined
      ? []
      : [{ aggregateRef: tripRef, expectedRevision: params.expectedTripRevision }];
  const envelope = buildEnvelope({
    commandType: 'JOURNEY_CREATED',
    identity: params,
    payload,
    expectedAggregateRevisions: expected,
    evidenceRefs: params.evidenceRefs,
  });
  const trips = new PgTripRepository();
  const journeys = new PgJourneyRepository();

  return guarded([journeyRef, tripRef], () =>
    uow.execute<JourneyCommandValue>(envelope, async () => {
      const trip = await trips.load(params.workspaceId, params.tripId);
      if (!trip) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `trip ${params.tripId} does not exist in this workspace`, [
            tripRef,
          ]),
        };
      }
      const journey: Journey = JourneySchema.parse({
        id: journeyId,
        workspaceId: params.workspaceId,
        revision: 1,
        tripId: params.tripId,
        travellerId: params.travellerId,
        lifecycleStatus: payload.lifecycleStatus,
        ...(params.intendedWindow ? { intendedWindow: params.intendedWindow } : {}),
        ...(params.responsibilityOrganisationId ? { responsibilityOrganisationId: params.responsibilityOrganisationId } : {}),
      });
      await createRoot({ workspaceId: params.workspaceId, id: journeyId, kind: 'JOURNEY' });
      for (const item of items) {
        await registerChildSubject({
          workspaceId: params.workspaceId,
          id: item.id,
          kind: 'JOURNEY_ITEM',
          aggregateId: journeyId,
        });
      }
      await journeys.create({ journey, actor, items, intendedVisits });
      // §3: membership changes advance the Trip's *scope generation*, never its
      // own revision — Journey is an independent root.
      await uow.scopes.advance({ scopeKind: 'TRIP', scopeId: params.tripId });
      const value: JourneyCommandValue = {
        journeyId,
        tripId: params.tripId,
        travellerId: params.travellerId,
        revision: 1,
        lifecycleStatus: journey.lifecycleStatus,
      };
      const advanced: AdvancedRoot[] = [
        { aggregateRef: journeyRef, beforeRevision: null, afterRevision: 1 },
      ];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'JOURNEY_CREATED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

export interface UpdateJourneyDetailsParams extends CommandIdentity {
  journeyId: string;
  expectedRevision: number;
  intendedWindow?: OptionalWindow;
  responsibilityOrganisationId?: string | null;
  evidenceRefs?: string[];
}

/** Detail mutation without a lifecycle claim; see `setJourneyLifecycleStatus`. */
export async function updateJourneyDetails(
  uow: UnitOfWork,
  params: UpdateJourneyDetailsParams,
): Promise<ExecuteOutcome<JourneyCommandValue>> {
  return mutateJourney(uow, { ...params, commandType: 'JOURNEY_DETAILS_UPDATED' });
}

const SetJourneyLifecyclePayloadSchema = z.strictObject({ lifecycleStatus: LifecycleStatusSchema });

export interface SetJourneyLifecycleStatusParams extends CommandIdentity {
  journeyId: string;
  expectedRevision: number;
  lifecycleStatus: LifecycleStatus;
  evidenceRefs?: string[];
}

export async function setJourneyLifecycleStatus(
  uow: UnitOfWork,
  params: SetJourneyLifecycleStatusParams,
): Promise<ExecuteOutcome<JourneyCommandValue>> {
  const parsed = SetJourneyLifecyclePayloadSchema.safeParse({ lifecycleStatus: params.lifecycleStatus });
  if (!parsed.success) return rejectedPayload('JOURNEY_LIFECYCLE_STATUS_SET', parsed.error);
  const payload = parsed.data;
  return mutateJourney(uow, {
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    journeyId: params.journeyId,
    expectedRevision: params.expectedRevision,
    evidenceRefs: params.evidenceRefs,
    lifecycleStatus: payload.lifecycleStatus,
    commandType: 'JOURNEY_LIFECYCLE_STATUS_SET',
  });
}

/**
 * Shared body for the two Journey-root mutations that both write `journeys` and
 * advance the JOURNEY head. Keeping one implementation is what makes the F03
 * participation guard unconditional.
 */
async function mutateJourney(
  uow: UnitOfWork,
  params: CommandIdentity & {
    journeyId: string;
    expectedRevision: number;
    intendedWindow?: OptionalWindow;
    responsibilityOrganisationId?: string | null;
    lifecycleStatus?: LifecycleStatus;
    evidenceRefs?: string[];
    commandType: string;
  },
): Promise<ExecuteOutcome<JourneyCommandValue>> {
  const parsed = JourneyDetailMutationSchema.safeParse({
    ...(params.intendedWindow ? { intendedWindow: params.intendedWindow } : {}),
    ...(params.responsibilityOrganisationId === undefined
      ? {}
      : { responsibilityOrganisationId: params.responsibilityOrganisationId }),
    ...(params.lifecycleStatus === undefined ? {} : { lifecycleStatus: params.lifecycleStatus }),
  });
  if (!parsed.success) return rejectedPayload(params.commandType, parsed.error);
  const changes = parsed.data;
  const journeyRef = refOf('JOURNEY', params.journeyId);
  const refused = refusedSubjectRefs(params.commandType, [journeyRef]);
  if (refused) return refused;
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: params.commandType,
    identity: params,
    payload: changes,
    expectedAggregateRevisions: [{ aggregateRef: journeyRef, expectedRevision: params.expectedRevision }],
    evidenceRefs: params.evidenceRefs,
  });
  const journeys = new PgJourneyRepository();
  const trips = new PgTripRepository();

  return guarded([journeyRef], () =>
    uow.execute<JourneyCommandValue>(envelope, async ({ lockedHeads }) => {
      if (Object.keys(changes).length === 0) {
        return {
          ok: false,
          conflict: typedConflict(
            'VALIDATION_FAILED',
            `no journey detail fields supplied for ${params.journeyId}`,
            [journeyRef],
          ),
        };
      }
      const head = headOrConflict(lockedHeads, journeyRef);
      if (head.ok === false) return { ok: false, conflict: head.conflict };
      const journey = await journeys.load(params.workspaceId, params.journeyId);
      if (!journey) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `journey ${params.journeyId} does not exist`, [journeyRef]),
        };
      }
      if (changes.lifecycleStatus) {
        const illegal = transitionConflict(
          TRIP_AND_JOURNEY_TRANSITIONS,
          journey.lifecycleStatus,
          changes.lifecycleStatus,
          `journey ${params.journeyId}`,
          [journeyRef],
        );
        if (illegal) return { ok: false, conflict: illegal };
        const participation = await participationConflict(journeys, trips, {
          workspaceId: params.workspaceId,
          tripId: journey.tripId,
          from: journey.lifecycleStatus,
          to: changes.lifecycleStatus,
        });
        if (participation) return { ok: false, conflict: participation };
      }
      await journeys.updateDetails({
        workspaceId: params.workspaceId,
        journeyId: params.journeyId,
        ...(changes.intendedWindow === undefined ? {} : { intendedWindow: changes.intendedWindow }),
        ...(changes.responsibilityOrganisationId === undefined
          ? {}
          : { responsibilityOrganisationId: changes.responsibilityOrganisationId }),
        ...(changes.lifecycleStatus === undefined ? {} : { lifecycleStatus: changes.lifecycleStatus }),
        actor,
      });
      // §3: joining or leaving participation moves the Trip's scope generation,
      // never the Trip's own revision — Journey is an independent root.
      const cancelledBefore = journey.lifecycleStatus === 'CANCELLED';
      const cancelledAfter = changes.lifecycleStatus === 'CANCELLED';
      if (changes.lifecycleStatus !== undefined && cancelledBefore !== cancelledAfter) {
        await uow.scopes.advance({ scopeKind: 'TRIP', scopeId: journey.tripId });
      }
      const advancedHead = await advanceOrConflict(journeyRef, params.workspaceId, head.revision);
      if (advancedHead.ok === false) return { ok: false, conflict: advancedHead.conflict };
      const value: JourneyCommandValue = {
        journeyId: params.journeyId,
        tripId: journey.tripId,
        travellerId: journey.travellerId,
        revision: advancedHead.revision,
        lifecycleStatus: changes.lifecycleStatus ?? journey.lifecycleStatus,
      };
      const advanced: AdvancedRoot[] = [
        { aggregateRef: journeyRef, beforeRevision: head.revision, afterRevision: advancedHead.revision },
      ];
      await appendAuditTrail({ envelope, advanced, destinationKind: params.commandType, payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

// --- JourneyItem commands ----------------------------------------------------

export interface AddJourneyItemParams extends CommandIdentity {
  journeyId: string;
  expectedRevision: number;
  item: JourneyItemSeed;
  evidenceRefs?: string[];
}

/**
 * Writes the item row plus exactly one kind-matching detail row (0023) and
 * registers the item as a *child* subject of its Journey, so adding an item
 * advances one revision counter — the Journey's — and never mints a second
 * root. `orderKey` defaults to the item's own id purely as a stable sort key;
 * §3 forbids reading it as a dependency.
 */
export async function addJourneyItem(
  uow: UnitOfWork,
  params: AddJourneyItemParams,
): Promise<ExecuteOutcome<JourneyItemCommandValue>> {
  const journeyItemId = params.item.id ?? randomUUID();
  const parsedItem = JourneyItemSchema.safeParse({
    ...params.item,
    journeyId: params.journeyId,
    id: journeyItemId,
    orderKey: params.item.orderKey ?? journeyItemId,
    flexible: params.item.flexible ?? false,
  });
  if (!parsedItem.success) return rejectedPayload('JOURNEY_ITEM_ADDED', parsedItem.error);
  const item = parsedItem.data;
  const journeyRef = refOf('JOURNEY', params.journeyId);
  const itemRef = refOf('JOURNEY_ITEM', journeyItemId);
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: 'JOURNEY_ITEM_ADDED',
    identity: params,
    payload: item,
    expectedAggregateRevisions: [{ aggregateRef: journeyRef, expectedRevision: params.expectedRevision }],
    evidenceRefs: params.evidenceRefs,
  });
  const journeys = new PgJourneyRepository();

  return guarded([journeyRef, itemRef], () =>
    uow.execute<JourneyItemCommandValue>(envelope, async ({ lockedHeads }) => {
      const head = headOrConflict(lockedHeads, journeyRef);
      if (head.ok === false) return { ok: false, conflict: head.conflict };
      const journey = await journeys.load(params.workspaceId, params.journeyId);
      if (!journey) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `journey ${params.journeyId} does not exist`, [journeyRef]),
        };
      }
      await registerChildSubject({
        workspaceId: params.workspaceId,
        id: journeyItemId,
        kind: 'JOURNEY_ITEM',
        aggregateId: params.journeyId,
      });
      await journeys.addItem({ journeyId: params.journeyId, item, actor });
      const advancedHead = await advanceOrConflict(journeyRef, params.workspaceId, head.revision);
      if (advancedHead.ok === false) return { ok: false, conflict: advancedHead.conflict };
      const value: JourneyItemCommandValue = {
        journeyItemId,
        journeyId: params.journeyId,
        journeyRevision: advancedHead.revision,
      };
      const advanced: AdvancedRoot[] = [
        { aggregateRef: journeyRef, beforeRevision: head.revision, afterRevision: advancedHead.revision },
      ];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'JOURNEY_ITEM_ADDED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

export interface UpdateJourneyItemParams extends CommandIdentity {
  journeyId: string;
  journeyItemId: string;
  expectedRevision: number;
  orderKey?: string;
  lifecycleStatus?: JourneyItemLifecycle;
  flexible?: boolean;
  intendedWindow?: OptionalWindow;
  evidenceRefs?: string[];
}

export async function updateJourneyItem(
  uow: UnitOfWork,
  params: UpdateJourneyItemParams,
): Promise<ExecuteOutcome<JourneyItemCommandValue>> {
  const parsed = JourneyItemMutationSchema.safeParse({
    ...(params.orderKey === undefined ? {} : { orderKey: params.orderKey }),
    ...(params.lifecycleStatus === undefined ? {} : { lifecycleStatus: params.lifecycleStatus }),
    ...(params.flexible === undefined ? {} : { flexible: params.flexible }),
    ...(params.intendedWindow ? { intendedWindow: params.intendedWindow } : {}),
  });
  if (!parsed.success) return rejectedPayload('JOURNEY_ITEM_UPDATED', parsed.error);
  const changes = parsed.data;
  const journeyRef = refOf('JOURNEY', params.journeyId);
  const itemRef = refOf('JOURNEY_ITEM', params.journeyItemId);
  const refused = refusedSubjectRefs('JOURNEY_ITEM_UPDATED', [journeyRef, itemRef]);
  if (refused) return refused;
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: 'JOURNEY_ITEM_UPDATED',
    identity: params,
    payload: changes,
    expectedAggregateRevisions: [{ aggregateRef: journeyRef, expectedRevision: params.expectedRevision }],
    evidenceRefs: params.evidenceRefs,
  });
  const journeys = new PgJourneyRepository();

  return guarded([journeyRef, itemRef], () =>
    uow.execute<JourneyItemCommandValue>(envelope, async ({ lockedHeads }) => {
      if (Object.keys(changes).length === 0) {
        return {
          ok: false,
          conflict: typedConflict(
            'VALIDATION_FAILED',
            `no journey item fields supplied for ${params.journeyItemId}`,
            [itemRef],
          ),
        };
      }
      const head = headOrConflict(lockedHeads, journeyRef);
      if (head.ok === false) return { ok: false, conflict: head.conflict };
      const existing = await journeys.loadItem(params.workspaceId, params.journeyItemId);
      if (!existing) {
        return {
          ok: false,
          conflict: typedConflict(
            'VALIDATION_FAILED',
            `journey item ${params.journeyItemId} does not exist in this workspace`,
            [itemRef],
          ),
        };
      }
      if (existing.journeyId !== params.journeyId) {
        return {
          ok: false,
          conflict: typedConflict(
            'VALIDATION_FAILED',
            `journey item ${params.journeyItemId} belongs to journey ${existing.journeyId}, not ${params.journeyId}`,
            [itemRef, journeyRef],
          ),
        };
      }
      if (changes.lifecycleStatus) {
        const illegal = transitionConflict(
          JOURNEY_ITEM_TRANSITIONS,
          existing.lifecycleStatus,
          changes.lifecycleStatus,
          `journey item ${params.journeyItemId}`,
          [itemRef],
        );
        if (illegal) return { ok: false, conflict: illegal };
      }
      await journeys.updateItem({
        workspaceId: params.workspaceId,
        journeyId: params.journeyId,
        journeyItemId: params.journeyItemId,
        ...(changes.orderKey === undefined ? {} : { orderKey: changes.orderKey }),
        ...(changes.lifecycleStatus === undefined ? {} : { lifecycleStatus: changes.lifecycleStatus }),
        ...(changes.flexible === undefined ? {} : { flexible: changes.flexible }),
        ...(changes.intendedWindow === undefined ? {} : { intendedWindow: changes.intendedWindow }),
        actor,
      });
      const advancedHead = await advanceOrConflict(journeyRef, params.workspaceId, head.revision);
      if (advancedHead.ok === false) return { ok: false, conflict: advancedHead.conflict };
      const value: JourneyItemCommandValue = {
        journeyItemId: params.journeyItemId,
        journeyId: params.journeyId,
        journeyRevision: advancedHead.revision,
      };
      const advanced: AdvancedRoot[] = [
        { aggregateRef: journeyRef, beforeRevision: head.revision, afterRevision: advancedHead.revision },
      ];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'JOURNEY_ITEM_UPDATED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

// --- IntendedVisit commands --------------------------------------------------

export interface AddIntendedVisitParams extends CommandIdentity {
  journeyId: string;
  expectedRevision: number;
  visit: IntendedVisitSeed;
  evidenceRefs?: string[];
}

/**
 * An intended visit is intent, never an observed encounter: M4 owns the
 * jurisdiction and M6 evaluates applicability against this row. It is a Journey
 * child, so it advances the Journey head.
 */
export async function addIntendedVisit(
  uow: UnitOfWork,
  params: AddIntendedVisitParams,
): Promise<ExecuteOutcome<IntendedVisitCommandValue>> {
  const intendedVisitId = params.visit.id ?? randomUUID();
  const parsedVisit = IntendedVisitSchema.safeParse({
    ...params.visit,
    journeyId: params.journeyId,
    id: intendedVisitId,
    transitIntent: params.visit.transitIntent ?? false,
  });
  if (!parsedVisit.success) return rejectedPayload('INTENDED_VISIT_ADDED', parsedVisit.error);
  const visit = parsedVisit.data;
  const journeyRef = refOf('JOURNEY', params.journeyId);
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: 'INTENDED_VISIT_ADDED',
    identity: params,
    payload: visit,
    expectedAggregateRevisions: [{ aggregateRef: journeyRef, expectedRevision: params.expectedRevision }],
    evidenceRefs: params.evidenceRefs,
  });
  const journeys = new PgJourneyRepository();

  return guarded([journeyRef], () =>
    uow.execute<IntendedVisitCommandValue>(envelope, async ({ lockedHeads }) => {
      const head = headOrConflict(lockedHeads, journeyRef);
      if (head.ok === false) return { ok: false, conflict: head.conflict };
      const journey = await journeys.load(params.workspaceId, params.journeyId);
      if (!journey) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `journey ${params.journeyId} does not exist`, [journeyRef]),
        };
      }
      await journeys.addIntendedVisit({ visit, actor });
      const advancedHead = await advanceOrConflict(journeyRef, params.workspaceId, head.revision);
      if (advancedHead.ok === false) return { ok: false, conflict: advancedHead.conflict };
      const value: IntendedVisitCommandValue = {
        intendedVisitId,
        journeyId: params.journeyId,
        journeyRevision: advancedHead.revision,
      };
      const advanced: AdvancedRoot[] = [
        { aggregateRef: journeyRef, beforeRevision: head.revision, afterRevision: advancedHead.revision },
      ];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'INTENDED_VISIT_ADDED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

// --- Credential selection commands -------------------------------------------

const SelectCredentialPayloadSchema = z.strictObject({
  journeyId: SubjectIdSchema,
  credentialId: SubjectIdSchema,
  /** Omitted means "pin the credential's current accepted edition". */
  credentialVersionId: SubjectIdSchema.optional(),
  scopeIntendedVisitIds: z.array(SubjectIdSchema).min(1),
});

export interface SelectCredentialParams extends CommandIdentity {
  journeyId: string;
  expectedRevision: number;
  credentialId: string;
  credentialVersionId?: string;
  scopeIntendedVisitIds: string[];
  selectionId?: string;
  evidenceRefs?: string[];
}

/**
 * A Journey pins an immutable credential *edition*; the person's document is
 * never mutated here (F06). 0025 asserts the three consistency rules at COMMIT,
 * and this handler re-checks them first so a wrong claim is a typed conflict
 * rather than a rolled-back transaction:
 *  1. the pinned edition belongs to the named credential;
 *  2. the credential belongs to the Journey's own Traveller;
 *  3. every scoped visit is a visit of this same Journey.
 *
 * Provenance is the enclosing command: `selected_by_command_id` carries
 * `derivedCommandRef(envelope)` and the namespace/key pair carries the receipt
 * identity, so 0025's `DEFERRABLE INITIALLY DEFERRED` FK into
 * `command_receipts` resolves at COMMIT — `PgUnitOfWork` inserts that receipt
 * only after this callback returns.
 */
export async function selectCredential(
  uow: UnitOfWork,
  params: SelectCredentialParams,
): Promise<ExecuteOutcome<CredentialSelectionCommandValue>> {
  const parsed = SelectCredentialPayloadSchema.safeParse({
    journeyId: params.journeyId,
    credentialId: params.credentialId,
    ...(params.credentialVersionId ? { credentialVersionId: params.credentialVersionId } : {}),
    scopeIntendedVisitIds: params.scopeIntendedVisitIds,
  });
  if (!parsed.success) return rejectedPayload('CREDENTIAL_SELECTED', parsed.error);
  const payload = parsed.data;
  const freshSelectionId = params.selectionId ?? randomUUID();
  const refused = refusedSubjectIds('CREDENTIAL_SELECTED', [freshSelectionId]);
  if (refused) return refused;
  const journeyRef = refOf('JOURNEY', payload.journeyId);
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: 'CREDENTIAL_SELECTED',
    identity: params,
    payload,
    expectedAggregateRevisions: [{ aggregateRef: journeyRef, expectedRevision: params.expectedRevision }],
    evidenceRefs: params.evidenceRefs,
  });
  const journeys = new PgJourneyRepository();

  return guarded([journeyRef], () =>
    uow.execute<CredentialSelectionCommandValue>(envelope, async ({ lockedHeads }) => {
      const head = headOrConflict(lockedHeads, journeyRef);
      if (head.ok === false) return { ok: false, conflict: head.conflict };
      const journey = await journeys.load(params.workspaceId, payload.journeyId);
      if (!journey) {
        return {
          ok: false,
          conflict: typedConflict('VALIDATION_FAILED', `journey ${payload.journeyId} does not exist`, [journeyRef]),
        };
      }
      const owner = await journeys.credentialOwner(params.workspaceId, payload.credentialId);
      if (!owner) {
        return {
          ok: false,
          conflict: typedConflict(
            'VALIDATION_FAILED',
            `credential ${payload.credentialId} does not exist in this workspace`,
            [journeyRef],
          ),
        };
      }
      const credentialVersionId = payload.credentialVersionId ?? owner.currentVersionId;
      if (!credentialVersionId) {
        return {
          ok: false,
          conflict: typedConflict(
            'VALIDATION_FAILED',
            `credential ${payload.credentialId} has no current accepted edition to pin`,
            [journeyRef],
          ),
        };
      }
      if (payload.credentialVersionId) {
        const versionOwner = await journeys.credentialVersionOwner(params.workspaceId, credentialVersionId);
        if (versionOwner !== payload.credentialId) {
          return {
            ok: false,
            conflict: typedConflict(
              'VALIDATION_FAILED',
              `credential edition ${credentialVersionId} belongs to credential ${versionOwner ?? 'nothing'}, not ${payload.credentialId}`,
              [journeyRef],
            ),
          };
        }
      }
      if (owner.travellerId !== journey.travellerId) {
        return {
          ok: false,
          conflict: typedConflict(
            'VALIDATION_FAILED',
            `credential ${payload.credentialId} belongs to another traveller; F06 keeps credentials Traveller-owned`,
            [refOf('TRAVELLER', owner.travellerId), journeyRef],
          ),
        };
      }
      const ownVisits = new Set((await journeys.listIntendedVisits(params.workspaceId, payload.journeyId)).map((v) => v.id));
      const foreign = payload.scopeIntendedVisitIds.filter((id) => !ownVisits.has(id));
      if (foreign.length > 0) {
        return {
          ok: false,
          conflict: typedConflict(
            'VALIDATION_FAILED',
            `selection scopes intended visit(s) ${foreign.join(', ')} that are not visits of journey ${payload.journeyId}`,
            [journeyRef],
          ),
        };
      }
      // Re-selecting the same credential re-pins the existing row's edition, so
      // a Journey never holds two parallel claims for one document.
      const existing = (await journeys.listCredentialSelections(params.workspaceId, payload.journeyId)).find(
        (selection) => selection.credentialId === payload.credentialId,
      );
      const selectionId = existing?.id ?? freshSelectionId;
      const selection: CredentialSelection = CredentialSelectionSchema.parse({
        id: selectionId,
        journeyId: payload.journeyId,
        credentialId: payload.credentialId,
        credentialVersionId,
        scopeIntendedVisitIds: payload.scopeIntendedVisitIds,
        selectedByCommandId: derivedCommandRef(envelope),
      });
      await journeys.selectCredential({
        selection,
        receipt: { commandNamespace: envelope.commandType, idempotencyKey: envelope.idempotencyKey },
        actor,
      });
      const advancedHead = await advanceOrConflict(journeyRef, params.workspaceId, head.revision);
      if (advancedHead.ok === false) return { ok: false, conflict: advancedHead.conflict };
      const value: CredentialSelectionCommandValue = {
        selectionId,
        journeyId: payload.journeyId,
        credentialId: payload.credentialId,
        credentialVersionId,
        journeyRevision: advancedHead.revision,
      };
      const advanced: AdvancedRoot[] = [
        { aggregateRef: journeyRef, beforeRevision: head.revision, afterRevision: advancedHead.revision },
      ];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'CREDENTIAL_SELECTED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

const RemoveCredentialPayloadSchema = z.strictObject({
  journeyId: SubjectIdSchema,
  credentialId: SubjectIdSchema,
});

export interface RemoveCredentialSelectionParams extends CommandIdentity {
  journeyId: string;
  credentialId: string;
  expectedRevision: number;
  evidenceRefs?: string[];
}

/**
 * Withdraws the Journey's *use* of a document; the Traveller's credential row is
 * untouched, and a Journey is never deleted to shed a selection.
 */
export async function removeCredentialSelection(
  uow: UnitOfWork,
  params: RemoveCredentialSelectionParams,
): Promise<ExecuteOutcome<CredentialSelectionCommandValue>> {
  const parsed = RemoveCredentialPayloadSchema.safeParse({
    journeyId: params.journeyId,
    credentialId: params.credentialId,
  });
  if (!parsed.success) return rejectedPayload('CREDENTIAL_SELECTION_REMOVED', parsed.error);
  const payload = parsed.data;
  const journeyRef = refOf('JOURNEY', payload.journeyId);
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: 'CREDENTIAL_SELECTION_REMOVED',
    identity: params,
    payload,
    expectedAggregateRevisions: [{ aggregateRef: journeyRef, expectedRevision: params.expectedRevision }],
    evidenceRefs: params.evidenceRefs,
  });
  const journeys = new PgJourneyRepository();

  return guarded([journeyRef], () =>
    uow.execute<CredentialSelectionCommandValue>(envelope, async ({ lockedHeads }) => {
      const head = headOrConflict(lockedHeads, journeyRef);
      if (head.ok === false) return { ok: false, conflict: head.conflict };
      const existing = (await journeys.listCredentialSelections(params.workspaceId, payload.journeyId)).find(
        (selection) => selection.credentialId === payload.credentialId,
      );
      if (!existing) {
        return {
          ok: false,
          conflict: typedConflict(
            'VALIDATION_FAILED',
            `journey ${payload.journeyId} has no selection of credential ${payload.credentialId}`,
            [journeyRef],
          ),
        };
      }
      await journeys.removeCredentialSelection({
        workspaceId: params.workspaceId,
        journeyId: payload.journeyId,
        credentialId: payload.credentialId,
        actor,
      });
      const advancedHead = await advanceOrConflict(journeyRef, params.workspaceId, head.revision);
      if (advancedHead.ok === false) return { ok: false, conflict: advancedHead.conflict };
      const value: CredentialSelectionCommandValue = {
        selectionId: existing.id,
        journeyId: payload.journeyId,
        credentialId: payload.credentialId,
        credentialVersionId: existing.credentialVersionId,
        journeyRevision: advancedHead.revision,
      };
      const advanced: AdvancedRoot[] = [
        { aggregateRef: journeyRef, beforeRevision: head.revision, afterRevision: advancedHead.revision },
      ];
      await appendAuditTrail({
        envelope,
        advanced,
        destinationKind: 'CREDENTIAL_SELECTION_REMOVED',
        payload: value,
      });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}
