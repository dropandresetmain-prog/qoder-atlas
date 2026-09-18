# Founder B1 physical acceptance report

**Date:** 2026-09-18  
**Verdict:** **NOT ACCEPTED — blocked on product UI**  
**Engine loop:** completed in the background after Approve (Sarah READY, incident case RESOLVED), but the founder could not meaningfully operate or understand the recovery surface.

Do not start B2 / Jordan until the Act Now UI boundaries below are fixed and founder retests.

---

## Identity

| Item | Value |
|---|---|
| Repo | `dropandresetmain-prog/qoder-atlas` |
| Branch | `feature/sarah-provider-disruption` |
| Tip | `1f9039c78c9c94f0eef8c24460a5a3f3b599d4db` |
| B1 implementation close | `82ae9b80f62a26d8b7e8e6277aa5bf6183ff44f0` |
| Founder workspace | `3e7f3d56-62f1-4a16-8fb3-8150e276bdd0` |
| Product Overview | `http://127.0.0.1:8787/` |
| Sarah case | `419280db-eff2-5cbe-bbb8-0656348c7997` |
| Change signal | `CHANGE_SIGNAL:99d1fdfe-08dd-5d06-bed7-377a70554470` |
| Adapter mode | `REPLAY` (no live provider / no LLM on this path) |

---

## What the founder completed

1. Fresh baseline Overview: **50 Confirmed / 2 need attention / 15 Unconfirmed** (Farah + Mei only).
2. Applied **Simulated airline update**.
3. Settled **49 / 3 / 15** with Sarah disrupted and incident-linked.
4. Opened Sarah’s case only via a pasted API HTML URL (Overview click failed).
5. Saw authoritative cause + Why (`insufficient_arrival_readiness`, 60 vs 150).
6. Clicked **Propose recovery options** → VIABLE options appeared.
7. Stopped: case page was not human-operable. Founder asked for the report and to bring it back later.

## Backend state when stopped / reported

Authoritative re-read after the founder stopped:

- Overview: **50 / 2 / 15 SETTLED**
- Sarah Lim: **READY**, case still referenced
- Incident case `419280db-…`: **RESOLVED**, trip viability **PASS**, 2 VIABLE strategies on the case record
- Farah Hussein + Mei Chen: still **DISRUPTED**, own open cases
- UNKNOWN count still **15**

So the internal recovery loop appears to have finished after Approve, but **that is not founder acceptance**. The founder could not tell what they were approving, who was affected, or operate the page as a product.

---

## Findings and triage

| ID | Finding | Triage |
|---|---|---|
| **FB1-2** | Overview disrupted rows are not clickable — no path from fleet/queue to focused case | **Act Now** — first broken product navigation boundary |
| **FB1-3** | Case page is bare unstyled HTML (`/api/v2/cases/:id?format=html`), not the product shell | **Act Now** — founder cannot use this as a product surface |
| **FB1-5** | After Propose, strategy UI dumps dozens of `Traveller UNKNOWN` with no readable programme-swap explanation | **Act Now** — founder cannot understand what they are approving |
| **FB1-6** | Multiple VIABLE versions (v1/v2) with no clear choice guidance | **Investigate Now** — may be double-propose or versioning presentation |
| **FB1-1** | No in-product Reset; sticky recovered world confused the start of the test | **Park for Later** (dev ergonomics) — document/sticky-workspace workflow; not B1 semantics |
| **FB1-4** | `/operator` 404; live surface is `/` | **Act Now** (small) — route alias and/or docs alignment |
| LLM | No LLM calls on B1 propose/approve/execute | **Ignore / Accept** — expected; deterministic `programmeTimeSwapProposer` only |

### First broken product boundary (founder stop)

**Focused recovery case is not a usable product UI:** cannot open from Overview → lands on raw HTML → strategies are unintelligible (`Traveller UNKNOWN` spam). Founder testing stops here regardless of backend RESOLVED.

---

## What “bring it back” means (minimum before retest)

1. Overview queue rows link to the focused case inside the **same product shell** as Overview.
2. Case page uses product chrome/styles; cause / Why / strategies are readable by a human.
3. Each strategy shows a short plain-language description of the programme change (not UUID soup / UNKNOWN traveller dumps).
4. Prefer a single clear approvable option presentation (or explicit “choose one of N”).
5. Soft: `/` and `/operator` both reach Overview, or docs only name `/`.

Then: fresh workspace → founder retest the same checklist. **Do not start B2 until that retest is accepted.**

---

## Explicitly out of scope this session

- B2 / Jordan / external provider execution
- LLM proposer
- Broad test-suite runs
- Treating agent-only earlier PASS as founder acceptance
