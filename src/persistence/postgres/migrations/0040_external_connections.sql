-- "external_records" / "external_record_links" (F08): explicit external
-- identity with verified correlation, observation metadata and field ownership.
--
-- Identity decisions recorded here:
--   * external_records is unique on (connection, record_type, external_id);
--     locator equality alone across systems never merges two records — merging
--     requires a verified, evidence-backed external_record_links row.
--   * identity_state is first-class: UNVERIFIED (observed but not correlated),
--     QUARANTINED_UNKNOWN (identity evidence absent/contradictory),
--     QUARANTINED_AMBIGUOUS (more than one candidate target). Quarantine is a
--     row here, not a hidden exception bucket.
--   * provider-supplied ordering/version metadata (source_version, source_sequence,
--     observed_at) is stored so stale/out-of-order observations can be detected
--     and retained as evidence without overwriting newer accepted state.

CREATE TABLE external_connections (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  organisation_id uuid,
  provider_kind text NOT NULL,
  -- Protected auth reference as the triple; no secret in ordinary rows.
  auth_content_hash text,
  auth_storage_ref text,
  auth_access_policy_id text,
  -- Bounded adapter configuration (endpoint names, record-type catalogue).
  capability_configuration jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT external_connections_organisation_fk
    FOREIGN KEY (workspace_id, organisation_id) REFERENCES organisations (workspace_id, id),
  CONSTRAINT external_connections_auth_triple CHECK (
    (auth_content_hash IS NULL AND auth_storage_ref IS NULL AND auth_access_policy_id IS NULL)
    OR (auth_content_hash IS NOT NULL AND auth_storage_ref IS NOT NULL
        AND auth_access_policy_id IS NOT NULL)
  ),
  CONSTRAINT external_connections_configuration_shape CHECK (
    capability_configuration IS NULL OR (jsonb_typeof(capability_configuration) = 'object'
                                         AND pg_column_size(capability_configuration) <= 16384)
  )
);

CREATE INDEX idx_external_connections_organisation
  ON external_connections (workspace_id, organisation_id)
  WHERE organisation_id IS NOT NULL;

CREATE FUNCTION enforce_subject_subtype_external_connection(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: EXTERNAL_CONNECTION subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM external_connections c
     WHERE c.workspace_id = p_workspace_id AND c.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: EXTERNAL_CONNECTION subject % has no external_connections row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('EXTERNAL_CONNECTION', 'enforce_subject_subtype_external_connection', 'M3');

