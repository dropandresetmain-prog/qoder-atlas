/**
 * M5 repository ports. Implementations are workspace-bound and run writes on
 * the ambient UnitOfWork transaction. These ports expose typed rows and named
 * reverse lookups; callers never submit arbitrary SQL or JSON predicates.
 */
import type {
  ConstraintDefinition,
  EvidenceRecord,
  InformationRecord,
  InformationScope,
  InformationVersion,
  KnowledgeCoverage,
  Objective,
  Preference,
  RuleExpression,
  RuleSetVersion,
  SourceRecordV2,
} from '../../../domain/v2/knowledge/information.ts';
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { Instant, InstantInterval } from '../../../domain/v2/shared/time.ts';
import type { ActorContext } from './people.ts';

export interface SourceRecordInput {
  source: SourceRecordV2;
  rawContentHash?: string;
  rawStorageRef?: string;
  rawAccessPolicyId?: string;
  captureMetadata?: Record<string, unknown>;
  captureMetadataVersion?: string;
  actor: ActorContext;
}

export interface EvidenceRecordInput {
  evidence: EvidenceRecord;
  actor: ActorContext;
}

export interface AdvisoryDetailInput {
  sourceNativeSeverity: string;
  riskTopics?: string[];
  publisherMeanings?: unknown[];
  sourceNativeDetail?: Record<string, unknown>;
  detailSchemaVersion: string;
}

export interface ConditionDetailInput {
  conditionType: string;
  observationBasis: 'OBSERVED' | 'FORECAST';
  forecastTarget?: InstantInterval;
  uncertaintyModel?: string;
  uncertaintyParameters?: Record<string, unknown>;
  sourceNativeDetail?: Record<string, unknown>;
  detailSchemaVersion: string;
}

export interface RegulatoryPublicationInput {
  ruleSetVersionId: string;
  ruleSetId: string;
  issuingAuthority: string;
  jurisdictionId?: string;
  citation?: string;
  publishedAt: Instant;
  publishedByActorId: string;
}

export type InformationDetailInput =
  | { subtype: 'ADVISORY'; detail: AdvisoryDetailInput }
  | { subtype: 'CONDITION'; detail: ConditionDetailInput }
  | { subtype: 'REGULATORY'; detail: RegulatoryPublicationInput };

export interface InformationVersionInput {
  version: InformationVersion;
  payloadHash: string;
  normalizationVersion: string;
  detail: InformationDetailInput;
  actor: ActorContext;
}

export interface RuleSetInput {
  ruleSet: {
    id: string;
    issuerRef: TypedRef;
    policyFamily: string;
  };
  version: RuleSetVersion & { publishedAt?: Instant; publishedByActorId?: string };
  rules: {
    id: string;
    ruleKey: string;
    statement: string;
    expression: RuleExpression;
    severity?: 'INFORMATIONAL' | 'ADVISORY' | 'MANDATORY' | 'PROHIBITIVE';
  }[];
  actor: ActorContext;
}

export interface RuleAssignmentInput {
  id: string;
  ruleSetId: string;
  ruleSetVersionId?: string;
  selectCurrentEdition?: boolean;
  organisationId?: string;
  subjectRef?: TypedRef;
  jurisdictionId?: string;
  populationPredicateId?: string;
  populationParameters?: Record<string, unknown>;
  validFrom: Instant;
  validUntil?: Instant;
  actor: ActorContext;
}

export interface PreferenceInput {
  preference: Preference & { ownerRef: TypedRef; evidenceId: string; valueSchemaVersion: string };
  actor: ActorContext;
}

export interface ObjectiveInput {
  objective: Objective & { dispositionEvidenceId?: string };
  actor: ActorContext;
}

export interface ConstraintInput {
  definition: ConstraintDefinition & {
    ownerRef: TypedRef;
    parameterSchemaVersion: string;
    parameterSchema?: Record<string, unknown>;
    provenanceEvidenceId?: string;
  };
  operands: {
    key: string;
    kind: 'SUBJECT_REF' | 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'INSTANT' | 'LOCAL_DATE';
    value: string | number | boolean | TypedRef;
  }[];
  actor: ActorContext;
}

