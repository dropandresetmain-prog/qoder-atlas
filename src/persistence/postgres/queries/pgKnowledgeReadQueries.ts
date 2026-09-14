/**
 * M5/M6 read ports. Applicability is evaluated from typed scope columns and
 * effective intervals; no method parses source prose or JSON predicates.
 */
import type {
  ConstraintDefinition,
  InformationScope,
  KnowledgeCoverage,
  Objective,
} from '../../../domain/v2/knowledge/information.ts';
import type { SubjectKind, TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { Instant } from '../../../domain/v2/shared/time.ts';
import type {
  InformationVersionHit,
  KnowledgeReadQueries,
  RuleAssignmentHit,
} from '../../../contracts/v2/repository/knowledge.ts';
import type { Queryable } from '../commandSupport.ts';

interface InformationVersionRow {
  information_version_id: string;
  information_record_id: string;
  publisher_organisation_id: string | null;
  topic: string;
  subtype: 'ADVISORY' | 'CONDITION' | 'REGULATORY';
  external_edition_sequence: number;
  issued_at: string;
  received_at: string;
  observed_at: string;
  effective_from: string | null;
  effective_until: string | null;
  evidence_id: string;
  retracted: boolean;
}

interface RuleAssignmentRow {
  assignment_id: string;
  rule_set_id: string;
  rule_set_version_id: string | null;
  select_current_edition: boolean;
  organisation_id: string | null;
  subject_kind: SubjectKind | null;
  subject_id: string | null;
  jurisdiction_id: string | null;
  valid_from: string;
  valid_until: string | null;
}

interface ScopeRow {
  id: string;
  information_version_id: string;
  area_version_id: string | null;
  jurisdiction_id: string | null;
  population_predicate_id: string | null;
  population_parameters: Record<string, unknown>;
  subject_kind: SubjectKind | null;
  subject_id: string | null;
  purpose: string | null;
  service_category: string | null;
  effective_exposure_from: string;
  effective_exposure_until: string;
}

interface CoverageRow {
  id: string;
  query_bounds: Record<string, unknown>;
  query_bounds_version: string;
  topic: string;
  edition: string;
  watermark: string | null;
  completeness: KnowledgeCoverage['completeness'];
  completeness_limitations: string[];
  expires_at: string | null;
  evidence_id: string;
}

interface ObjectiveRow {
  id: string;
  owner_kind: Objective['ownerKind'];
  owner_id: string;
  success_predicate: string;
  hardness: Objective['hardness'];
  priority: number;
  disposition: Objective['disposition'] | null;
  disposition_evidence_id: string | null;
}

interface ConstraintRow {
  id: string;
  registered_type: string;
  hardness: ConstraintDefinition['hardness'];
  owner_kind: SubjectKind;
  owner_id: string;
  provenance_evidence_id: string | null;
}

function typedRef(kind: SubjectKind | null, id: string | null): TypedRef | null {
  return kind && id ? { kind, id } : null;
}

export class PgKnowledgeReadQueries implements KnowledgeReadQueries {
  private readonly db: Queryable;
  private readonly workspaceId: string;

  constructor(db: Queryable, workspaceId: string) {
    this.db = db;
    this.workspaceId = workspaceId;
  }

  async applicableInformationVersions(params: {
    workspaceId: string;
    at: Instant;
    topic?: string;
    jurisdictionId?: string;
    areaVersionId?: string;
    subjectRef?: TypedRef;
    purpose?: string;
    serviceCategory?: string;
  }): Promise<InformationVersionHit[]> {
    const subject = params.subjectRef;
    const result = await this.db.query<InformationVersionRow>(
      `SELECT v.id AS information_version_id,
              v.information_record_id,
              r.publisher_organisation_id,
              r.topic,
              v.subtype,
              v.external_edition_sequence,
              to_char(v.issued_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS issued_at,
              to_char(v.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS received_at,
              to_char(v.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at,
              to_char(v.effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS effective_from,
              to_char(v.effective_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS effective_until,
              v.evidence_id,
              EXISTS (
                SELECT 1 FROM information_versions later
                 WHERE later.workspace_id = v.workspace_id
                   AND later.retracts_information_version_id = v.id
              ) AS retracted
         FROM information_versions v
         JOIN information_records r
           ON r.workspace_id = v.workspace_id AND r.id = v.information_record_id
        WHERE v.workspace_id = $1
          AND (v.effective_from IS NULL OR (v.effective_from <= $2::timestamptz
               AND (v.effective_until IS NULL OR v.effective_until > $2::timestamptz)))
          AND ($3::text IS NULL OR r.topic = $3)
          AND EXISTS (
            SELECT 1 FROM information_scopes s
             WHERE s.workspace_id = v.workspace_id
               AND s.information_version_id = v.id
               AND s.effective_exposure_from <= $2::timestamptz
               AND s.effective_exposure_until > $2::timestamptz
               AND ($4::uuid IS NULL OR s.jurisdiction_id = $4)
               AND ($5::uuid IS NULL OR s.area_version_id = $5)
               AND ($6::text IS NULL OR s.subject_kind = $6)
               AND ($7::uuid IS NULL OR s.subject_id = $7)
               AND ($8::text IS NULL OR s.purpose = $8)
               AND ($9::text IS NULL OR s.service_category = $9)
          )
        ORDER BY r.topic, v.information_record_id, v.external_edition_sequence DESC, v.id`,
      [
        this.scoped(params.workspaceId),
        params.at,
        params.topic ?? null,
        params.jurisdictionId ?? null,
        params.areaVersionId ?? null,
        subject?.kind ?? null,
        subject?.id ?? null,
        params.purpose ?? null,
        params.serviceCategory ?? null,
      ],
    );
    return result.rows.map((row) => ({
      informationVersionId: row.information_version_id,
      informationRecordId: row.information_record_id,
      publisherOrganisationId: row.publisher_organisation_id,
      topic: row.topic,
      subtype: row.subtype,
      externalEditionSequence: Number(row.external_edition_sequence),
      issuedAt: row.issued_at as Instant,
      receivedAt: row.received_at as Instant,
      observedAt: row.observed_at as Instant,
      effectiveFrom: row.effective_from as Instant | null,
      effectiveUntil: row.effective_until as Instant | null,
      evidenceId: row.evidence_id,
      retracted: row.retracted,
    }));
  }

  async ruleAssignmentsForSubject(params: { workspaceId: string; subjectRef: TypedRef; at: Instant }): Promise<RuleAssignmentHit[]> {
    const result = await this.db.query<RuleAssignmentRow>(
      `SELECT id AS assignment_id, rule_set_id, rule_set_version_id,
              select_current_edition, organisation_id, subject_kind, subject_id,
              jurisdiction_id,
              to_char(valid_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS valid_from,
              to_char(valid_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS valid_until
         FROM rule_assignments
        WHERE workspace_id = $1
          AND subject_kind = $2 AND subject_id = $3
          AND valid_from <= $4::timestamptz
          AND (valid_until IS NULL OR valid_until > $4::timestamptz)
        ORDER BY id`,
      [this.scoped(params.workspaceId), params.subjectRef.kind, params.subjectRef.id, params.at],
    );
    return result.rows.map((row) => ({
      assignmentId: row.assignment_id,
      ruleSetId: row.rule_set_id,
      ruleSetVersionId: row.rule_set_version_id,
      selectCurrentEdition: row.select_current_edition,
      organisationId: row.organisation_id,
      subjectRef: typedRef(row.subject_kind, row.subject_id),
      jurisdictionId: row.jurisdiction_id,
      validFrom: row.valid_from as Instant,
      validUntil: row.valid_until as Instant | null,
    }));
  }

  async informationScopesForVersion(workspaceId: string, informationVersionId: string): Promise<InformationScope[]> {
    const result = await this.db.query<ScopeRow>(
      `SELECT id, information_version_id, area_version_id, jurisdiction_id,
              population_predicate_id, population_parameters, subject_kind, subject_id,
              purpose, service_category,
              to_char(effective_exposure_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS effective_exposure_from,
              to_char(effective_exposure_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS effective_exposure_until
         FROM information_scopes
        WHERE workspace_id = $1 AND information_version_id = $2
        ORDER BY id`,
      [this.scoped(workspaceId), informationVersionId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      informationVersionId: row.information_version_id,
      populationParameters: row.population_parameters,
      ...(row.area_version_id ? { areaVersionId: row.area_version_id } : {}),
      ...(row.jurisdiction_id ? { jurisdictionId: row.jurisdiction_id } : {}),
      ...(row.population_predicate_id ? { populationPredicate: row.population_predicate_id } : {}),
      ...(typedRef(row.subject_kind, row.subject_id) ? { subjectRef: typedRef(row.subject_kind, row.subject_id)! } : {}),
      ...(row.purpose ? { purpose: row.purpose } : {}),
      ...(row.service_category ? { serviceCategory: row.service_category } : {}),
      effectiveExposure: { start: row.effective_exposure_from, end: row.effective_exposure_until },
    }));
  }

  async expiredKnowledge(workspaceId: string, at: Instant): Promise<{ kind: 'INFORMATION_VERSION' | 'COVERAGE'; id: string; expiresAt: Instant }[]> {
    const result = await this.db.query<{ kind: 'INFORMATION_VERSION' | 'COVERAGE'; id: string; expires_at: string }>(
      `SELECT 'INFORMATION_VERSION'::text AS kind, id,
              to_char(effective_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at
         FROM information_versions
        WHERE workspace_id = $1 AND effective_until IS NOT NULL AND effective_until <= $2::timestamptz
       UNION ALL
       SELECT 'COVERAGE'::text AS kind, id,
              to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at
         FROM knowledge_coverage
        WHERE workspace_id = $1 AND expires_at IS NOT NULL AND expires_at <= $2::timestamptz
        ORDER BY expires_at, kind, id`,
      [this.scoped(workspaceId), at],
    );
    return result.rows.map((row) => ({ kind: row.kind, id: row.id, expiresAt: row.expires_at as Instant }));
  }

  async coverageForTopic(workspaceId: string, topic: string, at: Instant): Promise<(KnowledgeCoverage & { evidenceId?: string })[]> {
    const result = await this.db.query<CoverageRow>(
      `SELECT id, query_bounds, query_bounds_version, topic, edition, watermark,
              completeness, completeness_limitations,
              to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at,
              evidence_id
         FROM knowledge_coverage
        WHERE workspace_id = $1 AND topic = $2
          AND (expires_at IS NULL OR expires_at > $3::timestamptz)
        ORDER BY created_at DESC, id`,
      [this.scoped(workspaceId), topic, at],
    );
    return result.rows.map((row) => ({
      id: row.id,
      queryBounds: row.query_bounds,
      queryBoundsVersion: row.query_bounds_version,
      topic: row.topic,
      edition: row.edition,
      watermark: row.watermark ?? undefined,
      completeness: row.completeness,
      completenessLimitations: row.completeness_limitations,
      ...(row.expires_at ? { expiresAt: row.expires_at as Instant } : {}),
      evidenceId: row.evidence_id,
    }));
  }

  async governingObjectives(workspaceId: string, ownerRef: TypedRef): Promise<Objective[]> {
    const result = await this.db.query<ObjectiveRow>(
      `SELECT o.id, o.owner_kind, o.owner_id, o.success_predicate, o.hardness, o.priority,
              latest.disposition, latest.evidence_id AS disposition_evidence_id
         FROM objectives o
         LEFT JOIN LATERAL (
           SELECT d.disposition, d.evidence_id
             FROM objective_dispositions d
            WHERE d.workspace_id = o.workspace_id AND d.objective_id = o.id
            ORDER BY d.sequence_number DESC
            LIMIT 1
         ) latest ON true
        WHERE o.workspace_id = $1 AND o.owner_kind = $2 AND o.owner_id = $3
        ORDER BY o.priority DESC, o.id`,
      [this.scoped(workspaceId), ownerRef.kind, ownerRef.id],
    );
    return result.rows.map((row) => ({
      id: row.id,
      ownerKind: row.owner_kind,
      ownerId: row.owner_id,
      successPredicate: row.success_predicate,
      hardness: row.hardness,
      priority: Number(row.priority),
      disposition: row.disposition ?? 'ACTIVE',
      ...(row.disposition_evidence_id ? { dispositionEvidenceId: row.disposition_evidence_id } : {}),
    }));
  }

  async governingConstraints(workspaceId: string, ownerRef: TypedRef): Promise<ConstraintDefinition[]> {
    const result = await this.db.query<ConstraintRow>(
      `SELECT id, registered_type, hardness, owner_kind, owner_id, provenance_evidence_id
         FROM constraint_definitions
        WHERE workspace_id = $1 AND owner_kind = $2 AND owner_id = $3
        ORDER BY id`,
      [this.scoped(workspaceId), ownerRef.kind, ownerRef.id],
    );
    const operands = await Promise.all(result.rows.map(async (row) => {
      const operandRows = await this.db.query<{
        operand_key: string;
        operand_kind: 'SUBJECT_REF' | 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'INSTANT' | 'LOCAL_DATE';
        subject_kind: SubjectKind | null;
        subject_id: string | null;
        text_value: string | null;
        number_value: number | null;
        boolean_value: boolean | null;
        instant_value: string | null;
        local_date_value: string | null;
      }>(
        `SELECT operand_key, operand_kind, subject_kind, subject_id, text_value,
                number_value, boolean_value, instant_value, local_date_value
           FROM constraint_operands
          WHERE workspace_id = $1 AND constraint_definition_id = $2
          ORDER BY operand_key`,
        [this.scoped(workspaceId), row.id],
      );
      const values: Record<string, unknown> = {};
      for (const operand of operandRows.rows) {
        values[operand.operand_key] = operand.operand_kind === 'SUBJECT_REF'
          ? { kind: operand.subject_kind, id: operand.subject_id }
          : operand.operand_kind === 'TEXT' ? operand.text_value
            : operand.operand_kind === 'NUMBER' ? Number(operand.number_value)
              : operand.operand_kind === 'BOOLEAN' ? operand.boolean_value
                : operand.operand_kind === 'INSTANT' ? operand.instant_value
                  : operand.local_date_value;
      }
      return [row.id, values] as const;
    }));
    const byDefinition = new Map(operands);
    return result.rows.map((row) => ({
      id: row.id,
      registeredType: row.registered_type,
      hardness: row.hardness,
      ownerRef: { kind: row.owner_kind, id: row.owner_id },
      operands: byDefinition.get(row.id) ?? {},
      ...(row.provenance_evidence_id ? { provenanceEvidenceId: row.provenance_evidence_id } : {}),
    }));
  }

  private scoped(workspaceId: string): string {
    if (workspaceId !== this.workspaceId) {
      throw new Error(`PgKnowledgeReadQueries is bound to workspace ${this.workspaceId}; refuses ${workspaceId}`);
    }
    return workspaceId;
  }
}
