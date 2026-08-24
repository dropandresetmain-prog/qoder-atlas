# DR-7: Missed-Flight Resolution Implementation Summary

## Overview
Implemented missed-flight resolution through **generic machinery** without any bespoke domain branches. The solution reuses the existing signal pipeline, impact engine, and orchestrator that handle supplier cancellations.

## Files Created

### 1. `src/app/missedFlight.ts`
Core implementation that translates a traveller's missed-flight report into the generic recovery flow:

**Key Functions:**
- `reportMissedFlight(deps, input)` - Main entry point
- `resolveEarliestUpcomingFlight(trip, at)` - Deterministic correlation to find the missed flight

**Architecture:**
1. **Deterministic Correlation**: Resolves which flight was missed (explicit elementId or earliest upcoming FLIGHT TRANSPORT_LEG)
2. **Pre-mutation**: Marks the element as CANCELLED through the validated mutation path BEFORE signal processing
3. **Generic Signal**: Constructs a `TRAVELLER_INPUT` signal with structured payload `{ event: 'MISSED_FLIGHT', elementId, travellerReport }`
4. **Generic Pipeline**: Runs through `orchestrator.processDisruption()` - the SAME machinery supplier cancellations use

**No Bespoke Logic:**
- Uses existing `TRAVELLER_INPUT` signal kind (no new enum value needed)
- Leverages existing impact engine for blast radius assessment
- Reuses existing orchestrator for planning/authority/execution
- Same audit trail and case transitions as supplier cancellations

### 2. `test/wave3r-dr7-missed-flight.test.ts`
Comprehensive test suite proving the implementation works through generic machinery:

**Test Coverage:**
1. ✅ **Full Recovery Loop**: Missed-flight report → case opened → impact assessment → planning → authority → execution → RESOLVED
2. ✅ **Blast Radius**: Impact engine exposes downstream threats (transfer, hotel, keynote objective)
3. ✅ **Isolation**: Corporate-tmc trip remains unaffected
4. ✅ **Same Vocabulary**: Audit trail carries identical actions (SIGNAL_PROCESSED, PLANNING_COMPLETED, AUTHORITY_DECIDED, APPROVAL_RECORDED, EXECUTION_COMPLETED)
5. ✅ **Auto-Resolution**: Module correctly resolves earliest upcoming flight when elementId not specified
6. ✅ **Error Handling**: Throws when attempting to report missed flight after departure time

**Key Assertions:**
- Signal kind is `TRAVELLER_INPUT` (generic), not a bespoke `MISSED_FLIGHT` kind
- Element is marked CANCELLED through validated mutation path
- `mutationAccepted` is false (signal itself carries no state change, pre-mutation handles it)
- Case transitions are identical to supplier cancellations
- Audit actions are identical to supplier cancellations

## Test Results

```
✔ DR-7: missed-flight report opens recovery case through generic machinery (483ms)
✔ DR-7: missed-flight with auto-resolved element (earliest upcoming flight) (322ms)
✔ DR-7: missed-flight after departure time throws (293ms)

tests 3
pass 3
fail 0
```

## Architecture Compliance

✅ **No New SignalKind**: Uses existing `TRAVELLER_INPUT` (enum remains frozen)
✅ **No Bespoke Domain Branch**: All downstream logic is shared with supplier cancellations
✅ **Generic Machinery**: Same signal pipeline, impact engine, and orchestrator
✅ **Deterministic Correlation**: Resolves missed element without scenario-name logic
✅ **Validated Mutation Path**: Element cancellation goes through MutationService
✅ **Truthful Provenance**: REPLAY mode completes through simulation boundary when needed

## Recommended HTTP Endpoint

```typescript
POST /api/runtime/missed-flight
{
  "tripId": "trip_a",
  "elementId": "el_a_flight_out",  // optional
  "travellerReport": "I missed my flight due to traffic",
  "at": "2026-09-13T07:00:00+09:00"
}

Response:
{
  "signalId": "sig-missed-flight-el_a_flight_out-2026-09-13T07_00_00_000Z",
  "caseId": "case-trip_a-sig-missed-flight-...",
  "caseStatus": "ASSESSING",
  "missedElementId": "el_a_flight_out"
}
```

## Integration Points

**Wiring Required (not in scope):**
- Add HTTP handler in `src/server/http.ts` or `src/app/runtimeHttp.ts`
- Handler should construct `MissedFlightDeps` from composed runtime
- Call `reportMissedFlight()` and return outcome

**Dependencies:**
- `RuntimeOrchestrator` - for processDisruption
- `TripRepository` - for trip lookup
- `MutationService` - for element cancellation

## Key Design Decisions

1. **Pre-mutation Pattern**: Element is marked CANCELLED BEFORE signal processing, so the impact engine sees the failure immediately. This mirrors how supplier cancellations work (provider mutation → signal → impact).

2. **Generic Signal Kind**: Used `TRAVELLER_INPUT` instead of adding `MISSED_FLIGHT` to the enum. The structured payload carries the semantic meaning without polluting the enum.

3. **Deterministic Correlation**: When elementId is not provided, the module resolves the earliest upcoming FLIGHT TRANSPORT_LEG using `compareInstants()` for proper temporal ordering.

4. **No Double-Mutation**: The signal pipeline's `signalMutationOperations` returns `[]` for `TRAVELLER_INPUT`, so there's no second mutation attempt. The pre-mutation handles state change.

5. **Same Recovery Flow**: After the missed-flight-specific correlation and pre-mutation, the entire recovery flow (planning, authority, execution) is identical to supplier cancellations.

## Verification

The implementation proves that missed-flight resolution can be handled through **generic machinery** without any bespoke domain branches, maintaining the system's architectural integrity while providing a clean API for traveller reports.
