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
 *
 * `dependencyContext` carries the case's other blocking, applicable, NON-failing
 * evaluator explanations (never part of `causalPath`). One such explanation joins
 * the spine only when it explicitly names — as cause or related subject — a
 * non-traveller node already on the causal chain: it is an evaluator-declared
 * dependency of that chain (e.g. a destination stay or a required commitment
 * that depends on the implicated arrival). Its other visible subjects are then
 * appended after the causal nodes. One hop only: the anchors are fixed before
 * this pass, so a dependent never pulls in dependents of its own, and an
 * explanation that names nothing on the chain (an unrelated commitment) stays
 * off the spine. The traveller is never an anchor — every journey explanation
 * concerns the traveller, so anchoring on it would pull in everything.
 */
export function projectFocusedGraph(
  ldg: LiveDependencyGraph,
  causalPath: readonly CausalPathStep[],
  dependencyContext: readonly CausalPathStep[] = [],
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
      // The affected subject is otherwise redundant once arrival timing takes
      // over as the breakpoint — except a TRAVELLER, which owns the causal
      // spine and must stay connected to it regardless of which node leads.
      if (affectedRef && (!arrivalRef || nodeByRef.get(affectedRef)?.kind === 'TRAVELLER')) pushNode(affectedRef);
      // A related subject is only ever here because the evaluator's own
      // explanation named it as part of this causal step — that is already
      // the "explicit dependency owner" signal. A traveller is no exception:
      // suppressing it disconnected the traveller from the causal spine in
      // arrival-breakpoint cases even when the evaluator explicitly named
      // them as a dependency of that step (e.g. the credential/visit owner).
      for (const related of step.relatedSubjectRefs) {
        const relatedRef = resolveVisibleRef(related);
        if (relatedRef) pushNode(relatedRef);
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

  // First operational breakpoint = arrival timing when the enrichment mapped one
  // (same rule for programme readiness and broken connections), else cause, else
  // affected subject. Onward can still be FAILED without becoming the hero card.
  const firstStep = causalPath[0];
  const firstArrivalRef = firstStep ? arrivalFor(firstStep) : undefined;
  const firstBreakpointRef = firstStep
    ? (firstArrivalRef
      ?? (firstStep.causeSubjectRef ? resolveVisibleRef(firstStep.causeSubjectRef) : undefined)
      ?? resolveVisibleRef(firstStep.subjectRef))
    : undefined;

  if (firstBreakpointRef) pushNode(firstBreakpointRef);
  // Keep FAILED connection endpoints on the causal spine so the onward booking
  // remains visible next to the arrival breakpoint.
  if (firstArrivalRef) {
    for (const edge of ldg.edges) {
      if (edge.fromRef === firstArrivalRef && edge.semanticState === 'FAILED' && edge.kind === 'MUST_HAPPEN_BEFORE') {
        pushNode(edge.toRef);
      }
    }
  }

  // Evaluator-declared dependents of the causal chain (see header). Anchors are
  // frozen here so the pass is exactly one hop.
  const anchorRefs = new Set(causalNodeRefs.filter((ref) => nodeByRef.get(ref)?.kind !== 'TRAVELLER'));
  for (const dependency of dependencyContext) {
    const visible = [dependency.causeSubjectRef, ...dependency.relatedSubjectRefs]
      .filter((ref): ref is string => ref !== undefined)
      .map(resolveVisibleRef)
      .filter((ref): ref is string => ref !== undefined);
    if (!visible.some((ref) => anchorRefs.has(ref))) continue;
    for (const ref of visible) pushNode(ref);
  }

  const causalNodeSet = new Set(causalNodeRefs);
  const causalEdgeIds = ldg.edges
    .filter((edge) => causalNodeSet.has(edge.fromRef) && causalNodeSet.has(edge.toRef))
    .map((edge) => edge.id);

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
