# Testing Strategy

## Purpose

Tests must prove that the application is a generalized trip-resolution engine rather than
a scripted demo.

Verification is **cumulative evidence**, not a ritual where every stage reruns every check.

- implementation runs the smallest focused checks that prove changed behavior;
- integration reuses valid evidence and tests newly created seams/interactions;
- broader PostgreSQL gates run at coherent checkpoints, not after every edit;
- independent review is risk-based, not automatic at every historical milestone label;
- founder physical tests prove the actual product path where the roadmap names them;
- the final candidate runs the canonical broad gate on the exact candidate SHA and clean
  appropriate test state.

Current delivery checkpoints are defined by `IMPLEMENTATION_PLAN.md` §22, the frozen recovery-planning contract by `RECOVERY_PLANNING_CONTRACT_FREEZE.md`, and
`ROADMAP.md`; historical Checkpoint A/B/C or M0-M10 wording does not create new review
rituals.

## Suite classification

**PostgreSQL is the sole NORTHSTAR runtime.** SQLite survives only as offline, read-only migration input. The test topology encodes that: every test file under `test/**` and `postgres-integration/**` is classified into exactly one suite in [`test/suites.json`](../test/suites.json), and no command discovers tests by directory glob.

| Class | Suites | Meaning | Gating? |
|---|---|---|---|
| `CURRENT_TARGET` | `current`, `postgres` | Current PostgreSQL/runtime/product/domain/contract/UI behaviour. Active engineering evidence. | **Yes** |
| `MIGRATION_BOUNDARY` | `migration` | Tests that intentionally use SQLite because M10 tooling must read historical SQLite sources — read-only exporter, deterministic migration bundle, SQLite source fixtures, import/reconciliation/restore. | **Yes** |
| `HISTORICAL_LEGACY` | `legacy` | Tests of the **retired** SQLite application runtime. Archaeology. | **No** |

Historical legacy failures are **not** current product correctness and **never** a release blocker. Do not fix them unless you were explicitly assigned historical/migration investigation.

### Commands

| Command | Suite | Notes |
|---|---|---|
| `npm test` | boundary gate + `current` | Default NORTHSTAR surface. No database, no browser. Cannot reach retired SQLite runtime tests. |
| `npm run test:postgres` | `postgres` | Full PostgreSQL integration gate. Needs `npm run db:postgres:up`. |
| `npm run test:migration` | `migration` | Migration-boundary tests, including the allowed SQLite source tests. Needs PostgreSQL for the migration pgtest. |
| `npm run test:legacy` | `legacy` | **NON-GATING / HISTORICAL / MANUAL ONLY.** Retired SQLite runtime. Needs `npx playwright install chromium`. |
| `npm run gate:test-boundary` | — | Enforces the classification (see below). |
| `npm run test:suites` | — | Prints the computed classification and reachability per file. |

### Current runner-performance note

`scripts/run-suite.mjs` applies bounded `--test-concurrency=4` to the CURRENT no-DB /
no-browser suite and keeps PostgreSQL, migration, and historical legacy suites serial
(`--test-concurrency=1`). Pass an explicit `--test-concurrency=` extra arg to override.

A 2026-09-18 audit measured the serial CURRENT suite at 72 files / 802 tests in ~30.4s
plus ~7.1s for the boundary gate. CURRENT has no PostgreSQL and no browser; the old
always-serial default was historical carry-over, not a correctness requirement.

Do **not** infer that PostgreSQL should also be parallelized. The PG suite shares one schema
and includes global queue claims, concurrency/fencing tests and heavy AiT E2Es. It remains
serial until its isolation/connection-budget constraints are explicitly changed.

Do not use raw `node --test` as a substitute for the manifest commands: it can discover
PostgreSQL, migration and historical suites together. `npm test` is the canonical current
no-DB command. Focused single-file runs may still pass explicit file paths to Node's test
runner; that is not a substitute for a classified suite.

Assertion failures are never classified as flakiness merely because resource contention
also exists.

### PostgreSQL performance and queue hygiene

The clean PostgreSQL gate is intentionally much heavier than CURRENT. Latest measured B1
checkpoint: **56 files / 522 tests / ~21.4 min**.

Approximate cost is dominated by real acceptance worlds, not SERIALIZABLE retry sleeps:

- F1 crash-injection AiT worlds: ~180s;
- N1 corridor guard worlds: ~131s;
- B1 real Sarah recovery: ~117s;
- T2 real disruption world: ~74s;
- F3/F5/F7 repeated AiT setups: ~163s combined;
- product baseline/replay proof: ~116s;
- migration/foundation and remaining M2-M8 PG tests: the balance.

