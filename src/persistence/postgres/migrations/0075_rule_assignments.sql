-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §6: `rule_assignments` — "Root/association:
-- policy family/edition rule, subject/org/population/geography scope, validity.
-- Add/remove changes applicability generation; exact matching rules registered."
-- Closure §4.5: "Applies an exact policy family/edition selection rule to
-- organisation/population/subject/time."
--
-- The applicability side is typed columns (§F of the milestone brief); M6 does
-- the matching. Scope operand columns are individually nullable; at least one
-- scope operand must be present, so an assignment always narrows to something.

CREATE TABLE rule_assignments (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  rule_set_id uuid NOT NULL,
  -- Either an exact edition or the rule set's currently-effective publication
  -- at evaluation time; exactly one selection rule per assignment.
  rule_set_version_id uuid,
  select_current_edition boolean NOT NULL DEFAULT false,
  organisation_id uuid,
  subject_kind text REFERENCES subject_kinds (kind),
  subject_id uuid,
  -- M4 geography: uuid + index now; FK lands in M4's own migration (§M of the
  -- brief; recorded in docs/refactor/evidence/M5.md and M2's §7A precedent).
  jurisdiction_id uuid,
  -- Bounded registered population predicate id + parameters (NOT prose to be
  -- interpreted at runtime; closure §8 "registered operators").
  population_predicate_id text CHECK (population_predicate_id IS NULL OR length(population_predicate_id) > 0),
  population_parameters jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(population_parameters) = 'object' AND pg_column_size(population_parameters) <= 8192),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT rule_assignments_rule_set_fk
    FOREIGN KEY (workspace_id, rule_set_id) REFERENCES rule_sets (workspace_id, id),
  CONSTRAINT rule_assignments_edition_fk
    FOREIGN KEY (workspace_id, rule_set_version_id) REFERENCES rule_set_versions (workspace_id, id),
  CONSTRAINT rule_assignments_organisation_fk
    FOREIGN KEY (workspace_id, organisation_id) REFERENCES organisations (workspace_id, id),
  CONSTRAINT rule_assignments_subject_fk
    FOREIGN KEY (workspace_id, subject_id, subject_kind)
    REFERENCES domain_subjects (workspace_id, id, kind),
  CONSTRAINT rule_assignments_selection_exclusive CHECK (
    (rule_set_version_id IS NULL) = select_current_edition
  ),
  CONSTRAINT rule_assignments_validity_ordered CHECK (
    valid_until IS NULL OR valid_until > valid_from
  ),
  CONSTRAINT rule_assignments_has_scope CHECK (
    organisation_id IS NOT NULL
    OR (subject_kind IS NOT NULL AND subject_id IS NOT NULL)
    OR jurisdiction_id IS NOT NULL
    OR population_predicate_id IS NOT NULL
  ),
  CONSTRAINT rule_assignments_subject_complete CHECK (
    (subject_kind IS NULL) = (subject_id IS NULL)
  ),
  CONSTRAINT rule_assignments_population_shape CHECK (
    (population_predicate_id IS NULL) = (population_parameters = '{}'::jsonb)
  )
);

CREATE INDEX idx_rule_assignments_rule_set ON rule_assignments (workspace_id, rule_set_id, valid_from);
CREATE INDEX idx_rule_assignments_edition
  ON rule_assignments (workspace_id, rule_set_version_id)
  WHERE rule_set_version_id IS NOT NULL;
CREATE INDEX idx_rule_assignments_organisation
  ON rule_assignments (workspace_id, organisation_id)
  WHERE organisation_id IS NOT NULL;
CREATE INDEX idx_rule_assignments_subject
  ON rule_assignments (workspace_id, subject_kind, subject_id, valid_from)
  WHERE subject_id IS NOT NULL;
-- §11 "Rule assignments by organisation/subject/jurisdiction/population and
-- validity": which assignments depend on a jurisdiction (M4 FK will complete
-- the reverse lookup).
CREATE INDEX idx_rule_assignments_jurisdiction
  ON rule_assignments (workspace_id, jurisdiction_id, valid_from)
  WHERE jurisdiction_id IS NOT NULL;
