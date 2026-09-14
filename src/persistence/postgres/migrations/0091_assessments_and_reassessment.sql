-- M6 (0091): immutable assessments, manifest input rows and durable reassessment.
--
-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §7 (`assessments`, `assessment_results`,
-- `assessment_subjects`, `assessment_inputs`) and §8 (`scheduled_reassessments`):
-- "Assessment inputs by aggregate/scope/evidence and expiration; pending
-- reassessment by due time". Closure §6: "Persist scheduled reassessment work and
-- catch up after downtime ... A changed input triggers reevaluation."
--
-- Assessments are derived, immutable, never profile/Trip health. A newer
-- assessment of the same subject+kind supersedes an older one by an explicit
-- `supersedes_assessment_id` link; nothing is updated in place.
--
-- Invalidation work is created by triggers in the SAME transaction as the change
-- that makes an assessment stale (aggregate head advance, scope generation
-- advance), by reverse lookup through `assessment_inputs`. A committed change
-- therefore cannot lose its reassessment work; a rolled-back change creates none.
-- Clock-only expiry is enqueued by a query over `next_invalidation_at`, which
-- also catches up everything that fell due while no worker was running.

CREATE TABLE assessment_kinds (kind text PRIMARY KEY);
INSERT INTO assessment_kinds (kind) VALUES ('IMPACT'), ('VIABILITY'), ('ENTRY'), ('SUPPORT'), ('RISK'), ('POLICY');

