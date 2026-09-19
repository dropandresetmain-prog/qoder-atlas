/**
 * M5 PostgreSQL repository. It owns typed knowledge rows only; command
 * handlers own identity registration, revisions, receipts, audit and outbox.
 * Every write is therefore on the ambient UnitOfWork client and every query is
 * workspace-qualified on every relationship.
 */
import type {
  ConstraintInput,
  CoverageInput,
  EvidenceRecordInput,
  InformationScopeInput,
  InformationVersionInput,
  KnowledgeRepository,
  ObjectiveInput,
  PreferenceInput,
  RuleAssignmentInput,
  RuleSetInput,
  SourceRecordInput,
} from '../../../contracts/v2/repository/knowledge.ts';
import { currentTransactionClient } from '../transactionContext.ts';

function json(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function assertActorWorkspace(actorWorkspaceId: string, workspaceId: string): void {
  if (actorWorkspaceId !== workspaceId) {
    throw new Error(`knowledge write workspace mismatch: actor=${actorWorkspaceId}, target=${workspaceId}`);
  }
}

function optionalProtectedRef(input: SourceRecordInput): [string | null, string | null, string | null] {
  const values = [input.rawContentHash, input.rawStorageRef ?? input.source.protectedLocationRef, input.rawAccessPolicyId];
  const supplied = values.some((value) => value !== undefined);
  if (!supplied) {
    return [null, null, null];
  }
  if (values.some((value) => value === undefined || value.trim().length === 0)) {
    throw new Error('a protected source reference requires rawContentHash, rawStorageRef and rawAccessPolicyId');
  }
  return values as [string, string, string];
}

export class PgKnowledgeRepository implements KnowledgeRepository {
  private readonly workspaceId: string;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
  }

  async createSourceRecord(input: SourceRecordInput): Promise<void> {
    assertActorWorkspace(input.actor.workspaceId, this.workspaceId);
    const client = currentTransactionClient();
    const [rawContentHash, rawStorageRef, rawAccessPolicyId] = optionalProtectedRef(input);
    await client.query(
      `INSERT INTO source_records
         (workspace_id, id, source_identity, received_at, content_hash, content_type,
          raw_content_hash, raw_storage_ref, raw_access_policy_id, capture_metadata,
          capture_metadata_version, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        this.workspaceId,
        input.source.id,
        input.source.sourceIdentity,
        input.source.receivedAt,
        input.source.contentHash,
        input.source.contentType,
        rawContentHash,
        rawStorageRef,
        rawAccessPolicyId,
        json(input.captureMetadata),
        input.captureMetadataVersion ?? 'source-record-v2/1',
        input.actor.actorPrincipalId,
      ],
    );
    if (rawContentHash && rawStorageRef && rawAccessPolicyId) {
      await client.query(
        `INSERT INTO source_content_refs
           (workspace_id, source_record_id, ref_kind, content_hash, storage_ref, access_policy_id)
         VALUES ($1, $2, 'RAW_DOCUMENT', $3, $4, $5)`,
        [this.workspaceId, input.source.id, rawContentHash, rawStorageRef, rawAccessPolicyId],
      );
    }
  }

  async createEvidenceRecord(input: EvidenceRecordInput): Promise<void> {
    assertActorWorkspace(input.actor.workspaceId, this.workspaceId);
    const client = currentTransactionClient();
    const evidence = input.evidence;
    await client.query(
      `INSERT INTO evidence_records
         (workspace_id, id, assertion_type, observed_at, issued_at, schema_version,
          interpretation_provenance, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        this.workspaceId,
        evidence.id,
        evidence.assertionType,
        evidence.observedAt,
        evidence.issuedAt ?? null,
        evidence.schemaVersion,
        evidence.interpretationProvenance ?? null,
        input.actor.actorPrincipalId,
      ],
    );
    const sourceIds = [...new Set(evidence.sourceIds)];
    for (const sourceId of sourceIds) {
      await client.query(
        `INSERT INTO evidence_sources (workspace_id, evidence_record_id, source_record_id)
         VALUES ($1, $2, $3)`,
        [this.workspaceId, evidence.id, sourceId],
      );
    }
    const seen = new Set<string>();
    for (const subject of evidence.subjectRefs) {
      const key = `${subject.kind}:${subject.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await client.query(
        `INSERT INTO evidence_subjects
           (workspace_id, evidence_record_id, subject_kind, subject_id)
         VALUES ($1, $2, $3, $4)`,
        [this.workspaceId, evidence.id, subject.kind, subject.id],
      );
    }
  }

  async createInformationRecord(input: { record: import('../../../domain/v2/knowledge/information.ts').InformationRecord; actor: import('../../../contracts/v2/repository/people.ts').ActorContext }): Promise<void> {
    assertActorWorkspace(input.actor.workspaceId, this.workspaceId);
    await currentTransactionClient().query(
      `INSERT INTO information_records
         (workspace_id, id, publisher_organisation_id, external_publication_key,
          topic, source_connection_identity, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        this.workspaceId,
        input.record.id,
        input.record.publisherOrganisationId ?? null,
        input.record.externalPublicationKey,
        input.record.topic,
        input.record.sourceConnectionIdentity ?? null,
        input.actor.actorPrincipalId,
      ],
    );
  }

  async findInformationVersionBySequence(
    workspaceId: string,
    informationRecordId: string,
    sequence: number,
  ): Promise<{ id: string; payloadHash: string; externalEditionSequence: number } | undefined> {
    if (workspaceId !== this.workspaceId) throw new Error('knowledge read workspace mismatch');
    const result = await currentTransactionClient().query<{
      id: string;
      payload_hash: string;
      external_edition_sequence: number;
    }>(
      `SELECT id, payload_hash, external_edition_sequence
         FROM information_versions
        WHERE workspace_id = $1 AND information_record_id = $2 AND external_edition_sequence = $3`,
      [this.workspaceId, informationRecordId, sequence],
    );
    const row = result.rows[0];
    return row
      ? { id: row.id, payloadHash: row.payload_hash, externalEditionSequence: Number(row.external_edition_sequence) }
      : undefined;
  }

  async latestInformationVersion(
    workspaceId: string,
    informationRecordId: string,
  ): Promise<{ id: string; payloadHash: string; externalEditionSequence: number } | undefined> {
    if (workspaceId !== this.workspaceId) throw new Error('knowledge read workspace mismatch');
    const result = await currentTransactionClient().query<{
      id: string;
      payload_hash: string;
      external_edition_sequence: number;
    }>(
      `SELECT id, payload_hash, external_edition_sequence
         FROM information_versions
        WHERE workspace_id = $1 AND information_record_id = $2
        ORDER BY external_edition_sequence DESC, id DESC
        LIMIT 1`,
      [this.workspaceId, informationRecordId],
    );
    const row = result.rows[0];
    return row
      ? { id: row.id, payloadHash: row.payload_hash, externalEditionSequence: Number(row.external_edition_sequence) }
      : undefined;
  }

  async appendInformationVersion(input: InformationVersionInput): Promise<void> {
    assertActorWorkspace(input.actor.workspaceId, this.workspaceId);
    const client = currentTransactionClient();
    const version = input.version;
    if (version.subtype !== input.detail.subtype) throw new Error('information version/detail subtype mismatch');
    await client.query(
      `INSERT INTO information_versions
         (workspace_id, id, information_record_id, subtype, external_edition_sequence,
          issued_at, received_at, observed_at, effective_from, effective_until,
          evidence_id, supersedes_information_version_id, retracts_information_version_id,
          source_native_severity, payload_hash, normalization_version, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        this.workspaceId,
        version.id,
        version.informationRecordId,
        version.subtype,
        version.externalEditionSequence,
        version.issuedAt,
        version.receivedAt,
        version.observedAt,
        version.effectiveWindow?.start ?? null,
        version.effectiveWindow?.end ?? null,
        version.evidenceId,
        version.supersedesInformationVersionId ?? null,
        version.retractsInformationVersionId ?? null,
        version.sourceNativeSeverity ?? (input.detail.subtype === 'ADVISORY' ? input.detail.detail.sourceNativeSeverity : null),
        input.payloadHash,
        input.normalizationVersion,
        input.actor.actorPrincipalId,
      ],
    );

    if (input.detail.subtype === 'ADVISORY') {
      const detail = input.detail.detail;
      await client.query(
        `INSERT INTO advisory_details
           (workspace_id, information_version_id, source_native_severity, risk_topics,
            publisher_meanings, source_native_detail, detail_schema_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          this.workspaceId,
          version.id,
          detail.sourceNativeSeverity,
          detail.riskTopics ?? [],
          json(detail.publisherMeanings ?? []),
          json(detail.sourceNativeDetail),
          detail.detailSchemaVersion,
        ],
      );
    } else if (input.detail.subtype === 'CONDITION') {
      const detail = input.detail.detail;
      await client.query(
        `INSERT INTO condition_details
           (workspace_id, information_version_id, condition_type, observation_basis,
            forecast_target_from, forecast_target_until, uncertainty_model,
            uncertainty_parameters, source_native_detail, detail_schema_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          this.workspaceId,
          version.id,
          detail.conditionType,
          detail.observationBasis,
          detail.forecastTarget?.start ?? null,
          detail.forecastTarget?.end ?? null,
          detail.uncertaintyModel ?? null,
          json(detail.uncertaintyParameters),
          json(detail.sourceNativeDetail),
          detail.detailSchemaVersion,
        ],
      );
    } else {
      const detail = input.detail.detail;
      await client.query(
        `INSERT INTO regulatory_publications
           (workspace_id, information_version_id, rule_set_version_id, rule_set_id,
            issuing_authority, jurisdiction_id, citation, published_at, published_by_actor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          this.workspaceId,
          version.id,
          detail.ruleSetVersionId,
          detail.ruleSetId,
          detail.issuingAuthority,
          detail.jurisdictionId ?? null,
          detail.citation ?? null,
          detail.publishedAt,
          detail.publishedByActorId,
        ],
      );
    }
  }

  async createRuleSet(input: RuleSetInput): Promise<void> {
    assertActorWorkspace(input.actor.workspaceId, this.workspaceId);
    const client = currentTransactionClient();
    await client.query(
      `INSERT INTO rule_sets
         (workspace_id, id, issuer_kind, issuer_id, policy_family, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        this.workspaceId,
        input.ruleSet.id,
        input.ruleSet.issuerRef.kind,
        input.ruleSet.issuerRef.id,
        input.ruleSet.policyFamily,
        input.actor.actorPrincipalId,
      ],
    );
    const version = input.version;
    await client.query(
      `INSERT INTO rule_set_versions
         (workspace_id, id, rule_set_id, edition_number, status, effective_from,
          effective_until, expression, published_at, published_by_actor_id, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        this.workspaceId,
        version.id,
        input.ruleSet.id,
        version.editionNumber,
        version.status,
        version.effectiveWindow?.start ?? null,
        version.effectiveWindow?.end ?? null,
        json(version.expression),
        version.status === 'DRAFT' ? null : (version as { publishedAt?: string }).publishedAt ?? null,
        version.status === 'DRAFT' ? null : (version as { publishedByActorId?: string }).publishedByActorId ?? null,
        input.actor.actorPrincipalId,
      ],
    );
    for (const rule of input.rules) {
      await client.query(
        `INSERT INTO rules
           (workspace_id, id, rule_set_version_id, rule_key, statement, expression, severity, created_by_actor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          this.workspaceId,
          rule.id,
          version.id,
          rule.ruleKey,
          rule.statement,
          json(rule.expression),
          rule.severity ?? 'INFORMATIONAL',
          input.actor.actorPrincipalId,
        ],
      );
    }
  }

  async createRuleAssignment(input: RuleAssignmentInput): Promise<void> {
    assertActorWorkspace(input.actor.workspaceId, this.workspaceId);
    const subject = input.subjectRef;
    await currentTransactionClient().query(
      `INSERT INTO rule_assignments
         (workspace_id, id, rule_set_id, rule_set_version_id, select_current_edition,
          organisation_id, subject_kind, subject_id, jurisdiction_id,
          population_predicate_id, population_parameters, valid_from, valid_until,
          created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        this.workspaceId,
        input.id,
        input.ruleSetId,
        input.ruleSetVersionId ?? null,
        input.selectCurrentEdition ?? false,
        input.organisationId ?? null,
        subject?.kind ?? null,
        subject?.id ?? null,
        input.jurisdictionId ?? null,
        input.populationPredicateId ?? null,
        json(input.populationParameters),
        input.validFrom,
        input.validUntil ?? null,
        input.actor.actorPrincipalId,
      ],
    );
  }

  async createPreference(input: PreferenceInput): Promise<void> {
    assertActorWorkspace(input.actor.workspaceId, this.workspaceId);
    const preference = input.preference;
    const effectiveFrom = preference.effectiveWindow?.start;
    if (!effectiveFrom) throw new Error('preference effectiveWindow.start is required by persistence');
    await currentTransactionClient().query(
      `INSERT INTO preferences
         (workspace_id, id, owner_kind, owner_id, preference_kind, source, value,
          value_schema_version, evidence_id, effective_from, effective_until,
          supersedes_preference_id, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        this.workspaceId,
        preference.id,
        preference.ownerRef.kind,
        preference.ownerRef.id,
        preference.preferenceKind,
        preference.source,
        json(preference.value),
        preference.valueSchemaVersion,
        preference.evidenceId,
        effectiveFrom,
        preference.effectiveWindow?.end ?? null,
        preference.supersedesPreferenceId ?? null,
        input.actor.actorPrincipalId,
      ],
    );
  }

  async createObjective(input: ObjectiveInput): Promise<void> {
    assertActorWorkspace(input.actor.workspaceId, this.workspaceId);
    const objective = input.objective;
    const client = currentTransactionClient();
    await client.query(
      `INSERT INTO objectives
         (workspace_id, id, owner_kind, owner_id, success_predicate, success_predicate_kind,
          hardness, priority, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        this.workspaceId,
        objective.id,
        objective.ownerKind,
        objective.ownerId,
        objective.successPredicate,
        objective.successPredicateKind ?? 'STATEMENT',
        objective.hardness,
        objective.priority,
        input.actor.actorPrincipalId,
      ],
    );
    if (objective.targets && objective.targets.length > 0) {
      await this.recordObjectiveTargets({
        objectiveId: objective.id,
        targets: objective.targets,
        actor: input.actor,
      });
    }
    if (objective.disposition !== 'ACTIVE') {
      if (!objective.dispositionEvidenceId) throw new Error('terminal objective disposition requires evidence');
      await client.query(
        `INSERT INTO objective_dispositions
           (workspace_id, objective_id, sequence_number, disposition, evidence_id, decided_by_actor_id)
         VALUES ($1, $2, 1, $3, $4, $5)`,
        [this.workspaceId, objective.id, objective.disposition, objective.dispositionEvidenceId, input.actor.actorPrincipalId],
      );
    }
  }

  async recordObjectiveTargets(input: {
    objectiveId: string;
    targets: NonNullable<import('../../../domain/v2/knowledge/information.ts').Objective['targets']>;
    actor: { workspaceId: string; actorPrincipalId: string };
  }): Promise<void> {
    assertActorWorkspace(input.actor.workspaceId, this.workspaceId);
    const client = currentTransactionClient();
    for (const target of input.targets) {
      await client.query(
        `INSERT INTO objective_targets
           (workspace_id, objective_id, target_kind, subject_kind, subject_id, place_id,
            at_or_before, amount_minor, currency_code, label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          this.workspaceId,
          input.objectiveId,
          target.targetKind,
          target.subject?.kind ?? null,
          target.subject?.id ?? null,
          target.placeId ?? null,
          target.atOrBefore ?? null,
          target.amountMinor ?? null,
          target.currencyCode ?? null,
          target.label,
        ],
      );
    }
  }

  async recordObjectiveDisposition(input: {
    objectiveId: string;
    disposition: string;
    evidenceId: string;
    reason?: string;
    objectiveTargetLabel?: string;
    actor: { workspaceId: string; actorPrincipalId: string };
  }): Promise<void> {
    assertActorWorkspace(input.actor.workspaceId, this.workspaceId);
    const client = currentTransactionClient();
    const seq = await client.query<{ n: string }>(
      `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS n
         FROM objective_dispositions
        WHERE workspace_id = $1 AND objective_id = $2`,
      [this.workspaceId, input.objectiveId],
    );
    await client.query(
      `INSERT INTO objective_dispositions
         (workspace_id, objective_id, sequence_number, disposition, evidence_id,
          objective_target_label, reason, decided_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        this.workspaceId,
        input.objectiveId,
        Number(seq.rows[0]?.n ?? 1),
        input.disposition,
        input.evidenceId,
        input.objectiveTargetLabel ?? null,
        input.reason ?? null,
        input.actor.actorPrincipalId,
      ],
    );
  }

  async createConstraintDefinition(input: ConstraintInput): Promise<void> {
    assertActorWorkspace(input.actor.workspaceId, this.workspaceId);
    const definition = input.definition;
    const client = currentTransactionClient();
    await client.query(
      `INSERT INTO constraint_definitions
         (workspace_id, id, registered_type, hardness, owner_kind, owner_id,
          parameter_schema_version, parameter_schema, provenance_evidence_id, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        this.workspaceId,
        definition.id,
        definition.registeredType,
        definition.hardness,
        definition.ownerRef.kind,
        definition.ownerRef.id,
        definition.parameterSchemaVersion,
        json(definition.parameterSchema),
        definition.provenanceEvidenceId ?? null,
        input.actor.actorPrincipalId,
      ],
    );
    for (const operand of input.operands) {
      const value = operand.value;
      const subjectValue = operand.kind === 'SUBJECT_REF' ? value as { kind: string; id: string } : undefined;
      await client.query(
        `INSERT INTO constraint_operands
           (workspace_id, constraint_definition_id, operand_key, operand_kind,
            subject_kind, subject_id, text_value, number_value, boolean_value,
            instant_value, local_date_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          this.workspaceId,
          definition.id,
          operand.key,
          operand.kind,
          subjectValue?.kind ?? null,
          subjectValue?.id ?? null,
          operand.kind === 'TEXT' ? value : null,
          operand.kind === 'NUMBER' ? value : null,
          operand.kind === 'BOOLEAN' ? value : null,
          operand.kind === 'INSTANT' ? value : null,
          operand.kind === 'LOCAL_DATE' ? value : null,
        ],
      );
    }
  }

  async createInformationScope(input: InformationScopeInput): Promise<void> {
    assertActorWorkspace(input.actor.workspaceId, this.workspaceId);
    const scope = input.scope;
    const subject = scope.subjectRef;
    await currentTransactionClient().query(
      `INSERT INTO information_scopes
         (workspace_id, id, information_version_id, area_version_id, jurisdiction_id,
          population_predicate_id, population_parameters, subject_kind, subject_id,
          purpose, service_category, effective_exposure_from, effective_exposure_until,
          created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        this.workspaceId,
        scope.id,
        input.scope.informationVersionId,
        scope.areaVersionId ?? null,
        scope.jurisdictionId ?? null,
        scope.populationPredicate ?? null,
        json(scope.populationParameters),
        subject?.kind ?? null,
        subject?.id ?? null,
        scope.purpose ?? null,
        scope.serviceCategory ?? null,
        scope.effectiveExposure.start,
        scope.effectiveExposure.end,
        input.actor.actorPrincipalId,
      ],
    );
  }

  async createKnowledgeCoverage(input: CoverageInput): Promise<void> {
    assertActorWorkspace(input.actor.workspaceId, this.workspaceId);
    const coverage = input.coverage;
    await currentTransactionClient().query(
      `INSERT INTO knowledge_coverage
         (workspace_id, id, topic, query_bounds, query_bounds_version, edition,
          watermark, completeness, completeness_limitations, expires_at, evidence_id,
          created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        this.workspaceId,
        coverage.id,
        coverage.topic,
        json(coverage.queryBounds),
        coverage.queryBoundsVersion,
        coverage.edition,
        coverage.watermark ?? null,
        coverage.completeness,
        coverage.completenessLimitations,
        coverage.expiresAt ?? null,
        coverage.evidenceId,
        input.actor.actorPrincipalId,
      ],
    );
  }

  async quarantineInformation(input: {
    id: string;
    informationRecordId: string;
    externalEditionSequence?: number;
    subtype?: 'ADVISORY' | 'CONDITION' | 'REGULATORY';
    rejectionReason: string;
    rejectionDetail?: string;
    payloadHash: string;
    rejectedSummary?: Record<string, unknown>;
    sourceRecordId?: string;
    actor: { workspaceId: string; actorPrincipalId: string };
  }): Promise<void> {
    assertActorWorkspace(input.actor.workspaceId, this.workspaceId);
    await currentTransactionClient().query(
      `INSERT INTO information_quarantine
         (workspace_id, id, information_record_id, external_edition_sequence, subtype,
          rejection_reason, rejection_detail, payload_hash, rejected_summary,
          source_record_id, created_by_actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        this.workspaceId,
        input.id,
        input.informationRecordId,
        input.externalEditionSequence ?? null,
        input.subtype ?? null,
        input.rejectionReason,
        input.rejectionDetail ?? null,
        input.payloadHash,
        json(input.rejectedSummary),
        input.sourceRecordId ?? null,
        input.actor.actorPrincipalId,
      ],
    );
  }
}

/** One stored preference row as read for planning (no precedence applied here). */
export interface StoredPreferenceRow {
  id: string;
  ownerKind: string;
  ownerId: string;
  preferenceKind: string;
  source: 'EXPLICIT' | 'INFERRED';
  value: Record<string, unknown>;
  valueSchemaVersion: string;
  effectiveFrom: string;
}

/**
 * G09 reader: the preferences of the given owners that are effective at `at`
 * and not superseded by another effective edition. Read-only, pool-based
 * (planning reads outside a unit of work), workspace-qualified. Precedence
 * (EXPLICIT over INFERRED) is deliberately NOT applied here — that is planning
 * policy and lives in `planningPreferences.ts`.
 */
export async function readEffectivePreferences(
  pool: { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> },
  workspaceId: string,
  ownerIds: readonly string[],
  at: string,
): Promise<StoredPreferenceRow[]> {
  if (ownerIds.length === 0) return [];
  const result = await pool.query(
    `SELECT p.id, p.owner_kind, p.owner_id, p.preference_kind, p.source, p.value,
            p.value_schema_version, p.effective_from
       FROM preferences p
      WHERE p.workspace_id = $1
        AND p.owner_id = ANY($2::uuid[])
        AND p.effective_from <= $3::timestamptz
        AND (p.effective_until IS NULL OR p.effective_until > $3::timestamptz)
        AND NOT EXISTS (
          SELECT 1 FROM preferences s
           WHERE s.workspace_id = p.workspace_id
             AND s.supersedes_preference_id = p.id
             AND s.effective_from <= $3::timestamptz)
      ORDER BY p.owner_kind, p.owner_id, p.preference_kind, p.effective_from, p.id`,
    [workspaceId, [...ownerIds], at],
  );
  return result.rows.map((row) => ({
    id: row.id,
    ownerKind: row.owner_kind,
    ownerId: row.owner_id,
    preferenceKind: row.preference_kind,
    source: row.source,
    value: row.value,
    valueSchemaVersion: row.value_schema_version,
    effectiveFrom: new Date(row.effective_from).toISOString(),
  }));
}
