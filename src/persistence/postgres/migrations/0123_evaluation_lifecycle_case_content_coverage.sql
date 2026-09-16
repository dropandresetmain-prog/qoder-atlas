-- FIG-3 follow-up (0123): the case's own EVALUATION_LIFECYCLE revision
-- (0122's recovery_cases trigger) only advances on a `recovery_cases` row
-- write. The case view also presents action plans, action intents,
-- dependencies, execution attempts/observations, strategies and case
-- subjects — none of those writes bump the scope, so the case's revision can
-- stay frozen while its presented content actually changes.
--
-- Additive, same pattern as 0122: every trigger here calls the existing
-- `m6_bump_scope` (0090) against the SAME 'EVALUATION_LIFECYCLE' scope family
-- 0121/0122 already established, scope_id 'RECOVERY_CASE:<id>:CASE' — never a
-- new scope kind, never read by `assessment_inputs`, so none of this can feed
-- the M6 invalidation triggers or create a reassessment loop.
--
-- Three shapes, matched to how each table reaches its owning case:
--   1. Direct `recovery_case_id` column: action_plans, recovery_strategies,
--      case_subjects.
--   2. One join via `action_plan_id`: action_intents, action_dependencies
--      (action_dependencies carries its own action_plan_id column directly,
--      confirmed in migrations/0102_action_plans.sql — no need to go via
--      action_intents).
--   3. Two joins via `action_intent_id` -> action_plans: execution_attempts,
--      execution_observations (execution_observations carries its own
--      action_intent_id column directly, confirmed in
--      migrations/0110_execution_attempts_observations.sql — no need to go
--      via execution_attempts).
--
-- action_plans/action_intents/action_dependencies/recovery_strategies are
-- immutable (BEFORE UPDATE OR DELETE triggers forbid mutation, so only
-- INSERT ever reaches this AFTER trigger for them); execution_attempts,
-- execution_observations and case_subjects are not, so UPDATE/DELETE are
-- also covered here rather than assuming they never happen.

CREATE FUNCTION fig3_bump_case_from_direct_case_id() RETURNS trigger AS $$
DECLARE r RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  PERFORM m6_bump_scope(r.workspace_id, 'EVALUATION_LIFECYCLE', 'RECOVERY_CASE:' || r.recovery_case_id::text || ':CASE');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fig3_bump_on_action_plan
  AFTER INSERT OR UPDATE OR DELETE ON action_plans
  FOR EACH ROW EXECUTE FUNCTION fig3_bump_case_from_direct_case_id();

CREATE TRIGGER fig3_bump_on_recovery_strategy
  AFTER INSERT OR UPDATE OR DELETE ON recovery_strategies
  FOR EACH ROW EXECUTE FUNCTION fig3_bump_case_from_direct_case_id();

CREATE TRIGGER fig3_bump_on_case_subject
  AFTER INSERT OR UPDATE OR DELETE ON case_subjects
  FOR EACH ROW EXECUTE FUNCTION fig3_bump_case_from_direct_case_id();

CREATE FUNCTION fig3_bump_case_from_action_plan_id() RETURNS trigger AS $$
DECLARE
  r RECORD;
  v_case uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT recovery_case_id INTO v_case FROM action_plans WHERE workspace_id = r.workspace_id AND id = r.action_plan_id;
  IF v_case IS NOT NULL THEN
    PERFORM m6_bump_scope(r.workspace_id, 'EVALUATION_LIFECYCLE', 'RECOVERY_CASE:' || v_case::text || ':CASE');
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fig3_bump_on_action_intent
  AFTER INSERT OR UPDATE OR DELETE ON action_intents
  FOR EACH ROW EXECUTE FUNCTION fig3_bump_case_from_action_plan_id();

CREATE TRIGGER fig3_bump_on_action_dependency
  AFTER INSERT OR UPDATE OR DELETE ON action_dependencies
  FOR EACH ROW EXECUTE FUNCTION fig3_bump_case_from_action_plan_id();

CREATE FUNCTION fig3_bump_case_from_action_intent_id() RETURNS trigger AS $$
DECLARE
  r RECORD;
  v_case uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  SELECT ap.recovery_case_id INTO v_case
    FROM action_intents ai
    JOIN action_plans ap ON ap.workspace_id = ai.workspace_id AND ap.id = ai.action_plan_id
   WHERE ai.workspace_id = r.workspace_id AND ai.id = r.action_intent_id;
  IF v_case IS NOT NULL THEN
    PERFORM m6_bump_scope(r.workspace_id, 'EVALUATION_LIFECYCLE', 'RECOVERY_CASE:' || v_case::text || ':CASE');
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fig3_bump_on_execution_attempt
  AFTER INSERT OR UPDATE OR DELETE ON execution_attempts
  FOR EACH ROW EXECUTE FUNCTION fig3_bump_case_from_action_intent_id();

CREATE TRIGGER fig3_bump_on_execution_observation
  AFTER INSERT OR UPDATE OR DELETE ON execution_observations
  FOR EACH ROW EXECUTE FUNCTION fig3_bump_case_from_action_intent_id();
