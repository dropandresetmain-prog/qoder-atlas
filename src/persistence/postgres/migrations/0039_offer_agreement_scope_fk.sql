-- M3 deferred closure: 0037 creates offer_eligibility before 0038 creates
-- agreement_scopes. A private offer must cite an agreement scope in the same
-- workspace; otherwise the reference is only a nullable UUID and can point at
-- another tenant or a non-existent scope. This is the one real missing M3
-- migration identified from the authoritative schema relationship.

ALTER TABLE offer_eligibility
  ADD CONSTRAINT offer_eligibility_agreement_scope_fk
  FOREIGN KEY (workspace_id, agreement_scope_id)
  REFERENCES agreement_scopes (workspace_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX idx_offer_eligibility_agreement_scope
  ON offer_eligibility (workspace_id, agreement_scope_id)
  WHERE agreement_scope_id IS NOT NULL;
