-- so the exact composite FKs M2 proposed are added additively; no M2 migration
-- is modified and no M2 column changes.
--
-- Both statements below are byte-equivalent to the "ALTER to run" M2 recorded:
--   1. 0023 transport_item_details.selected_service_id (nullable, partial index
--      idx_transport_item_details_service) -> transport_services:
--      "which observed service fulfils this transport intent" — the link is
--      fulfilment context, never schedule ownership.
--   2. 0023 resource_use_item_details.resource_id (nullable, partial index
--      idx_resource_use_item_details_resource) -> resources: "which resource
--      this intended use names".
--
-- The remaining §7A rows are M4-owned (places, participations, jurisdictions)
-- and M5-owned (evidence_records) and are NOT closed here.

ALTER TABLE transport_item_details
  ADD CONSTRAINT transport_item_details_selected_service_fk
  FOREIGN KEY (workspace_id, selected_service_id)
  REFERENCES transport_services (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE resource_use_item_details
  ADD CONSTRAINT resource_use_item_details_resource_fk
  FOREIGN KEY (workspace_id, resource_id)
  REFERENCES resources (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;
