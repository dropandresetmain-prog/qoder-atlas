-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §8: append-only audit/change history,
-- linked to the command receipt that produced it and to the subject/revision
-- it changed. Committed atomically with domain data + head + outbox in the
-- same transaction (pgUnitOfWork.ts).
CREATE TABLE change_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  command_namespace text NOT NULL,
  idempotency_key text NOT NULL,
  actor_principal_id text NOT NULL,
  represented_party_id text,
  subject_kind text NOT NULL REFERENCES subject_kinds (kind),
  subject_id uuid NOT NULL,
  before_revision bigint,
  after_revision bigint NOT NULL,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, command_namespace, idempotency_key)
    REFERENCES command_receipts (workspace_id, command_namespace, idempotency_key)
    DEFERRABLE INITIALLY DEFERRED
);
-- Deferred to COMMIT: the domain handler (fn) writes its change_records row
-- BEFORE PgUnitOfWork.execute inserts the command_receipts row that
-- documents the same command (it needs fn's result to build the receipt),
-- so this FK cannot be checked immediately at INSERT time.

CREATE INDEX idx_change_records_subject ON change_records (workspace_id, subject_kind, subject_id, occurred_at);

CREATE TRIGGER change_records_immutable
  BEFORE UPDATE OR DELETE ON change_records
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