This broad gate is checkpoint evidence. **Never use it as the debugging loop.**

The shared test container also retains data until `db:postgres:down`. Domain rows are
workspace-isolated, but `claimNextOutboxRow` is a global FIFO claim. Normal commands write
transactional outbox rows and there is currently no normal-runtime publisher, so repeated
PG gates on a long-lived container accumulate PENDING rows.

`inboxOutbox.pgtest.ts` isolates the shared test database from unrelated PENDING/CLAIMED
queue residue with a test-only set-based cleanup, then exercises the real
`claimNextOutboxRow` + `markOutboxPublished` (and inbox claim) protocol. Production global
FIFO claim semantics are unchanged. This is **test-harness residue**, not evidence that
normal Northstar recovery takes minutes.

Current triage after H1-H4:

- **Done H1:** inbox/outbox tests no longer drain unrelated residue one-by-one.
- **Done H2:** daily boot merges `.env` / `.env.local` for `PG_TARGET_*` and
  `NORTHSTAR_DEMO_DATASET_DIR`; a fresh workspace remains an explicit reset.
- **Done H3:** CURRENT suite concurrency is 4; PostgreSQL/migration/legacy stay serial.
- **Done H4:** living docs and scripts name `npm test` / `run-suite.mjs` as canonical.
- **Investigate I1/I2:** duplicated full-AiT setup in narrow F3/F5/F7 and
  `productBaselineWorld`.
- **Investigate I3:** consider a separate heavy `postgres-world` checkpoint list without
  deleting coverage.
- **Investigate I4:** per-file readiness costs ~1s x 56 on a long-lived container.
- **Park:** limited PG-file parallelism until queue isolation and connection budgets are
  proven.

If a checkpoint gate is run on a long-lived local test container, inspect queue residue
only if a *new* global-claim test lacks isolation. Do not “fix” a slow gate by weakening
B1/T2/F1 assertions.

### The boundary is enforced, not documented

`npm run gate:test-boundary` (`scripts/test-boundary-gate.mjs`, run as the first step of `npm test`) walks the **real transitive import graph** of every test file and fails when:

- a test file is not classified in `test/suites.json`, or is classified twice, or no longer exists;
- a `CURRENT_TARGET` test reaches the retired SQLite application runtime — `src/persistence/database.ts`, `repositories.ts`, `entityStore.ts`, `src/app/{compose,runtime,bootstrap,preferenceStore,dossierStore,fxStore,eventInboxStore}.ts`;
- a `CURRENT_TARGET` test imports `node:sqlite`;
- a `CURRENT_TARGET` test reaches `src/migration/**` (that is what the migration suite is for).

`MIGRATION_BOUNDARY` is exempt because SQLite is its input boundary. `HISTORICAL_LEGACY` is exempt because it is historical. The forbidden-module set mirrors `test/m10-runtime-purge.test.ts`, which proves the same boundary for the *runtime* import graph.

Adding a test file without classifying it fails the gate rather than silently joining a suite.

**The graph follows runtime edges only.** `import type ... from` is erased at emit, so naming a retired module's *types* creates no runtime dependency and does not make a test legacy — ten UI/presentation/authority tests reach `entityStore` this way and never load SQLite. `tsconfig.json` sets `verbatimModuleSyntax`, so the inline `import { type A } from` form still emits the import and is deliberately treated as a value edge. `npm run test:suites` flags type-only reach as `retired-types-only`: allowed, but a signal that the test still depends on retired type shapes.

### Physical organisation

Suites are currently separated by explicit manifest rather than by directory. Moving ~76 historical files would be large mechanical churn for no additional safety: the manifest plus the import-graph gate already make it impossible for a command or CI job to conflate the suites. Incremental physical moves (`test/legacy-sqlite/**`, `test/migration/**`) remain welcome but are not a precondition for anything.

## Verification rhythm

**During implementation** — focused, not broad:

1. the focused relevant unit/integration test for the behaviour you changed;
2. the focused PostgreSQL seam test for the same behaviour;
3. typecheck/build/lint only when the change plausibly affects them.

Do **not** run the broad suite after every edit. Using broad suites as the debugging loop is the failure mode this topology exists to prevent.

**At a coherent checkpoint** — the appropriate broader PostgreSQL gate for what changed.

**Final candidate** — the full canonical CURRENT target gate once, on a **fresh database**: `npm test`, `npm run test:postgres`, `npm run test:migration`, build, typecheck, lint, `gate:anti-hardcoding`, and a normal PostgreSQL boot smoke.

`npm run test:legacy` is never part of acceptance.

## Foundational capability-parity gate

This gate applies to **foundational migrations/cutovers/refactors**, not ordinary local
refactors.

