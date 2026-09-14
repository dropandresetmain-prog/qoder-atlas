-- M5: regulatory publication metadata. The executable obligations remain in
-- one exact immutable RuleSetVersion; this row never copies rule text.
-- jurisdiction_id is an M4-owned reference. It is typed and indexed here, and
-- its exact deferred FK is documented in M5 evidence for M4 to add.

CREATE TABLE regulatory_publications (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  information_version_id uuid NOT NULL,
  rule_set_version_id uuid NOT NULL,
  rule_set_id uuid NOT NULL,
  issuing_authority text NOT NULL CHECK (length(btrim(issuing_authority)) > 0),
  jurisdiction_id uuid,
  citation text CHECK (citation IS NULL OR length(citation) <= 2048),
  published_at timestamptz NOT NULL,
  published_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, information_version_id),
  CONSTRAINT regulatory_publications_version_fk
    FOREIGN KEY (workspace_id, information_version_id)
    REFERENCES information_versions (workspace_id, id),
  CONSTRAINT regulatory_publications_rule_edition_fk
    FOREIGN KEY (workspace_id, rule_set_version_id, rule_set_id, published_at, published_by_actor_id)
    REFERENCES rule_set_versions
      (workspace_id, id, rule_set_id, published_at, published_by_actor_id)
);

CREATE INDEX idx_regulatory_publications_rule_edition
  ON regulatory_publications (workspace_id, rule_set_version_id);
CREATE INDEX idx_regulatory_publications_jurisdiction
  ON regulatory_publications (workspace_id, jurisdiction_id)
  WHERE jurisdiction_id IS NOT NULL;
