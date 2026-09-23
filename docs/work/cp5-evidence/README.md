# CP5 Jordan browser acceptance evidence

**Initial verdict (automated):** `CP5_BROWSER_PASS` @ `19a1350` (2026-09-23)  
**Founder visual QC:** D3 Case graph **rejected** (one horizontal row; traveller in journey spine). CP5 presentation acceptance **reopened**.  
**CP5.1 graph correction:** hierarchical semantic roles + layout — see below.  
**Branch:** `fix/a5-jordan-transaction-recording`  
**Corpus:** `recordings/jordan-corpus-2026-09-23` (`.corpus-isolated`)  
**Mode:** `ADAPTER_MODE=REPLAY`  
**Baseline booking:** `-hCa0gm5w` @ USD 954.16 (not `z-xdzAxcv`)

## Browser progression (Demo Console) — historical CP5

| Stage | Expected | Actual | Result |
| --- | --- | --- | --- |
| Healthy | Green / ready, no Case | 0 needs attention; Event monitored | PASS — `00-healthy-overview.png` |
| D1 | Green / viable; no false red | ZG amber Checking; Jordan CHECKING; 0 open stories; viable overlay | PASS — `01-d1-overview.png` |
| D2 | Amber / AT_RISK; Case monitoring | AT_RISK + Watching; Case open; “monitored… when impossible”; no Path A yet | PASS — `02-d2-overview.png`, `02-d2-case.png` |
| D3 | Red / DISRUPTED; Path A visible | DISRUPTED; 1 open story; Case AWAITING APPROVAL | PASS — `03-d3-overview.png` |
| Planning | Path A recommended; Path B not viable | “Replace the flight and arrange accommodation”; costs use USD 954.16; `original_stay_late_arrival_survival_unknown` in case evidence; Proposed replacement not booked | PASS — `03-d3-case-recommended.png`, `03-d3-case-other-options.png` |

## CP5.1 — Case graph semantic/layout correction

**Status:** awaiting founder visual QC (do **not** start CP6).

Live REPLAY D3 Current `fg-scene` after fix (case `8028fdf8-…` on the CP5.1 agent run):

- Traveller **above** Arrival breakpoint — badge `Trip disrupted` (not a journey step)
- Causal spine: schedule → ZG023 → Arrival (focal)
- Proposed TR flight branches below-right of Arrival (`Proposed`)
- Stay labelled `Stay · lyf Bugis Singapore`; programmes healthy below as dependency context
- Scene size ≈ **984×672** (was ~1812× one-row); multi-row hierarchy

Evidence:

- `cp5-1-d3-graph-scene-dump.txt` — live scene node positions/roles
- `cp5-1-d3-case-graph-1560x1000.png` — 1560×1000 viewport capture of hierarchical layout from that dump

## Product fix during CP5

`membershipOf` in `src/app/target/readmodels/eventOverview.ts`: CURRENT `UNKNOWN` blast members map to **CHECKING** (amber), not **UNRESOLVED** (red). Prevents D1 false-red when Jordan’s population status is still UNKNOWN while the delayed connection remains viable.

Focused test: `test/eventOverview.test.ts` — “CURRENT UNKNOWN blast members stay CHECKING”.

## Case ID (historical CP5 run)

`b4d5ef26-9f5b-53c9-b23d-4e3ac6d1a991`

## Intentionally not executed

CP6 Atlas select/pay/ticket and Nuitée cancel — stopped at AWAITING APPROVAL. **Still deferred until founder accepts the Case graph.**
