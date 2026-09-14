-- "ownership_bindings" (F08): the two halves of external identity that locator
-- equality can never provide.
--
-- external_record_links: a VERIFIED, evidence-backed correlation between a
-- provider record and a canonical subject. Multiple links may exist (several
-- systems of record); none of them may claim duplicate canonical ownership of
-- the same field group — that is ownership_bindings' job. A link row is the
-- ONLY path to identity_state='LINKED' (deferred assertion below): a record
-- cannot become linked by renaming itself.
--
-- ownership_bindings: at most one CURRENT binding per (subject, field_group)
-- regardless of wall clock; PROPOSED never activates by time alone — only an
-- authorized reconciliation command flips CURRENT->HISTORICAL and
-- PROPOSED->CURRENT in one transaction. Observing a record never implies
-- permission to modify it: an EXTERNAL owner binding names its connection, and
-- no binding at all does not imply internal ownership.

CREATE TABLE external_record_links (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  external_record_id uuid NOT NULL,
  -- Canonical target, via the discriminating registry identity (kind+id).
  canonical_subject_id uuid NOT NULL,
  canonical_subject_kind text NOT NULL,
  link_kind text NOT NULL CHECK (link_kind IN ('SYSTEM_OF_RECORD', 'CORRELATED', 'OBSERVED_BY')),
  evidence_id uuid NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT external_record_links_record_fk
    FOREIGN KEY (workspace_id, external_record_id)
    REFERENCES external_records (workspace_id, id),
  -- Discriminating FK: the (kind,id) pair must exist in the registry, so a
  -- link to a deleted/mistyped subject is unrepresentable.
  CONSTRAINT external_record_links_subject_fk
    FOREIGN KEY (workspace_id, canonical_subject_id, canonical_subject_kind)
    REFERENCES domain_subjects (workspace_id, id, kind),
  CONSTRAINT external_record_links_valid_shape CHECK (superseded_at IS NULL OR superseded_at > linked_at)
);

-- "Which external records own/observe this target" — the M6 reverse lookup.
CREATE INDEX idx_external_record_links_subject
  ON external_record_links (workspace_id, canonical_subject_id, canonical_subject_kind);
CREATE INDEX idx_external_record_links_record
  ON external_record_links (workspace_id, external_record_id);

-- Only a live, evidence-backed link makes a record LINKED; a QUARANTINED record
-- can never carry one, and a record whose links are all superseded is not
-- LINKED either.
CREATE FUNCTION assert_external_record_link_state() RETURNS trigger AS $$
DECLARE
  v_state text;
  v_live_links integer;
BEGIN
  SELECT identity_state INTO v_state
    FROM external_records
   WHERE workspace_id = NEW.workspace_id AND id = NEW.external_record_id;
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'external_record_links %: external record does not exist', NEW.id;
  END IF;
  IF v_state IN ('QUARANTINED_UNKNOWN', 'QUARANTINED_AMBIGUOUS') THEN
    RAISE EXCEPTION
      'external_record_links %: quarantined record % cannot carry a verified link (F08)',
      NEW.id, NEW.external_record_id;
  END IF;
  SELECT COUNT(*) INTO v_live_links
    FROM external_record_links l
   WHERE l.workspace_id = NEW.workspace_id
     AND l.external_record_id = NEW.external_record_id
     AND l.superseded_at IS NULL;
  IF v_state = 'LINKED' AND v_live_links = 0 THEN
    RAISE EXCEPTION
      'external_record_links: external record % is LINKED but has no live link row',
      NEW.external_record_id;
  END IF;
  IF v_state = 'UNVERIFIED' AND v_live_links = 0 THEN
    RAISE EXCEPTION
      'external_record_links %: record % has no live link; keep it UNVERIFIED or link it first (F08)',
      NEW.id, NEW.external_record_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER external_record_links_state_assert
  AFTER INSERT OR UPDATE OF superseded_at ON external_record_links
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_external_record_link_state();

CREATE FUNCTION assert_external_record_identity_state() RETURNS trigger AS $$
DECLARE
  v_live_links integer;
BEGIN
  SELECT COUNT(*) INTO v_live_links
    FROM external_record_links l
   WHERE l.workspace_id = NEW.workspace_id
     AND l.external_record_id = NEW.id
     AND l.superseded_at IS NULL;
  IF NEW.identity_state = 'LINKED' AND v_live_links = 0 THEN
    RAISE EXCEPTION
      'external_records %: cannot become LINKED without a live verified link row (F08)',
      NEW.id;
  END IF;
  IF NEW.identity_state <> 'LINKED' AND v_live_links > 0 THEN
    RAISE EXCEPTION
      'external_records %: cannot leave LINKED while a live verified link row exists',
      NEW.id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER external_records_identity_state_assert
  AFTER INSERT OR UPDATE OF identity_state ON external_records
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_external_record_identity_state();

CREATE TABLE ownership_bindings (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  subject_id uuid NOT NULL,
  subject_kind text NOT NULL,
  field_group text NOT NULL,
  owner_kind text NOT NULL CHECK (owner_kind IN ('INTERNAL', 'EXTERNAL')),
  connection_id uuid,
  source_id text,
  binding_state text NOT NULL CHECK (binding_state IN ('PROPOSED', 'CURRENT', 'HISTORICAL')),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  evidence_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  -- The bound subject must exist and the binding mutates under its aggregate.
  CONSTRAINT ownership_bindings_subject_fk
    FOREIGN KEY (workspace_id, subject_id, subject_kind)
    REFERENCES domain_subjects (workspace_id, id, kind),
  CONSTRAINT ownership_bindings_connection_fk
    FOREIGN KEY (workspace_id, connection_id)
    REFERENCES external_connections (workspace_id, id),
  -- An EXTERNAL owner names its connection; INTERNAL ownership never does.
  CONSTRAINT ownership_bindings_owner_shape CHECK (
    (owner_kind = 'EXTERNAL') = (connection_id IS NOT NULL)
  ),
  CONSTRAINT ownership_bindings_validity_shape CHECK (
    effective_until IS NULL OR effective_until > effective_from
  )
);

-- §7: partial unique — at most one CURRENT binding per (subject, field_group),
-- independent of wall clock.
CREATE UNIQUE INDEX ownership_bindings_current_uidx
  ON ownership_bindings (workspace_id, subject_id, field_group)
  WHERE binding_state = 'CURRENT';
CREATE INDEX idx_ownership_bindings_subject
  ON ownership_bindings (workspace_id, subject_id, subject_kind, field_group);

-- Every subject with a binding must own an aggregate head (roots only): a
-- binding transfers the ownership of a *mutated* thing, and children mutate
-- under their root, so bindings attach to roots. This is what makes
-- "binding mutates under the owner's aggregate" checkable.
CREATE FUNCTION enforce_subject_subtype_ownership_binding(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_subject uuid;
BEGIN
  SELECT b.subject_id INTO v_subject
    FROM ownership_bindings b
   WHERE b.workspace_id = p_workspace_id AND b.id = p_id;
  IF v_subject IS NULL THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: OWNERSHIP_BINDING subject % has no ownership_bindings row',
      p_id;
  END IF;
  IF p_aggregate_id <> v_subject THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: OWNERSHIP_BINDING % must aggregate under the bound subject % (aggregate_id=%)',
      p_id, v_subject, p_aggregate_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('OWNERSHIP_BINDING', 'enforce_subject_subtype_ownership_binding', 'M3');

