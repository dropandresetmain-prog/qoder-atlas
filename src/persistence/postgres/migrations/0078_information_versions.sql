-- RECOVERY NOTE: pasted section is incomplete/interleaved; do not repair during salvage.
-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §6: `information_versions` — "Immutable
-- edition: record_id, external edition/sequence, issued/received/observed/
-- effective times, evidence, supersedes/retracts. Duplicate same key+different
-- payload is conflict, not overwrite. Out-of-order receipt cannot win
-- automatically."
--
-- Closure §7: "Preserve issuedAt, observedAt, receivedAt, effective interval,
-- provider sequencing, forecast target where relevant and supersedes/retracts
-- identity. Receipt time does not make an old statement fresh."
--
-- Time semantics are four DISTINCT columns: issued_at (publisher's publication
-- time), received_at (when Northstar got it), observed_at (when the fact was
-- observed), effective_from/until (when the statement applies). No constraint
-- orders received_at vs issued_at — late receipt is representable, and a late
-- receipt never masquerades as a newly-effective statement because currentness
-- is computed from effective + received together (M6).
--
-- Supersession/retraction are same-lineage-only (deferred trigger): a publisher
-- corrects its own line; it never overwrites another publisher's dissent.

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
  -- The evidence this edition was accepted on (0071). NOT NULL: no edition
  -- without provenance.
  evidence_id uuid NOT NULL,
  supersedes_information_version_id uuid,
  retracts_information_version_id uuid,
  -- Same-key same-sequence dedup requires the accepted payload identity; the
  -- hash is computed over the normalized edition content by the admission
  -- command (canonical hash of the typed payload), BEFORE any retry.
  payload_hash text NOT NULL CHECK (length(payload_hash) >= 16),
  normalization_version text NOT NULL CHECK (length(btrim(normalization_version)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT information_versions_record_fk
    FOREIGN KEY (workspace_id, information_record_id) REFERENCES information_records (workspace_id, id),
  CONSTRAINT information_versions_evidence_fk
    FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id),
  CONSTRAINT information_versions_lineage_edition_unique
    UNIQUE (workspace_id, information_record_id, external_edition_sequence),
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
  )
);

-- Append-only editions: acceptance is the only write; correction/retraction
-- are NEW editions pointing at the old one.
CREATE TRIGGER information_versions_immutable
  BEFORE UPDATE OR DELETE ON information_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE INDEX idx_information_versions_record
  ON information_versions (workspace_id, information_record_id, external_edition_sequence DESC);
CREATE INDEX idx_information_versions_effective
  ON information_versions (workspace_id, effective_from, effective_until)
  WHERE effective_from IS NOT NULL;
