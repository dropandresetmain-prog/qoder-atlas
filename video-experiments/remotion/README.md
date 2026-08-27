# NORTHSTAR Remotion benchmark

Frame-driven, 12-second motion-design benchmark for the NORTHSTAR hackathon film.

```powershell
node node_modules/@remotion/cli/remotion-cli.js still video-experiments/remotion/src/index.ts NorthstarBenchmark video-experiments/remotion/render/stills/close-journey.png --frame=15 --browser-executable "C:\Program Files\Google\Chrome\Application\chrome.exe"
node node_modules/@remotion/cli/remotion-cli.js render video-experiments/remotion/src/index.ts NorthstarBenchmark video-experiments/remotion/render/benchmark.mp4 --codec=h264 --crf=18 --browser-executable "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

The world-space graph is intentionally hand-authored and deterministic. The camera transforms one continuous spatial world from the traveller journey into the programme field; it does not transition between separate layouts.
