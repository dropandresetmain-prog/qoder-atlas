# 09 — Disruption Signal Sources

**Investigation:** Which external disruption signals can be made real, and which legitimately remain injected?
**Status:** Investigation only. No product implementation.
**Sandbox constraint:** No Atlas / provider credentials present — every Atlas / TMC surface is **ACCESS_BLOCKED** in this sandbox; classifications here are from documented Atlas capability research plus the existing runtime seam.

## Executive summary

The product already exposes a generic, scenario-neutral runtime seam — `POST /api/runtime/disruption` accepts a `TripSignal` and runs the same impact / planning / authority / execution / verification path as the rest of the engine (ADR-029). That seam was the PL-3 closure for the "no runtime disruption trigger" gap. It does not by itself source real-world events; it accepts whatever signal you hand it. The question for Reality Validation is therefore narrower: for each candidate *upstream* signal channel, is it real, recordable, or honestly injectable?

Recommended minimum REAL-signal portfolio for Reality Validation:

1. **Event agenda page re-ingestion (URL diff)** — `WEBPAGE` source kind already exists; diff against a prior hash yields a `FLIGHT_SCHEDULE_CHANGE`-shaped or `OTHER` TripSignal that genuinely did not originate from a human operator. **MAKE_REAL_NOW.**
2. **Recorded provider / hotel notification (EMAIL ingestion)** — capture a real provider change email (or a credibly authored one) and route through the existing `EMAIL` ingestion path → `signalPipeline`. **MAKE_REAL_NOW** (provider branch), **KEEP_INJECTED** (hotel branch — depends on report 02).
3. **Manual operator entry (runtime API)** — kept as the always-available injection path. **KEEP_INJECTED** (correctly so; not a "synthetic failure", it is a designed operator channel).

Atlas incidents / webhooks / polling are **DEFER** — documented, account-gated, and untested in this sandbox; they do not block validation because the same `TripSignal` shape is reachable via the channels above.

## Classification table

| # | Source | Availability evidence | Read/State | Inducement in demo | Complexity | Decision |
|---|--------|----------------------|-----------|--------------------|-----------|----------|
| 1 | Atlas incidents API (paged schedule-change/cancellation feed) | DOCUMENTED + ACCESS_BLOCKED | Read | Not inducible without order | L | DEFER |
| 2 | Atlas schedule-change / order-ticket webhook | DOCUMENTED + ACCESS_BLOCKED | Receive (push) | Not deliverable from sandbox | L | DEFER |
| 3 | Atlas order status polling | DOCUMENTED + ACCESS_BLOCKED (needs an order) | Read | Not inducible without order | M | DEFER |
| 4 | Email ingestion (airline/hotel change notice) | OBSERVED via existing pipeline (`kind: EMAIL`) | Read | Easily inducible (we can author) | S | MAKE_REAL_NOW |
| 5 | Manual operator entry (POST /api/runtime/disruption) | OBSERVED (current path) | Write | Inherent | S | KEEP_INJECTED |
| 6 | Traveller chat message → signal | OBSERVED (same engine, traveller-initiated) | Write | Easily inducible | S | KEEP_INJECTED (report 08 owns) |
| 7 | Event change URL re-ingestion / diff | OBSERVED via existing `WEBPAGE` ingest | Read | Easily inducible (host a page we can edit) | S | MAKE_REAL_NOW |
| 8 | Hotel / provider change notification | UNKNOWN (report 02 pending) | Read | Depends on provider | S–M | KEEP_INJECTED until report 02 |

## Per-source analysis

### 1. Atlas incidents API

`ATLAS_CAPABILITY_MATRIX.md` row 43 documents a paged schedule-change/cancellation incident list; `ATLAS_FINAL_CAPABILITY_REPORT.md` §8 classifies it as *documented, untested, account-gated*. `resources.atriptech.com/api-document/notifications-and-webhook` is the documented entry point. Our sandbox has no Atlas client id/secret. Without an order/ticket history there is nothing to page, and registration potentially changes account state. **Inducement cost is high, payoff is duplicate coverage of source 2.** Decision: **DEFER** — keep `TripSignal.kind = FLIGHT_SCHEDULE_CHANGE` reachable via other channels; do not block Reality Validation on account provisioning.

### 2. Atlas schedule-change / order-ticket webhook

Same `notifications-and-webhook` docs. The capability matrix row 42 calls delivery "best-effort" and notes registration mutates account config. Webhook push from Atlas into our `/api/runtime/disruption` would be a clean external signal, but it requires (a) a real Atlas account with at least one order, (b) a publicly reachable HTTPS endpoint with mutual trust, and (c) timing we cannot control in a demo. **Complexity L** (HTTP listener, replay, dedupe, signature verification). Decision: **DEFER** — same coverage achievable via polling (3) and event URL (7).

### 3. Atlas order status re-poll

Documented as order-scoped reads; we have no orders. Even if we did, the disruption information returned is a subset of what sources 1/2 already give. Decision: **DEFER** — useful as a *fallback* once orders exist, but not on the critical path for RV.

### 4. Email ingestion (airline / hotel change notice)

`SourceKindSchema` already includes `EMAIL` (authority `ASSERTED`, `src/ingest/source.ts:43`). The generic `ingest` capability in `src/ingest/pipeline.ts` already handles this; the only delta is wrapping the parsed email into a `TripSignal` and POSTing it to `/api/runtime/disruption`. **Inducement is trivial**: capture a real provider email (or a credibly authored one — both are valid; the realism comes from the parsing/normalization path, not the sender) and the same engine runs. **Security note**: email is a high-trust intake; the existing `authority: ASSERTED` ladder already gates downstream effects — operators see the email as evidence, not as ground truth. A future hardening note (not for RV) would be SPF/DKIM verification at the intake boundary, but for RV the assertion is honest because the email body is the *asserted* claim and the engine never grants it higher authority than that. **Complexity S.** Decision: **MAKE_REAL_NOW.**

