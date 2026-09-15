# Environment and External Services

This file defines setup expectations, not secret values.

## Principles
- Core application must start without optional external credentials in REPLAY/local mode.
- Never commit `.env*`, API keys, OAuth tokens, raw sensitive provider responses or local SQLite databases.
- External-provider failures degrade to structured unavailable/unknown states rather than crashing core engine.

## Expected configuration areas

Variable names were frozen during the F0 foundation and are implemented in `src/config/config.ts` (see `.env.example`). The app starts with **zero** variables set (REPLAY/local defaults).

### Application
- `APP_ENVIRONMENT` — `local | dev | demo` (default `local`)
- `LOG_LEVEL` — `debug | info | warn | error` (default `info`)
- `HTTP_PORT` — application server port (default `8787`; host `PORT` wins when both are set, e.g. Railway)
- `ADAPTER_MODE` — `LIVE | RECORD | REPLAY` (default `REPLAY`)
- `RECORDINGS_DIR` — sanitized provider-shaped recordings (default `recordings`)
- `FIXTURES_DIR` — scenario fixtures (default `fixtures`)

### SQLite
- `SQLITE_PATH` — database file path (default `data/app.sqlite`; `:memory:` in tests)

No external database account is required locally. SQLite is embedded. Persistence goes through repository interfaces so deployment can replace it if local disk is ephemeral.

### Intelligence provider (Model Studio / OpenRouter)
The application talks to live intelligence (recovery planning, extraction, research) through one provider-neutral `IntelligenceClient` (`src/intelligence/client.ts`). `INTELLIGENCE_PROVIDER` selects which provider that client is configured for; everything downstream (prompts, Zod schema validation, planner/extraction/research mapping, the deterministic viability/authority/execution boundary) is identical regardless of provider — the provider only supplies a model completion.

- `INTELLIGENCE_PROVIDER` — `model_studio | openrouter` (default `model_studio`)

Only required for LIVE intelligence; REPLAY/local runs need none, and **REPLAY never makes an external call to either provider even when credentials for one are present** — provider choice never affects the deterministic safety boundary. When the selected provider is unconfigured (or in REPLAY), the recovery planner degrades to the built-in deterministic fallback planner, so the full REPLAY recovery loop (plan → approve → execute → verify) remains runnable with zero credentials.

#### Alibaba Cloud Model Studio (preferred WiT/Alibaba demo provider)
Used for Qwen extraction/mapping, recovery planning/comparison and agentic web research. Select with `INTELLIGENCE_PROVIDER=model_studio` (the default).

- `MODEL_STUDIO_API_KEY`
- `MODEL_STUDIO_BASE_URL`
- `MODEL_STUDIO_MODEL`
- `MODEL_STUDIO_TIMEOUT_MS`

Start with inexpensive model for plumbing/tests. Upgrade only if evidence shows quality blocks acceptance.

**Regional endpoint (DR-0 finding, 24 Aug 2026):** Alibaba Cloud Model Studio has two separate regional deployments with disjoint key stores — mainland China (`https://dashscope.aliyuncs.com/compatible-mode/v1`, the code default) and international (`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`, Singapore-based). A key issued in one region's console returns `invalid_api_key` against the other region's endpoint even when the key is genuinely valid. If a LIVE call fails with `invalid_api_key` despite a correct key, try setting `MODEL_STUDIO_BASE_URL` to the international endpoint before assuming the key itself is wrong.

#### OpenRouter
A second first-class intelligence provider over the same OpenAI-compatible chat-completions surface. Select with `INTELLIGENCE_PROVIDER=openrouter`.

- `OPENROUTER_API_KEY`
- `OPENROUTER_BASE_URL` (default `https://openrouter.ai/api/v1`)
- `OPENROUTER_MODEL` (default `openrouter/free`)
- `OPENROUTER_TIMEOUT_MS`

`openrouter/free` is OpenRouter's own free-models auto-router: it routes to whichever free underlying model is currently available rather than promising one fixed model. Because the underlying model can vary, model output still goes through the exact same strict Zod schema validation as Model Studio — malformed or non-conforming output is rejected (`INVALID_OUTPUT`) and fails closed, exactly as it would for any other provider; there is no relaxed validation path and no silent fallback to a different, paid OpenRouter model. If a pinned (non-free) OpenRouter model is needed instead, set `OPENROUTER_MODEL` to a specific `<vendor>/<model>` or `<vendor>/<model>:free` identifier from `openrouter.ai/models`.

### Atlas direct API
Needed only for LIVE flight capability.

- `ATLAS_ENV` (default `sandbox`)
- `ATLAS_BASE_URL`
- `ATLAS_CLIENT_ID`
- `ATLAS_CLIENT_SECRET`

