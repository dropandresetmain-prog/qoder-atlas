// Compare RECORD vs REPLAY-of-RECORD evidence step-by-step.
// Wall-clock-derived fields (updatedAt, assessedAt, observedAt, recordedAt,
// runId, latency, timestamps) are stripped before comparison; everything
// semantic must match.
import { readFileSync } from 'node:fs';

const TIME_KEYS = new Set(['updatedAt', 'assessedAt', 'observedAt', 'startedAt', 'finishedAt', 'recordedAt']);
function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (TIME_KEYS.has(k)) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return value;
}

const record = JSON.parse(readFileSync('output/acceptance-s1-record/latest.json', 'utf8'));
const replay = JSON.parse(readFileSync('output/acceptance-s1-replay-of-record/latest.json', 'utf8'));

console.log('record ok=', record.ok, ' replay ok=', replay.ok);
console.log('record mode=', record.mode, ' replay mode=', replay.mode);
console.log('steps: record=', record.steps.length, ' replay=', replay.steps.length);

let mismatches = 0;
for (let i = 0; i < record.steps.length; i++) {
  const a = record.steps[i];
  const b = replay.steps[i];
  if (a.stepId !== b.stepId) { console.log('STEP ORDER MISMATCH', a.stepId, b.stepId); mismatches++; continue; }
  const ra = JSON.stringify(strip(a.response));
  const rb = JSON.stringify(strip(b.response));
  if (ra !== rb) {
    mismatches++;
    console.log('RESPONSE DIFF at', a.stepId);
    console.log('  record:', ra?.slice(0, 400));
    console.log('  replay:', rb?.slice(0, 400));
  } else {
    console.log('MATCH', a.stepId);
  }
}
console.log(mismatches === 0 ? 'EQUIVALENT: all step responses materially identical' : `DIVERGENT: ${mismatches} mismatches`);
