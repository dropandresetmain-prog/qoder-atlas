-- R2 (0127): recovery_case_graph_snapshots — the ONE immutable ORIGINAL focused
-- Case graph semantic snapshot per RecoveryCase.
--
-- WHY (product truth): the Case Graph offers Original <-> Current. CURRENT is
-- always projected from authoritative PostgreSQL state and never reads this
-- table. ORIGINAL is the first truthful focused graph of the case, frozen once,
-- so the operator can always compare "what broke" against "what is true now".
--
-- This is case-owned presentation/history evidence. It is NOT canonical trip
-- truth, NOT an assessment, NOT planning evidence, NOT provider truth, and never
-- feeds reassessment or planning. There is deliberately NO snapshot_kind other
-- than ORIGINAL, no CURRENT rows and no timeline: exactly one row per case.
--
-- The payload is the SEMANTIC graph (typed application schema, validated at the
-- application boundary and size-bounded here): never HTML/SVG/layout/camera.
--
-- Immutability: rows are insert-once (PK enforces one Original per case;
-- capture is INSERT ... ON CONFLICT DO NOTHING) and any UPDATE/DELETE is refused.

CREATE TABLE recovery_case_graph_snapshots (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  recovery_case_id uuid NOT NULL,
  snapshot_kind text NOT NULL CHECK (snapshot_kind = 'ORIGINAL'),
  schema_version integer NOT NULL CHECK (schema_version >= 1),
  basis_assessment_id uuid,
  snapshot jsonb NOT NULL,
  captured_at timestamptz NOT NULL,
  created_by_actor_id text NOT NULL CHECK (length(btrim(created_by_actor_id)) > 0),
  PRIMARY KEY (workspace_id, recovery_case_id, snapshot_kind),
  CONSTRAINT recovery_case_graph_snapshots_case_fk
    FOREIGN KEY (workspace_id, recovery_case_id) REFERENCES recovery_cases (workspace_id, id),
  CONSTRAINT recovery_case_graph_snapshots_basis_fk
    FOREIGN KEY (workspace_id, basis_assessment_id) REFERENCES assessments (workspace_id, id),
  CONSTRAINT recovery_case_graph_snapshots_snapshot_shape CHECK (
    jsonb_typeof(snapshot) = 'object' AND pg_column_size(snapshot) <= 262144
  )
);

CREATE FUNCTION recovery_case_graph_snapshots_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'recovery_case_graph_snapshots is immutable; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recovery_case_graph_snapshots_guard
  BEFORE UPDATE OR DELETE ON recovery_case_graph_snapshots
  FOR EACH ROW EXECUTE FUNCTION recovery_case_graph_snapshots_guard();

-- The case read model presents the Original, so the case's own revision source
-- must move when it is captured (same EVALUATION_LIFECYCLE scope as 0122/0123/
-- 0126; never read by assessment_inputs, so it cannot feed reassessment).
CREATE TRIGGER fig3_bump_on_case_graph_snapshot
  AFTER INSERT ON recovery_case_graph_snapshots
  FOR EACH ROW EXECUTE FUNCTION fig3_bump_case_from_direct_case_id();
