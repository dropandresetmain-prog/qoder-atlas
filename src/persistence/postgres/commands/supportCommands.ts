/**
 * NORTHSTAR v2 — coordination + accompaniment-support command handlers (M2 lane S).
 *
 * These are lane S's half of `docs/DATA_STRUCTURE_LOGICAL_SCHEMA.md` §11.1: the
 * command owns the transaction envelope, `PgUnitOfWork` owns idempotency and
 * revision locking, and the typed-row work is delegated to
 * `repositories/pgCoordinationRepository.ts` / `pgSupportRepository.ts`, which
 * contain no transaction logic at all. Structure mirrors the one accepted
 * precedent (`workspaceCommands.ts`) with the four shared steps lifted into
 * `commandSupport.ts`.
 *
 * Aggregate policy actually implemented from the 0026/0027/0028 DDL:
 *  - `COORDINATION_GROUP` and `SUPPORT_ASSIGNMENT` are root subjects: `createRoot`
 *    inserts `aggregate_heads` (revision 1) before `domain_subjects`, then the
 *    typed row, and each later mutation is a compare-and-set on that one counter.
 *  - An accompaniment requirement version advances **no** aggregate. 0027 gives
 *    `accompaniment_requirements` no `domain_subjects` FK and no subtype checker,
 *    `SubjectKindSchema` has no requirement kind, and the versioned key
 *    `(workspace_id, id, version)` plus `forbid_mutation` is the whole lifecycle
 *    story. So appending an edition is a pure append; the supported Traveller's
 *    head is deliberately *not* advanced (that would make one person's revision
 *    counter move because someone filed a rule about them). The gap this leaves —
 *    no `change_records`/`outbox` row for a requirement edition — is reported,
 *    not worked around; `command_receipts` still records the command durably.
 *
 * The requirement governs and the assignment fulfils: every assignment mutation
 * here is re-checked against the *pinned* edition with the domain's
 * `assignmentSatisfiesDefinition` (eligibility, coverage gaps, minimum
 * simultaneous supporters and handoff gap arithmetic all live there — none is
 * re-implemented), and no handler accepts a requirement field on an assignment
 * command, so the pin cannot be moved by construction.
 *
 * C1 amendment c: ids, normalized instants and whole domain objects are built
 * *before* `uow.execute`; the callback only reads and writes rows, so a
 * serializable replay of it is safe and there is no provider or irreversible
 * work inside.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  DomainCommandEnvelopeSchema,
  type DomainCommandEnvelope,
} from '../../../contracts/v2/command/domainCommand.ts';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import type { ExpectedRevision, SubjectId, TypedRef } from '../../../domain/v2/shared/identity.ts';
import { SubjectIdSchema } from '../../../domain/v2/shared/identity.ts';
import { InstantIntervalSchema, type Instant } from '../../../domain/v2/shared/time.ts';
import { typedConflict, type TypedConflict } from '../../../domain/v2/shared/errors.ts';
import { LifecycleStatusSchema, type CoordinationGroup, type GroupMembership } from '../../../domain/v2/trip/trip.ts';
import {
  AccompanimentConstraintDefinitionSchema,
  SupportAssignmentSchema,
  SupportHandoffSchema,
  assignmentSatisfiesDefinition,
  type AccompanimentConstraintDefinition,
  type SupportAssignment,
} from '../../../domain/v2/trip/support.ts';
import { PgCoordinationRepository } from '../repositories/pgCoordinationRepository.ts';
import { PgSupportRepository } from '../repositories/pgSupportRepository.ts';
import {
  advanceHead,
  appendAuditTrail,
  buildReceipt,
  createRoot,
  lockedRevisionOf,
  missingHeadConflict,
  staleRevisionConflict,
  type AdvancedRoot,
} from '../commandSupport.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';

const SCHEMA_VERSION = '1';

/** Half-open window pair; written together or not at all, as 0026's CHECK requires. */
const WindowSchema = InstantIntervalSchema;

const CreateCoordinationGroupPayloadSchema = z.strictObject({
  name: z.string().min(1),
  purpose: z.string().min(1).optional(),
  lifecycleStatus: LifecycleStatusSchema.default('DRAFT'),
  effectiveRange: WindowSchema.optional(),
});

const UpdateCoordinationGroupPayloadSchema = z.strictObject({
  name: z.string().min(1).optional(),
  /** Explicit null clears the purpose; omission leaves the column alone. */
  purpose: z.string().min(1).nullable().optional(),
  effectiveRange: WindowSchema.optional(),
  lifecycleStatus: LifecycleStatusSchema.optional(),
});

const GroupMembershipPayloadSchema = z.strictObject({
  effectiveRange: WindowSchema.optional(),
});

const AppendRequirementPayloadSchema = z.strictObject({
  supportedTravellerId: SubjectIdSchema,
  requiredCoverage: WindowSchema,
  minimumSimultaneousSupporters: z.number().int().min(1),
  eligibleSupporterTravellerIds: z.array(SubjectIdSchema).min(1),
  maximumHandoffGapMinutes: z.number().int().min(0).default(0),
  provenanceEvidenceId: SubjectIdSchema.optional(),
});

