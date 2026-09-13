-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §8/§11.1: idempotency receipts. Unique
-- namespace+key; same hash replays the original result; changed hash fails
-- (application layer distinguishes NEW/REPLAY/HASH_MISMATCH — see
-- pgIdempotencyLedger.ts). Append-only: never updated once committed.
CREATE TABLE command_receipts (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  command_namespace text NOT NULL,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  result_ref text NOT NULL,
  committed_revisions jsonb NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, command_namespace, idempotency_key)
);

CREATE TRIGGER command_receipts_immutable
  BEFORE UPDATE OR DELETE ON command_receipts
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
