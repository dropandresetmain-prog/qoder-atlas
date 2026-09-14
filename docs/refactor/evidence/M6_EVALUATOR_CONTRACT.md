# M6 evaluator contract and family specification

Status: **FROZEN for M6 evaluator implementation** (primary-owned; lanes build
against this, they do not change it). Changing a rule here is a primary
decision recorded in `M6.md`.

## 1. Shared contract (code is authoritative)

| Concern | File |
|---|---|
| Captured world rows | `src/resolution/world/world.ts` (`CapturedWorld`, `W*` rows) |
| Effective projection | `src/resolution/world/effectiveTypes.ts`, `effectiveItinerary.ts` |
| Evaluator interface | `src/resolution/evaluation/evaluator.ts` |
| Explanation schema | `src/contracts/v2/assessment/explanation.ts` |
| Helpers (ids, verdicts, time) | `src/resolution/evaluation/explain.ts` |
| Registered constraint types | `src/resolution/evaluation/constraintTypes.ts` |
| Constraint lookup, reach-a-place | `src/resolution/evaluation/reachability.ts` |
| Composition / registry | `src/resolution/evaluation/assess.ts` |
| Pure test world builder | `test/support/m6World.ts` |

Rules for every evaluator:

1. Pure and deterministic: input is `(subject, { now, world, effective })`.
   No I/O, no `Date.now()`, no randomness, no repository import, no import
   from `src/persistence/**`, `src/app/**`, `src/engine/**`.
2. **Absence is never PASS.** Missing facts, coverage, times, selections or
   an unregistered predicate/constraint type ⇒ `UNKNOWN` with a typed
   `Uncertainty` (`MISSING_INPUT`, `MISSING_COVERAGE`, `INCOMPLETE_COVERAGE`,
   `UNSUPPORTED_EVALUATION`, …) and a registered snake_case `code`.
3. A dimension that does not apply uses `notApplicable()` — never PASS.
4. Every explanation is built with `explain()` and carries: `reasonCode`
   (registered snake_case), `cause`, `affectedSubject` (the assessed Journey),
   `relatedSubjects` (every subject whose state was compared — items, services,
   programme items, constraints, rule sets, information versions, credentials),
   `evidenceRefs`, typed `facts` (numbers/instants/ids — never prose), and
   `uncertainty`. `dependencyPath` is left empty; the composer attaches causal
   paths.
5. Report `evidence` (EvidenceRef list relied on), `missingCoverage` it detected,
   and `nextInvalidationAt` = earliest instant after `now` at which time alone
   could change a verdict (use `earliestAfter`).
6. Declare every dimension name the evaluator can emit in `dimensions`; declare
   `informationTopics` it reads.
7. No scenario, traveller, city, supplier, date or fixture id in code
   (`npm run gate:anti-hardcoding`). Thresholds come from registered
   constraints/rules in the world, never constants (no default buffers).
8. Subject kind: `JOURNEY` for all families below. Evaluate each person; never
   average.
9. Exact money uses `src/domain/v2/shared/money.ts`; no floating point money.

## 2. Families, dimensions and semantics

`B` = blocking, `NB` = non-blocking.

### L1 — `m6.booking`, `m6.connection`, `m6.overnight`

**`m6.booking`**
- `supplier_fulfilment` (B): each active TRANSPORT effective item. All its
  bookings `VALID` ⇒ PASS; any `INVALID` ⇒ FAIL `booking_invalid`; otherwise
  bookings UNKNOWN ⇒ UNKNOWN `booking_state_unknown`. No booking and no
  service: item `flexible` (JourneyItem.flexible) ⇒ PASS
  `flexible_item_no_supplier_required`; not flexible ⇒ UNKNOWN
  `booking_missing` (MISSING_INPUT `booking`). Selected service but no booking ⇒
  UNKNOWN `service_selected_not_booked`. No transport items ⇒ not applicable.
- `booking_validity` (NB): one explanation per booking of the Journey:
  VALID⇒PASS `booking_valid`, INVALID⇒FAIL, UNKNOWN⇒UNKNOWN. This is the
  "BOOKING VALID" signal, independent of Journey viability.

**`m6.connection`** — `connection_feasibility` (B)
- Pairs = consecutive active TRANSPORT effective items (Journey order), plus any
  captured `dependencies` CONNECTS_TO between two of the Journey's transport
  items/services.
- Same place (`A.endPlaceId === B.startPlaceId`): `gap = B.start − A.end`
  minutes. Unknown time ⇒ UNKNOWN `connection_time_unknown`. `gap < 0` ⇒ FAIL
  `connection_broken`. Minimum from `minimum_connection_minutes` governing the
  Journey (`constraintsFor`; a constraint with `place` operand applies only at
  that place; the largest applicable wins): `gap ≥ min` ⇒ PASS
  `connection_meets_minimum`, else FAIL `connection_below_minimum`. No minimum
  registered and `gap ≥ 0` ⇒ UNKNOWN `minimum_connection_time_missing`.
