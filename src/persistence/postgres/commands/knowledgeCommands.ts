/**
 * M5 domain commands. Inputs are schema-checked before UnitOfWork execution;
 * UUIDs are validated at the PostgreSQL boundary, generated ids/timestamps are
 * pinned before execution, and all typed rows are written through
 * PgKnowledgeRepository. Nothing here calls a provider or interprets source
 * prose as an executable rule.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  boundedRuleParameterIssue,
  EvidenceRecordSchema,
  InformationRecordSchema,
  InformationScopeSchema,
  InformationVersionSchema,
  KnowledgeCoverageSchema,
  ObjectiveSchema,
  RuleExpressionSchema,
  SourceRecordV2Schema,
  validateRuleExpression,
  type RulePredicateRegistry,
} from '../../../domain/v2/knowledge/information.ts';
import type { InformationDetailInput } from '../../../contracts/v2/repository/knowledge.ts';
import { DomainCommandEnvelopeSchema, type DomainCommandEnvelope } from '../../../contracts/v2/command/domainCommand.ts';
import type { UnitOfWork } from '../../../contracts/v2/command/unitOfWork.ts';
import type { TypedResult } from '../../../domain/v2/shared/errors.ts';
import { TypedRefSchema, type ExpectedRevision, type SubjectKind, type TypedRef } from '../../../domain/v2/shared/identity.ts';
import { InstantIntervalSchema, InstantSchema, LocalDateSchema } from '../../../domain/v2/shared/time.ts';
import { canonicalPayloadHash } from '../canonicalHash.ts';
import {
  appendAuditTrail,
  buildReceipt,
  createRoot,
  lockedRevisionOf,
  missingHeadConflict,
  advanceHead,
  staleRevisionConflict,
  type AdvancedRoot,
} from '../commandSupport.ts';
import { currentTransactionClient } from '../transactionContext.ts';
import type { ExecuteOutcome } from '../pgUnitOfWork.ts';
import { PgKnowledgeRepository } from '../repositories/pgKnowledgeRepository.ts';

const Uuid = z.uuid();
const RegistryRef = TypedRefSchema.refine((ref) => Uuid.safeParse(ref.id).success, { message: 'id must be a UUID' });
const ContextSchema = z.strictObject({ workspaceId: Uuid, actorPrincipalId: z.string().min(1), idempotencyKey: z.string().min(1) });
const SCHEMA_VERSION = '1';

export interface KnowledgeCommandContext {
  workspaceId: string;
  actorPrincipalId: string;
  idempotencyKey: string;
}

interface SubmitSpec<R> {
  uow: UnitOfWork;
  commandType: string;
  destinationKind: string;
  context: KnowledgeCommandContext;
  payload: Record<string, unknown>;
  expectedAggregateRevisions?: ExpectedRevision[];
  expectedScopeGenerations?: DomainCommandEnvelope['expectedScopeGenerations'];
  evidenceRefs?: string[];
  body: (ctx: { envelope: DomainCommandEnvelope; lockedHeads: { aggregateRef: TypedRef; revision: number }[] }) =>
    Promise<TypedResult<{ value: R; advanced: AdvancedRoot[] }>>;
}

async function submitCommand<R>(spec: SubmitSpec<R>): Promise<ExecuteOutcome<R>> {
  const context = ContextSchema.parse({
    workspaceId: spec.context.workspaceId,
    actorPrincipalId: spec.context.actorPrincipalId,
    idempotencyKey: spec.context.idempotencyKey,
  });
  const envelope = DomainCommandEnvelopeSchema.parse({
    commandType: spec.commandType,
    schemaVersion: SCHEMA_VERSION,
    workspaceId: context.workspaceId,
    actorPrincipalId: context.actorPrincipalId,
    idempotencyKey: context.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash(spec.payload),
    expectedAggregateRevisions: spec.expectedAggregateRevisions ?? [],
    expectedScopeGenerations: spec.expectedScopeGenerations ?? [],
    typedPayload: spec.payload,
    evidenceRefs: spec.evidenceRefs ?? [],
  });
  return spec.uow.execute<R>(envelope, async (ctx) => {
    const outcome = await spec.body({ envelope, lockedHeads: ctx.lockedHeads });
    if (!outcome.ok) return outcome;
    await appendAuditTrail({
      envelope,
      advanced: outcome.value.advanced,
      destinationKind: spec.destinationKind,
      payload: outcome.value.value,
    });
    return {
      ok: true,
      value: outcome.value.value,
      receipt: buildReceipt({ envelope, value: outcome.value.value, advanced: outcome.value.advanced }),
    };
  });
}

function invalid(message: string, subjectRefs: TypedRef[] = []): TypedResult<never> {
  return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message, subjectRefs } };
}

function duplicate(message: string, subjectRefs: TypedRef[] = []): TypedResult<never> {
  return { ok: false, conflict: { kind: 'DUPLICATE_REGISTRATION', message, subjectRefs } };
}

async function subjectKind(workspaceId: string, id: string): Promise<SubjectKind | undefined> {
  const result = await currentTransactionClient().query<{ kind: SubjectKind }>(
    'SELECT kind FROM domain_subjects WHERE workspace_id = $1 AND id = $2',
    [workspaceId, id],
  );
  return result.rows[0]?.kind;
}

async function createM5Root(workspaceId: string, id: string, kind: SubjectKind): Promise<AdvancedRoot> {
  const existing = await subjectKind(workspaceId, id);
  if (existing) throw new Error(`subject ${id} is already registered as ${existing}`);
  await createRoot({ workspaceId, id, kind });
  return { aggregateRef: { kind, id }, beforeRevision: null, afterRevision: 1 };
}

async function advanceM5Root(params: {
  workspaceId: string;
  kind: SubjectKind;
  id: string;
  lockedHeads: { aggregateRef: TypedRef; revision: number }[];
}): Promise<TypedResult<AdvancedRoot>> {
  const ref = { kind: params.kind, id: params.id } satisfies TypedRef;
  const revision = lockedRevisionOf(params.lockedHeads, params.id);
  if (revision === undefined) return { ok: false, conflict: missingHeadConflict(ref) };
  const next = await advanceHead({ workspaceId: params.workspaceId, aggregateId: params.id, fromRevision: revision });
  return next === undefined
    ? { ok: false, conflict: staleRevisionConflict(ref, revision) }
    : { ok: true, value: { aggregateRef: ref, beforeRevision: revision, afterRevision: next } };
}

const sourceInput = z.strictObject({
  sourceId: Uuid.optional(),
  sourceIdentity: z.string().min(1),
  receivedAt: InstantSchema,
  contentHash: z.string().min(16),
  contentType: z.string().min(1),
  protectedLocationRef: z.string().min(1).optional(),
  rawContentHash: z.string().min(16).optional(),
  rawStorageRef: z.string().min(1).optional(),
  rawAccessPolicyId: z.string().min(1).optional(),
  captureMetadata: z.record(z.string(), z.unknown()).default({}),
  captureMetadataVersion: z.string().min(1).default('source-record-v2/1'),
});

export interface RecordSourceParams extends KnowledgeCommandContext {
  sourceId?: string;
  sourceIdentity: string;
  receivedAt: string;
  contentHash: string;
  contentType: string;
  protectedLocationRef?: string;
  rawContentHash?: string;
  rawStorageRef?: string;
  rawAccessPolicyId?: string;
  captureMetadata?: Record<string, unknown>;
  captureMetadataVersion?: string;
}

export interface SourceRecordedResult { sourceId: string; revision: number }

export async function recordSource(uow: UnitOfWork, params: RecordSourceParams): Promise<ExecuteOutcome<SourceRecordedResult>> {
  const parsed = sourceInput.safeParse({
    sourceId: params.sourceId, sourceIdentity: params.sourceIdentity, receivedAt: params.receivedAt,
    contentHash: params.contentHash, contentType: params.contentType, protectedLocationRef: params.protectedLocationRef,
    rawContentHash: params.rawContentHash, rawStorageRef: params.rawStorageRef, rawAccessPolicyId: params.rawAccessPolicyId,
    captureMetadata: params.captureMetadata, captureMetadataVersion: params.captureMetadataVersion,
  });
  if (!parsed.success) return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: parsed.error.message, subjectRefs: [] } };
  const sourceId = parsed.data.sourceId ?? randomUUID();
  const payload = { ...parsed.data, sourceId };
  return submitCommand({
    uow, commandType: 'SOURCE_RECORDED', destinationKind: 'SOURCE_CAPTURE_REGISTERED', context: params, payload,
    body: async () => {
      const repo = new PgKnowledgeRepository(params.workspaceId);
      let root: AdvancedRoot;
      try { root = await createM5Root(params.workspaceId, sourceId, 'SOURCE_RECORD'); }
      catch (error) { return duplicate(String(error), [{ kind: 'SOURCE_RECORD', id: sourceId }]); }
      await repo.createSourceRecord({
        source: SourceRecordV2Schema.parse({
          id: sourceId, sourceIdentity: parsed.data.sourceIdentity, receivedAt: parsed.data.receivedAt,
          contentHash: parsed.data.contentHash, contentType: parsed.data.contentType,
          ...(parsed.data.protectedLocationRef ? { protectedLocationRef: parsed.data.protectedLocationRef } : {}),
        }),
        rawContentHash: parsed.data.rawContentHash, rawStorageRef: parsed.data.rawStorageRef,
        rawAccessPolicyId: parsed.data.rawAccessPolicyId, captureMetadata: parsed.data.captureMetadata,
        captureMetadataVersion: parsed.data.captureMetadataVersion,
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return { ok: true, value: { value: { sourceId, revision: 1 }, advanced: [root] } };
    },
  });
}

const evidenceInput = z.strictObject({
  evidenceId: Uuid.optional(), assertionType: z.string().min(1), observedAt: InstantSchema,
  issuedAt: InstantSchema.optional(), schemaVersion: z.string().min(1), sourceIds: z.array(Uuid).min(1),
  subjectRefs: z.array(RegistryRef).min(1), interpretationProvenance: z.string().max(2048).optional(),
});

export interface RecordEvidenceParams extends KnowledgeCommandContext {
  evidenceId?: string; assertionType: string; observedAt: string; issuedAt?: string; schemaVersion: string;
  sourceIds: string[]; subjectRefs: { kind: string; id: string }[]; interpretationProvenance?: string;
}
export interface EvidenceRecordedResult { evidenceId: string; revision: number }

export async function recordEvidence(uow: UnitOfWork, params: RecordEvidenceParams): Promise<ExecuteOutcome<EvidenceRecordedResult>> {
  const parsed = evidenceInput.safeParse({
    evidenceId: params.evidenceId, assertionType: params.assertionType, observedAt: params.observedAt,
    issuedAt: params.issuedAt, schemaVersion: params.schemaVersion, sourceIds: params.sourceIds,
    subjectRefs: params.subjectRefs, interpretationProvenance: params.interpretationProvenance,
  });
  if (!parsed.success) return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: parsed.error.message, subjectRefs: [] } };
  const evidenceId = parsed.data.evidenceId ?? randomUUID();
  const payload = { ...parsed.data, evidenceId };
  return submitCommand({
    uow, commandType: 'EVIDENCE_RECORDED', destinationKind: 'EVIDENCE_REGISTERED', context: params, payload,
    evidenceRefs: [evidenceId],
    body: async () => {
      const repo = new PgKnowledgeRepository(params.workspaceId);
      let root: AdvancedRoot;
      try { root = await createM5Root(params.workspaceId, evidenceId, 'EVIDENCE_RECORD'); }
      catch (error) { return duplicate(String(error), [{ kind: 'EVIDENCE_RECORD', id: evidenceId }]); }
      const evidence = EvidenceRecordSchema.parse({
        id: evidenceId, assertionType: parsed.data.assertionType, observedAt: parsed.data.observedAt,
        ...(parsed.data.issuedAt ? { issuedAt: parsed.data.issuedAt } : {}), schemaVersion: parsed.data.schemaVersion,
        sourceIds: parsed.data.sourceIds, subjectRefs: parsed.data.subjectRefs,
        ...(parsed.data.interpretationProvenance ? { interpretationProvenance: parsed.data.interpretationProvenance } : {}),
      });
      await repo.createEvidenceRecord({ evidence, actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId } });
      return { ok: true, value: { value: { evidenceId, revision: 1 }, advanced: [root] } };
    },
  });
}

const informationRecordInput = z.strictObject({
  informationRecordId: Uuid.optional(), publisherOrganisationId: Uuid.optional(),
  externalPublicationKey: z.string().min(1), topic: z.string().min(1), sourceConnectionIdentity: z.string().min(1).optional(),
});
export interface RecordInformationRecordParams extends KnowledgeCommandContext {
  informationRecordId?: string; publisherOrganisationId?: string; externalPublicationKey: string;
  topic: string; sourceConnectionIdentity?: string;
}
export interface InformationRecordCreatedResult { informationRecordId: string; revision: number }

export async function recordInformationRecord(uow: UnitOfWork, params: RecordInformationRecordParams): Promise<ExecuteOutcome<InformationRecordCreatedResult>> {
  const parsed = informationRecordInput.safeParse({
    informationRecordId: params.informationRecordId, publisherOrganisationId: params.publisherOrganisationId,
    externalPublicationKey: params.externalPublicationKey, topic: params.topic,
    sourceConnectionIdentity: params.sourceConnectionIdentity,
  });
  if (!parsed.success) return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: parsed.error.message, subjectRefs: [] } };
  const informationRecordId = parsed.data.informationRecordId ?? randomUUID();
  const payload = { ...parsed.data, informationRecordId };
  return submitCommand({
    uow, commandType: 'INFORMATION_RECORD_CREATED', destinationKind: 'INFORMATION_LINEAGE_REGISTERED', context: params, payload,
    body: async () => {
      const repo = new PgKnowledgeRepository(params.workspaceId);
      let root: AdvancedRoot;
      try { root = await createM5Root(params.workspaceId, informationRecordId, 'INFORMATION_RECORD'); }
      catch (error) { return duplicate(String(error), [{ kind: 'INFORMATION_RECORD', id: informationRecordId }]); }
      await repo.createInformationRecord({
        record: InformationRecordSchema.parse({
          id: informationRecordId,
          ...(parsed.data.publisherOrganisationId ? { publisherOrganisationId: parsed.data.publisherOrganisationId } : {}),
          externalPublicationKey: parsed.data.externalPublicationKey,
          topic: parsed.data.topic,
          ...(parsed.data.sourceConnectionIdentity ? { sourceConnectionIdentity: parsed.data.sourceConnectionIdentity } : {}),
        }),
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return { ok: true, value: { value: { informationRecordId, revision: 1 }, advanced: [root] } };
    },
  });
}

const advisoryDetailInput = z.strictObject({
  sourceNativeSeverity: z.string().min(1), riskTopics: z.array(z.string().min(1)).max(16).optional(),
  publisherMeanings: z.array(z.unknown()).optional(), sourceNativeDetail: z.record(z.string(), z.unknown()).optional(),
  detailSchemaVersion: z.string().min(1),
});
const conditionDetailInput = z.strictObject({
  conditionType: z.string().min(1), observationBasis: z.enum(['OBSERVED', 'FORECAST']),
  forecastTarget: InstantIntervalSchema.optional(), uncertaintyModel: z.string().min(1).optional(),
  uncertaintyParameters: z.record(z.string(), z.unknown()).optional(), sourceNativeDetail: z.record(z.string(), z.unknown()).optional(),
  detailSchemaVersion: z.string().min(1),
}).superRefine((value, context) => {
  if (value.observationBasis === 'FORECAST' && !value.forecastTarget) context.addIssue({ code: 'custom', message: 'FORECAST requires forecastTarget' });
  if (value.observationBasis === 'OBSERVED' && value.forecastTarget) context.addIssue({ code: 'custom', message: 'OBSERVED cannot carry forecastTarget' });
  if (!value.uncertaintyModel && value.uncertaintyParameters && Object.keys(value.uncertaintyParameters).length > 0) context.addIssue({ code: 'custom', message: 'uncertaintyParameters require uncertaintyModel' });
});
const regulatoryDetailInput = z.strictObject({
  ruleSetVersionId: Uuid, ruleSetId: Uuid, issuingAuthority: z.string().min(1), jurisdictionId: Uuid.optional(),
  citation: z.string().max(2048).optional(), publishedAt: InstantSchema, publishedByActorId: z.string().min(1),
});
const informationVersionInput = z.strictObject({
  versionId: Uuid.optional(), informationRecordId: Uuid, subtype: z.enum(['ADVISORY', 'CONDITION', 'REGULATORY']),
  externalEditionSequence: z.number().int().min(0), issuedAt: InstantSchema, receivedAt: InstantSchema,
  observedAt: InstantSchema, effectiveWindow: InstantIntervalSchema.optional(), evidenceId: Uuid,
  supersedesInformationVersionId: Uuid.optional(), retractsInformationVersionId: Uuid.optional(),
  sourceNativeSeverity: z.string().max(256).optional(), normalizationVersion: z.string().min(1),
  payloadHash: z.string().min(16).optional(), detail: z.unknown(), sourceNativeFields: z.record(z.string(), z.unknown()).default({}),
  expectedRevision: z.number().int().min(1).optional(),
}).superRefine((value, context) => {
  if (value.supersedesInformationVersionId && value.retractsInformationVersionId) context.addIssue({ code: 'custom', message: 'a version may supersede or retract, not both' });
  const detail = value.detail;
  const parsed = value.subtype === 'ADVISORY' ? advisoryDetailInput.safeParse(detail) : value.subtype === 'CONDITION' ? conditionDetailInput.safeParse(detail) : regulatoryDetailInput.safeParse(detail);
  if (!parsed.success) context.addIssue({ code: 'custom', message: `invalid ${value.subtype} detail: ${parsed.error.message}` });
});

export interface IngestInformationVersionParams extends KnowledgeCommandContext {
  versionId?: string; informationRecordId: string; subtype: 'ADVISORY' | 'CONDITION' | 'REGULATORY';
  externalEditionSequence: number; issuedAt: string; receivedAt: string; observedAt: string;
  effectiveWindow?: { start: string; end: string }; evidenceId: string;
  supersedesInformationVersionId?: string; retractsInformationVersionId?: string; sourceNativeSeverity?: string;
  normalizationVersion: string; payloadHash?: string; detail: InformationDetailInput['detail']; sourceNativeFields?: Record<string, unknown>;
  expectedRevision?: number; predicateRegistry?: RulePredicateRegistry;
}
export interface InformationVersionIngestedResult { informationVersionId: string; sequence: number; disposition: 'ACCEPTED' | 'DUPLICATE_REPLAY' | 'QUARANTINED'; revision?: number }

function detailFor(subtype: IngestInformationVersionParams['subtype'], detail: IngestInformationVersionParams['detail']): InformationDetailInput {
  return subtype === 'ADVISORY' ? { subtype, detail: detail as Extract<InformationDetailInput, { subtype: 'ADVISORY' }>['detail'] }
    : subtype === 'CONDITION' ? { subtype, detail: detail as Extract<InformationDetailInput, { subtype: 'CONDITION' }>['detail'] }
      : { subtype, detail: detail as Extract<InformationDetailInput, { subtype: 'REGULATORY' }>['detail'] };
}

export async function ingestInformationVersion(uow: UnitOfWork, params: IngestInformationVersionParams): Promise<ExecuteOutcome<InformationVersionIngestedResult>> {
  const parsed = informationVersionInput.safeParse({
    versionId: params.versionId, informationRecordId: params.informationRecordId, subtype: params.subtype,
    externalEditionSequence: params.externalEditionSequence, issuedAt: params.issuedAt, receivedAt: params.receivedAt,
    observedAt: params.observedAt, effectiveWindow: params.effectiveWindow, evidenceId: params.evidenceId,
    supersedesInformationVersionId: params.supersedesInformationVersionId,
    retractsInformationVersionId: params.retractsInformationVersionId, sourceNativeSeverity: params.sourceNativeSeverity,
    normalizationVersion: params.normalizationVersion, payloadHash: params.payloadHash, detail: params.detail,
    sourceNativeFields: params.sourceNativeFields, expectedRevision: params.expectedRevision,
  });
  if (!parsed.success) return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: parsed.error.message, subjectRefs: [] } };
  const versionId = parsed.data.versionId ?? randomUUID();
  const detail = detailFor(parsed.data.subtype, parsed.data.detail as IngestInformationVersionParams['detail']);
  const payloadHash = parsed.data.payloadHash ?? canonicalPayloadHash({ sourceNativeFields: parsed.data.sourceNativeFields, detail, sequence: parsed.data.externalEditionSequence });
  const expectedRevision = parsed.data.expectedRevision ?? 1;
  const quarantineId = randomUUID();
  const payload = { ...parsed.data, versionId, payloadHash };
  return submitCommand({
    uow, commandType: 'INFORMATION_VERSION_INGESTED', destinationKind: 'INFORMATION_VERSION_ACCEPTED', context: params, payload,
    expectedAggregateRevisions: [{ aggregateRef: { kind: 'INFORMATION_RECORD', id: parsed.data.informationRecordId }, expectedRevision }],
    evidenceRefs: [parsed.data.evidenceId],
    body: async ({ lockedHeads }) => {
      const repo = new PgKnowledgeRepository(params.workspaceId);
      const exact = await repo.findInformationVersionBySequence(params.workspaceId, parsed.data.informationRecordId, parsed.data.externalEditionSequence);
      const quarantine = async (reason: string, disposition: InformationVersionIngestedResult['disposition']): Promise<TypedResult<{ value: InformationVersionIngestedResult; advanced: AdvancedRoot[] }>> => {
        await repo.quarantineInformation({
          id: quarantineId, informationRecordId: parsed.data.informationRecordId,
          externalEditionSequence: parsed.data.externalEditionSequence, subtype: parsed.data.subtype,
          rejectionReason: reason, payloadHash, rejectedSummary: { sourceNativeFields: parsed.data.sourceNativeFields },
          actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
        });
        return { ok: true, value: { value: { informationVersionId: exact?.id ?? versionId, sequence: parsed.data.externalEditionSequence, disposition }, advanced: [] } };
      };
      if (exact) {
        return exact.payloadHash === payloadHash ? { ok: true, value: { value: { informationVersionId: exact.id, sequence: exact.externalEditionSequence, disposition: 'DUPLICATE_REPLAY' }, advanced: [] } } : quarantine('DUPLICATE_SEQUENCE_HASH_MISMATCH', 'QUARANTINED');
      }
      const latest = await repo.latestInformationVersion(params.workspaceId, parsed.data.informationRecordId);
      if (latest && parsed.data.externalEditionSequence <= latest.externalEditionSequence) {
        return quarantine('OUT_OF_ORDER', 'QUARANTINED');
      }
      const advanced = await advanceM5Root({ workspaceId: params.workspaceId, kind: 'INFORMATION_RECORD', id: parsed.data.informationRecordId, lockedHeads });
      if (!advanced.ok) return advanced;
      const version = InformationVersionSchema.parse({
        id: versionId, informationRecordId: parsed.data.informationRecordId, subtype: parsed.data.subtype,
        externalEditionSequence: parsed.data.externalEditionSequence, issuedAt: parsed.data.issuedAt,
        receivedAt: parsed.data.receivedAt, observedAt: parsed.data.observedAt,
        ...(parsed.data.effectiveWindow ? { effectiveWindow: parsed.data.effectiveWindow } : {}), evidenceId: parsed.data.evidenceId,
        ...(parsed.data.supersedesInformationVersionId ? { supersedesInformationVersionId: parsed.data.supersedesInformationVersionId } : {}),
        ...(parsed.data.retractsInformationVersionId ? { retractsInformationVersionId: parsed.data.retractsInformationVersionId } : {}),
        ...(parsed.data.sourceNativeSeverity ? { sourceNativeSeverity: parsed.data.sourceNativeSeverity } : {}), payloadHash,
        normalizationVersion: parsed.data.normalizationVersion,
        ...(parsed.data.subtype === 'REGULATORY' ? { regulatoryRuleSetVersionId: (detail.detail as { ruleSetVersionId: string }).ruleSetVersionId } : {}),
      });
      await currentTransactionClient().query(
        'INSERT INTO domain_subjects (workspace_id, id, kind, aggregate_id) VALUES ($1, $2, $3, $4)',
        [params.workspaceId, versionId, 'INFORMATION_VERSION', parsed.data.informationRecordId],
      );
      await repo.appendInformationVersion({ version, payloadHash, normalizationVersion: parsed.data.normalizationVersion, detail, actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId } });
      return { ok: true, value: { value: { informationVersionId: versionId, sequence: parsed.data.externalEditionSequence, disposition: 'ACCEPTED', revision: advanced.value.afterRevision }, advanced: [advanced.value] } };
    },
  });
}

const ruleSetInput = z.strictObject({
  ruleSetId: Uuid.optional(), issuerRef: RegistryRef, policyFamily: z.string().min(1), versionId: Uuid.optional(), editionNumber: z.number().int().min(1),
  status: z.enum(['DRAFT', 'PUBLISHED', 'SUPERSEDED', 'WITHDRAWN']).default('DRAFT'), effectiveWindow: InstantIntervalSchema.optional(), expression: RuleExpressionSchema,
  publishedAt: InstantSchema.optional(), publishedByActorId: z.string().min(1).optional(),
  rules: z.array(z.strictObject({ id: Uuid.optional(), ruleKey: z.string().regex(/^[a-z][a-z0-9_]*$/), statement: z.string().min(1), expression: RuleExpressionSchema, severity: z.enum(['INFORMATIONAL', 'ADVISORY', 'MANDATORY', 'PROHIBITIVE']).optional() })).default([]),
  predicateRegistry: z.custom<RulePredicateRegistry>().optional(),
});
export interface CreateRuleSetParams extends KnowledgeCommandContext {
  ruleSetId?: string; issuerRef: { kind: 'ORGANISATION' | 'PRINCIPAL'; id: string }; policyFamily: string;
  versionId?: string; editionNumber: number; status?: 'DRAFT' | 'PUBLISHED' | 'SUPERSEDED' | 'WITHDRAWN'; effectiveWindow?: { start: string; end: string };
  expression: unknown; publishedAt?: string; publishedByActorId?: string; rules?: { id?: string; ruleKey: string; statement: string; expression: unknown; severity?: 'INFORMATIONAL' | 'ADVISORY' | 'MANDATORY' | 'PROHIBITIVE' }[];
  predicateRegistry?: RulePredicateRegistry;
}
export interface RuleSetCreatedResult { ruleSetId: string; versionId: string; revision: number }

export async function createRuleSet(uow: UnitOfWork, params: CreateRuleSetParams): Promise<ExecuteOutcome<RuleSetCreatedResult>> {
  const parsed = ruleSetInput.safeParse({
    ruleSetId: params.ruleSetId, issuerRef: params.issuerRef, policyFamily: params.policyFamily,
    versionId: params.versionId, editionNumber: params.editionNumber, status: params.status,
    effectiveWindow: params.effectiveWindow, expression: params.expression, publishedAt: params.publishedAt,
    publishedByActorId: params.publishedByActorId, rules: params.rules, predicateRegistry: params.predicateRegistry,
  });
  if (!parsed.success) return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: parsed.error.message, subjectRefs: [] } };
  const registry = params.predicateRegistry;
  for (const expression of [parsed.data.expression, ...parsed.data.rules.map((rule) => rule.expression)]) {
    const result = validateRuleExpression(expression, registry);
    if (!result.ok) return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: result.issues.join('; '), subjectRefs: [] } };
  }
  if (parsed.data.status !== 'DRAFT' && (!parsed.data.publishedAt || !parsed.data.publishedByActorId)) return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: 'published rule editions require publication actor and time', subjectRefs: [] } };
  const ruleSetId = parsed.data.ruleSetId ?? randomUUID();
  const versionId = parsed.data.versionId ?? randomUUID();
  const rules = parsed.data.rules.map((rule) => ({ ...rule, id: rule.id ?? randomUUID() }));
  const payload = {
    ruleSetId, issuerRef: parsed.data.issuerRef, policyFamily: parsed.data.policyFamily,
    versionId, editionNumber: parsed.data.editionNumber, status: parsed.data.status,
    ...(parsed.data.effectiveWindow ? { effectiveWindow: parsed.data.effectiveWindow } : {}),
    expression: parsed.data.expression, ...(parsed.data.publishedAt ? { publishedAt: parsed.data.publishedAt } : {}),
    ...(parsed.data.publishedByActorId ? { publishedByActorId: parsed.data.publishedByActorId } : {}), rules,
  };
  return submitCommand({
    uow, commandType: 'RULE_SET_CREATED', destinationKind: 'RULE_SET_EDITION_REGISTERED', context: params, payload,
    body: async () => {
      let root: AdvancedRoot;
      try { root = await createM5Root(params.workspaceId, ruleSetId, 'RULE_SET'); }
      catch (error) { return duplicate(String(error), [{ kind: 'RULE_SET', id: ruleSetId }]); }
      const repo = new PgKnowledgeRepository(params.workspaceId);
      await repo.createRuleSet({
        ruleSet: { id: ruleSetId, issuerRef: parsed.data.issuerRef, policyFamily: parsed.data.policyFamily },
        version: { id: versionId, ruleSetId, editionNumber: parsed.data.editionNumber, status: parsed.data.status, ...(parsed.data.effectiveWindow ? { effectiveWindow: parsed.data.effectiveWindow } : {}), expression: parsed.data.expression as never, ...(parsed.data.publishedAt ? { publishedAt: parsed.data.publishedAt } : {}), ...(parsed.data.publishedByActorId ? { publishedByActorId: parsed.data.publishedByActorId } : {}) },
        rules: rules.map((rule) => ({ id: rule.id, ruleKey: rule.ruleKey, statement: rule.statement, expression: rule.expression as never, severity: rule.severity })),
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return { ok: true, value: { value: { ruleSetId, versionId, revision: 1 }, advanced: [root] } };
    },
  });
}

const ruleAssignmentInput = z.strictObject({
  assignmentId: Uuid.optional(), ruleSetId: Uuid, ruleSetVersionId: Uuid.optional(),
  selectCurrentEdition: z.boolean().default(false), organisationId: Uuid.optional(), subjectRef: RegistryRef.optional(),
  jurisdictionId: Uuid.optional(), populationPredicateId: z.string().min(1).optional(),
  populationParameters: z.record(z.string(), z.unknown()).default({}), validFrom: InstantSchema,
  validUntil: InstantSchema.optional(),
}).superRefine((value, context) => {
  if (value.selectCurrentEdition === (value.ruleSetVersionId !== undefined)) {
    context.addIssue({ code: 'custom', message: 'assignment must select exactly one of a fixed edition or the current edition' });
  }
  if (!value.organisationId && !value.subjectRef && !value.jurisdictionId && !value.populationPredicateId) {
    context.addIssue({ code: 'custom', message: 'assignment requires an organisation, subject, jurisdiction or population predicate scope' });
  }
  if (!value.populationPredicateId && Object.keys(value.populationParameters).length > 0) {
    context.addIssue({ code: 'custom', message: 'population parameters require a registered population predicate' });
  }
  if (value.validUntil && new Date(value.validUntil).getTime() <= new Date(value.validFrom).getTime()) {
    context.addIssue({ code: 'custom', message: 'assignment validUntil must be after validFrom' });
  }
});

export interface RecordRuleAssignmentParams extends KnowledgeCommandContext {
  assignmentId?: string; ruleSetId: string; ruleSetVersionId?: string; selectCurrentEdition?: boolean;
  organisationId?: string; subjectRef?: { kind: SubjectKind; id: string }; jurisdictionId?: string;
  populationPredicateId?: string; populationParameters?: Record<string, unknown>;
  validFrom: string; validUntil?: string;
}
export interface RuleAssignmentRecordedResult { assignmentId: string }

/** Records a typed applicability assignment; M6 resolves the matching edition. */
export async function recordRuleAssignment(uow: UnitOfWork, params: RecordRuleAssignmentParams): Promise<ExecuteOutcome<RuleAssignmentRecordedResult>> {
  const parsed = ruleAssignmentInput.safeParse({
    assignmentId: params.assignmentId, ruleSetId: params.ruleSetId, ruleSetVersionId: params.ruleSetVersionId,
    selectCurrentEdition: params.selectCurrentEdition, organisationId: params.organisationId,
    subjectRef: params.subjectRef, jurisdictionId: params.jurisdictionId, populationPredicateId: params.populationPredicateId,
    populationParameters: params.populationParameters, validFrom: params.validFrom, validUntil: params.validUntil,
  });
  if (!parsed.success) return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: parsed.error.message, subjectRefs: [] } };
  const assignmentId = parsed.data.assignmentId ?? randomUUID();
  const payload = { ...parsed.data, assignmentId };
  return submitCommand({
    uow, commandType: 'RULE_ASSIGNMENT_RECORDED', destinationKind: 'RULE_ASSIGNMENT_REGISTERED', context: params, payload,
    body: async () => {
      const client = currentTransactionClient();
      const edition = parsed.data.ruleSetVersionId
        ? await client.query('SELECT 1 FROM rule_set_versions WHERE workspace_id = $1 AND id = $2 AND rule_set_id = $3', [params.workspaceId, parsed.data.ruleSetVersionId, parsed.data.ruleSetId])
        : { rowCount: 1 };
      if (edition.rowCount !== 1) return invalid('rule assignment edition does not belong to its rule set');
      const repo = new PgKnowledgeRepository(params.workspaceId);
      await repo.createRuleAssignment({
        id: assignmentId, ruleSetId: parsed.data.ruleSetId, ...(parsed.data.ruleSetVersionId ? { ruleSetVersionId: parsed.data.ruleSetVersionId } : {}),
        selectCurrentEdition: parsed.data.selectCurrentEdition, ...(parsed.data.organisationId ? { organisationId: parsed.data.organisationId } : {}),
        ...(parsed.data.subjectRef ? { subjectRef: parsed.data.subjectRef } : {}), ...(parsed.data.jurisdictionId ? { jurisdictionId: parsed.data.jurisdictionId } : {}),
        ...(parsed.data.populationPredicateId ? { populationPredicateId: parsed.data.populationPredicateId } : {}),
        populationParameters: parsed.data.populationParameters, validFrom: parsed.data.validFrom, ...(parsed.data.validUntil ? { validUntil: parsed.data.validUntil } : {}),
        actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId },
      });
      return { ok: true, value: { value: { assignmentId }, advanced: [] } };
    },
  });
}

