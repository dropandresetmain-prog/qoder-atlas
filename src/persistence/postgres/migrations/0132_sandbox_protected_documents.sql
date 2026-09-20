-- A3: bounded synthetic-only protected document custody for the SANDBOX.
--
-- This table is deliberately not a general vault. The application accepts only
-- synthetic marker content under an explicit sandbox guard, and keeps the
-- ciphertext plus its integrity metadata in the PostgreSQL target itself.
-- Accepted rows are immutable; a correction is a new content hash.

CREATE TABLE sandbox_protected_documents (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) > 0),
  nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
  auth_tag bytea NOT NULL CHECK (octet_length(auth_tag) = 16),
  key_id text NOT NULL CHECK (length(btrim(key_id)) > 0),
  access_policy_id text NOT NULL CHECK (access_policy_id = 'synthetic-sandbox-document/1'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL CHECK (length(btrim(created_by_actor_id)) > 0),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, content_sha256)
);

CREATE FUNCTION sandbox_protected_documents_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'sandbox_protected_documents is immutable; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sandbox_protected_documents_guard
  BEFORE UPDATE OR DELETE ON sandbox_protected_documents
  FOR EACH ROW EXECUTE FUNCTION sandbox_protected_documents_guard();
