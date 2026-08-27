# ACTIVE_TASK — demo screen choreography recovery

## Goal

Finish/reconcile existing `docs/DEMO_SCREEN_CHOREOGRAPHY.md` without rewriting the Sol draft or changing product code.

## Base / branch

- Base SHA: `9a9921cb06c54ee3b7c257947756f3a254cd668a`
- Branch: `rescue/demo-screen-choreography-recovery`
- Recovered draft commit: `02f8892613377d8a5ed5992bc39681487ed0118e`
- Reconciled choreography commit: `5e26e51fadf895c38a5fbe324df34b9ee5f205c0`

## Reconciliation checklist

- [x] Read/reconcile `docs/SCENARIOS.md`
- [x] Read/reconcile `docs/FINAL_DEMO_CONTENT_SSOT.md`
- [x] Read/reconcile `docs/UI_VISUAL_DIRECTION.md`
- [x] Read/reconcile `docs/FINAL_DEMO_INTEGRATION_PLAN.md`
- [x] Verify Jordan S2 choreography and mixed ingress truth
- [x] Verify Sarah S1→S3 continuous choreography and same-trip `NOT_VIABLE → VIABLE`
- [x] Verify Oliver S7 topology, FX, authority, and evidence-scoped option wording
- [x] Verify Jonas S5 hotel-only scope, traveller authority, and funding split
- [x] Verify capability claims against current UI/application/read-model/execution code
- [x] Reconcile LIVE / SANDBOX / RECORD / REPLAY / REPORTED / SIMULATED wording
- [x] Reconcile cast, flights, hotels, programme times, and `67 total / 42 managed / 25 local/self`
- [x] Reconcile organiser vs traveller authority and funding behaviour
- [x] Verify current-screen mapping against current UI code
- [x] Reconcile Generic+Easy / Generic+Nontrivial / Simulate / Do Not Do decisions
- [x] Reconcile implementation checklist coverage
- [x] Fix wrong Wanderpay names
- [x] Fix “67 managed arrivals” wording
- [x] Fix C6 programme-preview reference to recovered E1 Now/Proposed reference
- [x] Fix Sarah current headline window to `09:20–09:50`
- [x] Fix S2 provider-event vs traveller-report ingress wording
- [x] Gate Oliver `US$163.98` candidate on normalized route evidence instead of calling it a proven direct option
- [x] Preserve the existing choreography structure; no scenario redesign and no expansion to S4/S6/S8
- [x] Documentation-only change; no product/domain code modified

## Verification evidence

- S2 manifest proves progressive `SIMULATED_EXTERNAL_EVENT` Atlas-shaped observations **and** later traveller-state missed-flight ingress; current traveller report already names the 08:20 next-morning reprotection, so TR885 must not be called inadequate.
- S1→S3 continuity manifest proves one reset, Sarah `NOT_VIABLE`, mutation-free 15:30–16:00 preview, explicit organiser commit, fan-out on the same trip ID, then `VIABLE`.
- S7 manifest proves the preferred HND→SIN option at `US$143.62`, home-policy `S$193.89`, `REQUIRES_HUMAN_AGENT`, organisation approval, execution, and resolution. It does not prove the `US$163.98` candidate as a direct alternative.
- S5 manifest proves Nuitée REPLAY search, traveller-funded increment, `REQUIRES_TRAVELLER`, traveller approval, simulated external execution, and resolved/VIABLE outcome. It also exposes the current `Switch stay to ...` strategy wording and checkout-baseline drift that must be fixed before the hero is truthful.
- `src/ui/screens/operator-case.ts` confirms the generic options action branch can shadow the later approved-state `Execute approved recovery` branch.
- `src/ui/programme-change-interaction.ts` confirms preview and commit call real application APIs, preview is mutation-free, commit propagates/rechecks, and the current success/reload treatment is too fleeting for the intended terminal choreography.
- `src/ui/case-resolution-interaction.ts` confirms current client-side presentation uses `sessionStorage` plus fixed timers; those cannot be treated as authoritative orchestration evidence.
- `src/app/demoHeroes.ts` confirms final hero order S2 → S1→S3 → S7 → S5 and correct stop-before-authority rehearsal boundaries.
- `src/app/providerExecution.ts` confirms deterministic authority is rechecked before provider calls and REPLAY can fall back to the explicit simulation executor; provider success remains execution evidence, not trip recovery.
- `docs/DEMO.md` confirms provenance definitions: LIVE, SANDBOX, RECORD, REPLAY, SIMULATED; routine demo is REPLAY by default and simulated external actions must be disclosed.

## Remaining implementation gaps

These are intentionally **not** fixed in this documentation-only recovery. Full triage and acceptance checks live in `docs/DEMO_SCREEN_CHOREOGRAPHY.md`.

### Act Now

- Approved Jordan/Oliver Case CTA ordering blocks judge-facing Execute.
- Sarah post-commit UI stays visibly disrupted despite same-trip viability becoming `VIABLE`.
- Jonas planner/read model currently produces hotel-switch strategies instead of a truthful Concorde extension.
- Browser rehearsal can false-pass without proving execute/commit, observed authoritative values, terminal state, and revisit correctness.
- Option consequence/funding/authority presentation, role-correct traveller action, currency clarity, commitment semantics, and evidence-driven progress remain incomplete.

### Investigate Now

- S2 desired “inadequate airline reprotection” conflicts with the current traveller-reported viable TR885; change only a labelled external fixture if that contrast is kept.
- S1 continuity currently narrates travel-only insufficiency without a genuine pre-commit search in the continuity path; wire evidence or use a bounded REPLAY presentation and soften claims.
- Jonas current checkout evidence drifts from canonical `3 Oct 11:00`.
- Oliver preserved LHR return is not yet projected safely end-to-end.
- Oliver `US$163.98` route/directness requires normalized evidence before promotion.

### Park / Accept Risk

- Jonas combined hotel + return-flight change remains deferred.
- Jordan transit hotel, Japan immigration, and insurance execution remain out of the closed hero.
- Oliver transfer is unrepresented and must stay unclaimed.
- Live ticketing/hotel modification remains unavailable; disclosed simulated provider execution is acceptable for the closed demo.

## Current checkpoint

Recovery reconciliation is complete. `docs/DEMO_SCREEN_CHOREOGRAPHY.md` is internally reconciled and implementation-ready as a documentation contract. No product code was changed.

## Next action

Use `docs/DEMO_SCREEN_CHOREOGRAPHY.md` as the implementation/rehearsal contract. Do not reopen scenario design from this recovery task.
