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
- `HTTP_PORT` — application server port (default `8787`)
- `ADAPTER_MODE` — `LIVE | RECORD | REPLAY` (default `REPLAY`)
- `RECORDINGS_DIR` — sanitized provider-shaped recordings (default `recordings`)
- `FIXTURES_DIR` — scenario fixtures (default `fixtures`)

### SQLite
- `SQLITE_PATH` — database file path (default `data/app.sqlite`; `:memory:` in tests)

No external database account is required locally. SQLite is embedded. Persistence goes through repository interfaces so deployment can replace it if local disk is ephemeral.

### Alibaba Cloud Model Studio
Used for Qwen extraction/mapping, recovery planning/comparison and agentic web research. Only required for LIVE intelligence; REPLAY/local runs need none. When unconfigured, the recovery planner degrades to the built-in deterministic fallback planner, so the full REPLAY recovery loop (plan → approve → execute → verify) remains runnable with zero credentials.

- `MODEL_STUDIO_API_KEY`
- `MODEL_STUDIO_BASE_URL`
- `MODEL_STUDIO_MODEL`

Start with inexpensive model for plumbing/tests. Upgrade only if evidence shows quality blocks acceptance.

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
