# ACTIVE TASK — A4 selected-plan continuation safety

## Boundaries and current status

- Date: 20 September 2026. Repository: `dropandresetmain-prog/qoder-atlas`.
- Verified base: `finish/a3-operator-ui-second-pass` @ `987a6b66cc34b8d7fc327dbda76853e8ef1e761b`.
- Working branch: `finish/a4-continuation-astra-cp2-20260920`, created from that exact SHA. The shorter suggested branch already existed and was not modified.
- A0 / A1 / A2: accepted. **A3: CONDITIONAL PASS — continue integration, not final acceptance.**
- A4 Checkpoint 2: **IN PROGRESS — identity/continuation contracts checkpoint, not a runnable or accepted candidate yet.**
- No hotel execution, A3 UI, V5.6/V7.2, disruption controls, pricing presentation or wording/layout changes are authorized here.
- Preserved WIP is source material only: `codex/a4-selected-continuation` @ `b911989406d070f4a48c9783614f8256f16eb83f`; prior `fb4ff1023f44b038da3c00484b4465c5a9c85ff6`. Neither is merged wholesale.

## Required reading / truth

- [Finishing plan](A3_A5_FINISHING_IMPLEMENTATION_PLAN.md), [hero depth](ASTRA_HERO_DEPTH_SCOPE.md), [A4 prep](A4_RECOVERY_PREP.md), [selected-plan contract](ASTRA_A4_SELECTED_PLAN_CONTINUATION.md).
- [Roadmap](../ROADMAP.md) remains the source-of-truth roadmap. This is a bounded working ledger, not another roadmap.
- Prior A3/A2 evidence and the previous active ledger remain in Git history at the verified base; [A1 evidence](ASTRA_A1_PRODUCT_EVIDENCE.md), [A2 LIVE evidence](ASTRA_A2_LIVE_EVIDENCE.md), and [A3 decisions](ASTRA_A3_STAY_EXTENSION_DECISION.md) retain their original acceptance scope.

## Frozen continuation seam

1. The immutable selected effects keep their source index and a key-order-stable fingerprint on persisted ActionIntents. No reduced strategy is recompiled to invent a new plan.
2. The application owns PostgreSQL capture, the production M6 evaluator registry, bound research inputs and the clock. A continuation request names only the selected plan and next intent.
3. A successful external observation is insufficient. Exact attempt / observation / intent / source-effect identities must reach a committed matching canonical application.
4. Canonical preparation receipts are also accounted: the existing flight path creates service/reservation/allocation records in separate transactions, including traveller-scope advances. No blanket Journey/traveller exemption is permitted.
5. Every relevant revision/scope increment since approval must form an exact explained chain. Only the already accepted narrow budget-hold bookkeeping exception is retained.
6. A checkpoint binds plan, strategy, next intent, complete source identity, exact residual, fresh manifest, bound inputs, canonical prerequisite receipts and expiry. It is not new authority or a provider dispatch token.
7. Existing authority, revocation, funding, protected-input and provider-verification gates still apply. Unknown outcomes permit reconciliation only, never redispatch.
8. No workflow engine, scheduler, compensation system, automatic replanning or hotel executor is introduced.

## Acceptance evidence to produce

- A: observed-success flight without canonical application -> successor BLOCKED.
- B: exact successful observation + committed matching application + authoritative viable residual -> successor may pass the continuation gate; ordinary authority/execution gates still apply.
- C: B plus unrelated Journey mutation -> BLOCKED / new decision required.
- D: unknown provider outcome -> reconciliation only; successor blocked; no redispatch.
- E: wrong receipt / plan / strategy / effect / source kind -> REFUSED.
- F: changed approved provider price / currency / identity / material terms -> old authority does not silently authorize the change.
- Include a materially different synthetic selected-plan shape, without demo-specific branches.

## Active checklist

- [x] Read mandatory docs and current code; verify exact base; create isolated branch.
- [x] Inspect WIP and identify caller-world, checkpoint-binding and canonical-receipt gaps.
- [x] Author pure stable-effect identity, exact residual and contiguous-change checks.
- [x] Execute 14 isolated identity/residual/change-chain smoke assertions; parse the two new pure TypeScript modules with Node type stripping.
- [ ] Persist source identities and read-only source-backed evaluation inputs.
- [ ] Implement transaction-owned canonical receipt linkage and external dependency safety.
- [ ] Compose authoritative capture + production residual evaluation + immutable checkpoint and stored-gate validation.
- [ ] Wire the existing Atlas observed-success canonical application; do not rewrite provider execution.
- [ ] Author exact PostgreSQL A-F tests and alternate plan-shape proof; classify tests in the suite manifest.
- [ ] Inspect exact-path diff, static syntax/contracts, no hotel/UI code or secrets/generated artifacts; push implementation checkpoint.
- [ ] Hand local verifier exact focused commands and reconcile this ledger before final report.

## Verification limitations

- Direct repository cloning is unavailable in this Chat environment (DNS failure); GitHub connector reads/writes work.
- The 14 smoke assertions exercise pure functions only. They are not PostgreSQL, production runtime, provider, build, lint or full-repository typecheck proof.
- No PostgreSQL tests, full typecheck, build, lint, browser scenario or provider execution have been run for this candidate.
- Use exact-file Node tests for local iteration. Do not use `npm test -- file` (the wrapper runs the broader current suite).

## A3 carry-forward defects — Park for Later, not this checkpoint

- reliable operator/demo disruption trigger disappeared
- Jordan progressive delay stages are not visibly/properly wired
- V5.6 Jordan semantic state appears wrong in places, e.g. amber when the connection is already impossible
- some V5.6 causal edges appear missing/inconsistent
- hotel/cancellation/FX displayed cost provenance needs later end-to-end verification
- graphs should move above other Case/Overview blocks before final presentation
- final wording / wall-of-text pass remains
- Overview traveller-focus behavior needs final scenario QC

## Triage / next checkpoint

- **Act Now:** finish the bounded continuation implementation and tests on this branch.
- **Investigate Now:** receipt ownership, all source-basis scope advances, PostgreSQL fresh-capture consistency and preservation of current authority/funding gates.
- **Park for Later (Checkpoint 3):** stay binding SQL, Nuitée book/cancel dispatcher, stay reconciliation, cancellation command validation and hotel boot composition.
- **Ignore / Accept Risk for this Chat candidate:** unavailable local PostgreSQL/browser execution; acceptance stays withheld until the local verifier runs the exact proof.
- Exact next implementation step: source-identity persistence, transaction-linked canonical proof and root-owned continuation composition. Do not start Checkpoint 3.
