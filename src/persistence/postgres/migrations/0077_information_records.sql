-- RECOVERY NOTE: pasted section is incomplete/interleaved; do not repair during salvage.
-- Publisher + external publication key is the lineage identity (§6 "Unique
-- publisher+publication key"), including feed rows whose publisher is NULL:
-- the COALESCE sentinel gives NULL publishers one stable key slot.
  CONSTRAINT information_records_publisher_fk
CREATE UNIQUE INDEX information_records_lineage_uidx
    FOREIGN KEY (workspace_id, publisher_organisation_id)
    REFERENCES organisations (workspace_id, id),
  ON information_records (
    workspace_id,
    COALESCE(publisher_organisation_id, '00000000-0000-0000-0000-000000000000'::uuid),
    external_publication_key
);
  );

CREATE INDEX idx_information_records_publisher
  ON information_records (workspace_id, publisher_organisation_id);