Before such a milestone can retire old product behaviour, maintain:

```text
OLD CAPABILITY
-> NEW HOME
-> PRESERVE | ADAPT | SUPERSEDED | RETIRE
-> BEHAVIOURAL PROOF
```

Rules:

- `RETIRE` requires an explicit product decision/reason;
- `SUPERSEDED` requires behavioural proof that the new home actually replaces the old
  capability;
- replacing a persistence technology/class/module is not itself evidence that product
  behaviour was superseded;
- useful legacy algorithms may be adapted without restoring legacy composition;
- historical tests are evidence sources, not automatic current gates.

For recovery-planning parity, behaviour-first tests must cover:

1. current failure identifies relevant recovery domains;
2. evidence gap causes a typed read-only tool request;
3. normalized evidence changes candidate generation;
4. multiple domains/candidates coexist;
5. RC-6 rejects a material candidate;
6. actual deterministic rejection evidence survives reload;
7. viable candidates continue as RecoveryStrategies;
8. recommendation only names/explains current viable strategies;
9. recommendation cannot override deterministic rejection/staleness;
10. immediate-change blast radius, reassessment closure and outcome delta remain distinct;
11. successful-but-insufficient execution re-enters planning from new canonical state;
12. at least two materially different planning situations use the same coordinator/contracts.

## Demo dataset provisioning and fresh baselines

A normal PostgreSQL boot materializes a demo dataset only when `NORTHSTAR_DEMO_DATASET_DIR` points at a runtime bundle directory. Boot then resolves one of three outcomes and logs which one:

| Outcome | Meaning |
|---|---|
| `MATERIALIZED` | No capture of this dataset identity existed, so the bundle was materialized once through the normal M2–M6 commands and the in-scope journeys were assessed by the real evaluator. |
| `ALREADY_PROVISIONED` | A capture with the same dataset identity **and** the same content hash exists, so the existing world is reused untouched. |
| `DEMO_DATASET_CONTENT_CONFLICT` | The same dataset identity is already captured with a different content hash. Boot fails loudly rather than layering a second world over the first. |

Because provisioning is keyed on dataset identity plus content hash, restarting the process against the same database is a no-op, and a browser can never provision anything.

For **daily development**, persist a sticky workspace in `.env.local` against a persistent
local PostgreSQL container. Same database + same already-provisioned `PG_TARGET_WORKSPACE_ID`
reuses the dataset and existing baseline and should boot in seconds.

A fresh workspace is an **explicit reset/proof operation**, not the default restart recipe.
A new workspace pays the full AiT materialization (~47s in the 2026-09-18 audit), the
67-journey baseline (~11s), and authority provisioning again.

**Starting from a clean baseline** is a matter of choosing a clean target, never deleting
domain rows:

- **Fresh workspace in the same database** — use a new `PG_TARGET_WORKSPACE_ID` only when
  an independent world is actually required.
- **Fresh database** — set a new `PG_TARGET_DATABASE` for candidate/isolation proof.
- **Fresh container** — `npm run db:postgres:down` then `npm run db:postgres:up` for a
  completely clean disposable volume.

Normal `npm run dev` merges `.env` then `.env.local` into the target boot env, so
`PG_TARGET_*` and `NORTHSTAR_DEMO_DATASET_DIR` can live in `.env.local`. Process
environment still wins. PostgreSQL tests do not apply that file merge, so a developer
sticky workspace cannot steal the test database.

`POST /api/v2/demo/reset` (the two-traveller placeholder world) returns `409 DEMO_DATASET_PROVISIONED` whenever a demo dataset is configured, so it cannot be used to append a second world to a provisioned one. An operator-facing "reset scenario" control needs lifecycle semantics — replaying a world forward rather than mutating observed history backwards — and is intentionally not implemented yet.

## Test IDs

### T-DOM — Domain/schema contracts
Validate:
- entity/operational schemas;
- invalid enum/type rejection;
- relationship/constraint reference integrity;
- source authority/provenance/freshness representation;
- explicit vs latent preference precedence;
- UNKNOWN representation;
- flexible required/unbooked transport;
- recovered-with-loss outcome.

### T-EVAL — Deterministic evaluators
Cover:
- timezone normalization;
- time-window arithmetic;
- duration/buffer envelopes;
- hotel/check-in/no-show windows required by scenarios;
- transfer/connectivity constraints;
- flexible `TransportLeg` fulfilment;
- accessibility requirements;
- policy/spend thresholds;
- PASS/FAIL/UNKNOWN distinction;
- irreversible loss without engine termination.

