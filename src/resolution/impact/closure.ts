/**
 * NORTHSTAR M6 — registered dependency semantics and consequence closure.
 *
 * DATA_STRUCTURE_ARCHITECTURE_CLOSURE.md §5 / F11: ordinary FKs are not graph
 * edges. Only a semantic registered here propagates impact, and each declares
 * the direction in which a change travels. Closure is a pure breadth-first walk
 * over captured edges with a visited set: cycles terminate, order is
 * deterministic, and every reached subject keeps the causal path that reached
 * it first (shortest, then lexicographically smallest) — no graph database,
 * no fixed-point recursion over cached health.
 */
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import type { DependencyEdge, DependencySemantic } from '../../contracts/v2/assessment/explanation.ts';

export type PropagationDirection = 'FROM_TO' | 'BOTH';

export interface DependencySemanticRegistration {
  semantic: DependencySemantic;
  fromKinds: readonly TypedRef['kind'][];
  toKinds: readonly TypedRef['kind'][];
  /** FROM_TO: a change to `from` may affect `to`. BOTH: either side affects the other. */
  direction: PropagationDirection;
  /** What makes this executable, for documentation/evidence (not interpreted). */
  meaning: string;
}

export const DEPENDENCY_REGISTRY: readonly DependencySemanticRegistration[] = [
  { semantic: 'ITEM_OF_JOURNEY', fromKinds: ['JOURNEY_ITEM'], toKinds: ['JOURNEY'], direction: 'FROM_TO', meaning: 'a JourneyItem change changes its Journey itinerary' },
  { semantic: 'JOURNEY_IN_TRIP', fromKinds: ['TRIP'], toKinds: ['JOURNEY'], direction: 'FROM_TO', meaning: 'Trip-level objectives/constraints govern every member Journey; one Journey changing does not fan out to co-travellers (coordination uses GROUP_MEMBERSHIP)' },
  { semantic: 'JOURNEY_OF_TRAVELLER', fromKinds: ['TRAVELLER'], toKinds: ['JOURNEY'], direction: 'FROM_TO', meaning: 'person-scoped facts (credentials, history, unscoped allocations) affect every Journey of that Traveller' },
  { semantic: 'SERVICE_SELECTED_FOR_ITEM', fromKinds: ['TRANSPORT_SERVICE'], toKinds: ['JOURNEY_ITEM'], direction: 'FROM_TO', meaning: 'supplier schedule of the service a transport intent selected' },
  { semantic: 'SERVICE_SUPPLIES_LINE', fromKinds: ['TRANSPORT_SERVICE'], toKinds: ['RESERVATION_LINE'], direction: 'FROM_TO', meaning: 'supplier schedule change affects every line booked on it' },
  { semantic: 'LINE_OF_RESERVATION', fromKinds: ['RESERVATION'], toKinds: ['RESERVATION_LINE'], direction: 'FROM_TO', meaning: 'reservation-level status governs its lines' },
  { semantic: 'LINE_ALLOCATED_TO_TRAVELLER', fromKinds: ['RESERVATION_LINE'], toKinds: ['TRAVELLER'], direction: 'FROM_TO', meaning: 'allocation without a named JourneyItem reaches the person' },
  { semantic: 'ALLOCATION_FULFILS_ITEM', fromKinds: ['RESERVATION_LINE'], toKinds: ['JOURNEY_ITEM'], direction: 'FROM_TO', meaning: 'allocation naming a JourneyItem reaches exactly that item' },
  { semantic: 'ENTITLEMENT_COVERS_LINE', fromKinds: ['SERVICE_ENTITLEMENT'], toKinds: ['RESERVATION_LINE'], direction: 'FROM_TO', meaning: 'ticket/voucher status affects the covered line' },
  { semantic: 'PROGRAMME_ITEM_OF_PROGRAMME', fromKinds: ['PROGRAMME'], toKinds: ['PROGRAMME_ITEM'], direction: 'FROM_TO', meaning: 'programme lifecycle governs its items' },
  { semantic: 'PARTICIPATION_IN_PROGRAMME_ITEM', fromKinds: ['PROGRAMME_ITEM'], toKinds: ['PARTICIPATION'], direction: 'FROM_TO', meaning: 'canonical schedule/place/status of the item a person participates in' },
  { semantic: 'PARTICIPATION_OF_TRAVELLER', fromKinds: ['PARTICIPATION'], toKinds: ['TRAVELLER'], direction: 'FROM_TO', meaning: 'participation obligations reach the participant' },
  { semantic: 'ENGAGEMENT_REFLECTS_PARTICIPATION', fromKinds: ['PARTICIPATION'], toKinds: ['JOURNEY_ITEM'], direction: 'FROM_TO', meaning: 'an engagement intent that reflects the participation' },
  { semantic: 'RESOURCE_ASSIGNED_TO_ACTIVITY', fromKinds: ['RESOURCE'], toKinds: ['PROGRAMME_ITEM', 'JOURNEY_ITEM'], direction: 'BOTH', meaning: 'shared resource capacity couples every activity assigned to it' },
  { semantic: 'RESOURCE_USED_BY_LINE', fromKinds: ['RESOURCE'], toKinds: ['RESERVATION_LINE'], direction: 'BOTH', meaning: 'shared resource capacity couples every line using it' },
  { semantic: 'PLACE_LOCATES_ACTIVITY', fromKinds: ['PLACE'], toKinds: ['PROGRAMME_ITEM', 'JOURNEY_ITEM', 'TRANSPORT_SERVICE'], direction: 'FROM_TO', meaning: 'operational place facts affect activities located there' },
  { semantic: 'JURISDICTION_CONTAINS_PLACE', fromKinds: ['JURISDICTION'], toKinds: ['PLACE'], direction: 'FROM_TO', meaning: 'jurisdiction-scoped requirements reach places inside it (resolved by area membership/PostGIS in the snapshot)' },
  { semantic: 'VISIT_TO_JURISDICTION', fromKinds: ['JURISDICTION'], toKinds: ['JOURNEY'], direction: 'FROM_TO', meaning: 'an intended visit exposes the Journey to that jurisdiction' },
  { semantic: 'INFORMATION_SCOPED_TO_JURISDICTION', fromKinds: ['INFORMATION_VERSION'], toKinds: ['JURISDICTION'], direction: 'FROM_TO', meaning: 'publication applicability scope' },
  { semantic: 'INFORMATION_SCOPED_TO_AREA', fromKinds: ['INFORMATION_VERSION'], toKinds: ['PLACE'], direction: 'FROM_TO', meaning: 'publication applicability resolved to places inside the scoped area edition' },
  { semantic: 'INFORMATION_SCOPED_TO_SUBJECT', fromKinds: ['INFORMATION_VERSION'], toKinds: ['TRAVELLER', 'JOURNEY', 'TRIP', 'TRANSPORT_SERVICE', 'PROGRAMME_ITEM', 'ORGANISATION'], direction: 'FROM_TO', meaning: 'publication scoped to a named subject' },
  { semantic: 'RULE_ASSIGNED_TO_SUBJECT', fromKinds: ['RULE_SET'], toKinds: ['TRAVELLER', 'JOURNEY', 'TRIP', 'COORDINATION_GROUP', 'PROGRAMME'], direction: 'FROM_TO', meaning: 'rule assignment names the subject' },
  { semantic: 'RULE_ASSIGNED_TO_ORGANISATION', fromKinds: ['RULE_SET'], toKinds: ['ORGANISATION'], direction: 'FROM_TO', meaning: 'organisation policy assignment' },
  { semantic: 'RULE_ASSIGNED_TO_JURISDICTION', fromKinds: ['RULE_SET'], toKinds: ['JURISDICTION'], direction: 'FROM_TO', meaning: 'jurisdiction-scoped requirement assignment' },
  { semantic: 'PUBLICATION_OF_RULE_SET_VERSION', fromKinds: ['INFORMATION_VERSION'], toKinds: ['RULE_SET'], direction: 'FROM_TO', meaning: 'regulatory publication of an exact rule edition' },
  { semantic: 'SUPPORT_REQUIRED_BY_TRAVELLER', fromKinds: ['JOURNEY'], toKinds: ['TRAVELLER'], direction: 'FROM_TO', meaning: 'a dependant\'s Journey change affects every eligible or assigned supporter' },
  { semantic: 'SUPPORT_PROVIDED_BY_TRAVELLER', fromKinds: ['JOURNEY'], toKinds: ['TRAVELLER'], direction: 'FROM_TO', meaning: 'a supporter\'s Journey change affects the traveller they are eligible or assigned to support' },
  { semantic: 'GROUP_MEMBERSHIP', fromKinds: ['COORDINATION_GROUP'], toKinds: ['JOURNEY'], direction: 'BOTH', meaning: 'group constraints couple member Journeys' },
  { semantic: 'CREDENTIAL_SELECTED_FOR_JOURNEY', fromKinds: ['TRAVELLER'], toKinds: ['JOURNEY'], direction: 'FROM_TO', meaning: 'selected credential editions (traveller-owned) affect the selecting Journey' },
  { semantic: 'ORGANISATION_RESPONSIBLE_FOR', fromKinds: ['ORGANISATION'], toKinds: ['TRIP', 'JOURNEY'], direction: 'FROM_TO', meaning: 'organisation policy and currency context reach the Trips/Journeys it is business context or responsible party for' },
  { semantic: 'OBJECTIVE_OF_OWNER', fromKinds: ['OBJECTIVE'], toKinds: ['TRIP', 'JOURNEY', 'COORDINATION_GROUP', 'PROGRAMME'], direction: 'FROM_TO', meaning: 'an objective or its disposition governs its owner' },
  { semantic: 'CONSTRAINT_OF_OWNER', fromKinds: ['CONSTRAINT_DEFINITION'], toKinds: ['TRIP', 'JOURNEY', 'COORDINATION_GROUP', 'PROGRAMME', 'TRAVELLER', 'PROGRAMME_ITEM', 'ORGANISATION', 'RESOURCE'], direction: 'FROM_TO', meaning: 'a constraint governs its owner' },
  { semantic: 'EXPLICIT_CONNECTS_TO', fromKinds: ['JOURNEY_ITEM', 'TRANSPORT_SERVICE', 'PROGRAMME_ITEM', 'RESERVATION_LINE'], toKinds: ['JOURNEY_ITEM', 'TRANSPORT_SERVICE', 'PROGRAMME_ITEM', 'RESERVATION_LINE'], direction: 'FROM_TO', meaning: 'registered upstream-to-downstream operational connection (dependencies.CONNECTS_TO)' },
  { semantic: 'EXPLICIT_REQUIRES', fromKinds: ['JOURNEY_ITEM', 'TRANSPORT_SERVICE', 'PROGRAMME_ITEM', 'RESERVATION_LINE', 'PARTICIPATION'], toKinds: ['JOURNEY_ITEM', 'TRANSPORT_SERVICE', 'PROGRAMME_ITEM', 'RESERVATION_LINE', 'PARTICIPATION'], direction: 'FROM_TO', meaning: 'a dependencies.REQUIRES row emitted in impact orientation: from = prerequisite, to = dependent (the stored row is dependent -> prerequisite); executable only through its constraint predicate' },
];

