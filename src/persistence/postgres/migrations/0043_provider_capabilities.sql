-- "the connector's capability and scoped grant decide which action is possible"
-- / F08 "servicing capabilities": provider capability truth, distinct from
-- observation and from M8 authority.
--
-- Represented explicitly, including the negative: a `supported = false` row is
-- stored fact ("the provider declared split unsupported"), NOT absence of a
-- row, so a reader can distinguish "unknown" (no row) from "known unsupported"
-- (false). Capability is never inferred from schema support, and an unsupported
-- split/cancel/servicing operation returns a typed CAPABILITY_UNSUPPORTED
-- outcome at the command layer.
--
-- M8 authority is NOT here: nothing in this family grants permission; it only
-- records what the provider technically supports and what NORTHSTAR observed.

CREATE TABLE provider_capabilities (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  connection_id uuid NOT NULL,
  capability_kind text NOT NULL CHECK (capability_kind IN (
    'OBSERVE', 'CREATE', 'MODIFY', 'SERVICE', 'SPLIT', 'CANCEL', 'REFUND', 'EXCHANGE'
  )),
  record_type text NOT NULL,
  supported boolean NOT NULL,
  -- Provider-native capability/code context, bounded.
  provider_details jsonb,
  observed_at timestamptz NOT NULL,
  observation_evidence_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT provider_capabilities_connection_fk
    FOREIGN KEY (workspace_id, connection_id)
    REFERENCES external_connections (workspace_id, id),
  CONSTRAINT provider_capabilities_details_shape CHECK (
    provider_details IS NULL OR (jsonb_typeof(provider_details) = 'object'
                                 AND pg_column_size(provider_details) <= 8192)
  ),
  -- One current capability statement per (connection, kind, record type):
  -- a newer observation supersedes by rewriting this row, and its previous
  -- value stays in change_records.
  CONSTRAINT provider_capabilities_identity_uidx
    UNIQUE (workspace_id, connection_id, capability_kind, record_type)
);

CREATE INDEX idx_provider_capabilities_connection
  ON provider_capabilities (workspace_id, connection_id);

