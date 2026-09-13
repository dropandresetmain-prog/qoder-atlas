-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §11: "Indexes must follow actual operations
-- rather than indexing every field". M2 owns the tables, but the operations
-- that decide these access paths belong to M6 (applicability / reassessment
-- lookups) and M9 (authority / execution checks), both of which are required to
-- answer reverse questions in SQL rather than by parsing JSON. This file
-- collects the access paths that individual table migrations cannot justify on
-- their own; each entry names the lookup it exists for. Everything already
-- implied by a primary key or an owning table's local operation stays where it
-- was created.

-- §11 "Journeys by Traveller, Trip and active travel window": "who is travelling
-- where during W" is the candidate set every entry/advisory rule evaluation
-- starts from, and it is bounded by the window, not by the Journey's status.
CREATE INDEX idx_journeys_traveller_window
  ON journeys (workspace_id, traveller_id, intended_window_start, intended_window_end)
  WHERE intended_window_start IS NOT NULL;
CREATE INDEX idx_journeys_trip_window
  ON journeys (workspace_id, trip_id, intended_window_start, intended_window_end)
  WHERE intended_window_start IS NOT NULL;

-- §11 "Membership/support scopes by Journey/Traveller and interval": a group's
-- roster at a moment in time, and which groups are live at all.
CREATE INDEX idx_group_memberships_group_window
  ON group_memberships (workspace_id, coordination_group_id, effective_start, effective_end)
  WHERE effective_start IS NOT NULL;
CREATE INDEX idx_coordination_groups_effective
  ON coordination_groups (workspace_id, effective_start, effective_end)
  WHERE effective_start IS NOT NULL;

-- §11 "Credential selections and rule use reverse links for document/requirement
-- changes": an issuer status change or a new accepted edition has to find the
-- credentials and journeys that depend on the affected edition.
CREATE INDEX idx_travel_credentials_current_version
  ON travel_credentials (workspace_id, current_version_id);
CREATE INDEX idx_credential_versions_expiry
  ON credential_versions (workspace_id, expiry_date)
  WHERE expiry_date IS NOT NULL;

-- §11 "Grants by actor/scope/action/effective time": the authority gate is
-- "may this principal perform exactly this action over exactly this subject at
-- this instant", so an action must be reachable without scanning grants, and an
-- as-of evaluation needs issue order. An unregistered action never reaches this
-- lookup because grant_actions is foreign-keyed to a closed vocabulary.
CREATE INDEX idx_grant_actions_action
  ON grant_actions (workspace_id, action_kind, grant_id);
CREATE INDEX idx_authority_grants_principal_effective
  ON authority_grants (workspace_id, principal_id, issued_at DESC);

-- "Which travellers currently assert X" is the profile read every requirement
-- evaluator performs. Currentness is deliberately *not* a partial-index
-- predicate here: 0013 is append-only, so an edition becomes history only when a
-- later row points at it through supersedes_assertion_id, which makes the filter
-- an anti-join served by idx_profile_assertions_supersedes. A
-- `supersedes_assertion_id IS NULL` predicate would instead pin each chain's
-- first edition and report superseded facts as current. This entry covers the
-- type-driven scan itself.
CREATE INDEX idx_profile_assertions_by_type
  ON profile_assertions (workspace_id, assertion_type, traveller_id);

-- Protected contact values are only ever compared through their content hash
-- (the plaintext never lands in this database), so duplicate detection needs a
-- hash access path rather than a value one.
CREATE INDEX idx_traveller_contacts_value_hash
  ON traveller_contacts (workspace_id, value_content_hash);

-- Support assignments are read as "what covers this traveller requirement right
-- now": the requirement side is indexed in 0028, the assignee side above covers
-- the reverse question used by the shared-disruption case.
CREATE INDEX idx_accompaniment_eligible_supporters_requirement
  ON accompaniment_eligible_supporters (workspace_id, requirement_id, requirement_version);
