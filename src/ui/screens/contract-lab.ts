/**
 * Frontend Semantic Contract Lab — development-only visual test bench.
 *
 * Every panel is produced by the real presentation pipeline (authoritative read
 * model -> single adapter -> presentation model -> shared visual grammar ->
 * components), so the bench proves the adapter, not just the markup. The Lab
 * presents supplied state only: it never recomputes viability, time, policy,
 * authority or blast radius. Unmapped or structurally invalid input is refused
 * loudly (see the invalid-contract panel), never silently restyled.
 *
 * Demo facts live in the caller-supplied fixtures (fixtures/ui/semantic-contract
 * .json), NOT here; this module contains only generic catalog content and stays
 * free of scenario/persona/brand literals so the anti-hardcoding gate (src/ui is
 * APP tier) keeps passing. No DB, no server, no runtime read-model wiring.
 */
import { escapeHtml } from '../html.ts';
import { THEME_CSS } from '../theme.ts';
import {
  presentAssessment, presentConnection, presentDependencyGraph,
  presentOperationalStatus, presentViability,
} from '../semantics/adapter.ts';
import { semanticBadge, semanticContractError, semanticEdge, semanticNode } from '../semantics/components.ts';
import { SEMANTIC_CSS } from '../semantics/grammar.ts';
import type { PresentationFocus, PresentationGraph, SemanticIndicator } from '../semantics/model.ts';
import {
  AssessmentToneSchema, ConnectionProgressionSchema, LdgNodeKindSchema,
  LdgSemanticStateSchema, ProductOperationalStatusSchema, RemainderViabilitySchema,
  type ChangeAwareness, type ConnectionProgression, type LdgEdge, type LdgNode,
  type LiveDependencyGraph, type RemainderViability,
} from '../../contracts/v2/product/readModels.ts';
import { CONTRACT_LAB_CSS } from './contract-lab-theme.ts';

/** One fixture-backed composed example shown in section F. */
export interface ContractLabSample {
  readonly title: string;
  readonly description: string;
  readonly viability: RemainderViability;
  readonly progression?: ConnectionProgression;
  readonly graph: LiveDependencyGraph;
  readonly focus: PresentationFocus;
}

// ---------------------------------------------------------------------------
// Synthetic read-model builders (generic refs only; pass LiveDependencyGraphSchema)
// ---------------------------------------------------------------------------

const quietChange = (): ChangeAwareness =>
  ({ projectionRevision: 0, changedVisibleRefs: [], currentSemanticState: 'UNKNOWN' });

function graphOf(nodes: readonly LdgNode[], edges: readonly LdgEdge[] = [], change: ChangeAwareness = quietChange()): LiveDependencyGraph {
  return { scope: 'FOCUSED_CASE', nodes: [...nodes], edges: [...edges], change };
}

function nodeOf(ref: string, kind: LdgNode['kind'], label: string, semanticState: LdgNode['semanticState'], authority: LdgNode['authority'], detail?: string): LdgNode {
  return detail === undefined
    ? { ref, kind, label, semanticState, authority }
    : { ref, kind, label, semanticState, authority, detail };
}

function edgeOf(fromRef: string, toRef: string, kind: LdgEdge['kind'], semanticState?: LdgEdge['semanticState']): LdgEdge {
  return semanticState === undefined ? { fromRef, toRef, kind } : { fromRef, toRef, kind, semanticState };
}

/** Run a synthetic graph through the single adapter and render its nodes. */
function presentNodes(input: LiveDependencyGraph, focus: PresentationFocus = {}): string {
  const presented = presentDependencyGraph(input, focus);
  return `<div class="lab-grid">${presented.nodes.map(semanticNode).join('')}</div>`;
}

function badgeFamily<T extends string>(caption: string, values: readonly T[], present: (value: T) => SemanticIndicator): string {
  const items = values
    .map((value) => `<li>${semanticBadge(present(value))}<code>${escapeHtml(value)}</code></li>`)
    .join('');
  return `<div class="lab-family"><h3>${escapeHtml(caption)}</h3><ul>${items}</ul></div>`;
}

function changeMeta(change: ChangeAwareness): string {
  const changed = change.changedVisibleRefs.length > 0
    ? change.changedVisibleRefs.map(escapeHtml).join(', ')
    : 'none supplied';
  const previous = change.previousSemanticState ? `${escapeHtml(change.previousSemanticState)} → ` : '';
  const source = change.changeSource
    ? `<div><dt>Change source</dt><dd>${escapeHtml(change.changeSource)}</dd></div>`
    : '';
  return `<dl class="lab-change">
    <div><dt>Projection revision</dt><dd>${change.projectionRevision}</dd></div>
    <div><dt>Changed visible refs</dt><dd>${changed}</dd></div>
    <div><dt>State (previous → current)</dt><dd>${previous}${escapeHtml(change.currentSemanticState)}</dd></div>
    ${source}
  </dl>`;
}