const AssignedScopePayloadSchema = z.strictObject({
  supporterTravellerId: SubjectIdSchema,
  interval: WindowSchema,
});

const CreateSupportAssignmentPayloadSchema = z.strictObject({
  requirementId: SubjectIdSchema,
  requirementVersion: z.number().int().min(1),
  /** A new assignment may only open as a proposal or as a live commitment. */
  lifecycleStatus: z.enum(['PROPOSED', 'ACTIVE']).default('PROPOSED'),
  assignedSupporterTravellerIds: z.array(SubjectIdSchema).min(1),
  assignedScopes: z.array(AssignedScopePayloadSchema).min(1),
  handoffs: z.array(SupportHandoffSchema).default([]),
});

const SetSupportAssignmentStatusPayloadSchema = z.strictObject({
  lifecycleStatus: SupportAssignmentSchema.shape.lifecycleStatus,
});

const ReplaceAssignmentScopePayloadSchema = z.strictObject({
  assignedSupporterTravellerIds: z.array(SubjectIdSchema).min(1),
  assignedScopes: z.array(AssignedScopePayloadSchema).min(1),
  handoffs: z.array(SupportHandoffSchema).default([]),
});

/** A group stops being a scope once it is completed or cancelled. */
const GROUP_LIFECYCLE_TRANSITIONS: Record<CoordinationGroup['lifecycleStatus'], CoordinationGroup['lifecycleStatus'][]> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

/** A withdrawn or superseded assignment is history; it never reactivates itself. */
const SUPPORT_LIFECYCLE_TRANSITIONS: Record<
  SupportAssignment['lifecycleStatus'],
  SupportAssignment['lifecycleStatus'][]
> = {
  PROPOSED: ['ACTIVE', 'WITHDRAWN'],
  ACTIVE: ['SUPERSEDED', 'WITHDRAWN'],
  SUPERSEDED: [],
  WITHDRAWN: [],
};

export interface CoordinationGroupCommandResult {
  workspaceId: string;
  groupId: string;
  revision: number;
}

export interface GroupMembershipCommandResult extends CoordinationGroupCommandResult {
  journeyId: string;
}

export interface SharedJourneyItemCommandResult extends CoordinationGroupCommandResult {
  journeyItemId: string;
}

export interface AccompanimentRequirementCommandResult {
  workspaceId: string;
  requirementId: string;
  /** Derived from the append-only edition counter, never supplied by the caller. */
  version: number;
}

export interface SupportAssignmentCommandResult {
  workspaceId: string;
  assignmentId: string;
  revision: number;
  requirementId: string;
  requirementVersion: number;
  lifecycleStatus: SupportAssignment['lifecycleStatus'];
}

export interface SupportCommandIdentity {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
}

function groupRef(groupId: string): TypedRef {
  return { kind: 'COORDINATION_GROUP', id: groupId };
}

function assignmentRef(assignmentId: string): TypedRef {
  return { kind: 'SUPPORT_ASSIGNMENT', id: assignmentId };
}

function requirementRef(requirementId: string): TypedRef {
  return { kind: 'CONSTRAINT_DEFINITION', id: requirementId };
}

/**
 * Normalizes an instant to the one string form the domain's interval arithmetic
 * relies on. `assignmentSatisfiesDefinition` compares coverage bounds
 * lexicographically and `pg` renders `timestamptz` back in UTC, so a caller
 * writing `+02:00` and a row read back as `...Z` must not both reach the check.
 */
function asUtc(instant: string): Instant {
  return new Date(instant).toISOString();
}

function utcWindow(window: z.infer<typeof WindowSchema>) {
  return { start: asUtc(window.start), end: asUtc(window.end) };
}

function buildEnvelope(params: {
  commandType: string;
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
  payload: unknown;
  expectedAggregateRevisions?: ExpectedRevision[];
}): DomainCommandEnvelope {
  return DomainCommandEnvelopeSchema.parse({
    commandType: params.commandType,
    schemaVersion: SCHEMA_VERSION,
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(params.payload),
    expectedAggregateRevisions: params.expectedAggregateRevisions ?? [],
    typedPayload: params.payload,
  });
}

function validationConflict(message: string, subjectRefs: TypedRef[] = []): TypedConflict {
  return typedConflict('VALIDATION_FAILED', message, subjectRefs);
}

/**
 * The typed rejection for "this fulfilment does not meet the edition it pins".
 * The reasons are the domain's own words — this handler adds none — so the
 * caller sees exactly which coverage/min-count/eligibility/handoff rule failed.
 */
function requirementNotSatisfiedConflict(
  assignment: SupportAssignment,
  definition: AccompanimentConstraintDefinition,
  reasons: string[],
): TypedConflict {
  return typedConflict(
    'REQUIREMENT_WOULD_BE_RELAXED',
    `support assignment ${assignment.id} does not satisfy accompaniment requirement ${definition.id} v${definition.version}: ${reasons.join('; ')}`,
    [assignmentRef(assignment.id), requirementRef(definition.id)],
    { reasons, requirementId: definition.id, requirementVersion: definition.version },
  );
}

// --------------------------------------------------------------------------------------
// Coordination groups
// --------------------------------------------------------------------------------------