const preferenceInput = z.strictObject({
  preferenceId: Uuid.optional(), ownerRef: RegistryRef, preferenceKind: z.string().min(1).max(256), source: z.enum(['EXPLICIT', 'INFERRED']),
  value: z.record(z.string(), z.unknown()), valueSchemaVersion: z.string().min(1), effectiveWindow: InstantIntervalSchema, supersedesPreferenceId: Uuid.optional(), evidenceId: Uuid,
});
export interface RecordPreferenceParams extends KnowledgeCommandContext { preferenceId?: string; ownerRef: { kind: string; id: string }; preferenceKind: string; source: 'EXPLICIT' | 'INFERRED'; value: unknown; valueSchemaVersion: string; effectiveWindow: { start: string; end: string }; supersedesPreferenceId?: string; evidenceId: string; }
export interface PreferenceRecordedResult { preferenceId: string; revision: number }

export async function recordPreference(uow: UnitOfWork, params: RecordPreferenceParams): Promise<ExecuteOutcome<PreferenceRecordedResult>> {
  const issue = boundedRuleParameterIssue(params.value);
  if (issue) return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: issue, subjectRefs: [] } };
  const parsed = preferenceInput.safeParse({
    preferenceId: params.preferenceId, ownerRef: params.ownerRef, preferenceKind: params.preferenceKind,
    source: params.source, value: params.value, valueSchemaVersion: params.valueSchemaVersion,
    effectiveWindow: params.effectiveWindow, supersedesPreferenceId: params.supersedesPreferenceId, evidenceId: params.evidenceId,
  });
  if (!parsed.success) return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: parsed.error.message, subjectRefs: [] } };
  const preferenceId = parsed.data.preferenceId ?? randomUUID();
  const payload = { ...parsed.data, preferenceId };
  return submitCommand({
    uow, commandType: 'PREFERENCE_RECORDED', destinationKind: 'PREFERENCE_REGISTERED', context: params, payload, evidenceRefs: [parsed.data.evidenceId],
    body: async () => {
      let root: AdvancedRoot;
      try { root = await createM5Root(params.workspaceId, preferenceId, 'PREFERENCE'); }
      catch (error) { return duplicate(String(error), [{ kind: 'PREFERENCE', id: preferenceId }]); }
      const repo = new PgKnowledgeRepository(params.workspaceId);
      await repo.createPreference({ preference: { id: preferenceId, ownerRef: parsed.data.ownerRef, preferenceKind: parsed.data.preferenceKind, source: parsed.data.source, value: parsed.data.value, effectiveWindow: parsed.data.effectiveWindow, ...(parsed.data.supersedesPreferenceId ? { supersedesPreferenceId: parsed.data.supersedesPreferenceId } : {}), evidenceId: parsed.data.evidenceId, valueSchemaVersion: parsed.data.valueSchemaVersion }, actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId } });
      return { ok: true, value: { value: { preferenceId, revision: 1 }, advanced: [root] } };
    },
  });
}

