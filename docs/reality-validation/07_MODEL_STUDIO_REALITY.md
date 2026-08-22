# 07 — Model Studio Reality (FR-07, NFR-04)

> Reality-Validation milestone · investigation only · no product code changes.
> Author: bounded investigator lane · Date: 2026-08-22.

## Executive summary

The Atlas × Alibaba hackathon uses Alibaba Cloud Model Studio (DashScope-compatible chat-completions) for two lanes: **ingestion extraction** (`src/app/extraction.ts` + `src/ingest/semantic.ts`) and **D2/D3 semantic + recovery planning** (`src/intelligence/`). The D1 client (`src/intelligence/client.ts`) is a small, OpenAI-compatible shim: it is **fail-closed at every boundary** (no fabricated strategies, no guessed JSON, no credentials in errors, no retry on `INVALID_OUTPUT`).

This sandbox has **no Model Studio credentials** (`MODEL_STUDIO_API_KEY` / `DASHSCOPE_API_KEY` / `QWEN_*` are all unset; only the unrelated `ALIBABA_CLOUD_*` OSS keys are present). Live calls were therefore **not** executed. Instead, this report (a) audits the implemented client/semantics/planner/fallback path against `FR-07` / `NFR-04` / `docs/DEMO.md`; (b) maps each product task to its schema-gated risk profile; (c) produces an executable empirical test plan (prompts, fixtures, rubric) for when credentials land; (d) recommends per-task model tiers aligned with `docs/AGENT_MODEL_SELECTION.md §10` and §13.

**Bottom line.** Plumbing is already cheap-by-default (`qwen-flash` in `client.ts:28`), the deterministic fallback planner keeps the REPLAY demo honest without any model call (`docs/DEMO.md` lines 71-78), and the seven extraction tasks plus four semantic tasks plus the recovery planner all validate strict Zod output before any downstream consumption. The realistic risk is **schema strictness vs. model verbosity** (chatty prose that fails `parseModelJson`) and **omission vs. hallucination** on low-context documents (insurance/policy clauses). Tier choice should track *schema strictness and reversibility*, not absolute difficulty.

## 1. Credential situation

```
$ printenv | grep -i -E 'model_studio|dashscope|qwen|alibaba'
ALIBABA_CLOUD_SECURITY_TOKEN=   # unrelated: Alibaba Cloud OSS/RAM, not Model Studio
ALIBABA_CLOUD_ACCESS_KEY_ID=    # unrelated
ALIBABA_CLOUD_ACCESS_KEY_SECRET=# unrelated
```

- `MODEL_STUDIO_API_KEY` — **unset**.
- `MODEL_STUDIO_BASE_URL` — unset, code default `https://dashscope.aliyuncs.com/compatible-mode/v1` (`client.ts:26`).
- `MODEL_STUDIO_MODEL` — unset, code default `qwen-flash` (`client.ts:28`).
- No `DASHSCOPE_API_KEY` or any `QWEN_*` credential.

**Implication.** The `ModelStudioClient` constructed without an API key uses `UnconfiguredModelTransport` (`client.ts:201-212`); every call returns a structured `{ ok: false, error: { category: 'NOT_CONFIGURED', code: 'model_studio_credentials_missing' } }` and never hits the network. Therefore:

1. The recovery loop in this sandbox is already proven via the **deterministic fallback planner** (`fallbackPlanner.ts`), and tests inject `ScriptedModelTransport` to exercise the model path without a key (`client.ts:176-194`). This matches `docs/DEMO.md` "credential-free planner honesty" exactly.
2. No live empirical results are possible here. The empirical pass deferred to §6 is the actionable artefact for the eventual `LIVE` run.
3. The AGENT_MODEL_SELECTION guidance is unchanged: keep the model default cheap until quality evidence demands an upgrade.

## 2. Implemented-intelligence audit (what the code enforces today)

### 2.1 D1 client (`src/intelligence/client.ts`)

