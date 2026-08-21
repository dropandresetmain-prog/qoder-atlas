# Verification Rule

Apply before declaring implementation work complete.

1. Run all relevant automated tests.
2. Run build, typecheck and lint commands where configured.
3. Test at least one failure/fallback path for changed external integrations.
4. Check for scenario-specific hardcoding in domain/recovery logic.
5. Confirm LIVE and REPLAY use the same normalization/downstream path where applicable.
6. Confirm malformed AI output cannot bypass schema/business validation.
7. Confirm consequential actions cannot bypass deterministic authority/execution gates.
8. Confirm no secrets, credentials or unsafe raw personal/provider data are committed.
9. Update `docs/ROADMAP.md` when implementation/scope status changes.
10. Add a decision to `docs/DECISIONS.md` when changing a significant architectural invariant.
11. Classify every newly discovered issue as Act Now, Investigate Now, Park for Later, or Ignore / Accept Risk.
12. Stage only exact intended file paths; never hide unrelated changes in a milestone commit.
