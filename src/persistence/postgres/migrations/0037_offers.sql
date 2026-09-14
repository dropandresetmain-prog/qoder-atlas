-- offer_eligibility" / closure §4.3: an Offer is an immutable quote observation
-- — exact price/currency/terms, eligibility context, source, expiry. "Never edit
-- an old quote into a booking" is structural: UPDATE and DELETE are forbidden,
-- and a stale/expired offer cannot silently become an executable price because
-- currentness is always derived (offer_is_current) and eligibility is an
-- explicit row, never bare Trip membership.
--
-- Offer is a root subject (quoted availability can be superseded by a new quote,
-- never corrected in place).
--
-- `price_amount numeric` stores the exact decimal string from ExactMoney; reads
-- round-trip through text so no float ever touches a consequential value.

CREATE TABLE offers (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  -- The account/org the quote was issued to (commercial context).
  account_organisation_id uuid,
  source_id text NOT NULL,
  price_amount numeric NOT NULL,
  price_currency text NOT NULL CHECK (price_currency ~ '^[A-Z]{3}$'),
  terms jsonb,
  quoted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  -- Content fingerprint over the eligible context: an equal fingerprint is the
  -- same quote, a different one is a different quote even for the same product.
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT offers_account_fk
    FOREIGN KEY (workspace_id, account_organisation_id)
    REFERENCES organisations (workspace_id, id),
  CONSTRAINT offers_terms_shape CHECK (
    terms IS NULL OR (jsonb_typeof(terms) = 'object' AND pg_column_size(terms) <= 8192)
  ),
  CONSTRAINT offers_expiry_after_quote CHECK (expires_at > quoted_at),
  CONSTRAINT offers_price_not_negative CHECK (price_amount >= 0)
);

CREATE INDEX idx_offers_expires ON offers (workspace_id, expires_at);
CREATE INDEX idx_offers_source ON offers (workspace_id, source_id);
CREATE INDEX idx_offers_account ON offers (workspace_id, account_organisation_id)
  WHERE account_organisation_id IS NOT NULL;

-- Immutable: capture a new quote instead of editing one.
CREATE TRIGGER offers_immutable
  BEFORE UPDATE OR DELETE ON offers
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE offer_items (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  offer_id uuid NOT NULL,
  product_type text NOT NULL CHECK (product_type IN ('TRANSPORT', 'STAY', 'RESOURCE_USE')),
  transport_service_id uuid,
  resource_id uuid,
  stay_interval_start timestamptz,
  stay_interval_end timestamptz,
  place_id uuid,
  item_amount numeric NOT NULL,
  item_currency text NOT NULL CHECK (item_currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT offer_items_offer_fk
    FOREIGN KEY (workspace_id, offer_id) REFERENCES offers (workspace_id, id),
  -- A transport quote references a concrete observed service occurrence; a stay
  -- or resource quote references the resource/place it prices.
  CONSTRAINT offer_items_product_reference CHECK (
    (product_type = 'TRANSPORT' AND transport_service_id IS NOT NULL)
    OR (product_type = 'STAY' AND (resource_id IS NOT NULL OR place_id IS NOT NULL))
    OR (product_type = 'RESOURCE_USE' AND resource_id IS NOT NULL)
  ),
  CONSTRAINT offer_items_stay_interval_shape CHECK (
    (stay_interval_start IS NULL AND stay_interval_end IS NULL)
    OR (stay_interval_start IS NOT NULL AND stay_interval_end IS NOT NULL
        AND stay_interval_end > stay_interval_start)
  ),
  CONSTRAINT offer_items_transport_service_fk
    FOREIGN KEY (workspace_id, transport_service_id)
    REFERENCES transport_services (workspace_id, id),
  CONSTRAINT offer_items_resource_fk
    FOREIGN KEY (workspace_id, resource_id) REFERENCES resources (workspace_id, id),
  CONSTRAINT offer_items_amount_not_negative CHECK (item_amount >= 0)
);

CREATE INDEX idx_offer_items_offer ON offer_items (workspace_id, offer_id);
CREATE INDEX idx_offer_items_service ON offer_items (workspace_id, transport_service_id)
  WHERE transport_service_id IS NOT NULL;

-- Eligibility is an explicit fact with an owner: private/negotiated availability
-- depends on THIS row (optionally tied to an agreement scope), never on a party
-- merely being in a Trip. An offer with no eligibility row is public within the
-- workspace; an eligible_party_id or agreement_scope_id narrows it.
CREATE TABLE offer_eligibility (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  offer_id uuid NOT NULL,
  eligible_traveller_id uuid,
  eligible_organisation_id uuid,
  agreement_scope_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT offer_eligibility_offer_fk
    FOREIGN KEY (workspace_id, offer_id) REFERENCES offers (workspace_id, id),
  CONSTRAINT offer_eligibility_traveller_fk
    FOREIGN KEY (workspace_id, eligible_traveller_id) REFERENCES travellers (workspace_id, id),
  CONSTRAINT offer_eligibility_organisation_fk
    FOREIGN KEY (workspace_id, eligible_organisation_id)
    REFERENCES organisations (workspace_id, id),
  -- At least one narrowing criterion; an all-null row would make "eligible to
  -- everyone" expressible as an accident.
  CONSTRAINT offer_eligibility_names_a_constraint CHECK (
    eligible_traveller_id IS NOT NULL
    OR eligible_organisation_id IS NOT NULL
    OR agreement_scope_id IS NOT NULL
  )
);

CREATE INDEX idx_offer_eligibility_offer ON offer_eligibility (workspace_id, offer_id);
CREATE INDEX idx_offer_eligibility_traveller ON offer_eligibility (workspace_id, eligible_traveller_id)
  WHERE eligible_traveller_id IS NOT NULL;
CREATE INDEX idx_offer_eligibility_organisation
  ON offer_eligibility (workspace_id, eligible_organisation_id)
  WHERE eligible_organisation_id IS NOT NULL;

CREATE FUNCTION enforce_subject_subtype_offer(
  p_workspace_id uuid,
  p_id uuid,
  p_kind text,
  p_aggregate_id uuid
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_aggregate_id <> p_id THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: OFFER subject % must be its own aggregate root (aggregate_id=%)',
      p_id, p_aggregate_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM offers o WHERE o.workspace_id = p_workspace_id AND o.id = p_id
  ) THEN
    RAISE EXCEPTION
      'domain_subjects subtype violation: OFFER subject % has no offers row',
      p_id;
  END IF;
END;
$$;

INSERT INTO subject_subtype_checkers (kind, checker_function, installed_by) VALUES
  ('OFFER', 'enforce_subject_subtype_offer', 'M3');