const REGISTRY_BY_SEMANTIC = new Map(DEPENDENCY_REGISTRY.map((entry) => [entry.semantic, entry]));

export function refKey(ref: TypedRef): string {
  return `${ref.kind}:${ref.id}`;
}

function compareEdges(a: DependencyEdge, b: DependencyEdge): number {
  return (
    a.semantic.localeCompare(b.semantic) ||
    refKey(a.from).localeCompare(refKey(b.from)) ||
    refKey(a.to).localeCompare(refKey(b.to))
  );
}

/** Validates an edge against the registry: an unregistered or kind-mismatched edge never propagates. */
export function registeredEdgeIssue(edge: DependencyEdge): string | undefined {
  const registration = REGISTRY_BY_SEMANTIC.get(edge.semantic);
  if (!registration) return `unregistered dependency semantic ${edge.semantic}`;
  if (!registration.fromKinds.includes(edge.from.kind)) return `${edge.semantic} cannot start at ${edge.from.kind}`;
  if (!registration.toKinds.includes(edge.to.kind)) return `${edge.semantic} cannot end at ${edge.to.kind}`;
  return undefined;
}

export interface ReachedSubject {
  subject: TypedRef;
  /** The cause this subject was first reached from. */
  cause: TypedRef;
  depth: number;
  /** Edges oriented cause -> subject (a BOTH edge traversed backwards is reported with from/to swapped). */
  path: DependencyEdge[];
}

