# Capabilities and limitations

This is the technical truth sheet for the **currently implemented NORTHSTAR runtime**.

`IMPLEMENTED` means an executable runtime path exists. It does not imply every provider path is live in every environment, every source has production-grade coverage, or every product surface is polished.

## Current runtime truth

- **PostgreSQL + PostGIS is the sole normal NORTHSTAR runtime.**
- SQLite is retired as an application runtime and survives only as explicit offline, read-only migration input plus historical test/code evidence.
- The M0-M10 data/state refactor is accepted through C5.
- Post-C5 repository convergence is complete: accepted frontend semantic foundation + accepted live read models + PostgreSQL runtime + converged test topology now coexist on `main`.
- Current delivery is product integration: Slice A, Founder Test A, Slice B, Founder Test B, then M11 operational activation/retirement.

The latest convergence evidence on the current code line established:

- `npm test`: **749/749** current tests passing;
- fresh-database `npm run test:postgres`: **462/462** passing;
- `npm run test:migration`: **23/23** passing;
- typecheck, lint, build, anti-hardcoding and secret scan clean;
- built PostgreSQL runtime boot smoke green;
- historical SQLite runtime tests deliberately excluded from acceptance.

## Current runtime capability matrix

| Capability | Current status | Provider / modes | Current limitation / direction |
|---|---|---|---|
| Persistence / state ownership | **IMPLEMENTED.** PostgreSQL + PostGIS current runtime with typed relational ownership, expected revisions, durable work and migrations. | PostgreSQL target composition. | M11 is operational activation/retirement, not a future switch away from SQLite. |
| People / Trip / Journey model | **IMPLEMENTED CORE.** Stable Traveller, shared Trip, per-person Journey, relationships/support/coordination foundations. | Internal PostgreSQL domain. | Product UI still needs to prove the real Sarah baseline and exact five-person incident scope through normal HTTP. |
| Services / reservations / allocations | **IMPLEMENTED CORE.** Independent service/reservation/allocation/entitlement ownership and provider references. | Internal + provider adapters. | Automatic provider-reference correlation is not required for the first disclosed demo path; explicit subject identity remains acceptable where the command contract requires it. |
| Programme / participation | **IMPLEMENTED CORE.** Mutable Event -> Programme -> ProgrammeItem with Participation independent of travel. | Internal programme state. | Slice B must prove affected people without Journeys are not omitted or falsely cleared. |
| Signals and authoritative mutation | **IMPLEMENTED.** Provider-shaped inputs and typed commands reach PostgreSQL state with idempotency/concurrency controls. | Internal inputs + provider normalization. | Browser-facing evaluation-to-case orchestration is not yet proven end to end. |
| Impact / assessment / viability | **IMPLEMENTED.** Revision/evidence/time-bound deterministic assessments, relevant-scope propagation, stale invalidation and PASS/FAIL/UNKNOWN semantics. | Internal deterministic evaluators. | Slice A must prove five incident-linked outcomes from one normal product run rather than relying on test-helper assembly. |
| Live read models | **IMPLEMENTED / ACCEPTED FOUNDATION.** Stable edge identity/authority, change cursor, assessment lifecycle, subject-keyed refs and authoritative traveller names. | PostgreSQL projections. | Full-snapshot polling is the safe first live-update mechanism. `changedVisibleRefs` is at-least-once emphasis, not exact diff. Event Overview final design remains unresolved. |
| Flight context | **IMPLEMENTED.** Search, verify, fare rules and provider-state observation. | Atlas LIVE/RECORD/REPLAY. | Atlas is sandbox constrained and not universal airline/GDS servicing. Sarah/Batik demo facts are simulated/organiser-supplied where documented, not Atlas market truth. |
| Flight transactions | **IMPLEMENTED, sandbox constrained.** Order/create, pay, retrieve and supported cancellation/void seams are authority-gated. | Atlas sandbox LIVE + recordings/replay. | Production servicing/refund breadth remains provider-limited. |
| Hotel lifecycle | **IMPLEMENTED.** Search, quote/prebook, book, retrieve and cancel with target execution/reconciliation boundaries. | Nuitée/liteAPI LIVE/RECORD/REPLAY. | No universal in-place date modification; changes may require cancel/rebook. Sarah's actual stay consequence still needs Slice A/B truth verification before the UI presents it. |
| Ground routing context | **PARTIAL.** Routing can inform deterministic transfer windows. | Google Routes LIVE-capable / replay/fallback. | No transactional ground provider; non-blocking to core recovery. |
| FX and costs | **IMPLEMENTED.** Dated evidence normalizes comparable recovery costs and authority amounts. | Frankfurter ECB-reference LIVE/RECORD/REPLAY + internal evidence. | Reference FX evidence is not a payment FX service. |
| Preferences / policy / rules | **IMPLEMENTED CORE.** Explicit/latent preferences, policy/rule inputs, spend/authority thresholds and deterministic precedence. | Internal/supplied sources. | Source coverage remains deployment-specific; explicit instructions always outrank latent preferences. |
| Recovery planning | **IMPLEMENTED CORE.** Typed strategies/action plans with AI proposal capability and deterministic fallback. | Model Studio/Qwen when configured; deterministic fallback/replay otherwise. | Normal browser/API path for candidate creation/selection is not yet proven as a complete Slice B interaction. |
| Counterfactual preview | **IMPLEMENTED CORE / PRODUCT INTEGRATION INCOMPLETE.** Overlay evaluation remains mutation-free. | Internal deterministic overlay. | Slice B must prove complete affected participation and current/proposed separation through the product surface. |
| Authority / approvals | **IMPLEMENTED CORE.** Scoped authority, reviewed basis, spend/policy checks and approval gating. | Internal authority engine. | Slice B must expose a real operator principal/approval path through normal HTTP; UI booleans do not count. |
| Execution / observation / reconciliation | **IMPLEMENTED CORE.** Typed action intents, durable attempts, observations, reassessment and case-resolution gating. | Internal + provider adapters. | Slice B must prove browser-accessible orchestration, duplicate/stale protection and truthful partial failure/recovery. |
| Documents / email / web material | **PARTIAL.** Supplied text/structured material can be ingested with provenance and optional schema-bound extraction. | Internal source contracts / Model Studio. | No general Gmail/arbitrary crawler/legal document product claim. |
| Entry / visa / transit | **IMPLEMENTED ARCHITECTURE + EVALUATOR FOUNDATION; SOURCE COVERAGE PARTIAL.** Credentials/intended visits/document selection and three-valued assessment are represented. | Internal/sourced requirements. | Not a legal-grade live eligibility product without authoritative source coverage. Missing/stale coverage remains `UNKNOWN`. |
| Advisories / external conditions | **IMPLEMENTED FOUNDATION; LIVE SOURCE INTEGRATION PARTIAL.** Versioned information/applicability/coverage model exists. | Supplied/fixture sources; future dedicated providers. | No universal authoritative advisory provider is claimed. |
| Geographic applicability | **IMPLEMENTED FOUNDATION.** Place/Area/Jurisdiction and PostgreSQL/PostGIS applicability support target reasoning. | Internal + provider/source context. | Breadth depends on actual source coverage and evaluators. |
| Insurance | **PARTIAL policy context.** Clauses/coverage terms can inform rules. | Supplied sources. | No insurer connection, claim decision or payment automation. |
| Notifications | **DEFERRED / NOT INTEGRATED.** | None. | Add only with auditable delivery/consent state and a validated product requirement. |
| Frontend semantic layer | **IMPLEMENTED / ACCEPTED FOUNDATION.** Authoritative read model -> semantic adapter -> normalized presentation -> shared grammar. | Internal UI layer. | The polished product path is not complete. Old timer/fixture progress must not return. |
| Focused Sarah graph | **DESIGN REFERENCE ACCEPTED.** V5.6 visual language is the basis for the focused case. | UI/design reference. | V5.6 data is mock/reference only and must be replaced by authoritative runtime facts. |
| Event Overview | **NOT YET ACCEPTED AS A FINAL DESIGN.** Product intent is clear; first visual prototype was rejected. | Future Slice A UI work. | Do not build backend semantics around the rejected prototype. Minimum truthful operational projection comes first. |

