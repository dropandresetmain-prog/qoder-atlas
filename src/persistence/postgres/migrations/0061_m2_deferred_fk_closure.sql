-- Closes the M4-owned rows of the M2 deferred-foreign-key ledger
-- (docs/refactor/evidence/M2.md §7A / docs/refactor/MIGRATION_MAPPING.md §7.2):
-- M2 stored these references as typed uuid columns with an index and
-- deliberately no FK, because places/jurisdictions/participations lived in
-- M4's reserved migration range and did not exist yet. M4 now owns those
-- tables (0050-0057), so this migration runs exactly the ALTER TABLE
-- statements the M2 ledger named — M2's own migrations (0016/0023/0024) are
-- never edited; this is a separate, additive M4 migration per the M4 brief's
-- "Never edit M2 migrations" instruction.
--
-- Every constraint is DEFERRABLE INITIALLY DEFERRED, matching every other
-- cross-table reference in this schema (e.g. 0019's
-- authority_grants_authorising_receipt_fk), so a single command transaction
-- may still insert the M2 row and its M4-owned referent in either order.
--
-- Two of the seven M2-ledger columns are **not** closed here because the M2
-- ledger assigns them to a different lane, not to M4:
--  - transport_item_details.selected_service_id -> M3 (transport_services)
--  - resource_use_item_details.resource_id -> M3 (resources)
-- Both remain open, exactly as M2 left them.

ALTER TABLE travel_history
  ADD CONSTRAINT travel_history_jurisdiction_fk
  FOREIGN KEY (workspace_id, jurisdiction_id) REFERENCES jurisdictions (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE intended_visits
  ADD CONSTRAINT intended_visits_jurisdiction_fk
  FOREIGN KEY (workspace_id, jurisdiction_id) REFERENCES jurisdictions (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE transport_item_details
  ADD CONSTRAINT transport_item_details_origin_place_fk
  FOREIGN KEY (workspace_id, desired_origin_place_id) REFERENCES places (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE transport_item_details
  ADD CONSTRAINT transport_item_details_destination_place_fk
  FOREIGN KEY (workspace_id, desired_destination_place_id) REFERENCES places (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE stay_item_details
  ADD CONSTRAINT stay_item_details_place_fk
  FOREIGN KEY (workspace_id, intended_place_id) REFERENCES places (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE resource_use_item_details
  ADD CONSTRAINT resource_use_item_details_place_fk
  FOREIGN KEY (workspace_id, intended_location_place_id) REFERENCES places (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE engagement_item_details
  ADD CONSTRAINT engagement_item_details_participation_fk
  FOREIGN KEY (workspace_id, participation_id) REFERENCES participations (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
