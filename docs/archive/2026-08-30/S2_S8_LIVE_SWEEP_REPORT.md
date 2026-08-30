# S2–S8 LIVE/RECORD Sweep Report

- **Branch:** `codex/s1-ui-recovery` — head `3a56158` (all sweep commits pushed to origin)
- **Sweep window:** 2026-08-26 (continuation of the S1 RECORD/REPLAY proof)
- **Objective:** discover how far the real Northstar pipeline goes with the providers and capabilities actually available: Atlas sandbox, Nuitée/liteAPI sandbox, Alibaba Model Studio (Qwen), Google Routes. LIVE and RECORD/REPLAY share the same normalization and engine paths; nothing bypasses `AI proposal → validation → deterministic viability → authority → executor → observe → state update`.
- **Cumulative gate at sweep end:** typecheck clean · anti-hardcoding gate CLEAN (73 files) · secret scan CLEAN (232 files) · full suite **621 pass / 0 fail**.

Sweep commits, oldest → newest:

| Commit | Scenario | Subject |
|---|---|---|
| `2e5632a` | S2 unlock | planner prompt schema discipline + per-item fail-closed mapping |
| `1b974e1` | S2 | LIVE planner + Atlas RECORD proof with honest-truth manifest |
| `3965cc5` | S3 | organiser programme change RECORD proof through the honest live ceiling |
| `2e085bc` | S4 | Thursday-morning arrival RECORD proof — LIVE NL intake + honest deterministic rejection |
| `9bb7b27` | S5 | LIVE stay-extension intake + RECORD return corridor |
| `c79b607` | S6 | LIVE hotel-switch intake + RECORD occupancy-aware Nuitée search |
| `f372a39` | S7 | LIVE Tokyo-origin correction through the honest authority ceiling |
| `80df563` | S8 | LIVE association intake + deterministic TRANSPORT_CONCENTRATION rejection |
| `3a56158` | hygiene | generalize intake prompt worked examples to neutral ids (anti-hardcoding gate) |

## Headline finding

Every scenario reached the deepest stage its evidence allows. The single shared ceiling is **deliberate, test-enforced, and honest**: curated organiser policy ceilings are SGD-denominated while the live Atlas sandbox quotes USD, so per **ADR-045** every live money-moving `begin` call fails CLOSED ("not deterministically comparable" — no FX invention). Execution/observation of money-moving changes is demonstrated today through the curated SGD REPLAY corpus, which traverses the identical normalization/engine path. Nothing in the sweep was blocked by application wiring that was not fixed generically during the sweep.

---

## Per-scenario findings

### S2 — Missed connection / airline reprotection — PARTIAL by design (honest no-feasible-recovery)

**Manifest:** `fixtures/acceptance/manifests/s2-missed-connection-record.json`
**Runs:** RECORD `run_fb84894a6a374142` green · REPLAY `run_6a52f1cf9a05409b` green.

- LIVE Model Studio planner ran **2 planning rounds** against live providers; produced **3 strategies**.
- Atlas RECORD evidence captured and sanitized: search (**18 KUL–SIN offers**), verify (**VERIFIED**), fare_rules, cancel_quote.
- Deterministic viability **rejected all 3 strategies** with CONSTRAINT evidence — arrival-gap arithmetic vs the 360-minute programme buffer. No feasible candidate, no `bestStrategyId`; the case ends `PLANNING` with explicit uncertainties. This is the correct product behaviour: evidence-backed rejection, not invention.
- REPLAY from the resulting recordings is green through the same normalization/engine path.

**Generic fixes unlocked (committed in `2e5632a` / `1b974e1`):**

- `hasLiveCredentials('modelStudio')` no longer demands an explicit model — key-only env is LIVE-reachable (parity with the Nuitée rule); adds `MODEL_STUDIO_TIMEOUT_MS`.
- Model Studio runtime timeout raised to 90 s (30 s default broke multi-round LIVE planning); bounded retry unchanged.
- Planner prompt schema discipline: exact output shape, parameter shapes, element payload skeleton, elementKind/tripId fidelity, UPSERT_FACT steering, per-item fail-closed mapping with payload pre-validation and visible issue paths.
- Acceptance runner evidence summarize caps raised (60k/10k) so large plan responses stay inspectable.

**Errors:** Google Routes returned `invalid_routing_query` for the ground-transfer timing query; deterministic buffer fallback engaged and the scenario continued. See error register E1.

