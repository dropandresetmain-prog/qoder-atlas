import {
  LiveDependencyGraphSchema,
  type AssessmentTone, type ConnectionProgression, type LdgEdgeKind, type LdgNode,
  type LdgNodeKind, type LdgSemanticState, type ProductOperationalStatus, type RemainderViability,
} from '../../contracts/v2/product/readModels.ts';
import type {
  IconKind, PresentationFocus, PresentationGraph, PresentationNode, SemanticIndicator,
} from './model.ts';

const indicator = (label: string, tone: SemanticIndicator['tone'], glyph: SemanticIndicator['glyph']): SemanticIndicator =>
  ({ label, tone, glyph });

const GRAPH_STATES: Record<LdgSemanticState, SemanticIndicator> = {
  HEALTHY: indicator('Healthy', 'ok', 'check'),
  CHANGED: indicator('Changed', 'watch', 'change'),
  AFFECTED: indicator('Affected', 'watch', 'attention'),
  FAILED: indicator('Failed', 'alert', 'cross'),
  PROPOSED: indicator('Proposed', 'watch', 'proposal'),
  ACTIVE: indicator('Work in progress', 'active', 'active'),
  UNKNOWN: indicator('Unknown / unconfirmed', 'neutral', 'question'),
  RECOVERED: indicator('Recovered', 'ok', 'check'),
};
const VIABILITY: Record<RemainderViability, SemanticIndicator> = {
  VIABLE: indicator('Viable', 'ok', 'check'),
  AT_RISK: indicator('At risk', 'watch', 'attention'),
  NOT_VIABLE: indicator('Not viable', 'alert', 'cross'),
  UNKNOWN: indicator('Viability unknown', 'neutral', 'question'),
};
const ASSESSMENTS: Record<AssessmentTone, SemanticIndicator> = {
  PASS: indicator('Pass', 'ok', 'check'),
  FAIL: indicator('Fail', 'alert', 'cross'),
  UNKNOWN: indicator('Assessment unknown', 'neutral', 'question'),
};
const OPERATIONAL: Record<ProductOperationalStatus, SemanticIndicator> = {
  READY: indicator('Confirmed', 'ok', 'check'),
  AT_RISK: indicator('At risk', 'watch', 'attention'),
  DISRUPTED: indicator('Needs attention', 'alert', 'cross'),
  RECOVERING: indicator('Recovery under way', 'active', 'active'),
  UNKNOWN: indicator('Unconfirmed', 'neutral', 'question'),
};
const CONNECTION: Record<ConnectionProgression, SemanticIndicator> = {
  HEALTHY: indicator('Healthy', 'ok', 'check'),
  CONNECTION_SAFE: indicator('Connection safe', 'ok', 'check'),
  CONNECTION_AT_RISK: indicator('Connection at risk', 'watch', 'attention'),
  CONNECTION_IMPOSSIBLE: indicator('Connection impossible', 'alert', 'cross'),
  RECOVERY_PLANNING: indicator('Planning recovery', 'active', 'active'),
  AWAITING_APPROVAL: indicator('Awaiting approval', 'watch', 'proposal'),
  EXECUTING_COORDINATED_RECOVERY: indicator('Executing coordinated recovery', 'active', 'active'),
  CHECKING_RESULTS: indicator('Checking results', 'active', 'active'),
  RECOVERED: indicator('Recovered', 'ok', 'check'),
  STILL_UNRESOLVED: indicator('Still unresolved', 'alert', 'attention'),
};
const ENTITIES: Record<LdgNodeKind, { label: string; icon: IconKind }> = {
  DISRUPTION: { label: 'Disruption', icon: 'signal' },
  SERVICE_BOOKING: { label: 'Service / booking', icon: 'booking' },
  TRAVELLER: { label: 'Traveller', icon: 'person' },
  TIMING: { label: 'Timing', icon: 'time' },
  TRANSFER_STAY: { label: 'Transfer / stay', icon: 'support' },
  PROGRAMME_COMMITMENT: { label: 'Programme commitment', icon: 'commitment' },
  RECOVERY_PROPOSAL: { label: 'Recovery proposal / case', icon: 'proposal' },
};
const RELATIONSHIPS: Record<LdgEdgeKind, string> = {
  AFFECTED_BY: 'Affected by',
  RELIES_ON: 'Relies on',
  MUST_HAPPEN_BEFORE: 'Must happen before',
  PARTICIPATES_IN: 'Participates in',
  PROPOSED_CHANGE: 'Proposed change',
};
const AUTHORITY: Record<LdgNode['authority'], PresentationNode['truthMode']> = {
  AUTHORITATIVE: 'current', PROPOSED: 'proposed',
};

