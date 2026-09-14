-- M6 C2 targeted fixes (0092): insertion/usage invalidation gaps.
--
-- Does NOT rewrite 0090. Additive triggers reuse m6_bump_scope and the
-- one-advance-per-scope-per-transaction semantics.
--
-- AN-1: RESOURCE scope when resource-consuming reservation usage changes
--   (resource_use_line_details, stay_line_details with a resource, allocation
--   changes on a resource-using line, reservation_line status that affects
--   whether the line counts toward capacity).
-- AN-2: ORGANISATION_RULES when a Budget candidate set for a payer changes
--   (budgets INSERT / relevant UPDATE / DELETE).
-- AN-3 needs no new trigger: rule_set_versions already advances RULE_SET;
--   the reader now records RULE_SET scope for referenced RuleSets without
--   a captured edition so that first publication can invalidate.

CREATE FUNCTION m6_resource_id_for_line(p_workspace uuid, p_line_id uuid) RETURNS uuid AS $$
  SELECT COALESCE(
    (SELECT resource_id FROM stay_line_details WHERE workspace_id = p_workspace AND line_id = p_line_id),
    (SELECT resource_id FROM resource_use_line_details WHERE workspace_id = p_workspace AND line_id = p_line_id)
  );
$$ LANGUAGE sql STABLE;

CREATE FUNCTION m6_c2_scope_trigger() RETURNS trigger AS $$
DECLARE
  r record;
  i int;
  resource_id uuid;
BEGIN
  FOR i IN 1..2 LOOP
    IF i = 1 THEN
      IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
    ELSE
      IF TG_OP <> 'UPDATE' THEN EXIT; END IF;
      r := OLD;
    END IF;

    CASE TG_TABLE_NAME
      WHEN 'resource_use_line_details' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'RESOURCE', r.resource_id::text);
      WHEN 'stay_line_details' THEN
        IF r.resource_id IS NOT NULL THEN
          PERFORM m6_bump_scope(r.workspace_id, 'RESOURCE', r.resource_id::text);
        END IF;
      WHEN 'reservation_allocations' THEN
        resource_id := m6_resource_id_for_line(r.workspace_id, r.line_id);
        IF resource_id IS NOT NULL THEN
          PERFORM m6_bump_scope(r.workspace_id, 'RESOURCE', resource_id::text);
        END IF;
      WHEN 'reservation_lines' THEN
        -- Status / presence changes whether the line counts in capacity
        -- (CANCELLED is excluded by the evaluator). Bump every Resource the
        -- line currently (or previously) consumed.
        resource_id := m6_resource_id_for_line(r.workspace_id, r.id);
        IF resource_id IS NOT NULL THEN
          PERFORM m6_bump_scope(r.workspace_id, 'RESOURCE', resource_id::text);
        END IF;
      WHEN 'budgets' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'ORGANISATION_RULES', r.organisation_id::text);
      ELSE
        RAISE EXCEPTION 'm6_c2_scope_trigger attached to unmapped table %', TG_TABLE_NAME;
    END CASE;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'resource_use_line_details',
    'stay_line_details',
    'reservation_allocations',
    'reservation_lines',
    'budgets'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION m6_c2_scope_trigger()',
      'm6_c2_scope_' || t, t);
  END LOOP;
END;
$$;
