-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §6: `advisory_details` — InformationVersion
-- subtype: "source-native severity, risk topics and meanings. No universal
-- normalized authoritative severity replacing original meaning."
--
-- The publisher's own severity string is stored VERBATIM. There is no
-- normalized/authoritative severity column — an organisation's reaction to a
-- severity is a sourced organisational requirement (0073/0074), never a rewrite
-- of what the source said (closure §7).

CREATE TABLE advisory_details (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  information_version_id uuid NOT NULL,
  -- Source-native level, exactly as published ("orange", "Level 4", "do not
  -- travel"). Never mapped to a global scale by persistence.
  source_native_severity text NOT NULL CHECK (length(btrim(source_native_severity)) > 0),
  -- Bounded, version-tagged risk-topic/meaning structure (§10): topics the
  -- advisory names, meanings attached to its severity, optional publisher
  -- guidance summary. Every field M6 filters on (topics) is ALSO a column.
  risk_topics text[] NOT NULL DEFAULT '{}'
    CHECK (array_length(risk_topics, 1) IS NULL OR array_length(risk_topics, 1) <= 16),
  publisher_meanings jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(publisher_meanings) = 'array'),
  source_native_detail jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(source_native_detail) = 'object'),
  detail_schema_version text NOT NULL CHECK (length(btrim(detail_schema_version)) > 0),
  PRIMARY KEY (workspace_id, information_version_id),
  CONSTRAINT advisory_details_version_fk
    FOREIGN KEY (workspace_id, information_version_id) REFERENCES information_versions (workspace_id, id),
  CONSTRAINT advisory_details_meanings_size CHECK (pg_column_size(publisher_meanings) <= 8192),
  CONSTRAINT advisory_details_source_size CHECK (pg_column_size(source_native_detail) <= 8192)
);

CREATE TRIGGER advisory_details_immutable
  BEFORE UPDATE OR DELETE ON advisory_details
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- "Which editions name this risk topic" is the reverse lookup M6 needs to
-- invalidate advisories by topic; GIN keeps the array query indexable.
CREATE INDEX idx_advisory_details_risk_topics ON advisory_details USING gin (risk_topics);
