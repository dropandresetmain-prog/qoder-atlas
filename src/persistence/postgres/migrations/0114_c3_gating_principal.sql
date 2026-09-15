-- C3 round 2 (AN-7): store the principal that passed the prepare gate.
-- Dispatch must re-check against this principal, not an arbitrary caller value.

ALTER TABLE execution_attempts
  ADD COLUMN gating_principal_id uuid,
  ADD CONSTRAINT execution_attempts_gating_principal_fk
    FOREIGN KEY (workspace_id, gating_principal_id)
    REFERENCES principals (workspace_id, id);
