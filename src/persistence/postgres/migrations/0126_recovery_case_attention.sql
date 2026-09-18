-- R1 (0126): recovery_case_attention — durable, Case-owned human-attention
-- records for the C8 ESCALATE decision.
--
-- WHY (product truth): the RecoveryCase lifecycle (0100) has no "escalated"
-- phase and must not gain one — a case can truthfully remain PLANNING while a
-- person is also needed. Escalation is therefore ORTHOGONAL to lifecycle phase:
-- a small operational record bound to (case, basis assessment, reason). It is
-- not an approval, not a resolution, and never touches canonical trip state.
--
-- Idempotent by construction: one row per (case, basis, reason), so duplicate
-- progression wakes converge on the same record. The only permitted mutation is
-- OPEN -> RESOLVED (cleared by the case's owner when a newer basis supersedes it
-- or the case resolves); every other column is immutable and rows are never
-- deleted.

CREATE TABLE recovery_case_attention_reasons (reason text PRIMARY KEY);
INSERT INTO recovery_case_attention_reasons (reason) VALUES
  ('no_safe_recovery_remaining'),
  ('human_evidence_or_decision_required');

CREATE TABLE recovery_case_attention_resolutions (resolution text PRIMARY KEY);
INSERT INTO recovery_case_attention_resolutions (resolution) VALUES
  ('basis_superseded'),
  ('case_resolved');

CREATE TABLE recovery_case_attention (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  recovery_case_id uuid NOT NULL,
  basis_assessment_id uuid NOT NULL,
  reason_code text NOT NULL REFERENCES recovery_case_attention_reasons (reason),
  status text NOT NULL CHECK (status IN ('OPEN', 'RESOLVED')),
  opened_at timestamptz NOT NULL,
  opened_by_actor_id text NOT NULL CHECK (length(btrim(opened_by_actor_id)) > 0),
  resolved_at timestamptz,
  resolved_by_actor_id text,
  resolution_code text REFERENCES recovery_case_attention_resolutions (resolution),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT recovery_case_attention_case_fk
    FOREIGN KEY (workspace_id, recovery_case_id) REFERENCES recovery_cases (workspace_id, id),
  CONSTRAINT recovery_case_attention_basis_fk
    FOREIGN KEY (workspace_id, basis_assessment_id) REFERENCES assessments (workspace_id, id),
  CONSTRAINT recovery_case_attention_resolved_complete CHECK (
    (status = 'RESOLVED') = (resolved_at IS NOT NULL AND resolved_by_actor_id IS NOT NULL AND resolution_code IS NOT NULL)
  )
);

CREATE UNIQUE INDEX recovery_case_attention_case_basis_reason_uidx
  ON recovery_case_attention (workspace_id, recovery_case_id, basis_assessment_id, reason_code);

CREATE INDEX idx_recovery_case_attention_open
  ON recovery_case_attention (workspace_id, recovery_case_id) WHERE status = 'OPEN';

CREATE FUNCTION recovery_case_attention_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'recovery_case_attention is append-only; DELETE is not permitted';
  END IF;
  IF OLD.status <> 'OPEN' OR NEW.status <> 'RESOLVED' THEN
    RAISE EXCEPTION 'recovery_case_attention only permits OPEN -> RESOLVED';
  END IF;
  IF (NEW.workspace_id, NEW.id, NEW.recovery_case_id, NEW.basis_assessment_id, NEW.reason_code, NEW.opened_at, NEW.opened_by_actor_id)
     IS DISTINCT FROM
     (OLD.workspace_id, OLD.id, OLD.recovery_case_id, OLD.basis_assessment_id, OLD.reason_code, OLD.opened_at, OLD.opened_by_actor_id) THEN
    RAISE EXCEPTION 'recovery_case_attention identity columns are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recovery_case_attention_guard
  BEFORE UPDATE OR DELETE ON recovery_case_attention
  FOR EACH ROW EXECUTE FUNCTION recovery_case_attention_guard();

-- The case read model presents attention, so its own revision source must move
-- when attention opens/resolves (same EVALUATION_LIFECYCLE scope as 0122/0123;
-- never read by assessment_inputs, so it cannot feed reassessment).
CREATE TRIGGER fig3_bump_on_case_attention
  AFTER INSERT OR UPDATE OR DELETE ON recovery_case_attention
  FOR EACH ROW EXECUTE FUNCTION fig3_bump_case_from_direct_case_id();