const objectiveInput = z.strictObject({ objectiveId: Uuid.optional(), ownerKind: z.enum(['TRIP', 'JOURNEY', 'COORDINATION_GROUP', 'PROGRAMME']), ownerId: Uuid, successPredicate: z.string().min(1).max(2048), hardness: z.enum(['HARD', 'SOFT']), priority: z.number().int().min(0), disposition: z.enum(['ACTIVE', 'ACHIEVED', 'WAIVED', 'CLOSED_WITH_LOSS']).default('ACTIVE'), dispositionEvidenceId: Uuid.optional() });
export interface RecordObjectiveParams extends KnowledgeCommandContext { objectiveId?: string; ownerKind: 'TRIP' | 'JOURNEY' | 'COORDINATION_GROUP' | 'PROGRAMME'; ownerId: string; successPredicate: string; hardness: 'HARD' | 'SOFT'; priority: number; disposition?: 'ACTIVE' | 'ACHIEVED' | 'WAIVED' | 'CLOSED_WITH_LOSS'; dispositionEvidenceId?: string; }
export interface ObjectiveRecordedResult { objectiveId: string; revision: number }

export async function recordObjective(uow: UnitOfWork, params: RecordObjectiveParams): Promise<ExecuteOutcome<ObjectiveRecordedResult>> {
  const parsed = objectiveInput.safeParse({
    objectiveId: params.objectiveId, ownerKind: params.ownerKind, ownerId: params.ownerId,
    successPredicate: params.successPredicate, hardness: params.hardness, priority: params.priority,
    disposition: params.disposition, dispositionEvidenceId: params.dispositionEvidenceId,
  });
  if (!parsed.success) return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: parsed.error.message, subjectRefs: [] } };
  if (parsed.data.disposition !== 'ACTIVE' && !parsed.data.dispositionEvidenceId) return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: 'terminal objective disposition requires evidence', subjectRefs: [] } };
  const objectiveId = parsed.data.objectiveId ?? randomUUID();
  const payload = { ...parsed.data, objectiveId };
  return submitCommand({
    uow, commandType: 'OBJECTIVE_RECORDED', destinationKind: 'OBJECTIVE_REGISTERED', context: params, payload, evidenceRefs: parsed.data.dispositionEvidenceId ? [parsed.data.dispositionEvidenceId] : [],
    body: async () => {
      let root: AdvancedRoot;
      try { root = await createM5Root(params.workspaceId, objectiveId, 'OBJECTIVE'); }
      catch (error) { return duplicate(String(error), [{ kind: 'OBJECTIVE', id: objectiveId }]); }
      const repo = new PgKnowledgeRepository(params.workspaceId);
      await repo.createObjective({ objective: ObjectiveSchema.parse({ id: objectiveId, ownerKind: parsed.data.ownerKind, ownerId: parsed.data.ownerId, successPredicate: parsed.data.successPredicate, hardness: parsed.data.hardness, priority: parsed.data.priority, disposition: parsed.data.disposition, ...(parsed.data.dispositionEvidenceId ? { dispositionEvidenceId: parsed.data.dispositionEvidenceId } : {}) }), actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId } });
      return { ok: true, value: { value: { objectiveId, revision: 1 }, advanced: [root] } };
    },
  });
}

