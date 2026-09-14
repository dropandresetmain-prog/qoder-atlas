-- M7 (0101): recovery_strategies / strategy_changes.
-- Immutable versioned candidates. New content = new version. Scenario effects
-- are bounded typed JSON validated at the application boundary (ScenarioChangeSchema).

CREATE TABLE recovery_strategy_statuses (status text PRIMARY KEY);
INSERT INTO recovery_strategy_statuses (status) VALUES
  ('PROPOSED'), ('EVALUATED'), ('SELECTED'), ('REJECTED'), ('SUPERSEDED');

CREATE TABLE recovery_strategy_viabilities (viability text PRIMARY KEY);
INSERT INTO recovery_strategy_viabilities (viability) VALUES
  ('VIABLE'), ('NOT_VIABLE'), ('NOT_EXECUTABLE'), ('STALE_BASE'), ('REJECTED');

CREATE TABLE recovery_strategies (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  recovery_case_id uuid NOT NULL,
  strategy_version integer NOT NULL CHECK (strategy_version >= 1),
  status text NOT NULL REFERENCES recovery_strategy_statuses (status),
  viability text NOT NULL REFERENCES recovery_strategy_viabilities (viability),
  basis_assessment_id uuid,
  base_manifest jsonb NOT NULL CHECK (
    jsonb_typeof(base_manifest) = 'object' AND pg_column_size(base_manifest) <= 262144
  ),
  scenario_change jsonb NOT NULL CHECK (
    jsonb_typeof(scenario_change) = 'object' AND pg_column_size(scenario_change) <= 65536
  ),
  assumptions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(assumptions) = 'array' AND pg_column_size(assumptions) <= 16384
  ),
  required_unknowns jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(required_unknowns) = 'array' AND pg_column_size(required_unknowns) <= 16384
  ),
  candidate_assessment_summaries jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(candidate_assessment_summaries) = 'array'
    AND pg_column_size(candidate_assessment_summaries) <= 65536
  ),
  required_authority_scopes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(required_authority_scopes) = 'array'
    AND pg_column_size(required_authority_scopes) <= 8192
  ),
  rejection_reason text CHECK (rejection_reason IS NULL OR length(rejection_reason) <= 2048),
  created_at timestamptz NOT NULL DEFAULT now(),
  evaluated_at timestamptz,
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT recovery_strategies_case_fk
    FOREIGN KEY (workspace_id, recovery_case_id) REFERENCES recovery_cases (workspace_id, id),
  CONSTRAINT recovery_strategies_assessment_fk
    FOREIGN KEY (workspace_id, basis_assessment_id) REFERENCES assessments (workspace_id, id)
);

CREATE UNIQUE INDEX recovery_strategies_case_version_uidx
  ON recovery_strategies (workspace_id, recovery_case_id, strategy_version);

CREATE TRIGGER recovery_strategies_immutable
  BEFORE UPDATE OR DELETE ON recovery_strategies
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE strategy_changes (
  workspace_id uuid NOT NULL,
  recovery_strategy_id uuid NOT NULL,
  scenario_change_id uuid NOT NULL,
  strategy_version integer NOT NULL CHECK (strategy_version >= 1),
  affected_subjects jsonb NOT NULL CHECK (
    jsonb_typeof(affected_subjects) = 'array' AND pg_column_size(affected_subjects) <= 16384
  ),
  effects jsonb NOT NULL CHECK (
    jsonb_typeof(effects) = 'array' AND pg_column_size(effects) <= 65536
  ),
  basis_assessment_id uuid,
  PRIMARY KEY (workspace_id, recovery_strategy_id, scenario_change_id),
  CONSTRAINT strategy_changes_strategy_fk
    FOREIGN KEY (workspace_id, recovery_strategy_id) REFERENCES recovery_strategies (workspace_id, id),
  CONSTRAINT strategy_changes_assessment_fk
    FOREIGN KEY (workspace_id, basis_assessment_id) REFERENCES assessments (workspace_id, id)
);

CREATE TRIGGER strategy_changes_immutable
  BEFORE UPDATE OR DELETE ON strategy_changes
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE FUNCTION enforce_subject_subtype_recovery_strategy(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: RECOVERY_STRATEGY subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM recovery_strategies s WHERE s.workspace_id = p_workspace_id AND s.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: RECOVERY_STRATEGY subject % has no recovery_strategies row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by)
VALUES ('RECOVERY_STRATEGY', 'enforce_subject_subtype_recovery_strategy', 'M7');
