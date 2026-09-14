/**
 * NORTHSTAR v2 — Place / GeographicArea / Jurisdiction command handlers over
 * `PgUnitOfWork` (M4 lane). Same shape as `programmeCommands.ts`/M2's
 * `travelCommands.ts`.
 *
 * Place and Jurisdiction are registered root subjects (PLACE/JURISDICTION)
 * but the frozen `PlaceSchema`/`JurisdictionSchema`
 * (src/domain/v2/programmes/programme.ts) carry no `revision` field — they are
 * create-once identities in M4's scope, so their additive children
 * (place_external_refs/place_associations/jurisdiction_areas) are appended
 * without an expected-revision gate. GeographicArea *does* carry `revision`
 * (added additively, CONTRACTS.md §7) because adding a geometry edition is a
 * real state change of the area root that a concurrent second edition must
 * not silently race.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainCommandEnvelopeSchema, type DomainCommandEnvelope } from '../../../contracts/v2/command/domainCommand.ts';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import type { ActorContext } from '../../../contracts/v2/repository/people.ts';
import { SubjectIdSchema, type ExpectedRevision, type RootRevision, type TypedRef } from '../../../domain/v2/shared/identity.ts';
import { typedConflict, type TypedConflict } from '../../../domain/v2/shared/errors.ts';
import {
  PlaceSchema,
  GeographicAreaSchema,
  GeographicAreaVersionSchema,
  JurisdictionSchema,
  type Place,
  type GeographicArea,
  type Jurisdiction,
} from '../../../domain/v2/programmes/programme.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import { advanceHead, appendAuditTrail, buildReceipt, createRoot, lockedRevisionOf, missingHeadConflict, staleRevisionConflict, type AdvancedRoot } from '../commandSupport.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';
import { PgPlaceRepository, PgGeographyRepository } from '../repositories/pgGeographyRepository.ts';

const SCHEMA_VERSION = '1';

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
      `${commandType} payload rejected: ${malformed.map((r) => `${r.kind}:${JSON.stringify(r.id)}`).join(', ')} not a valid subject id`,
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

// --- Place commands --------------------------------------------------------

const CreatePlacePayloadSchema = z.strictObject({
  name: z.string().min(1),
  placeType: z.string().min(1),
  timeZone: z.string().min(1),
  coordinates: z.strictObject({ lat: z.number(), lng: z.number() }).optional(),
});

export interface CreatePlaceParams extends CommandIdentity {
  name: string;
  placeType: string;
  timeZone: string;
  coordinates?: { lat: number; lng: number };
  placeId?: string;
  evidenceRefs?: string[];
}

export interface PlaceCommandValue {
  placeId: string;
}

export async function createPlace(uow: UnitOfWork, params: CreatePlaceParams): Promise<ExecuteOutcome<PlaceCommandValue>> {
  const parsed = CreatePlacePayloadSchema.safeParse({
    name: params.name,
    placeType: params.placeType,
    timeZone: params.timeZone,
    ...(params.coordinates ? { coordinates: params.coordinates } : {}),
  });
  if (!parsed.success) return rejectedPayload('PLACE_CREATED', parsed.error);
  const payload = parsed.data;
  const placeId = params.placeId ?? randomUUID();
  const placeRef = refOf('PLACE', placeId);
  const refused = refusedSubjectRefs('PLACE_CREATED', [placeRef]);
  if (refused) return refused;
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({ commandType: 'PLACE_CREATED', identity: params, payload, evidenceRefs: params.evidenceRefs });
  const places = new PgPlaceRepository();

  return guarded([placeRef], () =>
    uow.execute<PlaceCommandValue>(envelope, async () => {
      const place: Place = PlaceSchema.parse({
        id: placeId,
        name: payload.name,
        placeType: payload.placeType,
        timeZone: payload.timeZone,
        ...(payload.coordinates ? { coordinates: payload.coordinates } : {}),
      });
      await createRoot({ workspaceId: params.workspaceId, id: placeId, kind: 'PLACE' });
      await places.create({ place, actor });
      const value: PlaceCommandValue = { placeId };
      const advanced: AdvancedRoot[] = [{ aggregateRef: placeRef, beforeRevision: null, afterRevision: 1 }];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'PLACE_CREATED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

export interface AddPlaceExternalRefParams extends CommandIdentity {
  placeId: string;
  providerNamespace: string;
  externalKey: string;
  refId?: string;
  evidenceRefs?: string[];
}

export async function addPlaceExternalRef(
  uow: UnitOfWork,
  params: AddPlaceExternalRefParams,
): Promise<ExecuteOutcome<{ refId: string; placeId: string }>> {
  const refId = params.refId ?? randomUUID();
  const placeRef = refOf('PLACE', params.placeId);
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: 'PLACE_EXTERNAL_REF_ADDED',
    identity: params,
    payload: { placeId: params.placeId, providerNamespace: params.providerNamespace, externalKey: params.externalKey },
    evidenceRefs: params.evidenceRefs,
  });
  const places = new PgPlaceRepository();

  return guarded([placeRef], () =>
    uow.execute(envelope, async () => {
      const place = await places.load(params.workspaceId, params.placeId);
      if (!place) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `place ${params.placeId} does not exist`, [placeRef]) };
      await places.addExternalRef({ workspaceId: params.workspaceId, id: refId, placeId: params.placeId, providerNamespace: params.providerNamespace, externalKey: params.externalKey, actor });
      const value = { refId, placeId: params.placeId };
      await appendAuditTrail({ envelope, advanced: [], destinationKind: 'PLACE_EXTERNAL_REF_ADDED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced: [] }) };
    }),
  );
}

// --- GeographicArea commands ------------------------------------------------

const CreateAreaPayloadSchema = z.strictObject({ name: z.string().min(1), areaType: z.string().min(1) });

export interface CreateGeographicAreaParams extends CommandIdentity {
  name: string;
  areaType: string;
  areaId?: string;
  evidenceRefs?: string[];
}

export interface AreaCommandValue {
  areaId: string;
  revision: number;
}

export async function createGeographicArea(
  uow: UnitOfWork,
  params: CreateGeographicAreaParams,
): Promise<ExecuteOutcome<AreaCommandValue>> {
  const parsed = CreateAreaPayloadSchema.safeParse({ name: params.name, areaType: params.areaType });
  if (!parsed.success) return rejectedPayload('GEOGRAPHIC_AREA_CREATED', parsed.error);
  const payload = parsed.data;
  const areaId = params.areaId ?? randomUUID();
  const areaRef = refOf('GEOGRAPHIC_AREA', areaId);
  const refused = refusedSubjectRefs('GEOGRAPHIC_AREA_CREATED', [areaRef]);
  if (refused) return refused;
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({ commandType: 'GEOGRAPHIC_AREA_CREATED', identity: params, payload, evidenceRefs: params.evidenceRefs });
  const geography = new PgGeographyRepository();

  return guarded([areaRef], () =>
    uow.execute<AreaCommandValue>(envelope, async () => {
      const area: GeographicArea = GeographicAreaSchema.parse({ id: areaId, revision: 1, name: payload.name, areaType: payload.areaType });
      await createRoot({ workspaceId: params.workspaceId, id: areaId, kind: 'GEOGRAPHIC_AREA' });
      await geography.createArea({ area, actor });
      const value: AreaCommandValue = { areaId, revision: 1 };
      const advanced: AdvancedRoot[] = [{ aggregateRef: areaRef, beforeRevision: null, afterRevision: 1 }];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'GEOGRAPHIC_AREA_CREATED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

const AddAreaVersionPayloadSchema = z.strictObject({
  areaId: SubjectIdSchema,
  validFrom: z.iso.date(),
  validUntil: z.iso.date().optional(),
  geometryWkt: z.string().min(1),
  evidenceId: SubjectIdSchema,
});

export interface AddAreaVersionParams extends CommandIdentity {
  areaId: string;
  expectedRevision: number;
  validFrom: string;
  validUntil?: string;
  /** WKT text, e.g. `MULTIPOLYGON(((...)))`. Validated by `area_versions_geometry_valid`. */
  geometryWkt: string;
  evidenceId: string;
  versionId?: string;
  evidenceRefs?: string[];
}

