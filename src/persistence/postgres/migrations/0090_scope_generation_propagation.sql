-- M6 (0090): scope-generation propagation — phantom and insertion invalidation.
--
-- DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §6: "Checking read objects alone misses
-- inserted rules, new group members and newly published hazards. Commands
-- therefore increment affected scope generations in the same transaction."
-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §11.2: "Insertion of an applicable rule, group
-- member, publication or ownership change invalidates the relevant scope even
-- when none of the old read rows changed."
--
-- At integration only M2's createJourney/Journey lifecycle advanced any scope
-- (TRIP). M3/M4/M5 commands advanced none. Rather than retrofit ~90 command
-- handlers (and trust each future one to remember), the increment is enforced
-- by row triggers on the owning tables: they run inside the writing
-- transaction (so the increment commits or rolls back with the change), cannot
-- be skipped by a handler, seed or migration import, and are additive. The
-- UnitOfWork contract is unchanged; `ScopeGenerationLedger.advance` remains the
-- explicit command-side API and composes with these triggers.
--
-- Conservative by design (closure §6 "Initially use conservative
-- Workspace/topic generations where a narrower scope cannot be proven
-- complete"): where a precise scope is not derivable the WORKSPACE-wide
-- sentinel of that family is advanced instead.

-- New scope kinds (additive to 0006 / identity.ts ScopeKindSchema).
INSERT INTO scope_kinds (kind) VALUES
  ('TRAVELLER'),       -- person-scoped facts: credentials, assertions, history, allocations, participations, support
  ('RESOURCE'),        -- capacity/assignment scope of one Resource
  ('RULE_SET'),        -- editions/publication state of one RuleSet
  ('SUBJECT_DEPENDENCIES'); -- explicit `dependencies` rows touching one subject

-- Information topics M6 evaluators understand. A publication on a topic NOT
-- listed also advances INFORMATION_TOPIC:'*unregistered*', which every
-- snapshot reads, so unclassified information cannot evade invalidation.
CREATE TABLE registered_information_topics (
  topic text PRIMARY KEY CHECK (length(btrim(topic)) > 0),
  installed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A scope advances at most once per transaction, however many rows (or an
-- explicit ScopeGenerationLedger.advance plus these triggers) touch it — the
-- scope analogue of "advance every changed root exactly once" (§11.1). A
-- serializable retry is a new transaction, so it advances again correctly.
ALTER TABLE scope_generations ADD COLUMN last_advanced_xact xid8;

CREATE FUNCTION m6_bump_scope(p_workspace uuid, p_kind text, p_id text) RETURNS void AS $$
BEGIN
  IF p_workspace IS NULL OR p_id IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO scope_generations (workspace_id, scope_kind, scope_id, generation, updated_at, last_advanced_xact)
  VALUES (p_workspace, p_kind, p_id, 1, now(), pg_current_xact_id())
  ON CONFLICT (workspace_id, scope_kind, scope_id)
  DO UPDATE SET generation = scope_generations.generation + 1, updated_at = now(), last_advanced_xact = pg_current_xact_id()
   WHERE scope_generations.last_advanced_xact IS DISTINCT FROM pg_current_xact_id();
END;
$$ LANGUAGE plpgsql;

-- Map an owner (kind, id) to its scope. Unknown owner kinds fall back to the
-- workspace sentinel so nothing is silently unscoped.
CREATE FUNCTION m6_bump_owner_scope(p_workspace uuid, p_owner_kind text, p_owner_id uuid) RETURNS void AS $$
BEGIN
  IF p_owner_kind IN ('TRIP', 'JOURNEY', 'COORDINATION_GROUP', 'PROGRAMME', 'TRAVELLER', 'RESOURCE') THEN
    PERFORM m6_bump_scope(p_workspace, p_owner_kind, p_owner_id::text);
  ELSIF p_owner_kind = 'ORGANISATION' THEN
    PERFORM m6_bump_scope(p_workspace, 'ORGANISATION_RULES', p_owner_id::text);
  ELSIF p_owner_kind = 'JOURNEY_ITEM' THEN
    PERFORM m6_bump_scope(p_workspace, 'JOURNEY',
      (SELECT journey_id::text FROM journey_items WHERE workspace_id = p_workspace AND id = p_owner_id));
  ELSIF p_owner_kind IN ('PROGRAMME_ITEM', 'PARTICIPATION') THEN
    PERFORM m6_bump_scope(p_workspace, 'PROGRAMME',
      (SELECT aggregate_id::text FROM domain_subjects WHERE workspace_id = p_workspace AND id = p_owner_id));
  ELSE
    PERFORM m6_bump_scope(p_workspace, 'WORKSPACE', p_workspace::text);
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION m6_bump_information_topic(p_workspace uuid, p_topic text) RETURNS void AS $$
BEGIN
  PERFORM m6_bump_scope(p_workspace, 'INFORMATION_TOPIC', p_topic);
  IF NOT EXISTS (SELECT 1 FROM registered_information_topics WHERE topic = p_topic) THEN
    PERFORM m6_bump_scope(p_workspace, 'INFORMATION_TOPIC', '*unregistered*');
  END IF;
END;
$$ LANGUAGE plpgsql;

-- One trigger function per owning table family. `r` is NEW on INSERT/UPDATE
-- and OLD on DELETE; UPDATE also advances the OLD row's scopes when a scope key
-- moved (e.g. a membership moved between groups).
CREATE FUNCTION m6_scope_trigger() RETURNS trigger AS $$
DECLARE
  r record;
  i int;
BEGIN
  FOR i IN 1..2 LOOP
    IF i = 1 THEN
      IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
    ELSE
      IF TG_OP <> 'UPDATE' THEN EXIT; END IF;
      r := OLD;
    END IF;

    CASE TG_TABLE_NAME
      -- ---- M2 travel -------------------------------------------------------
      WHEN 'journeys' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'JOURNEY', r.id::text);
        PERFORM m6_bump_scope(r.workspace_id, 'TRAVELLER', r.traveller_id::text);
        -- Trip scope = membership: a Journey joining/leaving (insert, delete,
        -- moved Trip, lifecycle change). Detail edits are read via the Journey head.
        IF TG_OP <> 'UPDATE' OR OLD.trip_id IS DISTINCT FROM NEW.trip_id OR OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status THEN
          PERFORM m6_bump_scope(r.workspace_id, 'TRIP', r.trip_id::text);
        END IF;
      WHEN 'journey_items', 'intended_visits', 'credential_selections' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'JOURNEY', r.journey_id::text);
      WHEN 'transport_item_details', 'stay_item_details', 'engagement_item_details', 'resource_use_item_details' THEN
        PERFORM m6_bump_owner_scope(r.workspace_id, 'JOURNEY_ITEM', r.journey_item_id);
      WHEN 'credential_selection_visits' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'JOURNEY',
          (SELECT journey_id::text FROM credential_selections WHERE workspace_id = r.workspace_id AND id = r.selection_id));
      WHEN 'coordination_groups' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'COORDINATION_GROUP', r.id::text);
      WHEN 'group_memberships' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'COORDINATION_GROUP', r.coordination_group_id::text);
        PERFORM m6_bump_scope(r.workspace_id, 'JOURNEY', r.journey_id::text);
      WHEN 'group_membership_items' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'COORDINATION_GROUP',
          (SELECT coordination_group_id::text FROM group_memberships WHERE workspace_id = r.workspace_id AND id = r.membership_id));
      -- ---- M2 people / support ---------------------------------------------
      WHEN 'profile_assertions', 'travel_credentials', 'travel_history', 'credential_links' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'TRAVELLER', r.traveller_id::text);
      WHEN 'credential_versions' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'TRAVELLER',
          (SELECT traveller_id::text FROM travel_credentials WHERE workspace_id = r.workspace_id AND id = r.credential_id));
      WHEN 'accompaniment_requirements' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'TRAVELLER', r.supported_traveller_id::text);
      WHEN 'accompaniment_eligible_supporters' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'TRAVELLER', r.supporter_traveller_id::text);
        PERFORM m6_bump_scope(r.workspace_id, 'TRAVELLER',
          (SELECT supported_traveller_id::text FROM accompaniment_requirements
            WHERE workspace_id = r.workspace_id AND id = r.requirement_id AND version = r.requirement_version));
      WHEN 'support_assignments' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'TRAVELLER',
          (SELECT supported_traveller_id::text FROM accompaniment_requirements
            WHERE workspace_id = r.workspace_id AND id = r.constraint_definition_id AND version = r.constraint_definition_version));
      WHEN 'support_assignment_assignees', 'support_assignment_scopes' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'TRAVELLER', r.supporter_traveller_id::text);
        PERFORM m6_bump_scope(r.workspace_id, 'TRAVELLER',
          (SELECT q.supported_traveller_id::text FROM support_assignments a
             JOIN accompaniment_requirements q ON q.workspace_id = a.workspace_id AND q.id = a.constraint_definition_id AND q.version = a.constraint_definition_version
            WHERE a.workspace_id = r.workspace_id AND a.id = r.assignment_id));
      WHEN 'support_assignment_handoffs' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'TRAVELLER', r.from_supporter_traveller_id::text);
        PERFORM m6_bump_scope(r.workspace_id, 'TRAVELLER', r.to_supporter_traveller_id::text);
      -- ---- M3 arrangements --------------------------------------------------
      WHEN 'reservation_allocations' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'TRAVELLER', r.traveller_id::text);
        IF r.journey_item_id IS NOT NULL THEN
          PERFORM m6_bump_owner_scope(r.workspace_id, 'JOURNEY_ITEM', r.journey_item_id);
        END IF;
      WHEN 'entitlement_person_links' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'TRAVELLER', r.traveller_id::text);
      -- ---- M4 programmes / geography ----------------------------------------
      WHEN 'programme_items' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'PROGRAMME', r.programme_id::text);
      WHEN 'participations' THEN
        PERFORM m6_bump_owner_scope(r.workspace_id, 'PROGRAMME_ITEM', r.programme_item_id);
        PERFORM m6_bump_scope(r.workspace_id, 'TRAVELLER', r.traveller_id::text);
      WHEN 'participation_roles' THEN
        PERFORM m6_bump_owner_scope(r.workspace_id, 'PARTICIPATION', r.participation_id);
      WHEN 'resource_assignments' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'RESOURCE', r.resource_id::text);
        PERFORM m6_bump_owner_scope(r.workspace_id, r.activity_kind, r.activity_id);
      WHEN 'places', 'area_versions', 'area_memberships', 'jurisdiction_areas', 'jurisdictions', 'geographic_areas' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'GEOGRAPHY', 'catalog');
      -- ---- M5 knowledge -----------------------------------------------------
      WHEN 'objectives', 'constraint_definitions' THEN
        PERFORM m6_bump_owner_scope(r.workspace_id, r.owner_kind, r.owner_id);
      WHEN 'objective_targets', 'objective_dispositions' THEN
        PERFORM m6_bump_owner_scope(r.workspace_id,
          (SELECT owner_kind FROM objectives WHERE workspace_id = r.workspace_id AND id = r.objective_id),
          (SELECT owner_id FROM objectives WHERE workspace_id = r.workspace_id AND id = r.objective_id));
      WHEN 'constraint_operands' THEN
        PERFORM m6_bump_owner_scope(r.workspace_id,
          (SELECT owner_kind FROM constraint_definitions WHERE workspace_id = r.workspace_id AND id = r.constraint_definition_id),
          (SELECT owner_id FROM constraint_definitions WHERE workspace_id = r.workspace_id AND id = r.constraint_definition_id));
      WHEN 'dependencies' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'SUBJECT_DEPENDENCIES', r.from_subject_id::text);
        PERFORM m6_bump_scope(r.workspace_id, 'SUBJECT_DEPENDENCIES', r.to_subject_id::text);
      WHEN 'rule_sets' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'RULE_SET', r.id::text);
      WHEN 'rule_set_versions' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'RULE_SET', r.rule_set_id::text);
      WHEN 'rules' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'RULE_SET',
          (SELECT rule_set_id::text FROM rule_set_versions WHERE workspace_id = r.workspace_id AND id = r.rule_set_version_id));
      WHEN 'rule_assignments' THEN
        PERFORM m6_bump_scope(r.workspace_id, 'RULE_SET', r.rule_set_id::text);
        IF r.organisation_id IS NOT NULL THEN
          PERFORM m6_bump_scope(r.workspace_id, 'ORGANISATION_RULES', r.organisation_id::text);
        END IF;
        IF r.subject_id IS NOT NULL THEN
          PERFORM m6_bump_owner_scope(r.workspace_id, r.subject_kind, r.subject_id);
        END IF;
        IF r.jurisdiction_id IS NOT NULL THEN
          PERFORM m6_bump_scope(r.workspace_id, 'GEOGRAPHY', 'jurisdiction:' || r.jurisdiction_id::text);
        END IF;
        IF r.population_predicate_id IS NOT NULL THEN
          -- A population predicate cannot be matched to a precise scope at write time.
          PERFORM m6_bump_scope(r.workspace_id, 'ORGANISATION_RULES', '*population*');
        END IF;
      WHEN 'information_records' THEN
        PERFORM m6_bump_information_topic(r.workspace_id, r.topic);
      -- PL/pgSQL resolves every record field an expression names, so the version
      -- row (field `id`) and its detail rows (field `information_version_id`)
      -- need separate branches.
      WHEN 'information_versions' THEN
        PERFORM m6_bump_information_topic(r.workspace_id,
          (SELECT topic FROM information_records WHERE workspace_id = r.workspace_id AND id = r.information_record_id));
      WHEN 'advisory_details', 'condition_details' THEN
        PERFORM m6_bump_information_topic(r.workspace_id,
          (SELECT ir.topic FROM information_records ir
             JOIN information_versions iv ON iv.workspace_id = ir.workspace_id AND iv.information_record_id = ir.id
            WHERE iv.workspace_id = r.workspace_id AND iv.id = r.information_version_id));
      WHEN 'regulatory_publications' THEN
        PERFORM m6_bump_information_topic(r.workspace_id,
          (SELECT ir.topic FROM information_records ir
             JOIN information_versions iv ON iv.workspace_id = ir.workspace_id AND iv.information_record_id = ir.id
            WHERE iv.workspace_id = r.workspace_id AND iv.id = r.information_version_id));
        PERFORM m6_bump_scope(r.workspace_id, 'RULE_SET', r.rule_set_id::text);
        IF r.jurisdiction_id IS NOT NULL THEN
          PERFORM m6_bump_scope(r.workspace_id, 'GEOGRAPHY', 'jurisdiction:' || r.jurisdiction_id::text);
        END IF;
      WHEN 'information_scopes' THEN
        PERFORM m6_bump_information_topic(r.workspace_id,
          (SELECT ir.topic FROM information_records ir
             JOIN information_versions iv ON iv.workspace_id = ir.workspace_id AND iv.information_record_id = ir.id
            WHERE iv.workspace_id = r.workspace_id AND iv.id = r.information_version_id));
        IF r.jurisdiction_id IS NOT NULL THEN
          PERFORM m6_bump_scope(r.workspace_id, 'GEOGRAPHY', 'jurisdiction:' || r.jurisdiction_id::text);
        END IF;
        IF r.area_version_id IS NOT NULL THEN
          PERFORM m6_bump_scope(r.workspace_id, 'GEOGRAPHY', 'catalog');
        END IF;
        IF r.subject_id IS NOT NULL THEN
          PERFORM m6_bump_owner_scope(r.workspace_id, r.subject_kind, r.subject_id);
        END IF;
      WHEN 'knowledge_coverage' THEN
        PERFORM m6_bump_information_topic(r.workspace_id, r.topic);
      ELSE
        RAISE EXCEPTION 'm6_scope_trigger attached to unmapped table %', TG_TABLE_NAME;
    END CASE;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Attach to every owning table the function maps. Adding a table here without
