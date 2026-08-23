# Northstar Provider Wiring & Recording Inventory

## 1. Provider Wiring

### Adapter Mode Selection
- **Config definition**: `src/config/config.ts:15` — `AdapterModeSchema = z.enum(['LIVE', 'RECORD', 'REPLAY'])`
- **Default mode**: `src/config/config.ts:44` — `adapterMode: AdapterModeSchema.default('REPLAY')`
- **Env var**: `ADAPTER_MODE` (mapped at `src/config/config.ts:86`)
- **Per-provider override**: Not supported; single global mode applies to all adapters

### Recording Key Format
- **ID generation**: `src/providers/recordingStore.ts:29-34`
  ```typescript
  recordingIdFor(providerId, operation, request) {
    digest = sha256(`${providerId}|${operation}|${canonicalJson(request)}`)
    return `rec_${digest.slice(0, 32)}`
  }
  ```
- **File path**: `{recordingsDir}/{providerId}/{operation}/{recordingId}.json`
- **Canonical JSON**: Keys sorted recursively (`src/providers/recordingStore.ts:13-27`)

### Recording Store
- **Class**: `FileRecordingStore` at `src/providers/recordingStore.ts:48`
- **Read dirs**: Array of directories searched in order (runtime store, then fixtures)
- **Write dir**: Optional; RECORD mode requires it
- **Validation**: Recordings parsed against `RecordingSchema` on load (`src/providers/recordingStore.ts:66`)

### Environment Variables per Provider
**Global** (`src/config/config.ts:80-90`):
- `ADAPTER_MODE` — LIVE|RECORD|REPLAY (default: REPLAY)
- `RECORDINGS_DIR` — recording storage root (default: `recordings`)
- `FIXTURES_DIR` — fixtures root (default: `fixtures`)

**Atlas** (`src/config/config.ts:92-97`):
- `ATLAS_ENV` — environment label (default: `sandbox`)
- `ATLAS_BASE_URL` — API base URL
- `ATLAS_CLIENT_ID` — client identifier
- `ATLAS_CLIENT_SECRET` — client secret
- **LIVE check**: `src/config/config.ts:150-153` — requires all three (baseUrl, clientId, clientSecret)

**Nuitée** (`src/config/config.ts:106-110`):
- `NUITEE_SEARCH_BASE_URL` — search API base (default: `https://api.liteapi.travel/v3.0`)
- `NUITEE_BOOKING_BASE_URL` — booking API base (default: `https://book.liteapi.travel/v3.0`)
- `NUITEE_API_KEY` — API key
- **LIVE check**: `src/config/config.ts:160-163` — requires apiKey only

**Google Routes** (`src/config/config.ts:103-105`):
- `GOOGLE_ROUTES_API_KEY` — API key
- **LIVE check**: `src/config/config.ts:158-159` — requires apiKey

**Model Studio** (`src/config/config.ts:98-102`):
- `MODEL_STUDIO_BASE_URL` — API base (default: `https://dashscope.aliyuncs.com/compatible-mode/v1`)
- `MODEL_STUDIO_API_KEY` — API key
- `MODEL_STUDIO_MODEL` — model name (default: `qwen-flash`)
- **LIVE check**: `src/config/config.ts:154-157` — requires apiKey and model

### Recording Inventory
**Total**: 10 recordings across 3 providers

**Atlas** (3 recordings):
- `fixtures/recordings/atlas/search/rec_ac9fd89bb364d688bbeadef62be55aa5.json` (19 KB)
- `fixtures/recordings/atlas/verify/rec_5e5aac6c5a7102029b190fca4f6b3fbf.json` (6 KB)
- `fixtures/recordings/atlas/fare_rules/rec_28c75cb05b46bfa49e51fff3faf6c680.json` (6 KB)

**Nuitée** (6 recordings):
- `fixtures/recordings/nuitee/search/rec_9a78f5e6cd8b3bf5eebafaba32406977.json` (**2.5 MB** — huge)
- `fixtures/recordings/nuitee/quote/rec_dde2ab9fb8790afdf391eb49a05975f4.json`
- `fixtures/recordings/nuitee/book/rec_57ce3b7488871b956efbc79843202ba1.json`
- `fixtures/recordings/nuitee/retrieve/rec_db1aad2331d49ecd0fa11d47da0e6d38.json`
- `fixtures/recordings/nuitee/cancel/rec_bbbb22235e232e6930caf4572f09cd3a.json`
- `fixtures/recordings/nuitee/stay_context/rec_b3356c66cb435b7bba351460b3ed74b3.json`

