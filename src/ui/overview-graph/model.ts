/**
 * Event Overview graph — normalized presentation model (V7.2).
 *
 * "State says what is true; the renderer decides how that truth is drawn."
 * This is the single source of truth for the renderer: entities, relations,
 * per-node display state, per-relation display state and liveness. It is built
 * ONLY from the bounded `eventOverview` projection the backend supplies —
 * nothing is inferred from names, coordinates or raw topology, and there is no
 * branch keyed on a person, flight, route or fixture.
 */
import type {
  EventOverview,
  EventOverviewHealth,
  EventOverviewMembership,
  EventOverviewRelationKind,
  OperatorOverview,
} from '../../contracts/v2/product/readModels.ts';
import { presentOperationalStatus } from '../semantics/adapter.ts';

export type OgHealth = 'green' | 'amber' | 'red' | 'neutral';
export type OgKind = 'dependency' | 'landmark' | 'cohort' | 'traveller';

export interface OgNode {
  readonly id: string;
  readonly kind: OgKind;
  readonly health: OgHealth;
  /** Small uppercase line (kind of thing). */
  readonly type: string;
  readonly title: string;
  readonly meta?: string;
  readonly badge?: string;
  /** Landmark clock time. */
  readonly when?: string;
  readonly dayIndex?: number;
  /** Cohort dot marks, capped by the renderer. */
  readonly marks?: { readonly ready: number; readonly unknown: number; readonly attention: number; readonly total: number };
  /** Rendered de-emphasised because an active change makes it context. */
  readonly dim: boolean;
  /** A cleared traveller settles and fades. */
  readonly faded: boolean;
  /** An unresolved traveller stays visually prominent. */
  readonly attention: boolean;
  readonly caseRef?: string;
}

export interface OgRelation {
  readonly id: string;
  /** Optional for existing manual geometry fixtures; producer relations carry it. */
  readonly kind?: EventOverviewRelationKind;
  readonly from: string;
  readonly to: string;
  readonly health: OgHealth;
  /** Liveness only: green normal pulse, amber slower pulse, red never. */
  readonly live: boolean;
  readonly dim: boolean;
}

export interface OgFocus {
  readonly message: string;
  /** Ids the incident footprint spans (changed dependency, affected travellers, landmarks). */
  readonly incidentIds: readonly string[];
  readonly unresolvedTravellerId?: string;
  readonly unresolvedTravellerLabel?: string;
}

export interface OgDay {
  readonly index: number;
  readonly title: string;
  readonly sub: string;
}

export interface OverviewGraphModel {
  readonly days: readonly OgDay[];
  readonly nodes: readonly OgNode[];
  readonly relations: readonly OgRelation[];
  /** Present only while a shared change is active. */
  readonly focus?: OgFocus;
  readonly active: boolean;
  readonly overflowNote?: string;
}

const HEALTH: Record<EventOverviewHealth, OgHealth> = {
  GREEN: 'green', AMBER: 'amber', RED: 'red', NEUTRAL: 'neutral',
};

const MEMBERSHIP_HEALTH: Record<EventOverviewMembership, OgHealth> = {
  CLEARED: 'green', CHECKING: 'amber', UNRESOLVED: 'red', ATTENTION: 'red',
};

