-- A5 CP3 / FIX3: workspace-scoped evaluation clock.
--
-- Semantic scenario/evaluation time is distinct from real observation,
-- provider, and audit timestamps. Default mode is WALL (consume wall clock).
-- CONTROLLED mode supplies one authoritative controlled_now for reassessment,
-- case lifecycle, recovery progression, and planning basis. Operational
-- receipts, provider observedAt, modelActivities.observedAt, and
-- completionClock remain wall-clock owned elsewhere.

CREATE TABLE workspace_evaluation_clocks (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces (id),
  mode text NOT NULL DEFAULT 'WALL'
    CHECK (mode IN ('WALL', 'CONTROLLED')),
  controlled_now timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_evaluation_clocks_controlled_now_ck CHECK (
    (mode = 'WALL')
    OR (mode = 'CONTROLLED' AND controlled_now IS NOT NULL)
  )
);