### T-PROP — Mutation and blast-radius propagation
Validate:
- only validated proposals mutate state;
- changed facts reevaluate relevant constraints;
- dependency propagation produces `ImpactAssessment`;
- downstream state is not blanket-invalidated;
- direct failures, at-risk items, safe objectives, unknowns, and irreversible losses remain distinguishable;
- audit/history is preserved.

### T-OVERLAY — Scenario overlays and viability
Validate:
- candidate changes never mutate authoritative state;
- overlay evaluation is deterministic;
- hard-constraint failures make a scenario infeasible;
- soft tradeoffs remain available for ranking;
- successful observed execution is required before authoritative replacement state appears.

### T-AUTH — Authority and case lifecycle
For identical `ActionIntent + policy/context`, authority outcome is deterministic.

Cover:
- AUTO_APPROVED;
- REQUIRES_TRAVELLER;
- REQUIRES_ORGANISATION_APPROVER;
- REQUIRES_HUMAN_AGENT;
- BLOCKED;
- executing/verifying loops;
- API success without restored viability does not resolve the case;
- FULLY_RECOVERED and RECOVERED_WITH_LOSS.

### T-AI — AI contracts
Use cheap Model Studio calls or saved outputs for plumbing where useful.

Validate:
- schema-constrained extraction;
- malformed output rejection;
- uncertainty surfaced rather than guessed;
- explicit instruction overriding latent preference;
- planner structured strategies/tool needs;
- legal/entry facts require authoritative sourcing;
- operational research estimates retain source/uncertainty;
- model output cannot bypass mutation/viability/authority/execution gates.

Prompt quality should not become an external-model rabbit hole before the integrated loop works.

### T-ADAPTER — External capability contracts
For each adapter validate:
- normalized success result;
- structured error/unavailable result;
- no secret leakage;
- LIVE/REPLAY same normalizer/downstream path where supported;
- provider failure does not crash RecoveryCase;
- replay data remains provider-shaped enough to exercise the real normalizer.

Mandatory Atlas:
- Search;
- Verify;
- fare/change/refund/no-show rule normalization required by the scenario.

Google Routes:
- route normalization;
- missing-credential/network fallback.

### T-PERSIST — Persistence/restart
Validate:
- Trip/Case survive process restart/reload;
- audit/source history persists;
- state transitions/versioning remain coherent;
- deterministic fixture/reset/reseed creates known demo state.

### T-GEN — Generalisation / anti-hardcoding
At least two materially different scenarios pass through the same application code. For current recovery planning, they must additionally use the same Recovery Planning Coordinator, domain registry, StrategyProposer boundary, RC-6 and recommendation contract:

**Scenario A — AnchorEvent speaker**
Event obligations, organiser policy, traveller interaction, disrupted flight, downstream transfer/hotel/event objectives.

**Scenario B — TMC/corporate traveller**
Different governance/policy, approval/spend path, objective, route/context, and supplier data.

Changing scenarios may change only source documents/pages, fixture/config data, traveller/organisation/AnchorEvent/policy values, and provider responses.

Search for:
- fixture/event/traveller names;
- city/airport/route constants;
- provider branches outside adapters;
- scenario-specific conditions in domain/recovery/application code.

Any genuine missing abstraction is an architecture gap, not permission to hardcode.

### T-NORTHSTAR — Northstar contract and programme-scale families (RV-N0+)

Contract baseline: `test/northstar-contracts.test.ts` at `NORTHSTAR_CONTRACT_BASE_SHA`. Families below extend it in later RV-N packages without weakening the frozen contracts.

