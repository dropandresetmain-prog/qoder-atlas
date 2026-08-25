# AiT Demo Input Pack (NORTHSTAR)

Bounded demo input and provenance pack for the Northstar demo. This pack is
**data and documentation only**: it contains no domain/application code, no
recovery logic, and makes no Model Studio or Google Routes calls.

## The event

**AiT — AI in Travel Summit 2026** (synthetic event)

- Destination: Singapore
- Dates: 30 Sep – 2 Oct 2026 (Wed–Fri), Asia/Singapore (GMT+8)
- Venue: Marina Bay Sands Expo & Convention Centre

The AiT programme **structurally mirrors** the publicly announced upcoming
**WiT Singapore 2026** programme (30 Sep – 2 Oct 2026): same day layout
(pre-conference innovation day + two main-stage days organised into thematic
"Acts"), same session timing patterns, same role mix (host/interviewer,
keynote speaker, moderator, panellist, coach, judge, dragon, facilitator,
curator), and the same shared-dependency patterns (serial host dependency,
recurring investor panel, cross-day competition announcements).

Structural facts about WiT Singapore 2026 are normalized from the public web
with source URLs and fetch timestamps under
[`sources/public-web/wit-singapore-2026-normalized.json`](sources/public-web/wit-singapore-2026-normalized.json).
No copyrighted programme prose is copied, and **no private travel information
is invented for any real WiT speaker**. All travel facts in this pack concern
fully synthetic personas.

## Layout

| Path | Content |
| --- | --- |
| `sources/source-registry.json` | Provenance registry; every input cites source ids from here. |
| `sources/public-web/` | Public-web normalization (WiT Singapore 2026 structure). |
| `global/` | Machine-readable global inputs: AnchorEvent, normalized programme, roster, programme importance, organiser policy, operational constraints, Place/venue context. |
| `scenarios/s1-supplier-disruption/` … `s8-speaker-group-travel/` | Complete literal input packs for S1–S8. |
| `docs/DEMO_INPUTS.md` (repo `docs/`) | Describes every input and its source. |

## Provenance taxonomy

Every input is classified using exactly these labels:

| Label | Meaning |
| --- | --- |
| `PUBLIC_WEB` | Fetched from the public web; URL + fetch timestamp preserved. |
| `ORGANISER_SUPPLIED_SYNTHETIC` | Synthetic organiser-authored input (event, roster, policy, constraints). |
| `TRAVELLER_SUPPLIED_SYNTHETIC` | Synthetic traveller-authored input (natural messages, intents). |
| `PROVIDER_LIVE` | Real provider data. **Not used in this pack** (no live calls made). |
| `NATIVE_UI` | Inputs authored as native Northstar actions (Preview/Commit). |
| `SIMULATED_EXTERNAL_EVENT` | Simulated external-boundary effect (e.g. airline schedule-change feed). Disclosed; never presented as LIVE. |

Synthetic facts are never labelled public or live. Simulated seams are always
explicit in both data (`provenance` fields) and documentation.

## Atlas sandbox feasibility (dates and origins)

Public Atlas sandbox evidence recorded in this repository
(`docs/ROADMAP.md` DR-probe record; `docs/reality-validation/WAVE3R_CAPABILITY_REALITY_REPORT.md`)
shows SIN inbound searches return real offers from
`KUL / BKK / MNL / HKG / CGK / SYD / TYO` (carriers TR, VJ, AK, FD, OD, D7),
and `KUL→SIN` completed the full order/pay/ticket chain on a date inside the
demo window (2026-09-23). Travel-managed origins in the synthetic roster are
therefore concentrated on these proven gateways; long-haul origins appear only
where a scenario explicitly requires them and are flagged as not
sandbox-proven. **The 30 Sep – 2 Oct 2026 window is usable; no date adjustment
is recommended.**

## Ground rules honoured by this pack

- Scenario facts live only in data/docs — `src/**` is untouched.
- No real-person private travel facts are invented.
- Policy values live entirely in data (`global/organiser-policy.json`).
- Anything the existing schema cannot express is recorded as a schema gap for
  the primary integrator (see `docs/DEMO_INPUTS.md` §Schema gaps).
