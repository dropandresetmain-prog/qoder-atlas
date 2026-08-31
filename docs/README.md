# Documentation

The repository README is the product entry point and reproduction guide. This
index says which document answers which question.

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — the logical architecture and its
  invariants: the Live Dependency Graph as the persistent operational model, and
  why chat and dashboards are interfaces rather than the source of truth.
- **[CAPABILITIES_AND_LIMITATIONS.md](CAPABILITIES_AND_LIMITATIONS.md)** —
  implementation and provider truth for the submitted candidate: what
  `IMPLEMENTED` means, and where a path is sandbox-constrained, simulated or
  deliberately degrades to `UNKNOWN`.
- **[SCENARIOS.md](SCENARIOS.md)** — the frozen scenario catalogue (S1–S8):
  narrative, capability claim, priority and demo intent. Executable facts stay in
  fixtures and configuration, not here.
- **[TESTING.md](TESTING.md)** — the verification taxonomy and its `T-*` test
  families, the checkpoint review gates, and the authoritative full-suite run.
- **[ENVIRONMENT.md](ENVIRONMENT.md)** — setup expectations and environment
  variable names (never values), including the credential-free REPLAY default
  that lets the core app start with nothing configured.
- **[DESIGN.md](DESIGN.md)** — the design system: the binding rules behind the
  operator surfaces, whose implementation lives in `src/ui/theme.ts`.
- **[MOTION_DESIGN.md](MOTION_DESIGN.md)** — motion as browser-rendered programs
  with deterministic timing under `media/`, and why rendered output is not
  committed.
- **[BUILD_WITH_QODER.md](BUILD_WITH_QODER.md)** — the agentic-development
  workflow used to build this: frozen shared contracts, bounded lanes, and
  evidence-gated checkpoints.
- **[ROADMAP.md](ROADMAP.md)** — capability scope and status, including what is
  Stretch, Deferred or Rejected, with the reason and the revisit condition.

When code and a document disagree, treat it as drift to resolve rather than
assuming either side wins by default.