- Different places: `transferMinutes(A.end place → B.start place)`; none ⇒
  UNKNOWN `route_discontinuity` (MISSING_INPUT `transfer_minutes`); else
  `gap ≥ minutes` PASS `transfer_fits`, else FAIL `transfer_does_not_fit`.
- Facts: `gapMinutes`, `requiredMinutes`, `upstreamArrival`,
  `downstreamDeparture`, `arrivalBasis`, `departureBasis`.
- Fewer than two transport items ⇒ not applicable.

**`m6.overnight`** — `overnight_accommodation` (B)
- Applies only when a governing `overnight_accommodation_required` constraint
  exists (otherwise not applicable).
- For consecutive transport items A→B with a known gap ≥ `minimum_gap_hours`:
  an active STAY effective item whose effective interval covers
  `[A.end, B.start]` and whose place equals A's end place or shares a
  jurisdiction with it (`world.placeJurisdictions`) ⇒ PASS `stay_covers_gap`;
  a covering stay whose place relation cannot be established ⇒ UNKNOWN
  `stay_place_unresolved`; no covering stay ⇒ FAIL `overnight_unaccommodated`.
  Unknown times ⇒ UNKNOWN.

### L2 — `m6.objective`, `m6.participation`

**`m6.objective`** — objectives owned by the Journey, its Trip, or its
coordination groups.
- `hard_objectives` (B) for `hardness = HARD` with disposition ACTIVE/ACHIEVED.
- `soft_objectives` (NB) for SOFT with disposition ACTIVE/ACHIEVED.
- `waived_objectives` (NB): WAIVED / CLOSED_WITH_LOSS ⇒ PASS
  `objective_loss_authorised` with `dispositionEvidenceId` evidence. This never
  touches any other dimension (mandatory constraints still apply — AT20).
- ACHIEVED ⇒ PASS `objective_achieved`.
- ACTIVE by `successPredicateKind`:
  - `ARRIVAL_BY`: needs a TIME target (`atOrBefore`) and a PLACE target;
    `reachPlaceBy(world, journey, place, atOrBefore)` ⇒ PASS/FAIL/UNKNOWN with
    reason from the reach result; missing target ⇒ UNKNOWN
    `objective_target_missing`.
  - `ATTEND`: SUBJECT target of kind PROGRAMME_ITEM ⇒ same check as
    participation (reach the item place by its window start); item CANCELLED ⇒
    FAIL `attend_target_cancelled`; no window ⇒ UNKNOWN.
  - anything else (e.g. `STATEMENT`) ⇒ UNKNOWN `objective_predicate_unsupported`
    (UNSUPPORTED_EVALUATION).
- No objectives ⇒ each dimension not applicable.