## Provider evidence matrix

| Provider / service | Purpose | Implemented | LIVE proven | RECORD proven | REPLAY | Important limitation |
|---|---|:---:|:---:|:---:|:---:|---|
| Atlas | Flight search/verify/rules/state + sandbox transaction seams | Yes | Yes, sandbox | Yes | Yes | Not production airline/GDS servicing; sandbox/refund limits. |
| Alibaba Cloud Model Studio / Qwen | Extraction/programme mapping/strategy proposals | Yes | Yes when configured | N/A | Deterministic/fixture fallback | Model output remains schema-validated proposal data and cannot bypass deterministic gates. |
| Nuitée / liteAPI | Hotel lifecycle | Yes | Yes, sandbox | Yes | Yes | Provider constraints; cancel/rebook may be required for changes. |
| Google Routes | Ground-context estimation | Yes | Bounded/optional | Yes | Yes | No booking action. |
| Frankfurter | Dated ECB-reference FX | Yes | Yes | Yes | Yes | Comparison evidence, not payment FX. |
| Railway | Hosted runtime | Operational evidence | Deployment-dependent | N/A | N/A | Hosting, not a domain capability. |

## Runtime/read-model contract that frontend must respect

Frontend/business logic must not independently calculate:

- viability;
- blast radius;
- causal failure;
- readiness/buffer pass/fail;
- policy;
- authority;
- recovery correctness.

