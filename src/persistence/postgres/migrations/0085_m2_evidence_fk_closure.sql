-- M2 deferred foreign-key closure: `docs/refactor/evidence/M2.md` §7A reserved
-- every `evidence_records` reference below for M5, with the exact ALTER to run
-- once this table existed. 0085 runs those ALTERs verbatim (table/column names
-- as M2 published them) and adds the reverse-lookup indexes the ledger named.
--
-- Not closed here (still owned elsewhere):
--   - M4: travel_history / intended_visits / *_item_details place & jurisdiction
--     columns, engagement_item_details.participation_id (M4's 0050-0069 range);
--   - M3: transport_item_details.selected_service_id, resource_use_item_details.
--     resource_id (M3's 0030-0049 range).
--
-- All DEFERRABLE INITIALLY DEFERRED, matching M2's convention for provenance
-- citations written in the same transaction as the row that cites them.

ALTER TABLE organisation_memberships
  ADD CONSTRAINT organisation_memberships_evidence_fk
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE traveller_names
  ADD CONSTRAINT traveller_names_evidence_fk
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE traveller_contacts
  ADD CONSTRAINT traveller_contacts_evidence_fk
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE profile_assertions
  ADD CONSTRAINT profile_assertions_evidence_fk
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE credential_versions
  ADD CONSTRAINT credential_versions_evidence_fk
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE credential_links
  ADD CONSTRAINT credential_links_evidence_fk
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE travel_history
  ADD CONSTRAINT travel_history_evidence_fk
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE traveller_relationships
  ADD CONSTRAINT traveller_relationships_evidence_fk
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE accompaniment_requirements
  ADD CONSTRAINT accompaniment_requirements_provenance_fk
  FOREIGN KEY (workspace_id, provenance_evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- Reverse indexes named by §7A ("plus CREATE INDEX <t>_evidence ... if M5's
-- coverage queries need the reverse direction"): which rows cite one evidence
-- record. Kept minimal — only the tables M5/M6 reverse walks actually need
-- beyond their existing PK/local paths.
CREATE INDEX idx_traveller_names_evidence ON traveller_names (workspace_id, evidence_id);
CREATE INDEX idx_traveller_contacts_evidence ON traveller_contacts (workspace_id, evidence_id);
CREATE INDEX idx_profile_assertions_evidence ON profile_assertions (workspace_id, evidence_id);
CREATE INDEX idx_credential_versions_evidence ON credential_versions (workspace_id, evidence_id);
CREATE INDEX idx_travel_history_evidence ON travel_history (workspace_id, evidence_id);
CREATE INDEX idx_accompaniment_requirements_evidence
  ON accompaniment_requirements (workspace_id, provenance_evidence_id)
  WHERE provenance_evidence_id IS NOT NULL;
