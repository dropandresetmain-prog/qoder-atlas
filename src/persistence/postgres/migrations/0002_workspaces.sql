-- DATA_STRUCTURE_LOGICAL_SCHEMA.md §2: workspaces is the security partition,
-- not a business transaction aggregate, but M1 exercises it as its own
-- reference command-handler aggregate (see docs/work/ACTIVE_TASK.md decision
-- #2) so CAS/idempotency/concurrency proofs do not require an M2-M5 table.
CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  operational_status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (operational_status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