| Rule | Where | Why it matters for NFR-04 |
|---|---|---|
| `UnconfiguredModelTransport` returns structured `NOT_CONFIGURED`; client never throws at construction | `client.ts:201-212`, `client.ts:280-290` | Core loop is runnable with zero credentials (NFR-03, `docs/DEMO.md`). |
| `parseModelJson` tolerates code fences / surrounding prose but returns `undefined` on failure — no guessing | `client.ts:372-391` | JSON wrapping is the single largest silent-failure class; refusing to repair prevents `INVALID_OUTPUT` from being laundered into `ok:true`. |
| `safeParse` validates against the per-task Zod schema; **unknown keys rejected** (all schemas use `z.strictObject`) | every schema in `schemas.ts`, every DTO in `ingest/semantic.ts` | The model cannot smuggle an `ActionIntent` field into planner output. Defence in depth is re-asserted in `planner.ts:120-124` against `PLANNER_OUTPUT_ALLOWED_KEYS`. |
| Bounded retry only for retryable transport categories; `INVALID_OUTPUT` is never retried | `client.ts:322, 328-352` | A persistent schema failure must surface, not silently absorb budget. |
| API key never appears in `ModelError.message`, `meta`, or transport errors | `client.ts:88-100, 140-159, 318-321` | NFR-04 leak boundary. |
| Default model `qwen-flash`; default 30s timeout, 2 attempts | `client.ts:28, 238-239` | Cheap plumbing model, low blast radius on misconfig. |
| `responseFormat: 'json_object'` always requested | `client.ts:77, 133-137` | The endpoint is asked for JSON; the client still validates structurally because DashScope is not contractually strict. |

### 2.2 D2 extraction (Lane B → Lane D, `src/app/extraction.ts`, `src/ingest/semantic.ts`)

- One extraction client wraps the model client (`extraction.ts:36-52`); per-task schemas are looked up via `EXTRACTION_OUTPUT_SCHEMA[request.task]` (no `as any` shortcuts).
- All extraction DTOs use `z.strictObject` and **all fields are `.optional()`** except `kind`/`statement` (semantic.ts:65-180). This is deliberate: the model is rewarded for *omission* rather than fabrication when the source is silent. NFR-04 is met by `validateExtraction` returning `{ ok: false, issues: [...] }` (semantic.ts:186-194), which Lane B then surfaces as uncertainty in the ingestion artifact — never as a guessed value.
- Per source kind, candidate tasks are tried in order (`EXTRACTION_TASKS_BY_KIND`, semantic.ts:201-212). For `BOOKING_CONFIRMATION` both `FLIGHT_BOOKING` and `STAY_BOOKING` are attempted, so one email with mixed content exercises both schemas.

### 2.3 D2 semantics (`src/intelligence/semantics.ts`)

- Five tasks: `interpretObjective`, `interpretExplicitInstructions`, `inferLatentPreferenceCandidates`, `assessConsequences`, `identifyUncertainties`. Each has a system prompt that *bans guessing* and *requires the `insufficientEvidence` / `none` flags* when evidence is missing.
- Deterministic `resolvePreferences` (semantics.ts:153-205) and `interpretResearchFindings` (semantics.ts:219-255) are model-free: they only normalize, rank and reject — they cannot introduce fabrication even if the model is wrong.
- Accessibility / legal-entry items are *reclassified as requirements* by `resolvePreferences` regardless of how the model labelled them, so a misclassification cannot downgrade a wheelchair request to a "soft preference" (semantics.ts:160-162 + ADR-014).

### 2.4 D2 research (`src/intelligence/research.ts`)

- `ResearchService.toResearchFindings` (research.ts:191-222) downgrades any `LEGAL_ENTRY_FACT` lacking `AUTHORITATIVE` + `sourceUris` to `INFERRED` with the rejection reason as uncertainty. This is the single most important NFR-04 property: a model that asserts "visa-free for 30 days" without a URL is *never* propagated as a legal fact, only as a visible gap.

### 2.5 D3 planner (`src/intelligence/planner.ts`) and fallback (`fallbackPlanner.ts`)

- The model planner is intentionally a *strategy proposer*: it cannot emit `ActionIntent`, cannot claim viability, and the `PLANNER_OUTPUT_ALLOWED_KEYS` gate (planner.ts:120-124) re-validates the frozen shape even after the Zod pass.
- `fallbackPlanner.ts` is the credential-free honest path: it only handles disruptions with a directly-failed FLIGHT leg, never authors waivers, and returns `degraded()` (an empty plan with a HIGH uncertainty) otherwise. `docs/DEMO.md` lines 71-78 documents this contract as part of the demo story.
- The model planner and the fallback planner both degrade to an empty plan + uncertainty; the **interface is identical** (`RecoveryPlanner.plan()`), so a caller cannot tell which path produced the output by shape — only by inspecting the uncertainty statement.

### 2.6 Where the code is *not* lenient

- `parseModelJson` will not repair malformed JSON; it returns `undefined` (fail-closed).
- `z.strictObject` rejects unknown keys (so a chatty model that adds an `explanation` field is rejected).
- `responseFormat: 'json_object'` is requested but **not trusted** — `safeParse` runs anyway. This is the right call: the DashScope-compatible surface advertises JSON mode but historically returns prose with embedded JSON on some prompts.

## 3. Per-task assessment

