<div align="center">

# Northstar

**An AI travel resolution engine.**

*A booking gets you a ticket. Northstar gets you there.*

[Quickstart](#quickstart) · [How it works](#how-it-works) · [Capability truth](docs/CAPABILITIES_AND_LIMITATIONS.md) · [Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md)

</div>

---

## The problem

A booking can be repaired while the **trip is still broken**.

A disruption can affect flights, hotels, ground transport, programme commitments,
traveller objectives, shared resources, entry context, policies, approvals and other
travellers. A replacement flight is therefore not necessarily a recovered trip.

Northstar maintains live operational state, evaluates the consequences of change, plans
whole-trip recovery, checks deterministic viability and authority, executes only permitted
actions, observes what actually happened and continues until the trip is valid or
explicitly escalated.

## How it works

```mermaid
flowchart LR
  C["Change / new information"] --> S["Canonical state"]
  S --> P["Affected scope + reassessment"]
  P --> RC["RecoveryCase"]
  RC --> R["Recovery strategies"]
  R --> V["Deterministic viability"]
  V --> A["Authority / approval"]
  A --> E["Execution"]
  E --> O["Observation / reconciliation"]
  O --> S
```

The consequential-action boundary is non-negotiable:

```text
proposal -> schema validation -> deterministic viability -> authority
         -> executor -> observation -> canonical state update
```

No LLM directly invokes an irreversible or money-moving API.

## Current architecture

**PostgreSQL + PostGIS is the sole normal Northstar runtime.**

SQLite is retired from normal application operation. It remains only as offline,
read-only migration input plus historical code/test evidence.

The accepted F01-F18 data/state architecture is implemented through M10/C5. A later
operational-runtime audit closed the missing runtime composition through R0/T3/T4/B1.

The current generalized internal recovery path is:

```text
ChangeSignal
-> canonical mutation
-> targeted invalidation
-> deterministic reassessment
-> escalation / RecoveryCase
-> StrategyProposer
-> counterfactual viability
-> ActionPlan
-> authority / approval
-> durable internal execution
-> observation
-> canonical update
-> reassessment
-> resolution
```

B1 is proven on the real AiT/Sarah world at
`82ae9b80f62a26d8b7e8e6277aa5bf6183ff44f0`.

See:

- [Architecture](docs/ARCHITECTURE.md)
- [Architecture closure](docs/DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md)
- [Logical schema](docs/DATA_STRUCTURE_LOGICAL_SCHEMA.md)
- [Current implementation plan §22](docs/IMPLEMENTATION_PLAN.md)
- [Capabilities and limitations](docs/CAPABILITIES_AND_LIMITATIONS.md)

## Current delivery status

Next product gate:

**Founder B1 physical acceptance**

Then:

`B2 generalized external recovery / Jordan
-> Founder + generalisation verification
-> post-E2E observability / accepted Event Overview / provider hardening
-> M11 / C6 candidate`.

Jordan is not a second hardcoded runtime. It is the materially different proof that the
same lifecycle works with external-provider recovery.

See [Roadmap](docs/ROADMAP.md).

## Counterfactual recovery semantics

The dependency closure answers who must be reassessed. It is not a requirement that every
reached subject become perfect.

A viable recovery must:

- heal the blocking case subjects it is responsible for;
- introduce no regression to reached subjects;
- introduce no new/action-critical UNKNOWN;
- satisfy explicit required unknowns.

Unchanged unrelated pre-existing FAIL/UNKNOWN remains truthful but does not automatically
veto the candidate or become falsely healed.

Provider/API success alone never means recovered. Case resolution still requires
reconciled execution and fresh passing assessment of the required case subjects.

## Where AI sits

AI is used for messy interpretation, schema extraction, uncertainty detection, soft
preference inference, semantic consequence judgement, research and strategy proposal.

Deterministic code owns validation, authoritative mutation, arithmetic/timezone,
dependency/applicability propagation, policy thresholds, authority, state transitions,
viability, execution validation and reconciliation.

AI output is proposal/evidence transformation, never final provider truth or execution
authority.

## Quickstart

Requires Node.js 24+, PostgreSQL/PostGIS and the target runtime environment.

```bash
npm install
npm run db:postgres:up
npm run dev
```

Put a stable `PG_TARGET_WORKSPACE_ID` and `NORTHSTAR_DEMO_DATASET_DIR` in `.env.local`
(see `.env.example`). Open `http://localhost:8787`.

For daily development, **reuse the same workspace ID**. A new workspace intentionally
re-materializes the full AiT world and reruns the baseline, which can add about a minute
to startup. Use a fresh UUID only when you explicitly need a clean independent world.

See [Environment](docs/ENVIRONMENT.md) for target/demo variable loading.

## Verify

Use the manifest-backed commands; do not run raw `node --test` as the canonical gate.

```bash
npm test                         # boundary + CURRENT_TARGET
npm run test:postgres            # full PostgreSQL integration checkpoint gate
npm run test:migration           # migration boundary
npm run typecheck
npm run lint
npm run gate:anti-hardcoding
```

The full PostgreSQL gate is intentionally heavy (~21 minutes on the B1 code line) and is
not a debugging loop. Use focused tests first.

See [Testing](docs/TESTING.md).

## Provider boundaries

| Area | Current boundary |
|---|---|
| AI | Alibaba Cloud Model Studio/Qwen-capable proposal/extraction boundary; deterministic gates remain authoritative. |
| Flights | Atlas LIVE/RECORD/REPLAY adapter seams; B2 will compose external recovery through the normal lifecycle. |
| Hotels | Nuitée/liteAPI search/quote/book/retrieve/cancel provider seams. |
| Ground context | Google Routes optional routing context, no booking action. |
| FX | Frankfurter/ECB-reference comparison evidence, not payment FX. |
| Deployment | Railway hosting; readiness semantics still need final-candidate hardening. |

Provider adapters are not the architecture.

## Scenario proofs

The repository contains eight frozen scenario narratives in
[SCENARIOS.md](docs/SCENARIOS.md). Demo facts live in data/fixtures/config, never in
domain/application branches.

Current critical proofs:

- **Sarah** — generalized internal programme recovery after a provider-shaped disruption.
- **Jordan** — planned B2 materially different external-provider recovery through the same
  engine.

The broader acceptance corpus covers families/groups, shared bookings, programme changes,
entry/advisory context, provider failure, concurrency and extensibility.

## Repository map

```text
src/domain, src/resolution       typed domain + deterministic evaluation/planning
src/persistence/postgres        sole normal runtime persistence
src/app, src/server, src/ui     product/runtime composition and surfaces
src/providers                   provider adapters and LIVE/RECORD/REPLAY seams
src/intelligence                schema-bound model integration
fixtures/, data/                scenario/source/demo facts
postgres-integration/           current PostgreSQL integration/acceptance tests
docs/                           architecture, current plan, evidence and handoffs
```

## Documentation

Start at [docs/README.md](docs/README.md).

The main sources are:

- [Architecture](docs/ARCHITECTURE.md)
- [Capabilities and limitations](docs/CAPABILITIES_AND_LIMITATIONS.md)
- [Roadmap](docs/ROADMAP.md)
- [Implementation plan §22](docs/IMPLEMENTATION_PLAN.md)
- [Testing](docs/TESTING.md)
- [Environment](docs/ENVIRONMENT.md)
- [Agent model selection](docs/AGENT_MODEL_SELECTION.md)

---

Originally built for the **Atlas × Alibaba Cloud Agentic AI Hackathon**. The current code
preserves that generalized recovery thesis while using the accepted PostgreSQL operational
model and deterministic safety boundaries.
