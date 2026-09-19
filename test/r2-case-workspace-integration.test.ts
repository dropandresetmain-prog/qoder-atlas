/**
 * R2 Lane C — Case decision workspace integration.
 *
 * Proves the PG-served case surface composes the R2 components as ONE
 * workspace: the focused Case graph (via the single semantic layer), the
 * Original/Current toggle around it, planning evidence AROUND the graph (never
 * inside it), the backend-mapped first breakpoint, honest unmapped-step
 * disclosure, and the change-awareness data attributes the polling script
 * requires. No scenario fixtures: hand-built generic views only.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { RecoveryCaseView } from '../src/contracts/v2/product/readModels.ts';
import { renderProductRecoveryCase } from '../src/ui/screens/product-recovery-case.ts';

const generatedAt = '2031-09-15T08:00:00.000Z';

const changeAwareness = {
  projectionRevision: 7,
  changedVisibleRefs: ['JOURNEY:j-1'],
  changedEdgeIds: [],
  currentSemanticState: 'AFFECTED' as const,
  changeCursor: '42',
};

const ldg = {
  scope: 'FOCUSED_CASE' as const,
  nodes: [
    { ref: 'DISRUPTION:d-1', kind: 'DISRUPTION' as const, label: 'Service change', semanticState: 'CHANGED' as const, authority: 'AUTHORITATIVE' as const },
    { ref: 'JOURNEY:j-1', kind: 'TRAVELLER' as const, label: 'Traveller one', semanticState: 'FAILED' as const, authority: 'AUTHORITATIVE' as const, evaluation: 'PENDING_REASSESSMENT' as const },
    { ref: 'SERVICE_BOOKING:s-1', kind: 'SERVICE_BOOKING' as const, label: 'Rail operator', semanticState: 'UNKNOWN' as const, authority: 'AUTHORITATIVE' as const },
  ],
  edges: [
    { id: 'AFFECTED_BY:d-1:j-1', fromRef: 'DISRUPTION:d-1', toRef: 'JOURNEY:j-1', kind: 'AFFECTED_BY' as const, authority: 'AUTHORITATIVE' as const },
    { id: 'RELIES_ON:j-1:s-1', fromRef: 'JOURNEY:j-1', toRef: 'SERVICE_BOOKING:s-1', kind: 'RELIES_ON' as const, authority: 'AUTHORITATIVE' as const },
  ],
  change: changeAwareness,
};

function baseCase(overrides: Partial<RecoveryCaseView> = {}): RecoveryCaseView {
  return {
    generatedAt,
    caseRef: 'case-1',
    causalPath: [],
    status: 'OPEN',
    changeSummary: 'A booked service changed.',
    subjectLabels: {},
    bookingServiceState: { label: 'Transport booking', state: 'AFFECTED' },
    tripViability: { label: 'Remaining trip', verdict: 'FAIL' },
    affectedItems: ['s-1'],
    strategies: [],
    recoveryActions: [],
    authorityState: 'None',
    executionState: 'None',
    reconciliationState: 'Settled',
    uncertainty: [],
    attention: [],
    duplicateBookingExposure: [],
    remainingRecoveryWork: [],
    ldg,
    change: changeAwareness,
    ...overrides,
  };
}

describe('R2 Case workspace composition', () => {
  test('renders the focused Case graph inside the workspace', () => {
    const html = renderProductRecoveryCase(baseCase());
    assert.match(html, /data-test="focused-case-graph-section"/);
    assert.match(html, /data-test="focused-case-graph"/);
    assert.match(html, /How the trip is affected/);
  });

  test('carries the change-awareness attributes the polling contract requires', () => {
    const html = renderProductRecoveryCase(baseCase());
    assert.match(html, /data-test="product-recovery-case"/);
    assert.match(html, /data-case-ref="case-1"/);
    assert.match(html, /data-case-status="OPEN"/);
    assert.match(html, /data-projection-revision="7"/);
    assert.match(html, /data-change-cursor="42"/);
  });

  test('omits data-change-cursor when the projection supplies none', () => {
    const html = renderProductRecoveryCase(
      baseCase({ change: { ...changeAwareness, changeCursor: undefined } }),
    );
    // Scope to the <main> tag only; the inline polling script legitimately
    // references the attribute name when reading it back.
    const mainTag = html.slice(html.indexOf('<main'), html.indexOf('>', html.indexOf('<main')));
    assert.doesNotMatch(mainTag, /data-change-cursor/);
    assert.match(mainTag, /data-projection-revision="7"/);
  });

  test('includes the polling script with sinceCursor echo and no WS/SSE', () => {
    const html = renderProductRecoveryCase(baseCase());
    assert.match(html, /format=html/);
    assert.match(html, /sinceCursor/);
    assert.doesNotMatch(html, /WebSocket|EventSource/);
  });

  test('wraps the graph in the Original/Current toggle; no stored Original => honest unavailable state', () => {
    const html = renderProductRecoveryCase(baseCase());
    assert.match(html, /data-test="original-current-toggle"/);
    assert.match(html, /data-test="current-panel"/);
    assert.match(html, /data-test="original-panel"/);
    assert.match(html, /data-test="original-unavailable"/);
    assert.match(html, /__northstarOriginalCurrentStarted/);
    assert.doesNotMatch(html, /first seen this session/);
  });

  test('a persisted Original renders from its stored snapshot, distinct from Current, with one asset set', () => {
    const storedLdg = {
      scope: 'FOCUSED_CASE' as const,
      nodes: [
        { ref: 'JOURNEY:j-1', kind: 'TRAVELLER' as const, label: 'Stored Traveller', semanticState: 'FAILED' as const, authority: 'AUTHORITATIVE' as const },
      ],
      edges: [],
      change: { projectionRevision: 2, changedVisibleRefs: [], changedEdgeIds: [], currentSemanticState: 'FAILED' as const },
    };
    const html = renderProductRecoveryCase(baseCase({
      status: 'RESOLVED',
      originalFocusedGraph: {
        capturedAt: '2031-09-14T10:00:00.000Z',
        schemaVersion: 1,
        caseStatusAtCapture: 'OPEN',
        ldg: storedLdg,
        subjectLabels: {},
      },
    }));
    const originalPanel = html.slice(html.indexOf('data-test="original-panel"'));
    assert.match(originalPanel, /Stored Traveller/, 'the Original panel renders the stored graph');
    assert.match(originalPanel, /data-graph-role="original"/);
    assert.match(html, /data-graph-role="current"/);
    assert.doesNotMatch(html, /data-test="original-unavailable"/);
    assert.equal(html.split('.fg-canvas {').length - 1, 1, 'renderer stylesheet is emitted once for two graphs');
    // Current renders the live graph, never the stored one.
    const currentPanel = html.slice(html.indexOf('data-test="current-panel"'), html.indexOf('data-test="original-panel"'));
    assert.doesNotMatch(currentPanel, /Stored Traveller/);
    assert.match(currentPanel, /Traveller one/);
  });

  test('renders the backend-mapped first breakpoint verbatim, never traversed', () => {
    const html = renderProductRecoveryCase(
      baseCase({
        causalPath: [
          { subjectRef: 'JOURNEY:j-1', dimension: 'arrival', reasonCode: 'too_late', evaluatorId: 'ev-1', facts: {}, relatedSubjectRefs: [] },
        ],
        focusedGraph: {
          causalNodeRefs: ['DISRUPTION:d-1', 'JOURNEY:j-1'],
          causalEdgeIds: ['AFFECTED_BY:d-1:j-1'],
          firstBreakpoint: { nodeRef: 'JOURNEY:j-1', label: 'Traveller one', dimension: 'arrival', reasonCode: 'too_late' },
          unmappedCausalSteps: [],
        },
      }),
    );
    assert.match(html, /data-test="focused-graph-first-breakpoint"/);
    assert.match(html, /Where it breaks/);
    assert.match(html, /Traveller one/);
    assert.match(html, /part of the trip no longer works/, 'human wording, not raw codes');
    assert.doesNotMatch(html.slice(html.indexOf('focused-graph-first-breakpoint'), html.indexOf('focused-graph-first-breakpoint') + 300), /too_late/);
  });

  test('surfaces unmapped causal steps explicitly instead of dropping them', () => {
    const html = renderProductRecoveryCase(
      baseCase({
        causalPath: [
          { subjectRef: 'OBJECTIVE:o-1', dimension: 'purpose', reasonCode: 'arrival_by', evaluatorId: 'ev-2', facts: {}, relatedSubjectRefs: [] },
        ],
        focusedGraph: {
          causalNodeRefs: [],
          causalEdgeIds: [],
          unmappedCausalSteps: [
            { subjectRef: 'OBJECTIVE:o-1', dimension: 'purpose', reasonCode: 'arrival_by', reason: 'no visible graph node for subject' },
          ],
        },
      }),
    );
    assert.match(html, /data-test="focused-graph-unmapped"/);
    assert.match(html, /1 causal step not shown on the graph/);
    assert.match(html, /no visible graph node for subject/);
  });

  test('shows staged activity around the graph; planning dump stays in Technical details', () => {
    const html = renderProductRecoveryCase(
      baseCase({
        status: 'PLANNING',
        planningEvidence: {
          phase: 'DECISION_TIME',
          asOf: generatedAt,
          attemptRef: 'attempt-1',
          coordinatorVersion: 'v1',
          outcome: { label: 'Awaiting operator authority', code: 'AWAITING_AUTHORITY' },
          domains: [{ domain: { label: 'Transport', code: 'TRANSPORT' }, disposition: { label: 'Investigated', code: 'INVESTIGATED' } }],
          tools: [],
          modelActivities: [],
          candidates: [],
          viableStrategies: [],
        },
      }),
    );
    assert.match(html, /data-test="case-activity"/);
    assert.match(html, /data-test="technical-details"/);
    assert.match(html, /Planning outcome: Awaiting operator authority/);
    // The graph section must not contain the technical dump.
    const graphSection = html.slice(
      html.indexOf('data-test="focused-case-graph-section"'),
      html.indexOf('data-test="technical-details"'),
    );
    assert.ok(graphSection.length > 0);
    assert.doesNotMatch(graphSection, /Planning outcome:/);
  });

  test('planning evidence shows researched tools with provenance, and never claims provenance for an unavailable tool', () => {
    const html = renderProductRecoveryCase(
      baseCase({
        planningEvidence: {
          phase: 'DECISION_TIME',
          asOf: generatedAt,
          attemptRef: 'attempt-1',
          coordinatorVersion: 'v1',
          outcome: { label: 'Awaiting operator authority', code: 'AWAITING_AUTHORITY' },
          domains: [],
          tools: [
            { tool: { label: 'Flight search', code: 'flight.search' }, status: { label: 'Succeeded', code: 'SUCCEEDED' }, provenanceMode: { label: 'Replay', code: 'REPLAY' }, observedAt: generatedAt, summary: 'flight.search succeeded', uncertainties: [], evidenceRef: 'evidence:1' },
            { tool: { label: 'Flight search', code: 'flight.search' }, status: { label: 'Unavailable', code: 'UNAVAILABLE' }, provenanceMode: { label: 'Internal canonical state', code: 'INTERNAL' }, summary: 'flight.search unavailable', uncertainties: [], evidenceRef: 'evidence:2' },
          ],
          modelActivities: [],
          candidates: [
            {
              candidateKey: 'k1',
              domain: { label: 'Transport', code: 'TRANSPORT' },
              proposer: { label: 'Proposer transport offer', code: 'proposer.transport-offer' },
              disposition: { label: 'Rejected by deterministic evaluation', code: 'REJECTED_DETERMINISTIC' },
              reasons: ['Not viable'],
              outcomeDelta: [{ subject: { label: 'Participant 1', ref: 'JOURNEY:j1' }, direction: { label: 'Unchanged', code: 'UNCHANGED' }, baseline: 'FAIL', candidate: 'FAIL' }],
            },
          ],
          viableStrategies: [],
        },
      }),
    );
    assert.match(html, /data-test="technical-details"/);
    assert.match(html, /Research: Flight search — Succeeded · Replay/);
    assert.match(html, /Flight search — Unavailable · no provider evidence obtained/);
    assert.doesNotMatch(html, /Unavailable · Internal canonical state/);
    assert.match(html, /Participant 1: Fail → Fail/);
  });

  test('PLANNING status wraps the graph with the investigating banner', () => {
    const html = renderProductRecoveryCase(baseCase({ status: 'PLANNING' }));
    assert.match(html, /fg-planning-wrapper/);
    assert.match(html, /NORTHSTAR is investigating/);
  });

  test('CHECKING is presented from evaluation PENDING_REASSESSMENT only', () => {
    const html = renderProductRecoveryCase(baseCase());
    // The JOURNEY node carries evaluation PENDING_REASSESSMENT -> checking badge.
    assert.match(html, /fg-checking-badge|Checking/);
  });

  test('workspace stays generic — no persona or scenario tokens', () => {
    const html = renderProductRecoveryCase(baseCase());
    assert.doesNotMatch(html, /Sarah|Jordan|Batik|Singapore|keynote|headline|CGK|SIN\b/i);
  });

  test('terminal case omits operator controls but keeps the workspace', () => {
    const html = renderProductRecoveryCase(baseCase({ status: 'RESOLVED' }));
    assert.doesNotMatch(html, /data-test="propose-strategies"/);
    assert.match(html, /data-test="focused-case-graph-section"/);
    assert.match(html, /data-case-status="RESOLVED"/);
  });
});
