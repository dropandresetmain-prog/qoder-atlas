-- M2-M5 integration: cross-lane foreign-key closure.
--
-- Each domain lane was built in isolation. Where a lane had to reference a
-- table owned by a lane that did not exist on its branch, it stored a typed
-- uuid column (usually indexed) and deferred the FK to integration. The lane
-- closures already applied are 0049 (M3 -> M2), 0061 (M4 -> M2) and 0085
-- (M5 -> M2). This migration closes every remaining reference whose target
-- table exists only once M3, M4 and M5 are applied together. It is numbered
-- after 0086 because every M5 evidence target (0071) must exist first.
--
-- Ownership is not invented here: each target below is the table the source
-- column already names in its own lane's schema/evidence
-- (docs/refactor/evidence/M2_M5_INTEGRATION.md §4 lists every row with its
-- source ledger). Polymorphic `(subject_id, subject_kind)` references keep
-- their existing `domain_subjects` FKs and are not touched.
--
-- All DEFERRABLE INITIALLY DEFERRED, matching the lanes' convention for
-- provenance/reference rows written in the same transaction as their target.

-- ---------------------------------------------------------------------------
-- M3 -> M4: operational places named by supplier services and arrangements.
-- ---------------------------------------------------------------------------
ALTER TABLE transport_services
  ADD CONSTRAINT transport_services_origin_place_fk
  FOREIGN KEY (workspace_id, origin_place_id) REFERENCES places (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE transport_services
  ADD CONSTRAINT transport_services_destination_place_fk
  FOREIGN KEY (workspace_id, destination_place_id) REFERENCES places (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE resources
  ADD CONSTRAINT resources_location_place_fk
  FOREIGN KEY (workspace_id, location_place_id) REFERENCES places (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE stay_line_details
  ADD CONSTRAINT stay_line_details_place_fk
  FOREIGN KEY (workspace_id, place_id) REFERENCES places (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE resource_use_line_details
  ADD CONSTRAINT resource_use_line_details_place_fk
  FOREIGN KEY (workspace_id, place_id) REFERENCES places (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE offer_items
  ADD CONSTRAINT offer_items_place_fk
  FOREIGN KEY (workspace_id, place_id) REFERENCES places (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- M4 -> M3: a resource assignment names a real M3 Resource (M4.md §15).
-- ---------------------------------------------------------------------------
ALTER TABLE resource_assignments
  ADD CONSTRAINT resource_assignments_resource_fk
  FOREIGN KEY (workspace_id, resource_id) REFERENCES resources (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- M5 -> M3: feed progress may name the external connection it syncs.
-- ---------------------------------------------------------------------------
ALTER TABLE source_sync_state
  ADD CONSTRAINT source_sync_state_external_connection_fk
  FOREIGN KEY (workspace_id, external_connection_id) REFERENCES external_connections (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- M5 -> M4: knowledge applicability and objective targets name real geography.
-- ---------------------------------------------------------------------------
ALTER TABLE objective_targets
  ADD CONSTRAINT objective_targets_place_fk
  FOREIGN KEY (workspace_id, place_id) REFERENCES places (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE rule_assignments
  ADD CONSTRAINT rule_assignments_jurisdiction_fk
  FOREIGN KEY (workspace_id, jurisdiction_id) REFERENCES jurisdictions (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE regulatory_publications
  ADD CONSTRAINT regulatory_publications_jurisdiction_fk
  FOREIGN KEY (workspace_id, jurisdiction_id) REFERENCES jurisdictions (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE information_scopes
  ADD CONSTRAINT information_scopes_jurisdiction_fk
  FOREIGN KEY (workspace_id, jurisdiction_id) REFERENCES jurisdictions (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE information_scopes
  ADD CONSTRAINT information_scopes_area_version_fk
  FOREIGN KEY (workspace_id, area_version_id) REFERENCES area_versions (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- M2/M3/M4 -> M5: provenance citations resolve to real evidence records.
-- ---------------------------------------------------------------------------
-- M2 0019: absent from the M2 §7A ledger by omission; same semantics as the
-- other M2 evidence citations 0085 closed.
ALTER TABLE authority_grants
  ADD CONSTRAINT authority_grants_evidence_fk
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE transport_services
  ADD CONSTRAINT transport_services_published_evidence_fk
  FOREIGN KEY (workspace_id, published_evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE transport_services
  ADD CONSTRAINT transport_services_estimated_evidence_fk
  FOREIGN KEY (workspace_id, estimated_evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE transport_services
  ADD CONSTRAINT transport_services_actual_evidence_fk
  FOREIGN KEY (workspace_id, actual_evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE reservation_lines
  ADD CONSTRAINT reservation_lines_observation_evidence_fk
  FOREIGN KEY (workspace_id, observation_evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE service_entitlements
  ADD CONSTRAINT service_entitlements_observation_evidence_fk
  FOREIGN KEY (workspace_id, observation_evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE external_record_links
  ADD CONSTRAINT external_record_links_evidence_fk
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ownership_bindings
  ADD CONSTRAINT ownership_bindings_evidence_fk
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE provider_capabilities
  ADD CONSTRAINT provider_capabilities_observation_evidence_fk
  FOREIGN KEY (workspace_id, observation_evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE budget_entries
  ADD CONSTRAINT budget_entries_evidence_fk
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE area_versions
  ADD CONSTRAINT area_versions_evidence_fk
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE area_memberships
  ADD CONSTRAINT area_memberships_evidence_fk
  FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

-- Reverse lookups M6 uses to find what cites a given evidence record (an
-- evidence correction/retraction invalidates what it supported).
CREATE INDEX idx_external_record_links_evidence ON external_record_links (workspace_id, evidence_id);
CREATE INDEX idx_area_memberships_evidence ON area_memberships (workspace_id, evidence_id);
CREATE INDEX idx_reservation_lines_evidence ON reservation_lines (workspace_id, observation_evidence_id)
  WHERE observation_evidence_id IS NOT NULL;
CREATE INDEX idx_service_entitlements_evidence ON service_entitlements (workspace_id, observation_evidence_id)
  WHERE observation_evidence_id IS NOT NULL;
CREATE INDEX idx_objective_targets_place ON objective_targets (workspace_id, place_id) WHERE place_id IS NOT NULL;
CREATE INDEX idx_offer_items_place ON offer_items (workspace_id, place_id) WHERE place_id IS NOT NULL;