export interface CoverageInput {
  coverage: KnowledgeCoverage & {
    evidenceId: string;
    queryBoundsVersion: string;
  };
  actor: ActorContext;
}

export interface InformationScopeInput {
  scope: InformationScope & { populationParameters?: Record<string, unknown> };
  actor: ActorContext;
}

export interface KnowledgeRepository {
  createSourceRecord(input: SourceRecordInput): Promise<void>;
  createEvidenceRecord(input: EvidenceRecordInput): Promise<void>;
  createInformationRecord(input: { record: InformationRecord; actor: ActorContext }): Promise<void>;
  findInformationVersionBySequence(
    workspaceId: string,
    informationRecordId: string,
    sequence: number,
  ): Promise<{ id: string; payloadHash: string; externalEditionSequence: number } | undefined>;
  latestInformationVersion(
    workspaceId: string,
    informationRecordId: string,
  ): Promise<{ id: string; payloadHash: string; externalEditionSequence: number } | undefined>;
  appendInformationVersion(input: InformationVersionInput): Promise<void>;
  createRuleSet(input: RuleSetInput): Promise<void>;
  createRuleAssignment(input: RuleAssignmentInput): Promise<void>;
  createPreference(input: PreferenceInput): Promise<void>;
  createObjective(input: ObjectiveInput): Promise<void>;
  createConstraintDefinition(input: ConstraintInput): Promise<void>;
  createInformationScope(input: InformationScopeInput): Promise<void>;
  createKnowledgeCoverage(input: CoverageInput): Promise<void>;
  quarantineInformation(input: {
    id: string;
    informationRecordId: string;
    externalEditionSequence?: number;
    subtype?: InformationVersion['subtype'];
    rejectionReason: string;
    rejectionDetail?: string;
    payloadHash: string;
    rejectedSummary?: Record<string, unknown>;
    sourceRecordId?: string;
    actor: ActorContext;
  }): Promise<void>;
}

export interface InformationVersionHit {
  informationVersionId: string;
  informationRecordId: string;
  publisherOrganisationId: string | null;
  topic: string;
  subtype: InformationVersion['subtype'];
  externalEditionSequence: number;
  issuedAt: Instant;
  receivedAt: Instant;
  observedAt: Instant;
  effectiveFrom: Instant | null;
  effectiveUntil: Instant | null;
  evidenceId: string;
  retracted: boolean;
}

export interface RuleAssignmentHit {
  assignmentId: string;
  ruleSetId: string;
  ruleSetVersionId: string | null;
  selectCurrentEdition: boolean;
  organisationId: string | null;
  subjectRef: TypedRef | null;
  jurisdictionId: string | null;
  validFrom: Instant;
  validUntil: Instant | null;
}

export interface KnowledgeReadQueries {
  applicableInformationVersions(params: {
    workspaceId: string;
    at: Instant;
    topic?: string;
    jurisdictionId?: string;
    areaVersionId?: string;
    subjectRef?: TypedRef;
    purpose?: string;
    serviceCategory?: string;
  }): Promise<InformationVersionHit[]>;
  ruleAssignmentsForSubject(params: { workspaceId: string; subjectRef: TypedRef; at: Instant }): Promise<RuleAssignmentHit[]>;
  informationScopesForVersion(workspaceId: string, informationVersionId: string): Promise<InformationScope[]>;
  expiredKnowledge(workspaceId: string, at: Instant): Promise<{ kind: 'INFORMATION_VERSION' | 'COVERAGE'; id: string; expiresAt: Instant }[]>;
  coverageForTopic(workspaceId: string, topic: string, at: Instant): Promise<(KnowledgeCoverage & { evidenceId?: string })[]>;
  governingObjectives(workspaceId: string, ownerRef: TypedRef): Promise<Objective[]>;
  governingConstraints(workspaceId: string, ownerRef: TypedRef): Promise<ConstraintDefinition[]>;
}
