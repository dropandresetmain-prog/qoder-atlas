-- M8 (0109): authority decisions, approval requirements, approvals, revocations.
-- Approvals bind to an exact envelope fingerprint — never a case-wide reusable grant.
--
-- Integration-owner amendments (M7/M8/C3 integration; see
-- docs/work/M7_M8_INTEGRATION_ACTIVE_TASK.md §3):
--  - M8's provisional 0100/0101 recovery_cases/action_plans/action_intents
--    tables are dropped; M7's canonical 0100/0102 are the base. This
--    migration amends them additively (resolution_kind, plan/version
--    uniqueness) instead of recreating them.
--  - action_intents has no independent per-row version (immutable, one row
--    per identity — a superseding proposal gets a new SubjectId, never a
--    version bump in place). AuthorityDecisionSchema/AuthorityEnvelopeSchema
--    (frozen) still require actionIntentVersion for envelope-fingerprint
--    symmetry with actionPlanVersion; it is always 1 for a real intent.

-- ActionIntent's currentness basis lives one layer up, on
-- recovery_strategies/strategy_changes.basis_assessment_id (M7, planning
-- time) — M8's original action_intents.basis_assessment_id column was
-- unread by assessmentGate.ts/decisionGates.ts and is not recreated here.

ALTER TABLE recovery_cases
  ADD COLUMN resolution_kind text
    CHECK (resolution_kind IS NULL OR resolution_kind IN (
      'RECOVERED', 'RECOVERED_WITH_LOSS', 'UNRESOLVED', 'CANCELLED'
    ));

INSERT INTO recovery_case_lifecycles (status) VALUES ('SUPERSEDED');

-- Nothing today stops two plans in the same case sharing a plan_version.
CREATE UNIQUE INDEX action_plans_case_version_uidx
  ON action_plans (workspace_id, recovery_case_id, plan_version);

CREATE TABLE authority_decisions (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  action_plan_id uuid NOT NULL,
  action_plan_version integer NOT NULL CHECK (action_plan_version >= 1),
  action_intent_id uuid NOT NULL,
  -- Always 1 — ActionIntent has no independent version (see file header).
  action_intent_version integer NOT NULL DEFAULT 1 CHECK (action_intent_version = 1),
  group_operator text NOT NULL CHECK (group_operator IN ('AND', 'OR')),
  envelope_fingerprint text NOT NULL CHECK (length(btrim(envelope_fingerprint)) > 0),
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'array' AND pg_column_size(scope) <= 8192),
  limits jsonb CHECK (limits IS NULL OR (jsonb_typeof(limits) = 'object' AND pg_column_size(limits) <= 8192)),
  grant_refs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(grant_refs) = 'array' AND pg_column_size(grant_refs) <= 8192),
  rule_inputs jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(rule_inputs) = 'array' AND pg_column_size(rule_inputs) <= 8192),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT authority_decisions_plan_fk
    FOREIGN KEY (workspace_id, action_plan_id) REFERENCES action_plans (workspace_id, id),
  CONSTRAINT authority_decisions_intent_fk
    FOREIGN KEY (workspace_id, action_intent_id) REFERENCES action_intents (workspace_id, id),
  CONSTRAINT authority_decisions_expiry CHECK (expires_at IS NULL OR expires_at > issued_at)
);

CREATE INDEX idx_authority_decisions_intent
  ON authority_decisions (workspace_id, action_intent_id, action_intent_version);