const MEMBERSHIP_BADGE: Record<EventOverviewMembership, string> = {
  CLEARED: 'On track', CHECKING: 'Checking', UNRESOLVED: 'Needs attention', ATTENTION: 'Needs attention',
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function buildOverviewGraphModel(view: OperatorOverview): OverviewGraphModel | null {
  const eo: EventOverview | undefined = view.eventOverview;
  if (!eo) return null;
  if (eo.landmarks.length === 0 && eo.dependencies.length === 0 && eo.cohorts.length === 0 && eo.promotedTravellers.length === 0) {
    return null;
  }

  const blast = eo.blastRadius;
  const active = blast !== undefined;
  const dayById = new Map(eo.days.map((d) => [d.index, d]));
  const landmarkById = new Map(eo.landmarks.map((l) => [l.ref, l]));
  const blastLandmarks = new Set(blast?.landmarkRefs ?? []);
  const promoted = eo.promotedTravellers;

  const nodes: OgNode[] = [];

  for (const dep of eo.dependencies) {
    const isBlast = blast?.dependencyRef === dep.ref;
    const checking = dep.changed && dep.checkingCount > 0;
    const badge = dep.changed
      ? `${plural(dep.travellerCount, 'traveller', 'travellers')} · ${dep.unresolvedCount > 0 || dep.clearedCount > 0
        ? `${dep.clearedCount} cleared · ${dep.unresolvedCount} need attention`
        : checking ? 'checking' : 'changed'}`
      : `${plural(dep.travellerCount, 'traveller', 'travellers')} · ${dep.health === 'GREEN' ? 'healthy' : dep.health === 'RED' ? 'needs attention' : dep.health === 'AMBER' ? 'checking' : 'unconfirmed'}`;
    nodes.push({
      id: dep.ref,
      kind: 'dependency',
      health: HEALTH[dep.health],
      type: /^shared\b/i.test(dep.kindLabel) ? dep.kindLabel : `Shared ${dep.kindLabel.toLowerCase()}`,
      title: dep.label,
      ...(dep.detailLabel ? { meta: dep.detailLabel } : {}),
      badge,
      ...(dep.dayIndex !== undefined ? { dayIndex: dep.dayIndex } : {}),
      dim: active && !isBlast,
      faded: false,
      attention: false,
    });
  }

  for (const lm of eo.landmarks) {
    const day = dayById.get(lm.dayIndex);
    nodes.push({
      id: lm.ref,
      kind: 'landmark',
      health: HEALTH[lm.health],
      type: day ? day.dateLabel : 'Programme',
      title: lm.title,
      ...(lm.timeLabel ? { when: lm.timeLabel } : {}),
      ...(day ? { meta: `Day ${pad2(day.index)}` } : {}),
      ...(lm.affectedCount > 0 ? { badge: `${lm.affectedCount} affected` } : {}),
      dayIndex: lm.dayIndex,
      dim: active && !blastLandmarks.has(lm.ref),
      faded: false,
      attention: false,
    });
  }

  for (const c of eo.cohorts) {
    nodes.push({
      id: c.ref,
      kind: 'cohort',
      health: 'neutral',
      type: 'Travellers',
      title: `${c.label} · ${c.total}`,
      meta: c.attention > 0
        ? `${c.ready} confirmed · ${c.attention} need attention`
        : `${c.ready} confirmed · ${c.unknown} unconfirmed`,
      dayIndex: c.dayIndex,
      marks: { ready: c.ready, unknown: c.unknown, attention: c.attention, total: c.total },
      dim: active,
      faded: false,
      attention: false,
    });
  }

  for (const t of promoted) {
    const landmark = t.landmarkRef ? landmarkById.get(t.landmarkRef) : undefined;
    const health = MEMBERSHIP_HEALTH[t.membership];
    const cleared = t.membership === 'CLEARED';
    const badge = cleared ? MEMBERSHIP_BADGE.CLEARED : t.membership === 'CHECKING'
      ? MEMBERSHIP_BADGE.CHECKING
      : presentOperationalStatus(t.status).label;
    nodes.push({
      id: t.journeyRef,
      kind: 'traveller',
      health,
      type: t.roleLabel,
      title: t.label,
      ...(landmark ? { meta: landmark.title } : {}),
      badge,
      dim: false,
      faded: cleared,
      attention: !cleared && health === 'red',
      ...(t.caseRef ? { caseRef: t.caseRef } : {}),
    });
  }

  const relations: OgRelation[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const add = (rel: OgRelation): void => {
    if (nodeIds.has(rel.from) && nodeIds.has(rel.to)) relations.push(rel);
  };

  // Relations are backend-owned semantic facts. Old projections without them
  // render no invented topology or endpoint-derived condition.
  for (const relation of eo.relations ?? []) {
    const health = HEALTH[relation.health];
    add({
      id: relation.id,
      kind: relation.kind,
      from: relation.fromRef,
      to: relation.toRef,
      health,
      live: health === 'green' || health === 'amber',
      dim: false,
    });
  }

  let focus: OgFocus | undefined;
  if (blast) {
    const dep = eo.dependencies.find((d) => d.ref === blast.dependencyRef);
    const unresolved = promoted.find((t) => t.membership === 'UNRESOLVED' || t.membership === 'ATTENTION');
    const settled = blast.checkingCount === 0;
    const label = dep?.label ?? 'a shared service';
    const message = settled
      ? `${blast.clearedCount} cleared · ${blast.unresolvedCount} still need attention`
      : `${plural(blast.affectedCount, 'traveller', 'travellers')} affected by ${label}`;
    const incidentIds = [
      blast.dependencyRef,
      ...promoted.filter((t) => t.dependencyRef === blast.dependencyRef || t.membership !== 'CLEARED').map((t) => t.journeyRef),
      ...blast.landmarkRefs,
    ].filter((id) => nodeIds.has(id));
    focus = {
      message,
      incidentIds,
      ...(unresolved ? { unresolvedTravellerId: unresolved.journeyRef, unresolvedTravellerLabel: unresolved.label } : {}),
    };
  }

  const days: OgDay[] = eo.days.map((d) => ({ index: d.index, title: `Day ${pad2(d.index)}`, sub: d.dateLabel }));

  return {
    days,
    nodes,
    relations,
    ...(focus ? { focus } : {}),
    active,
    ...(eo.promotedOverflow > 0
      ? { overflowNote: `${plural(eo.promotedOverflow, 'more traveller', 'more travellers')} shown in the groups below` }
      : {}),
  };
}
