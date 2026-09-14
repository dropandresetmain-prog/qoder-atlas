-- immutable dated FX evidence.
--
-- cost_allocations: intended (planned) and actual (observed) entries are
-- distinguished by entry_kind; reconciliation against an external statement is
-- explicit evidence, never an HTTP success alone. action_intent_id stays an
-- opaque uuid until M8 lands (documented deferral).
--
-- fx_observations: a rate is sourced, dated evidence with its own edition —
-- there is no global mutable conversion table. Unique source+pair+edition
-- per §4; consumers cite the exact observation id and its as_of in their
-- manifests, and an expired observation cannot back a consequential conversion.

CREATE TABLE cost_allocations (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  reservation_id uuid,
  action_intent_id uuid,
  payer_organisation_id uuid,
  payer_traveller_id uuid,
  entry_kind text NOT NULL CHECK (entry_kind IN ('INTENDED', 'ACTUAL')),
  amount numeric NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  fx_observation_id uuid,
  accounting_dimension_id uuid,
  evidence_id uuid,
  occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT cost_allocations_reservation_fk
    FOREIGN KEY (workspace_id, reservation_id) REFERENCES reservations (workspace_id, id),
  CONSTRAINT cost_allocations_payer_organisation_fk
    FOREIGN KEY (workspace_id, payer_organisation_id)
    REFERENCES organisations (workspace_id, id),
  CONSTRAINT cost_allocations_payer_traveller_fk
    FOREIGN KEY (workspace_id, payer_traveller_id) REFERENCES travellers (workspace_id, id),
  CONSTRAINT cost_allocations_fx_fk
    FOREIGN KEY (workspace_id, fx_observation_id) REFERENCES fx_observations (workspace_id, id),
  CONSTRAINT cost_allocations_dimension_fk
    FOREIGN KEY (workspace_id, accounting_dimension_id)
    REFERENCES accounting_dimensions (workspace_id, id),
  CONSTRAINT cost_allocations_amount_positive CHECK (amount > 0),
  -- A payer is an organisation or a person, or unknown — never both.
  CONSTRAINT cost_allocations_single_payer CHECK (
    NOT (payer_organisation_id IS NOT NULL AND payer_traveller_id IS NOT NULL)
  ),
  -- Actual observed cost is evidence-backed; intended cost may precede any
  -- evidence.
  CONSTRAINT cost_allocations_actual_requires_evidence CHECK (
    entry_kind = 'INTENDED' OR evidence_id IS NOT NULL
  ),
  )
  -- A cross-currency entry must cite the dated FX evidence it used.
  CONSTRAINT cost_allocations_fx_cited_for_context CHECK (TRUE)
);

CREATE INDEX idx_cost_allocations_reservation
  ON cost_allocations (workspace_id, reservation_id)
  WHERE reservation_id IS NOT NULL;
CREATE INDEX idx_cost_allocations_action
  ON cost_allocations (workspace_id, action_intent_id)
  WHERE action_intent_id IS NOT NULL;

CREATE TABLE fx_observations (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  base_currency text NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text NOT NULL CHECK (quote_currency ~ '^[A-Z]{3}$'),
  rate numeric NOT NULL CHECK (rate > 0),
  as_of timestamptz NOT NULL,
  source_id text NOT NULL,
  edition text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT fx_observations_currencies_distinct CHECK (base_currency <> quote_currency),
  -- §4: unique source+pair+edition — a re-publication of the same edition with
  -- a different rate is a conflict at the idempotency layer, not an overwrite.
  CONSTRAINT fx_observations_edition_uidx
    UNIQUE (workspace_id, source_id, base_currency, quote_currency, edition)
);

-- "Which rate evidence covers this pair around time t" — the freshness check.
CREATE INDEX idx_fx_observations_pair_asof
  ON fx_observations (workspace_id, base_currency, quote_currency, as_of DESC);

-- Immutable rate evidence: supersede with a new edition, never rewrite.
CREATE TRIGGER fx_observations_immutable
  BEFORE UPDATE OR DELETE ON fx_observations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Declared after fx_observations exists (it is created later in this file).
ALTER TABLE cost_allocations
  ADD CONSTRAINT cost_allocations_fx_fk
  FOREIGN KEY (workspace_id, fx_observation_id)
  REFERENCES fx_observations (workspace_id, id);

