# Building Northstar with Qoder

Northstar was built with a disciplined agentic-development workflow, not by allowing
an agent to freely modify a product surface. Qoder was the primary implementation
environment; models were chosen by lane and risk rather than treated as autonomous
authors.

## Architecture first

Before parallel work, the project froze shared schemas and provider contracts, wrote
acceptance criteria, identified dependencies/collision risks, and split only safely
independent lanes. Primary reasoning retained architecture, integration, high-risk
changes and final verification. Smaller bounded tasks covered research, contained
implementation, audits and repetitive evidence gathering.

## Long-horizon reliability

For substantial work, `docs/work/ACTIVE_TASK.md` was a temporary working-memory file
containing the objective, branch/base SHA, acceptance checklist, checkpoint, next
action and critical constraints. It is reread before major phases, after context
compaction or delegated work, before deletion, and before declaring completion.

The central rule is simple: **code written is not task complete**. A checkbox closes
only with test or inspection evidence. The file is intentionally excluded from the
final public repository.

## Bounded delegation and triage

Delegated agents report a finding, affected files, recommendation and evidence. They
do not own cross-file architecture, destructive decisions or final validation. Each
issue is classified as **Act Now**, **Investigate Now**, **Park for Later**, or
**Ignore / Accept Risk**. This prevents agent-generated scope expansion while making
accepted risks explicit.

## Provider workflow

Northstar keeps fake behaviour at external boundaries only:

```text
LIVE:   provider call → normalization → Northstar
RECORD: provider call → sanitized provider-shaped recording → normalization → Northstar
REPLAY: recording → normalization → Northstar
```

The same normalisation and recovery engine are used in every mode. This produces
reproducible tests and credential-free demonstrations without replacing internal
state, viability or authority logic with fixtures.

## Safety boundary

AI may interpret, extract, identify uncertainty and propose strategies. Deterministic
code validates schemas and business rules, evaluates viability, enforces authority,
executes approved actions, observes outcomes and updates state. The non-negotiable
rule is: **no LLM directly invokes irreversible or money-moving actions.**
