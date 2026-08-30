# Project File Map

Frozen at **Checkpoint A** (F0–F3). This is the authoritative path reference for all
downstream lanes. The matching ownership/collision matrix lives in
`docs/IMPLEMENTATION_PLAN.md` Section 6.

## Stack

TypeScript end-to-end on Node.js >= 24, single package (no workspaces, no services).
Runtime validation with Zod at external/model boundaries. SQLite via Node's built-in
`node:sqlite` behind repository interfaces. Node built-in test runner and type
stripping (sources run directly; `tsc` emits `dist/` for build/start).

## Baseline commands

| Command | Purpose |
|---|---|
| `npm install` | Install dependencies |
| `npm test` | Node test runner over `test/**/*.test.ts` |
| `npm run typecheck` | `tsc -p tsconfig.json` (no emit) |
| `npm run lint` | ESLint flat config |
| `npm run build` | `tsc -p tsconfig.build.json` -> `dist/` |
| `npm run dev` | Run `src/main.ts` directly (type stripping) |
| `npm start` | Run compiled `dist/main.js` |

## Directory map

```
package.json / tsconfig*.json / eslint.config.js   Foundation tooling
.env.example                                       Frozen config variable names
docs/architecture/PROJECT_FILE_MAP.md              This file

src/
  main.ts                       App entrypoint (foundation/lead; integrator extends)
  config/
    config.ts                   Env/config loader, AdapterMode LIVE|RECORD|REPLAY (foundation)
  util/
    ids.ts                      Generic ID helper (foundation)
  domain/                       F1 executable domain contracts (FROZEN after Checkpoint A)
    common.ts                   EntityId, timestamps, provenance/source refs, Fact<T>
    preferences.ts              Preference precedence model (explicit > latent)
    entities.ts                 Organisation, Traveller, AnchorEvent, Place
    elements.ts                 TripElement: TransportLeg | Stay | Engagement (+ dimensions)
    trip.ts                     Trip aggregate, objectives, relations
    rules.ts                    RuleSet/Policy + generic PolicyRule union
    constraints.ts              Constraint model (PASS/FAIL/UNKNOWN)
  operational/                  F1 operational contracts (FROZEN after Checkpoint A)
    signal.ts                   TripSignal (normalized incoming change)
    mutation.ts                 MutationProposal + bounded operation vocabulary
    snapshot.ts                 TripSnapshot (planner-safe aggregate view)
    impact.ts                   ImpactAssessment (blast radius)
    case.ts                     RecoveryCase state machine + resolution outcomes
    strategy.ts                 RecoveryStrategy (overlay candidates, no side effects)
    intent.ts                   ActionIntent + AuthorityDecision + ExecutionResult
  contracts/                    F2 shared seams (FROZEN after Checkpoint A)
    repositories.ts             Trip/Case/Source/Audit repository interfaces
    capabilities.ts             Flight/Routing/Hotel/Research/SourceIngestion interfaces
    envelope.ts                 CapabilityResult success/error envelope + AdapterMode
    services.ts                 Application service boundaries (mutation, impact,
                                viability, authority, execution, observation)
    planner.ts                  RecoveryPlanner input/output (no executable side effects)
    readmodels.ts               Operator/traveller read models (no graph internals)
  persistence/
    database.ts                 SQLite open/migrate skeleton (lane A1 evolves)
  server/
    http.ts                     node:http server skeleton (integrator/lane E extends)
  scenarios/                    F3 scenario contracts (FROZEN after Checkpoint A)
    spec.ts                     ScenarioSpec schema + referential-integrity check
    loader.ts                   scenario.json loader/validation errors

  # Created by downstream lanes (do not exist yet):
  ingest/                       Lane B: source/provenance + extraction pipeline
  providers/                    Lane C: provider base + Atlas + Google Routes adapters
  intelligence/                 Lane D: Model Studio client + RecoveryPlanner impl
  engine/                       Lane A: mutation/constraints/overlays/case/authority impl
  ui/                           Lane E: operator/traveller surfaces consuming read models
  app/                          Integrator: orchestration wiring of the seams above

test/
  foundation.test.ts            F0 smoke (SQLite round trip, config, server startup)
  domain.test.ts                F1 T-DOM: entity/operational contract proofs
  contracts.test.ts             F2 seam/envelope/read-model/planner contract proofs
  scenarios.test.ts             F3: Scenario A + B load through identical contracts

fixtures/
  scenarios/
    anchor-event-speaker/       Scenario A (AnchorEvent / invited speaker)
      scenario.json             Full ScenarioSpec bundle
      sources/                  Source documents (webpage text, policy, insurance...)
    corporate-tmc/              Scenario B (corporate / TMC-style traveller)
      scenario.json
      sources/
  recordings/                   (later) sanitized provider-shaped recordings, lane C

docs/architecture/              This map + future architecture diagrams
recordings/                     Runtime recording store (gitignored except curated fixtures)
data/                           Local SQLite/runtime data (gitignored)
```

## Frozen contracts (Checkpoint A)

After Checkpoint A acceptance, changes to these paths are lead/integrator-owned
cross-lane changes (see IMPLEMENTATION_PLAN.md §2.1):

- `src/domain/**`
- `src/operational/**`
- `src/contracts/**`
- `src/scenarios/**` (ScenarioSpec contract)
- `fixtures/scenarios/*/scenario.json` semantics (lead owns; lanes may add scoped data)
- `.env.example` variable names

## Ownership quick reference

| Path | Primary owner | Notes |
|---|---|---|
| `src/domain/**`, `src/operational/**`, `src/contracts/**`, `src/scenarios/**` | Foundation/lead | Frozen; lanes import only |
| `src/config/**`, `src/util/**`, `src/server/**`, `src/main.ts` | Foundation/integrator | Lanes extend via integrator |
| `src/persistence/**` | Lane A | Foundation provided skeleton + DDL |
| `src/ingest/**` | Lane B | Must not mutate Trip directly |
| `src/providers/**` | Lane C | Provider-specific code lives only here |
| `src/intelligence/**` | Lane D | Never mutates state or approves/executes |
| `src/engine/**` | Lane A | Deterministic engine implementation |
| `src/ui/**` | Lane E | Consumes `contracts/readmodels.ts` only |
| `src/app/**` | Integrator | Orchestration wiring |
| `fixtures/**` | Lead (semantics) | Lanes add scoped data only |
| `test/**` | Package owner | Scoped per lane; contract tests lead-owned |
| `docs/**` | Lead/integrator | SSOT updates only |
