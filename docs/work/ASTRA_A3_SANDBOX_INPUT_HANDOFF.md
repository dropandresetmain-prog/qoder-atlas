# A3 synthetic sandbox execution-input handoff

This lane is intentionally opt-in and is not wired into PostgreSQL boot or demo reset.
The caller supplies a strict JSON file and must set both `ATLAS_ENV=sandbox` and
`NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS=1`. The CLI also requires
`NORTHSTAR_SANDBOX_INPUTS_FILE`, `PG_TARGET_WORKSPACE_ID`, `PG_TARGET_ACTOR_ID`, and
`NORTHSTAR_SANDBOX_INPUT_CONNECTION_ID`.

## Files to register in the root suite manifest

| Suite | File |
| --- | --- |
| `current` | `test/a3-sandbox-execution-inputs.test.ts` |
| `postgresFast` or `postgres` | `postgres-integration/a3SandboxExecutionInputs.pgtest.ts` |

Focused checks used by this lane:

```text
node --experimental-strip-types --test test/a3-sandbox-execution-inputs.test.ts
node --experimental-strip-types --test postgres-integration/a3SandboxExecutionInputs.pgtest.ts
node C:/Dev/qoder-atlas/node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

The provisioner resolves `SOURCE_TRAVELLER_DRAFT:*` and `SOURCE_ORGANISATION:*`
through the existing external identity links, preflights all identities and budgets,
then calls `recordTravellerBookingIdentity` and `createBudget`. Existing exact rows
are reused; conflicting rows, unknown or ambiguous mappings, malformed/duplicate input,
and non-sandbox invocation fail before writes.
