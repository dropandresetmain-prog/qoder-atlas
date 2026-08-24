// Secret scan over committed recording corpora: every committed recording
// must be free of the credential values present in the local environment.
// Prints counts and file paths only — never the secret values themselves.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const envText = readFileSync('.env.local', 'utf8');
const secrets = [];
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
  if (!m) continue;
  const value = m[2].replace(/^"|"$/g, '');
  if (value.length >= 8) secrets.push({ key: m[1], value });
}
console.log(`env keys checked: ${secrets.map((s) => s.key).join(', ')}`);

const roots = ['fixtures/recordings', 'fixtures/scenarios', 'test/fixtures/recordings'];
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (entry.endsWith('.json')) files.push(p);
  }
}
for (const root of roots) {
  try { walk(root); } catch { /* root absent */ }
}
console.log(`recordings/fixture json files scanned: ${files.length}`);

let hits = 0;
let sanitizedFlagMissing = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const secret of secrets) {
    if (text.includes(secret.value)) {
      console.log(`LEAK: ${file} contains value of ${secret.key}`);
      hits += 1;
    }
  }
  if (file.includes('recordings')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && 'raw' in parsed && parsed.sanitized !== true) {
        console.log(`SANITIZE-FLAG: ${file} is a recording without sanitized:true`);
        sanitizedFlagMissing += 1;
      }
    } catch { /* non-recording json */ }
  }
}
console.log(hits === 0 && sanitizedFlagMissing === 0
  ? 'VERDICT: CLEAN — no env credential values found; recording flags intact'
  : `VERDICT: FINDINGS — ${hits} leaks, ${sanitizedFlagMissing} flag issues`);
