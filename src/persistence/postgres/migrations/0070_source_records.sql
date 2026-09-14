-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §6: `source_records` / `source_content_refs`
-- are the immutable capture layer (§1 "Raw files are in protected content
-- storage with hash and access-controlled reference, not public URLs or
-- prompt-visible blobs"). M5 puts provenance FIRST inside its range so every
-- later M5 table (evidence, information, rules) can carry a real FK to
-- `evidence_records` / `source_records`.
--
-- F06: a captured raw document is externally owned observed material. It has no
-- interpretation, no authority label and no validity of its own — those belong
-- to `evidence_records` (0071) and `information_versions` (0077+).
-- §10 JSON policy: capture metadata is bounded and version-tagged.

CREATE TABLE source_records (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  -- "source identity": who produced the capture (a system of record, a feed, a
  -- document custodian). Text, because identities predate and outlive
  -- Northstar's own Organisation registry.
  source_identity text NOT NULL CHECK (length(btrim(source_identity)) > 0),
  received_at timestamptz NOT NULL,
  content_hash text NOT NULL CHECK (length(content_hash) >= 16),
  content_type text NOT NULL CHECK (length(btrim(content_type)) > 0),
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  -- Protected raw capture reference (ProtectedDataRef shape, §2). NULL only
  -- when the capture is small metadata (e.g. a header row) and nothing raw
  -- exists to protect; the hash always is.
  raw_content_hash text,
  raw_storage_ref text,
  raw_access_policy_id text,
  -- Bounded, version-tagged capture metadata (URL, fetch mode, feed name):
  -- every *queried* field was lifted into a column above; the rest is
  -- declared-by-writer metadata, not a fact bag for later interpretation.
  capture_metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(capture_metadata) = 'object'),
  capture_metadata_version text NOT NULL CHECK (length(btrim(capture_metadata_version)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT source_records_protected_ref_shape CHECK (
    (raw_content_hash IS NULL AND raw_storage_ref IS NULL AND raw_access_policy_id IS NULL)
    OR (raw_content_hash IS NOT NULL AND raw_storage_ref IS NOT NULL AND raw_access_policy_id IS NOT NULL)
  ),
  CONSTRAINT source_records_capture_metadata_size CHECK (pg_column_size(capture_metadata) <= 8192)
);

-- Immutable capture: no silent rewrite of raw provenance.
CREATE TRIGGER source_records_immutable
  BEFORE UPDATE OR DELETE ON source_records
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE INDEX idx_source_records_identity ON source_records (workspace_id, source_identity, received_at DESC);
CREATE INDEX idx_source_records_hash ON source_records (workspace_id, content_hash);

-- The M0 contract (SourceRecordV2Schema) has no protected-ref field; §6 gives
-- the table one. Capturing a raw reference without a declared contract shape is
-- exactly how secrets leak, so a capture either names a bounded, typed
-- content-reference family or carries none. Version-tagged like every other
-- bounded jsonb field in this range.
CREATE TABLE source_content_refs (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  source_record_id uuid NOT NULL,
  ref_kind text NOT NULL CHECK (ref_kind IN ('RAW_DOCUMENT', 'RENDERED_TEXT', 'STRUCTURED_EXPORT', 'PAGE_IMAGE')),
  content_hash text NOT NULL CHECK (length(content_hash) >= 16),
  storage_ref text NOT NULL CHECK (length(btrim(storage_ref)) > 0),
  access_policy_id text NOT NULL CHECK (length(btrim(access_policy_id)) > 0),
  byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, source_record_id, ref_kind),
  CONSTRAINT source_content_refs_source_fk
    FOREIGN KEY (workspace_id, source_record_id) REFERENCES source_records (workspace_id, id)
);

CREATE TRIGGER source_content_refs_immutable
  BEFORE UPDATE OR DELETE ON source_content_refs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------
-- Subtype checker for SOURCE_RECORD (0010 extension contract).
-- ---------------------------------------------------------------------------
CREATE FUNCTION enforce_subject_subtype_source_record(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: SOURCE_RECORD subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM source_records s
     WHERE s.workspace_id = p_workspace_id AND s.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: SOURCE_RECORD subject % has no source_records row', p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('SOURCE_RECORD', 'enforce_subject_subtype_source_record', 'M5');