-- a CASE branch fails loudly at the first write (the ELSE raises), so the two
-- lists cannot drift silently.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'journeys', 'journey_items', 'intended_visits', 'credential_selections',
    'transport_item_details', 'stay_item_details', 'engagement_item_details', 'resource_use_item_details',
    'credential_selection_visits', 'coordination_groups', 'group_memberships', 'group_membership_items',
    'profile_assertions', 'travel_credentials', 'travel_history', 'credential_links', 'credential_versions',
    'accompaniment_requirements', 'accompaniment_eligible_supporters', 'support_assignments',
    'support_assignment_assignees', 'support_assignment_scopes', 'support_assignment_handoffs',
    'reservation_allocations', 'entitlement_person_links',
    'programme_items', 'participations', 'participation_roles', 'resource_assignments',
    'places', 'area_versions', 'area_memberships', 'jurisdiction_areas', 'jurisdictions', 'geographic_areas',
    'objectives', 'constraint_definitions', 'objective_targets', 'objective_dispositions', 'constraint_operands',
    'dependencies', 'rule_sets', 'rule_set_versions', 'rules', 'rule_assignments',
    'information_records', 'information_versions', 'advisory_details', 'condition_details',
    'regulatory_publications', 'information_scopes', 'knowledge_coverage'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION m6_scope_trigger()',
      'm6_scope_' || t, t);
  END LOOP;
END;
$$;

-- Topics the M6 evaluator registry reads (src/resolution/evaluation/registry.ts).
-- An additive category (AT21) registers its topic in its own migration.
INSERT INTO registered_information_topics (topic, installed_by) VALUES
  ('ADVISORY', 'M6'),
  ('CONDITION', 'M6'),
  ('ENTRY_REQUIREMENT', 'M6'),
  ('TRANSIT_REQUIREMENT', 'M6');
