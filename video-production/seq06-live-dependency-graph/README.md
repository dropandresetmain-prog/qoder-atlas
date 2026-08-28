# Seq 06 — NORTHSTAR Live Dependency Graph

Standalone NORTHSTAR motion asset. Starts from the exact Seq05 connected-programme handoff, dives into selected traveller journeys and structured constraints, then pulls back into the complete NORTHSTAR-maintained graph.

## Delivery

- Logical stage: 1920×1080
- Duration: 14.0s
- Delivery: 30fps H.264 MP4
- Browser state: deterministic `renderAt(t)`
- Final camera: `translate3d(27px, 56px, 0) scale(0.225)`

## Seq07 foundation

Do not recreate the graph for Seq07. Reuse:

- `video-production/worlds/connected-programme.js` — layout/state source of truth
- `video-production/worlds/connected-programme-build.js` — world builders
- `video-production/shared/programme-graph.css/js` — generic visual primitives

`window.NS.SEQ06_FINAL_GRAPH_STATE()` exposes the baseline state at runtime. The version is `seq06-baseline-v1`.

Seq07 should mutate this baseline in place and add blast-radius propagation; it should not rebuild or rearrange the topology.
