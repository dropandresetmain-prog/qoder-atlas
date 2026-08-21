# AGENTS.md

## Mission
Build the Atlas × Alibaba Cloud hackathon product described in `docs/PRODUCT_SPEC.md` and `docs/ARCHITECTURE.md` without demo-specific hardcoding.

Read before making broad changes:
1. `docs/PRODUCT_SPEC.md`
2. `docs/ARCHITECTURE.md`
3. `docs/IMPLEMENTATION_PLAN.md`
4. `docs/ROADMAP.md`
5. `docs/DECISIONS.md`
6. task-specific Qoder Spec

For Atlas capability questions, consult the authoritative research in `dropandresetmain-prog/atlas-hackathon-lab`; do not guess.

## Architectural invariants
- The trip/state graph is central. Chat is an interface, not the source of truth.
- One generalized recovery engine must support TMC, corporate/event and future traveller use cases.
- AI may interpret, extract, map, identify uncertainty, infer soft preferences, judge semantic consequences and propose recovery strategies.
- Deterministic code owns schema/business validation, graph mutation, arithmetic, timezone/time-window checks, buffers, dependency propagation, policy thresholds, permissions, state transitions, viability and execution validation.
- Never allow `LLM -> irreversible/money-moving API`.
- Required flow: `AI proposal -> validation -> deterministic viability -> authority -> executor -> observe -> state update`.
- Prefer deterministic mapping for structured provider data.

## Anti-hardcoding
Never add scenario-specific branches, fixture IDs, traveller/event names, locations, suppliers or route-specific conditions to domain logic.

Demo facts belong in fixtures/configuration/sources. At least two materially different scenarios must run through the same application code without changes.

If the approved ontology cannot express a requirement, stop and report an **architecture gap**. Do not patch around it.

## External capability boundaries
- Atlas is a flight adapter, not the architecture.
- Mocks are allowed only at external provider/action boundaries.
- Internal ingestion, graph mutation, propagation, planning, viability, authority, observation and state transitions must remain real.
- Use LIVE / RECORD / REPLAY where practical. LIVE and REPLAY must share normalization and engine paths.
- Do not make Booking.com, Google Routes, Gmail, Timatic or any optional external service a hard dependency unless roadmap status explicitly changes.

## Persistence
Use SQLite behind repository interfaces unless deployment constraints prove it unsuitable. Do not introduce a graph database or infrastructure platform without a demonstrated requirement.

## Qoder workflow
- Use Spec-driven Quest for medium/large implementation work. Review the generated Spec before Build.
- Freeze shared contracts before parallel implementation.
- Use separate worktrees/Quests for independent lanes after contracts are stable.
- Do not let a lane change shared contracts to make local implementation easier. Report the mismatch for integration review.
- Keep architecture, cross-lane integration, verification and high-risk changes with the primary model/lead.
- Delegate bounded boilerplate/tests/docs to cheaper models/subagents where useful.
- Use cheap Alibaba Model Studio models for plumbing/tests when output quality is not the point.

## Completion discipline
Before declaring a milestone/task complete:
- run relevant tests
- run build/typecheck/lint where applicable
- verify failure/fallback behaviour
- check for scenario-specific hardcoding
- ensure no secret or sensitive raw provider data is committed
- update roadmap/status docs when scope or implementation state changes
- record significant architecture decisions in `docs/DECISIONS.md`
- classify every new issue: Act Now / Investigate Now / Park for Later / Ignore or Accept Risk

Use exact-path Git staging. Do not stage unrelated files.

## Source-of-truth precedence
Current tested code > `docs/ARCHITECTURE.md` > `docs/PRODUCT_SPEC.md` > `docs/IMPLEMENTATION_PLAN.md` > `docs/ROADMAP.md` > `docs/DECISIONS.md` > README.

If tested code intentionally changes an approved contract, update the relevant source-of-truth documents in the same milestone. Accidental divergence is a bug.
