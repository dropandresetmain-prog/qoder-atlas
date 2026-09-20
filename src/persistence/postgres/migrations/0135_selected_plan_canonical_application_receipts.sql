-- A4 CP4b: one selected ActionIntent/attempt may produce multiple exact
-- canonical command receipts (compound apply). Continuation must prove all of
-- them. Preserve existing single-receipt rows; allow additional receipts for
-- the same attempt.

ALTER TABLE selected_plan_canonical_applications
  DROP CONSTRAINT selected_plan_canonical_applications_pkey;

ALTER TABLE selected_plan_canonical_applications
  ADD CONSTRAINT selected_plan_canonical_applications_pkey
  PRIMARY KEY (workspace_id, attempt_id, command_namespace, idempotency_key);

CREATE INDEX selected_plan_canonical_applications_attempt_idx
  ON selected_plan_canonical_applications (workspace_id, attempt_id);
