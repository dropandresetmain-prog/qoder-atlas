-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §6: `information_scopes` — "Version child:
-- area/jurisdiction/population/subject, effective exposure interval. Typed
-- scope operands and geometry/time queries; broad scope not expanded into
-- canonical traveller edges."
--
-- This is the applicability surface (milestone §F): structured, typed scope
-- operands per edition, so M6 matches without parsing prose. Population is a
-- bounded registered predicate reference (NOT free text to interpret later);
-- subject scope uses the discriminating registry FK.
--
-- M4 geography: area_version_id / jurisdiction_id are typed uuid + index;
-- FKs land in M4's own migration (documented deferral).

CREATE TABLE information_scopes (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  information_version_id uuid NOT NULL,
  -- M4 geography (GEOGRAPHIC_AREA version identity).
  area_version_id uuid,
  -- M4 geography (JURISDICTION identity).
  jurisdiction_id uuid,
  population_predicate_id text CHECK (population_predicate_id IS NULL OR length(population_predicate_id) > 0),
  population_parameters jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(population_parameters) = 'object' AND pg_column_size(population_parameters) <= 8192),
  subject_kind text REFERENCES subject_kinds (kind),
  subject_id uuid,
  purpose text,
  -- Product/service/category scope (e.g. "air transit", "hotel stay"): bounded
  -- registered category ids, not free prose.
  service_category text,
  -- Exposure: when a subject inside this scope is exposed to the edition.
  effective_exposure_from timestamptz NOT NULL,
  effective_exposure_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT information_scopes_version_fk
    FOREIGN KEY (workspace_id, information_version_id) REFERENCES information_versions (workspace_id, id),
  CONSTRAINT information_scopes_subject_fk
    FOREIGN KEY (workspace_id, subject_kind, subject_id)
    REFERENCES domain_subjects (workspace_id, id, kind),
  -- A scope must narrow to something: geography, population, subject, purpose
  -- or category. An empty scope would claim universal applicability, which is
  -- exactly what "broad scope not expanded into canonical edges" forbids.
  CONSTRAINT information_scopes_has_operand CHECK (
    area_version_id IS NOT NULL
    OR jurisdiction_id IS NOT NULL
    OR population_predicate_id IS NOT NULL
    OR (subject_kind IS NOT NULL AND subject_id IS NOT NULL)
    OR purpose IS NOT NULL
    OR service_category IS NOT NULL
  ),
  CONSTRAINT information_scopes_subject_complete CHECK (
    (subject_kind IS NULL) = (subject_id IS NULL)
  ),
  CONSTRAINT information_scopes_population_shape CHECK (
    (population_predicate_id IS NULL) = (population_parameters = '{}'::jsonb)
  ),
  CONSTRAINT information_scopes_exposure_ordered CHECK (
    effective_exposure_until > effective_exposure_from
  ),
  CONSTRAINT information_scopes_text_size CHECK (
    (purpose IS NULL OR length(purpose) <= 256)
    AND (service_category IS NULL OR length(service_category) <= 256)
  )
);

CREATE INDEX idx_information_scopes_version ON information_scopes (workspace_id, information_version_id);
-- §11 "Information by publisher/topic/jurisdiction and effective interval":
-- the M6 candidate set for "which editions apply to this jurisdiction/window".
CREATE INDEX idx_information_scopes_jurisdiction_exposure
  ON information_scopes (workspace_id, jurisdiction_id, effective_exposure_from, effective_exposure_until)
  WHERE jurisdiction_id IS NOT NULL;
CREATE INDEX idx_information_scopes_area_exposure
  ON information_scopes (workspace_id, area_version_id, effective_exposure_from, effective_exposure_until)
  WHERE area_version_id IS NOT NULL;
CREATE INDEX idx_information_scopes_subject_exposure
  ON information_scopes (workspace_id, subject_kind, subject_id, effective_exposure_from)
  WHERE subject_id IS NOT NULL;
CREATE INDEX idx_information_scopes_purpose
  ON information_scopes (workspace_id, purpose)
  WHERE purpose IS NOT NULL;
CREATE INDEX idx_information_scopes_category
  ON information_scopes (workspace_id, service_category)
  WHERE service_category IS NOT NULL;
