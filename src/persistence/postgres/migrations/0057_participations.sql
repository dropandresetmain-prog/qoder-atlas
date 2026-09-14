-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §5 / F07: Participation links a Traveller
-- to a ProgrammeItem without copying programme truth (no window/place columns
-- here — those stay owned by `programme_items`). "No Journey required" (M4
-- brief §D): `traveller_id` is the only person FK, so a local, non-travelling
-- participant is representable without inventing a Trip/Journey for them.
--
-- Like ProgrammeItem, a Participation is a child of the *Programme* aggregate
-- (not a root of its own) — mutating acceptance/attendance/roles advances the
-- owning Programme's revision, the same "one canonical owner" rule §5 states
-- for programme_items.

CREATE TABLE participations (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  programme_item_id uuid NOT NULL,
  traveller_id uuid NOT NULL,
  obligation text NOT NULL CHECK (obligation IN ('REQUIRED', 'OPTIONAL', 'INFORMED')),
  preparation_window_start timestamptz,
  preparation_window_end timestamptz,
  release_window_start timestamptz,
  release_window_end timestamptz,
  accepted boolean NOT NULL DEFAULT false,
  attended boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT participations_programme_item_fk
    FOREIGN KEY (workspace_id, programme_item_id) REFERENCES programme_items (workspace_id, id),
  CONSTRAINT participations_traveller_fk
    FOREIGN KEY (workspace_id, traveller_id) REFERENCES travellers (workspace_id, id),
  CONSTRAINT participations_preparation_window_shape CHECK (
    (preparation_window_start IS NULL AND preparation_window_end IS NULL)
    OR (preparation_window_start IS NOT NULL AND preparation_window_end IS NOT NULL
        AND preparation_window_end > preparation_window_start)
  ),
  CONSTRAINT participations_release_window_shape CHECK (
    (release_window_start IS NULL AND release_window_end IS NULL)
    OR (release_window_start IS NOT NULL AND release_window_end IS NOT NULL
        AND release_window_end > release_window_start)
  )
);

-- §5 "Unique item+Traveller. At most one authoritative association" — a second
-- Participation row for the same person on the same item is a constraint
-- violation, not a design option (multiple roles use participation_roles below).
CREATE UNIQUE INDEX participations_item_traveller_uidx
  ON participations (workspace_id, programme_item_id, traveller_id);
CREATE INDEX idx_participations_traveller ON participations (workspace_id, traveller_id);
CREATE INDEX idx_participations_item ON participations (workspace_id, programme_item_id);

CREATE TABLE participation_roles (
  workspace_id uuid NOT NULL,
  participation_id uuid NOT NULL,
  role text NOT NULL CHECK (role <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, participation_id, role),
  CONSTRAINT participation_roles_participation_fk
    FOREIGN KEY (workspace_id, participation_id) REFERENCES participations (workspace_id, id)
);

CREATE INDEX idx_participation_roles_role ON participation_roles (workspace_id, role);

-- PARTICIPATION's owning aggregate is its ProgrammeItem's Programme, resolved
-- by join (Participation itself carries no programme_id column — programme_item_id
-- is the single source of that fact, matching §5's "no second editable truth").
CREATE FUNCTION enforce_subject_subtype_participation(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_programme_id uuid;
BEGIN
  SELECT pi.programme_id INTO v_programme_id
    FROM participations p
    JOIN programme_items pi ON pi.workspace_id = p.workspace_id AND pi.id = p.programme_item_id
   WHERE p.workspace_id = p_workspace_id AND p.id = p_id;
  IF v_programme_id IS NULL THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: PARTICIPATION subject % has no participations row',
      p_id;
  END IF;
  IF v_programme_id <> p_aggregate_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: PARTICIPATION subject % belongs to programme % not aggregate %',
      p_id, v_programme_id, p_aggregate_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('PARTICIPATION', 'enforce_subject_subtype_participation', 'M4');
