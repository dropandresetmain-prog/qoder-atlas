-- M9 (0120): re-plan identity (IN-1).
--
-- Effect-scoped logicalOperationKey remains the irreversible-operation identity
-- (same offer / programme change cannot double-dispatch after known success).
-- Intent-row uniqueness was incorrectly workspace-global, so a legitimate new
-- ActionPlan after confirmed failure or a new strategy version could not persist.
-- Scope uniqueness to (plan, namespace, logical key) so re-plans may exist while
-- execution_attempts_one_live_logical_op_uidx + prepare gate still prevent
-- duplicate irreversible dispatch.

DROP INDEX IF EXISTS action_intents_logical_op_uidx;

CREATE UNIQUE INDEX action_intents_plan_logical_op_uidx
  ON action_intents (workspace_id, action_plan_id, operation_namespace, logical_operation_key)
  WHERE logical_operation_key IS NOT NULL;
