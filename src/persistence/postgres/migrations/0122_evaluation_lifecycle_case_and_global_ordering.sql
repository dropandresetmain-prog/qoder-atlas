-- FIG-3 follow-up (0122): a max across independent small per-scope counters
-- (0121's `generation`) can tie — if subject B's counter catches up to
-- (without exceeding) subject A's already-observed value, a real change to B
-- is invisible to a caller comparing against the remembered max. This does
-- not touch 0121's counters (still used for other purposes); it reads the
-- `scope_generations.last_advanced_xact` column already written by every
-- `m6_bump_scope` call (0090) instead: `pg_current_xact_id()` is a per-
-- database, globally unique, strictly increasing xid8 (never wraps, unlike
-- 32-bit xid), so two different real changes can never produce the same
-- stamp and a caller-supplied `sinceRevision` compares correctly against
-- every component on the same scale.
--
-- Also routes RECOVERY_CASE's own presented-content changes through the same
-- EVALUATION_LIFECYCLE scope family (scope_id `RECOVERY_CASE:<id>:CASE`) so
-- the case's own revision is comparable on that same global scale, instead
-- of the small per-aggregate `aggregate_heads.revision` counter.

CREATE FUNCTION fig3_bump_case_revision() RETURNS trigger AS $$
BEGIN
  PERFORM m6_bump_scope(NEW.workspace_id, 'EVALUATION_LIFECYCLE', 'RECOVERY_CASE:' || NEW.id::text || ':CASE');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fig3_bump_on_case_write
  AFTER INSERT OR UPDATE ON recovery_cases
  FOR EACH ROW EXECUTE FUNCTION fig3_bump_case_revision();
