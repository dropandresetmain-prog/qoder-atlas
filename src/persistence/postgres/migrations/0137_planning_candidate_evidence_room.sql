-- A full programme time-swap search keeps later viable swaps. Their decision
-- evidence is one jsonb array on the planning attempt. The original 256 KiB
-- cap rejected a real multi-candidate attempt before a recommendation could
-- be stored. One mebibyte still bounds the row; it is not an unbounded blob.

ALTER TABLE recovery_planning_attempts
  DROP CONSTRAINT recovery_planning_attempts_material_candidates_check;

ALTER TABLE recovery_planning_attempts
  ADD CONSTRAINT recovery_planning_attempts_material_candidates_check
  CHECK (
    jsonb_typeof(material_candidates) = 'array'
    AND pg_column_size(material_candidates) <= 1048576
  );
