-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §2: travellers is the stable person
-- identity; names and contacts are Traveller children that mutate under the
-- Traveller's own aggregate head (§1: no independently advancing duplicate
-- version fields on children).
--
-- F03 identity semantics are structural here, not conventional: there is no
-- event, booking, supplier-locator, dossier-key or fixture-derived column on
-- this table, so a Journey or provider record cannot silently define who a
-- person is. Deduplication requires the explicit MERGED transition plus
-- merged_into_traveller_id, never an inferred merge.

CREATE TABLE travellers (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  -- src/domain/v2/people/traveller.ts displayNameRef: "points at current
  -- traveller_names row". Deferred because the name row references the
  -- traveller back; both are written in one command transaction.
  display_name_ref uuid NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (lifecycle_status IN ('ACTIVE', 'MERGED', 'ARCHIVED')),
  merged_into_traveller_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  -- A merged Traveller is a redirect, not a second authority: it must name the
  -- surviving person, and cannot point at itself.
  CONSTRAINT travellers_merge_shape CHECK (
    (lifecycle_status = 'MERGED') = (merged_into_traveller_id IS NOT NULL)
  ),
  CONSTRAINT travellers_not_self_merge CHECK (
    merged_into_traveller_id IS NULL OR merged_into_traveller_id <> id
  )
);

CREATE INDEX idx_travellers_merged_into ON travellers (workspace_id, merged_into_traveller_id)
  WHERE merged_into_traveller_id IS NOT NULL;

CREATE TABLE traveller_names (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  traveller_id uuid NOT NULL,
  name_kind text NOT NULL CHECK (name_kind IN ('LEGAL', 'DISPLAY', 'PREFERRED', 'OTHER')),
  -- A rendered name is operationally required and is not a protected
  -- identifier; contact channels and document numbers ARE and live in
  -- protected-reference columns (0012 contacts, 0015 credential details).
  display_value text NOT NULL CHECK (length(btrim(display_value)) > 0),
  family_name text,
  given_name text,
  valid_from date NOT NULL,
  valid_until date,
  evidence_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT traveller_names_traveller_fk
    FOREIGN KEY (workspace_id, traveller_id) REFERENCES travellers (workspace_id, id),
  CONSTRAINT traveller_names_valid_range CHECK (valid_until IS NULL OR valid_until > valid_from)
);

ALTER TABLE travellers
  ADD CONSTRAINT travellers_display_name_fk
  FOREIGN KEY (workspace_id, display_name_ref) REFERENCES traveller_names (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_traveller_names_traveller ON traveller_names (workspace_id, traveller_id, name_kind);

CREATE TABLE traveller_contacts (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  traveller_id uuid NOT NULL,
  channel_kind text NOT NULL CHECK (channel_kind IN ('EMAIL', 'PHONE', 'POSTAL_ADDRESS', 'OTHER')),
  -- §2 "protected value/reference": the raw address is never stored in an
  -- ordinary row. Only the ProtectedDataRef triple from
  -- src/domain/v2/shared/identity.ts is kept, plus a label safe to render.
  masked_label text NOT NULL CHECK (length(btrim(masked_label)) > 0),
  value_content_hash text NOT NULL CHECK (length(value_content_hash) >= 16),
  value_storage_ref text NOT NULL CHECK (length(btrim(value_storage_ref)) > 0),
  value_access_policy_id text NOT NULL CHECK (length(btrim(value_access_policy_id)) > 0),
  valid_from date NOT NULL,
  valid_until date,
  evidence_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT traveller_contacts_traveller_fk
    FOREIGN KEY (workspace_id, traveller_id) REFERENCES travellers (workspace_id, id),
  CONSTRAINT traveller_contacts_valid_range CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE INDEX idx_traveller_contacts_traveller
  ON traveller_contacts (workspace_id, traveller_id, channel_kind);

-- ---------------------------------------------------------------------------
-- Subtype checker for TRAVELLER. Also verifies the cross-table rule §2 cannot
-- express with an ordinary FK: the display-name reference must select a name
-- belonging to that same Traveller.
-- ---------------------------------------------------------------------------

CREATE FUNCTION enforce_subject_subtype_traveller(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_name_traveller uuid;
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: TRAVELLER subject % must be its own aggregate root (aggregate_id=% )',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM travellers t
     WHERE t.workspace_id = p_workspace_id AND t.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: TRAVELLER subject % has no travellers row', p_id;
  END IF;

  SELECT n.traveller_id INTO v_name_traveller
    FROM travellers t
    JOIN traveller_names n
      ON n.workspace_id = t.workspace_id AND n.id = t.display_name_ref
   WHERE t.workspace_id = p_workspace_id AND t.id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: TRAVELLER subject % display_name_ref selects no traveller_names row',
      p_id;
  END IF;
  IF v_name_traveller <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: TRAVELLER subject % display_name_ref selects another traveller''s name',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('TRAVELLER', 'enforce_subject_subtype_traveller', 'M2');
