-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §8: legacy identity mapping and
-- idempotent migration-run bookkeeping for the eventual M10 rehearsal. Not
-- exercised for real legacy data during M1 — no migration executes here.
CREATE TABLE legacy_id_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  source_dataset text NOT NULL,
  source_type text NOT NULL,
  source_id text NOT NULL,
  target_kind text NOT NULL REFERENCES subject_kinds (kind),
  target_id uuid NOT NULL,
  mapping_evidence text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_dataset, source_type, source_id)
);

CREATE INDEX idx_legacy_id_map_target ON legacy_id_map (workspace_id, target_kind, target_id);

CREATE TRIGGER legacy_id_map_immutable
  BEFORE UPDATE OR DELETE ON legacy_id_map
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE migration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  dataset_hash text NOT NULL,
  exporter_version text NOT NULL,
  importer_version text NOT NULL,
  status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  validations jsonb NOT NULL DEFAULT '[]'::jsonb,
  reconciliation_exceptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