### S3 — Organiser programme change (preview → commit → fan-out) — PARTIAL (blocked at authority)

**Manifest:** `fixtures/acceptance/manifests/s3-organiser-preview-record.json`
**Runs:** RECORD `run_1e2221f8892d40fd` green · REPLAY-of-record `run_f5a93957163845a9` green.

- Deterministic reset → counterfactual **preview with zero authoritative mutation** (proven by assertion) → organiser **commit** → **fan-out** → fan-out case planning with RECORD-mode Atlas corridor evidence (TYE corridor arrival options; new sanitized Atlas search recording) → **authority stage**.
- Authority result: intent **BLOCKED**, case **ESCALATED**, execution never attempted — SGD hard airfare ceiling incomparable with live USD quotes, fail-closed per ADR-045.
- **ADR-037 funding allocation still resolved** the fare to the event-funded baseline before the block, i.e. policy arithmetic runs right up to the currency boundary.
- This scenario reached the deepest live stage of any money-moving scenario in the sweep.

### S4 — "Can I arrive Thursday morning?" — PASSED (honest rejection of cheap, available offers)

**Manifest:** `fixtures/acceptance/manifests/s4-thursday-morning-arrival-record.json`
**Runs:** RECORD `run_a44c13c85b004a60` green · REPLAY-of-record `run_d9417791d0554099` green.

- LIVE Model Studio NL intake (qwen-flash) extracted `ADJUST_TRIP_WINDOW` / `SOFT_PREFERENCE` into the frozen ChangeRequest schema, zod-validated.
- LIVE Atlas corridor evidence (CNX–SIN 2026-10-01) persisted as a sanitized recording; the Northstar window-shift branch enumerated the **two real corridor offers**.
- Deterministic viability **rejected BOTH** with CONSTRAINT evidence (arrival-before gaps −2070 / −3625 min vs required 360 min).
- The sweep's key proof for S4: **available, cheap offers can still be rejected** — no `bestStrategyId` is ever ranked; the case stays `PLANNING` with rejection evidence visible on the case detail.

### S5 — "Can I stay until Sunday?" — PARTIAL (blocked at authority begin)

**Manifest:** `fixtures/acceptance/manifests/s5-stay-until-sunday-record.json`
**Runs:** RECORD `run_d3a4647d` green · REPLAY `run_d0f60ca8` green (first pinned run `run_c36c8ba1`).

- LIVE Model Studio stay-extension intake, including the **TRAVELLER_FUNDED** declaration extracted from natural language.
- Atlas RECORD: AMS→SIN exploration recording `rec_121126f5` and SIN→AMS return-corridor recording `rec_678b3eb8` (both verified untracked-then-committed, sanitized).
- `begin` result: RECORD mode fails closed on **SGD-limit vs USD-spend incomparability** (ADR-045); REPLAY mode blocks on the curated SGD ceilings — hotel spend 468 exceeds the per-night limit 320; `ruleTrace.0` contains `rule-ait-airfare-spend-limit`. Case `ESCALATED`.
- **Manifest hardening:** begin assertions made **mode-agnostic** (outcome BLOCKED, executable false, caseStatus ESCALATED, rule trace) because RECORD and REPLAY legitimately block on different-but-honest reasons. This pattern was reused for S7.

### S6 — "Can I switch hotels? My partner is joining." — PARTIAL (engine gap surfaced honestly)

**Manifest:** `fixtures/acceptance/manifests/s6-switch-hotels-record.json`
**Runs:** RECORD `run_4fff8358` green (8.0 s, live model extraction) · REPLAY green · baseline S6 REPLAY re-verified.

- **Generic fix #4 (category 4):** the frozen contract already had `guests` / `preferredStayPlaceId` / `travelWithTravellerIds`, but the NL intake surface did not expose them. Added `guests` + `preferredStayPlaceId` to the model schema/prompt and deterministic Pattern 7 (hotel-switch verb + `\d+ of us/guests/people` occupancy + quoted `place-…` id) — with the established **quote-discipline**: the interpreter carries entity ids only when the traveller literally states them; whether they resolve is the engine's question.
- LIVE Nuitée **occupancy-aware search** via place coordinates: **175 properties / 524 rates**, saved as recording `rec_1b93b067`. Hash-collision analysis: none (curated corpus search is adults=1, sweep search adults=2 → distinct recording).
- Result: hotel.search round OK; **0 strategies** (honest engine gap — see G1/G2); 3 pinned uncertainties including "funding allocation UNKNOWN: no temporal anchor in target"; case `PLANNING`.
- Prior `nuitee_location_not_mappable` failures were explained: they came from non-coordinate stay places. The coordinate-based flow works well.

