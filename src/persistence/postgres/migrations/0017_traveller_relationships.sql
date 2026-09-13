-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §2 / F05: traveller_relationships is a
-- sourced human relationship. It is a distinct concept from a responsibility,
-- an authority grant and a support requirement, and nothing in this file may
-- imply any of them. A PARENT_GUARDIAN row therefore creates no permission on
-- its own: authority only exists where authority_grants (0019) says so.
--
-- The relationship stays directional, because "X is the parent of Y" and "Y is
-- the parent of X" are different claims and a guardian duty runs one way.

CREATE TABLE traveller_relationships (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  from_traveller_id uuid NOT NULL,
  to_traveller_id uuid NOT NULL,
  relationship_type text NOT NULL CHECK (
    relationship_type IN ('PARENT_GUARDIAN', 'SPOUSE_PARTNER', 'PEER', 'ASSISTANT')
  ),
  effective_from date NOT NULL,
  effective_to date,
  evidence_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT traveller_relationships_from_fk
    FOREIGN KEY (workspace_id, from_traveller_id) REFERENCES travellers (workspace_id, id),
  CONSTRAINT traveller_relationships_to_fk
    FOREIGN KEY (workspace_id, to_traveller_id) REFERENCES travellers (workspace_id, id),
  -- §2: "Two distinct valid people" — a person is never their own guardian,
  -- spouse or peer.
  CONSTRAINT traveller_relationships_distinct_people CHECK (from_traveller_id <> to_traveller_id),
  CONSTRAINT traveller_relationships_effective_range CHECK (
    effective_to IS NULL OR effective_to > effective_from
  ),
  -- The same directional pair cannot hold two overlapping records of one
  -- relationship type; a correction is a new dated relationship, not a duplicate.
  CONSTRAINT traveller_relationships_no_overlap EXCLUDE USING gist (
    workspace_id WITH =,
    from_traveller_id WITH =,
    to_traveller_id WITH =,
    relationship_type WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  )
);

-- Both directions are indexed: M6 must answer "who is connected to this person"
-- as well as "who does this person depend on".
CREATE INDEX idx_traveller_relationships_from ON traveller_relationships (workspace_id, from_traveller_id);
CREATE INDEX idx_traveller_relationships_to ON traveller_relationships (workspace_id, to_traveller_id);

CREATE FUNCTION enforce_subject_subtype_traveller_relationship(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: TRAVELLER_RELATIONSHIP subject % must be its own aggregate root (aggregate_id=% )',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM traveller_relationships r
     WHERE r.workspace_id = p_workspace_id AND r.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: TRAVELLER_RELATIONSHIP subject % has no traveller_relationships row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('TRAVELLER_RELATIONSHIP', 'enforce_subject_subtype_traveller_relationship', 'M2');
