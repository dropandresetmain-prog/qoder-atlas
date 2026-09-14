-- provider-native record per (connection, record_type, external_id). The
-- external_id is the provider's OWN locator text — it lives here, in the
-- external-identity family, and never becomes a canonical domain id or a
-- plaintext merge key.
--
-- identity_state: UNVERIFIED / QUARANTINED_UNKNOWN / QUARANTINED_AMBIGUOUS are
-- first-class stored states; only LINKED rows may carry a canonical target link
-- (deferred assertion in 0042). Unknown identity is structured, not swallowed.
--
-- Ordering/version metadata is provider-owned: source_sequence / source_version /
-- observed_at / payload_hash let a stale or out-of-order observation be detected
-- and retained as evidence without overwriting newer accepted state.

CREATE TABLE external_records (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  connection_id uuid NOT NULL,
  record_type text NOT NULL,
  external_id text NOT NULL,
  identity_state text NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (identity_state IN ('LINKED', 'UNVERIFIED', 'QUARANTINED_UNKNOWN', 'QUARANTINED_AMBIGUOUS')),
  quarantine_reason text,
  -- Provider ordering/version metadata.
  source_sequence bigint,
  source_version text,
  observed_at timestamptz,
  payload_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT external_records_connection_fk
    FOREIGN KEY (workspace_id, connection_id)
    REFERENCES external_connections (workspace_id, id),
  CONSTRAINT external_records_identity_uidx
    UNIQUE (workspace_id, connection_id, record_type, external_id),
  -- Quarantine is always explained; LINKED is never explained by a reason.
  CONSTRAINT external_records_quarantine_reason_shape CHECK (
    (identity_state IN ('QUARANTINED_UNKNOWN', 'QUARANTINED_AMBIGUOUS')) = (quarantine_reason IS NOT NULL)
  )
);

CREATE INDEX idx_external_records_connection
  ON external_records (workspace_id, connection_id, record_type);
CREATE INDEX idx_external_records_observed
  ON external_records (workspace_id, observed_at)
  WHERE observed_at IS NOT NULL;

CREATE FUNCTION enforce_subject_subtype_external_record(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_connection_id uuid;
BEGIN
  SELECT r.connection_id INTO v_connection_id
    FROM external_records r
   WHERE r.workspace_id = p_workspace_id AND r.id = p_id;
  IF v_connection_id IS NULL THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: EXTERNAL_RECORD subject % has no external_records row',
      p_id;
  END IF;
  IF p_aggregate_id <> v_connection_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: EXTERNAL_RECORD % must aggregate under its ExternalConnection % (aggregate_id=%)',
      p_id, v_connection_id, p_aggregate_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('EXTERNAL_RECORD', 'enforce_subject_subtype_external_record', 'M3');