| # | Task | Implemented in | Schema | Complexity | Schema-gate risk | Failure mode if model is wrong | Recommended tier | Fallback |
|---|---|---|---|---|---|---|---|---|
| 1 | Flight confirmation extraction | `ExtractedFlightBookingSchema` (semantic.ts:88-101) | strict, all `.optional()` | Low–Medium | **Timezone ambiguity** (UTC offset vs. local) is the dominant risk; `bookingStatus` enum is freeform string — model could over-commit on `CANCELLED` vs `DELAYED` | Omission → empty artifact, ingested as no-flight-known (recoverable). Hallucinated `bookingStatus: 'CANCELLED'` would skip the leg entirely → **HIGH risk** | **qwen-flash** (cheap; boolean-typed task; no creative reasoning needed) | `RecordedExtractionClient` in tests; in production missing fields raise ingestion uncertainty but do not crash (`ingest/pipeline.ts:503`) |
| 2 | Hotel confirmation extraction | `ExtractedStayBookingSchema` (semantic.ts:104-115) | strict, all `.optional()` | Low | **Date-only check-in / check-out** (`"2026-09-12"`) is correct by convention, but a model returning `"2026-09-12T15:00:00"` would not be rejected; downstream must normalize. Multi-night ambiguity (only `checkIn`/`checkOut` given, no nights) is the real risk | Omission → ingested as partial booking; downstream viability engine treats as `UNKNOWN` (safe) | **qwen-flash** | Same as #1; `policyRules: z.array(z.record(z.string(),z.unknown()))` is intentionally untyped so any text-shaped clause is accepted and passed to the rule engine — not a model-class problem |
| 3 | Anchor event page extraction | `ExtractedAnchorEventSchema` (semantic.ts:65-85) | strict, all `.optional()` | Medium | Multi-engagement pages with timezone-stripped dates are the failure class; `startsAt: z.string()` is `z.string()` (no ISO check) so the gate is lenient. **Entity naming** risk: organiser name vs venue name conflation | Omission → `anchorEvent` ingested as `UNKNOWN`; blast radius collapses, planner sees no anchor deadline. Hallucinated `startsAt` is the worst case → **MEDIUM-HIGH risk** | **qwen-flash** first; **qwen-plus** if pages mix prose with structured schedule tables | Tests use scripted REPLAY; live `LOCAL_CONTEXT` research task is downstream of this extraction |
| 4 | Traveller instruction / context extraction | `ExtractedTravellerContextSchema` (semantic.ts:149-161) | strict; `items[].basis` enum is the only hard gate | Medium | `PreferenceBasis` is a 3-value enum (`EXPLICIT_INSTRUCTION` / `EXPLICIT_PREFERENCE` / `LATENT`) — model frequently over-picks `EXPLICIT_INSTRUCTION`. **Omission vs hallucination on accessibility** is the critical class (an omitted wheelchair statement is silent failure) | Accessibility items have a secondary schema (line 153-160) — they are *still surfaced as a hard requirement* if present. But omission here is the realistic failure mode → **HIGH risk** for accessibility specifically | **qwen-plus** (or **qwen-flash with a stricter prompt that demands every section be addressed**) | `resolvePreferences` reclassifies accessibility defensively (semantics.ts:160-162) so a model mislabelling `ACCESSIBILITY_REQUIREMENT → COMFORT_PREFERENCE` cannot silently downgrade it |
| 5 | Policy / rule-set extraction | `ExtractedRuleSetSchema` (semantic.ts:118-124) | strict; `rules: z.array(z.record(z.string(),z.unknown()))` is **deliberately untyped** | Medium-High | The model emits an array of `unknown`-typed records; structure quality (nesting, threshold units) cannot be checked at the schema gate. **NFR-02 anti-hardcoding risk**: a chatty model may invent thresholds | Omission → no policy applied, viability engine defaults to `UNKNOWN` (safe). Hallucinated rule (e.g. fabricated `maxHotelRate: 9999`) is *not validated structurally* → **HIGH risk** for live runs | **qwen-plus** with a `policyRules` template; explicitly downgrade to **qwen-flash** if a recorded policy parses cleanly | Deterministic rule engine (`engine/rules/`) is the only authority; the model is a scribe. Live passes should diff extracted rule count vs manual ground truth |
| 6 | Insurance extraction | `ExtractedInsuranceSchema` (semantic.ts:126-132) | strict; `MoneySchema` enforces `amount + currency`; covered reasons is `z.array(z.string())` | Low–Medium | Coverage language is the failure class: a model over-generalising "cancellation" to mean all cancellations vs only medical. `confidence` field is optional so omission is honest | Omission → insurance absent from viability, case still proceeds. **Hallucinated covered reasons** are *not* validated against the document → **MEDIUM risk** | **qwen-flash** (boolean-ish: does this clause exist) | `interpretResearchFindings` does not apply here; this is ingestion, not research. Coverage is treated as data, not a fact |
| 7 | Disruption signal extraction | `ExtractedSignalSchema` (semantic.ts:164-169) | strict; `kind` is a closed `SignalKind` enum | Low | `kind` enum is the gate; everything else is optional. The risk is wrong-kind (e.g. `FLIGHT_DELAY` when the source says `CANCELLED`) — **HIGH blast radius** because downstream impact evaluation depends on it | Wrong kind → wrong impact → wrong strategies, but the viability engine still checks each strategy. Hallucinated `occurredAt` would shift the timeline → **MEDIUM risk** | **qwen-flash** with a system prompt that emphasises closed-enum discipline | `ingest/normalize.ts:503` adds a `LOW` uncertainty if `occurredAt` was missing and ingestion time was used |
| 8 | Dependency suggestions | (not implemented as a single task) | n/a | n/a | The product today *determines* dependencies from `element.dependsOn` and the viability engine; it does not ask the model to *suggest* them. This is the right NFR-02 stance. | n/a | n/a | Not a Model Studio task |
| 9 | Objective suggestions | `interpretObjective` + `inferLatentPreferenceCandidates` (semantics.ts) | `ObjectiveInterpretationModelSchema`, `LatentPreferenceCandidatesModelSchema` | Medium | `objective` is optional and **insufficientEvidence** is the honest exit; `originKind` enum is the gate. Risk: model invents an objective when only a preference is stated | Insufficient evidence → `insufficientEvidence: true`, planner proceeds without a dominating objective (safe). Hallucinated `objective` would outrank real ones in `PREFERENCE_PRECEDENCE` → **MEDIUM risk** | **qwen-plus** for objective (precedence-sensitive), **qwen-flash** for latent preferences | `resolvePreferences` ranks explicit over latent (semantics.ts:195); even a fabricated latent cannot outrank an explicit |
| 10 | Recovery planning | `PlannerModelOutputSchema` (schemas.ts:176-183) + `RecoveryStrategySchema` (operational/strategy.ts) | strict; closed read-only tool vocabulary | High | The model proposes *strategies*, never executes. Risk classes: (a) inventing `flight.change` / `flight.cancel` requests (structurally rejected by `ToolRequestSchema`); (b) over-claiming feasibility (no field exists for that, so impossible); (c) infinite strategies / token-limit truncation | Schema violation → strategy dropped with visible uncertainty (planner.ts:186-190). Empty output → `degradedOutput` (planner.ts:79-92). Truncation → JSON parse fails → `INVALID_OUTPUT` → degraded | **qwen-flash first; qwen-plus if schema violations > 10% on extraction rubric; qwen-max only if consequence-judgment quality is demonstrably blocking** | `DeterministicFallbackPlanner` is the production fallback. REPLAY tests use `ScriptedModelTransport` |
| 11 | Sourced research (entry / local context) | `RawResearchFindingsModelSchema` (schemas.ts:114-129) | strict; `kind` and `authorityClaim` are closed enums | Medium-High | **LEGAL_ENTRY_FACT** without `AUTHORITATIVE` + `sourceUris` is the canonical failure class; `toResearchFindings` (research.ts:191-222) downgrades these to `INFERRED` so the loop sees the gap. **Hallucinated source URIs** are not validated by the gate → **MEDIUM risk** for live runs | LEGAL entry downgraded → planner sees the gap, requests more research or marks uncertainty. OPERATIONAL estimate with no uncertainty is flagged in `toResearchFindings` (research.ts:200-203) | **qwen-plus** for `research.entry_requirements` (legal-class outputs must be conservative), **qwen-flash** for `research.local_context` (operational estimates tolerate approximation) | `ScriptedResearchSource` for REPLAY; legal/entry downgraded deterministically |

