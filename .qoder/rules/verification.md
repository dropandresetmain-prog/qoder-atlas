# Verification Rule

Apply before claiming implementation, integration, review, or final-candidate work complete. Verification is cumulative evidence; do not rerun the entire repository gate after every small work package.

## Work-package implementation
1. Run the `T-*` categories assigned by `docs/IMPLEMENTATION_PLAN.md` for the changed behavior.
2. Run build/typecheck/lint only where the changed package or repository baseline makes them useful; do not run broad gates by ritual.
3. Test relevant failure/fallback behavior for changed external/model boundaries.
4. Confirm malformed AI/provider input cannot bypass schema/business validation.
5. Check that no scenario-specific domain/recovery branch was added.
6. Confirm no secrets or unsafe raw provider/personal data are committed.
7. Report exact commands/checks actually run and their results.

## Integration
1. Verify lane branch/head evidence before combining work.
2. Reuse valid lane evidence.
3. Test newly created seams, conflict resolutions, and the integrated vertical flow.
4. Confirm LIVE and REPLAY use the same normalization/downstream path where applicable.
5. Confirm consequential actions still pass deterministic authority/execution gates.

## Independent review
Independent review is not required for every package/checkpoint. Use it for material architecture changes, genuinely high-risk irreversible/security/persistence work, or the final candidate.

Classify every finding: `Act Now | Investigate Now | Park for Later | Ignore / Accept Risk`. A fix needs targeted closure evidence; do not automatically restart the entire review/test cycle.

## Final candidate
Run the canonical `T-RELEASE` gate from `docs/TESTING.md` on the exact candidate SHA.

For all stages:
- update `docs/ROADMAP.md` when scope/status changes;
- update `docs/IMPLEMENTATION_PLAN.md` tracker when execution status changes;
- add to `docs/DECISIONS.md` when a significant architecture invariant changes;
- use exact intended file staging; never hide unrelated changes in a checkpoint commit.