**Contract families (frozen at RV-N0):**
- commitment linkage: `AnchorCommitment` shared children, Engagement `anchorCommitmentId` fan-out, importance per traveller — never global hardness;
- intake equivalence: every `IntakeChannel` promotes `ProgrammeTravellerDraft` through the same validated mutation path with honest `PromotionOutcome` issues — no direct Trip/Booking writes;
- initial planning: zero-element trips with UNKNOWN viability are legal; `caseKind` defaults RECOVERY and legacy cases load unchanged;
- ChangeRequest variants: the three frozen shapes (window shift + self-funding, later/direct transport, stay proximity) validate; requests containing element mutations/booking ids/provider operations are rejected;
- funding: `FUNDED_WINDOW` rule + `CostAllocation` fields validate; payer vocabulary closed;
- event-side signal: `ANCHOR_COMMITMENT_CHANGE` payload validates; provider signal kinds never carry event-side facts;
- programme read model: `ProgrammeView` shape (status rollups, endangered commitments, active cases, decisions required, uncertainty);
- tool-vocabulary safety: extended `ToolOperationSchema` remains a strict subset of `CapabilityOperationSchema`; consequential hotel.book/transfer.* never appear as tool operations;
- Wave 3R transaction safety (G3R-R0, `test/wave3r-contracts.test.ts`): flight payment carries an opaque paymentRef and no card fields; `flight.book`/`flight.pay`/`flight.cancel` submission are authority-path only and never tool operations; read-only `flight.order_status`/`flight.cancel_quote`/`flight.cancel_status` stay a strict capability subset; unsupported cancellation is a structured outcome; cancellation acceptance is distinct from observed cancellation state; provider order/ticket observation never carries trip viability; external event envelopes keep provider identity and never self-promote to AUTHORITATIVE; `FlightTransactionState` denylist is canonical (case/separator-insensitive), nested and PAN-value-aware — a heuristic filter, with curated adapter mapping as the primary guarantee.
- Wave 3R Mission 1 runtime truth (DR-1, `test/wave3r-dr1-runtime-truth.test.ts`): causal evidence ordering holds at ordinary runtime time AND against genuinely causally older evidence (replacement observedAt never outranks a later disruption; no host-timezone dependence); a FULLY_RECOVERED case reconciles the authoritative Trip aggregate (restart-stable, unrelated trips untouched, provider success alone never flips Trip READY); SPEND_LIMIT and APPROVAL_ABOVE_SPEND currency incomparability fails closed and delegated authority cannot bypass it.
- Wave 3R Mission 1 provider execution (DR-2, `test/wave3r-dr2-provider-execution.test.ts`): the ADR-042 A1/A2 payment gate is test-enforced in real execution code — missing payable total, currency mismatch, payable above ceiling, or absent ceiling all refuse `payOrder` and preserve the HELD order (never `ActionIntent.priceDelta` as ceiling); ambiguous pay/cancel results reconcile retrieve-before-retry; PAID-but-not-TICKETED never becomes a SUCCESS/confirmed mutation; unsupported cancellation is structured non-fatal data; REQUEST_ACCEPTED/PROCESSING never becomes an authoritative CANCELLED mutation; hotel replacement confirms the new stay before cancelling the displaced one and a failed old-stay cancellation preserves duplicate exposure instead of faking rollback; provider success under a failing/UNKNOWN hard trip constraint leaves the case unresolved; resolved case and authoritative Trip agree; REPLAY produces the same normalized downstream semantics as the corresponding LIVE path.
- Wave 3R Mission 1 G3R-R1 review fixes, adapter-level (`test/wave3r-r1-adapter-payment-guard.test.ts`): `AtlasFlightTransactionAdapter.payOrder`'s own pre-pay `retrieveOrder` ceiling re-check — over-ceiling, currency mismatch, missing observed total, a failed status query, and an unmapped/non-HELD observed status all refuse before `/pay.do` is ever called; a within-ceiling observed HELD order pays; an already-PAID/TICKETING/TICKETED order short-circuits on the observed state with no duplicate `/pay.do` call; an unapproved `paymentRef` costs zero provider calls; REPLAY behavior is unchanged by the new gate.
- Wave 3R Mission 1 G3R-R1 review fixes, executor/authority (`test/wave3r-r1-fixes.test.ts`): A1 — STAY replacement classifies `MONEY_MOVING` rather than auto-approved `REVERSIBLE`, and `insufficientSideEffectLevel` backstops a misclassified intent with `side_effect_level_misclassified` before any provider call, at zero provider calls; A2 — candidate-confirmation gating via `CONFIRMS_CANDIDATE_STATE`/`confirmsCandidateOperations`, including the ADR-007 simulation-boundary regression guard (SIMULATED results keep confirming as before); I1 — a payment/booking intent with no reviewable spend refuses with `authority_reviewed_no_spend` before `payOrder`/`bookStay` are called.
- NORTHSTAR FX/home-currency normalization (ADR-052, `test/northstar-fx-normalization.test.ts`): same-currency comparison is exact and evidence-free; USD provider / SGD home with valid evidenced rate compares deterministically in home currency; missing rate evidence BLOCKS (ADR-045 fail closed); expired AND not-yet-effective evidence each BLOCK; untrusted (ASSERTED) governing evidence BLOCKS even when trusted-but-expired evidence exists alongside; malformed evidence behaves like missing evidence (never partially trusted); cross-currency approval thresholds trigger on the normalized amount while below-threshold spends do not; `buildActionIntent` freezes BOTH the home restatement (`spendExposure`) and the original provider charge (`providerSpend`), unnormalized strategies keep the legacy shape; the executor pays against the ORIGINAL provider amount (over-ceiling payable refuses; within-ceiling payable pays with `FlightOrderPayQuery.authorisedAmount` = provider amount, not the restatement); post-authority mutation of strategy cost AND FX rates cannot raise the executor ceiling; an alternate EUR-home/JPY-provider dataset drives identical engine behaviour end-to-end (no SGD hardcoding); SQLite store round-trips evidenced rates per currency pair.
- NORTHSTAR Frankfurter FX supplement (ADR-052, `test/northstar-frankfurter-fx.test.ts`): raw Frankfurter responses normalize into dated CONNECTED evidence with the PROVIDER's reference date as `observedAt`; RECORD→REPLAY parity is exact on normalized evidence AND downstream conversion, with the deterministic recording key shared between modes; a REPLAY miss and provider HTTP/schema failures are structured failure data, never exceptions; the layered resolver merges organisation budget FX (first-class) with external reference rates — freshest effective observation wins generically, AUTHORITATIVE budget rulings outrank CONNECTED provider fixings at equal freshness, external outages contribute nothing, invalid stored rows are dropped wholesale; future-dated comparisons only ever use evidence OBSERVED before the comparison instant (no fabricated future spot) and resolution fails closed when no valid layer covers the instant; arbitrary ZAR/NOK pairs work end-to-end with zero SGD involvement; empty budget + unreachable external still BLOCKs cross-currency authority.
- temporal normalization: offset-qualified passthrough, naive values normalized only with explicit IANA timezone, absent timezone → uncertainty (undefined), never a guessed offset.

