-- A2 (0131): bounded operational provenance for optional model activity during
-- recovery planning. The record intentionally excludes prompts, raw output,
-- rationale and private reasoning; it only establishes whether the composed
-- model call completed and which configured provider/model/mode produced it.
ALTER TABLE recovery_planning_attempts
  ADD COLUMN model_activities jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(model_activities) = 'array'
    AND pg_column_size(model_activities) <= 16384
  );
