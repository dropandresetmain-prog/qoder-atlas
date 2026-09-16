# Environment and External Services

This file defines setup expectations, not secret values.

## Principles

- **PostgreSQL + PostGIS is the sole normal NORTHSTAR runtime.**
- SQLite is retired as an application runtime and may be used only as explicit offline, read-only migration input or historical test data.
- Core application behaviour must start without optional external-provider credentials in REPLAY/local mode, but the PostgreSQL runtime itself must be available.
- Never commit `.env*`, API keys, OAuth tokens, raw sensitive provider responses or local SQLite databases.
- External-provider failures degrade to structured unavailable/unknown states rather than crashing the core engine.
- LIVE/RECORD is always an intentional operator choice; routine tests should stay credential-free unless a specific live capability is being proven.

## Current runtime configuration

### Application

- `APP_ENVIRONMENT` — `local | dev | demo` (default `local` where the auxiliary config surface uses it)
- `LOG_LEVEL` — `debug | info | warn | error` (default `info`)
- `HTTP_PORT` — application server port (default `8787`; host `PORT` wins when both are set)
- `ADAPTER_MODE` — `LIVE | RECORD | REPLAY` (default `REPLAY`)
- `RECORDINGS_DIR` — sanitized provider-shaped recordings
- `FIXTURES_DIR` — scenario fixtures

### PostgreSQL / PostGIS — current runtime

The normal runtime boots through the target PostgreSQL composition.

Required for a real product boot:

- a reachable PostgreSQL database with the NORTHSTAR migrations available;
- `PG_TARGET_WORKSPACE_ID` identifying the workspace the application should serve.

Current configuration variables are read by `src/persistence/postgres/config.ts`:

- `PG_TARGET_WORKSPACE_ID`
- `PG_TARGET_HOST` (local test default `localhost`)
- `PG_TARGET_PORT` (local compose default `55432`)
- `PG_TARGET_DATABASE` (local test default `northstar_test`)
- `PG_TARGET_USER`
- `PG_TARGET_PASSWORD`
- `PG_TARGET_SSL`
- `PG_TARGET_POOL_MAX`
- `PG_TARGET_MIGRATIONS_DIR` when an explicit migration directory override is required.

`PGTEST_*` variables used by the local Docker Compose test instance may be accepted as fallbacks for matching target values where implemented.

`npm run build` copies the SQL migration files required by the built runtime. `npm start` must boot the built PostgreSQL target composition; it must not fall back to SQLite.

### Local PostgreSQL test instance

Requires Docker or another OCI runtime that understands `docker compose`.

```bash
npm run db:postgres:up
npm run test:postgres
npm run db:postgres:down
```

`docker-compose.postgres-test.yml` binds to port `55432` by default. The test database is disposable by design; `db:postgres:down` removes its data.

For product development, use isolated databases/workspaces between parallel lanes when they can mutate state. Separate Git worktrees do not isolate a shared PostgreSQL database.

## SQLite — migration/historical only

`SQLITE_PATH` is **not** a normal application-runtime setting anymore.

It may appear only when explicitly operating on a historical SQLite source or historical tooling. The retained migration path is:

`legacy SQLite -> read-only exporter -> deterministic bundle -> PostgreSQL importer -> recomputation/reconciliation`

The migration source opener is deliberately read-only. Do not use the retired `openDatabase()` application path to inspect a source that may need preservation because that legacy API can perform writes on open.

Historical/ignored `data/app.sqlite` files are not assumed to contain valuable state. Before final M11 activation, perform one bounded external read-only inventory of any developer/deployment volumes that historically ran NORTHSTAR. If no meaningful source exists, record that there is no migration source. If one exists, freeze/copy/hash it before export/import.

## Intelligence provider

The application talks to live intelligence through the provider-neutral intelligence boundary. Model output remains proposal/extraction data subject to schema validation and deterministic viability/authority/execution gates.

- `INTELLIGENCE_PROVIDER` — `model_studio | openrouter` (default `model_studio` where configured)

REPLAY must not make a live model call even if credentials are present.

### Alibaba Cloud Model Studio

Preferred WiT/Alibaba demo provider for Qwen-backed extraction/planning where live intelligence is explicitly enabled.

- `MODEL_STUDIO_API_KEY`
- `MODEL_STUDIO_BASE_URL`
- `MODEL_STUDIO_MODEL`
- `MODEL_STUDIO_TIMEOUT_MS`

Regional note: Model Studio mainland-China and international deployments use different key stores. A key issued for one region can return `invalid_api_key` against the other. If a valid key fails, confirm whether `MODEL_STUDIO_BASE_URL` should use the international endpoint before assuming the key is wrong.

### OpenRouter

Optional second intelligence provider over the same schema-validated completion boundary.

- `OPENROUTER_API_KEY`
- `OPENROUTER_BASE_URL`
- `OPENROUTER_MODEL`
- `OPENROUTER_TIMEOUT_MS`

No provider choice weakens deterministic validation or authority gates.

## Atlas direct API

Needed only for LIVE flight capability.

- `ATLAS_ENV` (default `sandbox`)
- `ATLAS_BASE_URL`
- `ATLAS_CLIENT_ID`
- `ATLAS_CLIENT_SECRET`

Authoritative capability docs live in `dropandresetmain-prog/atlas-hackathon-lab`. Do not treat sandbox Search data as real market evidence.

## Nuitée / liteAPI hotel

Needed only for LIVE/RECORD hotel capability. Credential-free routine work can use replay fixtures.

- `NUITEE_API_KEY`
- `NUITEE_SEARCH_BASE_URL`
- `NUITEE_BOOKING_BASE_URL`

LIVE/RECORD should fail closed with structured configuration/provider errors when credentials are absent.

## Google Routes

Optional/non-blocking dynamic routing.

- `GOOGLE_ROUTES_API_KEY`

Core recovery must support replay/fallback when absent.

## Frankfurter / FX evidence

Frankfurter provides dated ECB-reference comparison evidence where wired. It is not a payment FX service. Routine replay/deterministic evidence should remain available without depending on live network success.

## Optional / stretch providers

Hotelbeds Transfers and future provider integrations are not required for the current Slice A/Slice B critical path unless separately approved.

Do not add a provider merely because a UI could display it.

## LIVE / RECORD / REPLAY

### LIVE
Call the provider/source, normalize the response, and continue through the normal engine.

### RECORD
Call the provider/source, sanitize and save a provider-shaped recording where allowed, then run the same normalization/downstream engine.

### REPLAY
Load saved provider-shaped data and run the same normalization/downstream engine.

Record/replay external boundary inputs/results, not precomputed internal assessments, cases or UI outcomes.

## Provider recordings

Commit recordings only if they contain no secrets/unsafe personal data, terms allow storage/use, and they are intentionally curated as test/demo fixtures. Otherwise keep them in ignored local paths and create safe fixtures.

## Deployment

The deployable application is the PostgreSQL target runtime:

`npm run build -> npm start -> dist/main.js -> POSTGRES_TARGET`

Deployment must provide PostgreSQL connectivity/workspace configuration and may provide optional live provider credentials.

Do not mount or configure a SQLite database as an application fallback.

M11 is the final operational activation/retirement milestone, not the point where source code first switches from SQLite to PostgreSQL. Before M11 activation verify sole-writer/authority state, final provenance/reconciliation, backup/restore readiness, any externally retained legacy source disposition, and retirement/fencing of old operational tooling such as the embedded legacy acceptance runner.
