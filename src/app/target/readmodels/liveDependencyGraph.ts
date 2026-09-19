import {
  LiveDependencyGraphSchema,
  type LiveDependencyGraph,
} from '../../../contracts/v2/product/readModels.ts';
import { buildChangeAwareness } from './changeAwareness.ts';
import type { ProductWorldFacts } from './types.ts';

export type LiveDependencyGraphInput = ProductWorldFacts & {
  scope: 'DASHBOARD' | 'INCIDENT_PROGRAMME' | 'FOCUSED_CASE';
};

export function projectLiveDependencyGraph(input: LiveDependencyGraphInput): LiveDependencyGraph {
  const nodeRefs = new Set(input.nodes.map((node) => node.ref));
  const nodes = input.nodes.map((node) => ({
    ref: node.ref,
    kind: node.kind,
    label: node.label,
    semanticState: node.semanticState,
    authority: node.authority ?? 'AUTHORITATIVE',
    ...(node.caseRef ? { caseRef: node.caseRef } : {}),
    ...(node.evaluation ? { evaluation: node.evaluation } : {}),
    ...(node.subjectRefs ? { subjectRefs: [...node.subjectRefs] } : {}),
    ...(node.timing ? { timing: { ...node.timing } } : {}),
    ...(node.detail ? { detail: node.detail } : {}),
  }));
  const edges = input.edges
    .filter((edge) => nodeRefs.has(edge.fromRef) && nodeRefs.has(edge.toRef))
    .map((edge) => ({
      id: edge.id,
      fromRef: edge.fromRef,
      toRef: edge.toRef,
      kind: edge.kind,
      authority: edge.authority ?? 'AUTHORITATIVE',
      ...(edge.semanticState ? { semanticState: edge.semanticState } : {}),
    }));

  return LiveDependencyGraphSchema.parse({
    scope: input.scope,
    nodes,
    edges,
    change: buildChangeAwareness(input),
  });
}
