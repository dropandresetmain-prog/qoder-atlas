-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §3 / DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md
-- §4.2 and §14: the accompaniment REQUIREMENT is the governing
-- ConstraintDefinition and the SUPPORT ASSIGNMENT (0028) is only selected
-- fulfilment inside it. The whole point of this split is that no assignment
-- operation can widen or weaken the requirement, so the guarantee is built out
-- of four structural facts rather than handler discipline:
--
--   1. Requirement versions are append-only (forbid_mutation) and immutable:
--      changing coverage, minimum simultaneous supporters, eligibility or the
--      permitted handoff gap is a new (id, version) row, never an in-place
--      edit an existing assignment could quietly ride along with.
--   2. (workspace_id, id, version) is the primary key, and an assignment must
--      name the exact version it was made against - a real composite foreign
--      key in 0028, not a pair of columns that may or may not agree.
--   3. No status/pass-fail column exists here. Whether coverage is actually met
--      is an Assessment result (F13), never an attribute of the requirement.
--   4. Requirement rules have no JSON bag: eligible supporters are an
--      association table and the scalars are columns.
--
-- Scope note for the integrator: §3 lists generic `constraint_definitions` /
-- `constraint_operands` as requirement-owner children with a registered type,
-- hardness and parameter schema. That generic registry is the M5 rules / M6
-- evaluator surface; M2 materializes only the accompaniment type named by the
-- frozen contract, as its own typed table, and deliberately does not build a
-- registered-type operand mechanism it has no evaluator for.

CREATE TABLE accompaniment_requirements (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  supported_traveller_id uuid NOT NULL,
  coverage_start timestamptz NOT NULL,
  coverage_end timestamptz NOT NULL,
  minimum_simultaneous_supporters integer NOT NULL CHECK (minimum_simultaneous_supporters >= 1),
  maximum_handoff_gap_minutes integer NOT NULL DEFAULT 0 CHECK (maximum_handoff_gap_minutes >= 0),
  provenance_evidence_id uuid,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id, version),
  CONSTRAINT accompaniment_requirements_supported_traveller_fk
    FOREIGN KEY (workspace_id, supported_traveller_id)
    REFERENCES travellers (workspace_id, id),
  CONSTRAINT accompaniment_requirements_coverage_ordered
    CHECK (coverage_end > coverage_start)
);

CREATE TRIGGER accompaniment_requirements_immutable
  BEFORE UPDATE OR DELETE ON accompaniment_requirements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE INDEX idx_accompaniment_requirements_supported
  ON accompaniment_requirements (workspace_id, supported_traveller_id, coverage_start);
CREATE INDEX idx_accompaniment_requirements_provenance
  ON accompaniment_requirements (workspace_id, provenance_evidence_id)
  WHERE provenance_evidence_id IS NOT NULL;

-- Contract: eligibleSupporterTravellerIds: SubjectId[].min(1). Keyed by the
-- exact requirement version so a new version cannot inherit rows by accident:
-- each version restates its own eligible set, and ON DELETE CASCADE is
-- therefore unreachable (updates are blocked by the immutability trigger).
CREATE TABLE accompaniment_eligible_supporters (
  workspace_id uuid NOT NULL,
  requirement_id uuid NOT NULL,
  requirement_version integer NOT NULL,
  supporter_traveller_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, requirement_id, requirement_version, supporter_traveller_id),
  CONSTRAINT accompaniment_eligible_supporters_requirement_fk
    FOREIGN KEY (workspace_id, requirement_id, requirement_version)
    REFERENCES accompaniment_requirements (workspace_id, id, version),
  CONSTRAINT accompaniment_eligible_supporters_traveller_fk
    FOREIGN KEY (workspace_id, supporter_traveller_id)
    REFERENCES travellers (workspace_id, id)
);

CREATE INDEX idx_accompaniment_eligible_supporters_traveller
  ON accompaniment_eligible_supporters (workspace_id, supporter_traveller_id);

CREATE FUNCTION assert_accompaniment_requirement_has_eligible() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM accompaniment_eligible_supporters e
     WHERE e.workspace_id = NEW.workspace_id
       AND e.requirement_id = NEW.id
       AND e.requirement_version = NEW.version
  ) THEN
    RAISE EXCEPTION
      'accompaniment_requirements % v% names no eligible supporter (an unstaffable requirement is not a requirement)',
      NEW.id, NEW.version;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER accompaniment_requirements_eligible_assert
  AFTER INSERT ON accompaniment_requirements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_accompaniment_requirement_has_eligible();