### 5. Manual operator entry

`POST /api/runtime/disruption` exists; the integration test suite already exercises it. This is *not* a "synthetic" workaround — it is a designed operator channel, analogous to a TMC agent typing a delay into a console. Decision: **KEEP_INJECTED** (and that label is too pejorative — it is the *correct* path for the operator signal, not a stub).

### 6. Traveller message (chat) → same engine

`TripSignal.kind = TRAVELLER_INPUT` is already enumerated in `src/operational/signal.ts:15`; the report 08 investigator owns this. The point worth recording here: the same `RuntimeOrchestrator.processDisruption` handles both traveller and external signals with no branching on kind, which is the whole point of the generic seam. Decision: **KEEP_INJECTED** (covered by report 08; we do not double-classify).

### 7. Event change URL re-ingestion (organiser edits agenda page)

`SourceKind.WEBPAGE` exists. The realistic demo is: a hosted event page whose content we can edit between runs; the `ingest` pipeline re-fetches the URL, normalizes, and a thin adapter detects a content hash change and emits a `TripSignal(kind: FLIGHT_SCHEDULE_CHANGE | OTHER)` against the linked trip element. This is **truly external, non-hand-authored**: the change originates on a server we do not directly write to from the engine. **Inducement**: trivial — flip a line in the page. **Complexity S.** Decision: **MAKE_REAL_NOW** — this is the channel that best satisfies the "at least one truly external signal" requirement.

### 8. Hotel / provider change notification

Pending report 02. If the chosen provider exposes change notifications (email, webhook, or polling), the EMAIL-ingestion adapter from source 4 covers it. If the decision is to **SIMULATE_PROVIDER_BOUNDARY** at the hotel edge, the signal still routes through the EMAIL path with a recorded fixture — same engine. Decision: **KEEP_INJECTED until report 02**; re-classify to **MAKE_REAL_NOW** in the synthesis if report 02 commits to a live hotel signal.

## Minimum real-signal portfolio recommendation

For Reality Validation the engine must demonstrably react to at least one signal that did not originate from an operator typing JSON into a console. The portfolio:

- **Primary external signal: event agenda URL re-ingestion diff (source 7).** Truly external, inducible on demand, exercises the WEBPAGE ingestion path plus signal emission. Lowest-cost demonstration of an external push.
- **Secondary external signal: email ingestion (source 4).** Closes the "what if the change comes as an email?" branch; same engine, different upstream.
- **Operator channel (source 5) and traveller channel (source 6)** remain — they are real channels, not stubs; the fact that they are easy to induce does not make them less real.

This is the minimum because it (a) exercises a real ingestion path (`WEBPAGE`/`EMAIL`) on the way in, (b) lands on the same `processDisruption` seam everything else uses, and (c) leaves the harder Atlas surfaces (1/2/3) as **DEFER** without blocking validation.

## Dependency notes

- **Report 02 (hotel provider decision):** source 8 depends on it. Both branches of that decision have a covered path (live notification → EMAIL adapter; simulated boundary → EMAIL with recorded fixture). No rework needed regardless of outcome.
- **Report 04 (real source ingestion audit):** the URL and email paths used here should match whatever security/authority story report 04 settles. If report 04 tightens the intake boundary (SPF/DKIM, URL allowlists), the adapters above inherit it without re-classification.
- **Report 08 (traveller change):** source 6 is co-owned; this report does not duplicate.

## Architecture deltas (proposed, not implemented)

1. **`UrlReingestDiffSource`** — a thin adapter over the existing `WEBPAGE` ingestion capability. Stores prior `contentHash`; on change, emits a `TripSignal` with `kind` derived from the diff. Lives at the seam, not in the engine. Effort: S.
2. **`EmailIngestSource`** — wraps the existing `EMAIL` ingestion; parses headers + body, derives a `TripSignal(kind: FLIGHT_SCHEDULE_CHANGE | FLIGHT_CANCELLATION | OTHER)`, POSTs to `/api/runtime/disruption`. Effort: S.
3. **No change to `RuntimeOrchestrator.processDisruption`.** The whole point of ADR-029 is that the engine is signal-shape-agnostic.

## Findings triaged

| Finding | Triage | Why |
|---------|--------|-----|
| Atlas incidents API is the canonical "real" disruption source | **Park for Later** | Documented, account-gated, duplicate of webhook + URL channels; not on the RV critical path. |
| Webhook push from Atlas is the cleanest external signal | **Park for Later** | Requires public HTTPS endpoint, account, real order; defer to a post-RV hardening. |
| Event URL re-ingestion is a credible external signal | **Act Now** | Lowest cost, highest realism delta over injection. |
| Email ingestion is already a real path | **Act Now** | Existing `EMAIL` kind + ingestion capability, no new engine code. |
| Operator entry should not be relabelled as "synthetic" | **Ignore / Accept Risk** | It is a real channel; the report language should match the design. |
| Hotel notification depends on report 02 | **Investigate Now** | Wait for report 02, then re-classify source 8. |
| Atlas webhooks are best-effort | **Ignore / Accept Risk** | Acknowledged in matrix row 42; not actionable from this sandbox. |
