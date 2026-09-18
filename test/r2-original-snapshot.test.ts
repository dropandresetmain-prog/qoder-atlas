/**
 * R2 — the pure derivation of the immutable Original snapshot payload.
 *
 * `deriveOriginalGraphPayload` decides, from a Case view alone, whether a truthful
 * focused graph exists yet and, if so, what semantic payload is frozen. It must
 * refuse anything that is not the first truthful graph (no fake "at creation"
 * graph), store only semantic renderer inputs, and neutralise the poll-relative
 * change hints. The persisted contract is strict (no HTML/SVG/layout keys).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OriginalGraphSnapshotPayloadSchema,
  type RecoveryCaseView,
} from '../src/contracts/v2/product/readModels.ts';
import { deriveOriginalGraphPayload } from '../src/app/target/originalCaseGraphCapture.ts';

const change = {
  projectionRevision: 9,
  changedVisibleRefs: ['JOURNEY:j'],
  changedEdgeIds: ['e1'],
  previousSemanticState: 'HEALTHY' as const,
  currentSemanticState: 'FAILED' as const,
  changedAt: '2031-09-15T08:00:00.000Z',
  changeSource: 'provider',
  changeCursor: '77',
};

function view(overrides: Partial<RecoveryCaseView> = {}): RecoveryCaseView {
  return {
    generatedAt: '2031-09-15T08:00:00.000Z',
    caseRef: 'c',
    causalPath: [],
    status: 'OPEN',
    changeSummary: 'x',
    subjectLabels: { 'JOURNEY:j': 'Alex Rivera' },
    bookingServiceState: { label: 'b', state: 'CHANGED' },
    tripViability: { label: 't', verdict: 'FAIL' },
    affectedItems: [],
    strategies: [],
    recoveryActions: [],
    authorityState: 'None',
    executionState: 'None',
    reconciliationState: 'Settled',
    uncertainty: [],
    attention: [],
    duplicateBookingExposure: [],
    remainingRecoveryWork: [],
    focusedGraph: {
      causalNodeRefs: ['JOURNEY:j'],
      causalEdgeIds: ['e1'],
      firstBreakpoint: { nodeRef: 'JOURNEY:j', label: 'Alex Rivera', dimension: 'arrival', reasonCode: 'too_late' },
      unmappedCausalSteps: [],
    },
    ldg: {
      scope: 'FOCUSED_CASE',
      nodes: [
        { ref: 'DISRUPTION:d', kind: 'DISRUPTION', label: 'Delay', semanticState: 'CHANGED', authority: 'AUTHORITATIVE' },
        { ref: 'JOURNEY:j', kind: 'TRAVELLER', label: 'Alex Rivera', semanticState: 'FAILED', authority: 'AUTHORITATIVE', evaluation: 'CURRENT' },
      ],
      edges: [{ id: 'e1', fromRef: 'DISRUPTION:d', toRef: 'JOURNEY:j', kind: 'AFFECTED_BY', authority: 'AUTHORITATIVE' }],
      change,
    },
    change,
    ...overrides,
  };
}

describe('deriveOriginalGraphPayload', () => {
  test('freezes the semantic graph, labels and status, with neutral change hints', () => {
    const r = deriveOriginalGraphPayload(view());
    assert.ok(r.ok);
    const p = OriginalGraphSnapshotPayloadSchema.parse(r.payload);
    assert.equal(p.caseStatusAtCapture, 'OPEN');
    assert.equal(p.ldg.nodes.length, 2);
    assert.deepEqual(p.subjectLabels, { 'JOURNEY:j': 'Alex Rivera' });
    assert.equal(p.focusedGraph?.firstBreakpoint?.nodeRef, 'JOURNEY:j');
    assert.deepEqual(p.ldg.change, { projectionRevision: 9, changedVisibleRefs: [], changedEdgeIds: [], currentSemanticState: 'FAILED' });
    assert.doesNotMatch(JSON.stringify(p), /changeCursor|changedAt|<svg|<div|viewBox/);
  });

  test('is a pure, deterministic function of the view', () => {
    assert.deepEqual(deriveOriginalGraphPayload(view()), deriveOriginalGraphPayload(view()));
  });

  test('refuses anything that is not yet a truthful focused graph', () => {
    const reason = (v: RecoveryCaseView) => { const r = deriveOriginalGraphPayload(v); return r.ok ? 'OK' : r.reason; };
    assert.equal(reason(view({ tripViability: { label: 't', verdict: 'PASS' } })), 'trip_not_failing');
    assert.equal(reason(view({ tripViability: { label: 't', verdict: 'UNKNOWN' } })), 'trip_not_failing');
    assert.equal(reason(view({ focusedGraph: undefined })), 'no_mapped_causal_path');
    assert.equal(reason(view({ focusedGraph: { causalNodeRefs: [], causalEdgeIds: [], unmappedCausalSteps: [] } })), 'no_mapped_causal_path');
    assert.equal(reason(view({ status: 'RESOLVED' })), 'case_not_active');
    const pending = view();
    pending.ldg.nodes[1] = { ...pending.ldg.nodes[1]!, evaluation: 'PENDING_REASSESSMENT' };
    assert.equal(reason(pending), 'assessment_not_settled');
  });
});

describe('OriginalGraphSnapshotPayloadSchema is strict and bounded', () => {
  const ok = deriveOriginalGraphPayload(view());
  assert.ok(ok.ok);
  const base = ok.payload;

  test('rejects render-shaped or unknown keys', () => {
    for (const extra of [{ html: '<svg/>' }, { svg: 'x' }, { layout: {} }, { camera: {} }, { pulse: true }]) {
      assert.equal(OriginalGraphSnapshotPayloadSchema.safeParse({ ...base, ...extra }).success, false, JSON.stringify(extra));
    }
  });

  test('rejects an unknown schema version and oversized graphs/labels', () => {
    assert.equal(OriginalGraphSnapshotPayloadSchema.safeParse({ ...base, schemaVersion: 2 }).success, false);
    const nodes = Array.from({ length: 201 }, (_, i) => ({ ...base.ldg.nodes[0]!, ref: `N:${i}` }));
    assert.equal(OriginalGraphSnapshotPayloadSchema.safeParse({ ...base, ldg: { ...base.ldg, nodes } }).success, false);
    const labels = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`K:${i}`, 'l']));
    assert.equal(OriginalGraphSnapshotPayloadSchema.safeParse({ ...base, subjectLabels: labels }).success, false);
  });

  test('rejects a causal map that points outside the stored graph', () => {
    const bad = { ...base, focusedGraph: { ...base.focusedGraph!, causalNodeRefs: ['GHOST:1'] } };
    assert.equal(OriginalGraphSnapshotPayloadSchema.safeParse(bad).success, false);
  });
});