/** Every geometry edition advances its GeographicArea's own revision — editions are append-only but the root's history is not. */
export async function addAreaVersion(uow: UnitOfWork, params: AddAreaVersionParams): Promise<ExecuteOutcome<AreaCommandValue>> {
  const versionId = params.versionId ?? randomUUID();
  const parsed = AddAreaVersionPayloadSchema.safeParse({
    areaId: params.areaId,
    validFrom: params.validFrom,
    ...(params.validUntil ? { validUntil: params.validUntil } : {}),
    geometryWkt: params.geometryWkt,
    evidenceId: params.evidenceId,
  });
  if (!parsed.success) return rejectedPayload('AREA_VERSION_ADDED', parsed.error);
  const payload = parsed.data;
  const areaRef = refOf('GEOGRAPHIC_AREA', params.areaId);
  const refused = refusedSubjectRefs('AREA_VERSION_ADDED', [areaRef]);
  if (refused) return refused;
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: 'AREA_VERSION_ADDED',
    identity: params,
    payload: { ...payload, versionId },
    expectedAggregateRevisions: [{ aggregateRef: areaRef, expectedRevision: params.expectedRevision }],
    evidenceRefs: params.evidenceRefs,
  });
  const geography = new PgGeographyRepository();

  return guarded([areaRef], () =>
    uow.execute<AreaCommandValue>(envelope, async ({ lockedHeads }) => {
      const head = headOrConflict(lockedHeads, areaRef);
      if (head.ok === false) return { ok: false, conflict: head.conflict };
      const area = await geography.loadArea(params.workspaceId, params.areaId);
      if (!area) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `geographic area ${params.areaId} does not exist`, [areaRef]) };
      const version = GeographicAreaVersionSchema.parse({
        id: versionId,
        areaId: params.areaId,
        validFrom: payload.validFrom,
        ...(payload.validUntil ? { validUntil: payload.validUntil } : {}),
        geometryRef: versionId,
        evidenceId: payload.evidenceId,
      });
      await geography.addAreaVersion({ version, geometryWkt: payload.geometryWkt, actor });
      const advancedHead = await advanceOrConflict(areaRef, params.workspaceId, head.revision);
      if (advancedHead.ok === false) return { ok: false, conflict: advancedHead.conflict };
      const value: AreaCommandValue = { areaId: params.areaId, revision: advancedHead.revision };
      const advanced: AdvancedRoot[] = [{ aggregateRef: areaRef, beforeRevision: head.revision, afterRevision: advancedHead.revision }];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'AREA_VERSION_ADDED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

export interface AddAreaMembershipParams extends CommandIdentity {
  memberKind: 'PLACE' | 'AREA';
  memberPlaceId?: string;
  memberAreaId?: string;
  containingAreaVersionId: string;
  validFrom: string;
  validUntil?: string;
  evidenceId: string;
  membershipId?: string;
  evidenceRefs?: string[];
}

export async function addAreaMembership(
  uow: UnitOfWork,
  params: AddAreaMembershipParams,
): Promise<ExecuteOutcome<{ membershipId: string }>> {
  if ((params.memberKind === 'PLACE') !== Boolean(params.memberPlaceId) || (params.memberKind === 'AREA') !== Boolean(params.memberAreaId)) {
    return { ok: false, conflict: typedConflict('VALIDATION_FAILED', 'memberKind must match exactly one of memberPlaceId/memberAreaId') };
  }
  const membershipId = params.membershipId ?? randomUUID();
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: 'AREA_MEMBERSHIP_ADDED',
    identity: params,
    payload: { ...params, membershipId },
    evidenceRefs: params.evidenceRefs,
  });
  const geography = new PgGeographyRepository();

  return guarded([], () =>
    uow.execute(envelope, async () => {
      await geography.addAreaMembership({
        workspaceId: params.workspaceId,
        id: membershipId,
        memberKind: params.memberKind,
        memberPlaceId: params.memberPlaceId,
        memberAreaId: params.memberAreaId,
        containingAreaVersionId: params.containingAreaVersionId,
        validFrom: params.validFrom,
        validUntil: params.validUntil,
        evidenceId: params.evidenceId,
        actor,
      });
      const value = { membershipId };
      await appendAuditTrail({ envelope, advanced: [], destinationKind: 'AREA_MEMBERSHIP_ADDED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced: [] }) };
    }),
  );
}

// --- Jurisdiction commands ---------------------------------------------------

const CreateJurisdictionPayloadSchema = z.strictObject({
  name: z.string().min(1),
  regimeKind: z.enum(['COUNTRY', 'SUPRANATIONAL', 'SUBNATIONAL']),
});

export interface CreateJurisdictionParams extends CommandIdentity {
  name: string;
  regimeKind: Jurisdiction['regimeKind'];
  jurisdictionId?: string;
  evidenceRefs?: string[];
}

export async function createJurisdiction(
  uow: UnitOfWork,
  params: CreateJurisdictionParams,
): Promise<ExecuteOutcome<{ jurisdictionId: string }>> {
  const parsed = CreateJurisdictionPayloadSchema.safeParse({ name: params.name, regimeKind: params.regimeKind });
  if (!parsed.success) return rejectedPayload('JURISDICTION_CREATED', parsed.error);
  const payload = parsed.data;
  const jurisdictionId = params.jurisdictionId ?? randomUUID();
  const jurisdictionRef = refOf('JURISDICTION', jurisdictionId);
  const refused = refusedSubjectRefs('JURISDICTION_CREATED', [jurisdictionRef]);
  if (refused) return refused;
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({ commandType: 'JURISDICTION_CREATED', identity: params, payload, evidenceRefs: params.evidenceRefs });
  const geography = new PgGeographyRepository();

  return guarded([jurisdictionRef], () =>
    uow.execute(envelope, async () => {
      const jurisdiction: Jurisdiction = JurisdictionSchema.parse({ id: jurisdictionId, name: payload.name, regimeKind: payload.regimeKind });
      await createRoot({ workspaceId: params.workspaceId, id: jurisdictionId, kind: 'JURISDICTION' });
      await geography.createJurisdiction({ jurisdiction, actor });
      const value = { jurisdictionId };
      const advanced: AdvancedRoot[] = [{ aggregateRef: jurisdictionRef, beforeRevision: null, afterRevision: 1 }];
      await appendAuditTrail({ envelope, advanced, destinationKind: 'JURISDICTION_CREATED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced }) };
    }),
  );
}

export interface AddJurisdictionAreaParams extends CommandIdentity {
  jurisdictionId: string;
  areaVersionId: string;
  validFrom: string;
  validUntil?: string;
  linkId?: string;
  evidenceRefs?: string[];
}

export async function addJurisdictionArea(
  uow: UnitOfWork,
  params: AddJurisdictionAreaParams,
): Promise<ExecuteOutcome<{ linkId: string }>> {
  const linkId = params.linkId ?? randomUUID();
  const jurisdictionRef = refOf('JURISDICTION', params.jurisdictionId);
  const actor: ActorContext = { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId };
  const envelope = buildEnvelope({
    commandType: 'JURISDICTION_AREA_ADDED',
    identity: params,
    payload: { jurisdictionId: params.jurisdictionId, areaVersionId: params.areaVersionId, validFrom: params.validFrom, validUntil: params.validUntil ?? null, linkId },
    evidenceRefs: params.evidenceRefs,
  });
  const geography = new PgGeographyRepository();

  return guarded([jurisdictionRef], () =>
    uow.execute(envelope, async () => {
      const jurisdiction = await geography.loadJurisdiction(params.workspaceId, params.jurisdictionId);
      if (!jurisdiction) return { ok: false, conflict: typedConflict('VALIDATION_FAILED', `jurisdiction ${params.jurisdictionId} does not exist`, [jurisdictionRef]) };
      await geography.addJurisdictionArea({
        id: linkId,
        link: { jurisdictionId: params.jurisdictionId, areaVersionId: params.areaVersionId, validFrom: params.validFrom, ...(params.validUntil ? { validUntil: params.validUntil } : {}) },
        actor,
      });
      const value = { linkId };
      await appendAuditTrail({ envelope, advanced: [], destinationKind: 'JURISDICTION_AREA_ADDED', payload: value });
      return { ok: true, value, receipt: buildReceipt({ envelope, value, advanced: [] }) };
    }),
  );
}
