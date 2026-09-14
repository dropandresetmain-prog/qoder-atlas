-- "entitlement_components / entitlement_line_links / entitlement_person_links" /
-- closure §4.3: a ticket/coupon/voucher is an issuer-observed right to consume a
-- service. Confirmation of a reservation is NOT issuance of a ticket — the two
-- live in different tables and no derivation path connects them.
--
-- Unknown issuance stays UNKNOWN: observed_status carries an explicit UNKNOWN
-- value, and an UNKNOWN status is a first-class read result, never inferred
-- ticketed.
--
-- Exchange lineage: exchanged_from_entitlement_id preserves the predecessor's
-- identity; the predecessor is never overwritten or deleted (its own status
-- moves to EXCHANGED by an issuer observation).

CREATE TABLE service_entitlements (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  entitlement_type text NOT NULL CHECK (entitlement_type IN ('TICKET', 'COUPON', 'VOUCHER')),
  observed_status text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (observed_status IN ('ISSUED', 'ACTIVE', 'USED', 'EXCHANGED', 'VOID', 'REVOKED', 'UNKNOWN')),
  observed_status_at timestamptz,
  issuer_organisation_id uuid,
  -- Protected document/ticket identifier as the ProtectedDataRef triple — no
  -- plaintext ticket number column exists (§2 ProtectedDataRef pattern).
  identifier_content_hash text,
  identifier_storage_ref text,
  identifier_access_policy_id text,
  exchanged_from_entitlement_id uuid,
  observation_evidence_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT service_entitlements_issuer_fk
    FOREIGN KEY (workspace_id, issuer_organisation_id)
    REFERENCES organisations (workspace_id, id),
  CONSTRAINT service_entitlements_exchange_fk
    FOREIGN KEY (workspace_id, exchanged_from_entitlement_id)
    REFERENCES service_entitlements (workspace_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT service_entitlements_identifier_triple CHECK (
    (identifier_content_hash IS NULL AND identifier_storage_ref IS NULL AND identifier_access_policy_id IS NULL)
    OR (identifier_content_hash IS NOT NULL AND identifier_storage_ref IS NOT NULL
        AND identifier_access_policy_id IS NOT NULL)
  ),
  CONSTRAINT service_entitlements_status_time_shape CHECK (
    (observed_status = 'UNKNOWN') = (observed_status_at IS NULL)
  ),
  -- An UNKNOWN issuance is not evidence-backed issuance: provenance is
  -- mandatory exactly when a positive status is claimed.
  CONSTRAINT service_entitlements_evidence_required CHECK (
    (observed_status IN ('ISSUED', 'ACTIVE', 'USED', 'EXCHANGED', 'VOID', 'REVOKED'))
    = (observation_evidence_id IS NOT NULL)
  ),
  -- An exchange predecessor must itself have been an issued thing.
  CONSTRAINT service_entitlements_exchange_status CHECK (
    exchanged_from_entitlement_id IS NULL OR observed_status <> 'UNKNOWN'
  )
);

CREATE INDEX idx_service_entitlements_issuer ON service_entitlements (workspace_id, issuer_organisation_id)
  WHERE issuer_organisation_id IS NOT NULL;
CREATE INDEX idx_service_entitlements_exchange ON service_entitlements (workspace_id, exchanged_from_entitlement_id)
  WHERE exchanged_from_entitlement_id IS NOT NULL;

CREATE FUNCTION enforce_subject_subtype_service_entitlement(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: SERVICE_ENTITLEMENT subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM service_entitlements e
     WHERE e.workspace_id = p_workspace_id AND e.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: SERVICE_ENTITLEMENT subject % has no service_entitlements row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('SERVICE_ENTITLEMENT', 'enforce_subject_subtype_service_entitlement', 'M3');

CREATE TRIGGER service_entitlements_immutable_identifier
  BEFORE UPDATE OF identifier_content_hash, identifier_storage_ref, identifier_access_policy_id
  ON service_entitlements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

