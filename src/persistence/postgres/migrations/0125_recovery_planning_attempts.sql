-- R1 (0125): recovery_planning_attempts — the single immutable, bounded record
-- of one completed recovery planning basis (freeze C5 "MATERIAL DECISION
-- EVIDENCE", contracts src/contracts/v2/planning/recoveryPlanningAttempt.ts).
--
-- WHY THIS TABLE (product truth, not scaffolding):
--   A RecoveryPlanningAttempt is ONE immutable row per completed planning basis.
--   It is the durable decision-evidence artefact that lets NORTHSTAR show WHY a
--   recovery was recommended, which materially different candidates were
--   considered and rejected, and against which authoritative basis — without a
--   second engine and without persisting any model chain-of-thought.
--
--   HYBRID storage decision (C5):
--     * VIABLE executable alternatives remain proper `recovery_strategies` /
--       `strategy_changes` rows (0101). This table REFERENCES them by id inside
--       `viable_strategy_refs` and per-candidate `strategyRef`; it never
--       re-stores their scenario effects.
--     * MATERIAL considered-but-rejected candidates do NOT become
--       RecoveryStrategy rows. They are retained as bounded evidence inside the
--       `material_candidates` jsonb array here.
--     * low-value / duplicate / malformed intermediate candidates stay
--       ephemeral and are never written.
--
--   Every retained jsonb field is bounded and factual. NO reasoning transcript,
--   hidden scratchpad or raw provider wire payload is ever stored; `evidence`
--   summaries are short factual projections (<= 1024 chars, enforced by the
--   application schema, bounded again here by pg_column_size).
--
-- CLOUD NOTE: this migration is AUTHORED here. It is not executed in the Cloud
-- sandbox (no PostgreSQL/Docker). Applying it and running the pg integration
-- gate is a LOCAL acceptance step recorded in the R1 handoff ledger.

-- ---------------------------------------------------------------------------
-- 1. Closed outcome vocabulary (RecoveryPlanningOutcomeSchema, C1).
--    A lookup table so the column can never hold an out-of-contract value.
-- ---------------------------------------------------------------------------
CREATE TABLE recovery_planning_outcomes (outcome text PRIMARY KEY);
INSERT INTO recovery_planning_outcomes (outcome) VALUES
  ('AWAITING_AUTHORITY'),
  ('NEEDS_EVIDENCE_OR_DECISION'),
  ('NO_RECOVERY_FOUND'),
  ('STALE_RETRY_REQUIRED');

-- ---------------------------------------------------------------------------
-- 2. The attempt record.
-- ---------------------------------------------------------------------------
CREATE TABLE recovery_planning_attempts (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  recovery_case_id uuid NOT NULL,
  basis_assessment_id uuid NOT NULL,
  -- The authoritative world basis this attempt planned against (immutable
  -- WorldSnapshotManifest). Bounded like recovery_strategies.base_manifest.
  basis_manifest jsonb NOT NULL CHECK (
    jsonb_typeof(basis_manifest) = 'object' AND pg_column_size(basis_manifest) <= 262144
  ),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  coordinator_version text NOT NULL CHECK (
    length(btrim(coordinator_version)) > 0 AND length(coordinator_version) <= 128
  ),
  -- RecoveryDomainDecision[] — every registered domain recorded with its
  -- deterministic/AI disposition. Bounded; fail-closed content is application-
  -- enforced (RecoveryDomainDecisionSchema).
  domains jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(domains) = 'array' AND pg_column_size(domains) <= 65536
  ),
  -- PlanningEvidenceRecord[] — bounded factual evidence from dispatched
  -- READ-ONLY tools. Summaries are projections, never transcripts.
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(evidence) = 'array' AND pg_column_size(evidence) <= 131072
  ),
  -- MaterialCandidateEvidence[] — material considered candidates, including
  -- rejected ones, each with its decision-time impact projections. Viable
  -- promoted candidates carry a strategyRef into recovery_strategies.
  material_candidates jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(material_candidates) = 'array' AND pg_column_size(material_candidates) <= 262144
  ),
  -- SubjectId[] — viable strategies promoted to recovery_strategies rows during
  -- this attempt. Detail stays normalized in recovery_strategies/strategy_changes.
  viable_strategy_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(viable_strategy_refs) = 'array' AND pg_column_size(viable_strategy_refs) <= 16384
  ),
  -- StrategyRecommendation (C6), or NULL when the attempt produced no viable
  -- recommendation (a valid terminal result, never a silent pass).
  recommendation jsonb CHECK (
    recommendation IS NULL
    OR (jsonb_typeof(recommendation) = 'object' AND pg_column_size(recommendation) <= 65536)
  ),
  -- Denormalized terminal outcome from RecoveryPlanningResult (C1), written in
  -- the same immutable completion transaction so the lifecycle-progression
  -- service and case read models can query it without re-deriving. Closed
  -- vocabulary enforced by FK.
  outcome text NOT NULL REFERENCES recovery_planning_outcomes (outcome),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT recovery_planning_attempts_case_fk
    FOREIGN KEY (workspace_id, recovery_case_id) REFERENCES recovery_cases (workspace_id, id),
  CONSTRAINT recovery_planning_attempts_basis_fk
    FOREIGN KEY (workspace_id, basis_assessment_id) REFERENCES assessments (workspace_id, id),
  -- A completed attempt spans a non-empty, correctly ordered interval.
  CONSTRAINT recovery_planning_attempts_interval_chk CHECK (completed_at >= started_at)
);

-- One immutable completed attempt per (case, basis assessment). A replan runs
-- against a NEW basis assessment (M6 reassessment produces a new assessment id),
-- so this uniqueness never blocks legitimate continued recovery.
CREATE UNIQUE INDEX recovery_planning_attempts_case_basis_uidx
  ON recovery_planning_attempts (workspace_id, recovery_case_id, basis_assessment_id);

-- Read-model access: latest attempts for a case, and attempts by basis.
CREATE INDEX idx_recovery_planning_attempts_case
  ON recovery_planning_attempts (workspace_id, recovery_case_id, completed_at DESC);
CREATE INDEX idx_recovery_planning_attempts_basis
  ON recovery_planning_attempts (workspace_id, basis_assessment_id);

-- Immutable: a completed planning attempt is a durable historical fact. Any
-- correction is a NEW attempt against a NEW basis, never an edit.
CREATE TRIGGER recovery_planning_attempts_immutable
  BEFORE UPDATE OR DELETE ON recovery_planning_attempts
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
