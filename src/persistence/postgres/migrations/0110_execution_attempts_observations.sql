-- M8 (0110): execution_attempts and execution_observations.
-- Logical operation identity belongs to the ActionIntent. Lease expiry after
-- possible dispatch is NEVER proof that a resend is safe.

CREATE TABLE execution_attempts (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  action_intent_id uuid NOT NULL,
  attempt_number integer NOT NULL CHECK (attempt_number >= 1),
  logical_operation_key text NOT NULL CHECK (length(btrim(logical_operation_key)) > 0),
  request_fingerprint text NOT NULL CHECK (length(btrim(request_fingerprint)) > 0),
  claim_token text,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  lease_expires_at timestamptz,
  status text NOT NULL CHECK (status IN (
    'PREPARED',
    'CLAIMED',
    'DISPATCHING',
    'DISPATCHED',
    'OUTCOME_UNKNOWN',
    'OBSERVED_SUCCESS',
    'OBSERVED_FAILURE',
    'RECONCILIATION_REQUIRED',
    'RECONCILED',
    'COMPLETED',
    'FAILED'
  )),
  request_ref text,
  response_ref text,
  provider_operation_key text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT execution_attempts_intent_fk
    FOREIGN KEY (workspace_id, action_intent_id) REFERENCES action_intents (workspace_id, id),
  CONSTRAINT execution_attempts_number_uidx UNIQUE (workspace_id, action_intent_id, attempt_number)
);

-- At most one active dispatch claim per intent.
CREATE UNIQUE INDEX execution_attempts_one_active_claim_uidx
  ON execution_attempts (workspace_id, action_intent_id)
  WHERE status IN ('CLAIMED', 'DISPATCHING', 'DISPATCHED');

CREATE INDEX idx_execution_attempts_runnable
  ON execution_attempts (workspace_id, status, lease_expires_at)
  WHERE status IN ('PREPARED', 'CLAIMED', 'OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED');

CREATE INDEX idx_execution_attempts_logical_op
  ON execution_attempts (workspace_id, logical_operation_key, attempt_number);

CREATE TABLE execution_observations (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  action_intent_id uuid NOT NULL,
  origin text NOT NULL CHECK (origin IN ('EXTERNAL_PROVIDER', 'INTERNAL_COMMAND_RECEIPT')),
  external_record_id uuid,
  source_owned_fields jsonb
    CHECK (source_owned_fields IS NULL OR (jsonb_typeof(source_owned_fields) = 'object' AND pg_column_size(source_owned_fields) <= 65536)),
  command_receipt_ref text,
  observed_at timestamptz NOT NULL,
  owned_subject_refs jsonb NOT NULL
    CHECK (jsonb_typeof(owned_subject_refs) = 'array' AND pg_column_size(owned_subject_refs) <= 8192),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT execution_observations_attempt_fk
    FOREIGN KEY (workspace_id, attempt_id) REFERENCES execution_attempts (workspace_id, id),
  CONSTRAINT execution_observations_intent_fk
    FOREIGN KEY (workspace_id, action_intent_id) REFERENCES action_intents (workspace_id, id),
  CONSTRAINT execution_observations_origin_shape CHECK (
    (origin = 'EXTERNAL_PROVIDER' AND external_record_id IS NOT NULL AND source_owned_fields IS NOT NULL AND command_receipt_ref IS NULL)
    OR (origin = 'INTERNAL_COMMAND_RECEIPT' AND command_receipt_ref IS NOT NULL AND external_record_id IS NULL)
  )
);

CREATE INDEX idx_execution_observations_attempt
  ON execution_observations (workspace_id, attempt_id, observed_at DESC);

CREATE FUNCTION enforce_subject_subtype_execution_attempt(
  p_workspace_id uuid, p_id uuid, p_kind text, p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_intent uuid;
BEGIN
  SELECT action_intent_id INTO v_intent FROM execution_attempts WHERE workspace_id = p_workspace_id AND id = p_id;
  IF v_intent IS NULL THEN
    RAISE EXCEPTION 'domain_subjects subtype violation: EXECUTION_ATTEMPT % missing row', p_id;
  END IF;
  -- Attempt is a child of the ActionPlan aggregate (via intent); aggregate_id is the plan.
  IF NOT EXISTS (
    SELECT 1 FROM action_intents i
     WHERE i.workspace_id = p_workspace_id AND i.id = v_intent AND i.action_plan_id = p_aggregate_id
  ) THEN
    RAISE EXCEPTION 'domain_subjects subtype violation: EXECUTION_ATTEMPT % aggregate must be its plan', p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('EXECUTION_ATTEMPT', 'enforce_subject_subtype_execution_attempt', 'M8');