### S7 — "I'm actually flying from Tokyo, not London." — PARTIAL (feasible plan blocked at authority)

**Manifest:** `fixtures/acceptance/manifests/s7-origin-tokyo-record.json`
**Runs:** RECORD `run_55afbe66` green (2.0 s) · REPLAY green.

- LIVE Model Studio semantic extraction of the origin correction; obsolete origin/corridor superseded.
- LIVE Atlas HND→SIN replacement search: **TR883 143.62 USD / VJ821 163.98 USD — both feasible at planning**. Recording `rec_f23d573b` (its sha256-derived id matched a pre-computed hash, confirming the deterministic recording-key scheme).
- `begin` BLOCKED at the ADR-045 ceiling; the **unresolved return destination remains an explicit uncertainty — ask/escalate rather than invent**.
- REPLAY resolves through the curated RTG-SYN-HNDSIN SGD recordings living in `fixtures/recordings` (the ordered second read root after runtime `recordings/`).

### S8 — "Can I travel with the other speakers?" — PASSED (complete policy loop, no provider calls by design)

**Manifest:** `fixtures/acceptance/manifests/s8-travel-with-speakers-record.json`
**Runs:** RECORD `run_d655b3fe` green (1.7 s, live model intake) · REPLAY `run_55196d54` green (deterministic Pattern 8 parity) · baseline S8 REPLAY re-verified (`run_c438d397`).

- **Generic fix #5 (category 4):** `travelWithTravellerIds` added to model schema/prompt (quoted ids only, mirroring departureOrigin/place-id discipline) + deterministic Pattern 8 (`travel with` / `same flight` trigger plus quoted `trv-…` identifiers).
- LIVE Model Studio intake extracted `CHANGE_TRANSPORT_SCHEDULE` with the two literally quoted peer traveller ids — zod-validated, provenance `INTERPRETED`.
- Deterministic **TRANSPORT_CONCENTRATION** policy assessed the association at request resolution: **3 critical travellers exceed the limit of 2 — the grouping is NOT permitted**. No S8-specific engine branches.
- The violation is recorded as a HIGH-severity alternative-required uncertainty ("an alternative arrangement is required"); the case stays open (`CHANGE_REQUESTED`) for alternative planning instead of silently dropping the desire.
- Preflight note: added an honest RECORD boundary entry declaring that this policy-rejection scenario gathers no provider evidence (run-mode coverage requirement).

---

## Error register

Identifiers reference acceptance run ids; all errors were recorded in evidence JSON under `output/acceptance-sweep-record/` and `output/acceptance-sweep-replay-of-record/`. No secret material was logged.

| # | Scenario | Provider/component | Operation | Mode | Error | Retry | Fallback | Continued | Root cause | Category |
|---|---|---|---|---|---|---|---|---|---|---|
| E1 | S2 | Google Routes | route timing query | LIVE | `invalid_routing_query` | no | deterministic buffer arithmetic | yes | query shape rejected by the Routes API for the requested OD/timing context | 1 PROVIDER LIMITATION |
| E2 | S3/S5/S7 | deterministic authority | `begin` spend check | LIVE (RECORD) | "not deterministically comparable" — SGD policy ceiling vs USD live quote | n/a | none by design (fail-closed, ADR-045) | yes — case ESCALATED | curated policy data currency ≠ live sandbox currency; FX invention prohibited | 6 AUTHORITY/SAFETY BLOCK |
| E3 | S5 | deterministic authority | `begin` hotel check | REPLAY | hotel spend 468 exceeds per-night limit 320 | n/a | none by design | yes — case ESCALATED | curated SGD ceilings applied honestly to curated evidence | 6 AUTHORITY/SAFETY BLOCK |
| E4 | S6 | engine/planner | strategy generation | RECORD | 0 strategies for hotel cancel-and-replace | n/a | surfaced as uncertainties, not fabricated | yes — case PLANNING | hotel replacement strategy generation not implemented | 5 ENGINE CAPABILITY GAP |
| E5 | S8 | acceptance preflight | `boundaries_cover_run_mode` | RECORD | run mode RECORD not listed in boundaries | yes (1 manifest edit) | honest RECORD coverage boundary entry | yes | policy-only scenario had only a LIVE boundary declared | 4 GENERIC APPLICATION WIRING BUG (fixed) |
| E6 | hygiene | anti-hardcoding gate | scan | n/a | FORBIDDEN-TOKEN `evt-ait-` in intake prompt worked example | yes (1 edit) | examples generalized to neutral ids | yes | S8 worked example quoted real fixture traveller ids | 4 GENERIC APPLICATION WIRING BUG (fixed) |
| E7 | pre-existing | Nuitée | location mapping | LIVE | `nuitee_location_not_mappable` | n/a | coordinate-based flow | yes | non-coordinate stay places; coordinate flow resolves it | 3 DATA/FIXTURE GAP |

