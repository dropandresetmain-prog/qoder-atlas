/**
 * Frontend Semantic Contract — adapter, presentation model, components and
 * Contract Lab evidence.
 *
 * Proves the four guarantees this milestone exists for:
 *  1. mappings from accepted-M9 enums are exhaustive and refuse unknown values
 *     loudly (no silent neutral default);
 *  2. the single adapter keeps semantic state / current-vs-proposed / change /
 *     focus orthogonal and never invents edge authority or edge identity;
 *  3. structurally invalid read-model input is refused, not restyled;
 *  4. components and the Contract Lab consume presentation objects, escape all
 *     dynamic text, and render every discovered dimension from real fixtures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  presentAssessment, presentConnection, presentDependencyGraph, presentEvaluationState, presentGraphState,
  presentOperationalStatus, presentViability,
} from '../src/ui/semantics/adapter.ts';
import { semanticEdge, semanticNode } from '../src/ui/semantics/components.ts';
import { renderContractLabDocument, type ContractLabSample } from '../src/ui/screens/contract-lab.ts';
import {
  AssessmentToneSchema, AssessmentViewStatusSchema, ConnectionProgressionSchema, LdgEdgeKindSchema, LdgNodeKindSchema,
  LdgSemanticStateSchema, ProductOperationalStatusSchema, RemainderViabilitySchema,
  type ConnectionProgression, type LdgSemanticState, type LiveDependencyGraph,
} from '../src/contracts/v2/product/readModels.ts';

const TONES = new Set(['ok', 'watch', 'alert', 'active', 'neutral']);
const GLYPHS = new Set(['check', 'change', 'attention', 'cross', 'proposal', 'active', 'question']);

function assertIndicator(indicator: { label: string; tone: string; glyph: string }): void {
  assert.ok(indicator.label.length > 0, 'indicator label must be non-empty');
  assert.ok(TONES.has(indicator.tone), `unexpected tone ${indicator.tone}`);
  assert.ok(GLYPHS.has(indicator.glyph), `unexpected glyph ${indicator.glyph}`);
}

const fixturesPath = fileURLToPath(new URL('../fixtures/ui/semantic-contract.json', import.meta.url));
const samples = JSON.parse(readFileSync(fixturesPath, 'utf8')) as ContractLabSample[];

// ---------------------------------------------------------------------------
// 1. Exhaustive mappings; unknown values refuse loudly
// ---------------------------------------------------------------------------

test('every accepted-M9 enum value maps to a real indicator (no silent default)', () => {
  for (const value of LdgSemanticStateSchema.options) assertIndicator(presentGraphState(value));
  for (const value of RemainderViabilitySchema.options) assertIndicator(presentViability(value));
  for (const value of AssessmentToneSchema.options) assertIndicator(presentAssessment(value));
  for (const value of ProductOperationalStatusSchema.options) assertIndicator(presentOperationalStatus(value));
  for (const value of ConnectionProgressionSchema.options) assertIndicator(presentConnection(value));
});

test('an unmapped semantic state throws UNMAPPED SEMANTIC STATE rather than defaulting', () => {
  const badState = 'NOT_A_REAL_STATE' as unknown as LdgSemanticState;
  const badProgression = 'NOT_A_REAL_STATE' as unknown as ConnectionProgression;
  assert.throws(() => presentGraphState(badState), /UNMAPPED SEMANTIC STATE/);
  assert.throws(() => presentConnection(badProgression), /UNMAPPED SEMANTIC STATE/);
});

test('every AssessmentViewStatus maps to a real EvaluationState (FIG-7, no silent default)', () => {
  for (const value of AssessmentViewStatusSchema.options) {
    const mapped = presentEvaluationState(value);
    assert.notEqual(mapped, 'not-supplied', `${value} must not collapse into the absent-field marker`);
  }
  assert.equal(presentEvaluationState(undefined), 'not-supplied');
});

// ---------------------------------------------------------------------------
// 2. Orthogonal node/edge presentation semantics
// ---------------------------------------------------------------------------

const sampleGraph: LiveDependencyGraph = {
  scope: 'FOCUSED_CASE',
  nodes: [
    { ref: 'a', kind: 'SERVICE_BOOKING', label: 'Alpha', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
    { ref: 'b', kind: 'RECOVERY_PROPOSAL', label: 'Beta', semanticState: 'PROPOSED', authority: 'PROPOSED', detail: 'supplied detail' },
  ],
  edges: [
    // Kind PROPOSED_CHANGE but authority AUTHORITATIVE: truth must come from
    // authority, never from a "proposed-sounding" kind (FIG-2 no-promotion).
    { id: 'e1', fromRef: 'a', toRef: 'b', kind: 'PROPOSED_CHANGE', authority: 'AUTHORITATIVE' },
    // semanticState CHANGED but not in changedEdgeIds: change marking must
    // come only from changedEdgeIds, never from semantic state.
    { id: 'e2', fromRef: 'a', toRef: 'b', kind: 'RELIES_ON', semanticState: 'CHANGED', authority: 'AUTHORITATIVE' },
    // semanticState PROPOSED but marked changed via changedEdgeIds: change
    // marking is independent of the PROPOSED state.
    { id: 'e3', fromRef: 'b', toRef: 'a', kind: 'AFFECTED_BY', semanticState: 'PROPOSED', authority: 'PROPOSED' },
  ],
  change: { projectionRevision: 3, changedVisibleRefs: ['b'], changedEdgeIds: ['e3'], currentSemanticState: 'PROPOSED' },
};

test('node truth, change and category come only from supplied fields', () => {
  const presented = presentDependencyGraph(sampleGraph);
  const [a, b] = presented.nodes;
  assert.equal(a?.truthMode, 'current');
  assert.equal(a?.changeState, 'not-marked');
  assert.equal(a?.focusRole, 'context');
  assert.equal(a?.entityLabel, 'Service / booking');
  assert.equal(a?.iconKind, 'booking');
  assert.equal(a?.indicator.label, 'Healthy');
  assert.equal(b?.truthMode, 'proposed');
  assert.equal(b?.changeState, 'marked');
  assert.equal(b?.secondaryLabel, 'supplied detail');
  assert.equal(b?.indicator.tone, 'watch');
});

test('edge truth and change come only from authority/changedEdgeIds, never from edge kind or semantic state', () => {
  const presented = presentDependencyGraph(sampleGraph);
  const [proposedKind, changedState, proposedState] = presented.edges;
  // FIG-2: authority decides truth (not the PROPOSED_CHANGE kind); changedEdgeIds
  // decides change marking (not the CHANGED/PROPOSED semantic state).
  assert.equal(proposedKind?.relationshipKind, 'PROPOSED_CHANGE');
  assert.equal(proposedKind?.truthMode, 'current');
  assert.equal(proposedKind?.changeState, 'not-marked');
  assert.equal(proposedKind?.label, 'Proposed change');
  assert.equal(proposedKind?.semanticState, undefined);
  assert.equal(proposedKind?.indicator.label, 'State not supplied');
  assert.equal(changedState?.semanticState, 'CHANGED');
  assert.equal(changedState?.truthMode, 'current');
  assert.equal(changedState?.changeState, 'not-marked');
  assert.equal(changedState?.indicator.glyph, 'change');
  assert.equal(proposedState?.semanticState, 'PROPOSED');
  assert.equal(proposedState?.truthMode, 'proposed');
  assert.equal(proposedState?.changeState, 'marked');
  assert.equal(proposedState?.indicator.glyph, 'proposal');
});

test('node and edge apply the same no-promotion rule to PROPOSED and CHANGED states', () => {
  const graph: LiveDependencyGraph = {
    scope: 'FOCUSED_CASE',
    nodes: [
      // Proposal-related semantic state on an authoritative record stays current.
      { ref: 'p', kind: 'RECOVERY_PROPOSAL', label: 'P', semanticState: 'PROPOSED', authority: 'AUTHORITATIVE' },
      // CHANGED semantic state without changedVisibleRefs membership is not marked.
      { ref: 'c', kind: 'TIMING', label: 'C', semanticState: 'CHANGED', authority: 'AUTHORITATIVE' },
      // A proposed record can be healthy; health never implies commitment.
      { ref: 'h', kind: 'PROGRAMME_COMMITMENT', label: 'H', semanticState: 'HEALTHY', authority: 'PROPOSED' },
    ],
    edges: [{ id: 'pc1', fromRef: 'p', toRef: 'c', kind: 'PROPOSED_CHANGE', semanticState: 'CHANGED', authority: 'AUTHORITATIVE' }],
    change: { projectionRevision: 1, changedVisibleRefs: ['h'], changedEdgeIds: [], currentSemanticState: 'CHANGED' },
  };
  const presented = presentDependencyGraph(graph);
  const byRef = new Map(presented.nodes.map((node) => [node.ref, node]));
  assert.equal(byRef.get('p')?.truthMode, 'current');
  assert.equal(byRef.get('p')?.semanticState, 'PROPOSED');
  assert.equal(byRef.get('c')?.changeState, 'not-marked');
  assert.equal(byRef.get('c')?.semanticState, 'CHANGED');
  assert.equal(byRef.get('h')?.truthMode, 'proposed');
  assert.equal(byRef.get('h')?.changeState, 'marked');
  assert.equal(byRef.get('h')?.indicator.tone, 'ok');
  // Edge kind PROPOSED_CHANGE with semanticState CHANGED but authority
  // AUTHORITATIVE and absent from changedEdgeIds: current / not-marked.
  assert.equal(presented.edges[0]?.truthMode, 'current');
  assert.equal(presented.edges[0]?.changeState, 'not-marked');
});

test('node caseRef and evaluation pass through independently of semanticState/changeState (FIG-4/FIG-7)', () => {
  const graph: LiveDependencyGraph = {
    scope: 'FOCUSED_CASE',
    nodes: [
      { ref: 'subj', kind: 'TRAVELLER', label: 'Subject', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE', caseRef: 'case:1', evaluation: 'PENDING_REASSESSMENT' },
      { ref: 'no-eval', kind: 'RECOVERY_PROPOSAL', label: 'Case node', semanticState: 'ACTIVE', authority: 'AUTHORITATIVE' },
    ],
    edges: [],
    change: { projectionRevision: 0, changedVisibleRefs: [], changedEdgeIds: [], currentSemanticState: 'UNKNOWN' },
  };
  const presented = presentDependencyGraph(graph);
  const byRef = new Map(presented.nodes.map((node) => [node.ref, node]));
  assert.equal(byRef.get('subj')?.caseRef, 'case:1');
  assert.equal(byRef.get('subj')?.evaluationState, 'pending-reassessment');
  assert.equal(byRef.get('subj')?.semanticState, 'HEALTHY', 'evaluation must never change semanticState');
  assert.equal(byRef.get('no-eval')?.caseRef, undefined);
  assert.equal(byRef.get('no-eval')?.evaluationState, 'not-supplied');
});

test('HEALTHY and RECOVERED stay distinguishable in the presentation model', () => {
  const graph: LiveDependencyGraph = {
    scope: 'FOCUSED_CASE',
    nodes: [
      { ref: 'h', kind: 'SERVICE_BOOKING', label: 'H', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'r', kind: 'SERVICE_BOOKING', label: 'R', semanticState: 'RECOVERED', authority: 'AUTHORITATIVE' },
    ],
    edges: [],
    change: { projectionRevision: 0, changedVisibleRefs: [], changedEdgeIds: [], currentSemanticState: 'UNKNOWN' },
  };
  const [healthy, recovered] = presentDependencyGraph(graph).nodes;
  assert.notEqual(healthy?.semanticState, recovered?.semanticState);
  assert.notEqual(healthy?.indicator.label, recovered?.indicator.label);
  assert.ok(semanticNode(recovered!).includes('data-state="RECOVERED"'));
});

test('UNKNOWN edge state and an omitted edge state remain distinct', () => {
  const graph: LiveDependencyGraph = {
    scope: 'FOCUSED_CASE',
    nodes: [
      { ref: 'a', kind: 'SERVICE_BOOKING', label: 'A', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'b', kind: 'TIMING', label: 'B', semanticState: 'UNKNOWN', authority: 'AUTHORITATIVE' },
    ],
    edges: [
      { id: 'unknown-edge', fromRef: 'a', toRef: 'b', kind: 'RELIES_ON', semanticState: 'UNKNOWN', authority: 'AUTHORITATIVE' },
      { id: 'omitted-edge', fromRef: 'a', toRef: 'b', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
    ],
    change: { projectionRevision: 0, changedVisibleRefs: [], changedEdgeIds: [], currentSemanticState: 'UNKNOWN' },
  };
  const [unknownEdge, omittedEdge] = presentDependencyGraph(graph).edges;
  assert.equal(unknownEdge?.semanticState, 'UNKNOWN');
  assert.equal(omittedEdge?.semanticState, undefined);
  assert.notEqual(unknownEdge?.indicator.label, omittedEdge?.indicator.label);
  assert.ok(semanticEdge(unknownEdge!).includes('data-state="UNKNOWN"'));
  assert.ok(semanticEdge(omittedEdge!).includes('data-state="NOT_SUPPLIED"'));
});

test('edge renderKey is the producer-owned stable id (FIG-1), not array position', () => {
  const presented = presentDependencyGraph(sampleGraph);
  assert.deepEqual(presented.edges.map((edge) => edge.renderKey), ['e1', 'e2', 'e3']);
});

test('duplicate edge ids are refused loudly', () => {
  const dupeEdges: LiveDependencyGraph = {
    scope: 'FOCUSED_CASE',
    nodes: [
      { ref: 'a', kind: 'SERVICE_BOOKING', label: 'A', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'b', kind: 'SERVICE_BOOKING', label: 'B', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
    ],
    edges: [
      { id: 'dup', fromRef: 'a', toRef: 'b', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
      { id: 'dup', fromRef: 'b', toRef: 'a', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
    ],
    change: { projectionRevision: 0, changedVisibleRefs: [], changedEdgeIds: [], currentSemanticState: 'UNKNOWN' },
  };
  assert.throws(() => presentDependencyGraph(dupeEdges), /INVALID PRESENTATION CONTRACT/);
});

test('focus role is an explicit UI selection, not derived from topology', () => {
  const presented = presentDependencyGraph(sampleGraph, {
    primaryRefs: ['b'], causalRefs: ['a'], causalEdgeIndices: [1],
  });
  assert.equal(presented.nodes.find((n) => n.ref === 'b')?.focusRole, 'primary');
  assert.equal(presented.nodes.find((n) => n.ref === 'a')?.focusRole, 'causal');
  assert.equal(presented.edges[1]?.focusRole, 'causal');
  assert.equal(presented.edges[0]?.focusRole, 'context');
});

// ---------------------------------------------------------------------------
// 3. Invalid contract is refused, not restyled
// ---------------------------------------------------------------------------

test('a dangling edge endpoint is refused', () => {
  const dangling = {
    scope: 'FOCUSED_CASE',
    nodes: [{ ref: 'a', kind: 'SERVICE_BOOKING', label: 'A', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' }],
    edges: [{ id: 'e1', fromRef: 'a', toRef: 'missing', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' }],
    change: { projectionRevision: 0, changedVisibleRefs: [], changedEdgeIds: [], currentSemanticState: 'UNKNOWN' },
  };
  assert.throws(() => presentDependencyGraph(dangling), /INVALID PRESENTATION CONTRACT/);
});

test('duplicate node references are refused', () => {
  const dupes = {
    scope: 'FOCUSED_CASE',
    nodes: [
      { ref: 'a', kind: 'SERVICE_BOOKING', label: 'A', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'a', kind: 'TIMING', label: 'A again', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
    ],
    edges: [],
    change: { projectionRevision: 0, changedVisibleRefs: [], changedEdgeIds: [], currentSemanticState: 'UNKNOWN' },
  };
  assert.throws(() => presentDependencyGraph(dupes), /ambiguous node references/);
});

test('a schema-invalid state is refused as an unmapped/invalid contract', () => {
  const badState = {
    scope: 'FOCUSED_CASE',
    nodes: [{ ref: 'a', kind: 'SERVICE_BOOKING', label: 'A', semanticState: 'NOPE', authority: 'AUTHORITATIVE' }],
    edges: [],
    change: { projectionRevision: 0, changedVisibleRefs: [], changedEdgeIds: [], currentSemanticState: 'UNKNOWN' },
  };
  assert.throws(() => presentDependencyGraph(badState), /UNMAPPED SEMANTIC STATE \/ INVALID PRESENTATION CONTRACT/);
});

// ---------------------------------------------------------------------------
// 4. Components consume presentation objects and escape dynamic text
// ---------------------------------------------------------------------------

test('semanticNode emits the orthogonal presentation dimensions as data attributes', () => {
  const presented = presentDependencyGraph(sampleGraph);
  const html = semanticNode(presented.nodes[0]!);
  assert.ok(html.includes('data-state="HEALTHY"'));
  assert.ok(html.includes('data-kind="SERVICE_BOOKING"'));
  assert.ok(html.includes('data-truth="current"'));
  assert.ok(html.includes('data-change="not-marked"'));
  assert.ok(html.includes('data-focus="context"'));
});

test('semanticEdge emits relationship and truth/change dimensions', () => {
  const presented = presentDependencyGraph(sampleGraph);
  const html = semanticEdge(presented.edges[0]!);
  assert.ok(html.includes('data-relationship="PROPOSED_CHANGE"'));
  assert.ok(html.includes('data-truth="current"'));
  assert.ok(html.includes('data-change="not-marked"'));
});

test('hostile label text is escaped, never emitted as markup', () => {
  const hostile = {
    scope: 'FOCUSED_CASE' as const,
    nodes: [{
      ref: 'x', kind: 'SERVICE_BOOKING' as const, label: '<img src=x onerror=alert(1)>',
      semanticState: 'HEALTHY' as const, authority: 'AUTHORITATIVE' as const,
    }],
    edges: [],
    change: { projectionRevision: 0, changedVisibleRefs: [], changedEdgeIds: [], currentSemanticState: 'UNKNOWN' as const },
  };
  const html = semanticNode(presentDependencyGraph(hostile).nodes[0]!);
  assert.ok(!html.includes('<img'), 'no live img tag may survive');
  assert.ok(
    html.includes('&lt;img src=x onerror=alert(1)&gt;'),
    'the entire hostile label must be escaped to inert text (both brackets neutralized)',
  );
});

// ---------------------------------------------------------------------------
// 5. Real fixtures are adapter-valid and the Lab renders every dimension
// ---------------------------------------------------------------------------

test('shipped fixtures pass the adapter directly (not silently caught)', () => {
  assert.ok(samples.length >= 5, 'expected the full fixture corpus');
  for (const sample of samples) {
    const presented = presentDependencyGraph(sample.graph, sample.focus);
    assert.equal(presented.nodes.length, sample.graph.nodes.length);
    assertIndicator(presentViability(sample.viability));
    if (sample.progression !== undefined) assertIndicator(presentConnection(sample.progression));
  }
});

test('the Contract Lab document renders every discovered dimension and the loud refusals', () => {
  const doc = renderContractLabDocument(samples);
  assert.ok(doc.startsWith('<!doctype html>'));
  for (const id of ['lab-states', 'lab-change', 'lab-truth', 'lab-focus', 'lab-relationships', 'lab-evaluation', 'lab-composed', 'lab-invalid']) {
    assert.ok(doc.includes(`id="${id}"`), `missing section ${id}`);
  }
  for (const state of LdgSemanticStateSchema.options) assert.ok(doc.includes(`data-state="${state}"`), `state ${state} not rendered`);
  for (const kind of LdgNodeKindSchema.options) assert.ok(doc.includes(`data-kind="${kind}"`), `node kind ${kind} not rendered`);
  for (const edgeKind of LdgEdgeKindSchema.options) assert.ok(doc.includes(`data-relationship="${edgeKind}"`), `edge kind ${edgeKind} not rendered`);
  for (const status of AssessmentViewStatusSchema.options) {
    assert.ok(doc.includes(`data-evaluation="${presentEvaluationState(status)}"`), `evaluation ${status} not rendered`);
  }
  assert.ok(doc.includes('data-evaluation="not-supplied"'), 'not-supplied evaluation state not rendered');
  // The deliberately invalid panels surface their refusal text.
  assert.ok(doc.includes('INVALID PRESENTATION CONTRACT'));
  assert.ok(doc.includes('UNMAPPED SEMANTIC STATE / INVALID PRESENTATION CONTRACT'));
  // The empty projection sample renders the empty-state note, not a blank hole.
  assert.ok(doc.includes('sem-empty'));
});
