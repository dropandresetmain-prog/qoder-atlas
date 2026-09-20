-- Durable, bounded reasons why an accepted desired-state field could not be
-- evaluated by the current planner. These are operator-facing decision facts,
-- not tool evidence and not a fabricated current-world failure.
ALTER TABLE recovery_planning_attempts
  ADD COLUMN request_issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD CONSTRAINT recovery_planning_attempts_request_issues_shape_chk CHECK (
    jsonb_typeof(request_issues) = 'array' AND pg_column_size(request_issues) <= 65536
  );
