// Secret scan over committed recording/evidence corpora.
//
// Two complementary checks, both clean-clone safe:
//   1. LOCAL-ENV comparison (when .env.local exists): every committed file
//      must be free of the credential values present in the local
//      environment. Absent .env.local must NOT fail the scan — the check is
//      skipped and reported as such.
//   2. PATTERN detection (always): secret-shaped keys and values are flagged
//      regardless of whether a local env file exists, so a clean clone with
//      no .env.local still gets a real scan.
//
// Prints counts, file paths and key names only — never the secret values.
// Exit code 0 = clean, 1 = findings.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// 1. Local env secrets (optional — absent file is fine)
// ---------------------------------------------------------------------------

const secrets = [];
// Configuration-shaped values (filesystem paths, ports, modes, log levels)
// are not credentials; treating them as secrets flags benign path references
// in committed packs/manifests as leaks.
const NON_SECRET_KEY_PATTERN = /(_PATH|_DIR|_PORT|_MODE|_LEVEL)$/i;
if (existsSync('.env.local')) {
  const envText = readFileSync('.env.local', 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    if (NON_SECRET_KEY_PATTERN.test(m[1])) continue;
    const value = m[2].replace(/^"|"$/g, '');
    if (value.length >= 8) secrets.push({ key: m[1], value });
  }
  console.log(`env keys checked: ${secrets.map((s) => s.key).join(', ')}`);
} else {
  console.log('env keys checked: (none — .env.local absent; pattern scan still runs)');
}

// ---------------------------------------------------------------------------
// 2. Secret-shaped patterns (always active, no env file required)
// ---------------------------------------------------------------------------

// Keys whose NAME suggests a credential, paired with a value that looks
// secret-ish (long random token, or known provider prefixes).
const SECRET_KEY_PATTERN = /(^|[_\-.])(api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?key|token|password|credential|authorization)([_\-.]|$)/i;

// Value shapes that are almost never benign fixture content.
const SECRET_VALUE_PATTERNS = [
  { name: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'aws-secret-access-key-shape', re: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/ },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { name: 'openai-style-key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'bearer-token-value', re: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/i },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'aliyun-access-key', re: /\bLTAI[0-9A-Za-z]{12,}\b/ },
];

// Known benign synthetic values used throughout fixtures/recordings; a match
// on these never counts as a leak.
const BENIGN_VALUES = new Set([
  'sandbox-client-id',
  'sandbox-client-secret',
  'sandbox-api-key',
  'replay-api-key',
  'test-api-key',
  'fake-api-key',
  'dummy',
]);

function valueLooksSecretish(value) {
  if (typeof value !== 'string') return false;
  if (BENIGN_VALUES.has(value.toLowerCase())) return false;
  // Long high-entropy-looking token.
  if (/^[A-Za-z0-9\-_+/=.]{24,}$/.test(value) && /[a-z]/.test(value) && /[A-Z0-9]/.test(value)) return true;
  return SECRET_VALUE_PATTERNS.some((p) => p.re.test(value));
}

// ---------------------------------------------------------------------------
// Corpus walk
// ---------------------------------------------------------------------------

const roots = [
  'fixtures/recordings',
  'fixtures/scenarios',
  'fixtures/acceptance',
  'test/fixtures/recordings',
  'recordings',
  'output/acceptance',
];
// Every scenario-evidence directory under output/ (acceptance-*) is scanned
// too — evidence is committed and must be credential-free.
try {
  for (const entry of readdirSync('output')) {
    if (entry.startsWith('acceptance')) {
      const p = join('output', entry);
      if (statSync(p).isDirectory() && !roots.includes(p)) roots.push(p);
    }
  }
} catch { /* output absent */ }
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

let envHits = 0;
let patternHits = 0;
let sanitizedFlagMissing = 0;

for (const file of files) {
  const text = readFileSync(file, 'utf8');

  // Check 1: local env values.
  for (const secret of secrets) {
    if (text.includes(secret.value)) {
      console.log(`LEAK: ${file} contains value of ${secret.key}`);
      envHits += 1;
    }
  }

  // Check 2a: secret-shaped keys with secret-ish values.
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  if (parsed !== undefined) {
    const findings = [];
    scanObject(parsed, [], findings);
    for (const finding of findings) {
      console.log(`PATTERN: ${file} carries secret-shaped key "${finding.path}"`);
      patternHits += 1;
    }
  }

  // Check 2b: raw-text secret value shapes (catches values inside raw blobs).
  for (const { name, re } of SECRET_VALUE_PATTERNS) {
    if (name === 'aws-secret-access-key-shape') continue; // too noisy on raw text; key-scan covers it
    if (re.test(text)) {
      console.log(`PATTERN: ${file} matches value shape "${name}"`);
      patternHits += 1;
    }
  }

  // Recording hygiene flag.
  if (file.includes('recordings') && parsed && typeof parsed === 'object' && 'raw' in parsed && parsed.sanitized !== true) {
    console.log(`SANITIZE-FLAG: ${file} is a recording without sanitized:true`);
    sanitizedFlagMissing += 1;
  }
}

/** Depth-first scan of a parsed JSON document for secret-shaped keys. */
function scanObject(node, path, findings) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => scanObject(item, [...path, String(i)], findings));
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    const here = [...path, key];
    if (SECRET_KEY_PATTERN.test(key) && valueLooksSecretish(value)) {
      findings.push({ path: here.join('.') });
    }
    if (typeof value === 'string' && SECRET_VALUE_PATTERNS.some((p) => p.name !== 'aws-secret-access-key-shape' && p.re.test(value))) {
      findings.push({ path: here.join('.') });
    }
    if (typeof value === 'object' && value !== null) scanObject(value, here, findings);
  }
}

const totalFindings = envHits + patternHits + sanitizedFlagMissing;
console.log(totalFindings === 0
  ? 'VERDICT: CLEAN — no env credential values, no secret-shaped patterns; recording flags intact'
  : `VERDICT: FINDINGS — ${envHits} env leaks, ${patternHits} pattern findings, ${sanitizedFlagMissing} flag issues`);
process.exit(totalFindings === 0 ? 0 : 1);
