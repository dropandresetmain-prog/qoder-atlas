# SEQ 13 — Traveller breadth: Jonas + Oliver

Deterministic ~12 second capture asset for the NORTHSTAR breadth montage. It is a presentation-boundary choreography using the real Traveller visual contract and approved S5/S7 facts; it does not modify domain recovery logic, authority, provider, or product UI code.

- `0.0–5.3s`: Jonas extends the existing Concorde stay. The event-funded window remains intact, Jonas approves the incremental personal night, and the stay resolves through Sunday 4 October.
- `5.3–5.8s`: stable Traveller chrome switches directly to Oliver; there is no title card.
- `5.8–11.3s`: Oliver replaces only the obsolete London inbound with Tokyo → Singapore, preserves Singapore → London, waits for organiser approval, then resolves.
- `11.3–12.0s`: the healthy Traveller result moves into the fan-out/fan-in language of SEQ 14.

## Deterministic capture

```powershell
python video-production/shared/capture.py `
  --html video-production/seq13-traveller-breadth/index.html `
  --out video-production/seq13-traveller-breadth/render/seq13-traveller-breadth.mp4 `
  --duration 12 --fps 30 `
  --stills 1.8,3.7,6.9,9.0,10.45,11.7 `
  --stills-dir video-production/seq13-traveller-breadth/render/stills
```

The capture harness drives `window.__NS_RENDER_AT__` for each frame, so messages enter as complete chunks and the conversation remains deterministic with sound off.