Frontend applies complete authoritative snapshots. `changedVisibleRefs` / changed-edge metadata may drive emphasis/animation but must not be treated as the sole state payload.

Proposed state must remain visually and semantically distinct from current authoritative state.

## Current delivery gaps

### Act Now — Slice A

The engine components exist, but the browser/product lifecycle has not yet been proven as one normal run.

Slice A must establish:

1. a reproducible real Sarah demo baseline in PostgreSQL;
2. a normal HTTP/provider-shaped disruption with truthful service/rebooking semantics;
3. real incident membership and evaluation against the changed input;
4. four cleared outcomes and Sarah's failed quantitative reason;
5. idempotent evaluation-to-RecoveryCase orchestration;
6. automatic authoritative refetch/polling;
7. click/reload of the real Sarah case without SQL/test-helper/manual-case intervention.

### Investigate Now

- exact five-person incident provenance in the canonical Sarah data;
- whether Daniel/Elena-equivalent programme participants without Journeys are included correctly in preview/evaluation;
- Sarah's real stay/hotel consequence after the rebooking;
- Felix's real programme linkage in the PostgreSQL demo world;
- exact provider-shaped semantics required if the UI claims `ID7159 cancelled -> moved to ID7153`;
- bounded external legacy-SQLite inventory before M11 activation (repository audit found no meaningful legacy state, but ignored external files cannot be ruled out from Git alone).

### Park for Later

- progressive per-person evaluation telemetry;
- rich rejected-option history;
- polished provider/tool activity panel;
- authoritative Before/After historical view;
- whole-event interactive Live Dependency Graph, semantic zoom and multiple simultaneous disruption focuses;
- physical relocation/deletion of historical SQLite test/code files after M11/submission.

## M11 readiness

Repository evidence classifies M11 readiness as **A — no meaningful legacy state identified**.

That means Slice A/B development proceeds on PostgreSQL immediately. Before final M11 activation, perform one bounded external read-only inventory for any ignored/deployed `data/app.sqlite` / `SQLITE_PATH` source. If none contains unique state, record "no migration source" and close the data-migration question. If a meaningful source is found, freeze/copy/hash it and use the retained read-only exporter -> PostgreSQL importer -> reconciliation path.

M11 must never reactivate SQLite as rollback.

## Truthfulness rule

Provider success is not recovered-trip proof. A recovery claim requires the relevant internally committed or externally observed state, reconciliation, and a current deterministic assessment of mandatory requirements.

Unsupported, stale, missing or incomplete information remains `UNKNOWN`/unresolved rather than being promoted into a confident PASS or product claim.
