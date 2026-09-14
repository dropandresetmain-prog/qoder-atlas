-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §6: `evidence_records` / `evidence_subjects`
-- / `evidence_sources` are the immutable normalization layer between raw
-- captures (0070) and every assertion that cites them. "M:n subjects and
-- captures; no silent evidence rewrite. Typed indexed fields extracted for
-- evaluation" — the type + observed/issued times + schema version are columns,
-- exactly the fields every later lane filters on.
--
-- Frozen contract: src/domain/v2/knowledge/information.ts EvidenceRecordSchema
-- (assertionType, observedAt, issuedAt?, schemaVersion, sourceIds[],
-- subjectRefs[], interpretationProvenance?).
--
-- This is the table M2's deferred §7A ledger pointed at; 0085 closes those FKs.

CREATE TABLE evidence_records (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  assertion_type text NOT NULL CHECK (length(btrim(assertion_type)) > 0),
  observed_at timestamptz NOT NULL,
  issued_at timestamptz,
  schema_version text NOT NULL CHECK (length(btrim(schema_version)) > 0),
  interpretation_provenance text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT evidence_records_provenance_size CHECK (
    interpretation_provenance IS NULL OR length(interpretation_provenance) <= 2048
  )
);

-- Immutable normalized assertion: a correction is a new evidence row that cites
-- the old one through whatever supersedes column the owning family defines —
-- never an in-place rewrite.
CREATE TRIGGER evidence_records_immutable
  BEFORE UPDATE OR DELETE ON evidence_records
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- M:n captures (§6 "evidence_sources").
CREATE TABLE evidence_sources (
  workspace_id uuid NOT NULL,
  evidence_record_id uuid NOT NULL,
  source_record_id uuid NOT NULL,
  -- Which protected content of the capture backs the assertion (0070 ref_kind);
  -- bounded provenance detail, not free prose.
  extraction_provenance text CHECK (extraction_provenance IS NULL OR length(extraction_provenance) <= 2048),
  PRIMARY KEY (workspace_id, evidence_record_id, source_record_id),
  CONSTRAINT evidence_sources_evidence_fk
    FOREIGN KEY (workspace_id, evidence_record_id) REFERENCES evidence_records (workspace_id, id),
  CONSTRAINT evidence_sources_source_fk
    FOREIGN KEY (workspace_id, source_record_id) REFERENCES source_records (workspace_id, id)
);

CREATE TRIGGER evidence_sources_immutable
  BEFORE UPDATE OR DELETE ON evidence_sources
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE INDEX idx_evidence_sources_source ON evidence_sources (workspace_id, source_record_id);

-- M:n subjects (§6 "evidence_subjects"). TypedRef identity, so the
-- discriminating unique index from 0019 makes a wrong-kind reference
-- structurally unsatisfiable.
CREATE TABLE evidence_subjects (
  workspace_id uuid NOT NULL,
  evidence_record_id uuid NOT NULL,
  subject_kind text NOT NULL REFERENCES subject_kinds (kind),
  subject_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, evidence_record_id, subject_kind, subject_id),
  CONSTRAINT evidence_subjects_evidence_fk
    FOREIGN KEY (workspace_id, evidence_record_id) REFERENCES evidence_records (workspace_id, id),
  CONSTRAINT evidence_subjects_subject_fk
    FOREIGN KEY (workspace_id, subject_kind, subject_id)
    REFERENCES domain_subjects (workspace_id, id, kind)
);

CREATE TRIGGER evidence_subjects_immutable
  BEFORE UPDATE OR DELETE ON evidence_subjects
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE INDEX idx_evidence_subjects_subject ON evidence_subjects (workspace_id, subject_kind, subject_id);
CREATE INDEX idx_evidence_records_type ON evidence_records (workspace_id, assertion_type, observed_at DESC);

-- ---------------------------------------------------------------------------
-- Subtype checker for EVIDENCE_RECORD (0010 extension contract).
-- ---------------------------------------------------------------------------
CREATE FUNCTION enforce_subject_subtype_evidence_record(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: EVIDENCE_RECORD subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM evidence_records e
     WHERE e.workspace_id = p_workspace_id AND e.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: EVIDENCE_RECORD subject % has no evidence_records row', p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('EVIDENCE_RECORD', 'enforce_subject_subtype_evidence_record', 'M5');
