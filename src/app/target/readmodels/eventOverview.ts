import type { EventOverview, EventOverviewHealth, EventOverviewMembership } from '../../../contracts/v2/product/readModels.ts';
import type { EventOverviewSourceFacts, OperatorItemFact, OperatorPopulationFact } from './types.ts';

/**
 * Pure, deterministic derivation of the bounded Event Overview projection
 * from raw authoritative rows plus the already-computed population. No I/O;
 * nothing here keys on names, routes or fixture ids — everything is data
 * driven. See docs/design/event-overview-graph/README.md.
 */

const MAX_DAYS = 14;
const MAX_LANDMARKS = 42;
const LANDMARKS_PER_DAY = 4;
const MAX_DEPENDENCIES = 12;
const MAX_PROMOTED = 16;
const MAX_BLAST_LANDMARKS = 12;
const MAX_RELATIONS = 256;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const KIND_LABELS = { AIR: 'Flight', RAIL: 'Train', ROAD: 'Road transfer', SEA: 'Sailing' } as const;
const ROLE_LABELS = { REQUIRED: 'Required attendee', OPTIONAL: 'Optional attendee', INFORMED: 'Informed' } as const;

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function dateLabel(localDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!m) return localDate;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function membershipOf(p: OperatorPopulationFact): Exclude<EventOverviewMembership, 'ATTENTION'> {
  if (p.evaluation !== 'CURRENT') return 'CHECKING';
  if (p.status === 'READY') return 'CLEARED';
  // A tight connection is at risk, not a definitive break. Definitive failure stays unresolved/red.
  if (p.status === 'AT_RISK' || p.status === 'RECOVERING') return 'CHECKING';
  return 'UNRESOLVED';
}

interface ServiceGroup {
  ref: string;
  kindLabel: string;
  label: string;
  detailLabel?: string;
  arrivalLocalDate?: string;
  arrivalLocalTime?: string;
  publishedArrivalLocalTime?: string;
  changed: boolean;
  health: EventOverviewHealth;
  journeys: string[];
}