function section(id: string, index: string, title: string, note: string, content: string): string {
  return `<section id="${id}" aria-labelledby="${id}-h">
    <div class="lab-section-head"><span class="lab-index">${index}</span><h2 id="${id}-h">${title}</h2></div>
    <p class="lab-note">${note}</p>
    ${content}
  </section>`;
}

// ---------------------------------------------------------------------------
// Sections A–E: catalogs that exhaust the discovered M9 enums
// ---------------------------------------------------------------------------

function sectionStates(): string {
  const stateNodes = LdgSemanticStateSchema.options
    .map((value) => nodeOf(`state-${value}`, 'SERVICE_BOOKING', value, value, 'AUTHORITATIVE'));
  const kindNodes = LdgNodeKindSchema.options
    .map((value) => nodeOf(`kind-${value}`, value, value, 'HEALTHY', 'AUTHORITATIVE'));
  const families = [
    badgeFamily('Remainder viability', RemainderViabilitySchema.options, presentViability),
    badgeFamily('Assessment tone', AssessmentToneSchema.options, presentAssessment),
    badgeFamily('Operational status', ProductOperationalStatusSchema.options, presentOperationalStatus),
    badgeFamily('Connection progression', ConnectionProgressionSchema.options, presentConnection),
  ].join('');
  const content = `
    <h3 class="lab-sub">Graph semantic state (LdgSemanticState)</h3>
    ${presentNodes(graphOf(stateNodes))}
    <h3 class="lab-sub">Node category (LdgNodeKind) — presentation categories, not ontology entity types</h3>
    ${presentNodes(graphOf(kindNodes))}
    <h3 class="lab-sub">Other authoritative state families (kept separate, never merged into one status)</h3>
    <div class="lab-grid">${families}</div>`;
  return section('lab-states', 'A', 'Entity and state catalog',
    'Each card is one enum value driven through the adapter. A new backend value with no mapping fails the unit test and refuses to render — there is no neutral fallback.',
    content);
}

function sectionChange(): string {
  const input = graphOf(
    [
      nodeOf('changed-node', 'TIMING', 'Listed in changedVisibleRefs', 'CHANGED', 'AUTHORITATIVE'),
      nodeOf('steady-node', 'SERVICE_BOOKING', 'Not listed in changedVisibleRefs', 'HEALTHY', 'AUTHORITATIVE'),
    ],
    [],
    {
      projectionRevision: 7,
      changedVisibleRefs: ['changed-node'],
      previousSemanticState: 'HEALTHY',
      currentSemanticState: 'CHANGED',
      changeSource: 'fixture-supplied revision',
    },
  );
  const presented = presentDependencyGraph(input);
  return section('lab-change', 'B', 'Change semantics',
    'Change marking comes only from supplied changedVisibleRefs and revision metadata. The frontend diffs nothing and never infers a changed edge from its endpoints.',
    `${changeMeta(presented.change)}<div class="lab-grid">${presented.nodes.map(semanticNode).join('')}</div>`);
}

function sectionTruth(): string {
  const input = graphOf(
    [
      nodeOf('current-node', 'SERVICE_BOOKING', 'Authoritative node', 'HEALTHY', 'AUTHORITATIVE'),
      nodeOf('proposed-node', 'RECOVERY_PROPOSAL', 'Proposed node', 'PROPOSED', 'PROPOSED'),
    ],
    [
      edgeOf('current-node', 'proposed-node', 'PROPOSED_CHANGE', 'PROPOSED'),
      edgeOf('current-node', 'proposed-node', 'RELIES_ON'),
    ],
  );
  const presented = presentDependencyGraph(input);
  return section('lab-truth', 'C', 'Current versus proposed',
    'Node authority is always supplied, so a node is current or proposed. M9 edges carry no authority, so every edge truth mode is unspecified — a PROPOSED state or PROPOSED_CHANGE kind stays visible as its own state/relationship, never promoted to proposed or current truth (gap FIG-2).',
    `<div class="lab-grid">${presented.nodes.map(semanticNode).join('')}</div>
     <h3 class="lab-sub">Edge truth modes</h3>
     <div class="lab-grid">${presented.edges.map(semanticEdge).join('')}</div>`);
}

