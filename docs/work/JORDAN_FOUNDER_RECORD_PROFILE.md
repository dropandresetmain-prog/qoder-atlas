# Jordan founder RECORD profile (A5 CP2)

Controlled transactional recording for founder video capture. **Not** A5.2 destructive LIVE acceptance and **not** a production payment path.

## Founder startup command

```bash
npm run demo:record
```

Equivalent manual profile (same composition as the script):

```bash
NORTHSTAR_DEMO_PROFILE=record npm run dev
```

Preflight runs before boot: missing sandbox credentials print required variable **names** and exit non-zero (no secrets in logs).

## Provider modes (this profile)

| Surface | Mode | Host / boundary | Money-moving? |
| --- | --- | --- | --- |
| Atlas flight search & state | **RECORD** | `ATLAS_ENV=sandbox`; `ATLAS_BASE_URL` must be `sandbox.atriptech.com` | Sandbox test-balance only (`atlas-sandbox-balance`); adapter refuses non-sandbox hosts |
| Atlas offer select / pay / ticket | **RECORD** | Composed only when sandbox credentials + `ADAPTER_MODE=RECORD` | Same sandbox balance; attempts durable before network |
| Nuitée stay book/cancel | **RECORD** | Sandbox API key (`NUITEE_API_KEY`; optional base URL overrides) | Sandbox booking rails only |
| Default when profile unset | **REPLAY** | Fixture/recordings corpus | No provider calls; execution **not** composed |

`ADAPTER_MODE=RECORD` writes **sanitized** provider-shaped captures under `RECORDINGS_DIR` for later REPLAY. Intelligence (Model Studio / OpenRouter) remains independent of Atlas mode.

## Env composition (`NORTHSTAR_DEMO_PROFILE=record`)

Forced markers (override sticky `ADAPTER_MODE=REPLAY` in `.env.local`):

- `ADAPTER_MODE=RECORD`
- `ATLAS_ENV=sandbox`
- `NORTHSTAR_SYNTHETIC_SANDBOX_INPUTS=1` (dataset synthetic passports / execution inputs at boot)

Still required in **`.env.local`** (see `.env.example`; never commit values):

- `PG_TARGET_*` and `PG_TARGET_WORKSPACE_ID`
- `NORTHSTAR_DEMO_DATASET_DIR` (AiT demo pack)
- `ATLAS_BASE_URL`, `ATLAS_CLIENT_ID`, `ATLAS_CLIENT_SECRET`
- `NUITEE_API_KEY` (and optional `NUITEE_SEARCH_BASE_URL` / `NUITEE_BOOKING_BASE_URL`)

## Safety boundaries

- **Sandbox only** for consequential Atlas/Nuitée execution; production Atlas hosts are refused at the adapter.
- **No production card rails** — Atlas pay uses the approved sandbox balance handle inside the transaction adapter.
- **RECORD ≠ authorize** — viability, authority, budget, and execution gates unchanged from R3/R4.
- **REPLAY default preserved** — omit `NORTHSTAR_DEMO_PROFILE` for founder QC (`docs/work/A5_1_FOUNDER_QC_RUNBOOK.md`).

## Deferred

Unified all-provider LIVE/RECORD profile (single env switch for every external capability) is **parked** — see `docs/work/ACTIVE_TASK.md`.