**Programme-scale families (RV-N1..N12):**
- commitment fan-out reaches every linked Engagement and only those;
- initial planning through the overlay engine reaches resolved trips without provider calls;
- Cases A/B/C as frozen by the original product specification ("Frozen acceptance Cases A/B/C"), each at programme scale;
- ~40–45 traveller scale smoke: seeding, fan-out, reset/reseed and restart remain deterministic and complete at that traveller count.

**Anti-hardcoding / alternate-data rule (Northstar):** every Northstar acceptance test must pass with an alternate fixture set — different event type, different cities/airports/hotels/dates, different traveller identities. No WiT/conference/speaker/SIN/KUL/route/airline/hotel/fixture/demo-date/Case-id logic may exist in `src/**`; the hardcoding search of T-GEN is extended with these families.

### T-E2E — Integrated recovery loop
Prove:

`source/profile -> validated persistent state -> ChangeSignal/request -> mutation -> deterministic assessment -> RecoveryCase -> Recovery Planning Coordinator -> recovery domains/evidence gaps -> bounded read-only capability results -> ProposalCandidates -> schema validation -> RC-6 deterministic viability -> material decision evidence -> viable-only recommendation -> authority -> ActionPlan/execution -> observation/reconciliation -> canonical update -> reassessment -> resolve/continue/escalate -> read models`

No manual state edits are allowed between stages.

At least one development proof must show Atlas LIVE Search/Verify through the real adapter. Routine E2E may use replay.

### T-RELEASE — Final candidate gate
On the exact candidate SHA:
- build;
- typecheck;
- lint;
- full automated test suite appropriate to stack;
- Scenario A E2E/replay;
- Scenario B `T-GEN`;
- hardcoding audit/search;
- reset/reseed;
- persistence restart;
- provider/model fallback smoke tests;
- secret/sanitized-recording review.

## Robustness scenario pool

Do not require every robustness scenario before the core works. Select the highest-value subset in the internal implementation plan.

Candidate scenarios:
- late arrival vs hotel reception/no-show;
- public transport unavailable; flexible taxi/private transfer remains viable;
- separately booked rail/ferry connection;
- visa/entry/immigration buffer invalidates nominal connection;
- accessibility invalidates cheaper recovery;
- shared transfer/resource affects another traveller;
- trip objective already lost; remainder recoverable;
- stale imported hotel data produces UNKNOWN/reverification rather than false PASS.

## Work-package verification rule

Before an implementer declares a work package implemented:
- run the `T-*` categories assigned in the internal implementation plan;
- run build/typecheck/lint only when the changed package or repository baseline makes them useful, not automatically all three for every tiny task;
- verify relevant failure/fallback behavior;
- verify no scenario-specific domain branch was added;
- ensure no secret/unsafe raw provider data is committed;
- report exact commands/evidence honestly.

A work-package completion is **not** an independent review checkpoint unless it contains a material architecture/high-risk change that triggers an exceptional review under the rule below.

## Integration verification rule

The integrator:
- verifies lane branch/head evidence;
- reuses scoped lane tests that remain valid;
- tests newly created seams and conflict resolutions;
- runs `T-E2E` once the vertical loop exists;
- does not rerun every historical test after each merge by habit.

## Independent review checkpoints