Harness-level notes (not application defects): `node -e` and parenthesized `git commit -m` messages are mangled by PowerShell — scratch `.mjs` files and `git commit -F` message files were used throughout; tests run via `node --test` (vitest picks up `.worktrees` copies and must not be used).

---

## Cross-cutting analysis

### Providers

- **Atlas sandbox — strongest performer.** search / verify (VERIFIED) / fare_rules / cancel_quote all recorded cleanly across S2–S7. Live inventory and pricing are realistic; the only friction is currency (USD) vs curated SGD policy ceilings, which is a data/policy decision, not an Atlas defect.
- **Nuitée/liteAPI — works well via coordinates.** Occupancy-aware search returned 175 properties / 524 rates in S6. Earlier `nuitee_location_not_mappable` failures were attributable to non-coordinate stay places (E7).
- **Model Studio (Qwen) — reliable at every assigned responsibility.** Messy NL intake into the frozen schema (S4–S8), multi-round strategy generation (S2), uncertainty detection, funding declarations, and quote-disciplined entity ids. Every extraction zod-validated. Required fixes were harness-side (timeout) and prompt-side (schema discipline), not capability-side.
- **Google Routes — the weakest link this sweep.** Live query rejected (`invalid_routing_query`, E1); deterministic buffers stood in, so no viability verdict depended on it. Recorded as Investigate Now, not disabled.

### Where Model Studio materially improved the pipeline

Natural-language intake for every traveller scenario (S4–S8) — including self-funding declarations, "2 of us" occupancy, quoted place-ids and quoted peer traveller ids — plus multi-round recovery strategy generation in S2. Without it, these scenarios would have required pre-structured requests and would not have proven the `AI proposal → validation` seam.

### Where Google Routes materially changed viability

Nowhere this sweep — its live calls failed query validation and deterministic buffers stood in. Viability verdicts stand on deterministic arithmetic either way; Routes remains an evidence enrichment, not a dependency.

### Provider/data limitations vs genuine engine gaps

- **Provider/data limitations:** SGD-vs-USD ceiling incomparability (data/policy choice), Google Routes query rejection, live inventory specifics in recordings.
- **Genuine engine capability gaps (surfaced as uncertainties, never fabricated):**
  - **G1** Hotel replacement strategy generation (cancel-and-replace) — S6 searches live inventory but the planner emits 0 strategies.
  - **G2** Stay-date replanning after a hotel switch — companion to G1.
  - **G3** Airline reprotection ingestion from provider-sourced events was exercised via traveller report + reconciliation (S2); the airline-feed variant remains curated-only.

### Generic fixes delivered (multi-scenario unlocks)

1. Planner prompt schema discipline + per-item fail-closed mapping + 90 s timeout — unblocked all LIVE multi-round planning (proven S2).
2. `hasLiveCredentials('modelStudio')` key-only parity + `MODEL_STUDIO_TIMEOUT_MS`.
3. Intake stay-extension field guidance — unlocked S5.
4. Intake `guests` + `preferredStayPlaceId` (quote-disciplined) — unlocked S6.
5. Intake `travelWithTravellerIds` (quote-disciplined) — unlocked S8.
6. Mode-agnostic `begin` assertion pattern — stabilizes every money-moving RECORD/REPLAY manifest pair (S5, S7).

### Recording integrity

