-- M5: publisher/publication lineage root. A lineage is source-specific: no
-- row here declares that one publisher is globally authoritative over another.

CREATE TABLE information_records (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  publisher_organisation_id uuid,
  external_publication_key text NOT NULL CHECK (length(btrim(external_publication_key)) > 0),
  topic text NOT NULL CHECK (length(btrim(topic)) > 0),
  source_connection_identity text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT information_records_publisher_fk
    FOREIGN KEY (workspace_id, publisher_organisation_id)
    REFERENCES organisations (workspace_id, id),
  CONSTRAINT information_records_connection_identity_shape CHECK (
    source_connection_identity IS NULL OR length(btrim(source_connection_identity)) > 0
  )
);

-- PostgreSQL's normal UNIQUE semantics allow multiple NULL publishers. The
-- expression index gives an anonymous/feed publisher one stable lineage key
-- without inventing an Organisation row.
CREATE UNIQUE INDEX information_records_lineage_uidx
  ON information_records (
    workspace_id,
    COALESCE(publisher_organisation_id, '00000000-0000-0000-0000-000000000000'::uuid),
    external_publication_key
  );
CREATE INDEX idx_information_records_publisher
  ON information_records (workspace_id, publisher_organisation_id)
  WHERE publisher_organisation_id IS NOT NULL;
CREATE INDEX idx_information_records_topic
  ON information_records (workspace_id, topic);

CREATE FUNCTION enforce_subject_subtype_information_record(
  p_workspace_id uuid, p_id uuid, p_kind text, p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: INFORMATION_RECORD subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_records i WHERE i.workspace_id = p_workspace_id AND i.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: INFORMATION_RECORD subject % has no information_records row', p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by)
VALUES ('INFORMATION_RECORD', 'enforce_subject_subtype_information_record', 'M5');
