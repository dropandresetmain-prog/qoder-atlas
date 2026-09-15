/**
 * Checkpoint 0 — G-B payer currency UNKNOWN and assessment-currentness gates
 * at the authority / decision boundary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AssessmentResult } from '../src/contracts/v2/assessment/assessmentManifest.ts';
import type { AssessmentView } from '../src/persistence/postgres/world/pgAssessments.ts';
import {
  evaluateAuthorityDecisionGates,
  requireCurrentAssessmentForDecision,
  requireKnownPayerCurrencyForAuthority,
} from '../src/resolution/authority/index.ts';

const NOW = '2031-05-01T00:00:00.000Z';
const journeyId = randomUUID();
const travellerId = randomUUID();

function baseAssessment(overrides?: Partial<AssessmentResult>): AssessmentResult {
  return {
    id: randomUUID(),
    kind: 'VIABILITY',
    evaluatedAt: NOW,
    overallVerdict: 'PASS',
    subjects: [{ subjectRef: { kind: 'JOURNEY', id: journeyId }, role: 'PRIMARY' }],
    dimensions: [],
    manifest: {
      evaluatedAt: NOW,
      evaluatorVersions: [{ evaluatorId: 'm6.funding', version: '1' }],
      aggregateReads: [],
      scopeReads: [],
      evidenceReads: [],
      coverageReads: [],
      missingCoverage: [],
    },
    ...overrides,
  };
}

function view(status: AssessmentView['status'], assessment?: AssessmentResult): AssessmentView {
  return { status, ...(assessment ? { assessment } : {}), staleness: [] };
}

test('G-B: traveller payer_home_currency_unknown blocks authority (never invent currency)', () => {
  const assessment = baseAssessment({
    overallVerdict: 'UNKNOWN',
    dimensions: [{
      dimension: 'funding',
      verdict: 'UNKNOWN',
      applicable: true,
      blocking: true,
      explanations: [{
        id: 'e-payer-unknown',
        evaluatorId: 'm6.funding',
        dimension: 'funding',
        status: 'UNKNOWN',
        reasonCode: 'payer_home_currency_unknown',
        cause: { kind: 'MISSING_INFORMATION' },
        affectedSubject: { kind: 'JOURNEY', id: journeyId },
        relatedSubjects: [{ kind: 'TRAVELLER', id: travellerId }],
        dependencyPath: [],
        evidenceRefs: [],
        facts: { payerTravellerId: travellerId },
        uncertainty: [{ kind: 'MISSING_INPUT', code: 'payer_home_currency', subjectRef: { kind: 'TRAVELLER', id: travellerId } }],
      }],
      reasons: ['UNKNOWN:payer_home_currency_unknown'],
    }],
  });
  const gate = requireKnownPayerCurrencyForAuthority(assessment);
  assert.equal(gate.allowed, false);
  if (!gate.allowed) assert.equal(gate.reason, 'PAYER_HOME_CURRENCY_UNKNOWN');
});

test('G-B: organisation-payer funding without home-currency UNKNOWN does not trip the payer gate alone', () => {
  const assessment = baseAssessment({
    dimensions: [{
      dimension: 'funding',
      verdict: 'PASS',
      applicable: true,
      blocking: true,
      explanations: [{
        id: 'e-within-budget',
        evaluatorId: 'm6.funding',
        dimension: 'funding',
        status: 'PASS',
        reasonCode: 'within_budget',
        cause: { kind: 'WORLD_STATE' },
        affectedSubject: { kind: 'JOURNEY', id: journeyId },
        relatedSubjects: [],
        dependencyPath: [],
        evidenceRefs: [],
        facts: { totalCommitted: '10.00' },
        uncertainty: [],
      }],
      reasons: ['PASS:within_budget'],
    }],
  });
  assert.equal(requireKnownPayerCurrencyForAuthority(assessment).allowed, true);
});

test('decision gate: STALE / PENDING_REASSESSMENT / UNAVAILABLE / NONE deny authority', () => {
  const assessment = baseAssessment();
  for (const status of ['STALE', 'PENDING_REASSESSMENT', 'UNAVAILABLE', 'NONE'] as const) {
    const result = requireCurrentAssessmentForDecision(view(status, assessment));
    assert.equal(result.allowed, false, status);
    if (!result.allowed) {
      assert.equal(result.reason, 'ASSESSMENT_NOT_CURRENT');
      assert.equal(result.status, status);
    }
  }
});

test('decision gate: CURRENT assessment may proceed past currentness check', () => {
  const assessment = baseAssessment();
  const result = requireCurrentAssessmentForDecision(view('CURRENT', assessment));
  assert.equal(result.allowed, true);
});

test('composed authority gates: prior CURRENT approval path still denied when assessment becomes non-current', () => {
  const assessment = baseAssessment();
  const whenCurrent = evaluateAuthorityDecisionGates(view('CURRENT', assessment));
  assert.equal(whenCurrent.allowed, true);

  // World input changed → reassessment pending: dispatch must refuse even if
  // an approval was obtained while the assessment was current.
  const afterChange = evaluateAuthorityDecisionGates(view('PENDING_REASSESSMENT', assessment));
  assert.equal(afterChange.allowed, false);
  if (!afterChange.allowed) assert.equal(afterChange.reason, 'ASSESSMENT_NOT_CURRENT');
});

test('composed authority gates: CURRENT assessment with payer_home_currency_unknown still denied', () => {
  const assessment = baseAssessment({
    overallVerdict: 'UNKNOWN',
    dimensions: [{
      dimension: 'funding',
      verdict: 'UNKNOWN',
      applicable: true,
      blocking: true,
      explanations: [{
        id: 'e-payer-block',
        evaluatorId: 'm6.funding',
        dimension: 'funding',
        status: 'UNKNOWN',
        reasonCode: 'payer_home_currency_unknown',
        cause: { kind: 'MISSING_INFORMATION' },
        affectedSubject: { kind: 'JOURNEY', id: journeyId },
        relatedSubjects: [],
        dependencyPath: [],
        evidenceRefs: [],
        facts: {},
        uncertainty: [{ kind: 'MISSING_INPUT', code: 'payer_home_currency', subjectRef: { kind: 'TRAVELLER', id: travellerId } }],
      }],
      reasons: ['UNKNOWN:payer_home_currency_unknown'],
    }],
  });
  const result = evaluateAuthorityDecisionGates(view('CURRENT', assessment));
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.reason, 'PAYER_HOME_CURRENCY_UNKNOWN');
});