Current R1/R2/R3/B2 review placement follows `IMPLEMENTATION_PLAN.md` §22. Reviews are sparse: R2 gets one product/read-model review, R3/B1 gets owner acceptance plus a focused same-engine review where warranted, and B2 gets one high-risk execution/reconciliation review. The older gates below remain useful evidence patterns but do not redefine current milestone scope.


Independent review is mandatory at the four historical formal gates below (A/B/C/Final). In addition, the Northstar programme adds bounded post-Checkpoint-C execution gates — NS-G1 as an internal integration gate (no scheduled Review 1), NS-G2 with mandatory different-family Review 2, the NS-G3 human product/demo evaluation, and Wave 4 stabilisation before the Final Candidate Review (internal implementation plan Section 13; reviewer routing in the internal model-selection guide). This is deliberate risk control, not a request to re-review every package or every historical line of code.

A reviewer must inspect the **actual repository SHA and evidence**, not merely accept the implementer's report. Reviewer findings are triaged `Act Now | Investigate Now | Park for Later | Ignore / Accept Risk`.

A checkpoint passes when there are no unresolved **Act Now** findings and no unresolved **Investigate Now** finding that threatens that checkpoint's acceptance criteria. Parked/accepted hackathon risks do not block progress.

A targeted review fix requires targeted closure evidence. It does **not** automatically trigger another full review of unrelated areas.

### Review Gate A — contract freeze / fan-out

Runs after F0–F3 scoped verification and before downstream lane fan-out.

Review focus:
- runnable credential-free foundation;
- shared domain/operational/service/capability/read-model contracts;
- deterministic/AI safety boundaries;
- timezone/freshness and authority semantics in frozen shared code;
- two-scenario generality;
- anti-hardcoding;
- lane ownership/collision risk;
- whether tests meaningfully prove the contract claims.

The output is `PASS` or `FAIL — FIX REQUIRED` plus a safe fan-out SHA if passed.

Checkpoint A review may include static architecture/code review in addition to an independent coding-agent review because errors here multiply across all downstream lanes.

### Review Gate B — integrated vertical recovery loop

Runs after I1–I5 meet Checkpoint B acceptance and before treating the vertical loop as accepted.

Review focus is the **integrated high-risk path**, not a ceremonial re-review of every lane:
- validated mutation and persistence;
- impact/blast-radius propagation;
- scenario overlay isolation and deterministic viability;
- planner/capability separation;
- deterministic authority and irreversible-action gate;
- executor/observation/state-update loop;
- LIVE/RECORD/REPLAY equivalence and provider-boundary simulation truthfulness;
- UI consuming actual read models rather than bespoke demo data;
- Scenario A `T-E2E` evidence and restart/persistence behavior.

If a lane's previous scoped evidence remains valid, reuse it. Expand review into lane internals only when the integrated seam or evidence gives a concrete reason.

### Review Gate C — generalisation / reliability / demo candidate

Runs after G1–G3 and R1 meet Checkpoint C acceptance, before declaring the integrated SHA the demo candidate.

Review focus:
- Scenario B runs through the same application code;
- no scenario/event/traveller/city/route/fixture hardcoding in production logic;
- provider-specific logic remains inside adapters;
- selected robustness cases are real rather than scripted;
- reset/reseed and persistence restart are reliable;
- unavailable/provider/model fallback behavior is honest;
- replay and sanitized recordings are demo-safe;
- docs/README/demo claims match implemented reality;
- any shared-contract change since Checkpoint A was deliberately reconciled rather than hidden in a lane.

This is primarily a **generalisation + reliability audit**, not another full release audit.

### Review Gate Final — release/demo candidate

Runs on the exact final candidate SHA.

This is the broad independent release review plus `T-RELEASE` canonical verification.

Review focus includes:
- deterministic mutation/viability/authority safety boundaries;
- persistence;
- provider/action boundaries;
- LIVE/RECORD/REPLAY consistency;
- policy/constraint enforcement;
- AI schema boundaries;
- both accepted scenarios;
- hardcoding;
- reset/reseed and fallback behavior;
- secret/recording hygiene;
- user-facing claims vs implemented reality;
- demo flow readiness.

Only after this gate and `T-RELEASE` pass is the repository considered final-candidate complete.

## Northstar execution gates (post-Checkpoint-C, bounded)

These gates do not reopen or replace accepted Checkpoints A/B/C; they exist because a single multi-day autonomous implementation horizon is deliberately not trusted.