### 3.1 Cross-cutting risk classes

- **Schema strictness vs model verbosity.** Every Zod schema here is `z.strictObject` and most fields are `.optional()`. The single most common failure in practice is the model adding a `notes` / `explanation` / `confidence_note` field that fails strict-mode and is rejected. The fix is *not* to relax schemas; it is to keep the system prompt terse and to never ask the model to explain itself.
- **Omission vs hallucination asymmetry.** Extraction DTOs are designed so omission is cheap (optional fields default) and hallucination is expensive (no way to mark a value as "unsure" beyond omission). This is the right trade for ingestion, because the next stage (deterministic normalization) is honest about missing fields.
- **Temporal extraction.** `checkIn` / `checkOut` / `startsAt` / `endsAt` / `departure` / `arrival` are all `z.string()` with no ISO enforcement. The DTOs accept `"2026-09-12"` and `"2026-09-12T15:00:00+07:00"` equally. Downstream code (viability engine, ATS fold logic) is the one that *must* interpret these; the model is not asked to normalize. This is a deliberate design choice and is a real source of "looks fine, breaks at runtime" bugs.
- **Timezone ambiguity.** `ExtractedCodePlaceSchema.timezone` is optional and freeform. The model is not asked to produce an IANA name. Live runs should add a deterministic post-processor that resolves the timezone from the `code` (IATA → airport → tz) when present.
- **Entity naming.** `ExtractedAnchorEventSchema.organiserName` is a freeform string. The model is not asked to canonicalize. For two materially different scenarios to share the engine, the model must be told to *not* hardcode event names (NFR-02). The current system prompt does not enforce this; it is a live-run risk.
- **Uncertainty representation.** Every output schema either has an `insufficientEvidence` / `none` flag or returns an empty array. The system prompts are explicit that these are the *honest* exits. Live tests should specifically construct inputs that *should* trigger these exits and assert they do.
- **Latency / cost.** DashScope `qwen-flash` p50 should be < 2s for extraction prompts. The default 30s timeout is generous; 15s would be safer for interactive UI. The default `maxAttempts=2` is appropriate — `INVALID_OUTPUT` is not retried, so a second attempt is only useful for transient `RATE_LIMITED` / `TIMEOUT`.
- **Retry behaviour.** Only `TIMEOUT`, `NETWORK`, `RATE_LIMITED`, `PROVIDER_ERROR` (5xx) are retryable (`client.ts:142-158`). `AUTH` (401/403) and `INVALID_OUTPUT` (parse/schema) are not — correct, because a wrong API key is a config bug and a schema failure is a model bug.
- **Malformed output.** Two paths: (1) `parseModelJson` returns `undefined` → `code: 'model_output_not_json'`; (2) `safeParse` returns `error.issues` → `code: 'model_output_schema_rejected'`. The error message in path (2) reports the issue count but **does not echo raw model content** (`client.ts:343-349`) — NFR-04 leak boundary. Live tests should assert no raw model content appears in any log or HTTP response.
- **Deterministic fallback requirements.** `DeterministicFallbackPlanner` (`fallbackPlanner.ts`) meets this: identical inputs → identical outputs (id factory + now are injectable; `now` defaults to wall time so live runs are not deterministic across replays — that is the *only* non-determinism in the fallback path and it only affects `createdAt`).

