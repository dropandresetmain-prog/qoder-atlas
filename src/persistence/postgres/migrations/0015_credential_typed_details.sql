-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §2: "passport_details, visa_details,
-- residence_credential_details, health_credential_details | Typed
-- credential-version children | FK version; fields include issuer jurisdiction,
-- restrictions, entries/uses and relevant permitted activity. No arbitrary
-- passport/visa JSON array."
--
-- The discriminator is real integrity, not convention: each detail table carries
-- the version's `kind`, restricts it to its own literal, and holds a composite
-- FK to credential_versions (workspace_id, id, kind). A wrong-type detail row
-- therefore cannot be inserted at all, and the deferred trigger below makes a
-- missing detail row impossible too.
--
-- Every document identifier is stored only as the ProtectedDataRef triple from
-- src/domain/v2/shared/identity.ts. No scan, plaintext number or public URL
-- appears in these rows, so nothing here is safe to place in a prompt.
--
-- Architecture gap recorded rather than papered over: CredentialKindSchema
-- includes E_AUTHORISATION but §2's frozen detail inventory does not name a
-- table for it. Enforcement is therefore per-kind and deliberately silent for
-- E_AUTHORISATION; see docs/refactor/evidence/M2.md.

CREATE TABLE passport_details (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  credential_version_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind = 'PASSPORT'),
  issuing_state_code char(2) NOT NULL CHECK (issuing_state_code ~ '^[A-Z]{2}$'),
  document_number_content_hash text NOT NULL CHECK (length(document_number_content_hash) >= 16),
  document_number_storage_ref text NOT NULL CHECK (length(btrim(document_number_storage_ref)) > 0),
  document_number_access_policy_id text NOT NULL CHECK (length(btrim(document_number_access_policy_id)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, credential_version_id),
  CONSTRAINT passport_details_version_fk
    FOREIGN KEY (workspace_id, credential_version_id, kind)
    REFERENCES credential_versions (workspace_id, id, kind)
);

CREATE TABLE visa_details (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  credential_version_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind = 'VISA'),
  issuing_state_code char(2) NOT NULL CHECK (issuing_state_code ~ '^[A-Z]{2}$'),
  document_number_content_hash text NOT NULL CHECK (length(document_number_content_hash) >= 16),
  document_number_storage_ref text NOT NULL CHECK (length(btrim(document_number_storage_ref)) > 0),
  document_number_access_policy_id text NOT NULL CHECK (length(btrim(document_number_access_policy_id)) > 0),
  visa_class text NOT NULL CHECK (length(btrim(visa_class)) > 0),
  permitted_activities text[] NOT NULL DEFAULT '{}',
  restrictions text,
  -- NULL entries_allowed means "not stated by the source", which is not the
  -- same claim as a number; UNKNOWN stays explicit.
  entries_allowed integer CHECK (entries_allowed IS NULL OR entries_allowed >= 1),
  permitted_stay_days integer CHECK (permitted_stay_days IS NULL OR permitted_stay_days >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, credential_version_id),
  CONSTRAINT visa_details_version_fk
    FOREIGN KEY (workspace_id, credential_version_id, kind)
    REFERENCES credential_versions (workspace_id, id, kind)
);

CREATE TABLE residence_credential_details (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  credential_version_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind = 'RESIDENCE_PERMIT'),
  issuing_state_code char(2) NOT NULL CHECK (issuing_state_code ~ '^[A-Z]{2}$'),
  document_number_content_hash text NOT NULL CHECK (length(document_number_content_hash) >= 16),
  document_number_storage_ref text NOT NULL CHECK (length(btrim(document_number_storage_ref)) > 0),
  document_number_access_policy_id text NOT NULL CHECK (length(btrim(document_number_access_policy_id)) > 0),
  residence_type text NOT NULL CHECK (length(btrim(residence_type)) > 0),
  permitted_activities text[] NOT NULL DEFAULT '{}',
  restrictions text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, credential_version_id),
  CONSTRAINT residence_credential_details_version_fk
    FOREIGN KEY (workspace_id, credential_version_id, kind)
    REFERENCES credential_versions (workspace_id, id, kind)
);

CREATE TABLE health_credential_details (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  credential_version_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind = 'HEALTH_CREDENTIAL'),
  issuing_state_code char(2) NOT NULL CHECK (issuing_state_code ~ '^[A-Z]{2}$'),
  document_number_content_hash text NOT NULL CHECK (length(document_number_content_hash) >= 16),
  document_number_storage_ref text NOT NULL CHECK (length(btrim(document_number_storage_ref)) > 0),
  document_number_access_policy_id text NOT NULL CHECK (length(btrim(document_number_access_policy_id)) > 0),
  product_name text NOT NULL CHECK (length(btrim(product_name)) > 0),
  restrictions text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, credential_version_id),
  CONSTRAINT health_credential_details_version_fk
    FOREIGN KEY (workspace_id, credential_version_id, kind)
    REFERENCES credential_versions (workspace_id, id, kind)
);

-- A credential version is an accepted edition that assessments are bound to, so
-- its detail row is as immutable as the version itself: a correction appends a
-- new edition rather than rewriting the document a Journey was checked against.
CREATE TRIGGER passport_details_immutable
  BEFORE UPDATE OR DELETE ON passport_details
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER visa_details_immutable
  BEFORE UPDATE OR DELETE ON visa_details
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER residence_credential_details_immutable
  BEFORE UPDATE OR DELETE ON residence_credential_details
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER health_credential_details_immutable
  BEFORE UPDATE OR DELETE ON health_credential_details
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- §9 constraint 6: credential detail ownership and type are consistent. Exactly
-- one typed detail row per accepted edition, for the four kinds §2 names.
CREATE FUNCTION assert_credential_version_has_typed_detail() RETURNS trigger AS $$
DECLARE
  v_count integer;
BEGIN
  IF NEW.kind = 'E_AUTHORISATION' THEN
    -- No §2 detail table exists for this kind yet; see the gap note above.
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_count FROM (
    SELECT 1 FROM passport_details d
     WHERE d.workspace_id = NEW.workspace_id AND d.credential_version_id = NEW.id
    UNION ALL
    SELECT 1 FROM visa_details d
     WHERE d.workspace_id = NEW.workspace_id AND d.credential_version_id = NEW.id
    UNION ALL
    SELECT 1 FROM residence_credential_details d
     WHERE d.workspace_id = NEW.workspace_id AND d.credential_version_id = NEW.id
    UNION ALL
    SELECT 1 FROM health_credential_details d
     WHERE d.workspace_id = NEW.workspace_id AND d.credential_version_id = NEW.id
  ) typed_detail;

  IF v_count = 0 THEN
    RAISE EXCEPTION
      'credential_versions % has no % detail row', NEW.id, lower(NEW.kind);
  END IF;
  IF v_count > 1 THEN
    RAISE EXCEPTION
      'credential_versions % has % typed detail rows; a version has exactly one kind',
      NEW.id, v_count;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER credential_versions_typed_detail_assert
  AFTER INSERT ON credential_versions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_credential_version_has_typed_detail();
