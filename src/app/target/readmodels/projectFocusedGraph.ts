/**
 * R2 — pure mapping of the ordered authoritative `causalPath` onto the visible
 * focused Case graph (`ldg`).
 *
 * The frontend must NOT traverse graph topology to infer causality
 * (FRONTEND_SEMANTIC_CONTRACT FIG-5b). This module is the backend's answer: it
 * intersects the evaluator-ordered causal steps with the graph's own visible node
 * refs and producer-owned edge ids, and reports any step that has no visible graph
 * object as an explicit honest gap rather than guessing or dropping it.
 *
 * Pure and deterministic: a function of the already-produced `ldg` and the case's
 * `causalPath`. No PostgreSQL, no scenario branch, no topology search.
 */
import type {
  CausalPathStep,
  FocusedGraphView,
  LiveDependencyGraph,
} from '../../../contracts/v2/product/readModels.ts';

/**
 * Map the ordered causal path onto the visible graph.
 *
 * Ordering: `causalPath` is already in evaluator order and its first entry is the
 * first operational breakpoint. We preserve that order for `causalNodeRefs`,
 * de-duplicated, keeping only refs that are actually visible nodes. A causal edge
 * is included when BOTH its endpoints are on the causal node set — the chain the
 * operator should read — using the producer-owned stable `LdgEdge.id`.
 *
 * `relatedSubjectRefs` on a step are part of the same causal explanation, so they
 * join the visible chain too (still only when visible). A step whose own subject is
 * not a visible node is recorded in `unmappedCausalSteps`; this is truthful — the
 * focused graph is deliberately sparse and does not mirror every backend subject.
 */
export function projectFocusedGraph(
  ldg: LiveDependencyGraph,
  causalPath: readonly CausalPathStep[],
): FocusedGraphView | undefined {
  if (causalPath.length === 0) return undefined;

  const visibleRefs = new Set(ldg.nodes.map((node) => node.ref));
  const labelByRef = new Map(ldg.nodes.map((node) => [node.ref, node.label]));

  const causalNodeRefs: string[] = [];
  const seenNode = new Set<string>();
  const pushNode = (ref: string): void => {
    if (visibleRefs.has(ref) && !seenNode.has(ref)) {
      seenNode.add(ref);
      causalNodeRefs.push(ref);
    }
  };

  const unmappedCausalSteps: FocusedGraphView['unmappedCausalSteps'] = [];
  for (const step of causalPath) {
    const subjectVisible = visibleRefs.has(step.subjectRef);
    if (subjectVisible) {
      pushNode(step.subjectRef);
      for (const related of step.relatedSubjectRefs) pushNode(related);
    } else {
      unmappedCausalSteps.push({
        subjectRef: step.subjectRef,
        dimension: step.dimension,
        reasonCode: step.reasonCode,
        reason: 'no visible graph node for subject',
      });
    }
  }

  const causalNodeSet = new Set(causalNodeRefs);
  const causalEdgeIds = ldg.edges
    .filter((edge) => causalNodeSet.has(edge.fromRef) && causalNodeSet.has(edge.toRef))
    .map((edge) => edge.id);

  // First operational breakpoint = causalPath[0], but only surfaced as a focal
  // point when it actually maps to a visible node. Otherwise the honest gap above
  // carries it and there is no focal emphasis (never a fabricated breakpoint).
  const firstStep = causalPath[0];
  const firstBreakpoint = firstStep && visibleRefs.has(firstStep.subjectRef)
    ? {
        nodeRef: firstStep.subjectRef,
        label: labelByRef.get(firstStep.subjectRef) ?? firstStep.subjectRef,
        dimension: firstStep.dimension,
        reasonCode: firstStep.reasonCode,
      }
    : undefined;

  return {
    causalNodeRefs,
    causalEdgeIds,
    ...(firstBreakpoint ? { firstBreakpoint } : {}),
    unmappedCausalSteps,
  };
}