## 4. Empirical test plan (executable when credentials are available)

All prompts in this section are written to be run as-is against the `ModelStudioClient.call()` method. Each task uses an **unseen** source fixture (built for this report, not from `fixtures/`). The rubric is numeric so the pass/fail threshold is unambiguous.

### 4.1 Tier-1 cheap runs (≤10 calls, qwen-flash)

**Test 1 — Flight confirmation, clean input (PASS expected).**

```text
task: FLIGHT_BOOKING
sourceKind: EMAIL
title: Booking confirmation — TG 407 BKK-SIN
content:
  Thank you for booking with Thai Airways.
  Confirmation code: TG7K2R.
  Passenger: Somchai Phakdee.
  Flight TG 407 departs Bangkok (BKK) on 12 Sep 2026 at 07:30 ICT
  and arrives Singapore (SIN) at 10:55 ICT.
  Status: CONFIRMED.
```

Pass criteria: `ok=true`; `flightNumber="TG 407"`; `bookingReference="TG7K2R"`; `bookingSystem="Thai Airways"`; `bookingStatus="CONFIRMED"`; `origin.code="BKK"`; `destination.code="SIN"`; `passengerName="Somchai Phakdee"`; **no fabricated** `carrierCode` (it is the IATA code `TG`, but the field is `carrierCode` — accept either presence or absence; do not penalise).

**Test 2 — Flight confirmation, ambiguous timezone (RISKY).**

```text
task: FLIGHT_BOOKING
content: Flight departs 9 Sep 2026 6:40 PM from JFK, arrives LHR 7:55 AM next day.
```

Pass criteria: `departure` is an ISO-8601 string with an explicit offset or a `Z`; **or** `departure` is omitted and the model has not invented one. Specifically: the system prompt requires `"Timestamps must be ISO-8601 with an explicit UTC offset when the source gives one"` (extraction.ts:17). Fail if `departure` is a bare `"2026-09-09T18:40:00"` with no offset.

**Test 3 — Hotel confirmation, single field missing (OMISSION expected).**

```text
task: STAY_BOOKING
content: Reservation at Marina Bay Sands, Singapore.
  Check-in 13 Sep 2026, check-out 16 Sep 2026.
  Confirmation #MBS-44102.
```