### NS-G1 — Programme Foundation (Wave 1) — internal integration gate
NS-G1 is an internal integration/acceptance gate, not a human/reviewer checkpoint: when it passes, the primary agent continues automatically into Wave 2. Acceptance per the internal implementation plan Section 13: ~40–45 traveller programme import; individual add/update through the same normalized contract; messy reasonable input maps to validated drafts; missing facts never hallucinated; shared commitments link correctly; programme read model works; policy/funding structures work; Checkpoint C behavior remains green; alternate event/location data requires no application-code change. Test evidence extends the T-NORTHSTAR contract families (intake equivalence, commitment linkage, anti-hardcoding alternate-data).

### Review 1 — no longer a scheduled mandatory gate
Review 1 (formerly default DeepSeek-V4-Flash; fallback Kimi-K2.7-Code; fresh different-family from the primary Qwen implementer) is no longer a scheduled mandatory gate after NS-G1. A bounded different-family review may still be used voluntarily if evidence suggests a problem — focus areas: architecture drift; conference/event-specific hardcoding; duplicated programme truth outside authoritative state; AI output bypassing validation/promotion; fabricated defaults / UNKNOWN becoming certainty; shared commitment semantics; intake equivalence; alternate-event substitution; frozen RV-N0 contracts silently changed; test quality — but it does not gate Wave 2.

### NS-G2 — Resolution Capabilities (Wave 2)
Backend convergence acceptance: the four shapes 0/A/B/C (incomplete → viable Trip; traveller changes desired target; provider changes current reality; AnchorEvent/shared commitment changes objective/context) all traverse the same generalized planning/overlay/viability/authority/execution/observation architecture where applicable. Test evidence extends T-NORTHSTAR (ChangeRequest variants A1/A2/A3, funding, hotel adapter lifecycle, Atlas LIVE/RECORD/REPLAY equivalence).

**Result:** GREEN at candidate `91648aa481e598d42ac92769d3f550c0b7050e4b` (branch `integration/northstar`). Primary convergence evidence: `test/northstar-convergence.test.ts` — a single credential-free REPLAY run over the composed HTTP server drives all four paths through the same engine stack (initial-planning case + traveller authority + gate-checked SIMULATED execution + observation/verification; ChangeRequest window-shift re-search; FLIGHT_CANCELLATION recovery with unrelated trips untouched; commitment fan-out by `anchorCommitmentId` with authoritative engagement-fact propagation), including honest-UNKNOWN refusals (missing home evidence, unapproved execution, malformed payloads). Suite 395/395; typecheck/lint/build clean; anti-hardcoding and secrets scans clean.

### Review 2 — after NS-G2
Default DeepSeek-V4-Pro Max (intentional premium use for the highest-risk integrated backend checkpoint); fallbacks per the internal model-selection guide. Adversarial focus list in the internal implementation plan Section 13: authoritative vs desired target state; model-created judging criteria; mutation safety; overlay isolation; deterministic viability; UNKNOWN never PASS; funding/policy correctness; authority/approval; LLM → irreversible API prohibition; execution gate; provider success != resolved; observation/state update; fan-out correctness; unrelated Trips unaffected; LIVE/RECORD/REPLAY identical normalization; provider boundaries and degradation; generalisation; hardcoding; meaningful tests.

### NS-G3 — Integrated Product (Wave 3)
Human product-owner evaluation of Cases A/B/C integration and the demo criteria in Section 13 — not a broad code review. LIVE/SANDBOX/RECORD/REPLAY/SIMULATED labels must be truthful.

### Wave 4 — Stabilisation / Code Freeze
Repeated reset → programme → initial planning → Case A / Case B / Case C runs plus failure/degradation paths (Atlas unavailable, hotel unavailable, model unavailable, malformed AI, missing traveller facts, approval declined, no viable recovery → recover/degrade/ask/block/escalate, never crash or fabricated success), followed by the canonical release verification list above.

## Exceptional review trigger

Outside the historical four mandatory gates and the Northstar execution gates above, add a targeted independent review only when evidence warrants it, for example:
- architecture/shared contracts change materially after Checkpoint A freeze;
- a real irreversible/provider-money boundary is introduced or materially changed;
- persistence/auth/security work has meaningful destructive risk;
- integration failure suggests correlated blind spots;
- a reviewer identifies a cross-cutting issue whose closure cannot be established by targeted tests alone.

Do not add independent reviews merely because a package is important or because a model completed a large amount of code.

## Demo-readiness definition

A demo is not ready merely because screens render.

Required:
- real internal pipeline (`T-E2E`);
- real Atlas adapter evidence plus reliable replay;
- second-scenario generalisation (`T-GEN`);
- deterministic viability/authority boundaries;
- persistent/resettably seeded state;
- UI reading real application state;
- external simulation only where provider transactions are unsupported/unavailable.
