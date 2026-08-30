# UI Lane Integration Contract (Wave 3)

**For the UI lane (`lane/wave3-ui-kimi`).** The core lane (`lane/wave3-core-qwen`)
exposes every surface below over the SAME composed engine — no demo-only paths.
All values are projections of persisted authoritative state. **Render them
verbatim; never re-derive status, funding, or verdicts in the frontend.**

Base: one HTTP server (`npm start`, default port from config). JSON responses,
`content-type: application/json; charset=utf-8`. No auth in the demo runtime.

---

## 1. Read models (GET)

### Programme scale — `GET /api/programme/:anchorEventId?at=<iso>`
The programme dashboard surface. 200 with `ProgrammeView`, 404 unknown event.

```ts
{
  generatedAt: string;            // ISO instant
  anchorEventId: string;
  anchorEventName: string;
  summary: {                      // per-status rollup over ALL travellers
    total: number; ready: number; planning: number;
    needsTravellerInfo: number; changeRequested: number;
    atRisk: number; disrupted: number; recovering: number;
    awaitingDecision: number; resolved: number; unknown: number;
  };
  travellers: Array<{
    tripId: string; travellerId: string; travellerName: string;
    status: ReadModelStatus;      // see §5
    activeCaseIds: string[];      // drill into /api/cases/:caseId
    decisionsRequired: number;
    uncertainties: string[];      // UNKNOWN is first-class — never hide
    updatedAt: string;
  }>;
  endangeredCommitments: Array<{
    commitmentId: string; title: string;
    reason: string;               // deterministic, user-facing
    affectedTravellerIds: string[];
  }>;
  unresolvedUncertainties: string[];
}
```

### Operator dashboard — `GET /api/operator/dashboard`
All trips regardless of programme: `generatedAt`, `summary` (ready/atRisk/
disrupted/recovering/awaitingDecision counts), and per-trip
`OperatorTripView` (status, whatChanged, affectedItems, systemActivity
strings, pendingDecisions, uncertainties, travellerResponseStatus,
resolutionSummary, updatedAt).

### Recovery case detail — `GET /api/cases/:caseId`
```ts
{
  caseId: string; tripId: string; tripLabel?: string;
  travellerNames: string[];
  status: ReadModelStatus;
  whatChanged?: string;           // triggering signal, user-facing
  affectedItems: string[];        // "Transport leg · REF", "Engagement", …
  criticalObjectiveAtRisk?: string;
  checks: Array<{ id: string; label: string; result: 'PASS'|'FAIL'|'UNKNOWN' }>;
  options: Array<{
    id: string; title: string;
    verdict: 'VIABLE'|'NOT_VIABLE'|'UNKNOWN';   // UNKNOWN != PASS
    rejectionReason?: string;
    recommended?: boolean;
    costDelta?: { amount: number; currency: string };
    requiresApproval?: boolean;
    costAllocation?: CostAllocation;            // §4 mixed funding
  }>;
  approval?: { requestedFrom: 'TRAVELLER'|'ORGANISATION'; reason: string;
               amount?: Money; state: 'PENDING'|'APPROVED'|'DECLINED' };
  actions: Array<{ id: string; label: string;   // "(simulated at provider
                   state: 'QUEUED'|'IN_PROGRESS'|'DONE'|'FAILED' }>;  //  boundary)" when provenance is SIMULATED
  funding?: { allocation: CostAllocation; summary: string };
  uncertainties: string[];
  resolution?: { outcome: 'FULLY_RECOVERED'|'PARTIALLY_RECOVERED'|'UNRECOVERABLE'|string;
                 summary: string; remainingLosses?: string[] };
  updatedAt: string;
}
```

### Traveller trip — `GET /api/traveller/:tripId`
`{ tripId, status, whatChanged?, whatMattersNow?, actionsInProgress: string[],
inputRequested: Array<{ caseId, prompt, options?: string[] }>,
remainderViable: 'VIABLE'|'AT_RISK'|'NOT_VIABLE'|'UNKNOWN',
resolutionSummary?, updatedAt }`. The `prompt` strings already carry the
funding sentence when allocated — render as-is.

### Wave 3 operational surfaces
- `GET /api/wave/approvals` — programme-wide pending approval queue:
  `pending: Array<{ caseId, tripId, travellerNames, decisionId,
  requestedFrom: 'TRAVELLER'|'ORGANISATION'|'HUMAN_AGENT', requestedAt,
  action, amount?: Money, funding?: { allocation, summary }, reason }>`,
  longest-waiting first. Empty after approval is recorded.
- `GET /api/wave/trips/:tripId/activity` — activity stream from REAL audit
  events: `events: Array<{ action, summary, occurredAt, actor, subject? }>`
  newest first. `summary` is user-facing copy; `action` is the stable machine
  identifier for filtering. Never fabricate events client-side.
- `GET /api/wave/trips/:tripId/uncertainties` — `{ tripId, uncertainties: string[] }`.
- `GET /api/wave/providers` — truthful provenance banner source:
  `capabilities: Array<{ family, providerId, mode: 'LIVE'|'RECORD'|'REPLAY',
  supportedOperations: string[], modeLabel: string }>`. Show `modeLabel`
  (or `mode`) whenever execution is displayed; SIMULATED actions already
  carry "(simulated …)" wording in labels.

