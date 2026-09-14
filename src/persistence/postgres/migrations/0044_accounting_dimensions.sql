-- "accounting_assignments" / closure §4.3: org-owned cost-centre/project
-- dimensions and the scoped associations that attach subjects to them. An
-- intended assignment is distinct from actual transaction evidence (which is
-- cost_allocations, 0046).
--
-- The M0 contract models a dimension assignment as a subject reference; the
-- subject kind is validated against the registry (discriminating FK), so an
-- assignment can never name a non-subject.

CREATE TABLE accounting_dimensions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  organisation_id uuid NOT NULL,
  namespace text NOT NULL,
  external_key text NOT NULL,
  display_name text NOT NULL,
  valid_from date,
  valid_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT accounting_dimensions_organisation_fk
    FOREIGN KEY (workspace_id, organisation_id) REFERENCES organisations (workspace_id, id),
  -- §4: unique organisation+namespace+external key.
  CONSTRAINT accounting_dimensions_identity_uidx
    UNIQUE (workspace_id, organisation_id, namespace, external_key),
  CONSTRAINT accounting_dimensions_validity_shape CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from
  )
);

CREATE INDEX idx_accounting_dimensions_organisation
  ON accounting_dimensions (workspace_id, organisation_id);

CREATE TABLE accounting_assignments (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  dimension_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  subject_kind text NOT NULL,
  allocation_basis text NOT NULL,
  valid_from timestamptz,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT accounting_assignments_dimension_fk
    FOREIGN KEY (workspace_id, dimension_id)
    REFERENCES accounting_dimensions (workspace_id, id),
  -- Subject kind validated: the pair must exist in the registry.
  CONSTRAINT accounting_assignments_subject_fk
    FOREIGN KEY (workspace_id, subject_id, subject_kind)
    REFERENCES domain_subjects (workspace_id, id, kind),
  CONSTRAINT accounting_assignments_validity_shape CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from
  ),
  -- One current assignment per (dimension, subject): rebasing is a change with
  -- audit, not a second concurrent truth.
  CONSTRAINT accounting_assignments_current_uidx
    UNIQUE (workspace_id, dimension_id, subject_id)
);

CREATE INDEX idx_accounting_assignments_subject
  ON accounting_assignments (workspace_id, subject_id, subject_kind);
CREATE INDEX idx_accounting_assignments_dimension
  ON accounting_assignments (workspace_id, dimension_id);