Authoritative capability docs live in `dropandresetmain-prog/atlas-hackathon-lab`. Do not treat sandbox Search data as real market evidence.

### Google Maps Routes
Optional/non-blocking dynamic routing. Core must support REPLAY/fallback when absent.

- `GOOGLE_ROUTES_API_KEY`

### Nuitée / liteAPI hotel
Needed only for LIVE/RECORD hotel capability. Duffel Stays was the documented first choice; it is unavailable in Singapore, so the IMPLEMENTATION_PLAN Section 13 fallback clause fired and Nuitée (liteAPI) is the wired hotel provider (see the hotel lifecycle rows in `docs/CAPABILITIES_AND_LIMITATIONS.md`). The committed `fixtures/recordings/nuitee` corpus replays credential-free.

- `NUITEE_API_KEY`
- `NUITEE_SEARCH_BASE_URL` (defaults to `https://api.liteapi.travel/v3.0`)
- `NUITEE_BOOKING_BASE_URL` (defaults to `https://book.liteapi.travel/v3.0`)

LIVE/RECORD fail closed with NOT_CONFIGURED while `NUITEE_API_KEY` is absent.

### Booking.com Demand API
Not required for MVP. Credentials/access are a separate bounded investigation. Do not add variables until access is approved and adapter accepted into scope.

## LIVE / RECORD / REPLAY

### LIVE
Call provider and normalize response.

### RECORD
Call provider, sanitize sensitive values where required, persist provider-shaped response for replay, then run same normalizer.

### REPLAY
Load saved provider-shaped response and run same normalizer/downstream engine.

Do not maintain separate demo logic paths.

## Provider recordings

Commit recordings only if they contain no secrets/unsafe personal data, terms allow storage/use, and they are intentionally curated as test/demo fixtures. Otherwise keep in ignored local paths and create safe fixtures.

## Deployment

Deployment target is not frozen. Avoid architecture requiring persistent local disk outside storage abstraction. If target filesystem is ephemeral, replace SQLite repository implementation or attach persistent storage; do not rewrite domain logic.

## Target PostgreSQL + PostGIS foundation (M1, isolated — not the active runtime)

`docs/DATA_STRUCTURE_LOGICAL_SCHEMA.md` and `docs/refactor/evidence/M1.md` are
normative for the target persistence foundation. This section is only setup
instructions. **The application's default composition still uses SQLite**
(`SQLITE_PATH` above); nothing here changes that. `src/persistence/postgres/**`
is an isolated seam imported only by its own tests and
`composeTargetRuntime.ts` — never by `src/main.ts`/`src/app/compose.ts`.

### Starting the isolated test instance

Requires Docker (or another OCI runtime that understands `docker compose`).

```bash
npm run db:postgres:up      # postgis/postgis:16-3.4, isolated port/volume
npm run test:postgres       # real-PostgreSQL M1 integration suite
npm run db:postgres:down    # stop and discard all test data (tmpfs-backed)
```

`docker-compose.postgres-test.yml` binds to `55432` by default (override with
`PGTEST_PORT`/`PGTEST_HOST`/`PGTEST_USER`/`PGTEST_PASSWORD`/`PGTEST_DB` env
vars before `up`). Data lives on `tmpfs` inside the container — intentional:
this is a disposable test instance, never a persistent store, and
`db:postgres:down` (`-v`) discards it completely.

### Target-runtime configuration variables

Read by `src/persistence/postgres/config.ts` — completely separate from
`loadConfig()`/`AppConfigSchema` above; setting these has **no effect** on the
default SQLite runtime.

- `PG_TARGET_HOST` (default `localhost`)
- `PG_TARGET_PORT` (default `55432`, matching the compose file's default)
- `PG_TARGET_DATABASE` (default `northstar_test`)
- `PG_TARGET_USER` / `PG_TARGET_PASSWORD` (default `northstar_test` / `northstar_test`)
- `PG_TARGET_SSL` (default `false`)
- `PG_TARGET_POOL_MAX` (default `10`)
- `PG_TARGET_MIGRATIONS_DIR` (default: `src/persistence/postgres/migrations`)

`PGTEST_*` variables (used by the compose file itself) are also accepted as
fallbacks for the matching `PG_TARGET_*` variable, so one `.env` block can
configure both the container and the client.

Never commit real credentials for this instance; the defaults above are
test-only and match the compose file's own test-only defaults.

### Driver

`pg` (node-postgres) v8 — maintained, explicit parameterized SQL, explicit
`BEGIN`/`COMMIT`/`ROLLBACK` transaction control via a checked-out
`PoolClient`. No ORM/query-builder is used; see
`src/persistence/postgres/pool.ts` and `docs/refactor/evidence/M1.md` for the
full rationale.
