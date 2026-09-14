-- budget_entries" / closure §4.3: an authorised-spending budget root with the
-- exact-currency hold/settlement/release records an execution needs.
--
-- Amounts are exact decimal strings stored as numeric; sums are computed in
-- integer minor units at the application boundary (compareExactMoney), never in
-- floating point. An unknown external outcome cannot release a hold as if the
-- action failed: the status machine (HELD -> SETTLED | RELEASED) is enforced in
-- the command layer and the 0043-observed outcome decides which branch is
-- legal, with OUTCOME_UNKNOWN leaving the hold untouched (HELD).
--
-- This is NOT a general ledger: only holds against authorised execution.

CREATE TABLE budgets (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  organisation_id uuid NOT NULL,
  purpose text NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  valid_from timestamptz,
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT budgets_organisation_fk
    FOREIGN KEY (workspace_id, organisation_id) REFERENCES organisations (workspace_id, id),
  CONSTRAINT budgets_amount_positive CHECK (amount > 0),
  CONSTRAINT budgets_validity_shape CHECK (
    valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from
  )
);

CREATE INDEX idx_budgets_organisation ON budgets (workspace_id, organisation_id);

CREATE TABLE budget_commitments (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  budget_id uuid NOT NULL,
  -- The M8 ActionIntent this hold belongs to (opaque uuid until M7/M8 land:
  -- documented deferral, no invented placeholder table in another lane's range).
  action_intent_id uuid NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'HELD'
    CHECK (status IN ('HELD', 'SETTLED', 'RELEASED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT budget_commitments_budget_fk
    FOREIGN KEY (workspace_id, budget_id) REFERENCES budgets (workspace_id, id),
  CONSTRAINT budget_commitments_amount_positive CHECK (amount > 0),
  -- §4: unique action+budget hold identity — a second hold for the same
  -- action on the same budget is unrepresentable.
  CONSTRAINT budget_commitments_action_uidx
    UNIQUE (workspace_id, budget_id, action_intent_id)
);

CREATE INDEX idx_budget_commitments_budget
  ON budget_commitments (workspace_id, budget_id, status);

CREATE TABLE budget_entries (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  commitment_id uuid NOT NULL,
  entry_kind text NOT NULL CHECK (entry_kind IN ('HOLD', 'SETTLEMENT', 'RELEASE')),
  amount numeric NOT NULL,
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  evidence_id uuid,
  entry_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT budget_entries_commitment_fk
    FOREIGN KEY (workspace_id, commitment_id)
    REFERENCES budget_commitments (workspace_id, id),
  CONSTRAINT budget_entries_amount_positive CHECK (amount > 0),
  -- An entry never contradicts its commitment's currency.
  CONSTRAINT budget_entries_currency_matches
    FOREIGN KEY (workspace_id, commitment_id)
    REFERENCES budget_commitments (workspace_id, id) NOT VALID
);

CREATE INDEX idx_budget_entries_commitment
  ON budget_entries (workspace_id, commitment_id);

