-- coupons/segments a right consists of; line links tie consumption rights to
-- reservation lines; person links name who may exercise the right. Exchange
-- lineage is preserved at component and link level so an old ticket is never
-- overwritten into a new one.

CREATE TABLE entitlement_components (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  id uuid NOT NULL,
  entitlement_id uuid NOT NULL,
  component_type text NOT NULL,
  component_status text NOT NULL
    CHECK (component_status IN ('ISSUED', 'ACTIVE', 'USED', 'EXCHANGED', 'VOID', 'REVOKED', 'UNKNOWN')),
  -- Exchange/successor identity at component granularity.
  exchanged_from_component_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT entitlement_components_entitlement_fk
    FOREIGN KEY (workspace_id, entitlement_id)
    REFERENCES service_entitlements (workspace_id, id),
  CONSTRAINT entitlement_components_exchange_fk
    FOREIGN KEY (workspace_id, exchanged_from_component_id)
    REFERENCES entitlement_components (workspace_id, id),
  CONSTRAINT entitlement_components_exchange_not_self CHECK (
    exchanged_from_component_id IS NULL OR exchanged_from_component_id <> id
  ),
  -- Referable target for 0036's "component belongs to this entitlement"
  -- composite FK from entitlement_line_links.
  CONSTRAINT entitlement_components_id_entitlement_uidx
    UNIQUE (workspace_id, id, entitlement_id)
);

CREATE INDEX idx_entitlement_components_entitlement
  ON entitlement_components (workspace_id, entitlement_id);

-- Which reservation lines does this right cover (and through them, which
-- service/resource) — the reverse link §9 asks for when a line changes.
CREATE TABLE entitlement_line_links (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  entitlement_id uuid NOT NULL,
  line_id uuid NOT NULL,
  -- Optional component granularity: a coupon may cover only part of a line.
  component_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT entitlement_line_links_entitlement_fk
    FOREIGN KEY (workspace_id, entitlement_id)
    REFERENCES service_entitlements (workspace_id, id),
  CONSTRAINT entitlement_line_links_line_fk
    FOREIGN KEY (workspace_id, line_id)
    REFERENCES reservation_lines (workspace_id, id),
  CONSTRAINT entitlement_line_links_component_fk
    FOREIGN KEY (workspace_id, component_id)
    REFERENCES entitlement_components (workspace_id, id),
  CONSTRAINT entitlement_line_links_component_of_entitlement
    FOREIGN KEY (workspace_id, component_id, entitlement_id)
    REFERENCES entitlement_components (workspace_id, id, entitlement_id),
  CONSTRAINT entitlement_line_links_equivalent_uidx
    UNIQUE (workspace_id, entitlement_id, line_id, component_id)
);

CREATE INDEX idx_entitlement_line_links_line
  ON entitlement_line_links (workspace_id, line_id);

-- Who may exercise this right. A right with no person link covers whoever the
-- reservation allocates; a person link narrows it explicitly.
CREATE TABLE entitlement_person_links (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  entitlement_id uuid NOT NULL,
  traveller_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_actor_id text NOT NULL,
  PRIMARY KEY (workspace_id, id),
  CONSTRAINT entitlement_person_links_entitlement_fk
    FOREIGN KEY (workspace_id, entitlement_id)
    REFERENCES service_entitlements (workspace_id, id),
  CONSTRAINT entitlement_person_links_traveller_fk
    FOREIGN KEY (workspace_id, traveller_id) REFERENCES travellers (workspace_id, id),
  CONSTRAINT entitlement_person_links_equivalent_uidx
    UNIQUE (workspace_id, entitlement_id, traveller_id)
);

CREATE INDEX idx_entitlement_person_links_traveller
  ON entitlement_person_links (workspace_id, traveller_id);