export function buildEventOverview(input: {
  source: EventOverviewSourceFacts;
  population: readonly OperatorPopulationFact[];
  items: readonly OperatorItemFact[];
}): EventOverview {
  const { source, population } = input;
  const popByRef = new Map(population.map((p) => [p.journeyRef, p]));

  // ---- days ----
  const dateSet = [...new Set(source.programmeItems.map((i) => i.localDate))].sort(cmp).slice(0, MAX_DAYS);
  const dayIndexOf = new Map(dateSet.map((d, i) => [d, i + 1]));
  const days = dateSet.map((localDate, i) => ({ index: i + 1, localDate, dateLabel: dateLabel(localDate) }));

  const items = source.programmeItems
    .filter((i) => dayIndexOf.has(i.localDate))
    .slice()
    .sort((a, b) => cmp(a.windowStart, b.windowStart) || cmp(a.itemRef, b.itemRef));
  const itemByRef = new Map(items.map((i) => [i.itemRef, i]));

  // Required participants per item (distinct journeys, population members only).
  const requiredByItem = new Map<string, Set<string>>();
  const partsByJourney = new Map<string, { itemRef: string; obligation: string }[]>();
  const directCommitmentHealthByItem = new Map(source.programmeItems.map((item) => [item.itemRef, item.health ?? 'NEUTRAL'] as const));
  const participantCommitmentHealth = new Map<string, EventOverviewHealth>();
  for (const p of source.participations) {
    if (!popByRef.has(p.journeyRef)) continue;
    const list = partsByJourney.get(p.journeyRef) ?? [];
    list.push({ itemRef: p.itemRef, obligation: p.obligation });
    partsByJourney.set(p.journeyRef, list);
    if (p.commitmentHealth) {
      participantCommitmentHealth.set(`${p.journeyRef}:${p.itemRef}`, p.commitmentHealth);
    }
    if (p.obligation === 'REQUIRED' && itemByRef.has(p.itemRef)) {
      const set = requiredByItem.get(p.itemRef) ?? new Set<string>();
      set.add(p.journeyRef);
      requiredByItem.set(p.itemRef, set);
    }
  }
  const requiredCount = (ref: string): number => requiredByItem.get(ref)?.size ?? 0;
  const earliestRequiredItem = (journeyRef: string): string | undefined => {
    let best: (typeof items)[number] | undefined;
    for (const p of partsByJourney.get(journeyRef) ?? []) {
      if (p.obligation !== 'REQUIRED') continue;
      const it = itemByRef.get(p.itemRef);
      if (!it) continue;
      if (!best || cmp(it.windowStart, best.windowStart) < 0 || (it.windowStart === best.windowStart && cmp(it.itemRef, best.itemRef) < 0)) best = it;
    }
    return best?.itemRef;
  };

  // ---- service groups (shared concentration) ----
  const groups = new Map<string, ServiceGroup>();
  for (const row of source.journeyServices) {
    if (!popByRef.has(row.journeyRef)) continue;
    let g = groups.get(row.serviceRef);
    if (!g) {
      g = {
        ref: row.serviceRef,
        kindLabel: KIND_LABELS[row.mode],
        label: row.operator,
        ...(row.arrivalLocalDate ? { arrivalLocalDate: row.arrivalLocalDate } : {}),
        ...(row.arrivalLocalTime ? { arrivalLocalTime: row.arrivalLocalTime } : {}),
        ...(row.publishedArrivalLocalTime ? { publishedArrivalLocalTime: row.publishedArrivalLocalTime } : {}),
        changed: row.changed,
        // A timing difference evidences change, never health. Unchanged service
        // timing has no independent condition verdict and stays neutral.
        health: row.changed ? 'AMBER' : 'NEUTRAL',
        journeys: [],
      };
      groups.set(row.serviceRef, g);
    }
    if (!g.journeys.includes(row.journeyRef)) g.journeys.push(row.journeyRef);
  }
  const commitmentHealth = (itemRef: string, journeyRefs: readonly string[]): EventOverviewHealth => {
    const direct = directCommitmentHealthByItem.get(itemRef) ?? 'NEUTRAL';
    const evidence = journeyRefs.map((journeyRef) => participantCommitmentHealth.get(`${journeyRef}:${itemRef}`) ?? 'NEUTRAL');
    if (evidence.some((health) => health === 'RED')) return 'RED';
    if (direct === 'RED') return 'RED';
    if (evidence.some((health) => health === 'AMBER')) return 'AMBER';
    if (direct === 'AMBER') return 'AMBER';
    if (direct === 'GREEN') return 'GREEN';
    if (journeyRefs.length === 0) return 'NEUTRAL';
    if (evidence.every((health) => health === 'GREEN')) return 'GREEN';
    return 'NEUTRAL';
  };
  for (const row of source.journeyDependencies ?? []) {
    if (!popByRef.has(row.journeyRef)) continue;
    let g = groups.get(row.dependencyRef);
    if (!g) {
      g = {
        ref: row.dependencyRef,
        kindLabel: row.kindLabel,
        label: row.label,
        ...(row.detailLabel ? { detailLabel: row.detailLabel } : {}),
        changed: row.changed,
        health: row.health ?? 'NEUTRAL',
        journeys: [],
      };
      groups.set(row.dependencyRef, g);
    }
    if (!g.journeys.includes(row.journeyRef)) g.journeys.push(row.journeyRef);
  }
  const selected = [...groups.values()]
    .filter((g) => g.changed || g.journeys.length >= 2)
    .sort((a, b) => Number(b.changed) - Number(a.changed) || b.journeys.length - a.journeys.length || cmp(a.ref, b.ref))
    .slice(0, MAX_DEPENDENCIES);
  for (const g of selected) g.journeys.sort(cmp);

  const blastGroup = selected.filter((g) => g.changed)[0];
  const blastMembers = new Map<string, Exclude<EventOverviewMembership, 'ATTENTION'>>();
  for (const ref of blastGroup?.journeys ?? []) {
    const p = popByRef.get(ref);
    if (p) blastMembers.set(ref, membershipOf(p));
  }

  // ---- promotion ----
  const candidates: { p: OperatorPopulationFact; membership: EventOverviewMembership }[] = [];
  for (const p of population) {
    const m = blastMembers.get(p.journeyRef);
    if (m) candidates.push({ p, membership: m });
    else if (p.caseRef && p.status !== 'READY') candidates.push({ p, membership: 'ATTENTION' });
  }
  const rank = (m: EventOverviewMembership): number => (m === 'UNRESOLVED' || m === 'ATTENTION' ? 0 : m === 'CHECKING' ? 1 : 2);
  candidates.sort((a, b) => rank(a.membership) - rank(b.membership) || cmp(a.p.travellerLabel, b.p.travellerLabel) || cmp(a.p.journeyRef, b.p.journeyRef));
  const promoted = candidates.slice(0, MAX_PROMOTED);
  const promotedOverflow = candidates.length - promoted.length;
  const promotedRefs = new Set(promoted.map((c) => c.p.journeyRef));

  // ---- landmarks ----
  const forced = new Set<string>();
  for (const c of promoted) {
    for (const p of partsByJourney.get(c.p.journeyRef) ?? []) {
      if (p.obligation === 'REQUIRED' && itemByRef.has(p.itemRef)) forced.add(p.itemRef);
    }
  }
  const byRank = (a: (typeof items)[number], b: (typeof items)[number]) =>
    requiredCount(b.itemRef) - requiredCount(a.itemRef) || cmp(a.windowStart, b.windowStart) || cmp(a.itemRef, b.itemRef);
  const chosenSet = new Set<string>();
  const take = (ref: string): void => {
    if (chosenSet.size < MAX_LANDMARKS) chosenSet.add(ref);
  };
  for (const it of items.filter((i) => forced.has(i.itemRef)).sort(byRank)) take(it.itemRef);
  for (const d of dateSet) {
    items.filter((i) => i.localDate === d).sort(byRank).slice(0, LANDMARKS_PER_DAY).forEach((i) => take(i.itemRef));
  }

  const nonCleared = (ref: string): boolean => {
    const m = blastMembers.get(ref);
    return m === 'CHECKING' || m === 'UNRESOLVED';
  };
  const landmarks = items
    .filter((i) => chosenSet.has(i.itemRef))
    .map((i) => {
      const participants = [...(requiredByItem.get(i.itemRef) ?? [])].sort(cmp);
      const health = commitmentHealth(i.itemRef, participants);
      // Population status and blast membership are not commitment evidence.
      // Count them as operational attention only; never derive the landmark's
      // semantic health from an unrelated Journey assessment.
      const affected = new Set(participants.filter((ref) => nonCleared(ref)));
      return {
        ref: i.itemRef,
        dayIndex: dayIndexOf.get(i.localDate)!,
        title: i.title,
        ...(i.localTime ? { timeLabel: i.localTime } : {}),
        health,
        participantCount: participants.length,
        affectedCount: affected.size,
      };
    });
  const landmarkWindow = new Map(items.map((i) => [i.itemRef, i.windowStart]));
  const bestLandmark = (score: (ref: string) => number, only?: (l: (typeof landmarks)[number]) => boolean): string | undefined => {
    let best: { ref: string; score: number } | undefined;
    for (const l of landmarks) {
      if (only && !only(l)) continue;
      const s = score(l.ref);
      if (s <= 0) continue;
      if (!best || s > best.score || (s === best.score && cmp(landmarkWindow.get(l.ref)!, landmarkWindow.get(best.ref)!) < 0)) best = { ref: l.ref, score: s };
    }
    return best?.ref;
  };

  // ---- dependencies ----
  const dependencies = selected.map((g) => {
    const counts = { CLEARED: 0, CHECKING: 0, UNRESOLVED: 0 };
    if (g.changed) {
      for (const ref of g.journeys) {
        const p = popByRef.get(ref);
        if (p) counts[membershipOf(p)] += 1;
      }
    }
    const feeds = bestLandmark((lref) => g.journeys.filter((j) => requiredByItem.get(lref)?.has(j)).length);
    const dayIndex = g.arrivalLocalDate ? dayIndexOf.get(g.arrivalLocalDate) : undefined;
    const detail = g.arrivalLocalTime
      ? g.changed && g.publishedArrivalLocalTime && g.publishedArrivalLocalTime !== g.arrivalLocalTime
        ? `Arrives ${g.arrivalLocalTime} · was ${g.publishedArrivalLocalTime}`
        : `Arrives ${g.arrivalLocalTime}`
      : undefined;
    const detailLabel = detail ?? g.detailLabel;
    return {
      ref: g.ref,
      kindLabel: g.kindLabel,
      label: g.label,
      ...(detailLabel ? { detailLabel } : {}),
      ...(dayIndex ? { dayIndex } : {}),
      health: g.health,
      changed: g.changed,
      travellerCount: g.journeys.length,
      clearedCount: counts.CLEARED,
      checkingCount: counts.CHECKING,
      unresolvedCount: counts.UNRESOLVED,
      ...(feeds ? { feedsLandmarkRef: feeds } : {}),
    };
  });

  // ---- blast radius ----
  let blastRadius: EventOverview['blastRadius'];
  if (blastGroup) {
    const dep = dependencies.find((d) => d.ref === blastGroup.ref)!;
    const affectedLandmarks = landmarks
      .filter((l) => [...(requiredByItem.get(l.ref) ?? [])].some((j) => nonCleared(j)))
      .slice(0, MAX_BLAST_LANDMARKS)
      .map((l) => l.ref);
    blastRadius = {
      dependencyRef: dep.ref,
      affectedCount: blastMembers.size,
      clearedCount: dep.clearedCount,
      checkingCount: dep.checkingCount,
      unresolvedCount: dep.unresolvedCount,
      landmarkRefs: affectedLandmarks,
    };
  }

  // ---- promoted travellers ----
  const promotedTravellers = promoted.map(({ p, membership }) => {
    const landmarkRef = earliestRequiredItem(p.journeyRef);
    return {
      journeyRef: p.journeyRef,
      label: p.travellerLabel,
      roleLabel: ROLE_LABELS[p.obligation],
      status: p.status,
      membership,
      ...(blastMembers.has(p.journeyRef) && blastGroup ? { dependencyRef: blastGroup.ref } : {}),
      ...(landmarkRef && chosenSet.has(landmarkRef) ? { landmarkRef } : {}),
      ...(p.caseRef ? { caseRef: p.caseRef } : {}),
    };
  });

  // ---- cohorts ----
  const buckets = new Map<number | undefined, OperatorPopulationFact[]>();
  for (const p of population) {
    if (promotedRefs.has(p.journeyRef)) continue;
    let earliest: (typeof items)[number] | undefined;
    for (const part of partsByJourney.get(p.journeyRef) ?? []) {
      const it = itemByRef.get(part.itemRef);
      if (it && (!earliest || cmp(it.windowStart, earliest.windowStart) < 0)) earliest = it;
    }
    const idx = days.length === 0 ? undefined : earliest ? dayIndexOf.get(earliest.localDate)! : undefined;
    const list = buckets.get(idx) ?? [];
    list.push(p);
    buckets.set(idx, list);
  }
  const cohorts = [...buckets.keys()].sort((a, b) => (a ?? 0) - (b ?? 0)).slice(0, 15).map((idx) => {
    const members = buckets.get(idx)!;
    const two = idx === undefined ? undefined : String(idx).padStart(2, '0');
    const landmarkRef = idx === undefined ? undefined : bestLandmark((lref) => requiredCount(lref), (l) => l.dayIndex === idx);
    return {
      ref: idx === undefined ? 'COHORT:unassigned' : `COHORT:day-${two}`,
      ...(idx === undefined ? {} : { dayIndex: idx }),
      label: idx === undefined ? 'Unassigned travellers' : `Day ${two} cohort`,
      total: members.length,
      ready: members.filter((m) => m.status === 'READY').length,
      unknown: members.filter((m) => m.status === 'UNKNOWN').length,
      attention: members.filter((m) => m.status === 'DISRUPTED').length,
      ...(landmarkRef ? { landmarkRef } : {}),
    };
  });

  // ---- explicit presentation relations ----
  // Relation condition is supplied here from the evidence that establishes the
  // relation. Endpoint health and browser topology never colour a connector.
  const relations: NonNullable<EventOverview['relations']> = [];
  const relationIds = new Set<string>();
  const addRelation = (relation: NonNullable<EventOverview['relations']>[number]): void => {
    if (relations.length < MAX_RELATIONS && !relationIds.has(relation.id)) {
      relationIds.add(relation.id);
      relations.push(relation);
    }
  };
  for (const dependency of dependencies) {
    if (!dependency.feedsLandmarkRef) continue;
    const group = selected.find((candidate) => candidate.ref === dependency.ref);
    const members = (group?.journeys ?? []).filter((journeyRef) => requiredByItem.get(dependency.feedsLandmarkRef!)?.has(journeyRef));
    addRelation({
      id: `DEPENDENCY_TO_COMMITMENT:${dependency.ref}:${dependency.feedsLandmarkRef}`,
      kind: 'DEPENDENCY_TO_COMMITMENT',
      fromRef: dependency.ref,
      toRef: dependency.feedsLandmarkRef,
      health: commitmentHealth(dependency.feedsLandmarkRef, members),
    });
  }
  const dependencyRelationHealth = (dependencyRef: string, journeyRef: string): EventOverviewHealth => {
    const dependency = selected.find((candidate) => candidate.ref === dependencyRef);
    // A connector may use the dependency's own condition. It must never reuse
    // a programme consequence merely because that journey has both facts.
    if (dependency?.health && dependency.health !== 'NEUTRAL') return dependency.health;
    if (blastGroup?.ref !== dependencyRef) return 'NEUTRAL';
    // A changed shared dependency explicitly makes this member part of the
    // blast group, so its presented cleared/checking/unresolved outcome is
    // meaningful for this relationship even when the dependency has no
    // independent condition verdict.
    const membership = blastMembers.get(journeyRef);
    return membership === 'CLEARED' ? 'GREEN'
      : membership === 'CHECKING' ? 'AMBER'
        : membership === 'UNRESOLVED' ? 'RED'
          : 'NEUTRAL';
  };
  for (const traveller of promotedTravellers) {
    if (traveller.dependencyRef) {
      addRelation({
        id: `DEPENDENCY_TO_TRAVELLER:${traveller.dependencyRef}:${traveller.journeyRef}`,
        kind: 'DEPENDENCY_TO_TRAVELLER',
        fromRef: traveller.dependencyRef,
        toRef: traveller.journeyRef,
        health: dependencyRelationHealth(traveller.dependencyRef, traveller.journeyRef),
      });
    }
    if (traveller.landmarkRef) {
      addRelation({
        id: `TRAVELLER_TO_COMMITMENT:${traveller.journeyRef}:${traveller.landmarkRef}`,
        kind: 'TRAVELLER_TO_COMMITMENT',
        fromRef: traveller.journeyRef,
        toRef: traveller.landmarkRef,
        health: participantCommitmentHealth.get(`${traveller.journeyRef}:${traveller.landmarkRef}`) ?? 'NEUTRAL',
      });
    }
  }
  for (const cohort of cohorts) {
    if (!cohort.landmarkRef) continue;
    addRelation({
      id: `COHORT_TO_COMMITMENT:${cohort.ref}:${cohort.landmarkRef}`,
      kind: 'COHORT_TO_COMMITMENT',
      fromRef: cohort.ref,
      toRef: cohort.landmarkRef,
      health: 'NEUTRAL',
    });
  }

  return {
    days,
    landmarks,
    dependencies,
    cohorts,
    promotedTravellers,
    promotedOverflow,
    ...(blastRadius ? { blastRadius } : {}),
    relations,
  };
}