**Google Routes** (1 recording):
- `fixtures/recordings/google-routes/route_context/rec_c47bcdae6b369baf521a9a2b03638faf.json` (329 bytes)

---

## 2. Nuitée Adapter

**File**: `src/providers/hotel/nuiteeAdapter.ts`

### Implemented Operations
- `getStayContext` (line 274) — retrieves booking context via `/bookings/{id}`
- `searchHotels` (line 287) — searches hotels via `/hotels/rates`
- `quoteRate` (line 300) — prebooks rate via `/rates/prebook`
- `bookStay` (line 313) — books via `/rates/book`
- `retrieveBooking` (line 326) — retrieves booking via `/bookings/{id}`
- `cancelStay` (line 358) — cancels via PUT `/bookings/{id}`
- **`modifyStay`** (line 345) — **NOT IMPLEMENTED**; returns structured UNAVAILABLE error

### modifyStay Structured Failure
```typescript
// Line 345-356
async modifyStay(query: HotelActionQuery): Promise<CapabilityResult<HotelActionOutcome>> {
  return capabilityError<HotelActionOutcome>(
    {
      category: 'UNAVAILABLE',
      code: 'nuitee_modify_not_supported',
      message: 'Nuitée/liteAPI has no in-place stay modification; the provider workflow is cancel + rebook...',
    },
    { providerId: NUITEE_PROVIDER_ID, mode: this.mode, requestedAt: new Date().toISOString() },
  );
}
```
**Rationale**: liteAPI's amend endpoint only edits guest names; date changes require cancel + rebook cycle (line 26-29, 340-343)

### REPLAY Key Computation
- Same as all adapters: `recordingIdFor(providerId, operation, request)` at `src/providers/recordingStore.ts:29`
- Request is the frozen contract query (e.g., `HotelSearchQuery`)
- Canonical JSON ensures deterministic hashing

### Test Fixtures
- **File**: `test/fixtures/nuitee-hotel-queries.ts`
- **Purpose**: Provides sample `HotelSearchQuery` objects for tests (not found in src/ — test-only fixture)

### Multi-Traveller Limitations
- **Single recorded hotel**: The 2.5 MB search recording likely contains one property search result
- **Occupancy handling**: `buildOccupancies` at line 578 requires explicit child ages; fails closed without them
- **Guest names**: `bookStay` accepts multiple guest names (line 500-514), but the recording is for a single booking
- **Blocking issue**: Programme-scale demo needs multiple search recordings for different traveller configurations (rooms, adults, children)

---

## 3. Atlas Adapter

**Files**: `src/providers/atlas/adapter.ts`, `src/providers/atlas/normalize.ts`

### Implemented Operations
- `searchFlights` (line 96) — searches via `/search.do`
- `verifyOffer` (line 139) — verifies via `/verify.do`
- `getFareRules` (line 153) — retrieves fare rules via `/verify.do` (same endpoint, different normalization)

### Recording Key Format
- **Search**: `recordingIdFor('atlas', 'search', FlightSearchQuery)`
  - Query includes: origin (IATA), destination (IATA), departureDate (YYYY-MM-DD), passengers
  - Example: `rec_ac9fd89bb364d688bbeadef62be55aa5.json`
- **Verify**: `recordingIdFor('atlas', 'verify', { offerId })`
  - Note: verify uses `{ offerId }` not the full `FlightVerifyQuery` (line 147)
- **Fare rules**: `recordingIdFor('atlas', 'fare_rules', { offerId })`

### Flight Routes in Recordings
**Single recording exists**: `fixtures/recordings/atlas/search/rec_ac9fd89bb364d688bbeadef62be55aa5.json`

To determine the route, inspect the recording's request hash or the normalized offers. The recording key is deterministic from the query, but the filename doesn't encode origin/destination directly — it's a SHA256 hash.

**Blocking issue**: Only ONE flight search recording exists. Programme-scale demo needs recordings for multiple routes (home→event, event→home, alternative airports, different dates).

### Normalization
- **Shared path**: LIVE/RECORD/REPLAY all use identical `normalizeSearch`/`normalizeVerify`/`normalizeFareRules` (line 4-6)
- **Timezone handling**: Airport-local schedule strings (`YYYYMMDDHHmm`) converted to ISO instants via IANA timezone resolver (`src/providers/atlas/normalize.ts:226-239`)
- **Passenger counts**: Remembered from search for verify pricing (`src/providers/atlas/adapter.ts:75`)