export interface CreateCoordinationGroupParams extends SupportCommandIdentity {
  /** Client-generated per §1 ("Domain identity uses UUIDs"); defaults to a fresh UUID. */
  groupId?: string;
  name: string;
  purpose?: string;
  lifecycleStatus?: z.input<typeof LifecycleStatusSchema>;
  effectiveRange?: z.input<typeof WindowSchema>;
}

export async function createCoordinationGroup(
  uow: UnitOfWork,
  params: CreateCoordinationGroupParams,
): Promise<ExecuteOutcome<CoordinationGroupCommandResult>> {
  const payload = CreateCoordinationGroupPayloadSchema.parse({
    name: params.name,
    ...(params.purpose === undefined ? {} : { purpose: params.purpose }),
    ...(params.lifecycleStatus === undefined ? {} : { lifecycleStatus: params.lifecycleStatus }),
    ...(params.effectiveRange === undefined ? {} : { effectiveRange: utcWindow(params.effectiveRange) }),
  });
  const groupId = params.groupId ?? randomUUID();
  const group: CoordinationGroup = {
    id: groupId,
    workspaceId: params.workspaceId,
    revision: 1,
    name: payload.name,
    lifecycleStatus: payload.lifecycleStatus,
    ...(payload.effectiveRange === undefined ? {} : { effectiveRange: payload.effectiveRange }),
  };

  const envelope = buildEnvelope({
    commandType: 'COORDINATION_GROUP_CREATED',
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    payload,
  });
  const repository = new PgCoordinationRepository(params.workspaceId);
  const actor = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };

  return uow.execute<CoordinationGroupCommandResult>(envelope, async () => {
    if (await repository.loadGroup(params.workspaceId, groupId)) {
      return {
        ok: false,
        conflict: typedConflict(
          'DUPLICATE_REGISTRATION',
          `coordination group ${groupId} already exists`,
          [groupRef(groupId)],
        ),
      };
    }
    await createRoot({ workspaceId: params.workspaceId, id: groupId, kind: 'COORDINATION_GROUP' });
    await repository.createGroup({ group, ...(payload.purpose === undefined ? {} : { purpose: payload.purpose }), actor });

    const advanced: AdvancedRoot[] = [
      { aggregateRef: groupRef(groupId), beforeRevision: null, afterRevision: 1 },
    ];
    const value: CoordinationGroupCommandResult = { workspaceId: params.workspaceId, groupId, revision: 1 };
    await appendAuditTrail({ envelope, advanced, destinationKind: 'COORDINATION_GROUP_CREATED', payload: value });
    return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
  });
}

export interface UpdateCoordinationGroupParams extends SupportCommandIdentity {
  groupId: string;
  expectedRevision: number;
  name?: string;
  purpose?: string | null;
  effectiveRange?: z.input<typeof WindowSchema>;
  lifecycleStatus?: z.input<typeof LifecycleStatusSchema>;
}

export async function updateCoordinationGroup(
  uow: UnitOfWork,
  params: UpdateCoordinationGroupParams,
): Promise<ExecuteOutcome<CoordinationGroupCommandResult>> {
  const payload = UpdateCoordinationGroupPayloadSchema.parse({
    ...(params.name === undefined ? {} : { name: params.name }),
    ...(params.purpose === undefined ? {} : { purpose: params.purpose }),
    ...(params.effectiveRange === undefined ? {} : { effectiveRange: utcWindow(params.effectiveRange) }),
    ...(params.lifecycleStatus === undefined ? {} : { lifecycleStatus: params.lifecycleStatus }),
  });
  if (Object.keys(payload).length === 0) {
    return { ok: false, conflict: validationConflict('COORDINATION_GROUP_UPDATED carries no change') };
  }
  const ref = groupRef(params.groupId);

  const envelope = buildEnvelope({
    commandType: 'COORDINATION_GROUP_UPDATED',
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    payload,
    expectedAggregateRevisions: [{ aggregateRef: ref, expectedRevision: params.expectedRevision }],
  });
  const repository = new PgCoordinationRepository(params.workspaceId);
  const actor = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };

  return uow.execute<CoordinationGroupCommandResult>(envelope, async ({ lockedHeads }) => {
    const beforeRevision = lockedRevisionOf(lockedHeads, params.groupId);
    if (beforeRevision === undefined) return { ok: false, conflict: missingHeadConflict(ref) };
    const current = await repository.loadGroup(params.workspaceId, params.groupId);
    if (!current) {
      return { ok: false, conflict: validationConflict(`coordination group ${params.groupId} has no typed row`, [ref]) };
    }
    if (payload.lifecycleStatus !== undefined && !GROUP_LIFECYCLE_TRANSITIONS[current.lifecycleStatus].includes(payload.lifecycleStatus)) {
      return {
        ok: false,
        conflict: validationConflict(
          `illegal coordination group lifecycle transition ${current.lifecycleStatus} -> ${payload.lifecycleStatus}`,
          [ref],
        ),
      };
    }

    await repository.updateGroup({
      workspaceId: params.workspaceId,
      groupId: params.groupId,
      ...(payload.name === undefined ? {} : { name: payload.name }),
      ...(payload.purpose === undefined ? {} : { purpose: payload.purpose }),
      ...(payload.effectiveRange === undefined ? {} : { effectiveRange: payload.effectiveRange }),
      ...(payload.lifecycleStatus === undefined ? {} : { lifecycleStatus: payload.lifecycleStatus }),
      actor,
    });
    const afterRevision = await advanceHead({
      workspaceId: params.workspaceId,
      aggregateId: params.groupId,
      fromRevision: beforeRevision,
    });
    if (afterRevision === undefined) return { ok: false, conflict: staleRevisionConflict(ref, beforeRevision) };

    const advanced: AdvancedRoot[] = [{ aggregateRef: ref, beforeRevision, afterRevision }];
    const value: CoordinationGroupCommandResult = {
      workspaceId: params.workspaceId,
      groupId: params.groupId,
      revision: afterRevision,
    };
    await appendAuditTrail({ envelope, advanced, destinationKind: 'COORDINATION_GROUP_UPDATED', payload: value });
    return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
  });
}

