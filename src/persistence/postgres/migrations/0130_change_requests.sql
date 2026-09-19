-- A1 ChangeRequest activation. A request preserves a traveller's desired
-- state and source material; it is never provider/Journey state or fulfilment.

INSERT INTO authority_action_kinds (action_kind, installed_by)
VALUES ('change.request.submit', 'A1_CHANGE_REQUEST')
ON CONFLICT (action_kind) DO NOTHING;

CREATE TABLE change_requests (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  requester_principal_id uuid NOT NULL,
  represented_traveller_id uuid NOT NULL,
  journey_id uuid NOT NULL,
  lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('SUBMITTED', 'ACCEPTED_FOR_PLANNING', 'WITHDRAWN', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT change_requests_requester_fk
    FOREIGN KEY (workspace_id, requester_principal_id) REFERENCES principals (workspace_id, id),
  CONSTRAINT change_requests_represented_traveller_fk
    FOREIGN KEY (workspace_id, represented_traveller_id) REFERENCES travellers (workspace_id, id),
  CONSTRAINT change_requests_journey_fk
    FOREIGN KEY (workspace_id, journey_id) REFERENCES journeys (workspace_id, id)
);

CREATE INDEX idx_change_requests_journey ON change_requests (workspace_id, journey_id, lifecycle_status);
CREATE INDEX idx_change_requests_represented_traveller ON change_requests (workspace_id, represented_traveller_id, created_at DESC);

-- The typed schema is validated at the command boundary. This JSON document is
-- one immutable revision payload, not a generic fact bucket; relational target
-- refs below are the queryable, FK-validated UUID-bearing portions.
CREATE TABLE change_request_revisions (
  workspace_id uuid NOT NULL,
  change_request_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  intent_kind text NOT NULL CHECK (intent_kind IN ('ADJUST_TRIP_WINDOW', 'CHANGE_TRANSPORT_SCHEDULE', 'CHANGE_STAY', 'CANCEL_BOOKING', 'ADJUST_OBJECTIVE', 'OTHER')),
  urgency text NOT NULL CHECK (urgency IN ('HARD_INSTRUCTION', 'SOFT_PREFERENCE')),
  desired_target jsonb NOT NULL,
  funding_declaration text CHECK (funding_declaration IN ('EVENT_FUNDED', 'TRAVELLER_FUNDED', 'SPLIT', 'UNKNOWN')),
  source_utterance text NOT NULL CHECK (length(btrim(source_utterance)) > 0 AND length(source_utterance) <= 16384),
  source_record_id uuid NOT NULL,
  submitted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, change_request_id, revision),
  CONSTRAINT change_request_revisions_request_fk
    FOREIGN KEY (workspace_id, change_request_id) REFERENCES change_requests (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT change_request_revisions_source_fk
    FOREIGN KEY (workspace_id, source_record_id) REFERENCES source_records (workspace_id, id),
  CONSTRAINT change_request_revisions_target_shape CHECK (
    jsonb_typeof(desired_target) = 'object' AND pg_column_size(desired_target) <= 32768
  )
);

CREATE TABLE change_request_targets (
  workspace_id uuid NOT NULL,
  change_request_id uuid NOT NULL,
  request_revision integer NOT NULL,
  target_role text NOT NULL CHECK (target_role IN ('STAY_PROXIMITY_PLACE', 'STAY_PLACE', 'TRAVEL_WITH_TRAVELLER', 'OBJECTIVE_EFFECT')),
  target_kind text NOT NULL,
  target_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, change_request_id, request_revision, target_role, target_id),
  CONSTRAINT change_request_targets_revision_fk
    FOREIGN KEY (workspace_id, change_request_id, request_revision)
    REFERENCES change_request_revisions (workspace_id, change_request_id, revision) ON DELETE CASCADE,
  CONSTRAINT change_request_targets_subject_fk
    FOREIGN KEY (workspace_id, target_id, target_kind)
    REFERENCES domain_subjects (workspace_id, id, kind) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT change_request_targets_native_kind CHECK (
    (target_role IN ('STAY_PROXIMITY_PLACE', 'STAY_PLACE') AND target_kind = 'PLACE')
    OR (target_role = 'TRAVEL_WITH_TRAVELLER' AND target_kind = 'TRAVELLER')
    OR (target_role = 'OBJECTIVE_EFFECT' AND target_kind = 'OBJECTIVE')
  )
);

CREATE INDEX idx_change_request_targets_target ON change_request_targets (workspace_id, target_kind, target_id);

CREATE FUNCTION change_request_immutable_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is immutable; % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER change_request_revisions_immutable
  BEFORE UPDATE OR DELETE ON change_request_revisions
  FOR EACH ROW EXECUTE FUNCTION change_request_immutable_guard();

CREATE TRIGGER change_request_targets_immutable
  BEFORE UPDATE OR DELETE ON change_request_targets
  FOR EACH ROW EXECUTE FUNCTION change_request_immutable_guard();

CREATE FUNCTION enforce_subject_subtype_change_request(
  p_workspace_id uuid, p_id uuid, p_kind text, p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION 'domain_subjects subtype violation: CHANGE_REQUEST subject % must be its own aggregate root', p_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM change_requests r WHERE r.workspace_id = p_workspace_id AND r.id = p_id) THEN
    RAISE EXCEPTION 'domain_subjects subtype violation: CHANGE_REQUEST subject % has no change_requests row', p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by)
VALUES ('CHANGE_REQUEST', 'enforce_subject_subtype_change_request', 'A1_CHANGE_REQUEST')
ON CONFLICT (kind) DO UPDATE SET checker_function = EXCLUDED.checker_function, installed_by = EXCLUDED.installed_by;