const constraintInput = z.strictObject({ constraintDefinitionId: Uuid.optional(), registeredType: z.string().regex(/^[a-z][a-z0-9_]*$/), hardness: z.enum(['HARD', 'SOFT']), ownerRef: RegistryRef, parameterSchemaVersion: z.string().min(1), parameterSchema: z.record(z.string(), z.unknown()).default({}), provenanceEvidenceId: Uuid.optional(), operands: z.array(z.strictObject({ key: z.string().regex(/^[a-z][a-z0-9_]*$/), kind: z.enum(['SUBJECT_REF', 'TEXT', 'NUMBER', 'BOOLEAN', 'INSTANT', 'LOCAL_DATE']), value: z.unknown() })).default([]) });
export interface RecordConstraintDefinitionParams extends KnowledgeCommandContext { constraintDefinitionId?: string; registeredType: string; hardness: 'HARD' | 'SOFT'; ownerRef: { kind: string; id: string }; parameterSchemaVersion: string; parameterSchema?: Record<string, unknown>; provenanceEvidenceId?: string; operands?: { key: string; kind: 'SUBJECT_REF' | 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'INSTANT' | 'LOCAL_DATE'; value: unknown }[]; }
export interface ConstraintDefinitionRecordedResult { constraintDefinitionId: string; revision: number }