/**
 * Adding a Journey to a group is a scope decision by the group, so the group's
 * head advances. It is not a relationship, a responsibility or an authority:
 * F05 keeps those in 0018/0019 and nothing here touches them.
 */
export interface AddJourneyToGroupParams extends SupportCommandIdentity {
  groupId: string;
  journeyId: string;
  effectiveRange?: z.input<typeof WindowSchema>;
  expectedRevision: number;
}

export async function addJourneyToGroup(
  uow: UnitOfWork,
  params: AddJourneyToGroupParams,
): Promise<ExecuteOutcome<GroupMembershipCommandResult>> {
  const payload = GroupMembershipPayloadSchema.parse(
    params.effectiveRange === undefined ? {} : { effectiveRange: utcWindow(params.effectiveRange) },
  );
  const ref = groupRef(params.groupId);
  const membership: GroupMembership = {
    id: randomUUID(),
    coordinationGroupId: params.groupId,
    journeyId: params.journeyId,
    ...(payload.effectiveRange === undefined ? {} : { effectiveRange: payload.effectiveRange }),
  };

  const envelope = buildEnvelope({
    commandType: 'COORDINATION_GROUP_JOURNEY_ADDED',
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    payload: { ...payload, journeyId: params.journeyId, membershipId: membership.id },
    expectedAggregateRevisions: [{ aggregateRef: ref, expectedRevision: params.expectedRevision }],
  });
  const repository = new PgCoordinationRepository(params.workspaceId);
  const actor = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };

  return uow.execute<GroupMembershipCommandResult>(envelope, async ({ lockedHeads }) => {
    const beforeRevision = lockedRevisionOf(lockedHeads, params.groupId);
    if (beforeRevision === undefined) return { ok: false, conflict: missingHeadConflict(ref) };
    const group = await repository.loadGroup(params.workspaceId, params.groupId);
    if (!group) {
      return { ok: false, conflict: validationConflict(`coordination group ${params.groupId} has no typed row`, [ref]) };
    }
    if (group.lifecycleStatus === 'COMPLETED' || group.lifecycleStatus === 'CANCELLED') {
      return {
        ok: false,
        conflict: validationConflict(
          `coordination group ${params.groupId} is ${group.lifecycleStatus} and cannot take a new participant`,
          [ref],
        ),
      };
    }
    const existing = await repository.listMemberships(params.workspaceId, params.groupId);
    if (existing.some((row) => row.journeyId === params.journeyId)) {
      return {
        ok: false,
        conflict: typedConflict(
          'DUPLICATE_REGISTRATION',
          `journey ${params.journeyId} is already a member of coordination group ${params.groupId}`,
          [ref],
        ),
      };
    }

    await repository.addMembership({ membership, actor });
    const afterRevision = await advanceHead({
      workspaceId: params.workspaceId,
      aggregateId: params.groupId,
      fromRevision: beforeRevision,
    });
    if (afterRevision === undefined) return { ok: false, conflict: staleRevisionConflict(ref, beforeRevision) };

    const advanced: AdvancedRoot[] = [{ aggregateRef: ref, beforeRevision, afterRevision }];
    const value: GroupMembershipCommandResult = {
      workspaceId: params.workspaceId,
      groupId: params.groupId,
      revision: afterRevision,
      journeyId: params.journeyId,
    };
    await appendAuditTrail({ envelope, advanced, destinationKind: 'COORDINATION_GROUP_JOURNEY_ADDED', payload: value });
    return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
  });
}

export interface RemoveJourneyFromGroupParams extends SupportCommandIdentity {
  groupId: string;
  journeyId: string;
  expectedRevision: number;
}

