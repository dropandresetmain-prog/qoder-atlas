# A3 Operator UI Candidate Bundle

Status: **UNVERIFIED A3 UI IMPLEMENTATION CANDIDATE**

This folder is a copy-only handoff bundle. The files are intentionally stored together here rather than wired into the active runtime on this branch.

## Provenance

- Active base: `integration/astra-post-r4` @ `415badfc6b23e1af7b9108d48566f43fc5c4bacb`
- Source candidate commit: `finish/a3-operator-ui-astra` @ `5daf700225524b09750abd8ee55f38502067d17c`
- A4 execution work is deliberately untouched.
- Browser/runtime acceptance is not claimed.

## Intended repository destinations

The paths under this bundle preserve each file's intended destination beneath the bundle root:

- `src/ui/screens/product-recovery-case.ts`
- `src/ui/caseDecisionPresentation.ts`
- `src/ui/operatorWorkspaceStyles.ts`
- `src/app/target/adapters/operatorOverviewAdapter.ts`
- `src/ui/screens/product-operator-overview.ts`
- `src/ui/overview-graph/camera.ts`
- `src/ui/overview-graph/controller.ts`
- `test/operator-ui-convergence.test.ts`
- `test/operator-ui-camera.test.ts`
- `test/suites.json`

A local implementation/verifier should copy or selectively apply these files into their intended repository paths, then run focused static checks and Chromium acceptance before A3 sign-off.
