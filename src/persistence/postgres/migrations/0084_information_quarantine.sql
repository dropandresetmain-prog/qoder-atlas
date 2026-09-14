-- Milestone §K: structured quarantine for invalid or conflicting ingestion.
--
-- "Invalid or conflicting normalization -> quarantine/structured rejection;
-- never silently overwrite accepted prior information." A rejected edition is
-- NOT thrown away and NOT rolled into nothing: it is a committed, inspectable
-- record with its raw payload hash and the exact rejection reason, so
-- reconciliation can decide later without re-deriving what arrived. It is also
-- NOT domain truth: nothing outside this table can read a quarantined payload
-- as an accepted edition (that is what makes it quarantine, not a soft accept).
--
-- The external key carries source-native identity so the same delivery can be
-- correlated when it is re-sent correctly.

CREATE TABLE information_quarantine (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  information_record_id uuid NOT NULL,
  external_edition_sequence integer,
  subtype text CHECK (subtype IS NULL OR subtype IN ('ADVISORY', 'CONDITION', 'REGULATORY')),
  -- Exact rejection reason from the frozen admission vocabulary
  -- (ingestionIsAcceptable + normalization validation).
  rejection_reason text NOT NULL CHECK (rejection_reason IN (
    'DUPLICATE_SEQUENCE_HASH_MISMATCH',
    'OUT_OF_ORDER',
    'NORMALIZATION_INVALID',
    'COVERAGE_UNKNOWN',
    'EVIDENCE_INCOMPLETE'
  )),
  rejection_detail text CHECK (rejection_detail IS NULL OR length(rejection_detail) <= 2048),
  -- Hash of exactly what arrived (before normalization where applicable), so
  -- the quarantined delivery is auditable without storing arbitrary raw
  -- content in the database (raw capture remains in protected storage, 0070).
  payload_hash text NOT NULL CHECK (length(payload_hash) >= 16),
  -- Bounded version-tagged summary of what failed (missing field paths,
  -- schema version attempted); the full raw payload stays in source_records.
  rejected_summary jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(rejected_summary) = 'object'),
  source_record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT information_quarantine_record_fk
    FOREIGN KEY (workspace_id, information_record_id) REFERENCES information_records (workspace_id, id),
  CONSTRAINT information_quarantine_source_fk
    FOREIGN KEY (workspace_id, source_record_id) REFERENCES source_records (workspace_id, id),
  CONSTRAINT information_quarantine_summary_size CHECK (pg_column_size(rejected_summary) <= 8192)
);

CREATE INDEX idx_information_quarantine_record
  ON information_quarantine (workspace_id, information_record_id, created_at DESC);
CREATE INDEX idx_information_quarantine_reason
  ON information_quarantine (workspace_id, rejection_reason);
