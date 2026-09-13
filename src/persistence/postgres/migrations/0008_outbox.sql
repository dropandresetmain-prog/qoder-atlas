-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §8/§12: transactional outbox. A row is
-- created in the SAME transaction as the domain state mutation it announces;
-- delivery is at-least-once and consumers must be idempotent. Claim/lease/
-- fencing mirrors inbox_work (0007) so one worker protocol implementation
-- (claimQueue.ts) serves both tables.
CREATE TABLE outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  subject_kind text NOT NULL REFERENCES subject_kinds (kind),
  subject_id uuid NOT NULL,
  destination_kind text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'CLAIMED', 'PUBLISHED', 'FAILED')),
  attempts int NOT NULL DEFAULT 0,
  claim_token uuid,
  fencing_token bigint NOT NULL DEFAULT 0,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX idx_outbox_runnable ON outbox (created_at) WHERE state = 'PENDING';
CREATE INDEX idx_outbox_leased ON outbox (lease_expires_at) WHERE state = 'CLAIMED';
