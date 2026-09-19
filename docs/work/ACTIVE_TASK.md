# ACTIVE TASK — POST-R4 CONVERGENCE / A1 IN PROGRESS

- Goal: legacy-quality frontend, faithful V5.6/V7.2, physical Sarah and Jordan through one generalized PostgreSQL recovery engine.
- Immutable accepted R4 base: `2baf1f6df484319e131590d37a0b026222324d03`.
- Primary: `integration/astra-post-r4`; `C:/Dev/qoder-atlas/.worktrees/astra-post-r4`.
- Accepted/pushed A0 SHA: `f55899b15200de692dd749bbcfb795c67f6a22e0` (remote verified). Current integration work starts from that checkpoint.
- Reference pack: `29bb0690aa36b0e4c3a084917d120367aa61257c`, docs copied only.
- Decisions/triage/decomposition: [A0 reconciliation](ASTRA_A0_CONVERGENCE.md).
- Accepted R4 ledger remains available at the immutable base: `git show 2baf1f6:docs/work/ACTIVE_TASK.md`.

## Acceptance

- [x] Exact accepted R4 branch point established in isolated worktree.
- [x] Charter first; prepared pack and current contracts/code/recent R4 commits inspected.
- [x] Graph and Jordan material findings revalidated; final R4 evidence distinguished from older audit.
- [x] Frontend revalidation return incorporated; Activity paging remains A1 scope.
- [x] Docs-only A0 checked, committed, pushed and remote SHA verified.
- [ ] A1 frontend and graph convergence, focused/PG/browser evidence, pushed candidate.
- [ ] A2 Sarah physical product acceptance.
- [ ] A3 Jordan generalized runtime acceptance.
- [ ] A4 Jordan physical product acceptance.
- [ ] A5 cross-scenario repeatability, appropriate broad gates, final candidate.

## Lanes

| Lane | Model | Branch/head | State |
|---|---|---|---|
| Graph A0 revalidation | Terra High | read-only accepted base | Complete; no writes/tests |
| Jordan A0 revalidation | Terra High | read-only accepted base | Complete; no writes/tests |
| Frontend A0 revalidation | Luna High | read-only accepted base | Complete; no writes/tests |

Active A1 lanes: Case semantics Terra on `codex/astra-a1-case-semantics` (review corrections after a9fcd61); Programme preview Luna on `codex/astra-a1-programme-preview`. Navigation Luna ready at `6a80c01`; Overview layout Luna ready at `f893972`. Isolated worktrees/databases. Existing R4/PG-perf worktrees and root untracked work remain untouched.

## Evidence and counters

- Green A0: exact branch/base/provenance inspection; graph paths unchanged since audited snapshot; `git diff --check`.
- A1a renderer lane `b5ad49e8f9372d1e9052e585faf65fb986c5375f`: 12 focused tests passed; merged as `4029fa3`. Primary direct TypeScript check passed.
- Current pushed primary before Activity checkpoint: `b7627bd31192f0d425ada2e0063dcc3590d6ff0f`.
- Activity: 20-row keyset pagination; focused PG shell file 2/2 passed on `astra_a1_shell` (timestamp ties, microseconds, inserted new row, complete history, invalid/cross-workspace cursor); direct TypeScript passed. Browser proof pending restart.
- Navigation ready: 45 focused tests and direct TypeScript passed; explicit Traveller event context replaces brittle HTML rewriting.
- Overview layout ready: 10 focused geometry tests and direct TypeScript passed. Dependency rows no longer overlap programme; same-day cohorts stack. Physical merged proof pending.
- Primary normal boot/browser baseline: `astra_product`, workspace `9ef64348-61b2-4e18-a291-152502a89a02`, port 4120; REPLAY, Qwen absent, execution absent; 52 PASS / 15 UNKNOWN, visible 52/67. No LIVE/provider calls.
- New convergence counters: **postgres:fast = 0; CURRENT_TARGET = 0; full canonical PG = 0**.
- Reused R4 counters: 1/1/1, with focused closures; opaque currentness suite-only failure remains Investigate Now. Do not claim all three broad runs were clean.
- Node 24.15 available; root dependencies available by normal Node ancestor resolution. Local PG container on 55432; primary created `astra_product` and lane-only `astra_a1_case`.

## Current issues

- Act Now: graph workflow leakage, missing timing/purpose, browser-derived relationship truth, commitment consequence fidelity, non-programme population, frontend user jobs.
- Investigate Now: D1 85-minute connection conflicts with 90-minute hard minimum; freeze truthful safe/tight/impossible semantics before A3. Normal ingress/invalidation progression needs direct proof.
- Act Now for A3: data-driven updates; resettable execution identity/budget; per-offer review details; remove named test-only progression constant from application source.
- Investigate Now: physical graph fidelity and inherited currentness anomaly on concrete evidence.
- Park for Later: R4 N5-N7/replan unless reproduced; ancillary/composite transactions and unrelated providers; multiple Overview blast centres.
- Ignore / Accept Risk: accepted redirects/collapsed Apply; no ceremonial R4 reacceptance.

## Exact next action / stop-safe handoff

Commit/push Activity checkpoint, integrate navigation and Overview layout, then restart isolated product for physical paging/navigation/graph checks. Integrate Case semantics after focused review corrections. Freeze Overview semantic follow-on; restore remaining Programme/Decisions/Traveller jobs. A1 acceptance remains pending.

Blocker: none for A0/A1. Jordan requirement/semantics conflict is pending primary resolution before A3.
Remaining action-seam findings: programme bilateral preview is real but unwired; generic programme preview/commit and traveller composer/scoped-choice are target-native boundary work, not HTML-only restoration. These remain Act Now / Investigate Now at primary scope.
Browser artifacts: ignored `output/playwright/` screenshots; temporary untracked `.playwright-cli/` snapshots/logs must stay out of commits.
Evidence not run: integrated browser acceptance, Overview semantic follow-on, A1 broad gates, A2–A5 acceptance. Applied disclosed Sarah supplier input physically in isolated REPLAY runtime; Case awaits programme approval. No execution acceptance claimed.
Continue in this task while checkpoint context is clean; use this ledger plus A0 record for a fresh task if context becomes noisy. Never branch from the preparation pack or merge directly to main.