CREATE TABLE approval_requirements (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  decision_id uuid NOT NULL,
  actor_role text NOT NULL CHECK (length(btrim(actor_role)) > 0),
  required_party_kind text,
  required_party_id uuid,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT approval_requirements_decision_fk
    FOREIGN KEY (workspace_id, decision_id) REFERENCES authority_decisions (workspace_id, id),
  CONSTRAINT approval_requirements_party_shape CHECK (
    (required_party_kind IS NULL AND required_party_id IS NULL)
    OR (required_party_kind IS NOT NULL AND required_party_id IS NOT NULL)
  ),
  CONSTRAINT approval_requirements_party_fk
    FOREIGN KEY (workspace_id, required_party_id, required_party_kind)
    REFERENCES domain_subjects (workspace_id, id, kind)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_approval_requirements_decision
  ON approval_requirements (workspace_id, decision_id);

CREATE TABLE approvals (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  requirement_id uuid NOT NULL,
  decision_id uuid NOT NULL,
  approver_principal_id uuid NOT NULL,
  envelope_fingerprint text NOT NULL CHECK (length(btrim(envelope_fingerprint)) > 0),
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'array' AND pg_column_size(scope) <= 8192),
  amount_limit_amount numeric,
  amount_limit_currency text CHECK (amount_limit_currency IS NULL OR amount_limit_currency ~ '^[A-Z]{3}$'),
  evidence_id uuid,
  approved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT approvals_requirement_fk
    FOREIGN KEY (workspace_id, requirement_id) REFERENCES approval_requirements (workspace_id, id),
  CONSTRAINT approvals_decision_fk
    FOREIGN KEY (workspace_id, decision_id) REFERENCES authority_decisions (workspace_id, id),
  CONSTRAINT approvals_principal_fk
    FOREIGN KEY (workspace_id, approver_principal_id) REFERENCES principals (workspace_id, id),
  CONSTRAINT approvals_amount_shape CHECK (
    (amount_limit_amount IS NULL AND amount_limit_currency IS NULL)
    OR (amount_limit_amount IS NOT NULL AND amount_limit_currency IS NOT NULL AND amount_limit_amount > 0)
  ),
  -- One live approval per requirement+fingerprint (revocation is a separate row).
  CONSTRAINT approvals_requirement_fingerprint_uidx UNIQUE (workspace_id, requirement_id, envelope_fingerprint)
);

CREATE INDEX idx_approvals_decision ON approvals (workspace_id, decision_id);

CREATE TABLE approval_revocations (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  approval_id uuid NOT NULL,
  revoked_at timestamptz NOT NULL,
  revoked_by_principal_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT approval_revocations_approval_fk
    FOREIGN KEY (workspace_id, approval_id) REFERENCES approvals (workspace_id, id),
  CONSTRAINT approval_revocations_principal_fk
    FOREIGN KEY (workspace_id, revoked_by_principal_id) REFERENCES principals (workspace_id, id),
  CONSTRAINT approval_revocations_once UNIQUE (workspace_id, approval_id)
);

CREATE FUNCTION enforce_subject_subtype_authority_decision(
  p_workspace_id uuid, p_id uuid, p_kind text, p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION 'domain_subjects subtype violation: AUTHORITY_DECISION % must be its own aggregate', p_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM authority_decisions WHERE workspace_id = p_workspace_id AND id = p_id) THEN
    RAISE EXCEPTION 'domain_subjects subtype violation: AUTHORITY_DECISION % missing row', p_id;
  END IF;
END;
$$;

CREATE FUNCTION enforce_subject_subtype_approval(
  p_workspace_id uuid, p_id uuid, p_kind text, p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_decision uuid;
BEGIN
  SELECT decision_id INTO v_decision FROM approvals WHERE workspace_id = p_workspace_id AND id = p_id;
  IF v_decision IS NULL THEN
    RAISE EXCEPTION 'domain_subjects subtype violation: APPROVAL % missing row', p_id;
  END IF;
  IF p_aggregate_id <> v_decision THEN
    RAISE EXCEPTION 'domain_subjects subtype violation: APPROVAL % aggregate must be decision %', p_id, v_decision;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('AUTHORITY_DECISION', 'enforce_subject_subtype_authority_decision', 'M8'),
  ('APPROVAL', 'enforce_subject_subtype_approval', 'M8');
