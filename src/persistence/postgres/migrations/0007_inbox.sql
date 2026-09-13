-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §8: durable inbox capture + resumable
-- per-target work. inbox_deliveries is an immutable capture; a repeat
-- delivery with the SAME key and hash is an idempotent no-op, a repeat with
-- the same key and a DIFFERENT hash is quarantined into
-- inbox_delivery_conflicts rather than silently overwriting the original.
CREATE TABLE inbox_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  source_connection_id text NOT NULL,
  delivery_key text NOT NULL,
  payload_hash text NOT NULL,
  source_ref text,
  raw_payload jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_connection_id, delivery_key)
);

CREATE TRIGGER inbox_deliveries_immutable
  BEFORE UPDATE OR DELETE ON inbox_deliveries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE inbox_delivery_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  original_delivery_id uuid NOT NULL REFERENCES inbox_deliveries (id),
  conflicting_payload_hash text NOT NULL,
  conflicting_raw_payload jsonb,
  detected_at timestamptz NOT NULL DEFAULT now()
);

-- Receipt of a delivery does not mark work done; a leased worker resumes
-- unfinished processing (state=CLAIMED with an expired lease is reclaimable).
CREATE TABLE inbox_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  delivery_id uuid NOT NULL REFERENCES inbox_deliveries (id),
  handler_key text NOT NULL,
  target_key text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'CLAIMED', 'DONE', 'FAILED')),
  attempts int NOT NULL DEFAULT 0,
  claim_token uuid,
  fencing_token bigint NOT NULL DEFAULT 0,
  lease_expires_at timestamptz,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, handler_key, target_key)
);

CREATE INDEX idx_inbox_work_runnable ON inbox_work (next_run_at) WHERE state = 'PENDING';
CREATE INDEX idx_inbox_work_leased ON inbox_work (lease_expires_at) WHERE state = 'CLAIMED';
