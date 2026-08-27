# OpenMontage feasibility — experiment report

## Question
Does OpenMontage materially accelerate NORTHSTAR motion production vs direct Remotion/HTML-GSAP?

## Verdict
**PARTIAL** — useful pipeline vocabulary and preflight, but the actual benchmark motion still required hand-authored Remotion. OpenMontage did not shorten the critical path for bespoke product semantics (journey chain, fleet grid, programme readout).

## What OpenMontage actually did

| Stage | OpenMontage contribution |
|-------|-------------------------|
| Preflight | `video_compose.get_info()` confirmed FFmpeg + Remotion available |
| Pipeline selection | `animation` manifest + stage director skills read for structure |
| Proposal | Locked `render_runtime: remotion` (HyperFrames absent in baron2050 fork) |
| Scene plan / edit | JSON artifacts under `artifacts/` |
| Assets | Skipped — $0 rule, no image/video/TTS generation |
| Compose | **Blocked** — vendor `video_compose` + Remotion CLI fail on Windows ARM64 compositor |
| Actual render | Custom `render-with-system-ffmpeg.mjs`: `renderFrames` + system Chrome + winget FFmpeg |

## Renderer / pipeline selected
- **Locked:** Remotion (`render_runtime: remotion`)
- **Delivered:** Remotion React composition (`NorthstarBenchmark`) → JPEG frame sequence → system FFmpeg H.264
- **Not used:** HyperFrames (not in cloned fork), paid providers, stock footage, AI generation

## Strongest benefit
Structured production stages (research → proposal → scene_plan → edit → compose) and preflight discovery reduce ambiguity about which local engines are available. Skills/docs are a good checklist for agent orchestration.

## Biggest friction
1. **No Windows ARM64 Remotion compositor** — both `npx remotion render` and OpenMontage `video_compose` fail at stitch unless you bypass with system FFmpeg.
2. **Vendor Explainer scene types don't model NORTHSTAR** — text_card/stat_card/charts cannot express journey-chain propagation without a custom composition anyway.
3. **HyperFrames path documented elsewhere but missing** from baron2050/OpenMontage clone used here.
4. **Agent-first = agent still writes all motion code** — OpenMontage orchestrates process, not pixels, for this brief.
5. **Environment setup tax** — FFmpeg not preinstalled; OpenMontage vendor clone + remotion-composer npm install (~3 min).

## Iteration convenience
Re-render after code tweak: ~40s for 360 frames on this machine once workaround script exists. No live Remotion Studio preview used (CLI blocked). Acceptable but not faster than direct Remotion project.

## Justify keeping OpenMontage?
**Not for NORTHSTAR explainer motion** at this stage. Direct Remotion or HTML/GSAP with a thin project scaffold is simpler. Revisit if we need narrated explainers with stock/TTS pipelines or if HyperFrames fork is integrated and stable on our targets.

## Outputs
- `render/benchmark.mp4` — 1920×1080, 12s
- `stills/*.png` — phase stills
