# OpenMontage feasibility experiment — NORTHSTAR benchmark

Bounded experiment for the hackathon video renderer bakeoff. OpenMontage vendor copy lives in `.vendor/OpenMontage` (gitignored). Custom Remotion composition in `composer/`.

## Pipeline followed (animation)

1. **Preflight** — `video_compose.get_info()` → FFmpeg + Remotion available; HyperFrames absent in this fork.
2. **Proposal** — locked `render_runtime: remotion` (see `artifacts/proposal_packet.json`).
3. **Scene plan** — four beats matching the ~12s benchmark (`artifacts/scene_plan.json`).
4. **Assets** — none generated; code-only motion (no paid image/video/TTS).
5. **Edit** — `artifacts/edit_decisions.json` points at custom composition.
6. **Compose** — direct `npx remotion render` from isolated `composer/` (OpenMontage `video_compose` targets vendor `Explainer` composition only).

## Render

```bash
cd composer
npm install
npm run render
node scripts/extract-stills.mjs
```

Output: `render/benchmark.mp4`, `stills/*.png`

## Findings summary

See commit message and experiment return fields. OpenMontage provided pipeline structure and preflight; NORTHSTAR-specific motion still required a hand-authored Remotion composition. Vendor `Explainer` scene types (text_card, stat_card, charts) do not express journey-chain / fleet-grid semantics without extension.