---

## 4. Model Studio Runtime

**Files**: `src/intelligence/client.ts`, `src/intelligence/northstarPlanner.ts`, `src/intelligence/fallbackPlanner.ts`

### Degradation Without Credentials
- **Unconfigured transport**: `src/intelligence/client.ts:201-212` — `UnconfiguredModelTransport` throws `NOT_CONFIGURED` error
- **Client guard**: `src/intelligence/client.ts:297-307` — returns structured error instead of calling transport
- **No crash**: Construction succeeds; failure is data, not exception (NFR-03)

### Environment Variables
- `MODEL_STUDIO_API_KEY` — API key (optional at startup)
- `MODEL_STUDIO_MODEL` — model name (default: `qwen-flash`)
- `MODEL_STUDIO_BASE_URL` — API base (default: DashScope endpoint)

### REPLAY Support
- **Scripted transport**: `src/intelligence/client.ts:176-194` — `ScriptedModelTransport` consumes pre-recorded responses in order
- **Mode tracking**: `ModelCallMeta.mode` is `'LIVE' | 'REPLAY'` (line 54)
- **No file-based replay**: Unlike providers, model outputs are not recorded to disk; tests inject `ScriptedModelTransport` with committed responses from `test/fixtures/model-outputs`

### Northstar Planner vs Fallback
**NorthstarPlanner** (`src/intelligence/northstarPlanner.ts:87`):
- **Wrapper**: Wraps inner `RecoveryPlanner` (line 88)
- **Path 0 — Initial planning** (line 118): Engagement-only trip → arrival strategies
  - Derives target from anchor-event window + engagement evidence
  - Requests `flight.search` for home→event airport
  - Proposes HELD arrival legs from offers
- **Path A — Window shift** (line 270): ChangeRequest with ResolutionTarget
  - Extracts target from TRAVELLER_INPUT signal payload
  - Selects affected leg by direction (arriveBy → leg arriving at event; departAfter → leg departing)
  - Emits one `flight.search` per window dimension
  - Proposes replacement legs from offers
- **Fallback**: Delegates to inner planner when neither path matches (line 111)

**DeterministicFallbackPlanner** (`src/intelligence/fallbackPlanner.ts:35`):
- **Model-free**: Used when Model Studio credentials absent (credential-free REPLAY demo)
- **Round 1** (line 50-69): Emits `flight.search` tool request for failed leg
- **Round 2** (line 72-96): Enumerates one replacement strategy per normalized offer
- **Limitation**: Only handles directly-failed FLIGHT legs; other disruptions degrade to empty plan with uncertainty

### Config Wiring
- **Planner selection**: `src/app/compose.ts:167` — LIVE Model Studio when configured; otherwise fallback
- **Northstar wrapper**: Applied in composition layer (not shown in client.ts)

---

## 5. Provenance Vocabulary

### AdapterMode Definition
- **Location**: `src/config/config.ts:15` — `AdapterModeSchema = z.enum(['LIVE', 'RECORD', 'REPLAY'])`
- **Re-exported**: `src/contracts/envelope.ts:14-15` — `export { AdapterModeSchema }; export type { AdapterMode }`

### Provenance Vocabulary Usage
**LIVE/RECORD/REPLAY** (adapter modes):
- `src/contracts/envelope.ts:4-5` — LIVE calls provider; RECORD calls + stores; REPLAY loads
- `src/providers/runner.ts:2-5` — same semantics
- `src/config/config.ts:15` — schema definition
- **All adapters**: Atlas (`src/providers/atlas/adapter.ts:182-189`), Nuitée (`src/providers/hotel/nuiteeAdapter.ts:376-388`), Google Routes (`src/providers/googleRoutes/adapter.ts:93-101`)

**SIMULATED** (execution provenance):
- `src/operational/intent.ts:180` — `ExecutionProvenanceSchema = z.enum(['LIVE', 'RECORD', 'REPLAY', 'SIMULATED'])`
- `src/engine/executor.ts:27, 40` — simulated execution results
- `src/app/readmodels.ts:387, 468` — UI labels simulated actions
- `src/contracts/capabilities.ts:221, 249, 315` — `provenance: 'LIVE' | 'REPLAY' | 'SIMULATED'` in booking/action outcomes

**SANDBOX**:
- `src/providers/hotel/nuiteeAdapter.ts:8` — mentions "USE_SANDBOX + USE_LIVE" in docs
- Not a runtime mode; refers to Nuitée's sandbox environment

