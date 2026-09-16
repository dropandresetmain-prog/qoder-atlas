/**
 * CLI: render the Frontend Semantic Contract Lab to a self-contained static HTML
 * file, or serve it locally for browser inspection. Development-only.
 *
 * Usage:
 *   node --experimental-strip-types scripts/contract-lab-preview.ts
 *       -> writes data/ui-preview/contract-lab.html (git-ignored)
 *   node --experimental-strip-types scripts/contract-lab-preview.ts --serve
 *       -> serves http://127.0.0.1:8790/contract-lab
 *   node --experimental-strip-types scripts/contract-lab-preview.ts --serve --port 9001
 *
 * Imports ONLY the pure UI presentation layer (src/ui/screens/contract-lab.ts and
 * its semantics dependencies) plus the fixtures/ui corpus. There is no database,
 * no server runtime composition, no provider or live read-model wiring here.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderContractLabDocument, type ContractLabSample } from '../src/ui/screens/contract-lab.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const fixturesPath = join(repoRoot, 'fixtures', 'ui', 'semantic-contract.json');
const outPath = join(repoRoot, 'data', 'ui-preview', 'contract-lab.html');

function loadSamples(): ContractLabSample[] {
  const parsed: unknown = JSON.parse(readFileSync(fixturesPath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${fixturesPath} must be a JSON array of contract-lab samples`);
  }
  // Each sample's graph/viability/progression is validated loudly by the adapter
  // when the renderer presents it; the envelope is structural only.
  return parsed as ContractLabSample[];
}

function argValue(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const candidate = Number(process.argv[index + 1]);
  return Number.isFinite(candidate) ? candidate : fallback;
}

const samples = loadSamples();
const html = renderContractLabDocument(samples);

if (process.argv.includes('--serve')) {
  const port = argValue('--port', 8790);
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/' || path === '/contract-lab' || path === '/contract-lab/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(html);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found. The Contract Lab serves only /contract-lab.\n');
  });
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`Contract Lab serving at http://127.0.0.1:${port}/contract-lab\n`);
    process.stdout.write('Development-only; no database or provider calls. Press Ctrl+C to stop.\n');
  });
} else {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf8');
  process.stdout.write(`Wrote ${outPath}\n`);
  process.stdout.write(`${Buffer.byteLength(html)} bytes · ${samples.length} composed samples · open in any browser.\n`);
}