Pass criteria: `propertyName="Marina Bay Sands"`; `checkIn="2026-09-13"`; `checkOut="2026-09-16"`; `bookingReference="MBS-44102"`; **no** `timezone` hallucinated (the source did not state one).

**Test 4 — Policy document, multi-clause (STRUCTURED vs SCRIBED).**

```text
task: RULE_SET
content: ATLAS Travel Policy v3 — effective 1 Aug 2026.
  4.1 Hotel maximum: SGD 380/night in Singapore.
  4.2 Hotel maximum: USD 250/night in cities outside Singapore and London.
  4.3 Bookings above the maximum require Director approval.
  5.1 Economy class for flights under 6 hours.
  5.2 Premium economy permitted for flights 6 hours or longer.
```

Pass criteria: `rules` array length ≥ 5; each record is an object (not a string); at least one record has a numeric threshold field. **Fail** if rules is empty (omission) or if rules are concatenated prose strings (the gate allows this — call it a *quality* fail, not a *schema* fail).

**Test 5 — Insurance, ambiguous coverage language (OMISSION expected on hedged clauses).**

```text
task: INSURANCE
content: AtlasGuard Plus policy #AIG-2026-7781.
  Covered reasons for trip cancellation: serious illness or injury to the traveller
  or an immediate family member, jury service, or severe damage to the traveller's
  primary residence. Excess: SGD 200 per claim. Maximum payout: SGD 25,000.
  Pre-existing conditions are not covered.
```

Pass criteria: `coveredReasons` is an array of 3-4 strings; `excess.amount=200`; `excess.currency="SGD"`; `maxPayout.amount=25000`; `maxPayout.currency="SGD"`. **Fail** if the model adds a fifth "covered reason" that is not in the source (e.g. `"voluntary employer termination"`) — this is the hallucination class the rubric is designed to catch.

**Test 6 — Traveller context, accessibility MUST be classified correctly.**

```text
task: TRAVELLER_CONTEXT
content: Traveller: Priya Ramachandran. Nationality: Indian (passport IN).
  She uses a wheelchair and requires step-free hotel rooms and airport transfer
  with a wheelchair-accessible vehicle. She prefers aisle seats.
  Email from her: "Please make sure the hotel is step-free."
```

Pass criteria: `travellerName="Priya Ramachandran"`; `nationalityCodes=["IN"]`; at least one `accessibility` entry with `kind` and `statement` referencing the wheelchair; at least one `items` entry with `basis="EXPLICIT_INSTRUCTION"`; **the wheelchair item is in `accessibility`, not in `items`**. Fail if accessibility is in `items` with `basis="LATENT"`.

**Test 7 — Disruption signal, wrong-kind is the worst class.**

```text
task: DISRUPTION_SIGNAL
content: Airline notice: Flight TG 407 on 12 Sep 2026 has been cancelled.
  Affected passengers should rebook via the airline app.
```

Pass criteria: `kind="FLIGHT_CANCELLED"` (closed enum, must be exact). Fail for `FLIGHT_DELAY` or any other kind.

### 4.2 Tier-2 planner runs (≤5 calls, qwen-flash → qwen-plus)

**Test 8 — Recovery planner, mixed inputs.**

Use a `PlannerInput` built from the existing `integration.i1..i5` fixtures with the deterministic-impact `directFailures` pointing at a single FLIGHT leg. The system prompt at `planner.ts:292-303` and the user prompt JSON at `planner.ts:220-289` are the exact strings used.

Pass criteria:
- `ok=true`;
- `strategies.length >= 1` and `<= 5` (sanity bound — more than 5 is usually hallucination);
- every `strategy.toolRequests` is a closed-vocabulary read-only operation (validate against `ToolOperationSchema`);
- every `strategy.candidateOperations` is an overlay (`UPSERT_ENTITY` or `OVERLAY_RULE`), never an authority claim;
- `uncertainties` is non-empty when the prompt includes `unresolvedUnknowns` in the impact.

**Test 9 — Planner schema violation injection.** Prepend a sentence to the user prompt that says "Also include an ActionIntent field for the recommended change." The schema must reject (`code: model_output_schema_rejected`) and the planner must return `degraded()` with an `UNAVAILABLE`-category uncertainty (the client maps `INVALID_OUTPUT → INVALID_REQUEST` for capabilities; the planner itself surfaces the raw category — `planner.ts:79-92`).

### 4.3 Tier-3 research runs (≤3 calls, qwen-plus)

**Test 10 — Entry requirements, missing sourcing must downgrade, not be presented as fact.**

```text
task: research.entry_requirements
query: { passport: "IN", destination: "TH" }
```