export interface ClosureResult {
  reached: ReachedSubject[];
  /** Edges rejected by the registry (reported, never traversed). */
  rejectedEdges: { edge: DependencyEdge; issue: string }[];
  /** True when maxDepth stopped the walk before the frontier was exhausted. */
  truncated: boolean;
}

/**
 * Deterministic breadth-first consequence closure from `causes` over `edges`.
 * Terminates on cycles (visited set), independent of input edge order.
 */
export function computeClosure(params: { causes: TypedRef[]; edges: DependencyEdge[]; maxDepth?: number }): ClosureResult {
  const maxDepth = params.maxDepth ?? 32;
  const rejectedEdges: ClosureResult['rejectedEdges'] = [];
  const adjacency = new Map<string, { edge: DependencyEdge; next: TypedRef; oriented: DependencyEdge }[]>();
  const add = (key: string, entry: { edge: DependencyEdge; next: TypedRef; oriented: DependencyEdge }) => {
    const list = adjacency.get(key) ?? [];
    list.push(entry);
    adjacency.set(key, list);
  };
  const seenEdges = new Set<string>();
  for (const edge of [...params.edges].sort(compareEdges)) {
    const issue = registeredEdgeIssue(edge);
    if (issue) {
      rejectedEdges.push({ edge, issue });
      continue;
    }
    const edgeKey = `${edge.semantic}|${refKey(edge.from)}|${refKey(edge.to)}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    add(refKey(edge.from), { edge, next: edge.to, oriented: edge });
    if (REGISTRY_BY_SEMANTIC.get(edge.semantic)?.direction === 'BOTH') {
      add(refKey(edge.to), { edge, next: edge.from, oriented: { semantic: edge.semantic, from: edge.to, to: edge.from } });
    }
  }

  const reached = new Map<string, ReachedSubject>();
  const causes = [...params.causes].sort((a, b) => refKey(a).localeCompare(refKey(b)));
  let frontier: ReachedSubject[] = [];
  for (const cause of causes) {
    const key = refKey(cause);
    if (reached.has(key)) continue;
    const start = { subject: cause, cause, depth: 0, path: [] };
    reached.set(key, start);
    frontier.push(start);
  }
  let truncated = false;
  while (frontier.length > 0) {
    const nextFrontier: ReachedSubject[] = [];
    for (const current of frontier) {
      const neighbours = adjacency.get(refKey(current.subject)) ?? [];
      for (const { next, oriented } of neighbours) {
        const key = refKey(next);
        if (reached.has(key)) continue;
        if (current.depth + 1 > maxDepth) {
          truncated = true;
          continue;
        }
        const entry: ReachedSubject = { subject: next, cause: current.cause, depth: current.depth + 1, path: [...current.path, oriented] };
        reached.set(key, entry);
        nextFrontier.push(entry);
      }
    }
    frontier = nextFrontier.sort((a, b) => refKey(a.subject).localeCompare(refKey(b.subject)));
  }
  const ordered = [...reached.values()].sort((a, b) => a.depth - b.depth || refKey(a.subject).localeCompare(refKey(b.subject)));
  return { reached: ordered, rejectedEdges, truncated };
}
