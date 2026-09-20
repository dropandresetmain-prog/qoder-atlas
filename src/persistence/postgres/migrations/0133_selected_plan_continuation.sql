-- Selected-plan continuation. These are evidence records, not a new scheduler.
-- Old intents are deliberately NOT backfilled by guessing their source effect.
ALTER TABLE action_intents
  ADD COLUMN source_effect_index integer CHECK (source_effect_index >= 0),
  ADD COLUMN source_effect_fingerprint text CHECK (source_effect_fingerprint ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT selected_effect_identity_pair CHECK
    ((source_effect_index IS NULL) = (source_effect_fingerprint IS NULL));
CREATE UNIQUE INDEX selected_effect_once_per_plan ON action_intents
  (workspace_id, action_plan_id, source_effect_index) WHERE source_effect_index IS NOT NULL;

-- Read-only planning materialization. NOT a stay execution binding: it confers
-- no provider capability and contains no booking workflowState or credentials.
CREATE TABLE selected_plan_evaluation_inputs (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  recovery_strategy_id uuid NOT NULL,
  source_fingerprint text NOT NULL CHECK (source_fingerprint ~ '^[a-f0-9]{64}$'),
  materialization jsonb NOT NULL CHECK
    (jsonb_typeof(materialization) = 'object' AND pg_column_size(materialization) <= 1048576),
  materialization_fingerprint text NOT NULL CHECK (materialization_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, recovery_strategy_id),
  FOREIGN KEY (workspace_id, recovery_strategy_id) REFERENCES recovery_strategies(workspace_id,id)
);
CREATE TRIGGER selected_plan_evaluation_inputs_immutable BEFORE UPDATE OR DELETE
  ON selected_plan_evaluation_inputs FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- One row per ACTUAL canonical command, linked inside its UnitOfWork before
-- COMMIT. Supporting writes are retained too: allocations change Journey and
-- Traveller scope generations without changing the Journey aggregate head.
CREATE TABLE selected_plan_canonical_applications (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  attempt_id uuid NOT NULL,
  action_plan_id uuid NOT NULL,
  action_intent_id uuid NOT NULL,
  source_strategy_id uuid NOT NULL,
  source_effect_index integer NOT NULL CHECK (source_effect_index >= 0),
  source_effect_fingerprint text NOT NULL CHECK (source_effect_fingerprint ~ '^[a-f0-9]{64}$'),
  request_fingerprint text NOT NULL,
  application_origin text NOT NULL CHECK (application_origin IN ('EXTERNAL_PROVIDER','INTERNAL_COMMAND')),
  source_observation_id uuid,
  command_namespace text NOT NULL,
  idempotency_key text NOT NULL,
  receipt_payload_hash text NOT NULL,
  completes_effect boolean NOT NULL,
  scope_changes jsonb NOT NULL CHECK
    (jsonb_typeof(scope_changes) = 'array' AND pg_column_size(scope_changes) <= 65536),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, attempt_id, command_namespace, idempotency_key),
  UNIQUE (workspace_id, command_namespace, idempotency_key),
  FOREIGN KEY (workspace_id, attempt_id) REFERENCES execution_attempts(workspace_id,id),
  FOREIGN KEY (workspace_id, action_plan_id) REFERENCES action_plans(workspace_id,id),
  FOREIGN KEY (workspace_id, action_intent_id) REFERENCES action_intents(workspace_id,id),
  FOREIGN KEY (workspace_id, source_strategy_id) REFERENCES recovery_strategies(workspace_id,id),
  FOREIGN KEY (workspace_id, source_observation_id) REFERENCES execution_observations(workspace_id,id),
  FOREIGN KEY (workspace_id, command_namespace, idempotency_key)
    REFERENCES command_receipts(workspace_id,command_namespace,idempotency_key)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK ((application_origin = 'EXTERNAL_PROVIDER' AND source_observation_id IS NOT NULL)
      OR (application_origin = 'INTERNAL_COMMAND' AND source_observation_id IS NULL))
);
CREATE UNIQUE INDEX selected_plan_one_completion ON selected_plan_canonical_applications
  (workspace_id, action_intent_id) WHERE completes_effect;
