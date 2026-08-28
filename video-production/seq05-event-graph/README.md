# Seq 05 — Event as Connected State

Standalone NORTHSTAR motion asset. Starts from the Seq04 programme-scale traveller field and reveals the event/programme structure that exists beyond the prior camera frustum.

## Delivery

- Logical stage: 1920×1080
- Duration: 9.0s
- Delivery: 30fps H.264 MP4
- Browser state: deterministic `renderAt(t)`
- Final camera: `translate3d(27px, 56px, 0) scale(0.225)`

## Continuity

- Opening reproduces Seq04 final camera/world state.
- Final frame is the Seq05→Seq06 handoff.
- `render/stills/handoff-final.png` must visually match Seq06 `render/stills/opening-handoff.png`.

The connected programme layout is not owned by this sequence. Source of truth is:

`video-production/worlds/connected-programme.js`