function sectionFocus(): string {
  const input = graphOf(
    [
      nodeOf('focus-primary', 'PROGRAMME_COMMITMENT', 'Primary focus', 'AFFECTED', 'AUTHORITATIVE'),
      nodeOf('focus-causal', 'TIMING', 'Causal focus (UI selected)', 'CHANGED', 'AUTHORITATIVE'),
      nodeOf('focus-context', 'SERVICE_BOOKING', 'Context', 'HEALTHY', 'AUTHORITATIVE'),
    ],
    [edgeOf('focus-causal', 'focus-primary', 'MUST_HAPPEN_BEFORE', 'AFFECTED')],
  );
  const focus: PresentationFocus = { primaryRefs: ['focus-primary'], causalRefs: ['focus-causal'], causalEdgeIndices: [0] };
  const presented = presentDependencyGraph(input, focus);
  return section('lab-focus', 'D', 'Focus hierarchy',
    'Focus role is an explicit UI selection passed into the adapter, not a path computed from graph topology. Primary, causal and context stay visually distinct without recoloring state.',
    `<div class="lab-grid">${presented.nodes.map(semanticNode).join('')}</div>
     <div class="lab-grid">${presented.edges.map(semanticEdge).join('')}</div>`);
}

function sectionRelationships(): string {
  const nodes = ['rel-a', 'rel-b', 'rel-c', 'rel-d', 'rel-e', 'rel-f']
    .map((ref, i) => nodeOf(ref, 'SERVICE_BOOKING', `Endpoint ${i + 1}`, 'HEALTHY', 'AUTHORITATIVE'));
  // One edge per LdgEdgeKind, each exercising a different edge state/truth/change variant.
  const edges = [
    edgeOf('rel-a', 'rel-b', 'AFFECTED_BY', 'HEALTHY'),
    edgeOf('rel-b', 'rel-c', 'RELIES_ON', 'CHANGED'),
    edgeOf('rel-c', 'rel-d', 'MUST_HAPPEN_BEFORE', 'PROPOSED'),
    edgeOf('rel-d', 'rel-e', 'PARTICIPATES_IN'),
    edgeOf('rel-e', 'rel-f', 'PROPOSED_CHANGE'),
  ];
  const presented = presentDependencyGraph(graphOf(nodes, edges), { causalEdgeIndices: [1] });
  return section('lab-relationships', 'E', 'Relationships',
    'Every real LdgEdgeKind rendered once, across HEALTHY, CHANGED, PROPOSED and state-not-supplied semantic states. Edge state never sets edge truth or change marking. Edges have no stable identity in M9; renderKey is snapshot-local position only (gap FIG-1).',
    `<h3 class="lab-sub">Edge kinds and states</h3>
     <div class="lab-grid">${presented.edges.map(semanticEdge).join('')}</div>
     <h3 class="lab-sub">Endpoints</h3>
     <div class="lab-strip">${presented.nodes.map(semanticNode).join('')}</div>`);
}

// ---------------------------------------------------------------------------
// Section F: composed fixture samples, plus the loud invalid-contract panel
// ---------------------------------------------------------------------------

function renderSampleBody(sample: ContractLabSample): string {
  const presented: PresentationGraph = presentDependencyGraph(sample.graph, sample.focus);
  const viability = presentViability(sample.viability);
  const progression = sample.progression === undefined ? undefined : presentConnection(sample.progression);
  const badges = `<div class="lab-badge-row">${semanticBadge(viability)}${progression ? semanticBadge(progression) : ''}</div>`;
  const nodes = presented.nodes.length > 0
    ? `<div class="lab-strip">${presented.nodes.map(semanticNode).join('')}</div>`
    : '<p class="sem-empty">No nodes in scope. Empty does not mean viable or recovered — viability stays as supplied above.</p>';
  const edges = presented.edges.length > 0
    ? `<div class="lab-strip">${presented.edges.map(semanticEdge).join('')}</div>`
    : '';
  return `${badges}${changeMeta(presented.change)}${nodes}${edges}`;
}

function renderSample(sample: ContractLabSample, index: number): string {
  let body: string;
  try {
    body = renderSampleBody(sample);
  } catch (error) {
    body = semanticContractError(error instanceof Error ? error.message : 'Sample refused by the presentation contract');
  }
  return `<article class="lab-sample" data-sample-index="${index}" data-test="lab-sample">
    <h3>${escapeHtml(sample.title)}</h3>
    <p class="lab-note">${escapeHtml(sample.description)}</p>
    ${body}
  </article>`;
}

