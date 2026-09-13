-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §3: credential_selections records which
-- credential edition a Journey relies on for which intended visits, and is
-- provenanced by the command that chose it. F06 keeps the credential itself
-- Traveller-owned; this table is the Journey's use of it, so changing a Journey
-- never mutates the person's documents and accepting a new document edition
-- never silently rewrites what a Journey claimed.
--
-- scope_intended_visit_ids is an association table, not a JSON array: §10
-- forbids JSON for anything a later lane must join or reverse-look-up, and M6's
-- entry-requirement evaluation is exactly "which selected credentials cover
-- this intended visit".
--
-- selected_by_command_id is the contract's SubjectId and is derived
-- deterministically by the command handler from the receipt identity, so it is
-- stable across a retry. The namespace+key pair beside it is a real deferred
-- foreign key into M1's append-only command_receipts ledger, which is what
-- makes "provenanced" verifiable in SQL instead of a convention. The FK is
-- deferred because PgUnitOfWork inserts the receipt after the handler body.

CREATE TABLE credential_selections (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  journey_id uuid NOT NULL,
  credential_id uuid NOT NULL,
  credential_version_id uuid NOT NULL,
  selected_by_command_id text NOT NULL,
  selected_by_command_namespace text NOT NULL,
  selected_by_idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT credential_selections_journey_fk
    FOREIGN KEY (workspace_id, journey_id) REFERENCES journeys (workspace_id, id),
  CONSTRAINT credential_selections_credential_fk
    FOREIGN KEY (workspace_id, credential_id) REFERENCES travel_credentials (workspace_id, id),
  CONSTRAINT credential_selections_version_fk
    FOREIGN KEY (workspace_id, credential_version_id) REFERENCES credential_versions (workspace_id, id),
  CONSTRAINT credential_selections_receipt_fk
    FOREIGN KEY (workspace_id, selected_by_command_namespace, selected_by_idempotency_key)
    REFERENCES command_receipts (workspace_id, command_namespace, idempotency_key)
    DEFERRABLE INITIALLY DEFERRED,
  -- One credential is selected once per Journey; re-selecting is an update of
  -- this row's pinned edition, never a second parallel claim.
  CONSTRAINT credential_selections_journey_credential_uidx
    UNIQUE (workspace_id, journey_id, credential_id)
);

CREATE INDEX idx_credential_selections_credential
  ON credential_selections (workspace_id, credential_id);
CREATE INDEX idx_credential_selections_version
  ON credential_selections (workspace_id, credential_version_id);

CREATE TABLE credential_selection_visits (
  workspace_id uuid NOT NULL,
  selection_id uuid NOT NULL,
  intended_visit_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, selection_id, intended_visit_id),
  CONSTRAINT credential_selection_visits_selection_fk
    FOREIGN KEY (workspace_id, selection_id)
    REFERENCES credential_selections (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT credential_selection_visits_visit_fk
    FOREIGN KEY (workspace_id, intended_visit_id)
    REFERENCES intended_visits (workspace_id, id)
);

CREATE INDEX idx_credential_selection_visits_visit
  ON credential_selection_visits (workspace_id, intended_visit_id);

-- Three rules ordinary constraints cannot express, all evaluated at COMMIT so
-- one command may create the visit rows and the selection together:
--   1. the selected version must belong to the selected credential;
--   2. the credential must belong to the same Traveller as the Journey;
--   3. every scoped intended visit must be a visit of this same Journey, and
--      the selection must scope at least one (contract: min(1)).
CREATE FUNCTION assert_credential_selection_consistency() RETURNS trigger AS $$
DECLARE
  v_version_owner uuid;
  v_credential_traveller uuid;
  v_journey_traveller uuid;
  v_visit_count integer;
  v_foreign_visits integer;
BEGIN
  SELECT cv.credential_id INTO v_version_owner
    FROM credential_versions cv
   WHERE cv.workspace_id = NEW.workspace_id AND cv.id = NEW.credential_version_id;
  IF v_version_owner IS DISTINCT FROM NEW.credential_id THEN
    RAISE EXCEPTION
      'credential_selections % pins version % which belongs to credential % not %',
      NEW.id, NEW.credential_version_id, v_version_owner, NEW.credential_id;
  END IF;

  SELECT c.traveller_id INTO v_credential_traveller
    FROM travel_credentials c WHERE c.workspace_id = NEW.workspace_id AND c.id = NEW.credential_id;
  SELECT j.traveller_id INTO v_journey_traveller
    FROM journeys j WHERE j.workspace_id = NEW.workspace_id AND j.id = NEW.journey_id;
  IF v_credential_traveller IS DISTINCT FROM v_journey_traveller THEN
    RAISE EXCEPTION
      'credential_selections % selects a credential of another traveller (F06: credentials are Traveller-owned)',
      NEW.id;
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE iv.journey_id IS DISTINCT FROM NEW.journey_id)
    INTO v_visit_count, v_foreign_visits
    FROM credential_selection_visits csv
    JOIN intended_visits iv
      ON iv.workspace_id = csv.workspace_id AND iv.id = csv.intended_visit_id
   WHERE csv.workspace_id = NEW.workspace_id AND csv.selection_id = NEW.id;
  IF v_visit_count = 0 THEN
    RAISE EXCEPTION 'credential_selections % scopes no intended visit', NEW.id;
  END IF;
  IF v_foreign_visits > 0 THEN
    RAISE EXCEPTION
      'credential_selections % scopes % intended visit(s) belonging to another journey',
      NEW.id, v_foreign_visits;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER credential_selections_consistency_assert
  AFTER INSERT OR UPDATE ON credential_selections
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_credential_selection_consistency();
