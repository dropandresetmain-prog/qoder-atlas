# Architecture Rule

Apply this rule whenever editing domain, recovery, policy, provider abstraction or state-management code.

- Follow `docs/ARCHITECTURE.md` and the task's approved Qoder Spec.
- Never add demo-specific branches, traveller/event names, cities, fixture IDs, routes or scenario-specific node types to domain/recovery logic.
- Provider names and provider-specific schemas belong only inside concrete adapter implementations.
- If the frozen ontology/contracts cannot express a requirement, report an architecture gap. Do not hardcode around it.
- AI output is a proposal. Validate schemas/business rules before graph mutation.
- Structured provider data should be mapped deterministically when possible.
- Deterministic code owns time arithmetic, buffers, constraint checks, graph mutation, propagation, policy thresholds, permissions, state transitions, scenario viability and execution validation.
- Never allow the LLM to directly execute irreversible or money-moving actions.
- Candidate recovery options live in scenario overlays until successful observed execution updates authoritative state.
- UNKNOWN is a valid result. Do not convert missing/stale evidence into guessed certainty.
- Explicit instructions outrank latent preferences. Latent preferences remain soft signals.
- Mocks are permitted only at external provider/action boundaries; internal recovery pipeline components must stay real.
