-- C3 targeted remediation: execution gate invariants (AN-1, AN-3, AN-5).

-- Bind each prepared attempt to the authority decision that passed the gate.
ALTER TABLE execution_attempts
  ADD COLUMN authority_decision_id uuid,
  ADD CONSTRAINT execution_attempts_authority_decision_fk
    FOREIGN KEY (workspace_id, authority_decision_id)
    REFERENCES authority_decisions (workspace_id, id);

-- At most one non-retryable attempt per logical operation (success or in-flight).
-- OBSERVED_FAILURE / FAILED rows may coexist so a confirmed safe failure can retry.
CREATE UNIQUE INDEX execution_attempts_one_live_logical_op_uidx
  ON execution_attempts (workspace_id, logical_operation_key)
  WHERE status IN (
    'PREPARED', 'CLAIMED', 'DISPATCHING', 'DISPATCHED',
    'OUTCOME_UNKNOWN', 'RECONCILIATION_REQUIRED',
    'OBSERVED_SUCCESS', 'RECONCILED', 'COMPLETED'
  );

-- Dependency endpoints must belong to the same action plan (AN-5 DB guard).
CREATE OR REPLACE FUNCTION enforce_action_dependency_same_plan()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_from_plan uuid;
  v_to_plan uuid;
BEGIN
  SELECT action_plan_id INTO v_from_plan
    FROM action_intents WHERE workspace_id = NEW.workspace_id AND id = NEW.from_action_intent_id;
  SELECT action_plan_id INTO v_to_plan
    FROM action_intents WHERE workspace_id = NEW.workspace_id AND id = NEW.to_action_intent_id;
  IF v_from_plan IS NULL OR v_to_plan IS NULL THEN
    RAISE EXCEPTION 'action_dependencies intent missing for edge % -> %', NEW.from_action_intent_id, NEW.to_action_intent_id;
  END IF;
  IF v_from_plan <> NEW.action_plan_id OR v_to_plan <> NEW.action_plan_id THEN
    RAISE EXCEPTION 'action_dependencies edge must stay within plan % (from % to %)',
      NEW.action_plan_id, v_from_plan, v_to_plan;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER action_dependencies_same_plan
  BEFORE INSERT OR UPDATE ON action_dependencies
  FOR EACH ROW EXECUTE FUNCTION enforce_action_dependency_same_plan();