**`m6.participation`**
- `programme_participation` (B): the traveller's REQUIRED participations.
  Programme item `CANCELLED` ⇒ explanation PASS `programme_item_cancelled`
  (the obligation is gone; the item's canonical status is the evidence).
  No window or no place ⇒ UNKNOWN. Else arrival:
  `reachPlaceBy(place, window.start)`; departure: the first active transport
  item starting from the item place (or a place with transfer to it) after the
  arrival used must depart no earlier than `window.end + transfer`, else FAIL
  `departs_before_item_ends`; none ⇒ fine. Both PASS ⇒ PASS
  `participation_feasible`.
- `optional_participation` (NB): OPTIONAL/INFORMED participations, same logic.
- One Journey is assessed per traveller; a programme item move that helps one
  traveller and harms another is two assessments with different verdicts.

### L3 — `m6.support`, `m6.group`, `m6.funding`

**`m6.support`** — `support_continuity` (B) when the Journey traveller is the
supported traveller of a requirement (latest version) whose coverage overlaps
any active effective item of the Journey.
- No ACTIVE assignment pinned to that requirement ⇒ FAIL `no_active_assignment`.
- ACTIVE assignment pinned to an older version ⇒ FAIL
  `assignment_pins_superseded_requirement`.
- `assignmentSatisfiesDefinition` (src/domain/v2/trip/support.ts) on the
  latest version ⇒ each failure reason FAIL `assignment_does_not_satisfy_requirement`
  (facts carry the domain reason index, not the string).
- Co-presence: for each active TRANSPORT item of the dependant inside coverage,
  the supporters whose assignment scope covers the item start must each have an
  active TRANSPORT item (in any captured Journey of theirs) on the same
  `serviceRef` ⇒ PASS `supporter_on_same_service`; a supporter journey captured
  but not on that service ⇒ FAIL `supporter_not_on_same_service` (split route);
  dependant item without service ⇒ UNKNOWN `dependant_service_unknown`;
  supporter has no captured Journey ⇒ UNKNOWN `supporter_itinerary_unknown`.
  Fewer co-present supporters than `minimumSimultaneousSupporters` ⇒ FAIL.
- Eligible alternative supporters/handoffs inside the assignment are valid.

**`m6.group`**
- `travel_together` (B): `travel_together` constraints owned by a group the
  Journey belongs to. For every member Journey captured: its last active
  TRANSPORT item into `destination_place` (or its last transport item when no
  destination operand) must share this Journey's `serviceRef` ⇒ PASS
  `members_share_service`; different ⇒ FAIL `members_split`; member without such
  item or service ⇒ UNKNOWN.
- `resource_capacity` (B): every resource used by the Journey (resource
  assignments of its items or of programme items it participates in, and
  reservation lines on a resource allocated to it). Capacity null ⇒ UNKNOWN
  `capacity_unknown`. Usage = assignments PROPOSED/CONFIRMED (quantity) + non-
  cancelled line allocations (quantity) overlapping in time (activity windows:
  effective item interval / programme item window / line interval); any time
  with usage > capacity ⇒ FAIL `capacity_exceeded`; unknown usage time ⇒ UNKNOWN.

**`m6.funding`** — `funding` (B) for cost allocations on reservations allocated
to the Journey. No allocations ⇒ not applicable.
- Organisation payer: budgets of that organisation valid at `now` in the same
  currency as the budget; amounts in another currency need the allocation's
  cited FX observation (exact decimal multiply; missing/expired FX ⇒ UNKNOWN
  `fx_missing`). Total (INTENDED + ACTUAL + HELD commitments of that budget) ≤
  budget ⇒ PASS `within_budget`, else FAIL `budget_exceeded`. No budget ⇒ UNKNOWN
  `budget_missing`.
- Traveller payer: no authoritative traveller home currency exists (M3 gap) ⇒
  UNKNOWN `payer_home_currency_unknown` (MISSING_INPUT `payer_home_currency`).
  Never invent a currency.

### L4 — `m6.credentials`, `m6.entry`, `m6.information`

**Encounters** (shared by credentials and entry; implement once in
`src/resolution/evaluation/encounters.ts`):
- Each intended visit ⇒ encounter `{ kind: transitIntent ? 'TRANSIT' : 'ENTRY',
  jurisdictionId, at: visit.start, exit: visit.end, purpose, stayDays =
  ceil((end − start)/1 day), visitId, selectedCredentials }` where
  selectedCredentials = selections whose `intendedVisitIds` include the visit.
- Derived transit: consecutive active transport items A→B where A's end place
  jurisdictions (via `placeJurisdictions`) contain J, B starts at a place in J,
  and no intended visit to J covers `A.end` ⇒ TRANSIT encounter at A.end with
  `airsideFactsKnown: false` and no selections. A's end place with no resolved
  jurisdiction ⇒ encounter with unknown jurisdiction ⇒ UNKNOWN
  `encounter_jurisdiction_unresolved`.

**`m6.credentials`** — `credential_selection` (B), applicable when the Journey
has intended visits.
- Visit without selection ⇒ UNKNOWN `credential_selection_missing`.
- Selected credential not owned by the Journey traveller ⇒ FAIL
  `credential_not_travellers`; version not of that credential ⇒ FAIL
  `version_mismatch`; issuer status REVOKED/SUSPENDED ⇒ FAIL
  `credential_not_valid`, UNKNOWN issuer status ⇒ UNKNOWN; `expiryDate` before
  the visit end date ⇒ FAIL `credential_expires_during_visit`; no expiry ⇒
  UNKNOWN `credential_expiry_unknown` for PASSPORT/VISA/E_AUTHORISATION.
- More than one PASSPORT selected for one visit ⇒ FAIL
  `ambiguous_identity_document`. The same jurisdiction visited more than once in
  one Journey with different selected passports ⇒ FAIL
  `inconsistent_passport_across_encounters`.
- A VISA/E_AUTHORISATION selected for a visit must have a `VISA_TO_PASSPORT`
  (or `PERMIT_TO_PASSPORT`) link, effective at the visit dates, to a passport
  selected for the same visit ⇒ else FAIL `visa_not_linked_to_selected_passport`.

**`m6.entry`** — `entry_feasibility` (B) for ENTRY encounters,
`transit_feasibility` (B) for TRANSIT encounters. Topics:
`ENTRY_REQUIREMENT`, `TRANSIT_REQUIREMENT`.
- Applicable requirement editions for an encounter at jurisdiction J, time `at`:
  rule assignments with `jurisdictionId = J` valid at `at`, whose rule set
  `policyFamily` is `entry` (ENTRY) or `transit` (TRANSIT); edition = the pinned
  `ruleSetVersionId`, else the edition with status PUBLISHED/SUPERSEDED whose
  effective window contains `at` (highest edition number). A future-effective
  edition does not apply early; include it in `nextInvalidationAt`. Also
  REGULATORY information versions not retracted, effective at `at`, scoped or
  published for J, topic matching, referencing an edition.
- Expression evaluation: Kleene three-valued logic. ALL: any FAIL⇒FAIL, else any
  UNKNOWN⇒UNKNOWN, else PASS. ANY: any PASS⇒PASS, else any UNKNOWN⇒UNKNOWN, else
  FAIL. NOT: swaps PASS/FAIL. PREDICATE: registered library below; unregistered
  id ⇒ UNKNOWN `predicate_unsupported` (UNSUPPORTED_EVALUATION). An edition is
  satisfied when its `expression` and every rule with severity MANDATORY or
  PROHIBITIVE evaluate PASS.
- Predicate library (`src/resolution/evaluation/entryPredicates.ts`), all
  parameters come from the rule edition:
  - `traveller.nationality_in {codes}` — issuing state of the selected PASSPORT
    version; no passport selected ⇒ UNKNOWN.
  - `credential.passport_valid_days_after_exit {days}` — selected passport
    `expiryDate ≥ exit date + days`; no expiry ⇒ UNKNOWN.
  - `credential.linked_visa_valid {issuing_state_codes, classes?}` — a selected
    VISA/E_AUTHORISATION issued by one of the codes, linked to the selected
    passport, valid over [entry, exit] (issue ≤ entry, expiry ≥ exit), class in
    `classes` when given ⇒ PASS; none selected ⇒ FAIL; linkage/validity unknown
    ⇒ UNKNOWN.
  - `journey.purpose_in {purposes}`.
  - `journey.stay_days_at_most {days}`.
  - `history.days_within_window_at_most {days, window_days}` — cumulative days
    in J from travel history overlapping `[exit − window_days, exit]` plus this
    stay; requires at least one history row for the traveller with
    `coverageClaim = 'WINDOW_COMPLETE'` covering the window, else UNKNOWN
    `travel_history_incomplete` (missing history is never zero days).
  - `transit.airside_confirmed {}` — no airside fact model exists ⇒ always
    UNKNOWN `airside_facts_unavailable`.
- Encounter verdict: no applicable edition and a non-expired coverage record for
  the topic with `queryBounds.jurisdictionId = J`, completeness COMPLETE and no
  limitations ⇒ PASS `no_applicable_requirement_complete_coverage`; no applicable
  edition otherwise ⇒ UNKNOWN `requirement_coverage_incomplete`. Applicable
  editions: any FAIL ⇒ FAIL `requirement_not_met`; any UNKNOWN ⇒ UNKNOWN; all
  PASS but coverage not COMPLETE ⇒ UNKNOWN `requirement_coverage_incomplete`;
  all PASS with complete coverage ⇒ PASS `requirements_met`.
- Organisation approval or objective loss never changes these dimensions.
- Facts include encounter kind, jurisdiction id, `at`, selected credential
  version ids, edition ids; evidence includes RULE_SET_VERSION,
  INFORMATION_VERSION and KNOWLEDGE_COVERAGE refs.

**`m6.information`** — `advisories` (B). Topics `ADVISORY`, `CONDITION`.
- Exposure: jurisdictions of intended visits (window = visit dates) and of
  effective item places (`placeJurisdictions`, window = item interval).
- Applicable editions: subtype ADVISORY/CONDITION, not retracted by a captured
  edition, not superseded by a captured later edition of the same record, scope
  jurisdiction in the exposure (or scope subject = the Journey/Traveller), and
  scope exposure overlapping the exposure window.
- Organisation response: rule assignments to the Journey's responsibility or
  Trip business-context organisation whose rule set `policyFamily` is
  `advisory_response`; each rule with PREDICATE
  `advisory.source_severity_in {severities, publisher_organisation_ids?}`:
  severity MANDATORY/PROHIBITIVE match ⇒ FAIL `policy_requires_avoidance`;
  ADVISORY match ⇒ UNKNOWN `policy_requires_review`; INFORMATIONAL ⇒ PASS
  `advisory_noted`. Applicable advisory with no matching response rule ⇒ UNKNOWN
  `advisory_response_policy_missing` (UNSUPPORTED_EVALUATION). Conflicting
  publishers are all listed in facts/evidence; none overwrites another.
- No applicable advisory: complete, unexpired coverage for the topic bounded to
  the jurisdiction ⇒ PASS `no_applicable_advisory_complete_coverage`; else
  UNKNOWN `advisory_coverage_incomplete`.
