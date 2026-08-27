import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const renderDir = path.join(root, "render");
const stillsDir = path.join(root, "stills");
const video = path.join(renderDir, "benchmark.mp4");
const ffmpeg = execFileSync("where", ["ffmpeg"], { encoding: "utf8" })
  .trim()
  .split(/\r?\n/)[0];

const stamps = [
  { name: "01-healthy-rebook", seconds: 1.2 },
  { name: "02-disruption", seconds: 3.8 },
  { name: "03-scale-reveal", seconds: 7.0 },
  { name: "04-blast-radius", seconds: 10.5 },
];

fs.mkdirSync(stillsDir, { recursive: true });

for (const stamp of stamps) {
  const out = path.join(stillsDir, `${stamp.name}.png`);
  execFileSync(
    ffmpeg,
    [
      "-y",
      "-ss",
      String(stamp.seconds),
      "-i",
      video,
      "-frames:v",
      "1",
      "-update",
      "1",
      out,
    ],
    { stdio: "inherit" },
  );
}

console.log(`Wrote ${stamps.length} stills to ${stillsDir}`);