export async function removeJourneyFromGroup(
  uow: UnitOfWork,
  params: RemoveJourneyFromGroupParams,
): Promise<ExecuteOutcome<GroupMembershipCommandResult>> {
  const payload = z.strictObject({ journeyId: SubjectIdSchema }).parse({ journeyId: params.journeyId });
  const ref = groupRef(params.groupId);

  const envelope = buildEnvelope({
    commandType: 'COORDINATION_GROUP_JOURNEY_REMOVED',
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    payload,
    expectedAggregateRevisions: [{ aggregateRef: ref, expectedRevision: params.expectedRevision }],
  });
  const repository = new PgCoordinationRepository(params.workspaceId);
  const actor = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };

  return uow.execute<GroupMembershipCommandResult>(envelope, async ({ lockedHeads }) => {
    const beforeRevision = lockedRevisionOf(lockedHeads, params.groupId);
    if (beforeRevision === undefined) return { ok: false, conflict: missingHeadConflict(ref) };
    const existing = await repository.listMemberships(params.workspaceId, params.groupId);
    if (!existing.some((row) => row.journeyId === params.journeyId)) {
      return {
        ok: false,
        conflict: validationConflict(
          `coordination group ${params.groupId} has no membership for journey ${params.journeyId}`,
          [ref],
        ),
      };
    }

    await repository.removeMembership({
      workspaceId: params.workspaceId,
      groupId: params.groupId,
      journeyId: params.journeyId,
      actor,
    });
    const afterRevision = await advanceHead({
      workspaceId: params.workspaceId,
      aggregateId: params.groupId,
      fromRevision: beforeRevision,
    });
    if (afterRevision === undefined) return { ok: false, conflict: staleRevisionConflict(ref, beforeRevision) };

    const advanced: AdvancedRoot[] = [{ aggregateRef: ref, beforeRevision, afterRevision }];
    const value: GroupMembershipCommandResult = {
      workspaceId: params.workspaceId,
      groupId: params.groupId,
      revision: afterRevision,
      journeyId: params.journeyId,
    };
    await appendAuditTrail({
      envelope,
      advanced,
      destinationKind: 'COORDINATION_GROUP_JOURNEY_REMOVED',
      payload: value,
    });
    return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
  });
}

/**
 * Sharing one JourneyItem narrows the membership's scope; it does not create a
 * second coordination identity. 0026's deferred ownership trigger is what proves
 * the item belongs to the membership's own Journey, so a link into another
 * traveller's itinerary cannot commit however this handler is written.
 */
export interface ShareJourneyItemParams extends SupportCommandIdentity {
  groupId: string;
  journeyId: string;
  journeyItemId: string;
  expectedRevision: number;
}

export async function shareJourneyItem(
  uow: UnitOfWork,
  params: ShareJourneyItemParams,
): Promise<ExecuteOutcome<SharedJourneyItemCommandResult>> {
  const payload = z
    .strictObject({ journeyId: SubjectIdSchema, journeyItemId: SubjectIdSchema })
    .parse({ journeyId: params.journeyId, journeyItemId: params.journeyItemId });
  const ref = groupRef(params.groupId);

  const envelope = buildEnvelope({
    commandType: 'COORDINATION_GROUP_ITEM_SHARED',
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    payload,
    expectedAggregateRevisions: [{ aggregateRef: ref, expectedRevision: params.expectedRevision }],
  });
  const repository = new PgCoordinationRepository(params.workspaceId);
  const actor = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };

  return uow.execute<SharedJourneyItemCommandResult>(envelope, async ({ lockedHeads }) => {
    const beforeRevision = lockedRevisionOf(lockedHeads, params.groupId);
    if (beforeRevision === undefined) return { ok: false, conflict: missingHeadConflict(ref) };
    const memberships = await repository.listMemberships(params.workspaceId, params.groupId);
    const membership = memberships.find((row) => row.journeyId === params.journeyId);
    if (!membership) {
      return {
        ok: false,
        conflict: validationConflict(
          `coordination group ${params.groupId} has no membership for journey ${params.journeyId}; share an item only through a member Journey`,
          [ref],
        ),
      };
    }
    if ((membership.scopeItemIds ?? []).includes(params.journeyItemId)) {
      return {
        ok: false,
        conflict: typedConflict(
          'DUPLICATE_REGISTRATION',
          `journey item ${params.journeyItemId} is already shared in coordination group ${params.groupId}`,
          [ref],
        ),
      };
    }

    await repository.addMembership({
      membership: { ...membership, scopeItemIds: [...(membership.scopeItemIds ?? []), params.journeyItemId] },
      actor,
    });
    const afterRevision = await advanceHead({
      workspaceId: params.workspaceId,
      aggregateId: params.groupId,
      fromRevision: beforeRevision,
    });
    if (afterRevision === undefined) return { ok: false, conflict: staleRevisionConflict(ref, beforeRevision) };

    const advanced: AdvancedRoot[] = [{ aggregateRef: ref, beforeRevision, afterRevision }];
    const value: SharedJourneyItemCommandResult = {
      workspaceId: params.workspaceId,
      groupId: params.groupId,
      revision: afterRevision,
      journeyItemId: params.journeyItemId,
    };
    await appendAuditTrail({ envelope, advanced, destinationKind: 'COORDINATION_GROUP_ITEM_SHARED', payload: value });
    return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
  });
}

// --------------------------------------------------------------------------------------
// Accompaniment requirements (append-only editions)
// --------------------------------------------------------------------------------------

export interface AppendAccompanimentRequirementParams extends SupportCommandIdentity {
  /**
   * The requirement the new edition belongs to. Omitting it starts a brand-new
   * requirement at version 1; passing an existing id appends the next edition.
   */
  requirementId?: SubjectId;
  supportedTravellerId: string;
  requiredCoverage: z.input<typeof WindowSchema>;
  minimumSimultaneousSupporters: number;
  eligibleSupporterTravellerIds: string[];
  maximumHandoffGapMinutes?: number;
  provenanceEvidenceId?: string;
}