Pass criteria: any `LEGAL_ENTRY_FACT` with `authorityClaim != "AUTHORITATIVE"` OR with `sourceUris.length == 0` is *downgraded* to `INFERRED` by `toResearchFindings` and surfaces with the rejection reason in `uncertainty`. The rubric passes if at least one such case was downgraded (or if the model returns zero findings, which is also honest).

**Test 11 — Local context, must keep uncertainty visible.**

```text
task: research.local_context
query: { city: "Bangkok", topic: "DMK airport to Sukhumvit Soi 11 at 23:00 on a weekday" }
```

Pass criteria: every `OPERATIONAL_ESTIMATE` finding has either `sourceUris.length > 0` *or* an `uncertainty` string. Fail if a finding has neither — that is the silent-guarantee class the schema was designed to flag (research.ts:200-203).

### 4.4 Rubric

| Score | Criterion |
|---|---|
| **PASS** | All must-hold criteria for the test hold; no hallucinated fields; no `INVALID_OUTPUT` returned; no raw model content leaked to logs/responses. |
| **PASS-WITH-NOTE** | All schema-level criteria hold but at least one field carries a near-miss (e.g. timezone-stripped ISO string). Logged for §6 follow-up. |
| **FAIL-OMISSION** | Required field missing but the `insufficientEvidence` / `none` exit is *not* taken. Recovery: tighten system prompt; consider upgrading to `qwen-plus` for that task. |
| **FAIL-HALLUCINATION** | A field is present that the source does not state. Recovery: this is a prompt-discipline problem, not a model-class problem; do not auto-upgrade. |
| **FAIL-SCHEMA** | `safeParse` rejects (unknown key, wrong enum, type mismatch). Recovery: inspect the rejection issues; if the model is adding prose, tighten prompt; if the schema is wrong, file an architecture gap (per `AGENT_MODEL_SELECTION.md §1.12`). |

Aggregate pass threshold for the first LIVE pass: **≥ 80% PASS on Tier-1; 100% on Tier-2 (planner is harder to recover from); 100% on legal/entry downgrades in Tier-3.** Below threshold, escalate to `qwen-plus` for the failing task and re-run the failing tests; if still failing, escalate to `qwen-max` only for the planner and research tasks. If `qwen-plus` fails Tier-1 extraction, **the problem is the prompt, not the model** — do not escalate to a stronger model (AGENT_MODEL_SELECTION §6: "Verification is determined by the change, not model prestige.").

### 4.5 Sanitisation rules for the LIVE pass

- No raw model content in error messages, logs, or HTTP responses (`client.ts:88-100, 140-159, 318-321`).
- No PII (passenger names, booking references) committed to `recordings/`; use `[REDACTED]` markers and keep raw outputs under `data/recordings/` (gitignored) until a safe fixture is curated (`docs/ENVIRONMENT.md` lines 67-69).
- Source URIs that contain identifiers (e.g. `booking.com/reservation/12345`) must be stripped of the path component.
- `mode: 'LIVE'` in capability `meta` must be preserved; do not let a RECORD run masquerade as REPLAY in fixtures.

## 5. Model-tier recommendation summary

Aligned with `docs/AGENT_MODEL_SELECTION.md §10` ("start with a cheap available model; validate schema/tool plumbing; use saved/replayed outputs in routine tests; upgrade model quality only when the integrated vertical loop proves quality is materially blocking the product"):

| Tier | Tasks | Why |
|---|---|---|
| **qwen-flash** (current default) | `FLIGHT_BOOKING`, `STAY_BOOKING`, `ANCHOR_EVENT`, `DISRUPTION_SIGNAL`, `INSURANCE`, `research.local_context`, planner first pass | Boolean-typed, all fields optional, deterministic post-processing owns the hard parts. Default keeps the loop cheap and surfaces prompt bugs before paying for capacity. |
| **qwen-plus** | `RULE_SET` (multi-clause policy), `TRAVELLER_CONTEXT` (precedence + accessibility reclassification is prompt-sensitive), `research.entry_requirements` (legal-class output conservatism) | Where the model has to *judge* (precedence, classification, conservative legal hedging) and where the rubric says hallucination is the dominant risk, the small multiplier buys fewer retries. |
| **qwen-max** | None by default. Only if the planner's strategy-enumeration or consequence-judgment quality is demonstrably blocking an acceptance test after qwen-plus fails twice. | Per `AGENT_MODEL_SELECTION §10` and §13, premium models are for *quality-blocking* cases, not prestige. The planner's `degraded()` fallback is honest, so a planner that returns no strategies is *not* by itself a quality blocker. |
| **No escalation** | `DEPENDENCY_SUGGESTIONS` (not a Model Studio task) | n/a |

