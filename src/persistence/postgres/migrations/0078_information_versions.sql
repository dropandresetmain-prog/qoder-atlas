-- M5: immutable editions within one publisher/publication lineage.
-- issued/observed/received/effective times are deliberately separate. A late
-- receipt is history, not a new effective observation.

CREATE TABLE information_versions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  information_record_id uuid NOT NULL,
  subtype text NOT NULL CHECK (subtype IN ('ADVISORY', 'CONDITION', 'REGULATORY')),
  external_edition_sequence integer NOT NULL CHECK (external_edition_sequence >= 0),
  issued_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  effective_from timestamptz,
  effective_until timestamptz,
  evidence_id uuid NOT NULL,
  supersedes_information_version_id uuid,
  retracts_information_version_id uuid,
  source_native_severity text,
  payload_hash text NOT NULL CHECK (length(payload_hash) >= 16),
  normalization_version text NOT NULL CHECK (length(btrim(normalization_version)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT information_versions_record_fk
    FOREIGN KEY (workspace_id, information_record_id)
    REFERENCES information_records (workspace_id, id),
  CONSTRAINT information_versions_evidence_fk
    FOREIGN KEY (workspace_id, evidence_id)
    REFERENCES evidence_records (workspace_id, id),
  CONSTRAINT information_versions_lineage_edition_unique
    UNIQUE (workspace_id, information_record_id, external_edition_sequence),
  CONSTRAINT information_versions_supersedes_fk
    FOREIGN KEY (workspace_id, supersedes_information_version_id)
    REFERENCES information_versions (workspace_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT information_versions_retracts_fk
    FOREIGN KEY (workspace_id, retracts_information_version_id)
    REFERENCES information_versions (workspace_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT information_versions_effective_ordered CHECK (
    effective_until IS NULL OR (effective_from IS NOT NULL AND effective_until > effective_from)
  ),
  CONSTRAINT information_versions_not_self_superseding CHECK (
    supersedes_information_version_id IS NULL OR supersedes_information_version_id <> id
  ),
  CONSTRAINT information_versions_not_self_retracting CHECK (
    retracts_information_version_id IS NULL OR retracts_information_version_id <> id
  ),
  CONSTRAINT information_versions_supersedes_xor_retracts CHECK (
    NOT (supersedes_information_version_id IS NOT NULL AND retracts_information_version_id IS NOT NULL)
  ),
  CONSTRAINT information_versions_severity_size CHECK (
    source_native_severity IS NULL OR length(source_native_severity) <= 256
  )
);

CREATE TRIGGER information_versions_immutable
  BEFORE UPDATE OR DELETE ON information_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE INDEX idx_information_versions_record
  ON information_versions (workspace_id, information_record_id, external_edition_sequence DESC);
CREATE INDEX idx_information_versions_effective
  ON information_versions (workspace_id, effective_from, effective_until)
  WHERE effective_from IS NOT NULL;
CREATE INDEX idx_information_versions_effective_until
  ON information_versions (workspace_id, effective_until)
  WHERE effective_until IS NOT NULL;
CREATE INDEX idx_information_versions_received
  ON information_versions (workspace_id, information_record_id, received_at DESC);

-- A correction/retraction can only cite an edition in the same publisher
-- lineage. Cross-workspace safety is already structural in the composite FK.
CREATE FUNCTION assert_information_version_lineage_link() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_previous_record uuid;
  v_previous_sequence integer;
BEGIN
  IF NEW.supersedes_information_version_id IS NOT NULL THEN
    SELECT information_record_id, external_edition_sequence
      INTO v_previous_record, v_previous_sequence
      FROM information_versions
     WHERE workspace_id = NEW.workspace_id AND id = NEW.supersedes_information_version_id;
    IF v_previous_record <> NEW.information_record_id THEN
      RAISE EXCEPTION
        'information_versions violation: % supersedes another publisher lineage', NEW.id;
    END IF;
    IF v_previous_sequence >= NEW.external_edition_sequence THEN
      RAISE EXCEPTION
        'information_versions violation: correction sequence must advance lineage';
    END IF;
  END IF;
  IF NEW.retracts_information_version_id IS NOT NULL THEN
    SELECT information_record_id, external_edition_sequence
      INTO v_previous_record, v_previous_sequence
      FROM information_versions
     WHERE workspace_id = NEW.workspace_id AND id = NEW.retracts_information_version_id;
    IF v_previous_record <> NEW.information_record_id THEN
      RAISE EXCEPTION
        'information_versions violation: % retracts another publisher lineage', NEW.id;
    END IF;
    IF v_previous_sequence >= NEW.external_edition_sequence THEN
      RAISE EXCEPTION
        'information_versions violation: retraction sequence must advance lineage';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER information_versions_lineage_link_assert
  AFTER INSERT ON information_versions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_information_version_lineage_link();

CREATE FUNCTION enforce_subject_subtype_information_version(
  p_workspace_id uuid, p_id uuid, p_kind text, p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_record uuid;
  v_subtype text;
  v_detail_count integer;
BEGIN
  SELECT information_record_id, subtype
    INTO v_record, v_subtype
    FROM information_versions
   WHERE workspace_id = p_workspace_id AND id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: INFORMATION_VERSION subject % has no information_versions row', p_id;
  END IF;
  IF v_record <> p_aggregate_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: INFORMATION_VERSION subject % must be governed by its INFORMATION_RECORD aggregate % (got %)',
      p_id, v_record, p_aggregate_id;
  END IF;

  v_detail_count := CASE v_subtype
    WHEN 'ADVISORY' THEN (SELECT count(*) FROM advisory_details WHERE workspace_id = p_workspace_id AND information_version_id = p_id)
    WHEN 'CONDITION' THEN (SELECT count(*) FROM condition_details WHERE workspace_id = p_workspace_id AND information_version_id = p_id)
    WHEN 'REGULATORY' THEN (SELECT count(*) FROM regulatory_publications WHERE workspace_id = p_workspace_id AND information_version_id = p_id)
    ELSE 0
  END;
  IF v_detail_count <> 1 THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: INFORMATION_VERSION % must carry exactly one matching typed detail row, found %',
      p_id, v_detail_count;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by)
VALUES ('INFORMATION_VERSION', 'enforce_subject_subtype_information_version', 'M5');