/**
 * Appends one immutable edition. The version is read from the append-only key
 * inside the transaction (`max + 1`), never trusted from the caller: under
 * SERIALIZABLE a concurrent append either conflicts or retries, so two commands
 * cannot both claim one edition. Nothing here advances a head — see the file
 * header's aggregate-policy note.
 */
export async function appendAccompanimentRequirement(
  uow: UnitOfWork,
  params: AppendAccompanimentRequirementParams,
): Promise<ExecuteOutcome<AccompanimentRequirementCommandResult>> {
  const payload = AppendRequirementPayloadSchema.parse({
    supportedTravellerId: params.supportedTravellerId,
    requiredCoverage: utcWindow(params.requiredCoverage),
    minimumSimultaneousSupporters: params.minimumSimultaneousSupporters,
    eligibleSupporterTravellerIds: [...new Set(params.eligibleSupporterTravellerIds)],
    ...(params.maximumHandoffGapMinutes === undefined ? {} : { maximumHandoffGapMinutes: params.maximumHandoffGapMinutes }),
    ...(params.provenanceEvidenceId === undefined ? {} : { provenanceEvidenceId: params.provenanceEvidenceId }),
  });
  const requirementId = params.requirementId ?? randomUUID();

  const envelope = buildEnvelope({
    commandType: 'ACCOMPANIMENT_REQUIREMENT_APPENDED',
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    payload: { ...payload, requirementId },
  });
  const repository = new PgSupportRepository(params.workspaceId);
  const actor = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };

  return uow.execute<AccompanimentRequirementCommandResult>(envelope, async () => {
    const latest = await repository.latestRequirementVersion(params.workspaceId, requirementId);
    const requirement = AccompanimentConstraintDefinitionSchema.parse({
      id: requirementId,
      version: (latest?.version ?? 0) + 1,
      supportedTravellerId: payload.supportedTravellerId,
      requiredCoverage: payload.requiredCoverage,
      minimumSimultaneousSupporters: payload.minimumSimultaneousSupporters,
      eligibleSupporterTravellerIds: payload.eligibleSupporterTravellerIds,
      maximumHandoffGapMinutes: payload.maximumHandoffGapMinutes,
      ...(payload.provenanceEvidenceId === undefined ? {} : { provenanceEvidenceId: payload.provenanceEvidenceId }),
    });
    await repository.appendRequirement({ requirement, actor });

    const value: AccompanimentRequirementCommandResult = {
      workspaceId: params.workspaceId,
      requirementId,
      version: requirement.version,
    };
    // No root advanced this edition: 0027 registers requirements outside the
    // subject/head registry, so `appendAuditTrail` (which is per advanced root)
    // has nothing to record. The `command_receipts` row written by the UnitOfWork
    // is the durable record of this command.
    return {
      ok: true,
      value,
      receipt: buildReceipt({ envelope, value, advanced: [] }),
    };
  });
}

// --------------------------------------------------------------------------------------
// Support assignments (selected fulfilment inside a pinned edition)
// --------------------------------------------------------------------------------------

export interface CreateSupportAssignmentParams extends SupportCommandIdentity {
  assignmentId?: SubjectId;
  requirementId: SubjectId;
  requirementVersion: number;
  lifecycleStatus?: 'PROPOSED' | 'ACTIVE';
  assignedSupporterTravellerIds: string[];
  assignedScopes: { supporterTravellerId: string; interval: z.input<typeof WindowSchema> }[];
  handoffs?: z.input<typeof SupportHandoffSchema>[];
}

