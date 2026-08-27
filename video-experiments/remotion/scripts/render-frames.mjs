import {bundle} from '@remotion/bundler';
import {getCompositions, renderFrames} from '@remotion/renderer';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const experimentDir = path.resolve(scriptDir, '..');
const entryPoint = path.join(experimentDir, 'src', 'index.ts');
const outputDir = path.join(experimentDir, 'render', 'frames');
const browserExecutable = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

await mkdir(outputDir, {recursive: true});
const serveUrl = await bundle({entryPoint});
const compositions = await getCompositions(serveUrl, {browserExecutable});
const composition = compositions.find(({id}) => id === 'NorthstarBenchmark');

if (!composition) {
  throw new Error('NorthstarBenchmark composition was not found.');
}

await renderFrames({
  composition,
  serveUrl,
  outputDir,
  imageFormat: 'png',
  // Nested range opts into sequence output. A single tuple would overwrite one file.
  frameRange: [[0, composition.durationInFrames - 1]],
  imageSequencePattern: 'frame-[frame].png',
  browserExecutable,
  concurrency: 5,
  onStart: () => undefined,
  onFrameUpdate: (rendered, frame) => {
    if (rendered % 30 === 0 || frame === composition.durationInFrames - 1) {
      console.log(`Rendered frame ${frame + 1}/${composition.durationInFrames}`);
    }
  },
  inputProps: {},
});
