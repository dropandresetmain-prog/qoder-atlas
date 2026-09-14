-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §6: `objectives` / `objective_targets` /
-- `objective_dispositions`. An Objective is desired outcome state owned by a
-- Trip / Journey / CoordinationGroup / Programme (closure §4.5) — never a
-- health verdict and never a constraint. The frozen contract
-- (ObjectiveSchema) has no disposition-evidence target yet; the disposition
-- table carries an optional objective target row so "achieved WHAT" is
-- representable (schema §6 "target refs") without a mutable JSON bag.
--
-- The owner ref uses the (workspace, kind, id) discriminating FK so an
-- OBJECTIVE owned by "TRIP:<a journey id>" cannot exist.

CREATE TABLE objectives (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  owner_kind text NOT NULL REFERENCES subject_kinds (kind),
  owner_id uuid NOT NULL,
  -- Typed success predicate: the frozen contract keeps successPredicate as a
  -- bounded statement plus the structured operands that make it checkable;
  -- interpretation belongs to M6, prose is bounded here.
  success_predicate text NOT NULL CHECK (length(btrim(success_predicate)) > 0),
  success_predicate_kind text NOT NULL DEFAULT 'STATEMENT'
    CHECK (success_predicate_kind IN ('STATEMENT', 'ARRIVAL_BY', 'ATTEND', 'COMPLETE_ITEMS', 'BOUND_SPEND')),
  hardness text NOT NULL CHECK (hardness IN ('HARD', 'SOFT')),
  priority integer NOT NULL CHECK (priority >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT objectives_owner_fk
    FOREIGN KEY (workspace_id, owner_kind, owner_id)
    REFERENCES domain_subjects (workspace_id, id, kind),
  CONSTRAINT objectives_owner_kind_restricted CHECK (
    owner_kind IN ('TRIP', 'JOURNEY', 'COORDINATION_GROUP', 'PROGRAMME')
  )
);

CREATE INDEX idx_objectives_owner ON objectives (workspace_id, owner_kind, owner_id);

-- §6 "objective_targets": the measurable references an objective aims at.
CREATE TABLE objective_targets (
  workspace_id uuid NOT NULL,
  objective_id uuid NOT NULL,
  target_kind text NOT NULL CHECK (target_kind IN ('SUBJECT', 'PLACE', 'TIME', 'MONEY', 'QUANTITY')),
  subject_kind text REFERENCES subject_kinds (kind),
  subject_id uuid,
  place_id uuid,
  at_or_before timestamptz,
  amount_minor integer CHECK (amount_minor IS NULL OR amount_minor >= 0),
  currency_code char(3) CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  PRIMARY KEY (workspace_id, objective_id, label),
  CONSTRAINT objective_targets_objective_fk
    FOREIGN KEY (workspace_id, objective_id) REFERENCES objectives (workspace_id, id),
  CONSTRAINT objective_targets_subject_fk
    FOREIGN KEY (workspace_id, subject_kind, subject_id)
    REFERENCES domain_subjects (workspace_id, id, kind),
  CONSTRAINT objective_targets_subject_complete CHECK (
    (target_kind = 'SUBJECT') = (subject_kind IS NOT NULL AND subject_id IS NOT NULL)
  ),
  CONSTRAINT objective_targets_shape CHECK (
    (target_kind = 'PLACE') = (place_id IS NOT NULL)
    AND (target_kind = 'TIME') = (at_or_before IS NOT NULL)
    AND (target_kind IN ('MONEY', 'QUANTITY')) = (amount_minor IS NOT NULL)
  ),
  CONSTRAINT objective_targets_currency_complete CHECK (
    (amount_minor IS NULL) = (currency_code IS NULL)
  )
);

CREATE INDEX idx_objective_targets_subject
  ON objective_targets (workspace_id, subject_kind, subject_id)
  WHERE subject_id IS NOT NULL;

-- §6 "objective_dispositions": "immutable waiver/loss evidence; disposition
-- requires authority" — the lifecycle is an append-only history, not a mutable
-- column on the objective. Active is the absence of a terminal disposition.
CREATE TABLE objective_dispositions (
  workspace_id uuid NOT NULL,
  objective_id uuid NOT NULL,
  sequence_number integer NOT NULL CHECK (sequence_number >= 1),
  disposition text NOT NULL CHECK (disposition IN ('ACTIVE', 'ACHIEVED', 'WAIVED', 'CLOSED_WITH_LOSS')),
  evidence_id uuid NOT NULL,
  objective_target_label text,
  reason text CHECK (reason IS NULL OR length(reason) <= 2048),
  decided_at timestamptz NOT NULL DEFAULT now(),
  decided_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, objective_id, sequence_number),
  CONSTRAINT objective_dispositions_objective_fk
    FOREIGN KEY (workspace_id, objective_id) REFERENCES objectives (workspace_id, id),
  CONSTRAINT objective_dispositions_evidence_fk
    FOREIGN KEY (workspace_id, evidence_id) REFERENCES evidence_records (workspace_id, id),
  CONSTRAINT objective_dispositions_target_fk
    FOREIGN KEY (workspace_id, objective_id, objective_target_label)
    REFERENCES objective_targets (workspace_id, objective_id, label)
);

CREATE TRIGGER objective_dispositions_immutable
  BEFORE UPDATE OR DELETE ON objective_dispositions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE INDEX idx_objective_dispositions_objective
  ON objective_dispositions (workspace_id, objective_id, sequence_number DESC);

-- A terminal disposition is final: nothing appends after ACHIEVED/WAIVED/
-- CLOSED_WITH_LOSS, and the first row of an objective may not be terminal-only
-- history rewriting (the objective starts ACTIVE by construction).
CREATE FUNCTION assert_objective_disposition_order() RETURNS trigger AS $$
DECLARE
  v_terminal_count integer;
  v_max_seq integer;
BEGIN
  SELECT count(*) INTO v_terminal_count
    FROM objective_dispositions d
   WHERE d.workspace_id = NEW.workspace_id
     AND d.objective_id = NEW.objective_id
     AND d.disposition IN ('ACHIEVED', 'WAIVED', 'CLOSED_WITH_LOSS');
  IF v_terminal_count > 0 THEN
    RAISE EXCEPTION
      'objective_dispositions violation: objective % already has a terminal disposition', NEW.objective_id;
  END IF;
  SELECT max(sequence_number) INTO v_max_seq
    FROM objective_dispositions d
   WHERE d.workspace_id = NEW.workspace_id
     AND d.objective_id = NEW.objective_id;
  IF v_max_seq IS NOT NULL AND NEW.sequence_number <> v_max_seq + 1 THEN
    RAISE EXCEPTION
      'objective_dispositions violation: expected sequence %, got %', v_max_seq + 1, NEW.sequence_number;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER objective_dispositions_order_assert
  AFTER INSERT ON objective_dispositions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_objective_disposition_order();

-- ---------------------------------------------------------------------------
-- Subtype checker for OBJECTIVE (0010 extension contract).
-- ---------------------------------------------------------------------------
CREATE FUNCTION enforce_subject_subtype_objective(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: OBJECTIVE subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM objectives o
     WHERE o.workspace_id = p_workspace_id AND o.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: OBJECTIVE subject % has no objectives row', p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('OBJECTIVE', 'enforce_subject_subtype_objective', 'M5');
