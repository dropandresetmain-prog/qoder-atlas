import type {
  AssessmentViewStatus, ChangeAwareness, LdgEdgeKind, LdgNodeKind, LdgSemanticState, LiveDependencyGraph,
} from '../../contracts/v2/product/readModels.ts';

export type VisualTone = 'ok' | 'watch' | 'alert' | 'active' | 'neutral';
export type FocusRole = 'primary' | 'causal' | 'context';
export type TruthMode = 'current' | 'proposed';
export type ChangeMarker = 'marked' | 'not-marked';
export type IconKind = 'signal' | 'booking' | 'person' | 'time' | 'support' | 'commitment' | 'proposal';
/**
 * Assessment lifecycle presentation (FIG-7) — an independent dimension, never
 * a stand-in for semanticState/changeState/tone. 'not-supplied' is distinct
 * from every real `AssessmentViewStatus`: it means the node is not an
 * assessed subject (e.g. a case or disruption node), not "unknown".
 */
export type EvaluationState = 'current' | 'stale' | 'pending-reassessment' | 'unavailable' | 'none' | 'not-supplied';

export interface SemanticIndicator {
  readonly label: string;
  readonly tone: VisualTone;
  readonly glyph: 'check' | 'change' | 'attention' | 'cross' | 'proposal' | 'active' | 'question';
}

export interface PresentationNode {
  readonly ref: string;
  readonly entityKind: LdgNodeKind;
  readonly entityLabel: string;
  readonly semanticState: LdgSemanticState;
  readonly indicator: SemanticIndicator;
  readonly truthMode: TruthMode;
  readonly changeState: ChangeMarker;
  readonly focusRole: FocusRole;
  readonly label: string;
  readonly secondaryLabel?: string;
  readonly iconKind: IconKind;
  readonly evaluationState: EvaluationState;
  readonly caseRef?: string;
}

export interface PresentationEdge {
  // The producer-owned LdgEdge.id (FIG-1) — stable across revisions, safe to
  // use as a reconciliation/DOM key.
  readonly renderKey: string;
  readonly sourceRef: string;
  readonly targetRef: string;
  readonly sourceLabel: string;
  readonly targetLabel: string;
  readonly relationshipKind: LdgEdgeKind;
  readonly semanticState?: LdgSemanticState;
  readonly indicator: SemanticIndicator;
  readonly truthMode: TruthMode;
  readonly changeState: ChangeMarker;
  readonly focusRole: FocusRole;
  readonly label: string;
}

export type { AssessmentViewStatus };

export interface PresentationGraph {
  readonly scope: LiveDependencyGraph['scope'];
  readonly change: ChangeAwareness;
  readonly nodes: readonly PresentationNode[];
  readonly edges: readonly PresentationEdge[];
}

export interface PresentationFocus {
  readonly primaryRefs?: readonly string[];
  readonly causalRefs?: readonly string[];
  // Explicit selection in this snapshot, not a path calculated from topology.
  readonly causalEdgeIndices?: readonly number[];
}
