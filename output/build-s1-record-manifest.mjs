// Build the honest RECORD-provenance S1 manifest from the curated S1 manifest.
// Same steps/bodies/captures; assertions replaced with what the current Atlas
// sandbox truthfully produces under RECORD (no sandbox incidents => live
// reconciliation yields CONNECTED facts that outrank the ASSERTED simulated
// push). Scenario data only — no engine changes.
import { readFileSync, writeFileSync } from 'node:fs';

const src = JSON.parse(readFileSync('fixtures/acceptance/manifests/s1-airline-schedule-change.json', 'utf8'));

const notifyAssertions = (desc) => [
  { description: `${desc}: ingress accepts the provider-shaped event`, path: 'status', op: 'equals', expected: 'ACCEPTED' },
  { description: `${desc}: provider state reconciliation outranks the ASSERTED push (fact precedence intact)`, path: 'results.0.processed.mutationAccepted', op: 'falsy' },
  { description: `${desc}: outrank is evidenced by an explicit FACT_OUTRANKED issue`, path: 'results.0.processed.mutationIssues.0.code', op: 'equals', expected: 'FACT_OUTRANKED' },
  { description: `${desc}: a recovery case exists for the affected trip`, path: 'results.0.caseId', op: 'exists' },
];

// CANCELLATION events carry no fact to outrank (a removal, not an upsert);
// the ASSERTED ceiling refuses the unconfirmed mutation and the uncertainty
// stays explicitly unresolved instead of becoming certainty.
const cancellationAssertions = (desc) => [
  { description: `${desc}: ingress accepts the provider-shaped event`, path: 'status', op: 'equals', expected: 'ACCEPTED' },
  { description: `${desc}: unconfirmed ASSERTED cancellation is not applied (asserted ceiling)`, path: 'results.0.processed.mutationAccepted', op: 'falsy' },
  { description: `${desc}: the unconfirmed cancellation is preserved as explicit uncertainty`, path: 'results.0.processed.assessment.unresolvedUnknowns', op: 'arrayNotEmpty' },
  { description: `${desc}: a recovery case exists for the affected trip`, path: 'results.0.caseId', op: 'exists' },
];

// Truthful per-trip viability under the current sandbox (no incidents):
// reconciliation confirms CONNECTED schedules; the ASSERTED push cannot
// mutate authoritative state, but the open signals still drive each trip's
// own downstream dependency evaluation — differentiated, deterministic.
const expectedViability = {
  observe_hero_trip: 'VIABLE',
  observe_draft15_trip: 'NOT_VIABLE',
  observe_draft10_trip: 'VIABLE',
  observe_draft11_trip: 'VIABLE',
  observe_draft30_trip: 'VIABLE',
  observe_draft13_trip: 'AT_RISK',
};

const steps = [];
for (const step of src.steps) {
  if (step.id === 'reset') {
    steps.push(step);
    continue;
  }
  if (step.action.type === 'simulated_external_event') {
    const isCancellation = JSON.stringify(step.action.body).includes('CANCELLATION');
    steps.push({
      id: step.id,
      description: step.description,
      action: step.action,
      assert: isCancellation ? cancellationAssertions(step.id) : notifyAssertions(step.id),
    });
    continue;
  }
  if (step.action.type === 'observe' && step.action.path.startsWith('/api/traveller/')) {
    const label = step.id;
    steps.push({
      id: step.id,
      description: step.description,
      action: step.action,
      assert: [
        { description: `${label}: trip projection renders`, path: 'tripId', op: 'exists' },
        { description: `${label}: remainder viability honestly evaluated for this trip's dependency graph`, path: 'remainderViable', op: 'equals', expected: expectedViability[step.id] },
      ],
    });
    continue;
  }
  if (step.action.type === 'observe' && step.action.path.startsWith('/api/cases/')) {
    const label = step.id;
    steps.push({
      id: step.id,
      description: step.description,
      action: step.action,
      assert: [
        { description: `${label}: case projection renders`, path: 'caseId', op: 'exists' },
      ],
    });
    continue;
  }
  throw new Error(`unhandled step ${step.id}`);
}

const manifest = {
  scenarioId: 'S1-RECORD',
  title: 'S1 airline schedule change — current-provider RECORD proof (honest sandbox truth)',
  mode: 'RECORD',
  globalInputPack: src.globalInputPack,
  localInputPack: src.localInputPack,
  boundaries: [
    { seam: 'atlas.event_ingress', mode: 'SIMULATED_EXTERNAL_EVENT', note: 'approved S1 simulated seam: provider-shaped event into real ingress' },
    { seam: 'atlas.flight_state_query', mode: 'RECORD', note: 'LIVE sandbox reconciliation read; persisted sanitized recording' },
    { seam: 'atlas.flight_adapter', mode: 'RECORD', note: 'no transactional operations exercised by S1 observe-only flow' },
  ],
  requiredEnv: src.requiredEnv,
  requiredProviders: ['atlas'],
  expect: src.expect,
  routeParams: src.routeParams,
  steps,
};

writeFileSync('fixtures/acceptance/manifests/s1-airline-schedule-change-record.json', JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('wrote manifest with', steps.length, 'steps');
console.log('step ids:', steps.map((s) => s.id).join(', '));
// echo reset step id to confirm
console.log('reset step ids in src:', src.steps.filter((s) => s.action.type === 'http').map((s) => s.id).join(', '));
