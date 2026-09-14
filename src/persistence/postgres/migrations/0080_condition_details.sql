-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §6: `condition_details` — InformationVersion
-- subtype: "condition type, forecast target, uncertainty model/schema. Add
-- typed weather/other details where needed; raw payload alone does not
-- implement consequence semantics."
--
-- A CONDITION is an observed/forecast state of the world (weather, outage,
-- disruption) — distinct from an ADVISORY (what a source says about risk).
-- The frozen contract's EV-charger-outage extension example (AT21) is exactly
-- this family; F16 extensions add typed detail tables in 0120+, they never
-- mutate this one's meaning.
--
-- Uncertainty is declared, not hidden: forecast target, interval and the
-- uncertainty model version are columns, so a reader can tell a forecast from
-- an observation without parsing prose.

CREATE TABLE condition_details (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  information_version_id uuid NOT NULL,
  condition_type text NOT NULL CHECK (length(btrim(condition_type)) > 0),
  -- Whether the condition is observed or forecast, and when it applies to.
  observation_basis text NOT NULL CHECK (observation_basis IN ('OBSERVED', 'FORECAST')),
  forecast_target_from timestamptz,
  forecast_target_until timestamptz,
  -- Declared uncertainty model ("which typed evaluator semantics describe this
  -- condition's uncertainty"). NULL = no uncertainty model claimed.
  uncertainty_model text,
  uncertainty_parameters jsonb NOT NULL DEFAULT '{}'
    CHECK (jsonb_typeof(uncertainty_parameters) = 'object' AND pg_column_size(uncertainty_parameters) <= 8192),
  source_native_detail jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(source_native_detail) = 'object'),
  detail_schema_version text NOT NULL CHECK (length(btrim(detail_schema_version)) > 0),
  PRIMARY KEY (workspace_id, information_version_id),
  CONSTRAINT condition_details_version_fk
    FOREIGN KEY (workspace_id, information_version_id) REFERENCES information_versions (workspace_id, id),
  CONSTRAINT condition_details_forecast_shape CHECK (
    (observation_basis = 'FORECAST') = (forecast_target_from IS NOT NULL)
  ),
  CONSTRAINT condition_details_forecast_ordered CHECK (
    forecast_target_until IS NULL OR (forecast_target_from IS NOT NULL AND forecast_target_until > forecast_target_from)
  ),
  CONSTRAINT condition_details_uncertainty_shape CHECK (
    (uncertainty_model IS NULL) = (uncertainty_parameters = '{}'::jsonb)
  )
);

CREATE TRIGGER condition_details_immutable
  BEFORE UPDATE OR DELETE ON condition_details
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE INDEX idx_condition_details_type ON condition_details (workspace_id, condition_type);
-- Forecast-target window scan for M6 time invalidation ("this forecast window
-- opened/closed since the last assessment").
CREATE INDEX idx_condition_details_forecast_target
  ON condition_details (workspace_id, forecast_target_from, forecast_target_until)
  WHERE forecast_target_from IS NOT NULL;