export async function createSupportAssignment(
  uow: UnitOfWork,
  params: CreateSupportAssignmentParams,
): Promise<ExecuteOutcome<SupportAssignmentCommandResult>> {
  const payload = CreateSupportAssignmentPayloadSchema.parse({
    requirementId: params.requirementId,
    requirementVersion: params.requirementVersion,
    ...(params.lifecycleStatus === undefined ? {} : { lifecycleStatus: params.lifecycleStatus }),
    assignedSupporterTravellerIds: [...new Set(params.assignedSupporterTravellerIds)],
    assignedScopes: params.assignedScopes.map((scope) => ({
      supporterTravellerId: scope.supporterTravellerId,
      interval: utcWindow(scope.interval),
    })),
    ...(params.handoffs === undefined
      ? {}
      : { handoffs: params.handoffs.map((handoff) => ({ ...handoff, handoffAt: asUtc(handoff.handoffAt) })) }),
  });
  const assignmentId = params.assignmentId ?? randomUUID();
  const ref = assignmentRef(assignmentId);
  const assignment: SupportAssignment = SupportAssignmentSchema.parse({
    id: assignmentId,
    revision: 1,
    constraintDefinitionId: payload.requirementId,
    constraintDefinitionVersion: payload.requirementVersion,
    lifecycleStatus: payload.lifecycleStatus,
    assignedSupporterTravellerIds: payload.assignedSupporterTravellerIds,
    assignedScopes: payload.assignedScopes,
    handoffs: payload.handoffs,
  });

  const envelope = buildEnvelope({
    commandType: 'SUPPORT_ASSIGNMENT_CREATED',
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    payload,
  });
  const repository = new PgSupportRepository(params.workspaceId);
  const actor = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };

  return uow.execute<SupportAssignmentCommandResult>(envelope, async () => {
    if (await repository.loadAssignment(params.workspaceId, assignmentId)) {
      return {
        ok: false,
        conflict: typedConflict('DUPLICATE_REGISTRATION', `support assignment ${assignmentId} already exists`, [ref]),
      };
    }
    const definition = await repository.loadRequirement(
      params.workspaceId,
      assignment.constraintDefinitionId,
      assignment.constraintDefinitionVersion,
    );
    if (!definition) {
      return {
        ok: false,
        conflict: validationConflict(
          `accompaniment requirement ${assignment.constraintDefinitionId} v${assignment.constraintDefinitionVersion} does not exist — an assignment pins an edition that must already be recorded`,
          [requirementRef(assignment.constraintDefinitionId), ref],
        ),
      };
    }
    const check = assignmentSatisfiesDefinition(assignment, definition);
    if (!check.ok) {
      return { ok: false, conflict: requirementNotSatisfiedConflict(assignment, definition, check.reasons) };
    }

    await createRoot({ workspaceId: params.workspaceId, id: assignmentId, kind: 'SUPPORT_ASSIGNMENT' });
    await repository.createAssignment({ assignment, actor });

    const advanced: AdvancedRoot[] = [{ aggregateRef: ref, beforeRevision: null, afterRevision: 1 }];
    const value = assignmentResult(params.workspaceId, assignment, 1);
    await appendAuditTrail({ envelope, advanced, destinationKind: 'SUPPORT_ASSIGNMENT_CREATED', payload: value });
    return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
  });
}

export interface SetSupportAssignmentStatusParams extends SupportCommandIdentity {
  assignmentId: SubjectId;
  lifecycleStatus: SupportAssignment['lifecycleStatus'];
  expectedRevision: number;
}

/**
 * Lifecycle only. Becoming `ACTIVE` is the moment a fulfilment is relied upon, so
 * it is re-checked against the pinned edition; withdrawing needs no coverage
 * claim and simply stops the commitment — the requirement itself is untouched
 * and remains exactly as demanding as it was.
 */
export async function setSupportAssignmentStatus(
  uow: UnitOfWork,
  params: SetSupportAssignmentStatusParams,
): Promise<ExecuteOutcome<SupportAssignmentCommandResult>> {
  const payload = SetSupportAssignmentStatusPayloadSchema.parse({ lifecycleStatus: params.lifecycleStatus });
  const ref = assignmentRef(params.assignmentId);

  const envelope = buildEnvelope({
    commandType: 'SUPPORT_ASSIGNMENT_STATUS_CHANGED',
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    payload,
    expectedAggregateRevisions: [{ aggregateRef: ref, expectedRevision: params.expectedRevision }],
  });
  const repository = new PgSupportRepository(params.workspaceId);
  const actor = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };

  return uow.execute<SupportAssignmentCommandResult>(envelope, async ({ lockedHeads }) => {
    const beforeRevision = lockedRevisionOf(lockedHeads, params.assignmentId);
    if (beforeRevision === undefined) return { ok: false, conflict: missingHeadConflict(ref) };
    const current = await repository.loadAssignment(params.workspaceId, params.assignmentId);
    if (!current) {
      return {
        ok: false,
        conflict: validationConflict(`support assignment ${params.assignmentId} has no typed row`, [ref]),
      };
    }
    if (!SUPPORT_LIFECYCLE_TRANSITIONS[current.lifecycleStatus].includes(payload.lifecycleStatus)) {
      return {
        ok: false,
        conflict: validationConflict(
          `illegal support assignment lifecycle transition ${current.lifecycleStatus} -> ${payload.lifecycleStatus}`,
          [ref],
        ),
      };
    }
    if (payload.lifecycleStatus === 'ACTIVE') {
      const satisfied = await satisfyCheck(repository, params.workspaceId, { ...current, lifecycleStatus: 'ACTIVE' });
      if (!satisfied.ok) return { ok: false, conflict: satisfied.conflict };
    }

    await repository.setAssignmentStatus({
      workspaceId: params.workspaceId,
      assignmentId: params.assignmentId,
      lifecycleStatus: payload.lifecycleStatus,
      actor,
    });
    const afterRevision = await advanceHead({
      workspaceId: params.workspaceId,
      aggregateId: params.assignmentId,
      fromRevision: beforeRevision,
    });
    if (afterRevision === undefined) return { ok: false, conflict: staleRevisionConflict(ref, beforeRevision) };

    const advanced: AdvancedRoot[] = [{ aggregateRef: ref, beforeRevision, afterRevision }];
    const value = assignmentResult(params.workspaceId, { ...current, lifecycleStatus: payload.lifecycleStatus }, afterRevision);
    await appendAuditTrail({
      envelope,
      advanced,
      destinationKind: 'SUPPORT_ASSIGNMENT_STATUS_CHANGED',
      payload: value,
    });
    return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
  });
}

