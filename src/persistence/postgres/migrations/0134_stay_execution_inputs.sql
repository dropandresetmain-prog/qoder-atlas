-- Immutable provider inputs for approved stay BOOK / CANCEL actions.
-- BOOK requires quoted terms + proposed Journey item; CANCEL requires displaced
-- line/item identity + maximum-loss evidence. Never updated in place.
CREATE TABLE stay_execution_bindings (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  id uuid NOT NULL,
  recovery_case_id uuid,
  recovery_strategy_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('BOOK', 'CANCEL')),
  journey_id uuid NOT NULL,
  offer_key text,
  provider_id text NOT NULL,
  provider_connection_id uuid,
  provider_property_id text,
  provider_rate_id text,
  quote_handle text,
  workflow_state jsonb,
  stay_window jsonb,
  place_id uuid,
  order_key text,
  required_nights integer,
  quoted_amount numeric,
  quoted_currency text CHECK (quoted_currency IS NULL OR quoted_currency ~ '^[A-Z]{3}$'),
  quote_observed_at timestamptz,
  research_mode text CHECK (research_mode IS NULL OR research_mode IN ('LIVE', 'RECORD', 'REPLAY', 'SIMULATED')),
  journey_item_id uuid,
  reservation_line_id uuid,
  stay_element_id text,
  cancellation_maximum_loss_amount numeric,
  cancellation_maximum_loss_currency text CHECK (
    cancellation_maximum_loss_currency IS NULL OR cancellation_maximum_loss_currency ~ '^[A-Z]{3}$'
  ),
  approved_visit jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT stay_execution_bindings_identity_uidx UNIQUE NULLS NOT DISTINCT (
    workspace_id, recovery_strategy_id, action, offer_key, journey_item_id, reservation_line_id
  ),
  CHECK (
    (
      action = 'BOOK'
      AND offer_key IS NOT NULL
      AND quote_handle IS NOT NULL
      AND stay_window IS NOT NULL
      AND place_id IS NOT NULL
      AND quoted_amount IS NOT NULL
      AND quoted_currency IS NOT NULL
      AND journey_item_id IS NOT NULL
    )
    OR (
      action = 'CANCEL'
      AND journey_item_id IS NOT NULL
      AND reservation_line_id IS NOT NULL
      AND stay_element_id IS NOT NULL
      AND cancellation_maximum_loss_amount IS NOT NULL
      AND cancellation_maximum_loss_currency IS NOT NULL
    )
  )
);

CREATE TRIGGER stay_execution_bindings_immutable
  BEFORE UPDATE OR DELETE ON stay_execution_bindings
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
