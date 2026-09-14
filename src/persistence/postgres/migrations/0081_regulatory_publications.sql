-- RECOVERY NOTE: pasted section is incomplete/interleaved; do not repair during salvage.
-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §6: `regulatory_publications` —
-- InformationVersion subtype: "exact external rule_set_version_id. Publication
-- owns metadata/provenance, rule version owns executable obligations; no two
-- mutable rule copies."
--
-- Closure §8: "External regulatory InformationVersions reference exact
-- immutable RuleSetVersions." The publication row is the provenance side; the
-- executable obligations live in exactly one place — the cited RuleSetVersion
-- (0074). This table adds the LEGAL-APPLICABILITY metadata that belongs to a
-- publication rather than to a rule: issuing authority identity, the
-- jurisdiction whose law it is, and the citation.
--
-- jurisdiction_id: M4 owns `jurisdictions`; uuid + index + documented deferred
-- FK (docs/refactor/evidence/M5.md §"M4 deferrals"). M5 does not redefine
-- legal-area semantics.

CREATE TABLE regulatory_publications (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  information_version_id uuid NOT NULL,
  -- The exact immutable rule edition this publication makes legally effective.
  -- NOT NULL and NOT deferrable-by-omission: a REGULATORY edition without its
  -- rule edition is not representable (contract refine on InformationVersionSchema).
  rule_set_version_id uuid NOT NULL,
  rule_set_id uuid NOT NULL,
  -- Issuing legal authority as the PUBLISHER stated it (identity text), plus
  -- the M4 jurisdiction the publication targets.
  issuing_authority text NOT NULL CHECK (length(btrim(issuing_authority)) > 0),
  jurisdiction_id uuid,
  citation text,
  PRIMARY KEY (workspace_id, information_version_id),
  -- Publication must carry the citation facts of the edition it names, so the
  -- FK below (matching 0074's published-shape columns) can never reference a
  -- DRAFT edition: a draft has NULL published_at/published_by, and NULL parent
  -- values never satisfy an FK match. The 5-column FK also transitively
  -- enforces the (workspace_id, rule_set_version_id, rule_set_id) identity
  -- agreement, so no separate 3-column FK is needed (and none could exist —
  -- rule_set_versions deliberately has no UNIQUE index on that subset).
  published_at timestamptz NOT NULL,
  published_by_actor_id text NOT NULL,
  CONSTRAINT regulatory_publications_version_fk
    FOREIGN KEY (workspace_id, information_version_id) REFERENCES information_versions (workspace_id, id),
  -- Discriminating FK into 0074's edition identity, so only a real published
  -- Discriminating FK into 0074's published-edition identity, so only a real
  -- rule edition can be cited (and its (id, rule_set_id) pair must agree).
  -- published rule edition can be cited (and its (id, rule_set_id) pair must
  -- agree with the cited edition row).
  CONSTRAINT regulatory_publications_rule_edition_fk
  CONSTRAINT regulatory_publications_edition_published_fk
    FOREIGN KEY (workspace_id, rule_set_version_id, rule_set_id)
    FOREIGN KEY (workspace_id, rule_set_version_id, rule_set_id, published_at, published_by_actor_id)
    REFERENCES rule_set_versions (workspace_id, id, rule_set_id),
    REFERENCES rule_set_versions (workspace_id, id, rule_set_id, published_at, published_by_actor_id),
  CONSTRAINT regulatory_publications_citation_size CHECK (
    citation IS NULL OR length(citation) <= 2048
  )
);

CREATE INDEX idx_regulatory_publications_rule_edition
  ON regulatory_publications (workspace_id, rule_set_version_id);
-- M4 FK lands in M4's migration; the reverse lookup ("what does this
-- jurisdiction's law require") is served from here by M6.
CREATE INDEX idx_regulatory_publications_jurisdiction
  ON regulatory_publications (workspace_id, jurisdiction_id)
  WHERE jurisdiction_id IS NOT NULL;