type ConstraintOperand = NonNullable<RecordConstraintDefinitionParams['operands']>[number];

function constraintOperandIssue(operand: ConstraintOperand): string | undefined {
  if (operand.kind === 'SUBJECT_REF') return RegistryRef.safeParse(operand.value).success ? undefined : `operand ${operand.key} requires a typed UUID reference`;
  if (operand.kind === 'TEXT') return typeof operand.value === 'string' && operand.value.length <= 2048 ? undefined : `operand ${operand.key} requires text up to 2048 characters`;
  if (operand.kind === 'NUMBER') return typeof operand.value === 'number' && Number.isFinite(operand.value) ? undefined : `operand ${operand.key} requires a finite number`;
  if (operand.kind === 'BOOLEAN') return typeof operand.value === 'boolean' ? undefined : `operand ${operand.key} requires a boolean`;
  if (operand.kind === 'INSTANT') return InstantSchema.safeParse(operand.value).success ? undefined : `operand ${operand.key} requires an instant`;
  return LocalDateSchema.safeParse(operand.value).success ? undefined : `operand ${operand.key} requires a local date`;
}

export async function recordConstraintDefinition(uow: UnitOfWork, params: RecordConstraintDefinitionParams): Promise<ExecuteOutcome<ConstraintDefinitionRecordedResult>> {
  const parsed = constraintInput.safeParse({
    constraintDefinitionId: params.constraintDefinitionId, registeredType: params.registeredType,
    hardness: params.hardness, ownerRef: params.ownerRef, parameterSchemaVersion: params.parameterSchemaVersion,
    parameterSchema: params.parameterSchema, provenanceEvidenceId: params.provenanceEvidenceId, operands: params.operands,
  });
  if (!parsed.success) return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: parsed.error.message, subjectRefs: [] } };
  for (const operand of parsed.data.operands) {
    const issue = constraintOperandIssue(operand);
    if (issue) return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: issue, subjectRefs: [] } };
  }
  const constraintDefinitionId = parsed.data.constraintDefinitionId ?? randomUUID();
  const payload = { ...parsed.data, constraintDefinitionId };
  return submitCommand({
    uow, commandType: 'CONSTRAINT_DEFINITION_RECORDED', destinationKind: 'CONSTRAINT_REGISTERED', context: params, payload, evidenceRefs: parsed.data.provenanceEvidenceId ? [parsed.data.provenanceEvidenceId] : [],
    body: async () => {
      let root: AdvancedRoot;
      try { root = await createM5Root(params.workspaceId, constraintDefinitionId, 'CONSTRAINT_DEFINITION'); }
      catch (error) { return duplicate(String(error), [{ kind: 'CONSTRAINT_DEFINITION', id: constraintDefinitionId }]); }
      const repo = new PgKnowledgeRepository(params.workspaceId);
      const operands = parsed.data.operands.map((operand) => ({ key: operand.key, kind: operand.kind, value: operand.value as never }));
      await repo.createConstraintDefinition({ definition: { id: constraintDefinitionId, registeredType: parsed.data.registeredType, hardness: parsed.data.hardness, ownerRef: parsed.data.ownerRef, operands: {}, ...(parsed.data.provenanceEvidenceId ? { provenanceEvidenceId: parsed.data.provenanceEvidenceId } : {}), parameterSchemaVersion: parsed.data.parameterSchemaVersion, parameterSchema: parsed.data.parameterSchema }, operands, actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId } });
      return { ok: true, value: { value: { constraintDefinitionId, revision: 1 }, advanced: [root] } };
    },
  });
}

