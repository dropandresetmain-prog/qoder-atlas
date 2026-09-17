/**
 * T3 — escalation policy is pure, deterministic and scenario-neutral.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AssessmentResult } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import { blockingFailures, decideEscalation } from '../src/resolution/escalation/policy.ts';

const NOW = '2031-05-01T00:00:00.000Z';

function assessment(overall: 'PASS' | 'FAIL' | 'UNKNOWN', dims: { dimension: string; verdict: 'PASS' | 'FAIL' | 'UNKNOWN'; blocking: boolean; applicable?: boolean }[]): AssessmentResult {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'VIABILITY',
    evaluatedAt: NOW,
    overallVerdict: overall,
    subjects: [{ subjectRef: { kind: 'JOURNEY', id: '22222222-2222-4222-8222-222222222222' }, role: 'ASSESSED' }],
    dimensions: dims.map((d) => ({ dimension: d.dimension, verdict: d.verdict, reasons: [], explanations: [], applicable: d.applicable ?? true, blocking: d.blocking })),
    manifest: { evaluatedAt: NOW, evaluatorVersions: [], aggregateReads: [], scopeReads: [], evidenceReads: [], coverageReads: [], missingCoverage: [] },
  };
}

describe('escalation policy', () => {
  test('a CURRENT overall FAIL with a blocking FAIL dimension opens a case when none is open', () => {
    const decision = decideEscalation({
      assessment: assessment('FAIL', [{ dimension: 'programme_participation', verdict: 'FAIL', blocking: true }, { dimension: 'advisories', verdict: 'PASS', blocking: true }]),
      status: 'CURRENT',
      casesForSubject: [],
    });
    assert.equal(decision.action, 'OPEN');
    if (decision.action === 'OPEN') assert.deepEqual(decision.blockingDimensions, ['programme_participation']);
  });

  test('a subject already covered by an open case attaches instead of opening a second case', () => {
    const decision = decideEscalation({
      assessment: assessment('FAIL', [{ dimension: 'supplier_fulfilment', verdict: 'FAIL', blocking: true }]),
      status: 'CURRENT',
      casesForSubject: [{ caseId: 'b', lifecycleStatus: 'PLANNING' }, { caseId: 'a', lifecycleStatus: 'RESOLVED' }],
    });
    assert.equal(decision.action, 'ATTACH');
    if (decision.action === 'ATTACH') assert.equal(decision.caseId, 'b');
  });

  test('only terminal cases are ignored: a resolved case does not absorb new work', () => {
    const decision = decideEscalation({
      assessment: assessment('FAIL', [{ dimension: 'supplier_fulfilment', verdict: 'FAIL', blocking: true }]),
      status: 'CURRENT',
      casesForSubject: [{ caseId: 'a', lifecycleStatus: 'RESOLVED' }, { caseId: 'c', lifecycleStatus: 'CLOSED' }],
    });
    assert.equal(decision.action, 'OPEN');
  });

  test('UNKNOWN never opens a case; PASS never opens a case', () => {
    assert.equal(decideEscalation({ assessment: assessment('UNKNOWN', [{ dimension: 'entry_feasibility', verdict: 'UNKNOWN', blocking: true }]), status: 'CURRENT', casesForSubject: [] }).action, 'NONE');
    assert.equal(decideEscalation({ assessment: assessment('PASS', [{ dimension: 'advisories', verdict: 'PASS', blocking: true }]), status: 'CURRENT', casesForSubject: [] }).action, 'NONE');
  });

  test('a non-CURRENT assessment never escalates, whatever its verdict', () => {
    for (const status of ['STALE', 'PENDING_REASSESSMENT', 'UNAVAILABLE', 'NONE'] as const) {
      const decision = decideEscalation({ assessment: assessment('FAIL', [{ dimension: 'x', verdict: 'FAIL', blocking: true }]), status, casesForSubject: [] });
      assert.equal(decision.action, 'NONE', status);
    }
  });

  test('a FAIL that is only non-blocking or not applicable does not escalate', () => {
    const nonBlocking = assessment('FAIL', [{ dimension: 'optional_participation', verdict: 'FAIL', blocking: false }]);
    assert.equal(decideEscalation({ assessment: nonBlocking, status: 'CURRENT', casesForSubject: [] }).action, 'NONE');
    const notApplicable = assessment('FAIL', [{ dimension: 'x', verdict: 'FAIL', blocking: true, applicable: false }]);
    assert.deepEqual(blockingFailures(notApplicable), []);
    assert.equal(decideEscalation({ assessment: notApplicable, status: 'CURRENT', casesForSubject: [] }).action, 'NONE');
  });
});
