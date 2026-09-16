import type {
  ChangeAwareness, LdgEdgeKind, LdgNodeKind, LdgSemanticState, LiveDependencyGraph,
} from '../../contracts/v2/product/readModels.ts';

export type VisualTone = 'ok' | 'watch' | 'alert' | 'active' | 'neutral';
export type FocusRole = 'primary' | 'causal' | 'context';
export type TruthMode = 'current' | 'proposed' | 'unspecified';
export type ChangeMarker = 'marked' | 'not-marked' | 'not-supplied';
export type IconKind = 'signal' | 'booking' | 'person' | 'time' | 'support' | 'commitment' | 'proposal';

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
  readonly truthMode: Exclude<TruthMode, 'unspecified'>;
  readonly changeState: Exclude<ChangeMarker, 'not-supplied'>;
  readonly focusRole: FocusRole;
  readonly label: string;
  readonly secondaryLabel?: string;
  readonly iconKind: IconKind;
}

export interface PresentationEdge {
  // Position within one snapshot only; never an identity for reconciliation.
  readonly renderKey: string;
  readonly sourceRef: string;
  readonly targetRef: string;
  readonly sourceLabel: string;
  readonly targetLabel: string;
  readonly relationshipKind: LdgEdgeKind;
  readonly semanticState?: LdgSemanticState;
  readonly indicator: SemanticIndicator;
  readonly truthMode: Exclude<TruthMode, 'current'>;
  readonly changeState: Exclude<ChangeMarker, 'not-marked'>;
  readonly focusRole: FocusRole;
  readonly label: string;
}

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