const scopeInput = z.strictObject({ scopeId: Uuid.optional(), informationVersionId: Uuid, areaVersionId: Uuid.optional(), jurisdictionId: Uuid.optional(), populationPredicate: z.string().min(1).optional(), populationParameters: z.record(z.string(), z.unknown()).default({}), subjectRef: RegistryRef.optional(), purpose: z.string().max(256).optional(), serviceCategory: z.string().max(256).optional(), effectiveExposure: InstantIntervalSchema, expectedRevision: z.number().int().min(1).optional() });
export interface RecordInformationScopeParams extends KnowledgeCommandContext { scopeId?: string; informationRecordId: string; informationVersionId: string; areaVersionId?: string; jurisdictionId?: string; populationPredicate?: string; populationParameters?: Record<string, unknown>; subjectRef?: { kind: string; id: string }; purpose?: string; serviceCategory?: string; effectiveExposure: { start: string; end: string }; expectedRevision?: number; }
export interface InformationScopeRecordedResult { scopeId: string; informationVersionId: string; revision: number }

export async function recordInformationScope(uow: UnitOfWork, params: RecordInformationScopeParams): Promise<ExecuteOutcome<InformationScopeRecordedResult>> {
  const parsed = scopeInput.safeParse({
    scopeId: params.scopeId, informationVersionId: params.informationVersionId, areaVersionId: params.areaVersionId,
    jurisdictionId: params.jurisdictionId, populationPredicate: params.populationPredicate,
    populationParameters: params.populationParameters, subjectRef: params.subjectRef, purpose: params.purpose,
    serviceCategory: params.serviceCategory, effectiveExposure: params.effectiveExposure, expectedRevision: params.expectedRevision,
  });
  if (!parsed.success) return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: parsed.error.message, subjectRefs: [] } };
  const parent = await uow.heads.loadHead({ kind: 'INFORMATION_RECORD', id: params.informationRecordId });
  if (!parent) return { ok: false, conflict: missingHeadConflict({ kind: 'INFORMATION_RECORD', id: params.informationRecordId }) };
  const scopeId = parsed.data.scopeId ?? randomUUID();
  const expectedRevision = parsed.data.expectedRevision ?? parent.revision;
  const payload = { ...parsed.data, informationRecordId: params.informationRecordId, scopeId };
  return submitCommand({
    uow, commandType: 'INFORMATION_SCOPE_RECORDED', destinationKind: 'INFORMATION_APPLICABILITY_REGISTERED', context: params, payload,
    expectedAggregateRevisions: [{ aggregateRef: { kind: 'INFORMATION_RECORD', id: params.informationRecordId }, expectedRevision }],
    body: async ({ lockedHeads }) => {
      const ownership = await currentTransactionClient().query(
        `SELECT 1 FROM information_versions
          WHERE workspace_id = $1 AND id = $2 AND information_record_id = $3`,
        [params.workspaceId, parsed.data.informationVersionId, params.informationRecordId],
      );
      if (ownership.rowCount !== 1) return invalid('information scope version does not belong to its information record');
      const advanced = await advanceM5Root({ workspaceId: params.workspaceId, kind: 'INFORMATION_RECORD', id: params.informationRecordId, lockedHeads });
      if (!advanced.ok) return advanced;
      const repo = new PgKnowledgeRepository(params.workspaceId);
      await repo.createInformationScope({ scope: InformationScopeSchema.parse({
        id: scopeId,
        informationVersionId: parsed.data.informationVersionId,
        ...(parsed.data.areaVersionId ? { areaVersionId: parsed.data.areaVersionId } : {}),
        ...(parsed.data.jurisdictionId ? { jurisdictionId: parsed.data.jurisdictionId } : {}),
        ...(parsed.data.populationPredicate ? { populationPredicate: parsed.data.populationPredicate } : {}),
        populationParameters: parsed.data.populationParameters,
        ...(parsed.data.subjectRef ? { subjectRef: parsed.data.subjectRef } : {}),
        ...(parsed.data.purpose ? { purpose: parsed.data.purpose } : {}),
        ...(parsed.data.serviceCategory ? { serviceCategory: parsed.data.serviceCategory } : {}),
        effectiveExposure: parsed.data.effectiveExposure,
      }), actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId } });
      return { ok: true, value: { value: { scopeId, informationVersionId: parsed.data.informationVersionId, revision: advanced.value.afterRevision }, advanced: [advanced.value] } };
    },
  });
}