### CapabilityResult Provenance Flow
- **Meta carries mode**: `src/contracts/envelope.ts:37-44` — `CapabilityMeta { providerId, mode, requestedAt, recordingId? }`
- **Recording ID present**: When RECORD persisted or REPLAY loaded a recording (line 43)
- **Result envelope**: `src/contracts/envelope.ts:50-52` — `CapabilityResult<T> = { ok, data/error, meta }`

### UI Read Models & Provenance
**`src/app/readmodels.ts`**:
- **Operator dashboard** (line 164): Projects from authoritative state; no direct provenance field
- **Case detail** (line 256): Shows simulated actions with label suffix (line 387-391)
  ```typescript
  const simulated = result?.provenance === 'SIMULATED';
  label: `${ACTION_LABEL[intent.operation]}${simulated ? ' (simulated at provider boundary)' : ''}`
  ```
- **Traveller view** (line 433): Same simulated labeling (line 468-471)
- **No adapter mode in UI**: `CapabilityMeta.mode` (LIVE/RECORD/REPLAY) does not surface in read models; only `ExecutionProvenance.SIMULATED` appears

**`src/ui/case-view-model.ts`**:
- **CaseDetailView** (line 68): No provenance field
- **RecoveryOptionView** (line 32): No provenance field
- **ActionProgressView** (line 55): No provenance field; simulated labeling done in readmodels.ts projection

### Provenance Gap
- **Adapter mode (LIVE/RECORD/REPLAY)**: Tracked in `CapabilityMeta` but not projected to UI
- **Execution provenance (LIVE/RECORD/REPLAY/SIMULATED)**: Only SIMULATED surfaces in UI labels
- **Blocking for demo**: Operator cannot see whether recovery options came from LIVE provider calls or REPLAY recordings; only simulated actions are labeled

---

## Programme-Scale Demo Blockers

### 1. Single-Route Flight Recording
- **Issue**: Only ONE Atlas search recording exists (`rec_ac9fd89bb364d688bbeadef62be55aa5.json`)
- **Impact**: Cannot demo multi-traveller programme with different home airports or event destinations
- **Fix**: Record multiple search results for different origin/destination pairs and dates

### 2. Single-Hotel Nuitée Recording
- **Issue**: 2.5 MB search recording likely contains one property search
- **Impact**: Cannot demo programme with travellers needing different hotels or room configurations
- **Fix**: Record multiple search results for different locations, dates, and occupancy patterns

### 3. No Adapter Mode in UI
- **Issue**: Operator cannot distinguish LIVE vs REPLAY results in dashboard
- **Impact**: Demo cannot show "this is a replayed provider response" — looks like live data
- **Fix**: Project `CapabilityMeta.mode` through to `RecoveryOptionView` or `ActionProgressView`

### 4. Model Studio REPLAY is Test-Only
- **Issue**: No file-based recording for model outputs; `ScriptedModelTransport` is test-injected
- **Impact**: Demo cannot replay real model outputs; must use fallback planner or inject scripts
- **Fix**: Add file-based recording for model outputs (like provider recordings)

### 5. Multi-Traveller Occupancy
- **Issue**: Nuitée `buildOccupancies` requires explicit child ages; fails closed without them
- **Impact**: Programme with families needs child age evidence on traveller records
- **Fix**: Ensure traveller records carry child ages, or add default age assumptions

### 6. Single Recording per Operation
- **Issue**: Each provider/operation has exactly one recording (except Nuitée search which is huge)
- **Impact**: Cannot demo different scenarios (price changes, availability changes, disruptions)
- **Fix**: Record multiple scenarios per operation with different request parameters

---

## Summary

**Provider wiring**: Clean separation; global adapter mode; deterministic recording keys; env vars per provider.

**Nuitée**: Full hotel lifecycle except modifyStay (structured UNAVAILABLE); single large search recording is a blocker.

**Atlas**: Read-only flight surface; single search recording is a blocker for multi-route demos.

**Model Studio**: Degrades gracefully without credentials; REPLAY is test-only (no file recordings); fallback planner covers basic recovery.

**Provenance**: Adapter mode tracked but not surfaced in UI; only SIMULATED execution appears in labels; operator cannot see LIVE vs REPLAY distinction.

**Demo blockers**: Single recordings per provider/operation; no multi-route/multi-hotel coverage; adapter mode invisible to operator; model REPLAY is test-only.