-- Freshness/expiry invalidation (§12 "what expires solely because time
-- advanced"): an M6 time sweep reads this ascending.
CREATE INDEX idx_information_versions_effective_until
  ON information_versions (workspace_id, effective_until)
  WHERE effective_until IS NOT NULL;

-- Supersession/retraction may only point inside the same publisher lineage.
CREATE FUNCTION assert_information_version_lineage_link() RETURNS trigger AS $$
DECLARE
  v_prev_record uuid;
BEGIN
  IF NEW.supersedes_information_version_id IS NOT NULL THEN
    SELECT v.information_record_id INTO v_prev_record
      FROM information_versions v
     WHERE v.workspace_id = NEW.workspace_id
       AND v.id = NEW.supersedes_information_version_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'information_versions violation: % supersedes unknown edition %',
        NEW.id, NEW.supersedes_information_version_id;
    END IF;
    IF v_prev_record <> NEW.information_record_id THEN
      RAISE EXCEPTION
        'information_versions violation: % supersedes edition % of another publisher lineage (%)',
        NEW.id, NEW.supersedes_information_version_id, v_prev_record;
    END IF;
  END IF;
  IF NEW.retracts_information_version_id IS NOT NULL THEN
    SELECT v.information_record_id INTO v_prev_record
      FROM information_versions v
     WHERE v.workspace_id = NEW.workspace_id
       AND v.id = NEW.retracts_information_version_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'information_versions violation: % retracts unknown edition %',
        NEW.id, NEW.retracts_information_version_id;
    END IF;
    IF v_prev_record <> NEW.information_record_id THEN
      RAISE EXCEPTION
        'information_versions violation: % retracts edition % of another publisher lineage (%)',
        NEW.id, NEW.retracts_information_version_id, v_prev_record;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER information_versions_lineage_link_assert
  AFTER INSERT ON information_versions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_information_version_lineage_link();

-- A superseded or retracted edition must exist BEFORE its replacement's
-- edition sequence, so a late receipt cannot rewrite history (§6: out-of-order
-- receipt cannot win automatically).
CREATE FUNCTION assert_information_version_sequence_forward() RETURNS trigger AS $$
DECLARE
  v_prev_sequence integer;
BEGIN
  IF NEW.supersedes_information_version_id IS NOT NULL THEN
    SELECT v.external_edition_sequence INTO v_prev_sequence
      FROM information_versions v
     WHERE v.workspace_id = NEW.workspace_id AND v.id = NEW.supersedes_information_version_id;
    IF v_prev_sequence >= NEW.external_edition_sequence THEN
      RAISE EXCEPTION
        'information_versions violation: % (sequence %) cannot supersede an equal-or-later edition (sequence %)',
        NEW.id, NEW.external_edition_sequence, v_prev_sequence;
    END IF;
  END IF;
  IF NEW.retracts_information_version_id IS NOT NULL THEN
    SELECT v.external_edition_sequence INTO v_prev_sequence
      FROM information_versions v
     WHERE v.workspace_id = NEW.workspace_id AND v.id = NEW.retracts_information_version_id;
    IF v_prev_sequence >= NEW.external_edition_sequence THEN
      RAISE EXCEPTION
        'information_versions violation: % (sequence %) cannot retract an equal-or-later edition (sequence %)',
        NEW.id, NEW.external_edition_sequence, v_prev_sequence;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER information_versions_sequence_forward_assert
  AFTER INSERT ON information_versions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_information_version_sequence_forward();

-- ---------------------------------------------------------------------------
-- Subtype checker for INFORMATION_VERSION (0010 extension contract).
-- INFORMATION_VERSION is a CHILD of its INFORMATION_RECORD (M2's JOURNEY_ITEM
-- precedent): a registry row governed by the parent's aggregate head, no
-- aggregate_heads row of its own. The checker also enforces subtype/detail
-- parity: exactly one typed detail row in the matching detail table.
-- ---------------------------------------------------------------------------
CREATE FUNCTION enforce_subject_subtype_information_version(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_record uuid;
  v_subtype text;
  v_detail_count integer;
BEGIN
  SELECT i.id INTO v_subtype_check_record
  SELECT v.information_record_id, v.subtype INTO v_record, v_subtype
    FROM information_versions v
    JOIN information_records i ON i.workspace_id = v.workspace_id AND i.id = v.information_record_id
   WHERE v.workspace_id = p_workspace_id AND v.id = p_id;
  IF v_subtype_check_record IS NULL THEN
  IF v_record IS NULL THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: INFORMATION_VERSION subject % has no information_versions row', p_id;
  END IF;
  IF v_subtype_check_record <> p_aggregate_id THEN
  IF v_record <> p_aggregate_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: INFORMATION_VERSION subject % must be governed by its INFORMATION_RECORD aggregate % (got %)',
      p_id, v_subtype_check_record, p_aggregate_id;
      p_id, v_record, p_aggregate_id;
  END IF;

  SELECT subtype INTO v_subtype
    FROM information_versions v
   WHERE v.workspace_id = p_workspace_id AND v.id = p_id;

  v_detail_count := 0;
  IF v_subtype = 'ADVISORY' THEN
    SELECT count(*) INTO v_detail_count FROM advisory_details d
     WHERE d.workspace_id = p_workspace_id AND d.information_version_id = p_id;
  ELSIF v_subtype = 'CONDITION' THEN
    SELECT count(*) INTO v_detail_count FROM condition_details d
     WHERE d.workspace_id = p_workspace_id AND d.information_version_id = p_id;
  ELSIF v_subtype = 'REGULATORY' THEN
    SELECT count(*) INTO v_detail_count FROM regulatory_publications d
     WHERE d.workspace_id = p_workspace_id AND d.information_version_id = p_id;
  END IF;
  IF v_detail_count <> 1 THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: INFORMATION_VERSION % (subtype %) must carry exactly one matching typed detail row, found %',
      p_id, v_subtype, v_detail_count;
  END IF;
END;
$$ LANGUAGE plpgsql;
$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('INFORMATION_VERSION', 'enforce_subject_subtype_information_version', 'M5');
