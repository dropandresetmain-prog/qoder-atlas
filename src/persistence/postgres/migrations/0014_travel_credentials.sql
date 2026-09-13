-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §2: travel_credentials is the Traveller-owned
-- document; credential_versions is the immutable accepted edition history.
-- F06 keeps the two separate from any booking: a credential belongs to a
-- person, never to the Trip or supplier record that happened to observe it.
--
-- §1 requires immutable version tables to carry an immutable version id plus a
-- unique (workspace_id, root_id, edition_number); `kind` is repeated on the
-- version only so 0015 can enforce the type discriminator with a real composite
-- FK instead of application convention. The deferred trigger below keeps the
-- duplicated value from ever diverging.

CREATE TABLE travel_credentials (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  traveller_id uuid NOT NULL,
  kind text NOT NULL CHECK (
    kind IN ('PASSPORT', 'VISA', 'E_AUTHORISATION', 'RESIDENCE_PERMIT', 'HEALTH_CREDENTIAL')
  ),
  issuer_country char(2) NOT NULL CHECK (issuer_country ~ '^[A-Z]{2}$'),
  -- §2: "Do not use plaintext identifier as public identity." No document
  -- number column exists here; the protected reference lives on the typed
  -- detail row in 0015.
  current_version_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT travel_credentials_traveller_fk
    FOREIGN KEY (workspace_id, traveller_id) REFERENCES travellers (workspace_id, id)
);

CREATE INDEX idx_travel_credentials_traveller ON travel_credentials (workspace_id, traveller_id, kind);

CREATE TABLE credential_versions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  credential_id uuid NOT NULL,
  kind text NOT NULL CHECK (
    kind IN ('PASSPORT', 'VISA', 'E_AUTHORISATION', 'RESIDENCE_PERMIT', 'HEALTH_CREDENTIAL')
  ),
  edition_number integer NOT NULL CHECK (edition_number >= 1),
  -- §1: date-only document validity stays `date`; it is never silently
  -- converted to a UTC instant.
  issue_date date NOT NULL,
  expiry_date date,
  -- Issuer status and physical availability are separate observed facts: an
  -- expired document is still physically present, and an unverified issuer
  -- status stays UNKNOWN rather than defaulting to valid.
  issuer_status text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (issuer_status IN ('VALID', 'REVOKED', 'SUSPENDED', 'UNKNOWN')),
  physically_available boolean,
  evidence_id uuid NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT credential_versions_credential_fk
    FOREIGN KEY (workspace_id, credential_id) REFERENCES travel_credentials (workspace_id, id),
  CONSTRAINT credential_versions_edition_unique UNIQUE (workspace_id, credential_id, edition_number),
  -- Enables the composite discriminating FK from each typed detail table.
  CONSTRAINT credential_versions_identity_kind UNIQUE (workspace_id, id, kind),
  CONSTRAINT credential_versions_validity_range CHECK (expiry_date IS NULL OR expiry_date > issue_date)
);

CREATE INDEX idx_credential_versions_credential ON credential_versions (workspace_id, credential_id, edition_number DESC);

CREATE TRIGGER credential_versions_immutable
  BEFORE UPDATE OR DELETE ON credential_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE travel_credentials
  ADD CONSTRAINT travel_credentials_current_version_fk
  FOREIGN KEY (workspace_id, current_version_id) REFERENCES credential_versions (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- The current accepted version must be a version of this credential.
CREATE FUNCTION assert_credential_current_version_owned() RETURNS trigger AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT cv.credential_id INTO v_owner
    FROM credential_versions cv
   WHERE cv.workspace_id = NEW.workspace_id AND cv.id = NEW.current_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION
      'travel_credentials % current_version_id % is not an existing credential version',
      NEW.id, NEW.current_version_id;
  END IF;
  IF v_owner <> NEW.id THEN
    RAISE EXCEPTION
      'travel_credentials % current_version_id % belongs to another credential',
      NEW.id, NEW.current_version_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER travel_credentials_current_version_assert
  AFTER INSERT OR UPDATE ON travel_credentials
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_credential_current_version_owned();

-- The denormalized discriminator on the edition must agree with its credential.
CREATE FUNCTION assert_credential_version_kind_matches() RETURNS trigger AS $$
DECLARE
  v_credential_kind text;
BEGIN
  SELECT c.kind INTO v_credential_kind
    FROM travel_credentials c
   WHERE c.workspace_id = NEW.workspace_id AND c.id = NEW.credential_id;
  IF v_credential_kind IS DISTINCT FROM NEW.kind THEN
    RAISE EXCEPTION
      'credential_versions % kind % disagrees with credential kind %',
      NEW.id, NEW.kind, v_credential_kind;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER credential_versions_kind_agreement_assert
  AFTER INSERT ON credential_versions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_credential_version_kind_matches();
