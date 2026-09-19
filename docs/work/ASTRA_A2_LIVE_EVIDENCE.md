# A2 Sarah LIVE — first physical run and remaining presentation closure

2026-09-20. Source checkpoint: A1 `a948917c239fc02435020f6740474283dd795ea8`,
`integration/astra-post-r4`. A2 is not yet accepted as video-ready.

## Physical result

Normal `src/main.ts`, PostgreSQL `astra_product`, workspace
`9ef64348-61b2-4e18-a291-152502a89a02`, port4120, headed Chromium1440x1000.
The source disruption is explicitly simulated in the product. Research/model calls are LIVE.

- Persistent Reset completed at 52/67, 15 unconfirmed, nobody needing attention.
- Apply simulated airline update -> 51/67, Sarah needs attention, one decision.
- Case `cecdebed-d554-5f17-828c-a2e6bcd960a6`; planning attempt
  `54e246be-cf23-59c3-a62f-2217d6001bb3`.
- Durable evidence: Atlas `flight.search` SUCCEEDED, mode LIVE,
  observed `2026-09-19T22:24:52.557Z`, CGK->SIN research for30Sep.
- Runtime Qwen domain suggestion: LIVE, `qwen-flash`, returned no additive domains.
  Existing deterministic domains remained authoritative. Its metadata currently exists
  in the process log only; a bounded durable/public provenance fix is required below.
- UI offered a programme swap: headline11:30->13:30 and counterpart13:30->11:30,
  all1Oct GMT+8. It explains the original arrival-readiness failure, fixed rules,
  67 reassessed travel plans, 52 confirmed/15 unconfirmed, and alternatives/rejections.
- Clicked the explicit `Recover Sarah’s trip` approval. Observed applying state.
  Intents `c73c5ba4-0450-4859-9cb7-545dfc0e8433` and
  `ebd780b0-3501-43cf-877f-b539d97c2e22` executed, each attempt1.
- Reassessment drained67 units; Case resolved with all attached Journey/Trip subjects
  CURRENT+PASS after observation. No flight purchase was forced.
- Final Overview52/67, nobody needs attention. Case says trip recovered, two changes
  applied and confirmed, whole trip rechecked. This is actual LIVE research/model plus
  authoritative internal programme execution, not external flight transaction evidence.

Local ignored artifacts: `output/playwright/a2-sarah-live.webm` (8.9MB),
`a2-reset-status.yml`, `a2-disrupted.yml`, `a2-recovered-case.yml/.png`,
`a2-recovered-overview.yml`. Recording is a first physical proof, not a finished submission edit.

## Findings and next checks

- **Act Now — public provider/model provenance.** Case activity strips already stored
  provider/mode details; Qwen metadata is not durable. Preserve actual bounded call
  provider/model/mode/status/time, never prompts/raw output/private reasoning. A boot
  configuration does not prove a call succeeded. Recheck the visible surface on a fresh LIVE run.
- **Act Now — exact programme participation state.** Latest stored Sarah assessment
  `a6604c6b-fada-4fca-a7c9-dc7dca9f785b` explicitly says `participation_feasible`, PASS,
  for programme item `753ab5de-5d9d-5a2c-8622-c94813369eb3`, but Case node says UNKNOWN.
  Reclassifies only this evidenced R4 parked graph gap. Project the matching current
  participation explanation, never inherit overall Journey PASS or unrelated failure.
- **Act Now — impact wording.** `strategy.resolves` supplies people whose trip this option
  fixes, but UI labels it Who is affected. Use accurate recovery wording until full direct
  participant impact is supplied; do not imply it lists every attendee affected by a swap.
- **Investigate Now — evidence completion time.** The attempt completed_at equals its
  start while provider observedAt is later. Fix metadata clock without altering frozen
  deterministic basis/evaluation time; focused persistence evidence is required.
- **Park for Later — broad programme impact presentation.** All67 current travel plans
  were evaluated. A richer direct-attendee list remains separate from resolves and
  reassessment closure. Do not fabricate a blast radius in the browser.

Next: merge focused provenance/participation closures, restart normal LIVE composition,
repeat the physical Sarah path with visible factual evidence, then push A2. No broad suite
rerun is justified for a normal debugging loop; use focused and exact PG seams.