CREATE TRIGGER selected_plan_canonical_applications_immutable BEFORE UPDATE OR DELETE
  ON selected_plan_canonical_applications FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Deferred because PgUnitOfWork inserts the receipt after the domain body.
-- A receipt for another attempt, source kind, plan or effect cannot be attached.
CREATE FUNCTION assert_selected_plan_application_owner() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM execution_attempts a
      JOIN action_intents i ON i.workspace_id=a.workspace_id AND i.id=a.action_intent_id
      JOIN action_plans p ON p.workspace_id=i.workspace_id AND p.id=i.action_plan_id
      JOIN command_receipts r ON r.workspace_id=NEW.workspace_id
        AND r.command_namespace=NEW.command_namespace AND r.idempotency_key=NEW.idempotency_key
    WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.attempt_id
      AND i.id=NEW.action_intent_id AND p.id=NEW.action_plan_id
      AND p.recovery_strategy_id=NEW.source_strategy_id
      AND i.source_effect_index=NEW.source_effect_index
      AND i.source_effect_fingerprint=NEW.source_effect_fingerprint
      AND i.request_fingerprint=NEW.request_fingerprint AND a.request_fingerprint=i.request_fingerprint
      AND r.payload_hash=NEW.receipt_payload_hash
      AND ((i.capability_ref LIKE 'external:%' AND NEW.application_origin='EXTERNAL_PROVIDER'
        AND a.status IN ('OBSERVED_SUCCESS','COMPLETED','RECONCILED')
        AND EXISTS (SELECT 1 FROM execution_observations o
          WHERE o.workspace_id=a.workspace_id AND o.id=NEW.source_observation_id
            AND o.attempt_id=a.id AND o.action_intent_id=i.id AND o.origin='EXTERNAL_PROVIDER'))
       OR (i.capability_ref LIKE 'internal:%' AND NEW.application_origin='INTERNAL_COMMAND'))
  ) THEN RAISE EXCEPTION 'selected-plan canonical receipt ownership mismatch'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER selected_plan_application_owner AFTER INSERT
  ON selected_plan_canonical_applications DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_selected_plan_application_owner();

CREATE TABLE selected_plan_continuation_checkpoints (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  id uuid NOT NULL,
  action_plan_id uuid NOT NULL,
  source_strategy_id uuid NOT NULL,
  next_action_intent_id uuid NOT NULL,
  next_request_fingerprint text NOT NULL,
  authority_decision_id uuid NOT NULL,
  source_fingerprint text NOT NULL,
  materialization_fingerprint text NOT NULL,
  residual_effect_fingerprints jsonb NOT NULL CHECK (jsonb_typeof(residual_effect_fingerprints)='array'),
  prerequisite_receipts jsonb NOT NULL CHECK (jsonb_typeof(prerequisite_receipts)='array'),
  accounted_changes jsonb NOT NULL CHECK (jsonb_typeof(accounted_changes)='object'),
  fresh_manifest jsonb NOT NULL CHECK (jsonb_typeof(fresh_manifest)='object'),
  evaluation_evidence jsonb NOT NULL CHECK
    (jsonb_typeof(evaluation_evidence)='object' AND pg_column_size(evaluation_evidence) <= 1048576),
  evaluated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > evaluated_at),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY(workspace_id,id),
  FOREIGN KEY(workspace_id,action_plan_id) REFERENCES action_plans(workspace_id,id),
  FOREIGN KEY(workspace_id,source_strategy_id) REFERENCES recovery_strategies(workspace_id,id),
  FOREIGN KEY(workspace_id,next_action_intent_id) REFERENCES action_intents(workspace_id,id),
  FOREIGN KEY(workspace_id,authority_decision_id) REFERENCES authority_decisions(workspace_id,id)
);
CREATE TRIGGER selected_plan_continuation_checkpoints_immutable BEFORE UPDATE OR DELETE
  ON selected_plan_continuation_checkpoints FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE INDEX selected_plan_continuation_next ON selected_plan_continuation_checkpoints
  (workspace_id,action_plan_id,next_action_intent_id,expires_at DESC);
