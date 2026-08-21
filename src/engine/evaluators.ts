/**
 * A2 — deterministic constraint evaluators (FR-05, FR-06, ARCHITECTURE.md §9).
 *
 * Generic primitives only: instant-based time comparison (ADR-023), windows,
 * buffers, duration envelopes, transfer chains, location, accessibility,
 * policy/spend thresholds and objective viability. No universal rules
 * platform; PASS/FAIL/UNKNOWN stay distinct — missing or stale evidence is
 * UNKNOWN, never fabricated PASS.
 */
import {
  instantMillis,
  isFactStale,
  type EntityRef,
  type Fact,
  type IsoDateTime,
} from '../domain/common.ts';
import type { AnchorEvent, Place, Traveller } from '../domain/entities.ts';
import type { TransportLeg, Stay, TripElement } from '../domain/elements.ts';
import type { RuleSet, PolicyRule } from '../domain/rules.ts';
import type { Constraint, ConstraintStatus } from '../domain/constraints.ts';
import type { Trip, TripObjective } from '../domain/trip.ts';
import type { ConstraintEvaluation } from '../contracts/services.ts';

export interface EvaluationContext {
  trip: Trip;
  places: Map<string, Place>;
  ruleSets: Map<string, RuleSet>;
  travellers: Traveller[];
  anchorEvent?: AnchorEvent;
  /** Evaluation instant; deterministic callers pass signal/snapshot time. */
  now: IsoDateTime;
}

/** Deterministic UTC ISO with explicit offset (kept distinct from `Z`). */
function utcIso(millis: number): IsoDateTime {
  return new Date(millis).toISOString().replace('Z', '+00:00');
}

export function isCancelled(element: TripElement): boolean {
  return element.reservationState === 'CANCELLED';
}

function factInstant(fact: Fact<IsoDateTime> | undefined, now: IsoDateTime): { instant: IsoDateTime } | { unknown: string } {
  if (!fact) return { unknown: 'fact absent' };
  if (isFactStale(fact, now)) return { unknown: `fact expired at ${fact.validUntil}` };
  return { instant: fact.value };
}

/** "Where/when does this element start?" — departure / check-in / start. */
export function elementStartInstant(element: TripElement, now: IsoDateTime): IsoDateTime | undefined {
  if (element.elementKind === 'TRANSPORT_LEG') {
    const dep = factInstant(element.data.scheduledDeparture, now);
    return 'instant' in dep ? dep.instant : undefined;
  }
  if (element.elementKind === 'STAY') {
    const checkIn = factInstant(element.data.checkIn, now);
    return 'instant' in checkIn ? checkIn.instant : undefined;
  }
  const starts = factInstant(element.data.startsAt, now);
  return 'instant' in starts ? starts.instant : undefined;
}

/** "When does the traveller arrive at/complete this element?" */
export function elementArrivalInstant(
  element: TripElement,
  ctx: EvaluationContext,
  visited: Set<string> = new Set(),
): IsoDateTime | undefined {
  if (visited.has(element.id)) return undefined;
  visited.add(element.id);
  if (element.elementKind === 'STAY') {
    const checkIn = factInstant(element.data.checkIn, ctx.now);
    return 'instant' in checkIn ? checkIn.instant : undefined;
  }
  if (element.elementKind === 'ENGAGEMENT') {
    const starts = factInstant(element.data.startsAt, ctx.now);
    return 'instant' in starts ? starts.instant : undefined;
  }
  const leg = element;
  const arrival = factInstant(leg.data.scheduledArrival, ctx.now);
  if ('instant' in arrival) return arrival.instant;
  const estimate = leg.data.durationEstimate;
  const departure = factInstant(leg.data.scheduledDeparture, ctx.now);
  if ('instant' in departure && estimate) {
    const minutes = estimate.conservativeMinutes ?? estimate.expectedMinutes;
    return utcIso(instantMillis(departure.instant) + minutes * 60_000);
  }
  if (estimate) {
    // On-demand leg without a schedule: arrival = upstream arrival + envelope.
    const upstream = upstreamArrivalAtPlace(leg.data.originPlaceId, ctx, visited);
    if (!upstream) return undefined;
    const minutes = estimate.conservativeMinutes ?? estimate.expectedMinutes;
    return utcIso(instantMillis(upstream) + minutes * 60_000);
  }
  return undefined;
}

