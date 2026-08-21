# Environment and External Services

This file defines setup expectations, not secret values.

## Principles
- Core application must start without optional external credentials in REPLAY/local mode.
- Never commit `.env*`, API keys, OAuth tokens, raw sensitive provider responses or local SQLite databases.
- External-provider failures degrade to structured unavailable/unknown states rather than crashing core engine.

## Expected configuration areas

Exact variable names are frozen during application foundation.

### Application
- environment
- base URL/callback origin if needed
- log level
- adapter mode: `LIVE | RECORD | REPLAY`
- recording/fixture path

### SQLite
- database file path

No external database account is required locally. SQLite is embedded. Persistence goes through repository interfaces so deployment can replace it if local disk is ephemeral.

### Alibaba Cloud Model Studio
Used for Qwen extraction/mapping, recovery planning/comparison and agentic web research. Configuration includes API key/region/base endpoint/model IDs required by selected SDK/API.

Start with inexpensive model for plumbing/tests. Upgrade only if evidence shows quality blocks acceptance.

### Atlas direct API
Needed for LIVE flight capability. Configuration includes sandbox/client credentials and environment/base URL.

Authoritative capability docs live in `dropandresetmain-prog/atlas-hackathon-lab`. Do not treat sandbox Search data as real market evidence.

### Google Maps Routes
Optional/non-blocking dynamic routing. Setup generally requires Google Cloud project, billing enabled, Routes API enabled and restricted API key. Core must support REPLAY/fallback when absent.

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
