-- M8 (0111): bind budget_commitments.action_intent_id to action_intents and
-- add a concurrency helper view for remaining budget under SERIALIZABLE holds.

ALTER TABLE budget_commitments
  ADD CONSTRAINT budget_commitments_action_intent_fk
  FOREIGN KEY (workspace_id, action_intent_id)
  REFERENCES action_intents (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- Remaining capacity is computed in application code with exact money; this
-- index supports locking commitments for a budget during hold admission.
CREATE INDEX idx_budget_commitments_budget_active
  ON budget_commitments (workspace_id, budget_id, currency)
  WHERE status IN ('HELD', 'SETTLED');