/** Latest known arrival into a place via CONNECTS_TO predecessors. */
function upstreamArrivalAtPlace(
  placeId: string,
  ctx: EvaluationContext,
  visited: Set<string>,
): IsoDateTime | undefined {
  let best: IsoDateTime | undefined;
  for (const relation of ctx.trip.relations) {
    if (relation.kind !== 'CONNECTS_TO' || relation.from.entityType !== 'TRIP_ELEMENT') continue;
    const predecessor = ctx.trip.elements.find((e) => e.id === relation.from.id);
    if (!predecessor) continue;
    // A cancelled/invalid predecessor cannot supply arrival evidence.
    if (isCancelled(predecessor) || predecessor.status === 'INVALID') continue;
    const destination = elementPlaceId(predecessor);
    if (destination !== placeId) continue;
    const arrival = elementArrivalInstant(predecessor, ctx, new Set(visited));
    if (arrival && (!best || instantMillis(arrival) > instantMillis(best))) best = arrival;
  }
  return best;
}

/** The place an element is "at": stay/engagement place or leg destination. */
export function elementPlaceId(element: TripElement): string | undefined {
  if (element.elementKind === 'TRANSPORT_LEG') return element.data.destinationPlaceId;
  if (element.elementKind === 'STAY') return element.data.placeId;
  return element.data.placeId;
}

/** Traveller arrival at a stay via the CONNECTS_TO chain feeding it. */
export function stayArrivalInstant(stay: Stay, ctx: EvaluationContext): IsoDateTime | undefined {
  return upstreamArrivalAtPlace(stay.data.placeId, ctx, new Set());
}

function findElement(ctx: EvaluationContext, ref: EntityRef): TripElement | undefined {
  if (ref.entityType !== 'TRIP_ELEMENT') return undefined;
  return ctx.trip.elements.find((e) => e.id === ref.id);
}

function findObjective(ctx: EvaluationContext, ref: EntityRef): TripObjective | undefined {
  if (ref.entityType !== 'TRIP_OBJECTIVE') return undefined;
  return ctx.trip.objectives.find((o) => o.id === ref.id);
}

function findRule(ctx: EvaluationContext, constraint: Constraint): PolicyRule | undefined {
  const candidates: PolicyRule[] = [];
  if (constraint.ruleSetId) {
    const ruleSet = ctx.ruleSets.get(constraint.ruleSetId);
    if (ruleSet) candidates.push(...ruleSet.rules);
  } else {
    for (const ruleSet of ctx.ruleSets.values()) candidates.push(...ruleSet.rules);
  }
  if (constraint.derivedFromRuleId) {
    const exact = candidates.find((r) => r.id === constraint.derivedFromRuleId);
    if (exact) return exact;
  }
  return undefined;
}

function evaluation(constraint: Constraint, status: ConstraintStatus, evidence: string): ConstraintEvaluation {
  return { constraintId: constraint.id, status, evidence };
}

