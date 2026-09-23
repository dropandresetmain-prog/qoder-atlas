/**
 * R2 / CP5.1 — pure mapping of the ordered authoritative `causalPath` onto the
 * visible focused Case graph (`ldg`).
 *
 * The frontend must NOT traverse graph topology to infer causality
 * (FRONTEND_SEMANTIC_CONTRACT FIG-5b). This module is the backend's answer: it
 * maps evaluator-owned cause/affected refs onto the graph's explicit visible-node
 * mappings and producer-owned edge ids, and reports any step that has no visible
 * graph object as an explicit honest gap rather than guessing or dropping it.
 *
 * Presentation roles are kept distinct:
 * - `causalNodeRefs` — true evaluator causal chain (historical cause / failure path)
 * - `recoveryNodeRefs` — PROPOSED recovery branching from the breakpoint
 * - `dependencyContextNodeRefs` — non-failing evaluator dependency context
 * - `ownerContextNodeRefs` — ownership / affected-party context (TRAVELLER)
 *
 * Pure and deterministic: a function of the already-produced `ldg` and the case's
 * `causalPath`. No PostgreSQL, no scenario branch, no topology search for causality.
 */
import type {
  CausalPathStep,
  FocusedGraphView,
  LiveDependencyGraph,
  LdgNode,
} from '../../../contracts/v2/product/readModels.ts';

function isTraveller(node: LdgNode | undefined): boolean {
  return node?.kind === 'TRAVELLER';
}

function isProposed(node: LdgNode | undefined): boolean {
  return node?.authority === 'PROPOSED' || node?.semanticState === 'PROPOSED';
}

/**
 * Map the ordered causal path onto the visible graph.
 *
 * Ordering: `causalPath` is already in evaluator order. Each step's persisted
 * cause is preferred as the operational breakpoint; its affected subject remains
 * separate context. `subjectRefs` provide the explicit backend mapping from
 * canonical refs to presentation nodes. A causal edge is included when BOTH its
 * endpoints are on the causal node set.
 *
 * A TRAVELLER is never placed on the causal spine — it is ownership context.
 * A PROPOSED service that continues from a FAILED connection endpoint is recovery
 * context, not historical cause. Non-failing `dependencyContext` explanations
 * that name an anchor already on the causal/recovery sets join dependency
 * context only (one hop; traveller never anchors).
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
      nodeForSubjectRef.delete(subjectRef);
      ambiguousSubjectRefs.add(subjectRef);
    }
  };
  for (const node of ldg.nodes) {
    registerSubjectRef(node.ref, node.ref);
    for (const subjectRef of node.subjectRefs ?? []) {
      registerSubjectRef(subjectRef, node.ref);
    }
  }
  const resolveVisibleRef = (subjectRef: string): string | undefined => nodeForSubjectRef.get(subjectRef);
  const nodeByRef = new Map(ldg.nodes.map((node) => [node.ref, node]));
  const arrivalFor = (step: CausalPathStep): string | undefined => {
    const refs = [step.causeSubjectRef, ...step.relatedSubjectRefs]
      .filter((ref): ref is string => ref !== undefined)
      .map(resolveVisibleRef)
      .filter((ref): ref is string => ref !== undefined && nodeByRef.get(ref)?.timing !== undefined);
    const unique = [...new Set(refs)];
    return unique.length === 1 ? unique[0] : undefined;
  };

  const causalNodeRefs: string[] = [];
  const recoveryNodeRefs: string[] = [];
  const ownerContextNodeRefs: string[] = [];
  const dependencyContextNodeRefs: string[] = [];
  const seen = new Set<string>();

  const claim = (ref: string, role: 'causal' | 'recovery' | 'owner' | 'dependency'): void => {
    if (!visibleRefs.has(ref) || seen.has(ref)) return;
    seen.add(ref);
    if (role === 'causal') causalNodeRefs.push(ref);
    else if (role === 'recovery') recoveryNodeRefs.push(ref);
    else if (role === 'owner') ownerContextNodeRefs.push(ref);
    else dependencyContextNodeRefs.push(ref);
  };

  const placeExplanationRef = (ref: string): void => {
    const node = nodeByRef.get(ref);
    if (isTraveller(node)) claim(ref, 'owner');
    else if (isProposed(node)) claim(ref, 'recovery');
    else claim(ref, 'causal');
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
          if (edge.fromRef === affectedRef && nodeByRef.get(edge.toRef)?.kind === 'DISRUPTION') {
            placeExplanationRef(edge.toRef);
          }
        }
        for (const edge of ldg.edges) {
          if (edge.toRef === arrivalRef && nodeByRef.get(edge.fromRef)?.kind === 'SERVICE_BOOKING') {
            placeExplanationRef(edge.fromRef);
          }
        }
      }
      placeExplanationRef(breakpointRef);
      if (causeRef) placeExplanationRef(causeRef);
      // Affected subject: TRAVELLER → owner context; otherwise keep on causal
      // unless arrival already leads (redundant journey subject).
      if (affectedRef && (!arrivalRef || isTraveller(nodeByRef.get(affectedRef)))) {
        placeExplanationRef(affectedRef);
      }
      for (const related of step.relatedSubjectRefs) {
        const relatedRef = resolveVisibleRef(related);
        if (relatedRef) placeExplanationRef(relatedRef);
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

  const firstStep = causalPath[0];
  const firstArrivalRef = firstStep ? arrivalFor(firstStep) : undefined;
  const firstBreakpointRef = firstStep
    ? (firstArrivalRef
      ?? (firstStep.causeSubjectRef ? resolveVisibleRef(firstStep.causeSubjectRef) : undefined)
      ?? resolveVisibleRef(firstStep.subjectRef))
    : undefined;

  if (firstBreakpointRef) placeExplanationRef(firstBreakpointRef);

  // FAILED authoritative connection endpoints stay on the causal spine.
  // PROPOSED replacements that continue from the same Arrival are recovery only.
  if (firstArrivalRef) {
    for (const edge of ldg.edges) {
      if (edge.fromRef !== firstArrivalRef || edge.kind !== 'MUST_HAPPEN_BEFORE') continue;
      const target = nodeByRef.get(edge.toRef);
      if (edge.semanticState === 'FAILED') placeExplanationRef(edge.toRef);
      else if (isProposed(target)) claim(edge.toRef, 'recovery');
    }
  }

  // Evaluator-declared non-failing dependents — dependency context, not causal.
  // Anchors are frozen causal/recovery nodes; traveller never anchors.
  const anchorRefs = new Set(
    [...causalNodeRefs, ...recoveryNodeRefs].filter((ref) => !isTraveller(nodeByRef.get(ref))),
  );
  for (const dependency of dependencyContext) {
    const visible = [dependency.causeSubjectRef, ...dependency.relatedSubjectRefs]
      .filter((ref): ref is string => ref !== undefined)
      .map(resolveVisibleRef)
      .filter((ref): ref is string => ref !== undefined);
    if (!visible.some((ref) => anchorRefs.has(ref))) continue;
    for (const ref of visible) {
      if (anchorRefs.has(ref) || seen.has(ref)) continue;
      const node = nodeByRef.get(ref);
      if (isTraveller(node)) claim(ref, 'owner');
      else if (isProposed(node)) claim(ref, 'recovery');
      else claim(ref, 'dependency');
    }
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
    recoveryNodeRefs,
    dependencyContextNodeRefs,
    ownerContextNodeRefs,
    ...(firstBreakpoint ? { firstBreakpoint } : {}),
    unmappedCausalSteps,
  };
}
