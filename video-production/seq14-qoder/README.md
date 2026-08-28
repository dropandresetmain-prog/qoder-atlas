# SEQ 14 — Qoder fan-out / fan-in

Standalone ~8s NORTHSTAR motion asset showing bounded parallel Qoder work converging through one controlled integration and verification path.

## Preview

Open `index.html` in a browser. The logical stage is always 1920×1080; normal browser preview scales the complete stage to fit the viewport.

## Deterministic render

```bash
python video-production/shared/capture.py \
  --html video-production/seq14-qoder/index.html \
  --out video-production/seq14-qoder/render/seq14-qoder.mp4 \
  --duration 8 --fps 30 \
  --stills 0.8,2.8,4.75,6.65,7.70 \
  --stills-dir video-production/seq14-qoder/render/stills
```

The capture harness directly sets sequence timestamps before every frame, then encodes the 240 deterministic browser frames with FFmpeg.

## Brand note

Qoder identity is intentionally restrained as a text wordmark. No unofficial logo asset is bundled; the animation does not depend on external media.