CREATE TABLE assessments (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  kind text NOT NULL REFERENCES assessment_kinds (kind),
  subject_kind text NOT NULL REFERENCES subject_kinds (kind),
  subject_id uuid NOT NULL,
  evaluated_at timestamptz NOT NULL,
  overall_verdict text NOT NULL CHECK (overall_verdict IN ('PASS', 'FAIL', 'UNKNOWN')),
  next_invalidation_at timestamptz,
  supersedes_assessment_id uuid,
  -- Capture identity + coverage/missing-coverage records (bounded, immutable, typed by manifest schema version).
  manifest_detail jsonb NOT NULL CHECK (jsonb_typeof(manifest_detail) = 'object' AND pg_column_size(manifest_detail) <= 262144),
  manifest_schema_version text NOT NULL CHECK (length(btrim(manifest_schema_version)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT assessments_subject_fk FOREIGN KEY (workspace_id, subject_id, subject_kind)
    REFERENCES domain_subjects (workspace_id, id, kind),
  CONSTRAINT assessments_supersedes_fk FOREIGN KEY (workspace_id, supersedes_assessment_id)
    REFERENCES assessments (workspace_id, id),
  CONSTRAINT assessments_not_self_superseding CHECK (supersedes_assessment_id IS NULL OR supersedes_assessment_id <> id)
);
-- At most one direct successor per assessment: supersession is a chain, not a fork.
CREATE UNIQUE INDEX assessments_one_successor_uidx ON assessments (workspace_id, supersedes_assessment_id) WHERE supersedes_assessment_id IS NOT NULL;
CREATE INDEX idx_assessments_subject ON assessments (workspace_id, subject_kind, subject_id, kind, evaluated_at DESC);
CREATE INDEX idx_assessments_due ON assessments (next_invalidation_at) WHERE next_invalidation_at IS NOT NULL;

CREATE TABLE assessment_subjects (
  workspace_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  subject_kind text NOT NULL REFERENCES subject_kinds (kind),
  subject_id uuid NOT NULL,
  role text NOT NULL CHECK (length(btrim(role)) > 0),
  PRIMARY KEY (workspace_id, assessment_id, subject_kind, subject_id, role),
  CONSTRAINT assessment_subjects_assessment_fk FOREIGN KEY (workspace_id, assessment_id) REFERENCES assessments (workspace_id, id),
  CONSTRAINT assessment_subjects_subject_fk FOREIGN KEY (workspace_id, subject_id, subject_kind) REFERENCES domain_subjects (workspace_id, id, kind)
);
CREATE INDEX idx_assessment_subjects_subject ON assessment_subjects (workspace_id, subject_kind, subject_id);

CREATE TABLE assessment_results (
  workspace_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  dimension text NOT NULL CHECK (dimension ~ '^[a-z][a-z0-9_]*$'),
  verdict text NOT NULL CHECK (verdict IN ('PASS', 'FAIL', 'UNKNOWN')),
  applicable boolean NOT NULL,
  blocking boolean NOT NULL,
  -- Typed CausalExplanation[] (contracts/v2/assessment/explanation.ts): "explanation/reason detail" JSON (§10).
  explanations jsonb NOT NULL CHECK (jsonb_typeof(explanations) = 'array' AND pg_column_size(explanations) <= 262144),
  explanation_schema_version text NOT NULL CHECK (length(btrim(explanation_schema_version)) > 0),
  PRIMARY KEY (workspace_id, assessment_id, dimension),
  CONSTRAINT assessment_results_assessment_fk FOREIGN KEY (workspace_id, assessment_id) REFERENCES assessments (workspace_id, id)
);

CREATE TABLE assessment_inputs (
  workspace_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  input_kind text NOT NULL CHECK (input_kind IN ('AGGREGATE', 'SCOPE', 'EVIDENCE', 'EVALUATOR')),
  -- AGGREGATE: '<KIND>:<uuid>'; SCOPE: '<SCOPE_KIND>:<scope_id>'; EVIDENCE: edition/evidence id; EVALUATOR: '<id>'.
  input_key text NOT NULL CHECK (length(input_key) > 0),
  revision bigint,
  generation bigint,
  version text,
  PRIMARY KEY (workspace_id, assessment_id, input_kind, input_key),
  CONSTRAINT assessment_inputs_assessment_fk FOREIGN KEY (workspace_id, assessment_id) REFERENCES assessments (workspace_id, id),
  CONSTRAINT assessment_inputs_shape CHECK (
    (input_kind = 'AGGREGATE') = (revision IS NOT NULL)
    AND (input_kind = 'SCOPE') = (generation IS NOT NULL)
    AND (input_kind = 'EVALUATOR') = (version IS NOT NULL)
  )
);
CREATE INDEX idx_assessment_inputs_reverse ON assessment_inputs (workspace_id, input_kind, input_key);

CREATE TRIGGER assessments_immutable BEFORE UPDATE OR DELETE ON assessments FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER assessment_subjects_immutable BEFORE UPDATE OR DELETE ON assessment_subjects FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER assessment_results_immutable BEFORE UPDATE OR DELETE ON assessment_results FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER assessment_inputs_immutable BEFORE UPDATE OR DELETE ON assessment_inputs FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ASSESSMENT subtype checker (0010 extension contract), activated by M6.
CREATE FUNCTION enforce_subject_subtype_assessment(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION 'domain_subjects subtype violation: ASSESSMENT subject % must be its own aggregate root (aggregate_id=%)', p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM assessments a WHERE a.workspace_id = p_workspace_id AND a.id = p_id) THEN
    RAISE EXCEPTION 'domain_subjects subtype violation: ASSESSMENT subject % has no assessments row', p_id;
  END IF;
END;
$$;
INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES ('ASSESSMENT', 'enforce_subject_subtype_assessment', 'M6');

-- ---------------------------------------------------------------------------
-- Durable reassessment work.
-- ---------------------------------------------------------------------------
CREATE TABLE scheduled_reassessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  subject_kind text NOT NULL REFERENCES subject_kinds (kind),
  subject_id uuid NOT NULL,
  assessment_kind text NOT NULL REFERENCES assessment_kinds (kind),
  reason text NOT NULL CHECK (reason IN ('INPUT_CHANGED', 'CLOCK_EXPIRY', 'REQUESTED')),
  cause_assessment_id uuid,
  cause_input_key text,
  invalidate_at timestamptz NOT NULL DEFAULT now(),
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING', 'CLAIMED', 'DONE', 'UNAVAILABLE')),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  claim_token uuid,
  fencing_token bigint NOT NULL DEFAULT 0,
  lease_expires_at timestamptz,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  result_assessment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_reassessments_subject_fk FOREIGN KEY (workspace_id, subject_id, subject_kind) REFERENCES domain_subjects (workspace_id, id, kind),
  CONSTRAINT scheduled_reassessments_cause_fk FOREIGN KEY (workspace_id, cause_assessment_id) REFERENCES assessments (workspace_id, id),
  CONSTRAINT scheduled_reassessments_result_fk FOREIGN KEY (workspace_id, result_assessment_id) REFERENCES assessments (workspace_id, id),
  CONSTRAINT scheduled_reassessments_done_has_result CHECK ((state = 'DONE') = (result_assessment_id IS NOT NULL))
);
-- One open unit of work per subject+kind: repeated invalidations coalesce.
CREATE UNIQUE INDEX scheduled_reassessments_open_uidx
  ON scheduled_reassessments (workspace_id, subject_kind, subject_id, assessment_kind) WHERE state IN ('PENDING', 'CLAIMED');
CREATE INDEX idx_scheduled_reassessments_runnable ON scheduled_reassessments (next_run_at) WHERE state = 'PENDING';
CREATE INDEX idx_scheduled_reassessments_leased ON scheduled_reassessments (lease_expires_at) WHERE state = 'CLAIMED';

-- Latest (unsuperseded) assessments reading an input whose value just changed.
CREATE FUNCTION m6_enqueue_reassessment_for_input(p_workspace uuid, p_kind text, p_key text, p_revision bigint, p_generation bigint) RETURNS void AS $$
BEGIN
  INSERT INTO scheduled_reassessments (workspace_id, subject_kind, subject_id, assessment_kind, reason, cause_assessment_id, cause_input_key)
  SELECT DISTINCT ON (a.subject_kind, a.subject_id, a.kind) a.workspace_id, a.subject_kind, a.subject_id, a.kind, 'INPUT_CHANGED', a.id, p_kind || '|' || p_key
    FROM assessment_inputs i
    JOIN assessments a ON a.workspace_id = i.workspace_id AND a.id = i.assessment_id
   WHERE i.workspace_id = p_workspace AND i.input_kind = p_kind AND i.input_key = p_key
     AND ((p_kind = 'AGGREGATE' AND i.revision IS DISTINCT FROM p_revision) OR (p_kind = 'SCOPE' AND i.generation IS DISTINCT FROM p_generation))
     AND NOT EXISTS (SELECT 1 FROM assessments s WHERE s.workspace_id = a.workspace_id AND s.supersedes_assessment_id = a.id)
   ORDER BY a.subject_kind, a.subject_id, a.kind, a.evaluated_at DESC
  ON CONFLICT (workspace_id, subject_kind, subject_id, assessment_kind) WHERE state IN ('PENDING', 'CLAIMED') DO NOTHING;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION m6_aggregate_head_changed() RETURNS trigger AS $$
DECLARE
  v_kind text;
BEGIN
  SELECT kind INTO v_kind FROM domain_subjects WHERE workspace_id = NEW.workspace_id AND id = NEW.aggregate_id;
  IF v_kind IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.revision IS DISTINCT FROM NEW.revision) THEN
    PERFORM m6_enqueue_reassessment_for_input(NEW.workspace_id, 'AGGREGATE', v_kind || ':' || NEW.aggregate_id::text, NEW.revision, NULL);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER m6_reassess_on_head AFTER UPDATE ON aggregate_heads FOR EACH ROW EXECUTE FUNCTION m6_aggregate_head_changed();

CREATE FUNCTION m6_scope_generation_changed() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.generation IS DISTINCT FROM NEW.generation THEN
    PERFORM m6_enqueue_reassessment_for_input(NEW.workspace_id, 'SCOPE', NEW.scope_kind || ':' || NEW.scope_id, NULL, NEW.generation);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER m6_reassess_on_scope AFTER INSERT OR UPDATE ON scope_generations FOR EACH ROW EXECUTE FUNCTION m6_scope_generation_changed();
