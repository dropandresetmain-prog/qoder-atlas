-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §2: authority_grants records which principal
-- may perform which actions for which represented party over which subjects,
-- within which limits. F05 keeps this a third, separate concept alongside
-- [[0017_traveller_relationships.sql]] and [[0018_responsibility_assignments.sql]]:
-- neither a guardian relationship nor a duty-of-care responsibility implies a
-- single permitted action here.
--
-- The C1 typed-identity amendment is enforced structurally rather than by a
-- trigger: domain_subjects gains a unique (workspace_id, id, kind) key below,
-- so every legitimately cross-kind reference in M2 — and in M3/M4/M5 — can be
-- a real discriminating FK. A represented party or scope that exists only under
-- another kind fails the FK, which is the "wrong kind must fail even when the
-- UUID exists" requirement expressed once instead of per-table.
--
-- ARCHITECTURE GAP (reported, not worked around): §2 also states "Grant issuer
-- must have issuance authority". No governing policy/rule table exists in the
-- M2 range (0010-0029) and inventing a first-grant bootstrap exemption would be
-- hardcoded policy. The hook point is a deferred constraint trigger on
-- authority_grants INSERT installed by the lane that owns grant-issuance policy
-- (M5 rules / M6 authority evaluation). Issuance is therefore not yet
-- policy-checked here; every other §2 rule for this table is.

-- Additive to M1's registry table (accepted migrations are never edited): the
-- key above already guarantees at most one row per (workspace_id, id), so this
-- adds no new data restriction — only a referable target for discriminating
-- TypedRef FKs. Owned here because M2 is the first lane that needs it.
CREATE UNIQUE INDEX domain_subjects_workspace_id_id_kind_uidx
  ON domain_subjects (workspace_id, id, kind);

CREATE TABLE authority_grants (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  principal_id uuid NOT NULL,
  represented_party_kind text NOT NULL,
  represented_party_id uuid NOT NULL,
  issued_by_principal_id uuid NOT NULL,
  -- §2: "Grant issuance is bound to an authorising command". The identity of
  -- that command is the (workspace, namespace, key) primary key of
  -- command_receipts, so a grant can never cite an assertion the idempotency
  -- ledger does not hold. DEFERRED for the same reason as 0025's
  -- credential_selections_receipt_fk: PgUnitOfWork inserts this command's own
  -- receipt after the handler body, so a self-citing grant only resolves at
  -- COMMIT.
  authorising_command_namespace text NOT NULL,
  authorising_idempotency_key text NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz,
  revoked_at timestamptz,
  evidence_id uuid,
  limits jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT authority_grants_principal_fk
    FOREIGN KEY (workspace_id, principal_id) REFERENCES principals (workspace_id, id),
  CONSTRAINT authority_grants_issued_by_fk
    FOREIGN KEY (workspace_id, issued_by_principal_id) REFERENCES principals (workspace_id, id),
  CONSTRAINT authority_grants_authorising_receipt_fk
    FOREIGN KEY (workspace_id, authorising_command_namespace, authorising_idempotency_key)
    REFERENCES command_receipts (workspace_id, command_namespace, idempotency_key)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT authority_grants_represented_party_fk
    FOREIGN KEY (workspace_id, represented_party_id, represented_party_kind)
    REFERENCES domain_subjects (workspace_id, id, kind) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT authority_grants_represented_party_kind_known
    CHECK (represented_party_kind IN (
      'TRAVELLER', 'ORGANISATION', 'RESPONSIBILITY_ASSIGNMENT', 'PRINCIPAL'
    )),
  -- §10: opaque bounded policy payload only — never a mutable entity or an ID
  -- array that anything reverse-looks-up. Lifting a limit to a queried column
  -- belongs to whoever filters on it.
  CONSTRAINT authority_grants_limits_shape CHECK (
    limits IS NULL OR (jsonb_typeof(limits) = 'object' AND pg_column_size(limits) <= 8192)
  ),
  CONSTRAINT authority_grants_expiry_after_issue CHECK (
    expires_at IS NULL OR expires_at > issued_at
  ),
  CONSTRAINT authority_grants_revocation_after_issue CHECK (
    revoked_at IS NULL OR revoked_at >= issued_at
  )
);

CREATE INDEX idx_authority_grants_principal
  ON authority_grants (workspace_id, principal_id, revoked_at, expires_at);
CREATE INDEX idx_authority_grants_represented_party
  ON authority_grants (workspace_id, represented_party_kind, represented_party_id);

-- Closed vocabulary of actions that can be authorised. This exists so an
-- unrecognised action kind is rejected by a foreign key rather than silently
-- treated as a wildcard by a downstream evaluator; a lane that needs a new
-- verb adds a row here (or in its own migration), it never broadens a match.
CREATE TABLE authority_action_kinds (
  action_kind text PRIMARY KEY CHECK (action_kind ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  installed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO authority_action_kinds (action_kind, installed_by) VALUES
  ('traveller.profile.write', 'M2'),
  ('traveller.credential.record', 'M2'),
  ('traveller.relationship.record', 'M2'),
  ('trip.create', 'M2'),
  ('trip.lifecycle.write', 'M2'),
  ('journey.create', 'M2'),
  ('journey.intent.write', 'M2'),
  ('journey.credential.select', 'M2'),
  ('coordination.group.write', 'M2'),
  ('support.assignment.write', 'M2'),
  ('authority.grant.write', 'M2'),
  ('authority.grant.revoke', 'M2');

-- Contract: actions: string[].min(1) — an association table, not a JSON array
-- (§10 forbids JSON for anything that must be filtered or joined).
CREATE TABLE grant_actions (
  workspace_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  action_kind text NOT NULL REFERENCES authority_action_kinds (action_kind),
  PRIMARY KEY (workspace_id, grant_id, action_kind),
  CONSTRAINT grant_actions_grant_fk
    FOREIGN KEY (workspace_id, grant_id) REFERENCES authority_grants (workspace_id, id) ON DELETE CASCADE
);

-- Contract: scopes: TypedRef[].min(1). Deferred so one command can register a
-- new subject and grant authority over it in the same transaction.
CREATE TABLE grant_scopes (
  workspace_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  scope_kind text NOT NULL,
  scope_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, grant_id, scope_kind, scope_id),
  CONSTRAINT grant_scopes_grant_fk
    FOREIGN KEY (workspace_id, grant_id) REFERENCES authority_grants (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT grant_scopes_subject_fk
    FOREIGN KEY (workspace_id, scope_id, scope_kind)
    REFERENCES domain_subjects (workspace_id, id, kind) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_grant_scopes_subject ON grant_scopes (workspace_id, scope_kind, scope_id);

-- Both min(1) rules live at COMMIT because the children cannot be inserted
-- before the parent row exists.
CREATE FUNCTION assert_authority_grant_children() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM grant_actions a WHERE a.workspace_id = NEW.workspace_id AND a.grant_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'authority_grants % authorises no action kind', NEW.id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM grant_scopes s WHERE s.workspace_id = NEW.workspace_id AND s.grant_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'authority_grants % has no scope subject', NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER authority_grants_children_assert
  AFTER INSERT ON authority_grants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_authority_grant_children();

CREATE FUNCTION enforce_subject_subtype_authority_grant(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: AUTHORITY_GRANT subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM authority_grants g
     WHERE g.workspace_id = p_workspace_id AND g.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: AUTHORITY_GRANT subject % has no authority_grants row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('AUTHORITY_GRANT', 'enforce_subject_subtype_authority_grant', 'M2');