function numericParam(constraint: Constraint, key: string): number | undefined {
  const value = constraint.parameters?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringParam(constraint: Constraint, key: string): string | undefined {
  const value = constraint.parameters?.[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * TEMPORAL: first ref's arrival must precede second ref's start/deadline by
 * at least `minBufferMinutes`. A cancelled/invalid required subject fails the
 * constraint outright; missing evidence stays UNKNOWN.
 */
function evaluateTemporal(constraint: Constraint, ctx: EvaluationContext): ConstraintEvaluation {
  const firstRef = constraint.refs[0];
  const secondRef = constraint.refs[1];
  if (!firstRef || !secondRef) return evaluation(constraint, 'UNKNOWN', 'TEMPORAL requires two refs');

  const firstElement = findElement(ctx, firstRef);
  if (firstElement && (isCancelled(firstElement) || firstElement.status === 'INVALID')) {
    return evaluation(constraint, 'FAIL', `required subject ${firstRef.id} is cancelled/invalid`);
  }
  const instantA = firstElement ? elementArrivalInstant(firstElement, ctx) : undefined;
  if (!instantA) {
    return evaluation(constraint, 'UNKNOWN', `no arrival evidence for ${firstRef.id}`);
  }

  let instantB: IsoDateTime | undefined;
  const secondElement = findElement(ctx, secondRef);
  if (secondElement) {
    instantB = elementStartInstant(secondElement, ctx.now);
  } else {
    const objective = findObjective(ctx, secondRef);
    if (objective) {
      // Objective deadline: resolve from linked elements other than the subject.
      for (const linkedId of objective.linkedElementIds) {
        if (linkedId === firstRef.id) continue;
        const linked = ctx.trip.elements.find((e) => e.id === linkedId);
        if (linked) {
          instantB = elementStartInstant(linked, ctx.now);
          if (instantB) break;
        }
      }
    }
  }
  if (!instantB) {
    return evaluation(constraint, 'UNKNOWN', `no deadline evidence for ${secondRef.id}`);
  }

  const bufferMinutes = numericParam(constraint, 'minBufferMinutes') ?? 0;
  const gapMinutes = (instantMillis(instantB) - instantMillis(instantA)) / 60_000;
  if (gapMinutes >= bufferMinutes) {
    return evaluation(constraint, 'PASS', `gap ${Math.round(gapMinutes)}min >= required ${bufferMinutes}min`);
  }
  return evaluation(constraint, 'FAIL', `gap ${Math.round(gapMinutes)}min < required ${bufferMinutes}min`);
}

/** SUPPLIER: stay must be reachable before the supplier cutoff (e.g. no-show). */
function evaluateSupplier(constraint: Constraint, ctx: EvaluationContext): ConstraintEvaluation {
  const rule = findRule(ctx, constraint);
  const subject = constraint.refs[0] ? findElement(ctx, constraint.refs[0]) : undefined;
  if (!subject) return evaluation(constraint, 'UNKNOWN', 'subject element not found');
  if (isCancelled(subject)) return evaluation(constraint, 'FAIL', `subject ${subject.id} cancelled`);

  if (rule?.kind === 'NO_SHOW_CUTOFF') {
    if (subject.elementKind !== 'STAY') {
      return evaluation(constraint, 'UNKNOWN', 'NO_SHOW_CUTOFF expects a STAY subject');
    }
    const arrival = stayArrivalInstant(subject, ctx);
    if (!arrival) return evaluation(constraint, 'UNKNOWN', `no arrival chain evidence for ${subject.id}`);
    if (instantMillis(arrival) <= instantMillis(rule.cutoffAt)) {
      return evaluation(constraint, 'PASS', `arrival before cutoff ${rule.cutoffAt}`);
    }
    return evaluation(constraint, 'FAIL', `arrival ${arrival} after cutoff ${rule.cutoffAt}`);
  }
  return evaluation(constraint, 'UNKNOWN', `no deterministic supplier rule resolved for ${constraint.id}`);
}

/** TRANSFER: leg fits between upstream arrival and downstream need. */
function evaluateTransfer(constraint: Constraint, ctx: EvaluationContext): ConstraintEvaluation {
  const subject = constraint.refs[0] ? findElement(ctx, constraint.refs[0]) : undefined;
  if (!subject || subject.elementKind !== 'TRANSPORT_LEG') {
    return evaluation(constraint, 'UNKNOWN', 'TRANSFER requires a transport-leg subject');
  }
  if (isCancelled(subject)) return evaluation(constraint, 'FAIL', `transfer ${subject.id} cancelled`);

  const leg = subject as TransportLeg;
  const upstream = upstreamArrivalAtPlace(leg.data.originPlaceId, ctx, new Set());
  if (!upstream) {
    return evaluation(constraint, 'UNKNOWN', `no upstream arrival evidence at ${leg.data.originPlaceId}`);
  }
  const departure = factInstant(leg.data.scheduledDeparture, ctx.now);
  if ('instant' in departure) {
    const bufferMinutes = numericParam(constraint, 'minBufferMinutes') ?? 0;
    const gapMinutes = (instantMillis(departure.instant) - instantMillis(upstream)) / 60_000;
    if (gapMinutes >= bufferMinutes) {
      return evaluation(constraint, 'PASS', `scheduled departure allows ${Math.round(gapMinutes)}min after upstream arrival`);
    }
    return evaluation(constraint, 'FAIL', `departure only ${Math.round(gapMinutes)}min after upstream arrival`);
  }
  if (subject.reservationState === 'NONE' && subject.flexibility !== 'FIXED') {
    // On-demand flexible leg: schedulable after the known upstream arrival.
    return evaluation(constraint, 'PASS', 'on-demand transfer can be scheduled after upstream arrival');
  }
  return evaluation(constraint, 'UNKNOWN', 'no departure evidence for booked transfer');
}

/** LOCATION: element is at the expected place. */
function evaluateLocation(constraint: Constraint, ctx: EvaluationContext): ConstraintEvaluation {
  const subject = constraint.refs[0] ? findElement(ctx, constraint.refs[0]) : undefined;
  if (!subject) return evaluation(constraint, 'UNKNOWN', 'subject element not found');
  const expectedPlaceId = stringParam(constraint, 'placeId');
  if (expectedPlaceId) {
    const actual = elementPlaceId(subject);
    if (!actual) return evaluation(constraint, 'UNKNOWN', `no place evidence for ${subject.id}`);
    return actual === expectedPlaceId
      ? evaluation(constraint, 'PASS', `${subject.id} at ${actual}`)
      : evaluation(constraint, 'FAIL', `${subject.id} at ${actual}, expected ${expectedPlaceId}`);
  }
  const other = constraint.refs[1] ? findElement(ctx, constraint.refs[1]) : undefined;
  if (other) {
    const a = elementPlaceId(subject);
    const b = elementPlaceId(other);
    if (!a || !b) return evaluation(constraint, 'UNKNOWN', 'place evidence missing for one ref');
    return a === b
      ? evaluation(constraint, 'PASS', 'refs share a place')
      : evaluation(constraint, 'FAIL', `refs at different places (${a} vs ${b})`);
  }
  return evaluation(constraint, 'UNKNOWN', 'LOCATION constraint needs placeId parameter or a second ref');
}

/** ACCESSIBILITY: parameter-driven mode exclusions; never a guess. */
function evaluateAccessibility(constraint: Constraint, ctx: EvaluationContext): ConstraintEvaluation {
  const subject = constraint.refs[0] ? findElement(ctx, constraint.refs[0]) : undefined;
  if (!subject) return evaluation(constraint, 'UNKNOWN', 'subject element not found');
  const modesParam = constraint.parameters?.['unsupportedModes'];
  if (!Array.isArray(modesParam)) {
    return evaluation(constraint, 'UNKNOWN', 'accessibility constraint needs unsupportedModes parameters');
  }
  if (subject.elementKind !== 'TRANSPORT_LEG') {
    return evaluation(constraint, 'UNKNOWN', 'accessibility mode check applies to transport legs');
  }
  const unsupported = modesParam.filter((m): m is string => typeof m === 'string');
  if (unsupported.includes(subject.data.mode)) {
    return evaluation(constraint, 'FAIL', `mode ${subject.data.mode} excluded by accessibility requirement`);
  }
  return evaluation(constraint, 'PASS', `mode ${subject.data.mode} not excluded`);
}

/** POLICY: deadline/window/cutoff rules from the linked rule set. */
function evaluatePolicy(constraint: Constraint, ctx: EvaluationContext): ConstraintEvaluation {
  const rule = findRule(ctx, constraint);
  if (!rule) return evaluation(constraint, 'UNKNOWN', 'no policy rule resolved');
  switch (rule.kind) {
    case 'CANCELLATION_TERMS': {
      if (!rule.refundable) return evaluation(constraint, 'FAIL', 'booking is non-refundable');
      if (!rule.refundDeadline) return evaluation(constraint, 'PASS', 'refundable with no deadline recorded');
      if (instantMillis(ctx.now) <= instantMillis(rule.refundDeadline)) {
        return evaluation(constraint, 'PASS', `refundable until ${rule.refundDeadline}`);
      }
      return evaluation(constraint, 'FAIL', `refund deadline ${rule.refundDeadline} has passed`);
    }
    case 'NO_SHOW_CUTOFF':
      return evaluateSupplier(constraint, ctx);
    case 'TIME_WINDOW': {
      const subject = constraint.refs[0] ? findElement(ctx, constraint.refs[0]) : undefined;
      const instant = subject ? elementStartInstant(subject, ctx.now) : undefined;
      if (!instant) return evaluation(constraint, 'UNKNOWN', 'no timed subject for TIME_WINDOW');
      const afterStart = !rule.windowStart || instantMillis(instant) >= instantMillis(rule.windowStart);
      const beforeEnd = !rule.windowEnd || instantMillis(instant) <= instantMillis(rule.windowEnd);
      return afterStart && beforeEnd
        ? evaluation(constraint, 'PASS', 'within policy time window')
        : evaluation(constraint, 'FAIL', 'outside policy time window');
    }
    default:
      return evaluation(constraint, 'UNKNOWN', `rule kind ${rule.kind} has no deterministic policy evaluator`);
  }
}

/** FINANCIAL: compare a stated amount against a SPEND_LIMIT rule. */
function evaluateFinancial(constraint: Constraint, ctx: EvaluationContext): ConstraintEvaluation {
  const amount = numericParam(constraint, 'amount');
  const currency = stringParam(constraint, 'currency');
  if (amount === undefined || !currency) {
    return evaluation(constraint, 'UNKNOWN', 'FINANCIAL constraint needs amount/currency parameters');
  }
  const rule = findRule(ctx, constraint);
  if (rule?.kind !== 'SPEND_LIMIT') {
    return evaluation(constraint, 'UNKNOWN', 'no SPEND_LIMIT rule resolved');
  }
  if (rule.maxAmount.currency !== currency) {
    return evaluation(constraint, 'UNKNOWN', `currency ${currency} not comparable to limit currency ${rule.maxAmount.currency}`);
  }
  return amount <= rule.maxAmount.amount
    ? evaluation(constraint, 'PASS', `amount ${amount} within limit ${rule.maxAmount.amount}`)
    : evaluation(constraint, 'FAIL', `amount ${amount} exceeds limit ${rule.maxAmount.amount}`);
}

/** OBJECTIVE: viability of an objective from its linked elements. */
function evaluateObjective(constraint: Constraint, ctx: EvaluationContext): ConstraintEvaluation {
  const objective = constraint.refs[0] ? findObjective(ctx, constraint.refs[0]) : undefined;
  if (!objective) return evaluation(constraint, 'UNKNOWN', 'objective not found');
  if (objective.status === 'WAIVED') return evaluation(constraint, 'PASS', 'objective waived');
  if (objective.status === 'ACHIEVED') return evaluation(constraint, 'PASS', 'objective achieved');
  if (objective.linkedElementIds.length === 0) {
    return evaluation(constraint, 'UNKNOWN', 'objective has no linked elements to evaluate');
  }
  let allValid = true;
  for (const linkedId of objective.linkedElementIds) {
    const element = ctx.trip.elements.find((e) => e.id === linkedId);
    if (!element) {
      allValid = false;
      continue;
    }
    if (isCancelled(element) || element.status === 'INVALID') {
      return evaluation(constraint, 'FAIL', `linked element ${linkedId} is cancelled/invalid`);
    }
    if (element.status !== 'VALID') allValid = false;
  }
  return allValid
    ? evaluation(constraint, 'PASS', 'all linked elements valid')
    : evaluation(constraint, 'UNKNOWN', 'linked elements not fully evaluated');
}

/**
 * Evaluate one constraint deterministically. SEMANTIC constraints and unknown
 * kinds return UNKNOWN — the engine never fabricates PASS.
 */
export function evaluateConstraint(constraint: Constraint, ctx: EvaluationContext): ConstraintEvaluation {
  if (constraint.evaluator === 'SEMANTIC') {
    return evaluation(constraint, 'UNKNOWN', 'semantic constraint requires interpreter evidence');
  }
  switch (constraint.kind) {
    case 'TEMPORAL':
      return evaluateTemporal(constraint, ctx);
    case 'SUPPLIER':
      return evaluateSupplier(constraint, ctx);
    case 'TRANSFER':
      return evaluateTransfer(constraint, ctx);
    case 'LOCATION':
      return evaluateLocation(constraint, ctx);
    case 'ACCESSIBILITY':
      return evaluateAccessibility(constraint, ctx);
    case 'POLICY':
      return evaluatePolicy(constraint, ctx);
    case 'FINANCIAL':
      return evaluateFinancial(constraint, ctx);
    case 'OBJECTIVE':
      return evaluateObjective(constraint, ctx);
    case 'ENTRY':
      return evaluation(constraint, 'UNKNOWN', 'entry constraints need authoritative interpreter evidence');
    default:
      return evaluation(constraint, 'UNKNOWN', `no deterministic evaluator for constraint kind`);
  }
}

/** Evaluate every constraint in scope for a trip. */
export function evaluateConstraints(constraints: Constraint[], ctx: EvaluationContext): ConstraintEvaluation[] {
  return constraints.map((constraint) => evaluateConstraint(constraint, ctx));
}
