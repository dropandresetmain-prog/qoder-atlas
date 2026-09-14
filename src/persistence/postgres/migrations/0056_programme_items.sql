-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §5 / F07: ProgrammeItem is the actual
-- scheduled activity with a stable identity, owned by its Programme
-- aggregate — like `journey_items` under `journeys` (0022), it gets a
-- `domain_subjects` row with `aggregate_id` pointing at the owning Programme
-- and NO `aggregate_heads` row of its own, so a schedule/place move advances
-- exactly one revision counter: the Programme's.
--
-- `schedule_authority` is the M4-added field on the frozen `ProgrammeItemSchema`
-- (src/domain/v2/programmes/programme.ts, additive per CONTRACTS.md §7) that
-- carries M4 brief §F: INTERNAL admits deterministic command-driven mutation;
-- EXTERNAL means the command layer refuses a direct rewrite and only an
-- accepted observation (0059) may record what happened — NORTHSTAR is not
-- treated as controlling a schedule it does not own.

CREATE TABLE programme_items (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  programme_id uuid NOT NULL,
  title text NOT NULL CHECK (title <> ''),
  item_type text NOT NULL CHECK (item_type <> ''),
  place_id uuid,
  window_start timestamptz,
  window_end timestamptz,
  time_zone text,
  lifecycle_status text NOT NULL DEFAULT 'DRAFT'
    CHECK (lifecycle_status IN ('DRAFT', 'SCHEDULED', 'COMPLETED', 'CANCELLED')),
  -- §10 bounded opaque payload: operating-requirement detail nothing reverse-looks-up.
  operating_requirements jsonb,
  schedule_authority text NOT NULL DEFAULT 'INTERNAL' CHECK (schedule_authority IN ('INTERNAL', 'EXTERNAL')),
  external_source_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT programme_items_programme_fk
    FOREIGN KEY (workspace_id, programme_id) REFERENCES programmes (workspace_id, id),
  CONSTRAINT programme_items_place_fk
    FOREIGN KEY (workspace_id, place_id) REFERENCES places (workspace_id, id),
  CONSTRAINT programme_items_window_shape CHECK (
    (window_start IS NULL AND window_end IS NULL)
    OR (window_start IS NOT NULL AND window_end IS NOT NULL AND window_end > window_start)
  ),
  -- §5 "Valid schedule when scheduled": SCHEDULED without a window is not a
  -- convention violation the application can silently tolerate.
  CONSTRAINT programme_items_scheduled_requires_window CHECK (
    lifecycle_status <> 'SCHEDULED' OR window_start IS NOT NULL
  ),
  CONSTRAINT programme_items_external_ref_requires_external CHECK (
    external_source_ref IS NULL OR schedule_authority = 'EXTERNAL'
  ),
  CONSTRAINT programme_items_operating_requirements_shape CHECK (
    operating_requirements IS NULL OR (jsonb_typeof(operating_requirements) = 'object'
                                        AND pg_column_size(operating_requirements) <= 8192)
  )
);

CREATE INDEX idx_programme_items_programme ON programme_items (workspace_id, programme_id, lifecycle_status);
CREATE INDEX idx_programme_items_place ON programme_items (workspace_id, place_id) WHERE place_id IS NOT NULL;
CREATE INDEX idx_programme_items_window ON programme_items (workspace_id, window_start, window_end)
  WHERE window_start IS NOT NULL;

CREATE FUNCTION enforce_subject_subtype_programme_item(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM programme_items pi
     WHERE pi.workspace_id = p_workspace_id AND pi.id = p_id AND pi.programme_id = p_aggregate_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: PROGRAMME_ITEM subject % has no programme_items row under aggregate %',
      p_id, p_aggregate_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('PROGRAMME_ITEM', 'enforce_subject_subtype_programme_item', 'M4');