Per-call cost intuition (off-peak, from `AGENT_MODEL_SELECTION §3`): at `qwen-flash` ~0.04x, even 100 extraction calls per demo run is roughly equivalent to one `qwen-max` call. **Run cheap first.**

## 6. Findings triaged

### Findings for the team (must read)

1. **F-RV-MS-01 (low risk, observation).** The D1 client is correctly fail-closed at every boundary; NFR-04 is honoured. The `DeterministicFallbackPlanner` makes the credential-free REPLAY demo honest. No code changes required.
2. **F-RV-MS-02 (medium risk, prompt design).** The extraction DTOs accept `z.string()` for every timestamp with no ISO-8601 enforcement. The system prompt *asks* for ISO-8601 with offset but does not validate. A follow-up ticket should add a deterministic post-processor that validates `Date.parse` for every temporal field and surfaces a `MEDIUM` uncertainty on parse failure. This is a *quality* concern, not a schema-gate concern; the gate should stay strict.
3. **F-RV-MS-03 (medium risk, prompt design).** `ExtractedRuleSetSchema.rules` is `z.array(z.record(z.string(),z.unknown()))` — deliberately untyped to accept any clause shape. This means a model that returns prose strings instead of structured records passes the gate. The LIVE rubric (Test 4) should specifically assert structured records; failures are a prompt problem, not a model problem.
4. **F-RV-MS-04 (low risk, deployment).** `MODEL_STUDIO_DEFAULT_MODEL = 'qwen-flash'` is the right default. If a team later sets `MODEL_STUDIO_MODEL=qwen-plus` for LIVE, the cost differential is 2.5x in off-peak; ensure the test harness still uses `qwen-flash` for routine CI.

### Findings for the eventual LIVE empirical pass

5. **F-RV-MS-05 (action).** Run the §4 test plan (≤18 calls, ≤2 hours including analysis). Pass threshold 80% on Tier-1, 100% on Tier-2 and on legal/entry downgrade. Below threshold, escalate per §4.4.
6. **F-RV-MS-06 (action).** On every Tier-1 failure, capture the **prompt**, the **raw model output** (sanitized, stored in `data/recordings/`), the **parse/safeParse issues** (count only, no content), and the **transport meta** (`mode`, `model`, `attempt`, `latencyMs`). Do not commit raw model text to the repo. Aggregate latency across the run; if p50 > 5s for extraction, consider tightening the 30s timeout to 15s for the interactive UI surface.
7. **F-RV-MS-07 (action).** Specifically construct an input that should trigger `insufficientEvidence=true` (e.g. a flight confirmation that is *only* "Please find your booking attached" with no payload) and assert the model takes the honest exit. This is the *most important* rubric item for NFR-04, because the model's failure mode for genuinely insufficient input is to fabricate.

### Findings deferred (not blocking the LIVE pass)

8. **F-RV-MS-08 (deferred).** Add a deterministic post-processor that resolves `ExtractedCodePlaceSchema.timezone` from IATA/IATA-like codes when the source omits the timezone. Currently the field is optional and a downstream consumer must do the lookup. Tracked but not in scope for this milestone.
9. **F-RV-MS-09 (deferred).** Add a `bookedCarrier` vs `operatingCarrier` distinction to `ExtractedFlightBookingSchema`. Today a single `carrierCode` is used, which collapses codeshare flights. Tracked for a follow-up ingestion iteration.
10. **F-RV-MS-10 (deferred).** The system prompts at `semantics.ts:257-284`, `planner.ts:292-303`, and `research.ts:224-235` are hand-tuned. Once the LIVE rubric passes at the recommended tiers, capture the prompts and the rubric together as the regression baseline.

### Anti-hardcoding check (NFR-02)

11. **F-RV-MS-11 (verified).** The planner prompt (`planner.ts:220-289`) projects `PlannerInput` only; no scenario facts (event names, traveller names, cities, route IDs) appear in any prompt. The extraction system prompt (`extraction.ts:14-18`) is task-agnostic. The research prompts (`research.ts:224-235`) are query-only. NFR-02 holds for the model boundary.

### Security check

12. **F-RV-MS-12 (verified).** No API key surface in any error path (`client.ts:88-100, 140-159, 318-321`). `parseModelJson` is the only place raw model text is touched after the call, and it never echoes back into `ModelError.message` (`client.ts:343-349` issues-count summary only). Logs at `extraction.ts:47` and `research.ts:176` only carry `category:code`, never `message` content from a failed call.

---

**Bottom line for the product owner.** The model boundary is the right shape: cheap default, strict schemas, honest empty plans, deterministic fallback. The remaining work is *evidence*: run the §4 test plan when credentials are available, report rubric results, and only then decide whether the planner or the research tasks warrant a `qwen-plus` upgrade. No code changes are recommended from this investigation.
