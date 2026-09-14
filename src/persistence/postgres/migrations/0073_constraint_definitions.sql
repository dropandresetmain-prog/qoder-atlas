-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §6: `constraint_definitions` /
-- `constraint_operands` / `dependencies`.
--
-- A ConstraintDefinition is a typed REQUIREMENT (registered type, hardness,
-- operands, provenance). It owns no evaluation status: "Definition does not own
-- evaluation status" is structural here — there is no PASS/FAIL/UNKNOWN column
-- and cannot be one without a migration, because the schema CHECK vocabulary
-- below simply has no such value. Assessment results are M6's `assessments`.
--
-- M2's accompaniment tables (0027/0028) remain the support-requirement truth;
-- a later integration registration maps that registered type onto this
-- generic surface (recorded in docs/refactor/evidence/M5.md), and no second
-- support-status column is created here.
--
-- Operands are rows, not a JSON bag (§10): either a typed subject reference or
-- a bounded scalar — every shape the frozen contract's `operands` record can
-- legally carry.

CREATE TABLE constraint_definitions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  -- Registered evaluator type (F16); M6 owns the registry this key indexes.
  registered_type text NOT NULL CHECK (registered_type ~ '^[a-z][a-z0-9_]*$'),
  hardness text NOT NULL CHECK (hardness IN ('HARD', 'SOFT')),
  owner_kind text NOT NULL REFERENCES subject_kinds (kind),
  owner_id uuid NOT NULL,
  -- Bounded parameter schema version for the registered type (§10 "validate
  -- schema, size and version at every boundary").
  parameter_schema_version text NOT NULL CHECK (length(btrim(parameter_schema_version)) > 0),
  parameter_schema jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(parameter_schema) = 'object'),
  provenance_evidence_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT constraint_definitions_owner_fk
    FOREIGN KEY (workspace_id, owner_id, owner_kind)
    REFERENCES domain_subjects (workspace_id, id, kind),
  CONSTRAINT constraint_definitions_provenance_fk
    FOREIGN KEY (workspace_id, provenance_evidence_id)
    REFERENCES evidence_records (workspace_id, id),
  CONSTRAINT constraint_definitions_parameter_schema_size CHECK (pg_column_size(parameter_schema) <= 8192)
);

CREATE INDEX idx_constraint_definitions_owner
  ON constraint_definitions (workspace_id, owner_kind, owner_id);
CREATE INDEX idx_constraint_definitions_type
  ON constraint_definitions (workspace_id, registered_type);
CREATE INDEX idx_constraint_definitions_provenance
  ON constraint_definitions (workspace_id, provenance_evidence_id)
  WHERE provenance_evidence_id IS NOT NULL;

CREATE TABLE constraint_operands (
  workspace_id uuid NOT NULL,
  constraint_definition_id uuid NOT NULL,
  operand_key text NOT NULL CHECK (operand_key ~ '^[a-z][a-z0-9_]*$'),
  operand_kind text NOT NULL CHECK (operand_kind IN ('SUBJECT_REF', 'TEXT', 'NUMBER', 'BOOLEAN', 'INSTANT', 'LOCAL_DATE')),
  -- Exactly one value shape per operand_kind, enforced below.
  subject_kind text REFERENCES subject_kinds (kind),
  subject_id uuid,
  text_value text,
  number_value numeric,
  boolean_value boolean,
  instant_value timestamptz,
  local_date_value date,
  PRIMARY KEY (workspace_id, constraint_definition_id, operand_key),
  CONSTRAINT constraint_operands_definition_fk
    FOREIGN KEY (workspace_id, constraint_definition_id)
    REFERENCES constraint_definitions (workspace_id, id),
  CONSTRAINT constraint_operands_subject_fk
    FOREIGN KEY (workspace_id, subject_id, subject_kind)
    REFERENCES domain_subjects (workspace_id, id, kind),
  CONSTRAINT constraint_operands_shape CHECK (
    (operand_kind = 'SUBJECT_REF') = (subject_kind IS NOT NULL AND subject_id IS NOT NULL)
    AND (operand_kind = 'TEXT') = (text_value IS NOT NULL)
    AND (operand_kind = 'NUMBER') = (number_value IS NOT NULL)
    AND (operand_kind = 'BOOLEAN') = (boolean_value IS NOT NULL)
    AND (operand_kind = 'INSTANT') = (instant_value IS NOT NULL)
    AND (operand_kind = 'LOCAL_DATE') = (local_date_value IS NOT NULL)
  ),
  CONSTRAINT constraint_operands_text_size CHECK (
    text_value IS NULL OR length(text_value) <= 2048
  )
);

