import { bundle } from "@remotion/bundler";
import { renderFrames, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const composerDir = path.resolve(__dirname, "..");
const outputVideo = path.resolve(composerDir, "../render/benchmark.mp4");
const chrome =
  process.env.CHROME_EXECUTABLE ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const ffmpeg = execFileSync("where", ["ffmpeg"], { encoding: "utf8" })
  .trim()
  .split(/\r?\n/)[0];

const entry = path.join(composerDir, "src/index.tsx");
const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), "northstar-frames-"));

console.log("Bundling...");
const serveUrl = await bundle({ entryPoint: entry });

console.log("Selecting composition...");
const composition = await selectComposition({
  serveUrl,
  id: "NorthstarBenchmark",
  inputProps: {},
  browserExecutable: chrome,
});

console.log(`Rendering ${composition.durationInFrames} frames to ${framesDir}...`);
await renderFrames({
  composition,
  serveUrl,
  outputDir: framesDir,
  inputProps: {},
  imageFormat: "jpeg",
  concurrency: 4,
  browserExecutable: chrome,
  chromiumOptions: {
    gl: "angle",
  },
  onFrameUpdate: (rendered) => {
    if (rendered % 30 === 0 || rendered === composition.durationInFrames) {
      console.log(`Rendered ${rendered}/${composition.durationInFrames}`);
    }
  },
  puppeteerInstance: undefined,
  browserExecutable: chrome,
});

const framePattern = path.join(framesDir, "element-%03d.jpeg");
fs.mkdirSync(path.dirname(outputVideo), { recursive: true });

console.log("Stitching with system ffmpeg...");
execFileSync(
  ffmpeg,
  [
    "-y",
    "-framerate",
    String(composition.fps),
    "-i",
    framePattern,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "18",
    outputVideo,
  ],
  { stdio: "inherit" },
);

console.log(`Wrote ${outputVideo}`);
