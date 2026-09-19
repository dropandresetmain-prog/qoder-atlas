/**
 * R2 — pure mapping of the ordered authoritative `causalPath` onto the visible
 * focused Case graph (`ldg`).
 *
 * The frontend must NOT traverse graph topology to infer causality
 * (FRONTEND_SEMANTIC_CONTRACT FIG-5b). This module is the backend's answer: it
 * maps evaluator-owned cause/affected refs onto the graph's explicit visible-node
 * mappings and producer-owned edge ids, and reports any step that has no visible
 * graph object as an explicit honest gap rather than guessing or dropping it.
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
 * Ordering: `causalPath` is already in evaluator order. Each step's persisted
 * cause is preferred as the operational breakpoint; its affected subject remains
 * separate context. `subjectRefs` provide the explicit backend mapping from
 * canonical refs to presentation nodes. A causal edge is included when BOTH its
 * endpoints are on that backend-selected node set.
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
  const nodeForSubjectRef = new Map<string, string>();
  const ambiguousSubjectRefs = new Set<string>();
  const registerSubjectRef = (subjectRef: string, nodeRef: string): void => {
    if (ambiguousSubjectRefs.has(subjectRef)) return;
    const existing = nodeForSubjectRef.get(subjectRef);
    if (!existing) {
      nodeForSubjectRef.set(subjectRef, nodeRef);
    } else if (existing !== nodeRef) {
      // A third mapping must not restore a mapping already found ambiguous.
      nodeForSubjectRef.delete(subjectRef);
      ambiguousSubjectRefs.add(subjectRef);
    }
  };
  for (const node of ldg.nodes) {
    registerSubjectRef(node.ref, node.ref);
    for (const subjectRef of node.subjectRefs ?? []) {
      // A producer must not map one canonical fact to two visual nodes. Ignore
      // ambiguity here so the graph under-claims rather than arbitrarily picks.
      registerSubjectRef(subjectRef, node.ref);
    }
  }
  const resolveVisibleRef = (subjectRef: string): string | undefined => nodeForSubjectRef.get(subjectRef);
  const nodeByRef = new Map(ldg.nodes.map((node) => [node.ref, node]));
  const arrivalFor = (step: CausalPathStep): string | undefined => {
    // The enrichment producer already established this arrival's evaluator role.
    // A requirement can be the explanation cause while arrival is the earlier
    // operational breakpoint. Only an explicit, unambiguous timing mapping qualifies.
    const refs = [step.causeSubjectRef, ...step.relatedSubjectRefs]
      .filter((ref): ref is string => ref !== undefined)
      .map(resolveVisibleRef)
      .filter((ref): ref is string => ref !== undefined && nodeByRef.get(ref)?.timing !== undefined);
    const unique = [...new Set(refs)];
    return unique.length === 1 ? unique[0] : undefined;
  };

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
    const causeRef = step.causeSubjectRef ? resolveVisibleRef(step.causeSubjectRef) : undefined;
    const affectedRef = resolveVisibleRef(step.subjectRef);
    const arrivalRef = arrivalFor(step);
    const breakpointRef = arrivalRef ?? causeRef ?? affectedRef;
    if (breakpointRef) {
      if (arrivalRef) {
        for (const edge of ldg.edges) {
          if (edge.fromRef === affectedRef && nodeByRef.get(edge.toRef)?.kind === 'DISRUPTION') pushNode(edge.toRef);
        }
        for (const edge of ldg.edges) {
          if (edge.toRef === arrivalRef && nodeByRef.get(edge.fromRef)?.kind === 'SERVICE_BOOKING') pushNode(edge.fromRef);
        }
      }
      pushNode(breakpointRef);
      if (causeRef) pushNode(causeRef);
      if (affectedRef && !arrivalRef) pushNode(affectedRef);
      for (const related of step.relatedSubjectRefs) {
        const relatedRef = resolveVisibleRef(related);
        if (relatedRef && !(arrivalRef && nodeByRef.get(relatedRef)?.kind === 'TRAVELLER')) pushNode(relatedRef);
      }
    } else {
      unmappedCausalSteps.push({
        subjectRef: step.causeSubjectRef ?? step.subjectRef,
        dimension: step.dimension,
        reasonCode: step.reasonCode,
        reason: 'no visible graph node for explanation cause or affected subject',
      });
    }
  }

  const causalNodeSet = new Set(causalNodeRefs);
  const causalEdgeIds = ldg.edges
    .filter((edge) => causalNodeSet.has(edge.fromRef) && causalNodeSet.has(edge.toRef))
    .map((edge) => edge.id);

  // First operational breakpoint = persisted cause where mappable, otherwise the
  // affected subject. Never fabricate a visual target when neither is mapped.
  const firstStep = causalPath[0];
  const firstBreakpointRef = firstStep
    ? arrivalFor(firstStep) ?? (firstStep.causeSubjectRef ? resolveVisibleRef(firstStep.causeSubjectRef) : undefined) ?? resolveVisibleRef(firstStep.subjectRef)
    : undefined;
  const firstBreakpoint = firstStep && firstBreakpointRef && visibleRefs.has(firstBreakpointRef)
    ? {
        nodeRef: firstBreakpointRef,
        label: labelByRef.get(firstBreakpointRef) ?? firstBreakpointRef,
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