function sectionComposed(samples: readonly ContractLabSample[]): string {
  const options = samples
    .map((sample, index) => `<option value="${index}">${escapeHtml(sample.title)}</option>`)
    .join('');
  const rendered = samples.map(renderSample).join('');
  return section('lab-composed', 'F', 'Composed examples',
    'Fixture-backed mini graphs that combine state, change, truth and focus the way a real case reads. Demo facts come from fixtures/ui, never from generic presentation code.',
    `<div class="lab-toolbar">
       <label for="lab-sample-select">Show sample</label>
       <select id="lab-sample-select" data-test="lab-sample-select">
         <option value="all">All samples</option>${options}
       </select>
     </div>
     <div class="lab-samples" data-test="lab-samples">${rendered}</div>`);
}

function invalidPanel(): string {
  const dangling = graphOf(
    [nodeOf('present-node', 'SERVICE_BOOKING', 'Present node', 'HEALTHY', 'AUTHORITATIVE')],
    [edgeOf('present-node', 'missing-node', 'RELIES_ON', 'HEALTHY')],
  );
  const badState = { ...graphOf([nodeOf('bad-node', 'SERVICE_BOOKING', 'Bad state', 'HEALTHY', 'AUTHORITATIVE')]),
    nodes: [{ ref: 'bad-node', kind: 'SERVICE_BOOKING', label: 'Bad state', semanticState: 'NOT_A_REAL_STATE', authority: 'AUTHORITATIVE' }] };
  const refuse = (input: unknown): string => {
    try {
      presentDependencyGraph(input);
      return semanticContractError('UNEXPECTED: invalid input was accepted');
    } catch (error) {
      return semanticContractError(error instanceof Error ? error.message : 'Refused');
    }
  };
  return section('lab-invalid', '!', 'Invalid input is refused',
    'These two panels are deliberately broken to prove the contract fails loudly. No silent default restyles unknown or malformed state.',
    `<div class="lab-invalid">
       <div><h3 class="lab-sub">Dangling edge endpoint</h3>${refuse(dangling)}</div>
       <div><h3 class="lab-sub">Unknown semantic state</h3>${refuse(badState)}</div>
     </div>`);
}

// ---------------------------------------------------------------------------
// Body and document
// ---------------------------------------------------------------------------

const SELECTION_SCRIPT = `<script>
(function () {
  'use strict';
  var select = document.getElementById('lab-sample-select');
  if (!select) { return; }
  select.addEventListener('change', function () {
    var value = select.value;
    var samples = document.querySelectorAll('.lab-sample');
    for (var i = 0; i < samples.length; i += 1) {
      var index = samples[i].getAttribute('data-sample-index');
      if (value === 'all' || value === index) { samples[i].removeAttribute('hidden'); }
      else { samples[i].setAttribute('hidden', ''); }
    }
  });
}());
</script>`;

export function renderContractLabBody(samples: readonly ContractLabSample[]): string {
  const nav = [
    ['lab-states', 'A · States'], ['lab-change', 'B · Change'], ['lab-truth', 'C · Current/Proposed'],
    ['lab-focus', 'D · Focus'], ['lab-relationships', 'E · Relationships'], ['lab-composed', 'F · Composed'],
    ['lab-invalid', '! · Invalid'],
  ].map(([id, label]) => `<a href="#${id}">${label}</a>`).join('');
  return `<main class="lab" data-test="contract-lab">
  <header class="lab-intro">
    <div>
      <p class="lab-kicker">Development-only · fixture-backed · offline</p>
      <h1>Frontend Semantic Contract Lab</h1>
      <p>Each panel is produced by the real pipeline: authoritative read model → one presentation adapter → presentation model → shared visual grammar → components. The browser presents supplied state and never recomputes viability, time, policy, authority or blast radius.</p>
    </div>
    <p class="lab-rule"><strong>The frontend presents truth; it never decides it.</strong>Unmapped or invalid input is refused loudly, never silently restyled.</p>
  </header>
  <nav class="lab-nav" aria-label="Contract Lab sections">${nav}</nav>
  ${sectionStates()}
  ${sectionChange()}
  ${sectionTruth()}
  ${sectionFocus()}
  ${sectionRelationships()}
  ${sectionComposed(samples)}
  ${invalidPanel()}
  <footer class="lab-end">Semantic contract source of truth: docs/FRONTEND_SEMANTIC_CONTRACT.md · visual authority: docs/DESIGN.md and the frozen WiT graph contract. Colour always pairs with a glyph and label.</footer>
  ${SELECTION_SCRIPT}
</main>`;
}

export function renderContractLabDocument(samples: readonly ContractLabSample[]): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Frontend Semantic Contract Lab · Northstar</title>
<style>${THEME_CSS}</style>
<style>${SEMANTIC_CSS}</style>
<style>${CONTRACT_LAB_CSS}</style>
</head>
<body class="lab-page">
${renderContractLabBody(samples)}
</body>
</html>`;
}