export interface ReplaceSupportAssignmentScopeParams extends SupportCommandIdentity {
  assignmentId: SubjectId;
  assignedSupporterTravellerIds: string[];
  assignedScopes: { supporterTravellerId: string; interval: z.input<typeof WindowSchema> }[];
  handoffs?: z.input<typeof SupportHandoffSchema>[];
  expectedRevision: number;
}

/**
 * Re-choosing the fulfilment never re-chooses the demand: the command carries no
 * requirement field, the check runs against the edition already pinned, and a
 * proposed scope set that covers less than that edition is rejected with the
 * domain's own reasons.
 */
export async function replaceSupportAssignmentScope(
  uow: UnitOfWork,
  params: ReplaceSupportAssignmentScopeParams,
): Promise<ExecuteOutcome<SupportAssignmentCommandResult>> {
  const payload = ReplaceAssignmentScopePayloadSchema.parse({
    assignedSupporterTravellerIds: [...new Set(params.assignedSupporterTravellerIds)],
    assignedScopes: params.assignedScopes.map((scope) => ({
      supporterTravellerId: scope.supporterTravellerId,
      interval: utcWindow(scope.interval),
    })),
    ...(params.handoffs === undefined
      ? {}
      : { handoffs: params.handoffs.map((handoff) => ({ ...handoff, handoffAt: asUtc(handoff.handoffAt) })) }),
  });
  const ref = assignmentRef(params.assignmentId);

  const envelope = buildEnvelope({
    commandType: 'SUPPORT_ASSIGNMENT_SCOPE_REPLACED',
    workspaceId: params.workspaceId,
    actorPrincipalId: params.actorPrincipalId,
    idempotencyKey: params.idempotencyKey,
    payload,
    expectedAggregateRevisions: [{ aggregateRef: ref, expectedRevision: params.expectedRevision }],
  });
  const repository = new PgSupportRepository(params.workspaceId);
  const actor = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };

  return uow.execute<SupportAssignmentCommandResult>(envelope, async ({ lockedHeads }) => {
    const beforeRevision = lockedRevisionOf(lockedHeads, params.assignmentId);
    if (beforeRevision === undefined) return { ok: false, conflict: missingHeadConflict(ref) };
    const current = await repository.loadAssignment(params.workspaceId, params.assignmentId);
    if (!current) {
      return {
        ok: false,
        conflict: validationConflict(`support assignment ${params.assignmentId} has no typed row`, [ref]),
      };
    }
    const candidate = SupportAssignmentSchema.parse({
      ...current,
      revision: beforeRevision,
      assignedSupporterTravellerIds: payload.assignedSupporterTravellerIds,
      assignedScopes: payload.assignedScopes,
      handoffs: payload.handoffs,
    });
    const satisfied = await satisfyCheck(repository, params.workspaceId, candidate);
    if (!satisfied.ok) return { ok: false, conflict: satisfied.conflict };

    await repository.replaceAssignmentScope({
      workspaceId: params.workspaceId,
      assignmentId: params.assignmentId,
      assignedSupporterTravellerIds: candidate.assignedSupporterTravellerIds,
      assignedScopes: candidate.assignedScopes,
      handoffs: candidate.handoffs,
      actor,
    });
    const afterRevision = await advanceHead({
      workspaceId: params.workspaceId,
      aggregateId: params.assignmentId,
      fromRevision: beforeRevision,
    });
    if (afterRevision === undefined) return { ok: false, conflict: staleRevisionConflict(ref, beforeRevision) };

    const advanced: AdvancedRoot[] = [{ aggregateRef: ref, beforeRevision, afterRevision }];
    const value = assignmentResult(params.workspaceId, { ...candidate, revision: afterRevision }, afterRevision);
    await appendAuditTrail({
      envelope,
      advanced,
      destinationKind: 'SUPPORT_ASSIGNMENT_SCOPE_REPLACED',
      payload: value,
    });
    return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
  });
}

async function satisfyCheck(
  repository: PgSupportRepository,
  workspaceId: string,
  assignment: SupportAssignment,
): Promise<{ ok: true } | { ok: false; conflict: TypedConflict }> {
  const definition = await repository.loadRequirement(
    workspaceId,
    assignment.constraintDefinitionId,
    assignment.constraintDefinitionVersion,
  );
  if (!definition) {
    return {
      ok: false,
      conflict: validationConflict(
        `accompaniment requirement ${assignment.constraintDefinitionId} v${assignment.constraintDefinitionVersion} is no longer readable`,
        [requirementRef(assignment.constraintDefinitionId), assignmentRef(assignment.id)],
      ),
    };
  }
  const check = assignmentSatisfiesDefinition(assignment, definition);
  return check.ok ? { ok: true } : { ok: false, conflict: requirementNotSatisfiedConflict(assignment, definition, check.reasons) };
}

function assignmentResult(
  workspaceId: string,
  assignment: SupportAssignment,
  revision: number,
): SupportAssignmentCommandResult {
  return {
    workspaceId,
    assignmentId: assignment.id,
    revision,
    requirementId: assignment.constraintDefinitionId,
    requirementVersion: assignment.constraintDefinitionVersion,
    lifecycleStatus: assignment.lifecycleStatus,
  };
}
