# Building the original Northstar candidate with Qoder

This document is a **historical workflow record** for the original Atlas × Alibaba Cloud hackathon build. Qoder was the primary implementation environment for that phase.

It is **not** the current model/harness routing source of truth for the production-oriented data/state refactor. For current execution use:

- [`AGENT_MODEL_SELECTION.md`](AGENT_MODEL_SELECTION.md)
- [`IMPLEMENTATION_AGENT_ROUTING.md`](IMPLEMENTATION_AGENT_ROUTING.md)
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md)

The engineering principles below still apply regardless of harness.

## Architecture first

Before parallel work, the project froze shared schemas/provider contracts, wrote acceptance criteria, identified dependencies/collision risks and split only safely independent lanes. Primary reasoning retained architecture, integration, high-risk changes and final verification. Smaller bounded tasks covered research, contained implementation, audits and repetitive evidence gathering.

The refactor follows the same principle at a stricter production boundary: F01-F18 are the approved architecture, M0 materialises executable contracts, and parallel domain lanes do not become safe until the contract/persistence gates pass.

## Long-horizon reliability

For substantial work, `docs/work/ACTIVE_TASK.md` is a temporary working-memory file containing the objective, branch/base SHA, acceptance checklist, checkpoint, next action and critical constraints.

Re-read it before major phases, after context compaction or delegated work and before completion. A checkbox closes only with test/inspection evidence. Keep full logs on disk and summarise pass/fail evidence compactly.

## Bounded delegation and triage

Delegated agents should return finding, affected files, recommended action and evidence. They do not own cross-file architecture, destructive decisions or final validation.

Every issue is classified:

- **Act Now**
- **Investigate Now**
- **Park for Later**
- **Ignore / Accept Risk**

This prevents agent-generated scope expansion while making accepted risks explicit.

## Provider workflow

Northstar keeps fake behaviour at external boundaries only:

```text
LIVE:   provider call -> normalization -> Northstar
RECORD: provider call -> sanitized provider-shaped recording -> normalization -> Northstar
REPLAY: recording -> normalization -> Northstar
```

The same normalization/recovery semantics should be used in every mode. This supports reproducible verification without replacing internal state, viability or authority logic with fixtures.

## Safety boundary

AI may interpret, extract, identify uncertainty and propose strategies. Deterministic code validates schemas/business rules, evaluates viability, enforces authority, executes approved actions, observes outcomes and updates state.

The non-negotiable rule remains:

**No LLM directly invokes irreversible or money-moving actions.**

## What changed after the original build

The current refactor deliberately changes several architectural decisions from the submitted candidate while retaining the useful recovery/safety logic:

- target persistence moves from SQLite document-style aggregates to PostgreSQL/PostGIS relational ownership;
- Trip becomes the shared undertaking and Journey the per-traveller travel state;
- supplier services/reservations, programme state, credentials/entry information and external advisories/conditions gain explicit target ownership;
- assessments become derived immutable results rather than editable current-world viability truth;
- execution gains stronger idempotency/attempt/reconciliation semantics;
- model/harness routing is now role/risk/harness based rather than Qoder-first.

See the architecture closure and implementation plan for normative details.
