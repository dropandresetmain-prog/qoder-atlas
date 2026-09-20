# ACTIVE TASK — A4 COMPOSITE PLANNER REPAIR

Bounded planner repair so recovery candidates close hard downstream stay dependencies (replacement ADD_JOURNEY_STAY + displaced CANCEL_STAY) without hero hardcoding.

## Identity

- Branch: `finish/a4-composite-planner-repair`
- Base / starting SHA: `5bdb6527369a2a3c34957ce718b5f690ce50adf5` (`finish/a4-controlled-seam`)
- Role: PRIMARY LOCAL IMPLEMENTER — A4 planning blocker repair
- Scope: generic hotel-companion / stay-replacement planning closure + focused proof
- Do NOT: Atlas/Nuitée mutations, recovery approval, merge to main, A3 UI / V5.6 polish

## Checkpoint status

| Item | Result |
|---|---|
| Controlled seam base | **PASS** @ `5bdb652` |
| Composite planner repair | **BLOCKED** — provider quote/inventory for required destination window |

## Root cause (classified)

**C + F (provider):** Destination-stay replacement was derived and researched; overnight companions attached. Replacement **quotes were starved** under the shared research budget / dispatch order (planner defect — repaired). After repair, RECORD attempts `stay_replacement` quotes, but Nuitee sandbox currently returns **no quotable rates** for the required arrival-aligned window (`2026-09-30`→`2026-10-03`): intermittent empty search, or search rates that fail `hotel.quote` with HTTP 400/409. Overnight (`lp3a92f`) search+quote remains healthy.

Candidate cap (16) was **not** the primary cause.

## Planner repair shipped

- Raise hotel research budget `maxRequests` 12 → 18 so overnight + destination context/search/quotes fit one pass
- Prioritise `stay_replacement` quote dispatch before overnight alternates; grant replacement rate headroom
- Attach replacement effects onto overnight stem **or** transport base so complete four-effect candidates can materialise within the existing cap

## Acceptance

- [x] Generic synthetic overnight + destination replacement path (focused M7 tests)
- [x] Quote prioritisation proof
- [x] Anti-hardcoding CLEAN
- [x] Typecheck clean
- [x] Jordan RECORD path invokes destination replacement research + quote attempts
- [ ] Jordan material complete candidate (flight + overnight + destination ADD + CANCEL) — **blocked on provider quote/inventory**
- [ ] VIABLE / AWAITING_AUTHORITY from fresh complete strategy — **not reached**

## Checks run

- `npx tsx --test test/northstar-v2-m7-recovery-planning.test.ts` — 27/27
- `npx tsx --test test/a3-target-hotel-research.test.ts test/northstar-hotel.test.ts` — 21/21
- `npm run gate:anti-hardcoding` — CLEAN
- `npx tsc --noEmit -p tsconfig.json` — clean
- Jordan RECORD proof attempt `9175f16b-b60c-560e-b2ea-cf9a3514b5fe` — 12 flight / 4 overnight / 0 complete; `hotel.quote` `stay_replacement` attempted → `nuitee_http_400`
- Not run: full `npm test`, `test:postgres`, migration suite, provider mutations

## Fresh Jordan evidence

- Case: `297337f5-cda2-5397-a2ba-9ace992396b3`
- Latest material attempt: `9175f16b-b60c-560e-b2ea-cf9a3514b5fe` @ basis `ebf7a015-d92a-4feb-8972-d13f897fe63b`
- Outcome: `NO_RECOVERY_FOUND` (0 viable on this basis)
- Shape: 12 flight-only / 4 Narita overnight / 0 destination replacement+cancel
- Overnight residual: `UNRESOLVED_FAIL` (destination stay still unsatisfied)
- Live contrast: overnight quote OK; destination Sep30–Oct3 rates currently 0

## A3 defects (CARRY FORWARD)

- Disruption trigger / progressive delay UI
- V5.6 amber/yellow semantic issue / missing edges
- Graph placement / recovery copy compression
- Hotel cost provenance polish (blocked until complete strategy exists)

## Next action

Re-run Jordan RECORD planning when Nuitee sandbox yields a **successful** `hotel.quote` for the arrival-aligned destination window (or accept provider-blocked closure). Do **not** mutate providers or approve recovery from this package.
