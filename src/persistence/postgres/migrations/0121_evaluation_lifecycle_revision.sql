-- FIG-3 prerequisite (0121): a durable monotonic counter for "this subject's
-- assessment/evaluation lifecycle changed", for read-model `projectionRevision`.
--
-- Neither `assessments` nor `scheduled_reassessments` (0091) carries a serial/
-- sequence column, and a subject's CURRENT-assessment verdict changing, or its
-- AssessmentViewStatus transitioning (CURRENT -> PENDING_REASSESSMENT ->
-- CURRENT), advances no existing `aggregate_heads`/`scope_generations` counter:
-- ACTION_INTENT execution/observation writes don't call advanceHead on their
-- ACTION_PLAN root, and assessment/reassessment lifecycle events aren't scoped
-- to any existing scope_kind. This reuses the existing scope_generations
-- machinery (0006/0090) — a new scope_id family per subject+assessment kind —
-- rather than a new table.
--
-- 'EVALUATION_LIFECYCLE' is deliberately never read by `assessment_inputs`, so
-- it cannot feed `m6_enqueue_reassessment_for_input` (0091) and cause an
-- invalidation loop: bumping it enqueues no reassessment work, it is purely an
-- observable revision counter for read models.

INSERT INTO scope_kinds (kind) VALUES ('EVALUATION_LIFECYCLE');

CREATE FUNCTION fig3_bump_evaluation_lifecycle() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'assessments' THEN
    PERFORM m6_bump_scope(NEW.workspace_id, 'EVALUATION_LIFECYCLE',
      NEW.subject_kind || ':' || NEW.subject_id::text || ':' || NEW.kind);
  ELSIF TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM NEW.state THEN
    PERFORM m6_bump_scope(NEW.workspace_id, 'EVALUATION_LIFECYCLE',
      NEW.subject_kind || ':' || NEW.subject_id::text || ':' || NEW.assessment_kind);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fig3_bump_on_assessment
  AFTER INSERT ON assessments
  FOR EACH ROW EXECUTE FUNCTION fig3_bump_evaluation_lifecycle();

CREATE TRIGGER fig3_bump_on_reassessment
  AFTER INSERT OR UPDATE OF state ON scheduled_reassessments
  FOR EACH ROW EXECUTE FUNCTION fig3_bump_evaluation_lifecycle();
