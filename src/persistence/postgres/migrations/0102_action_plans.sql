-- M7 (0102): action_plans / action_intents / action_dependencies / case_action_links.
-- Typed DAG only. M8 owns authority_decisions / execution_attempts (0109+).
--
-- Integration-owner note (M7/M8/C3 integration; see
-- docs/work/M7_M8_INTEGRATION_ACTIVE_TASK.md §3c): cost_estimate and
-- compensation_policy below are stored as typed columns rather than opaque
-- jsonb — this exactly matches the frozen ExactMoneySchema {amount,currency}
-- and CompensationPolicySchema {supported,requiresSeparateAuthority,
-- description} shapes (src/contracts/v2/action/actionPlan.ts,
-- src/domain/v2/shared/money.ts) with real constraints instead of an opaque
-- blob, and keeps money in Postgres `numeric` (exact, no float) consistent
-- with the I-10 exact-arithmetic invariant M8 owns.

CREATE TABLE action_intent_statuses (status text PRIMARY KEY);
INSERT INTO action_intent_statuses (status) VALUES
  ('PROPOSED'), ('AUTHORIZED'), ('REJECTED'), ('SUPERSEDED'),
  ('EXECUTING'), ('COMPLETED'), ('FAILED');

CREATE TABLE action_plans (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  recovery_case_id uuid NOT NULL,
  scenario_change_id uuid NOT NULL,
  recovery_strategy_id uuid,
  plan_version integer NOT NULL DEFAULT 1 CHECK (plan_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT action_plans_case_fk
    FOREIGN KEY (workspace_id, recovery_case_id) REFERENCES recovery_cases (workspace_id, id),
  CONSTRAINT action_plans_strategy_fk
    FOREIGN KEY (workspace_id, recovery_strategy_id) REFERENCES recovery_strategies (workspace_id, id)
);

CREATE TRIGGER action_plans_immutable
  BEFORE UPDATE OR DELETE ON action_plans
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE action_intents (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  action_plan_id uuid NOT NULL,
  operation_namespace text NOT NULL CHECK (length(btrim(operation_namespace)) > 0 AND length(operation_namespace) <= 256),
  logical_operation_key text CHECK (logical_operation_key IS NULL OR length(logical_operation_key) <= 512),
  request_fingerprint text CHECK (request_fingerprint IS NULL OR length(request_fingerprint) <= 128),
  capability_ref text NOT NULL CHECK (length(btrim(capability_ref)) > 0 AND length(capability_ref) <= 256),
  subject_refs jsonb NOT NULL CHECK (
    jsonb_typeof(subject_refs) = 'array' AND jsonb_array_length(subject_refs) >= 1
    AND pg_column_size(subject_refs) <= 16384
  ),
  expected_revisions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(expected_revisions) = 'array' AND pg_column_size(expected_revisions) <= 16384
  ),
  preconditions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(preconditions) = 'array' AND pg_column_size(preconditions) <= 16384
  ),
  offer_fingerprint text CHECK (offer_fingerprint IS NULL OR length(offer_fingerprint) <= 128),
  cost_amount numeric,
  cost_currency text CHECK (cost_currency IS NULL OR cost_currency ~ '^[A-Z]{3}$'),
  limits jsonb CHECK (limits IS NULL OR (
    jsonb_typeof(limits) = 'object' AND pg_column_size(limits) <= 8192
  )),
  required_authority_scopes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(required_authority_scopes) = 'array'
    AND pg_column_size(required_authority_scopes) <= 8192
  ),
  expected_observations jsonb NOT NULL CHECK (
    jsonb_typeof(expected_observations) = 'array' AND jsonb_array_length(expected_observations) >= 1
    AND pg_column_size(expected_observations) <= 16384
  ),
  compensation_supported boolean NOT NULL,
  compensation_requires_separate_authority boolean NOT NULL DEFAULT true,
  compensation_description text,
  status text NOT NULL REFERENCES action_intent_statuses (status),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT action_intents_plan_fk
    FOREIGN KEY (workspace_id, action_plan_id) REFERENCES action_plans (workspace_id, id),
  CONSTRAINT action_intents_cost_shape CHECK (
    (cost_amount IS NULL AND cost_currency IS NULL)
    OR (cost_amount IS NOT NULL AND cost_currency IS NOT NULL AND cost_amount > 0)
  )
);

-- Once a logical operation key is prepared, it is unique per workspace+namespace.
CREATE UNIQUE INDEX action_intents_logical_op_uidx
  ON action_intents (workspace_id, operation_namespace, logical_operation_key)
  WHERE logical_operation_key IS NOT NULL;

CREATE TRIGGER action_intents_immutable
  BEFORE UPDATE OR DELETE ON action_intents
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE action_dependencies (
  workspace_id uuid NOT NULL,
  action_plan_id uuid NOT NULL,
  from_action_intent_id uuid NOT NULL,
  to_action_intent_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, action_plan_id, from_action_intent_id, to_action_intent_id),
  CONSTRAINT action_dependencies_plan_fk
    FOREIGN KEY (workspace_id, action_plan_id) REFERENCES action_plans (workspace_id, id),
  CONSTRAINT action_dependencies_from_fk
    FOREIGN KEY (workspace_id, from_action_intent_id) REFERENCES action_intents (workspace_id, id),
  CONSTRAINT action_dependencies_to_fk
    FOREIGN KEY (workspace_id, to_action_intent_id) REFERENCES action_intents (workspace_id, id),
  CONSTRAINT action_dependencies_not_self CHECK (from_action_intent_id <> to_action_intent_id)
);

CREATE TRIGGER action_dependencies_immutable
  BEFORE UPDATE OR DELETE ON action_dependencies
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE case_action_links (
  workspace_id uuid NOT NULL,
  referencing_case_id uuid NOT NULL,
  action_intent_id uuid NOT NULL,
  role text NOT NULL CHECK (length(btrim(role)) > 0 AND length(role) <= 128),
  PRIMARY KEY (workspace_id, referencing_case_id, action_intent_id),
  CONSTRAINT case_action_links_case_fk
    FOREIGN KEY (workspace_id, referencing_case_id) REFERENCES recovery_cases (workspace_id, id),
  CONSTRAINT case_action_links_intent_fk
    FOREIGN KEY (workspace_id, action_intent_id) REFERENCES action_intents (workspace_id, id)
);

CREATE FUNCTION enforce_subject_subtype_action_plan(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: ACTION_PLAN subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM action_plans p WHERE p.workspace_id = p_workspace_id AND p.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: ACTION_PLAN subject % has no action_plans row',
      p_id;
  END IF;
END;
$$;

CREATE FUNCTION enforce_subject_subtype_action_intent(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_plan uuid;
BEGIN
  SELECT action_plan_id INTO v_plan
    FROM action_intents
   WHERE workspace_id = p_workspace_id AND id = p_id;
  IF v_plan IS NULL THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: ACTION_INTENT subject % has no action_intents row',
      p_id;
  END IF;
  IF p_aggregate_id <> v_plan THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: ACTION_INTENT subject % aggregate_id must be its action_plan_id % (got %)',
      p_id, v_plan, p_aggregate_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('ACTION_PLAN', 'enforce_subject_subtype_action_plan', 'M7'),
  ('ACTION_INTENT', 'enforce_subject_subtype_action_intent', 'M7');
