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
  presentAssessment, presentConnection, presentDependencyGraph, presentGraphState,
  presentOperationalStatus, presentViability,
} from '../src/ui/semantics/adapter.ts';
import { semanticEdge, semanticNode } from '../src/ui/semantics/components.ts';
import { renderContractLabDocument, type ContractLabSample } from '../src/ui/screens/contract-lab.ts';
import {
  AssessmentToneSchema, ConnectionProgressionSchema, LdgEdgeKindSchema, LdgNodeKindSchema,
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
    { fromRef: 'a', toRef: 'b', kind: 'PROPOSED_CHANGE' },
    { fromRef: 'a', toRef: 'b', kind: 'RELIES_ON', semanticState: 'CHANGED' },
    { fromRef: 'b', toRef: 'a', kind: 'AFFECTED_BY', semanticState: 'PROPOSED' },
  ],
  change: { projectionRevision: 3, changedVisibleRefs: ['b'], currentSemanticState: 'PROPOSED' },
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

test('edge truth and change stay distinct; authority is never invented for edges', () => {
  const presented = presentDependencyGraph(sampleGraph);
  const [proposedByKind, changed, proposedByState] = presented.edges;
  // No state supplied + PROPOSED_CHANGE kind => proposed truth, change not supplied.
  assert.equal(proposedByKind?.truthMode, 'proposed');
  assert.equal(proposedByKind?.changeState, 'not-supplied');
  assert.equal(proposedByKind?.indicator.label, 'State not supplied');
  assert.equal(proposedByKind?.relationshipKind, 'PROPOSED_CHANGE');
  assert.equal(proposedByKind?.label, 'Proposed change');
  // CHANGED state marks change but does not assert current/proposed authority.
  assert.equal(changed?.changeState, 'marked');
  assert.equal(changed?.truthMode, 'unspecified');
  // PROPOSED state asserts proposed truth without a change mark.
  assert.equal(proposedByState?.truthMode, 'proposed');
  assert.equal(proposedByState?.changeState, 'not-supplied');
});

test('edge renderKey is snapshot-local position, not a stable identity', () => {
  const presented = presentDependencyGraph(sampleGraph);
  assert.deepEqual(presented.edges.map((edge) => edge.renderKey), [
    'snapshot-edge-0', 'snapshot-edge-1', 'snapshot-edge-2',
  ]);
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
    edges: [{ fromRef: 'a', toRef: 'missing', kind: 'RELIES_ON' }],
    change: { projectionRevision: 0, changedVisibleRefs: [], currentSemanticState: 'UNKNOWN' },
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
    change: { projectionRevision: 0, changedVisibleRefs: [], currentSemanticState: 'UNKNOWN' },
  };
  assert.throws(() => presentDependencyGraph(dupes), /ambiguous node references/);
});

test('a schema-invalid state is refused as an unmapped/invalid contract', () => {
  const badState = {
    scope: 'FOCUSED_CASE',
    nodes: [{ ref: 'a', kind: 'SERVICE_BOOKING', label: 'A', semanticState: 'NOPE', authority: 'AUTHORITATIVE' }],
    edges: [],
    change: { projectionRevision: 0, changedVisibleRefs: [], currentSemanticState: 'UNKNOWN' },
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
  assert.ok(html.includes('data-truth="proposed"'));
  assert.ok(html.includes('data-change="not-supplied"'));
});

test('hostile label text is escaped, never emitted as markup', () => {
  const hostile = {
    scope: 'FOCUSED_CASE' as const,
    nodes: [{
      ref: 'x', kind: 'SERVICE_BOOKING' as const, label: '<img src=x onerror=alert(1)>',
      semanticState: 'HEALTHY' as const, authority: 'AUTHORITATIVE' as const,
    }],
    edges: [],
    change: { projectionRevision: 0, changedVisibleRefs: [], currentSemanticState: 'UNKNOWN' as const },
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
  for (const id of ['lab-states', 'lab-change', 'lab-truth', 'lab-focus', 'lab-relationships', 'lab-composed', 'lab-invalid']) {
    assert.ok(doc.includes(`id="${id}"`), `missing section ${id}`);
  }
  for (const state of LdgSemanticStateSchema.options) assert.ok(doc.includes(`data-state="${state}"`), `state ${state} not rendered`);
  for (const kind of LdgNodeKindSchema.options) assert.ok(doc.includes(`data-kind="${kind}"`), `node kind ${kind} not rendered`);
  for (const edgeKind of LdgEdgeKindSchema.options) assert.ok(doc.includes(`data-relationship="${edgeKind}"`), `edge kind ${edgeKind} not rendered`);
  // The deliberately invalid panels surface their refusal text.
  assert.ok(doc.includes('INVALID PRESENTATION CONTRACT'));
  assert.ok(doc.includes('UNMAPPED SEMANTIC STATE / INVALID PRESENTATION CONTRACT'));
  // The empty projection sample renders the empty-state note, not a blank hole.
  assert.ok(doc.includes('sem-empty'));
});
