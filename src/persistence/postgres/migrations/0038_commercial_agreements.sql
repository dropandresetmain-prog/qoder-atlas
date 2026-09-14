-- agreement_versions, agreement_scopes" / closure §4.3: a CommercialAgreement is
-- a versioned root with immutable published terms editions and explicit
-- eligibility/account scopes. Private/negotiated availability requires a valid
-- agreement scope row; connector-interpreted provider codes stay inside the
-- edition's bounded terms, never in core policy columns.

CREATE TABLE commercial_agreements (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  organisation_id uuid NOT NULL,
  current_version_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT commercial_agreements_organisation_fk
    FOREIGN KEY (workspace_id, organisation_id) REFERENCES organisations (workspace_id, id),
    FOREIGN KEY (workspace_id, organisation_id) REFERENCES organisations (workspace_id, id)
  -- Deferred: a version and its root register in either order within one
  -- command; the deferred assertion below keeps the pointer honest at COMMIT.
  CONSTRAINT commercial_agreements_current_version_fk
    FOREIGN KEY (workspace_id, current_version_id)
    REFERENCES agreement_versions (workspace_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_commercial_agreements_organisation
  ON commercial_agreements (workspace_id, organisation_id);

CREATE TABLE agreement_versions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  agreement_id uuid NOT NULL,
  edition_number integer NOT NULL CHECK (edition_number >= 1),
  published_at timestamptz NOT NULL,
  effective_from timestamptz,
  effective_until timestamptz,
  -- Bounded negotiated terms (rate codes, fare basis, amenity rules). Provider
  -- codes live here as quoted data, not as core policy.
  published_terms jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT agreement_versions_agreement_fk
    FOREIGN KEY (workspace_id, agreement_id)
    REFERENCES commercial_agreements (workspace_id, id),
  CONSTRAINT agreement_versions_terms_shape CHECK (
    jsonb_typeof(published_terms) = 'object' AND pg_column_size(published_terms) <= 16384
  ),
  CONSTRAINT agreement_versions_effective_shape CHECK (
    effective_from IS NULL OR effective_until IS NULL OR effective_until > effective_from
  ),
  CONSTRAINT agreement_versions_edition_uidx
    UNIQUE (workspace_id, agreement_id, edition_number)
);

-- Immutable published editions: a new edition is a new row; correction never
-- rewrites one.
CREATE TRIGGER agreement_versions_immutable
  BEFORE UPDATE OR DELETE ON agreement_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Eligibility/account scope of an agreement edition: private availability is
-- anchored to THIS row, and offer_eligibility.agreement_scope_id cites it.
CREATE TABLE agreement_scopes (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  agreement_version_id uuid NOT NULL,
  eligible_organisation_id uuid,
  scope_kind text NOT NULL CHECK (scope_kind IN ('ACCOUNT', 'NEGOTIATED_RATE', 'CORPORATE_CODE', 'OTHER')),
  scope_reference text,
  valid_from timestamptz,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT agreement_scopes_version_fk
    FOREIGN KEY (workspace_id, agreement_version_id)
    REFERENCES agreement_versions (workspace_id, id),
  CONSTRAINT agreement_scopes_organisation_fk
    FOREIGN KEY (workspace_id, eligible_organisation_id)
    REFERENCES organisations (workspace_id, id),
  CONSTRAINT agreement_scopes_reference_required CHECK (
    scope_kind = 'ACCOUNT' OR scope_reference IS NOT NULL
  ),
  CONSTRAINT agreement_scopes_validity_shape CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from
  )
);

CREATE INDEX idx_agreement_scopes_version ON agreement_scopes (workspace_id, agreement_version_id);
CREATE INDEX idx_agreement_scopes_organisation
  ON agreement_scopes (workspace_id, eligible_organisation_id)
  WHERE eligible_organisation_id IS NOT NULL;

-- Added after both tables exist (the circular root<->edition reference cannot
-- be declared inline). Deferred, so a version and its root register in either
-- order within one command; the deferred assertion below keeps the pointer
-- honest at COMMIT.
ALTER TABLE commercial_agreements
  ADD CONSTRAINT commercial_agreements_current_version_fk
  FOREIGN KEY (workspace_id, current_version_id)
  REFERENCES agreement_versions (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION assert_agreement_has_version() RETURNS trigger AS $$
BEGIN
  IF NEW.current_version_id IS NULL THEN
    RAISE EXCEPTION
      'commercial_agreements % committed without a current version edition',
      NEW.id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM agreement_versions v
     WHERE v.workspace_id = NEW.workspace_id
       AND v.id = NEW.current_version_id
       AND v.agreement_id = NEW.id
  ) THEN
    RAISE EXCEPTION
      'commercial_agreements %: current_version % is not an edition of this agreement',
      NEW.id, NEW.current_version_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER commercial_agreements_version_assert
  AFTER INSERT OR UPDATE OF current_version_id ON commercial_agreements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_agreement_has_version();

CREATE FUNCTION enforce_subject_subtype_commercial_agreement(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: COMMERCIAL_AGREEMENT subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM commercial_agreements a
     WHERE a.workspace_id = p_workspace_id AND a.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: COMMERCIAL_AGREEMENT subject % has no commercial_agreements row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('COMMERCIAL_AGREEMENT', 'enforce_subject_subtype_commercial_agreement', 'M3');