-- §6 "constraint operands by referenced subject": which requirements mention X.
CREATE INDEX idx_constraint_operands_subject
  ON constraint_operands (workspace_id, subject_kind, subject_id)
  WHERE subject_id IS NOT NULL;

-- §6 `dependencies`: "Explicit scoped association: from_subject, to_subject,
-- CONNECTS_TO or REQUIRES, constraint_id. Owner explicit. Unique semantic edge;
-- REQUIRES references executable predicate, not arbitrary text."
CREATE TABLE dependency_kinds (
  kind text PRIMARY KEY
);
INSERT INTO dependency_kinds (kind) VALUES ('CONNECTS_TO'), ('REQUIRES');

CREATE TABLE dependencies (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  from_subject_kind text NOT NULL REFERENCES subject_kinds (kind),
  from_subject_id uuid NOT NULL,
  to_subject_kind text NOT NULL REFERENCES subject_kinds (kind),
  to_subject_id uuid NOT NULL,
  dependency_kind text NOT NULL REFERENCES dependency_kinds (kind),
  constraint_definition_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT dependencies_from_fk
    FOREIGN KEY (workspace_id, from_subject_id, from_subject_kind)
    REFERENCES domain_subjects (workspace_id, id, kind),
  CONSTRAINT dependencies_to_fk
    FOREIGN KEY (workspace_id, to_subject_id, to_subject_kind)
    REFERENCES domain_subjects (workspace_id, id, kind),
  CONSTRAINT dependencies_constraint_fk
    FOREIGN KEY (workspace_id, constraint_definition_id)
    REFERENCES constraint_definitions (workspace_id, id),
  -- A semantic edge is unique; a duplicate intent is a second edge row that
  -- cannot exist.
  CONSTRAINT dependencies_unique_edge UNIQUE (
    workspace_id, from_subject_kind, from_subject_id, to_subject_kind, to_subject_id, dependency_kind
  ),
  CONSTRAINT dependencies_not_self CHECK (
    from_subject_kind <> to_subject_kind OR from_subject_id <> to_subject_id
  ),
  CONSTRAINT dependencies_requires_names_constraint CHECK (
    dependency_kind <> 'REQUIRES' OR constraint_definition_id IS NOT NULL
  )
);

CREATE INDEX idx_dependencies_from ON dependencies (workspace_id, from_subject_kind, from_subject_id);
CREATE INDEX idx_dependencies_to ON dependencies (workspace_id, to_subject_kind, to_subject_id);
CREATE INDEX idx_dependencies_constraint
  ON dependencies (workspace_id, constraint_definition_id)
  WHERE constraint_definition_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Subtype checker for CONSTRAINT_DEFINITION (0010 extension contract).
-- ---------------------------------------------------------------------------
CREATE FUNCTION enforce_subject_subtype_constraint_definition(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: CONSTRAINT_DEFINITION subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM constraint_definitions c
     WHERE c.workspace_id = p_workspace_id AND c.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: CONSTRAINT_DEFINITION subject % has no constraint_definitions row', p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('CONSTRAINT_DEFINITION', 'enforce_subject_subtype_constraint_definition', 'M5');
