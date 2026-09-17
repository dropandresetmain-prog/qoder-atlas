-- R0 (0124): ChangeSignal activation + consequence provenance.
--
-- DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §4.6: "ChangeSignal — immutable
-- causal notification with subjects/applicability and evidence. Validated
-- ingestion or domain command emits it. It is not the current world state."
-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §7: `change_signals`, `signal_subjects` —
-- "Immutable: causal origin/key, change type, evidence and subject/scope
-- links. Causation and correlation IDs; idempotency identity defined per
-- origin." 0100's `case_signals.change_signal_id` has referenced this table
-- since M7 ("link validated when that table lands"). It lands here.
--
-- Why now (runtime audit R0): the runtime had no first-class record that
-- says "this external change happened, these commands applied it, these
-- assessments were invalidated because of it". The T2 ingress therefore
-- stored its completion marker as an `information_records` row with a
-- per-event topic, which is application bookkeeping, not world knowledge —
-- and because that topic can never be registered, every ingress advanced
-- `INFORMATION_TOPIC:m6:unregistered-topic`, which every assessment
-- manifest reads, invalidating every assessment in the workspace.
--
-- Three additive pieces:
--   1. `change_signals` (immutable) + `signal_subjects` + a separate
--      `change_signal_completions` table, so the signal itself never mutates
--      and "applied" is a durable, idempotent completion record.
--   2. Consequence provenance: a command executed under a change signal sets
--      the transaction-local setting `northstar.change_signal_id`
--      (PgUnitOfWork). `change_records` and the M6 reassessment-enqueue
--      trigger (0091) record it, so signal -> change records -> scheduled
--      reassessment -> result assessment is a walkable chain. Coalescing
--      semantics of 0091 are unchanged: the first signal to open a unit of
--      work owns it.
--   3. CHANGE_SIGNAL subject activation (0010 extension contract).

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
CREATE TABLE change_signals (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  -- Where the signal came from and its idempotency identity within that origin.
  origin_kind text NOT NULL CHECK (origin_kind ~ '^[A-Z][A-Z0-9_]*$'),
  origin_key text NOT NULL CHECK (length(btrim(origin_key)) > 0 AND length(origin_key) <= 512),
  -- Typed change vocabulary (e.g. TRANSPORT_SERVICE_CANCELLED_WITH_REPROTECTION).
  change_type text NOT NULL CHECK (change_type ~ '^[A-Z][A-Z0-9_]*$'),
  -- Canonical substance hash: the same origin key with a different hash is a conflict, never a replay.
  content_hash text NOT NULL CHECK (length(btrim(content_hash)) > 0),
  received_at timestamptz NOT NULL,
  source_connection_id uuid,
  source_record_id uuid,
  evidence_id uuid,
  -- Bounded, immutable, typed-by-caller summary (never a JSON dumping ground for state).
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(summary) = 'object' AND pg_column_size(summary) <= 65536),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT change_signals_origin_uidx UNIQUE (workspace_id, origin_kind, origin_key),
  CONSTRAINT change_signals_connection_fk FOREIGN KEY (workspace_id, source_connection_id)
    REFERENCES external_connections (workspace_id, id),
  CONSTRAINT change_signals_source_fk FOREIGN KEY (workspace_id, source_record_id)
    REFERENCES source_records (workspace_id, id),
  CONSTRAINT change_signals_evidence_fk FOREIGN KEY (workspace_id, evidence_id)
    REFERENCES evidence_records (workspace_id, id)
);
CREATE INDEX idx_change_signals_received ON change_signals (workspace_id, received_at DESC);

CREATE TABLE signal_subjects (
  workspace_id uuid NOT NULL,
  change_signal_id uuid NOT NULL,
  subject_kind text NOT NULL REFERENCES subject_kinds (kind),
  subject_id uuid NOT NULL,
  role text NOT NULL CHECK (length(btrim(role)) > 0 AND length(role) <= 128),
  PRIMARY KEY (workspace_id, change_signal_id, subject_kind, subject_id, role),
  CONSTRAINT signal_subjects_signal_fk FOREIGN KEY (workspace_id, change_signal_id)
    REFERENCES change_signals (workspace_id, id),
  CONSTRAINT signal_subjects_subject_fk FOREIGN KEY (workspace_id, subject_id, subject_kind)
    REFERENCES domain_subjects (workspace_id, id, kind)
);
CREATE INDEX idx_signal_subjects_subject ON signal_subjects (workspace_id, subject_kind, subject_id);