const coverageInput = z.strictObject({ coverageId: Uuid.optional(), queryBounds: z.record(z.string(), z.unknown()), queryBoundsVersion: z.string().min(1), topic: z.string().min(1), edition: z.string().min(1), watermark: z.string().optional(), completeness: z.enum(['COMPLETE', 'INCOMPLETE', 'UNKNOWN', 'UNSUPPORTED_CATEGORY', 'SOURCE_UNAVAILABLE']), completenessLimitations: z.array(z.string().min(1)).max(16).default([]), expiresAt: InstantSchema.optional(), evidenceId: Uuid });
export interface RecordKnowledgeCoverageParams extends KnowledgeCommandContext { coverageId?: string; queryBounds: Record<string, unknown>; queryBoundsVersion: string; topic: string; edition: string; watermark?: string; completeness: 'COMPLETE' | 'INCOMPLETE' | 'UNKNOWN' | 'UNSUPPORTED_CATEGORY' | 'SOURCE_UNAVAILABLE'; completenessLimitations?: string[]; expiresAt?: string; evidenceId: string; }
export interface KnowledgeCoverageRecordedResult { coverageId: string }

export async function recordKnowledgeCoverage(uow: UnitOfWork, params: RecordKnowledgeCoverageParams): Promise<ExecuteOutcome<KnowledgeCoverageRecordedResult>> {
  const parsed = coverageInput.safeParse({
    coverageId: params.coverageId, queryBounds: params.queryBounds, queryBoundsVersion: params.queryBoundsVersion,
    topic: params.topic, edition: params.edition, watermark: params.watermark, completeness: params.completeness,
    completenessLimitations: params.completenessLimitations, expiresAt: params.expiresAt, evidenceId: params.evidenceId,
  });
  if (!parsed.success) return { ok: false, conflict: { kind: 'VALIDATION_FAILED', message: parsed.error.message, subjectRefs: [] } };
  const coverageId = parsed.data.coverageId ?? randomUUID();
  const payload = { ...parsed.data, coverageId };
  return submitCommand({
    uow, commandType: 'KNOWLEDGE_COVERAGE_RECORDED', destinationKind: 'KNOWLEDGE_COVERAGE_REGISTERED', context: params, payload, evidenceRefs: [parsed.data.evidenceId],
    body: async () => {
      const repo = new PgKnowledgeRepository(params.workspaceId);
      const coverage = KnowledgeCoverageSchema.parse({
        id: coverageId, queryBounds: parsed.data.queryBounds, queryBoundsVersion: parsed.data.queryBoundsVersion,
        topic: parsed.data.topic, edition: parsed.data.edition, ...(parsed.data.watermark ? { watermark: parsed.data.watermark } : {}),
        completeness: parsed.data.completeness, completenessLimitations: parsed.data.completenessLimitations,
        ...(parsed.data.expiresAt ? { expiresAt: parsed.data.expiresAt } : {}), evidenceId: parsed.data.evidenceId,
      }) as import('../../../contracts/v2/repository/knowledge.ts').CoverageInput['coverage'];
      await repo.createKnowledgeCoverage({ coverage, actor: { workspaceId: params.workspaceId, actorPrincipalId: params.actorPrincipalId } });
      return { ok: true, value: { value: { coverageId }, advanced: [] } };
    },
  });
}

export const registerSource = recordSource;
export const registerEvidence = recordEvidence;
export const createInformationRecord = recordInformationRecord;
export const appendInformationVersion = ingestInformationVersion;
export const createRuleAssignment = recordRuleAssignment;
export const createPreference = recordPreference;
export const createObjective = recordObjective;
export const createConstraintDefinition = recordConstraintDefinition;
export const createInformationScope = recordInformationScope;
export const createKnowledgeCoverage = recordKnowledgeCoverage;
