-- A4 selected-plan continuation evidence. It proves a later dispatch is an
-- exact residual effect of one approved plan; it is not a second planner.

ALTER TABLE action_intents
  ADD COLUMN source_effect_index integer CHECK (source_effect_index IS NULL OR source_effect_index >= 0),
  ADD COLUMN source_effect_fingerprint text CHECK (source_effect_fingerprint IS NULL OR source_effect_fingerprint ~ '^[a-f0-9]{64}$');

CREATE TABLE selected_plan_continuation_checkpoints (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  action_plan_id uuid NOT NULL,
  next_action_intent_id uuid NOT NULL,
  source_strategy_id uuid NOT NULL,
  source_effect_manifest jsonb NOT NULL CHECK (jsonb_typeof(source_effect_manifest) = 'array' AND pg_column_size(source_effect_manifest) <= 65536),
  residual_effect_fingerprints jsonb NOT NULL CHECK (jsonb_typeof(residual_effect_fingerprints) = 'array' AND pg_column_size(residual_effect_fingerprints) <= 16384),
  prerequisite_receipts jsonb NOT NULL CHECK (jsonb_typeof(prerequisite_receipts) = 'array' AND pg_column_size(prerequisite_receipts) <= 65536),
  accounted_revisions jsonb NOT NULL CHECK (jsonb_typeof(accounted_revisions) = 'object' AND pg_column_size(accounted_revisions) <= 32768),
  fresh_manifest jsonb NOT NULL CHECK (jsonb_typeof(fresh_manifest) = 'object' AND pg_column_size(fresh_manifest) <= 262144),
  viability_evidence_refs jsonb NOT NULL CHECK (jsonb_typeof(viability_evidence_refs) = 'array' AND pg_column_size(viability_evidence_refs) <= 16384),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT selected_plan_continuation_plan_fk FOREIGN KEY (workspace_id, action_plan_id) REFERENCES action_plans (workspace_id, id),
  CONSTRAINT selected_plan_continuation_intent_fk FOREIGN KEY (workspace_id, next_action_intent_id) REFERENCES action_intents (workspace_id, id),
  CONSTRAINT selected_plan_continuation_strategy_fk FOREIGN KEY (workspace_id, source_strategy_id) REFERENCES recovery_strategies (workspace_id, id)
);

CREATE TRIGGER selected_plan_continuation_checkpoints_immutable
  BEFORE UPDATE OR DELETE ON selected_plan_continuation_checkpoints
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE INDEX selected_plan_continuation_next_intent_idx
  ON selected_plan_continuation_checkpoints (workspace_id, next_action_intent_id, expires_at DESC);

-- The provider observation and the canonical command are separate facts. This
-- immutable bridge is written by the canonical-application transaction so a
-- caller cannot pair an arbitrary command receipt with a successful attempt.
CREATE TABLE selected_plan_canonical_applications (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  attempt_id uuid NOT NULL,
  application_origin text NOT NULL CHECK (application_origin IN ('EXTERNAL_PROVIDER', 'INTERNAL_COMMAND')),
  source_observation_id uuid,
  command_namespace text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, attempt_id),
  CONSTRAINT selected_plan_canonical_application_attempt_fk
    FOREIGN KEY (workspace_id, attempt_id) REFERENCES execution_attempts (workspace_id, id),
  CONSTRAINT selected_plan_canonical_application_observation_fk
    FOREIGN KEY (workspace_id, source_observation_id) REFERENCES execution_observations (workspace_id, id),
  CONSTRAINT selected_plan_canonical_application_receipt_fk
    FOREIGN KEY (workspace_id, command_namespace, idempotency_key)
    REFERENCES command_receipts (workspace_id, command_namespace, idempotency_key)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT selected_plan_canonical_application_receipt_unique
    UNIQUE (workspace_id, command_namespace, idempotency_key),
  CONSTRAINT selected_plan_canonical_application_origin_shape CHECK (
    (application_origin = 'EXTERNAL_PROVIDER' AND source_observation_id IS NOT NULL)
    OR (application_origin = 'INTERNAL_COMMAND' AND source_observation_id IS NULL)
  )
);

CREATE TRIGGER selected_plan_canonical_applications_immutable
  BEFORE UPDATE OR DELETE ON selected_plan_canonical_applications
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