---

## 2. Driving the engine (POST)

### Traveller approval (recommended surface)
`POST /api/cases/:caseId/traveller-decision`
body `{ "decision": "APPROVED" | "DECLINED", "note"?: string }`
→ 200 `{ accepted: true, verdict, caseStatus, resolutionOutcome? }`
→ 409 `{ accepted: false, error }` (wrong principal, nothing pending, …).
This endpoint runs the REAL authority → execution → observation →
verification lifecycle.

### Generic runtime flow (operator/demo console)
`POST /api/runtime/disruption | /plan | /begin | /decide | /execute | /reset`
and `GET /api/runtime/state`. See `test/integration.r1.test.ts` for the exact
bodies; the loop is: disruption → plan (pick `bestStrategyId`) → begin
(outcome `REQUIRES_TRAVELLER` + `intentId` + optional `funding`) → decide →
execute. `reset` reseeds the pristine demo state deterministically.

### Programme & resolution flows
- `POST /api/programme/context` / `/api/programme/import` /
  `/api/programme/commitment-change` / `/api/programme/map-roster` /
  `/api/programme/map-brief` — programme setup + Case C fan-out.
- `POST /api/resolution/change-request` — Case A entry point (ChangeRequest
  JSON; response carries `caseId`, provisional implications incl. the
  amount-agnostic payer decision).

---

## 3. Demo flows through the same engine

| Case | Flow | Notes |
| --- | --- | --- |
| B (hero disruption) | `/api/runtime/disruption` → plan → begin → decide → execute | downstream implications visible in case detail (`affectedItems`, `checks`, `criticalObjectiveAtRisk`, `uncertainties`) |
| A (mixed funding) | `POST /api/resolution/change-request` → runtime plan/begin/decide/execute | `funding` allocation surfaces in begin outcome, case detail, approval prompt, wave approvals |
| C (commitment change) | `POST /api/programme/commitment-change` | fan-out produces per-trip signals → programme view rollup updates |

---

## 4. CostAllocation shape (ADR-037)

```ts
interface CostAllocation {
  coveredBy?: 'EVENT_ORGANISATION' | string;     // who pays the covered part
  coveredAmount?: Money;
  incrementalPayer?: 'TRAVELLER' | string;       // who pays the excess
  incrementalAmount?: Money;
  derivedFromRuleIds: string[];                  // deterministic evidence
}
```

---

## 5. ReadModelStatus values

`READY | PLANNING | NEEDS_TRAVELLER_INFO | CHANGE_REQUESTED | AT_RISK |
DISRUPTED | RECOVERING | RESOLVED | UNKNOWN` — map each to a distinct visual
state; `UNKNOWN` must never render as a healthy/green state.

## 6. Rules for the UI lane

1. Render projected copy verbatim (summaries, prompts, labels, modeLabels).
2. Missing information is a first-class state: `UNKNOWN` verdicts, non-empty
   `uncertainties`, `PENDING` approvals — show them, don't default them away.
3. Provenance is truthful: show adapter mode from `/api/wave/providers` and
   any "(simulated …)" wording; the demo runs REPLAY, never claim LIVE.
4. Do not pollute or reseed shared state from the UI; reset only via
   `POST /api/runtime/reset`.
5. All endpoints above are already wired on `lane/wave3-core-qwen`; shapes are
   TypeScript interfaces in `src/contracts/readmodels.ts` (frozen),
   `src/ui/case-view-model.ts`, and `src/app/waveReadmodels.ts`.

---

## 7. Product convergence seams (integration/wave3-product)

The HTML surfaces (`/operator`, `/operator/cases/:id`, `/programme?event=&at=`,
`/traveller?trip=`) render the approved UI screens from the read models above
through one HTTP seam. The four Kimi handoff requirements are satisfied at
this seam, from authoritative state only:

1. **Chain** — `projectCaseChain` (src/app/chain.ts) projects every trip
   element into a `chain` link; state comes from reservation state + health
   + case impact evidence. Nothing unbooked ever renders green.
2. **TravellerPresentation** — `projectTravellerPresentation`
   (src/app/travellerPresentation.ts) builds the commitment card from the
   trip's engagement + anchor commitment + event evidence, and the contact
   line from the organiser organisation. Hero imagery has no authoritative
   source, so it is omitted (ink gradient fallback).
3. **optionDetails keying** — the trip view emits exactly `['Approve',
   'Decline']` in `inputRequested.options`; the presentation keys its rich
   details by those exact strings (pending intent's planning verdict,
   replacement route, funding; decline carries the honest consequence).
4. **Settle animation** — the server keeps per-surface last-rendered values
   (src/server/settle.ts). `.just-changed` is injected ONLY into elements
   whose value actually changed between renders (fleet cell + roster row via
   `data-fleet-trip` / `data-trip-id`; traveller hero via `data-status`).
   First render never settles; `POST /api/runtime/reset` clears the memory
   (reset action only — other runtime actions preserve it).