function mapped<K extends string, V>(table: Record<K, V>, value: K): V {
  if (!Object.hasOwn(table, value)) throw new Error('UNMAPPED SEMANTIC STATE');
  return table[value];
}

export const presentGraphState = (value: LdgSemanticState): SemanticIndicator => ({ ...mapped(GRAPH_STATES, value) });
export const presentViability = (value: RemainderViability): SemanticIndicator => ({ ...mapped(VIABILITY, value) });
export const presentAssessment = (value: AssessmentTone): SemanticIndicator => ({ ...mapped(ASSESSMENTS, value) });
export const presentOperationalStatus = (value: ProductOperationalStatus): SemanticIndicator => ({ ...mapped(OPERATIONAL, value) });
export const presentConnection = (value: ConnectionProgression): SemanticIndicator => ({ ...mapped(CONNECTION, value) });

export function presentDependencyGraph(input: unknown, focus: PresentationFocus = {}): PresentationGraph {
  const parsed = LiveDependencyGraphSchema.safeParse(input);
  if (!parsed.success) throw new Error('UNMAPPED SEMANTIC STATE / INVALID PRESENTATION CONTRACT');
  const graph = parsed.data;
  const nodeByRef = new Map(graph.nodes.map((node) => [node.ref, node]));
  if (nodeByRef.size !== graph.nodes.length || graph.edges.some((edge) =>
    !nodeByRef.has(edge.fromRef) || !nodeByRef.has(edge.toRef))) {
    throw new Error('INVALID PRESENTATION CONTRACT: ambiguous node references');
  }
  const changedRefs = new Set(graph.change.changedVisibleRefs);
  const primaryRefs = new Set(focus.primaryRefs);
  const causalRefs = new Set(focus.causalRefs);
  const causalEdges = new Set(focus.causalEdgeIndices);
  return {
    scope: graph.scope,
    change: graph.change,
    nodes: graph.nodes.map((node) => {
      const entity = mapped(ENTITIES, node.kind);
      return {
        ref: node.ref, entityKind: node.kind, entityLabel: entity.label,
        semanticState: node.semanticState, indicator: presentGraphState(node.semanticState),
        truthMode: mapped(AUTHORITY, node.authority),
        changeState: changedRefs.has(node.ref) ? 'marked' : 'not-marked',
        focusRole: primaryRefs.has(node.ref) ? 'primary' : causalRefs.has(node.ref) ? 'causal' : 'context',
        label: node.label, secondaryLabel: node.detail, iconKind: entity.icon,
      };
    }),
    edges: graph.edges.map((edge, index) => ({
      renderKey: `snapshot-edge-${index}`,
      sourceRef: edge.fromRef, targetRef: edge.toRef,
      sourceLabel: nodeByRef.get(edge.fromRef)!.label, targetLabel: nodeByRef.get(edge.toRef)!.label,
      relationshipKind: edge.kind, semanticState: edge.semanticState,
      indicator: edge.semanticState === undefined
        ? indicator('State not supplied', 'neutral', 'question') : presentGraphState(edge.semanticState),
      truthMode: edge.semanticState === 'PROPOSED' || edge.kind === 'PROPOSED_CHANGE' ? 'proposed' : 'unspecified',
      changeState: edge.semanticState === 'CHANGED' ? 'marked' : 'not-supplied',
      focusRole: causalEdges.has(index) ? 'causal' : 'context',
      label: mapped(RELATIONSHIPS, edge.kind),
    })),
  };
}
