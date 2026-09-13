-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §8/§11.2: scope insertion/coverage
-- generation counters. A matching new member/rule/publication increments a
-- scope's generation even when no previously read row changed. Advanced at
-- SERIALIZABLE isolation with bounded retry (pgScopeGenerationLedger.ts) to
-- demonstrate predicate-conflict detection required by M1 acceptance.

-- Mirrors src/domain/v2/shared/identity.ts ScopeKindSchema at the C0 freeze.
CREATE TABLE scope_kinds (
  kind text PRIMARY KEY
);

INSERT INTO scope_kinds (kind) VALUES
  ('WORKSPACE'), ('TRIP'), ('JOURNEY'), ('COORDINATION_GROUP'), ('PROGRAMME'),
  ('ORGANISATION_RULES'), ('ORGANISATION_GRANTS'), ('GEOGRAPHY'), ('INFORMATION_TOPIC');

CREATE TABLE scope_generations (
  workspace_id uuid NOT NULL REFERENCES workspaces (id),
  scope_kind text NOT NULL REFERENCES scope_kinds (kind),
  scope_id text NOT NULL,
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, scope_kind, scope_id)
);