-- "Applied" is a separate durable fact, so `change_signals` stays immutable.
-- Presence = every required application step committed; absence = in
-- progress, whatever partial state exists (replaces the T2 information-record
-- completion marker one-for-one).
CREATE TABLE change_signal_completions (
  workspace_id uuid NOT NULL,
  change_signal_id uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  outcome text NOT NULL CHECK (outcome IN ('APPLIED')),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, change_signal_id),
  CONSTRAINT change_signal_completions_signal_fk FOREIGN KEY (workspace_id, change_signal_id)
    REFERENCES change_signals (workspace_id, id)
);

CREATE TRIGGER change_signals_immutable BEFORE UPDATE OR DELETE ON change_signals FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER signal_subjects_immutable BEFORE UPDATE OR DELETE ON signal_subjects FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER change_signal_completions_immutable BEFORE UPDATE OR DELETE ON change_signal_completions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- 0100 deferred this link until the table existed.
ALTER TABLE case_signals
  ADD CONSTRAINT case_signals_signal_fk FOREIGN KEY (workspace_id, change_signal_id)
    REFERENCES change_signals (workspace_id, id);

-- ---------------------------------------------------------------------------
-- 2. Consequence provenance
-- ---------------------------------------------------------------------------
-- The change signal a command is executing under, or NULL. Set per
-- transaction by PgUnitOfWork (`set_config('northstar.change_signal_id', ..., true)`).
CREATE FUNCTION northstar_current_change_signal() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('northstar.change_signal_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

ALTER TABLE change_records ADD COLUMN change_signal_id uuid;
ALTER TABLE change_records
  ADD CONSTRAINT change_records_signal_fk FOREIGN KEY (workspace_id, change_signal_id)
    REFERENCES change_signals (workspace_id, id);
CREATE INDEX idx_change_records_signal ON change_records (workspace_id, change_signal_id) WHERE change_signal_id IS NOT NULL;

ALTER TABLE scheduled_reassessments ADD COLUMN change_signal_id uuid;
ALTER TABLE scheduled_reassessments
  ADD CONSTRAINT scheduled_reassessments_signal_fk FOREIGN KEY (workspace_id, change_signal_id)
    REFERENCES change_signals (workspace_id, id);
CREATE INDEX idx_scheduled_reassessments_signal ON scheduled_reassessments (workspace_id, change_signal_id) WHERE change_signal_id IS NOT NULL;

-- Same body as 0091, plus the signal column. Coalescing (one open unit per
-- subject+kind, ON CONFLICT DO NOTHING) is unchanged.
CREATE OR REPLACE FUNCTION m6_enqueue_reassessment_for_input(p_workspace uuid, p_kind text, p_key text, p_revision bigint, p_generation bigint) RETURNS void AS $$
BEGIN
  INSERT INTO scheduled_reassessments (workspace_id, subject_kind, subject_id, assessment_kind, reason, cause_assessment_id, cause_input_key, change_signal_id)
  SELECT DISTINCT ON (a.subject_kind, a.subject_id, a.kind) a.workspace_id, a.subject_kind, a.subject_id, a.kind, 'INPUT_CHANGED', a.id, p_kind || '|' || p_key,
         northstar_current_change_signal()
    FROM assessment_inputs i
    JOIN assessments a ON a.workspace_id = i.workspace_id AND a.id = i.assessment_id
   WHERE i.workspace_id = p_workspace AND i.input_kind = p_kind AND i.input_key = p_key
     AND ((p_kind = 'AGGREGATE' AND i.revision IS DISTINCT FROM p_revision) OR (p_kind = 'SCOPE' AND i.generation IS DISTINCT FROM p_generation))
     AND NOT EXISTS (SELECT 1 FROM assessments s WHERE s.workspace_id = a.workspace_id AND s.supersedes_assessment_id = a.id)
   ORDER BY a.subject_kind, a.subject_id, a.kind, a.evaluated_at DESC
  ON CONFLICT (workspace_id, subject_kind, subject_id, assessment_kind) WHERE state IN ('PENDING', 'CLAIMED') DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 3. CHANGE_SIGNAL subject activation (0010 extension contract)
-- ---------------------------------------------------------------------------
CREATE FUNCTION enforce_subject_subtype_change_signal(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION 'domain_subjects subtype violation: CHANGE_SIGNAL subject % must be its own aggregate root (aggregate_id=%)', p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM change_signals s WHERE s.workspace_id = p_workspace_id AND s.id = p_id) THEN
    RAISE EXCEPTION 'domain_subjects subtype violation: CHANGE_SIGNAL subject % has no change_signals row', p_id;
  END IF;
END;
$$;
INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES ('CHANGE_SIGNAL', 'enforce_subject_subtype_change_signal', 'R0');
