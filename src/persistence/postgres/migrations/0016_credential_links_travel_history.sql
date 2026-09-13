-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §2: credential_links and travel_history.
-- Both are Traveller-owned, evidence-sourced and append-only: a link between a
-- visa and the passport it is stamped in, or an observed entry/exit, is a
-- recorded fact about the world, not a mutable Northstar intention.

CREATE TABLE credential_links (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  credential_id uuid NOT NULL,
  related_credential_id uuid NOT NULL,
  traveller_id uuid NOT NULL,
  link_type text NOT NULL CHECK (link_type IN ('VISA_TO_PASSPORT', 'PERMIT_TO_PASSPORT')),
  effective_from date NOT NULL,
  effective_to date,
  evidence_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  -- The frozen CredentialLinkSchema has no surrogate id: a link is identified
  -- by exactly these three semantic parts.
  PRIMARY KEY (workspace_id, credential_id, related_credential_id, link_type),
  CONSTRAINT credential_links_traveller_fk
    FOREIGN KEY (workspace_id, traveller_id) REFERENCES travellers (workspace_id, id),
  CONSTRAINT credential_links_credential_fk
    FOREIGN KEY (workspace_id, credential_id) REFERENCES travel_credentials (workspace_id, id),
  CONSTRAINT credential_links_related_credential_fk
    FOREIGN KEY (workspace_id, related_credential_id) REFERENCES travel_credentials (workspace_id, id),
  CONSTRAINT credential_links_not_self CHECK (credential_id <> related_credential_id),
  CONSTRAINT credential_links_effective_range CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX idx_credential_links_related ON credential_links (workspace_id, related_credential_id);
CREATE INDEX idx_credential_links_traveller ON credential_links (workspace_id, traveller_id);

CREATE TRIGGER credential_links_immutable
  BEFORE UPDATE OR DELETE ON credential_links
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- §2: "Both credentials must belong to the same Traveller where semantics
-- require". Ordinary FKs cannot express that cross-row rule.
CREATE FUNCTION assert_credential_links_same_traveller() RETURNS trigger AS $$
DECLARE
  v_owner uuid;
  v_related_owner uuid;
BEGIN
  SELECT c.traveller_id INTO v_owner
    FROM travel_credentials c
   WHERE c.workspace_id = NEW.workspace_id AND c.id = NEW.credential_id;
  SELECT c.traveller_id INTO v_related_owner
    FROM travel_credentials c
   WHERE c.workspace_id = NEW.workspace_id AND c.id = NEW.related_credential_id;
  IF v_owner <> NEW.traveller_id OR v_related_owner <> NEW.traveller_id THEN
    RAISE EXCEPTION
      'credential_links violation: % -> % is not wholly owned by traveller %',
      NEW.credential_id, NEW.related_credential_id, NEW.traveller_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER credential_links_ownership_assert
  AFTER INSERT ON credential_links
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_credential_links_same_traveller();

CREATE TABLE travel_history (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  traveller_id uuid NOT NULL,
  -- Deferred foreign key: `jurisdictions` is M4's table. The column is NOT NULL
  -- because src/domain/v2 has no shape for "history entry of no place", and an
  -- index makes the reverse lookup workable until the FK lands.
  jurisdiction_id uuid NOT NULL,
  entry_date date,
  exit_date date,
  -- §2: "Partial history explicit; do not claim dataset completeness from row
  -- existence." The strongest claim any row may make is that one window was
  -- complete; there is deliberately no way to assert whole-dataset coverage.
  coverage_claim text NOT NULL DEFAULT 'PARTIAL'
    CHECK (coverage_claim IN ('PARTIAL', 'WINDOW_COMPLETE')),
  uncertainty_note text,
  evidence_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT travel_history_traveller_fk
    FOREIGN KEY (workspace_id, traveller_id) REFERENCES travellers (workspace_id, id),
  CONSTRAINT travel_history_entry_exit CHECK (
    entry_date IS NULL OR exit_date IS NULL OR exit_date >= entry_date
  )
);

CREATE INDEX idx_travel_history_traveller ON travel_history (workspace_id, traveller_id, entry_date);
CREATE INDEX idx_travel_history_jurisdiction ON travel_history (workspace_id, jurisdiction_id);

CREATE TRIGGER travel_history_immutable
  BEFORE UPDATE OR DELETE ON travel_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
