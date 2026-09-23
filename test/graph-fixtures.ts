/**
 * Generic graph fixtures shared by the graph browser tests and screenshot checks.
 * Deliberately domain-neutral: names/labels are data, nothing branches on them.
 */
import type { FocusedGraphView, LiveDependencyGraph } from '../src/contracts/v2/product/readModels.ts';

const change = (state: 'HEALTHY' | 'AFFECTED') => ({
  projectionRevision: 1,
  changedVisibleRefs: [],
  changedEdgeIds: [],
  currentSemanticState: state,
});

export function disruptedLdg(): LiveDependencyGraph {
  return {
    scope: 'FOCUSED_CASE',
    change: change('AFFECTED'),
    nodes: [
      { ref: 'TRAV:1', kind: 'TRAVELLER', label: 'Traveller One', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE', detail: 'Speaker' },
      { ref: 'BOOK:flight', kind: 'SERVICE_BOOKING', label: 'Carrier flight 157', semanticState: 'CHANGED', authority: 'AUTHORITATIVE', detail: 'Booking updated by the carrier' },
      { ref: 'TIME:arrival', kind: 'TIMING', label: 'Destination arrival', semanticState: 'AFFECTED', authority: 'AUTHORITATIVE', detail: 'Now lands after the session starts' },
      { ref: 'COMM:session', kind: 'PROGRAMME_COMMITMENT', label: 'Opening session', semanticState: 'FAILED', authority: 'AUTHORITATIVE', detail: 'Programme commitment' },
      { ref: 'COMM:objective', kind: 'PROGRAMME_COMMITMENT', label: 'Deliver session', semanticState: 'FAILED', authority: 'AUTHORITATIVE' },
      { ref: 'STAY:hotel', kind: 'TRANSFER_STAY', label: 'Harbour hotel', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
      { ref: 'MOVE:transfer', kind: 'TRANSFER_STAY', label: 'Airport transfer', semanticState: 'AFFECTED', authority: 'AUTHORITATIVE' },
      { ref: 'COMM:dinner', kind: 'PROGRAMME_COMMITMENT', label: 'Evening dinner', semanticState: 'HEALTHY', authority: 'AUTHORITATIVE' },
    ],
    edges: [
      { id: 'e-t-f', fromRef: 'TRAV:1', toRef: 'BOOK:flight', kind: 'RELIES_ON', authority: 'AUTHORITATIVE', semanticState: 'HEALTHY' },
      { id: 'e-f-a', fromRef: 'BOOK:flight', toRef: 'TIME:arrival', kind: 'MUST_HAPPEN_BEFORE', authority: 'AUTHORITATIVE', semanticState: 'AFFECTED' },
      { id: 'e-a-s', fromRef: 'TIME:arrival', toRef: 'COMM:session', kind: 'MUST_HAPPEN_BEFORE', authority: 'AUTHORITATIVE', semanticState: 'FAILED' },
      { id: 'e-s-o', fromRef: 'COMM:session', toRef: 'COMM:objective', kind: 'RELIES_ON', authority: 'AUTHORITATIVE', semanticState: 'FAILED' },
      { id: 'e-a-h', fromRef: 'TIME:arrival', toRef: 'STAY:hotel', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
      { id: 'e-a-m', fromRef: 'TIME:arrival', toRef: 'MOVE:transfer', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
      { id: 'e-a-d', fromRef: 'TIME:arrival', toRef: 'COMM:dinner', kind: 'RELIES_ON', authority: 'AUTHORITATIVE' },
    ],
  };
}

export function disruptedFocus(): FocusedGraphView {
  return {
    causalNodeRefs: ['BOOK:flight', 'TIME:arrival', 'COMM:session', 'COMM:objective'],
    causalEdgeIds: ['e-f-a', 'e-a-s', 'e-s-o'],
    recoveryNodeRefs: [],
    dependencyContextNodeRefs: ['STAY:hotel', 'MOVE:transfer', 'COMM:dinner'],
    ownerContextNodeRefs: ['TRAV:1'],
    unmappedCausalSteps: [],
    firstBreakpoint: { nodeRef: 'TIME:arrival', label: 'Destination arrival', dimension: 'timing', reasonCode: 'LATE' },
  };
}

/** The same trip once recovered: everything healthy, no breakpoint. */
export function recoveredLdg(): LiveDependencyGraph {
  const base = disruptedLdg();
  return {
    ...base,
    change: change('HEALTHY'),
    nodes: base.nodes.map((n) => ({ ...n, semanticState: 'HEALTHY' as const })),
    edges: base.edges.map((e) => (e.semanticState ? { ...e, semanticState: 'HEALTHY' as const } : e)),
  };
}

/** A materially different first-truthful snapshot (the "Original"): the booking itself had failed. */
export function originalLdg(): LiveDependencyGraph {
  const base = disruptedLdg();
  return {
    ...base,
    nodes: base.nodes.map((n) => (n.ref === 'BOOK:flight' ? { ...n, semanticState: 'FAILED' as const, detail: 'Cancelled by the carrier' } : n)),
    edges: base.edges.map((e) => (e.id === 'e-f-a' ? { ...e, semanticState: 'FAILED' as const } : e)),
  };
}

export function originalFocus(): FocusedGraphView {
  return { ...disruptedFocus(), firstBreakpoint: { nodeRef: 'BOOK:flight', label: 'Carrier flight 157', dimension: 'booking', reasonCode: 'CANCELLED' } };
}
