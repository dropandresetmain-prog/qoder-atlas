-- M5 reverse-lookup index set (0029's precedent): the tables are M5's, but the
-- operations that decide these access paths belong to M6 (applicability /
-- invalidation / reverse matching) and M9. Each entry names the question it
-- exists to answer. Everything already served by a primary key or a table's
-- local index stays where it was created (0070-0084).

-- §N "which InformationVersions apply to this jurisdiction/area/population?" is
-- answered by 0082's scope indexes; this index answers the publisher/topic
-- variant: every edition of one lineage, newest first.
CREATE INDEX idx_information_records_lineage_topic
  ON information_records (workspace_id, publisher_organisation_id, topic)
  WHERE publisher_organisation_id IS NOT NULL;

-- §N "which rules assign to this Organisation/Traveller/Trip/Journey?" — the
-- assignment side is 0075's partial indexes; this one serves "which editions
-- does an organisation's current assignment surface", i.e. every published
-- edition of the sets an assignment may select.
CREATE INDEX idx_rule_set_versions_set_status
  ON rule_set_versions (workspace_id, rule_set_id, status, effective_from);

-- §N "what assessments become stale when a new edition arrives?" — a new
-- edition invalidates every scope row of its record's earlier editions; M6
-- walks scopes by record. Also serves "which scopes depend on this source/
-- version?" at lineage (not just edition) granularity.
CREATE INDEX idx_information_versions_record_received
  ON information_versions (workspace_id, information_record_id, received_at DESC);

-- §N "what changes when coverage becomes incomplete?" — a coverage record is
-- cited by the sync state that last accepted it; walk one coverage claim's
-- dependents without a seq scan.
CREATE INDEX idx_source_sync_state_coverage
  ON source_sync_state (workspace_id, last_accepted_coverage_id)
  WHERE last_accepted_coverage_id IS NOT NULL;

-- §N "which objectives/constraints govern this subject?" — objectives by owner
-- are 0072's idx_objectives_owner; this covers constraint definitions by
-- owner in the same shape so one read-port implementation answers both.
CREATE INDEX idx_objectives_owner_priority
  ON objectives (workspace_id, owner_kind, owner_id, priority DESC);

-- Preferences explicit-vs-inferred read path: precedence is computed at read
-- time (0076), so the query needs source in the access path.
CREATE INDEX idx_preferences_owner_source
  ON preferences (workspace_id, owner_kind, owner_id, source, preference_kind, effective_from);

-- Quarantine reconciliation queue: unresolved conflicts by lineage, oldest
-- first, for the reviewer who must decide them.
CREATE INDEX idx_information_quarantine_pending
  ON information_quarantine (workspace_id, rejection_reason, created_at)
  WHERE rejection_reason IN ('DUPLICATE_SEQUENCE_HASH_MISMATCH', 'OUT_OF_ORDER', 'NORMALIZATION_INVALID');
