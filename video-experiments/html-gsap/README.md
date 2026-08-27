# NORTHSTAR HTML + SVG + GSAP renderer benchmark

Bounded 12-second bakeoff for A1/A2 visual quality. This is isolated from the production application.

## Playback

Open `index.html` in a browser with network access. GSAP 3.15.0 is loaded from the public jsDelivr CDN and drives one master timeline. Press `R` to replay.

The choreography itself is deterministic through `window.__northstarRender(t)`, so the same exact state can be rendered at any timestamp without random motion.

## Deterministic local capture

Requires only Chromium, Node 22+ and FFmpeg:

```bash
node video-experiments/html-gsap/capture.mjs
```

Outputs:

- `render/benchmark.mp4`
- `render/screenshots/01-close-journey.png`
- `render/screenshots/02-cascade.png`
- `render/screenshots/03-maximum-pullout.png`
- `render/screenshots/04-blast-radius.png`

The capture path calls the same deterministic render function directly via the Chrome DevTools Protocol, then FFmpeg assembles the browser-rendered frames. No paid tools, APIs, subscriptions, stock assets or generated media are used.
