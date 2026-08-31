# Capabilities and limitations

This is the public technical truth sheet for the submitted Northstar candidate.
`IMPLEMENTED` means a runtime path exists; it does not imply every provider path is
live in every environment. The local demo defaults to credential-free REPLAY.

| Capability | Status and responsibility | Provider / modes | Current limitation and production direction |
|---|---|---|---|
| Live Dependency Graph | **IMPLEMENTED.** Deterministic typed aggregates, relationships, impact and overlays. | SQLite; all modes. | Not a graph database. Revisit storage only with demonstrated scale/query needs. |
| Signals and state mutation | **IMPLEMENTED.** Signals validate before the authoritative mutation path. | Atlas event normalization and internal inputs. | Provider webhook registration is not implemented. |
| Flight context | **IMPLEMENTED.** Search, verify, fare rules and provider-state observation. | Atlas; LIVE/RECORD/REPLAY. | Atlas is sandbox constrained and not a universal servicing/GDS path. |
| Flight transactions | **IMPLEMENTED, sandbox constrained.** Order/create, pay, retrieve and supported cancellation/void seams are authority-gated. | Atlas; sandbox LIVE evidence and recordings. | Refund execution is unsupported/simulated by the sandbox; no autonomous post-ticket servicing claim. |
| Hotel lifecycle | **IMPLEMENTED.** Context, search, quote/prebook, book, retrieve and cancel. | Nuitée/liteAPI; LIVE/RECORD/REPLAY. | No in-place date modification: Northstar uses cancel-and-rebook. |
| FX and costs | **IMPLEMENTED.** Dated rates normalise comparable recovery costs and authority amounts. | Frankfurter ECB-reference API; LIVE/RECORD/REPLAY. | Not a payment/conversion service; unavailable or incomparable amounts fail closed. Production needs explicit freshness/SLA policy. |
| Ground routing context | **PARTIAL.** Routing can inform deterministic transfer windows. | Google Routes; REPLAY and LIVE-capable. | Live query evidence is incomplete; no transactional ground-transport provider. |
| Programme / shared commitments | **IMPLEMENTED.** AnchorEvent, CSV/XLSX/manual intake, shared commitment fan-out and projections. | Internal supplied programme data. | No external event CMS/calendar adapter or continuous event-site ingestion. |
| Preferences and policy | **IMPLEMENTED.** Explicit instructions, latent preferences, supplier/organisation/insurance RuleSets. | Supplied/fixture sources. | No connected enterprise policy administration system. |
| Recovery planning | **IMPLEMENTED.** AI proposes; deterministic fallback remains available. | Model Studio/Qwen LIVE when configured; fallback/recordings in REPLAY. | No claim of a live web-browsing research tool. |
| Viability and authority | **IMPLEMENTED.** Deterministic time, buffer, policy, funding and permission gates. | Internal engine. | Human authority may be required; no bypass for a model. |
| Execution, observation, reconciliation | **IMPLEMENTED.** Intent → provider seam → observation → state update. | Atlas/Nuitée seams and recordings. | Provider coverage is intentionally bounded; unsupported outcomes are structured, not guessed. |
| Documents, email and web material | **PARTIAL.** Supplied text/structured material is ingested with provenance and optional schema-bound extraction. | Internal source contracts / Model Studio. | No Gmail connector, arbitrary URL crawler or general PDF parser is included. |
| Entry and immigration | **PARTIAL as representation.** Sourced claims can be recorded with uncertainty. | Research contract / fixtures. | No Timatic or legal-grade real-time validation; never present estimates as legal advice. |
| Insurance | **PARTIAL as policy context.** Clauses and coverage terms can inform rules. | Supplied policy sources. | No insurer connection, coverage decision, claim or payment automation. |
| Notifications | **DEFERRED.** In-app operational and traveller surfaces exist. | None. | No outbound email/SMS/push/Slack delivery integration. |
| Persistence and replay | **IMPLEMENTED.** Transactional SQLite repositories and sanitized provider recordings. | SQLite; LIVE/RECORD/REPLAY. | Deployed environments need persistent storage; a durable multi-tenant backend is future work. |

## Provider evidence matrix

| Provider / service | Purpose | Implemented | LIVE proven | RECORD proven | REPLAY | Important limitation |
|---|---|:---:|:---:|:---:|:---:|---|
| Atlas | Flights and sandbox transaction seams | Yes | Yes, sandbox | Yes | Yes | Not production airline ticketing; refund limits. |
| Alibaba Cloud Model Studio / Qwen | Extraction, programme mapping and strategy proposals | Yes | Yes when configured | N/A | Fallback/fixture paths | No claim of live web-search tooling. |
| Nuitée / liteAPI | Hotel lifecycle | Yes | Yes, sandbox | Yes | Yes | Cancel/rebook for changes. |
| Google Routes | Ground-context estimation | Yes | Incomplete | Yes | Yes | Optional; no booking action. |
| Frankfurter | Dated ECB reference FX | Yes | Yes | Yes | Yes | Not a payment FX service. |
| Railway | Hosted demo runtime | Operational evidence | Time-bounded deployment evidence | N/A | N/A | Not application-domain functionality. |

## Evaluated and planned directions

| Direction | Classification | Why / revisit condition |
|---|---|---|
| Additional airline, GDS and TMC adapters | **NEXT** | Preserve provider-neutral flight contracts; add when servicing access and verified workflows justify it. |
| Production hotel path | **NEXT** | Harden supplier lifecycle, cancellation and reconciliation after provider access/SLA evidence. |
| FX freshness/reliability | **NEXT** | Define source, cache and policy freshness guarantees before production financial use. |
| External event, calendar and programme adapters | **NEXT** | Add when a partner system and stable change feed are available. |
| Authoritative entry integration | **NEXT** | Requires licensed/official data and legal review; no inferred legal assertions. |
| Notifications and enterprise approvals | **NEXT** | Add only with an auditable delivery and consent model. |
| Booking.com or other hotel supply | **STRETCH** | Consider if partner access exists without making it a core dependency. |
| Transactional ground transport | **STRETCH** | Add after a reliable provider and complete observation/cancellation path are available. |
| Insurance claims automation | **STRETCH** | Requires carrier agreements and claims workflow evidence. |
| Consumer super-app, graph database, microservices, Kafka, Kubernetes | **DEFERRED** | Current single-process SQLite architecture meets the submission need; reconsider only with demonstrated scale or operational requirements. |

## Open findings

Findings use the project triage `Act Now | Investigate Now | Park for Later | Ignore / Accept Risk`.

| Finding | Classification | Evidence and scope |
|---|---|---|
| `Trip.viability` can read stale after a resolution | **Investigate Now** | The production path is correct: `compose.ts` and `caseReconciliation.ts` both give `CaseVerifier` a `MutationService`, and `reconcileTripViability` (`engine/observation.ts:248`) writes the aggregate through the normal validated mutation path, so a recovered trip returns to `VIABLE`. The guard at `engine/observation.ts:255` (`if (!this.mutations) return;`) silently downgrades verification to read-only, and seven test harnesses construct `CaseVerifier` without `mutations`, which is where the stale `DISRUPTED` aggregate was reproduced. Not a shipped-product defect, so no state-machine change was made; the read-only skip should become a declared verifier mode rather than an absence of wiring. Also unresolved: the reconcile formula has no branch for a soft-only `FAIL`, and a provider repair that displaces a `STAY` does not emit `observedEffects.operations`, so the displaced element is not cancelled. |
