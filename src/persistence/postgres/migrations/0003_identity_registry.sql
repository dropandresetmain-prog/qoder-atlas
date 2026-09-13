-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §1: domain_subjects is a narrow identity
-- registry with no business payload; aggregate_heads is the single current
-- revision counter per mutable root. "Registration of a subject, root head
-- and typed row is atomic, with deferred constraints for the circular
-- identity relationship where needed" — implemented below as two DEFERRABLE
-- FKs checked at COMMIT, so a command can insert the typed row, the head and
-- the subject in one transaction regardless of statement order.

-- Mirrors src/domain/v2/shared/identity.ts SubjectKindSchema at the C0
-- freeze. M2-M5 add rows via INSERT in their own migration files when a lane
-- registers a kind not yet present; never edit an already-shipped kind.
CREATE TABLE subject_kinds (
  kind text PRIMARY KEY
);

INSERT INTO subject_kinds (kind) VALUES
  ('WORKSPACE'), ('ORGANISATION'), ('PRINCIPAL'), ('TRAVELLER'), ('TRAVELLER_RELATIONSHIP'),
  ('RESPONSIBILITY_ASSIGNMENT'), ('AUTHORITY_GRANT'), ('TRIP'), ('JOURNEY'), ('JOURNEY_ITEM'),
  ('COORDINATION_GROUP'), ('SUPPORT_ASSIGNMENT'), ('TRANSPORT_SERVICE'), ('RESOURCE'),
  ('RESERVATION'), ('RESERVATION_LINE'), ('SERVICE_ENTITLEMENT'), ('OFFER'), ('COMMERCIAL_AGREEMENT'),
  ('BUDGET'), ('EVENT'), ('PROGRAMME'), ('PROGRAMME_ITEM'), ('PARTICIPATION'), ('PLACE'),
  ('GEOGRAPHIC_AREA'), ('JURISDICTION'), ('OBJECTIVE'), ('CONSTRAINT_DEFINITION'), ('RULE_SET'),
  ('PREFERENCE'), ('SOURCE_RECORD'), ('EVIDENCE_RECORD'), ('INFORMATION_RECORD'), ('INFORMATION_VERSION'),
  ('EXTERNAL_CONNECTION'), ('EXTERNAL_RECORD'), ('OWNERSHIP_BINDING'), ('CHANGE_REQUEST'), ('CHANGE_SIGNAL'),
  ('RECOVERY_CASE'), ('RECOVERY_STRATEGY'), ('ASSESSMENT'), ('ACTION_PLAN'), ('ACTION_INTENT'),
  ('AUTHORITY_DECISION'), ('APPROVAL'), ('EXECUTION_ATTEMPT');

CREATE TABLE domain_subjects (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  kind text NOT NULL REFERENCES subject_kinds (kind),
  aggregate_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE aggregate_heads (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  aggregate_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, aggregate_id)
);

ALTER TABLE domain_subjects
  ADD CONSTRAINT domain_subjects_aggregate_fk
  FOREIGN KEY (workspace_id, aggregate_id) REFERENCES aggregate_heads (workspace_id, aggregate_id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE aggregate_heads
  ADD CONSTRAINT aggregate_heads_subject_fk
  FOREIGN KEY (workspace_id, aggregate_id) REFERENCES domain_subjects (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_domain_subjects_kind ON domain_subjects (workspace_id, kind);
CREATE INDEX idx_domain_subjects_aggregate ON domain_subjects (workspace_id, aggregate_id);

-- Subtype enforcement (DATA_STRUCTURE_LOGICAL_SCHEMA.md §1: "Enforce registry
-- kind/subtype and aggregate-owner consistency using declared typed
-- FKs/checks and deferred constraint triggers where ordinary FKs cannot
-- express the cross-table rule"). M1 owns only the WORKSPACE branch (the
-- `workspaces` table it also owns). M2-M5 extend this function via
-- `CREATE OR REPLACE FUNCTION` in their own migrations, adding one ELSIF
-- branch per kind whose typed table they introduce — never changing an
-- already-shipped branch's semantics without an architecture decision.
CREATE FUNCTION enforce_domain_subject_subtype() RETURNS trigger AS $$
BEGIN
  IF NEW.kind = 'WORKSPACE' THEN
    IF NEW.workspace_id <> NEW.id OR NEW.aggregate_id <> NEW.id THEN
      RAISE EXCEPTION
        'domain_subjects subtype violation: WORKSPACE subject % must have workspace_id = id = aggregate_id',
        NEW.id;
    END IF;
    -- Defense-in-depth only: for this kind, workspace_id = id by the check
    -- above, and aggregate_heads/domain_subjects's own `workspace_id
    -- REFERENCES workspaces (id)` FK already makes this branch unreachable
    -- in practice (a WORKSPACE subject cannot be inserted at all without a
    -- workspaces row existing first). Kept in case a future migration ever
    -- relaxes that FK; do not treat this branch as the primary guarantee.
    IF NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.id) THEN
      RAISE EXCEPTION
        'domain_subjects subtype violation: no workspaces row for WORKSPACE subject %', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER domain_subjects_subtype_check
  AFTER INSERT OR UPDATE ON domain_subjects
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_domain_subject_subtype();

-- Reused by every immutable append-only table introduced from 0004 onward.
CREATE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
