-- accounting to organisational responsibility. This migration installs the
-- registered accounting-dimension namespaces (§4: "Unique
-- organisation+namespace+external key") as a typed vocabulary, mirroring the
-- closed action/role vocabularies M2 used for grant_actions and
-- responsibility_role_subject_kinds: an unregistered namespace is rejected, not
-- interpreted as wildcard.

CREATE TABLE accounting_namespaces (
  namespace text PRIMARY KEY
);

INSERT INTO accounting_namespaces (namespace) VALUES
  ('COST_CENTRE'), ('PROJECT'), ('DEPARTMENT'), ('TRIP_PURPOSE'), ('CLIENT'), ('OTHER');

-- Tighten the dimension namespace to the registered vocabulary. Existing rows
-- (none: 0044 just shipped) must satisfy it from the start.
ALTER TABLE accounting_dimensions
  ADD CONSTRAINT accounting_dimensions_namespace_registered
  FOREIGN KEY (namespace) REFERENCES accounting_namespaces (namespace);

