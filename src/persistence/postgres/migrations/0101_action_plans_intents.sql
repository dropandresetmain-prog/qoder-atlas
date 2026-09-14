-- M8 (0101): action_plans / action_intents / action_dependencies.
-- Frozen M0 ActionPlan contract. Intent owns immutable logical_operation_key
-- + request_fingerprint once dispatch is prepared.

CREATE TABLE action_plans (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  recovery_case_id uuid NOT NULL,
  scenario_change_id text NOT NULL CHECK (length(btrim(scenario_change_id)) > 0),
  version integer NOT NULL CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT action_plans_case_fk
    FOREIGN KEY (workspace_id, recovery_case_id) REFERENCES recovery_cases (workspace_id, id),
  CONSTRAINT action_plans_case_version_uidx UNIQUE (workspace_id, recovery_case_id, version)
);

CREATE INDEX idx_action_plans_case ON action_plans (workspace_id, recovery_case_id);

CREATE TABLE action_intents (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  action_plan_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1) DEFAULT 1,
  operation_namespace text NOT NULL CHECK (length(btrim(operation_namespace)) > 0),
  logical_operation_key text,
  request_fingerprint text,
  capability_ref text NOT NULL CHECK (length(btrim(capability_ref)) > 0),
  subject_refs jsonb NOT NULL CHECK (jsonb_typeof(subject_refs) = 'array' AND pg_column_size(subject_refs) <= 8192),
  expected_revisions jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(expected_revisions) = 'array' AND pg_column_size(expected_revisions) <= 8192),
  preconditions jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(preconditions) = 'array' AND pg_column_size(preconditions) <= 8192),
  offer_fingerprint text,
  cost_amount numeric,
  cost_currency text CHECK (cost_currency IS NULL OR cost_currency ~ '^[A-Z]{3}$'),
  limits jsonb CHECK (limits IS NULL OR (jsonb_typeof(limits) = 'object' AND pg_column_size(limits) <= 8192)),
  required_authority_scopes jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(required_authority_scopes) = 'array' AND pg_column_size(required_authority_scopes) <= 8192),
  expected_observations jsonb NOT NULL
    CHECK (jsonb_typeof(expected_observations) = 'array' AND pg_column_size(expected_observations) <= 8192),
  compensation_supported boolean NOT NULL DEFAULT false,
  compensation_requires_separate_authority boolean NOT NULL DEFAULT true,
  compensation_description text,
  status text NOT NULL CHECK (status IN (
    'PROPOSED', 'AUTHORIZED', 'REJECTED', 'SUPERSEDED', 'EXECUTING', 'COMPLETED', 'FAILED'
  )),
  basis_assessment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT action_intents_plan_fk
    FOREIGN KEY (workspace_id, action_plan_id) REFERENCES action_plans (workspace_id, id),
  CONSTRAINT action_intents_assessment_fk
    FOREIGN KEY (workspace_id, basis_assessment_id) REFERENCES assessments (workspace_id, id),
  CONSTRAINT action_intents_cost_shape CHECK (
    (cost_amount IS NULL AND cost_currency IS NULL)
    OR (cost_amount IS NOT NULL AND cost_currency IS NOT NULL AND cost_amount > 0)
  ),
  CONSTRAINT action_intents_dispatch_identity_shape CHECK (
    (logical_operation_key IS NULL AND request_fingerprint IS NULL)
    OR (logical_operation_key IS NOT NULL AND request_fingerprint IS NOT NULL)
  ),
  -- Unique workspace+operation_namespace+logical_operation_key once prepared.
  CONSTRAINT action_intents_logical_op_uidx
    UNIQUE (workspace_id, operation_namespace, logical_operation_key)
);

CREATE INDEX idx_action_intents_plan ON action_intents (workspace_id, action_plan_id, status);
CREATE INDEX idx_action_intents_status ON action_intents (workspace_id, status)
  WHERE status IN ('PROPOSED', 'AUTHORIZED', 'EXECUTING');

CREATE TABLE action_dependencies (
  workspace_id uuid NOT NULL,
  from_action_intent_id uuid NOT NULL,
  to_action_intent_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, from_action_intent_id, to_action_intent_id),
  CONSTRAINT action_dependencies_from_fk
    FOREIGN KEY (workspace_id, from_action_intent_id) REFERENCES action_intents (workspace_id, id),
  CONSTRAINT action_dependencies_to_fk
    FOREIGN KEY (workspace_id, to_action_intent_id) REFERENCES action_intents (workspace_id, id),
  CONSTRAINT action_dependencies_no_self CHECK (from_action_intent_id <> to_action_intent_id)
);

CREATE FUNCTION enforce_subject_subtype_action_plan(
  p_workspace_id uuid, p_id uuid, p_kind text, p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION 'domain_subjects subtype violation: ACTION_PLAN % must be its own aggregate', p_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM action_plans WHERE workspace_id = p_workspace_id AND id = p_id) THEN
    RAISE EXCEPTION 'domain_subjects subtype violation: ACTION_PLAN % has no action_plans row', p_id;
  END IF;
END;
$$;

CREATE FUNCTION enforce_subject_subtype_action_intent(
  p_workspace_id uuid, p_id uuid, p_kind text, p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_plan uuid;
BEGIN
  SELECT action_plan_id INTO v_plan FROM action_intents WHERE workspace_id = p_workspace_id AND id = p_id;
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'domain_subjects subtype violation: ACTION_INTENT % has no action_intents row', p_id;
  END IF;
  IF p_aggregate_id <> v_plan THEN
    RAISE EXCEPTION 'domain_subjects subtype violation: ACTION_INTENT % aggregate must be its plan %', p_id, v_plan;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('ACTION_PLAN', 'enforce_subject_subtype_action_plan', 'M8'),
  ('ACTION_INTENT', 'enforce_subject_subtype_action_intent', 'M8');