- Recordings keyed by `sha256(provider|operation|canonicalJson(request))`; RECORD always calls live, then persists. `FileRecordingStore` reads runtime `recordings/` first, curated `fixtures/recordings` second.
- No recording payload was idealized during the sweep; where real data was insufficient (e.g., no feasible S2 candidate), that fact is the pinned assertion.
- Hash-collision checks performed before every commit that added recordings (S6: none — occupancy differs from curated; S7: predicted hash matched).
- Secret scan CLEAN on all sweep commits.

---

## Answers to the twelve mandated questions

1. **End-to-end scenarios:** none reached live money-moving execution — that boundary is deliberately fail-closed (ADR-045). **S8 completed its full intended loop** (intake → policy → rejection → case state). **S3 completed everything up to and including authority** (preview → zero-mutation proof → commit → fan-out → BLOCKED/ESCALATED). The execution/observation tail is demonstrated via the curated SGD REPLAY corpus through the identical engine path.
2. **Surprisingly far:** **S7** — both Tokyo replacement offers genuinely feasible at planning, stopped only at the honest authority ceiling, with the unresolved return destination surfaced as an explicit uncertainty. **S5** — intake → funded baseline → traveller increment → corridor evidence → authority in one flow. **S6** — live occupancy-aware Nuitée search (175 properties / 524 rates) despite earlier mapping failures.
3. **Providers that worked well:** Atlas (best: full search/verify/fare_rules/cancel_quote surface), Nuitée coordinate search, Model Studio (intake + planning, all zod-validated).
4. **Failed provider calls:** Google Routes `invalid_routing_query` (S2 era; fallback used; Investigate Now). Nuitée `nuitee_location_not_mappable` only for non-coordinate places (data gap, coordinate flow works).
5. **Model Studio material improvements:** all NL intake S4–S8; multi-round strategy generation S2; uncertainty and funding extraction. It proved the `AI proposal → validation` seam with real model output every time.
6. **Google Routes viability impact:** none demonstrated this sweep (query failures; deterministic buffers stood in).
7. **Provider/data limitations:** SGD/USD currency mismatch, Routes query rejection, live inventory specifics — categories 1/3.
8. **Genuine engine/application gaps:** G1 hotel replacement strategy generation, G2 stay-date replanning (category 5); intake wiring gaps found en route were category 4 and fixed generically.
9. **Fixes unlocking multiple scenarios:** the three intake surface completions (S5/S6/S8), planner schema discipline + timeout (all LIVE planning), mode-agnostic begin assertions (all money-moving manifests).
10. **Strongest for the final video:** **S3** (richest full-pipeline organiser story: preview → zero-mutation → commit → fan-out → honest escalation), **S8** (fast, fully deterministic policy rejection naming the next step), **S7** (feasible replacement blocked only at the honest money boundary with ask-don't-invent).
11. **Scenarios requiring curated REPLAY for the product story:** any story that must show approval + execution + observed state update with money semantics (S3/S5/S7 execution tails) — the curated SGD corpus already does this; live USD sandbox spend cannot pass SGD ceilings without a deliberate FX/policy-currency decision.
12. **Smallest remaining work before a full clean rerun:**
    1. One product/data decision: align policy ceilings with the live sandbox currency, or add an approved FX rule via DECISIONS.md — converts S3/S5/S7 from honest-BLOCKED to executable live.
    2. Fix the Google Routes query shape in the routing adapter.
    3. Optional: hotel replacement strategy generation (G1) for the deeper S6 story.
    Everything else is green: every sweep manifest passes in RECORD and REPLAY-of-record, baselines re-verified, 621/621 tests, all gates clean. A clean rerun is one acceptance-runner invocation per manifest.

## Classifications summary

| Finding | Classification |
|---|---|
| ADR-045 SGD/USD authority block (E2/E3) | Park for Later — deliberate, test-enforced; needs a product decision (FX rule or policy-currency alignment) before live execution demos |
| Google Routes `invalid_routing_query` (E1) | Investigate Now |
| Hotel replacement strategy generation (G1) + stay replanning (G2) | Park for Later |
| Nuitée non-coordinate locations (E7) | Park for Later |
| Intake wiring gaps (fixed during sweep) | Act Now → done (commits within sweep) |
| S2 no-feasible-candidate outcome | Ignore / Accept Risk — scenario-intended honest rejection |

## Scope discipline

No UI polishing, no formal review, no Wave 4 work was started during this sweep. All intentionally excluded capabilities remain in `docs/ROADMAP.md`.

**STATUS: S2–S8 LIVE/RECORD SWEEP COMPLETE**
