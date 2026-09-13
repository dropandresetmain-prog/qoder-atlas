-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §2 "People, identity and governance tables":
-- organisations, principals and organisation_memberships.
--
-- Physical conventions from §1 applied throughout the M2 range: business rows
-- are workspace-scoped, the domain PK is (workspace_id, id), and every FK
-- carries workspace_id so a cross-workspace UUID cannot be inserted at all.
--
-- Mutable roots deliberately carry NO revision column: aggregate_heads holds
-- the single current revision and the typed row is validated against the
-- identity registry by the subtype checker installed at the bottom of this file.

-- gist operator classes for uuid/text equality inside the EXCLUDE constraints
-- below, which express §2's "nonoverlapping duplicate role grants".
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE organisations (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  legal_name text NOT NULL CHECK (length(btrim(legal_name)) > 0),
  display_name text,
  -- §1: exact currency codes; no float arithmetic on consequential amounts.
  default_currency_code char(3) NOT NULL CHECK (default_currency_code ~ '^[A-Z]{3}$'),
  lifecycle_status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (lifecycle_status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Provenance matches the accepted command envelope's actorPrincipalId, which
  -- SubjectIdSchema types as a constrained string rather than a uuid, so this
  -- column is text and is NOT a FK to principals (recorded as an architecture
  -- observation in docs/refactor/evidence/M2.md).
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE principals (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  auth_issuer text NOT NULL,
  auth_subject text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('HUMAN', 'SERVICE', 'SYSTEM')),
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  -- §2: "Unique auth issuer+subject within intended identity scope". The
  -- workspace is that identity scope in this deployment model. No password,
  -- token, key or secret material belongs in this table.
  UNIQUE (workspace_id, auth_issuer, auth_subject),
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE organisation_memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  organisation_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  -- §2: "Roles are assignments, not a string that grants powers" — a role here
  -- is a sourced organisational fact. Execution authority comes only from
  -- authority_grants (0019); membership alone never grants it.
  role text NOT NULL CHECK (length(btrim(role)) > 0),
  valid_from date NOT NULL,
  valid_until date,
  evidence_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT organisation_memberships_organisation_fk
    FOREIGN KEY (workspace_id, organisation_id) REFERENCES organisations (workspace_id, id),
  CONSTRAINT organisation_memberships_principal_fk
    FOREIGN KEY (workspace_id, principal_id) REFERENCES principals (workspace_id, id),
  CONSTRAINT organisation_memberships_valid_range CHECK (
    valid_until IS NULL OR valid_until > valid_from
  ),
  -- Same principal cannot hold two overlapping grants of the same role in one
  -- organisation; an open-ended membership blocks any later bounded one.
  CONSTRAINT organisation_memberships_no_overlap EXCLUDE USING gist (
    workspace_id WITH =,
    organisation_id WITH =,
    principal_id WITH =,
    role WITH =,
    daterange(valid_from, valid_until, '[)') WITH &&
  )
);

CREATE INDEX idx_organisation_memberships_principal
  ON organisation_memberships (workspace_id, principal_id, valid_from);
CREATE INDEX idx_organisation_memberships_organisation
  ON organisation_memberships (workspace_id, organisation_id, role);

-- ---------------------------------------------------------------------------
-- Subtype checkers (extension contract documented in 0010).
-- ---------------------------------------------------------------------------

CREATE FUNCTION enforce_subject_subtype_organisation(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: ORGANISATION subject % must be its own aggregate root (aggregate_id=% )',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM organisations o
     WHERE o.workspace_id = p_workspace_id AND o.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: ORGANISATION subject % has no organisations row', p_id;
  END IF;
END;
$$;

CREATE FUNCTION enforce_subject_subtype_principal(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: PRINCIPAL subject % must be its own aggregate root (aggregate_id=% )',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM principals pr
     WHERE pr.workspace_id = p_workspace_id AND pr.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: PRINCIPAL subject % has no principals row', p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('ORGANISATION', 'enforce_subject_subtype_organisation', 'M2'),
  ('PRINCIPAL', 'enforce_subject_subtype_principal', 'M2');
