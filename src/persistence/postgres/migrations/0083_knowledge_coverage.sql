-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §6: `knowledge_coverage` / `source_sync_state`.
--
-- `knowledge_coverage` — "Immutable: query/feed bounds, topic/jurisdiction/
-- population, edition/watermark, completeness/limitations, expiry. Evidence for
-- what was checked; incomplete coverage cannot produce unqualified PASS."
-- Closure §4.5: "An empty result is not proof of safety without supported
-- coverage."
--
-- Coverage status is a CLOSED vocabulary that keeps uncertainty explicit:
-- COMPLETE / INCOMPLETE / UNKNOWN / UNSUPPORTED_CATEGORY / SOURCE_UNAVAILABLE.
-- Absence of a row is absence of a claim — never PASS, never complete coverage.
-- An empty-result query is recorded as a row with completeness='UNKNOWN' (or
-- UNSUPPORTED_CATEGORY), not as no row.
--
-- `source_sync_state` — "Root: connection/feed identity, accepted cursor/
-- watermark, last successful coverage ref. Update atomically with accepted
-- editions/work; sync success is not a claim that real world is safe."

CREATE TABLE knowledge_coverage (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  topic text NOT NULL CHECK (length(btrim(topic)) > 0),
  -- Query bounds as declared by the query itself (jurisdictions asked about,
  -- window, categories); bounded version-tagged structure (§10).
  query_bounds jsonb NOT NULL CHECK (jsonb_typeof(query_bounds) = 'object'),
  query_bounds_version text NOT NULL CHECK (length(btrim(query_bounds_version)) > 0),
  -- Feed/query edition + watermark as the upstream stated them.
  edition text NOT NULL CHECK (length(btrim(edition)) > 0),
  watermark text,
  -- Closed uncertainty vocabulary. NOT NULL: a coverage record always says how
  -- complete it is, including "we do not know".
  completeness text NOT NULL CHECK (completeness IN (
    'COMPLETE', 'INCOMPLETE', 'UNKNOWN', 'UNSUPPORTED_CATEGORY', 'SOURCE_UNAVAILABLE'
  )),
  -- What exactly limits the claim ("feed lacks visa bulletins after 2026-05",
  -- "category not interpretable"). Empty only when completeness = 'COMPLETE'.
  completeness_limitations text[] NOT NULL DEFAULT '{}'
    CHECK (array_length(completeness_limitations, 1) IS NULL OR array_length(completeness_limitations, 1) <= 16),
  -- When this coverage claim itself goes stale (§11 time invalidation); the
  -- partial index below is the M6 clock sweep's access path.
  expires_at timestamptz,
  evidence_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT knowledge_coverage_evidence_fk
    FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id),
  CONSTRAINT knowledge_coverage_bounds_size CHECK (pg_column_size(query_bounds) <= 8192),
  CONSTRAINT knowledge_coverage_complete_shape CHECK (
    completeness <> 'COMPLETE' OR cardinality(completeness_limitations) = 0
  ),
  CONSTRAINT knowledge_coverage_unsupported_shape CHECK (
    completeness <> 'UNSUPPORTED_CATEGORY' OR cardinality(completeness_limitations) >= 1
  )
);

CREATE TRIGGER knowledge_coverage_immutable
  BEFORE UPDATE OR DELETE ON knowledge_coverage
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE INDEX idx_knowledge_coverage_topic ON knowledge_coverage (workspace_id, topic, created_at DESC);
-- §12 "what expires solely because time advanced": the time-only invalidation
-- candidate set.
CREATE INDEX idx_knowledge_coverage_expiry
  ON knowledge_coverage (workspace_id, expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE source_sync_state (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  -- Feed/connection identity (M3 external connection when known; identity text
  -- always). One sync state per connection identity per workspace.
  connection_identity text NOT NULL CHECK (length(btrim(connection_identity)) > 0),
  external_connection_id uuid,
  accepted_cursor text,
  accepted_watermark text,
  last_accepted_coverage_id uuid,
  last_sync_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT source_sync_state_coverage_fk
    FOREIGN KEY (workspace_id, last_accepted_coverage_id)
    REFERENCES knowledge_coverage (workspace_id, id),
  CONSTRAINT source_sync_state_identity_unique
    UNIQUE (workspace_id, connection_identity)
);

CREATE INDEX idx_source_sync_state_connection
  ON source_sync_state (workspace_id, external_connection_id)
  WHERE external_connection_id IS NOT NULL;
