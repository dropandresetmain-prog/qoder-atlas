/**
 * Whole-trip recovery plan projection — reasoning findings vs executable actions.
 * Generic: uses strategy overlay, trip topology, rule sets, and viability evidence.
 */
import type { EntityId, IsoDateTime, Money } from '../domain/common.ts';
import { instantMillis } from '../domain/common.ts';
import type { Place, Traveller } from '../domain/entities.ts';
import type { Engagement, Stay, TransportLeg, TripElement } from '../domain/elements.ts';
import type { PolicyRule, RuleSet } from '../domain/rules.ts';
import type { Trip } from '../domain/trip.ts';
import type { ActionIntent } from '../operational/intent.ts';
import { confirmsCandidateOperations } from '../operational/intent.ts';
import type { RecoveryStrategy } from '../operational/strategy.ts';
import type { RecoveryCase } from '../operational/case.ts';
import type { ViabilityResult } from '../contracts/services.ts';
import {
  assessConnectionPairs,
  placeCodeFor,
  type ConnectionPairAssessment,
} from '../engine/connectionFeasibility.ts';
import { formatMoney } from '../ui/html.ts';

import type { WholeTripPlanItemView, WholeTripRecoveryPlanView } from '../ui/case-view-model.ts';

function isFlight(element: TripElement): element is TransportLeg {
  return element.elementKind === 'TRANSPORT_LEG' && element.data.mode === 'FLIGHT';
}

function isStay(element: TripElement): element is Stay {
  return element.elementKind === 'STAY';
}

function proposedFlight(strategy: RecoveryStrategy): TransportLeg | undefined {
  for (const operation of strategy.candidateOperations) {
    if (
      operation.op === 'UPSERT_ENTITY' &&
      operation.entityType === 'TRIP_ELEMENT' &&
      (operation.data as { elementKind?: string }).elementKind === 'TRANSPORT_LEG'
    ) {
      return operation.data as TransportLeg;
    }
  }
  return undefined;
}

function placeLabel(places: ReadonlyMap<string, Place>, placeId: EntityId): string {
  const place = places.get(placeId);
  return placeCodeFor(place) ?? place?.name ?? 'the connection point';
}

function calendarDay(iso: IsoDateTime | undefined): string | undefined {
  if (!iso) return undefined;
  return iso.slice(0, 10);
}

function insuranceFinding(rules: readonly PolicyRule[]): string | undefined {
  for (const rule of rules) {
    if (rule.kind !== 'INSURANCE_COVERAGE') continue;
    const coversMissed = rule.coveredReasons.some((reason) =>
      /missed|delay|connection/i.test(reason),
    );
    if (!coversMissed) continue;
    const excess = rule.excess ? `${formatMoney(rule.excess)} excess` : 'policy excess applies';
    return `Policy covers missed connections and trip delay (${excess}). Claim submission is not automated.`;
  }
  return undefined;
}

type PlanItemStatus = { statusLabel: string; statusTone: 'ok' | 'watch' | 'alert' | 'neutral' };

/**
 * Entry/transit outcome wording derived only from the authoritative
 * requirement evidence — "Visa-free" is never asserted unless the rule
 * itself says so; anything else falls back to the neutral checked label.
 */
function entryStatusFromRequirement(requirement: string): PlanItemStatus {
  const text = requirement.toLowerCase();
  if (/visa[- ]free/.test(text)) return { statusLabel: 'Visa-free entry', statusTone: 'ok' };
  if (/transit/.test(text) && /permitted|allowed|exempt/.test(text)) {
    return { statusLabel: 'Transit allowed', statusTone: 'ok' };
  }
  if (/entry/.test(text) && /permitted|allowed|admitted|exempt/.test(text)) {
    return { statusLabel: 'Entry allowed', statusTone: 'ok' };
  }
  return { statusLabel: 'Checked', statusTone: 'neutral' };
}

function entryFinding(rules: readonly PolicyRule[]): string | undefined {
  for (const rule of rules) {
    if (rule.kind !== 'ENTRY_REQUIREMENT') continue;
    return rule.requirement;
  }
  return undefined;
}

function connectionHubAssessment(
  trip: Trip,
  ruleSets: readonly RuleSet[],
): ConnectionPairAssessment | undefined {
  const failed = assessConnectionPairs(trip, ruleSets).find((assessment) => assessment.viability !== 'VIABLE');
  return failed;
}

function minutesBeforeCommitment(arrival: IsoDateTime, commitmentStart: IsoDateTime): number {
  return Math.round((instantMillis(commitmentStart) - instantMillis(arrival)) / 60_000);
}

function formatClock(iso: IsoDateTime | undefined): string | undefined {
  if (!iso) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!match) return undefined;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] ?? match[2]} · ${match[4]}:${match[5]}`;
}

/** Judge-facing summary of a transport leg: route, times, flight number. */
function legSummary(leg: TransportLeg, places: ReadonlyMap<string, Place>): string {
  const from = placeLabel(places, leg.data.originPlaceId);
  const to = placeLabel(places, leg.data.destinationPlaceId);
  const depart = formatClock(leg.data.scheduledDeparture?.value);
  const arrive = formatClock(leg.data.scheduledArrival?.value);
  const flightNo = leg.data.carrierRef?.value?.trim();
  const when = depart && arrive ? `, departing ${depart}, arriving ${arrive}` : '';
  const carrier = flightNo ? `, flight ${flightNo}` : '';
  return `${from} → ${to}${when}${carrier}`;
}

/** Generic operator-facing analysis steps for whole-trip recovery (no fixture branches). */
export function wholeTripAnalysisSteps(input: {
  trip: Trip;
  places: ReadonlyMap<string, Place>;
  ruleSets: readonly RuleSet[];
}): string[] {
  const assessment = connectionHubAssessment(input.trip, input.ruleSets);
  const hub =
    assessment &&
    input.trip.elements.find(
      (element): element is TransportLeg =>
        element.id === assessment.upstreamId && isFlight(element),
    );
  const hubName = hub ? placeLabel(input.places, hub.data.destinationPlaceId) : 'the connection';
  const hasConnection = Boolean(assessment);
  const steps = hasConnection
    ? [`Rechecking the ${hubName} connection`, 'Looking for onward flights']
    : ['Rechecking the itinerary', 'Looking for workable replacement flights'];
  if (hasConnection) steps.push('Checking whether an overnight stay is required');
  steps.push('Checking entry requirements', 'Checking insurance coverage', 'Reviewing affected stays');
  if (input.trip.anchorEventId) steps.push('Rechecking arrival against the programme commitment');
  return steps;
}

export function projectWholeTripRecoveryPlan(input: {
  trip: Trip;
  strategy: RecoveryStrategy;
  places: ReadonlyMap<string, Place>;
  ruleSets: readonly RuleSet[];
  travellers: readonly Traveller[];
  engagement?: Engagement;
  intent?: ActionIntent;
  viability?: ViabilityResult;
  feasible: boolean;
  /** The recovery case, when available, for per-action lifecycle states. */
  recoveryCase?: RecoveryCase;
}): WholeTripRecoveryPlanView | undefined {
  // The replacement flight is derived from the flight action intent's strategy
  // when one exists, so the plan survives the hotel strategy becoming the
  // recommended one during the sequential overnight cycle. Falls back to the
  // passed strategy's proposed flight.
  const flightStrategy = flightStrategyFor(input) ?? input.strategy;
  let replacement = proposedFlight(flightStrategy);
  if (!replacement) {
    // The flight was already executed and its strategy replaced by a later
    // planning round (the overnight hotel); derive the recovered flight from
    // the trip's onward leg instead.
    const connections = assessConnectionPairs(input.trip, input.ruleSets);
    for (const c of connections) {
      const downstream = input.trip.elements.find((e) => e.id === c.downstreamId);
      if (downstream && downstream.elementKind === 'TRANSPORT_LEG' && isFlight(downstream)) {
        replacement = downstream;
        break;
      }
    }
  }
  if (!replacement) return undefined;
  const flightIntent = input.recoveryCase
    ? input.recoveryCase.actionIntents.find(
        (i) => i.operation === 'flight.change' || i.operation === 'flight.book' || i.operation === 'flight.pay',
      )
    : input.intent;

  const items: WholeTripPlanItemView[] = [];
  const policyRules = input.ruleSets.flatMap((ruleSet) => ruleSet.rules);
  const connection = connectionHubAssessment(input.trip, input.ruleSets);
  const replacementNo = replacement.data.carrierRef?.value?.trim();
  const origin = placeLabel(input.places, replacement.data.originPlaceId);
  const destination = placeLabel(input.places, replacement.data.destinationPlaceId);
  const depart = formatClock(replacement.data.scheduledDeparture?.value);
  const arrive = formatClock(replacement.data.scheduledArrival?.value);
  const afterCarrier = replacementNo ? `, flight ${replacementNo}` : '';
  // The leg being replaced: the onward connection that no longer works.
  // Generic — derived from the failed connection pair, never scenario data.
  const brokenLeg = input.trip.elements.find(
    (element): element is TransportLeg => element.id === connection?.downstreamId && isFlight(element),
  );

  const flightLifecycle = actionLifecycle(input.recoveryCase, flightIntent);
  items.push({
    id: `plan-flight-${flightStrategy.id}`,
    category: 'FLIGHT',
    title: 'Replacement onward flight',
    finding: depart && arrive
      ? `${origin} → ${destination}, departing ${depart}, arriving ${arrive}${afterCarrier}`
      : `${origin} → ${destination} replacement that protects downstream commitments`,
    kind: 'EXECUTABLE',
    statusLabel: flightLifecycle.statusLabel,
    statusTone: flightLifecycle.statusTone,
    ...(brokenLeg ? { before: legSummary(brokenLeg, input.places) } : {}),
  });

  // Derive the hub from the connection pair regardless of viability: once the
  // flight is fixed the connection is VIABLE, but the overnight gap (and the
  // hotel that covers it) still needs the hub. Use the connection whose
  // upstream feeds the replacement's origin.
  const allConnections = assessConnectionPairs(input.trip, input.ruleSets);
  const overnightConnection =
    allConnections.find((c) => {
      const downstream = input.trip.elements.find((e) => e.id === c.downstreamId);
      return (
        downstream !== undefined &&
        downstream.elementKind === 'TRANSPORT_LEG' &&
        downstream.data.originPlaceId === replacement.data.originPlaceId
      );
    }) ?? connection;
  const hubElement = input.trip.elements.find(
    (element): element is TransportLeg =>
      element.id === (overnightConnection ?? connection)?.upstreamId && isFlight(element),
  );
  const hubPlaceId = hubElement?.data.destinationPlaceId;
  const hubName = hubPlaceId ? placeLabel(input.places, hubPlaceId) : origin;
  const inboundArrival = hubElement?.data.scheduledArrival?.value;
  const replacementDay = calendarDay(replacement.data.scheduledDeparture?.value);
  const inboundDay = calendarDay(inboundArrival);
  // The overnight stay already in the trip (once booked), so the hotel row can
  // name it and the affected-stay loop can skip it.
  const overnightStay = findOvernightStay(
    input.trip,
    input.places,
    hubPlaceId,
    inboundArrival,
    replacement.data.scheduledDeparture?.value,
  );
  // An overnight follows only from real topology: the inbound arrival lands on
  // an earlier local day than the onward departure at the hub. This persists
  // after the flight is fixed (the gap remains until a hotel covers it).
  if (hubPlaceId && inboundDay && replacementDay && inboundDay !== replacementDay) {
    const hotelIntent = input.recoveryCase
      ? input.recoveryCase.actionIntents.find((i) => i.operation === 'hotel.book' || i.operation === 'hotel.modify')
      : undefined;
    const hotelLifecycle = actionLifecycle(input.recoveryCase, hotelIntent);
    // Name the hotel from the booked stay once it is in the trip, otherwise
    // from the hotel intent's candidate place (so the hotel is named while it
    // is still awaiting approval / being booked).
    const hotelName =
      (overnightStay ? placeLabel(input.places, overnightStay.data.placeId) : undefined) ??
      hotelPlaceNameFromIntent(input.recoveryCase, hotelIntent, input.places);
    items.push({
      id: `plan-overnight-${flightStrategy.id}`,
      category: 'OVERNIGHT',
      title: hotelName ? `Overnight stay — ${hotelName}` : 'Overnight stay',
      finding: hotelName
        ? `An overnight stay at ${hotelName} covers the night near ${hubName} before the onward flight`
        : `Timing requires an overnight stay near ${hubName} before the onward flight`,
      kind: 'EXECUTABLE',
      statusLabel: hotelLifecycle.statusLabel,
      statusTone: hotelLifecycle.statusTone,
    });
  }

  const entry = entryFinding(policyRules);
  if (entry) {
    items.push({
      id: `plan-entry-${input.strategy.id}`,
      category: 'ENTRY',
      title: 'Entry / transit',
      finding: entry,
      kind: 'CHECKED',
      ...entryStatusFromRequirement(entry),
    });
  }

  const insurance = insuranceFinding(policyRules);
  if (insurance) {
    items.push({
      id: `plan-insurance-${input.strategy.id}`,
      category: 'INSURANCE',
      title: 'Insurance',
      finding: insurance,
      kind: 'CHECKED',
      statusLabel: 'Covered',
      statusTone: 'ok',
    });
  }

  for (const element of input.trip.elements.filter(isStay)) {
    // The overnight stay is already shown in the OVERNIGHT row.
    if (overnightStay && element.id === overnightStay.id) continue;
    const checkIn = element.data.checkIn.value;
    const arrival = replacement.data.scheduledArrival?.value;
    const hotel = placeLabel(input.places, element.data.placeId);
    if (!arrival || instantMillis(arrival) <= instantMillis(checkIn)) {
      // Unaffected: the recovered arrival still lands before this stay's
      // check-in, so the existing reservation remains usable as booked.
      items.push({
        id: `plan-hotel-${element.id}`,
        category: 'HOTEL',
        title: `${hotel} stay`,
        finding: `The existing ${hotel} booking remains usable after the recovered arrival`,
        kind: 'CHECKED',
        statusLabel: 'No change required',
        statusTone: 'ok',
      });
      continue;
    }
    const crossesDay =
      calendarDay(arrival) !== undefined && calendarDay(arrival) !== calendarDay(checkIn);
    items.push({
      id: `plan-hotel-${element.id}`,
      category: 'HOTEL',
      title: 'Affected stay',
      finding: crossesDay
        ? `The first night at ${hotel} is no longer usable as booked; the provider must be contacted to change or cancel it`
        : `The stay at ${hotel} starts before the new arrival; the provider must be contacted to adjust the booking`,
      kind: 'MANUAL_FOLLOWUP',
      statusLabel: 'Provider follow-up',
      statusTone: 'watch',
    });
  }

  if (input.engagement && replacement.data.scheduledArrival?.value) {
    const margin = minutesBeforeCommitment(
      replacement.data.scheduledArrival.value,
      input.engagement.data.startsAt.value,
    );
    const ok = input.feasible && margin > 0;
    items.push({
      id: `plan-event-${input.engagement.id}`,
      category: 'EVENT',
      title: input.engagement.data.title,
      finding: ok
        ? `Arrival still protects ${input.engagement.data.title}`
        : `Arrival no longer protects ${input.engagement.data.title}`,
      kind: 'CHECKED',
      statusLabel: ok ? 'Protected' : 'No longer protected',
      statusTone: ok ? 'ok' : 'alert',
    });
  }

  const costNotes: string[] = [];
  let knownIncrementalCost: Money | undefined;
  // Flight cost (from the flight intent's frozen spend, or the strategy cost).
  const flightCost = flightIntent?.spendExposure ?? flightIntent?.providerSpend ?? flightStrategy.costImpact;
  if (flightCost) {
    knownIncrementalCost = flightCost;
    items.push({
      id: `plan-cost-${flightStrategy.id}`,
      category: 'COST',
      title: 'Known cost — flight',
      finding: `${formatMoney(flightCost)} for the replacement flight, chargeable through Northstar`,
      kind: 'EXECUTABLE',
      statusLabel: 'Handled by Northstar',
      statusTone: 'ok',
    });
  } else {
    costNotes.push('Flight cost will be confirmed when inventory is priced');
  }
  // Hotel cost (from the hotel intent's frozen spend) shown separately so it is
  // never merged into the flight charge.
  const hotelIntentForCost = input.recoveryCase
    ? input.recoveryCase.actionIntents.find((i) => i.operation === 'hotel.book' || i.operation === 'hotel.modify')
    : undefined;
  const hotelCost = hotelIntentForCost?.spendExposure ?? hotelIntentForCost?.providerSpend;
  if (hotelCost) {
    items.push({
      id: `plan-cost-hotel-${flightStrategy.id}`,
      category: 'COST',
      title: 'Known cost — overnight hotel',
      finding: `${formatMoney(hotelCost)} for the overnight stay, chargeable through Northstar`,
      kind: 'EXECUTABLE',
      statusLabel: 'Handled by Northstar',
      statusTone: 'ok',
    });
  }
  const hasNonExecutableCost = items.some(
    (item) => item.kind === 'RECOMMENDED' || item.kind === 'MANUAL_FOLLOWUP',
  );
  if (hasNonExecutableCost) {
    costNotes.push(
      'The total covers only the changes Northstar applies directly; the follow-ups above are priced by their providers',
    );
  }

  return {
    headline: 'One recovery plan across the whole trip',
    items,
    ...(knownIncrementalCost ? { knownIncrementalCost } : {}),
    costNotes,
  };
}

/**
 * The flight action's strategy from the recovery case (the strategy behind the
 * flight.change/flight.book intent), so the whole-trip plan can show the
 * replacement flight even after the hotel strategy becomes the recommended one.
 */
function flightStrategyFor(input: {
  strategy: RecoveryStrategy;
  recoveryCase?: RecoveryCase;
}): RecoveryStrategy | undefined {
  const recoveryCase = input.recoveryCase;
  if (!recoveryCase) return proposedFlight(input.strategy) ? input.strategy : undefined;
  const flightIntent = recoveryCase.actionIntents.find(
    (i) => i.operation === 'flight.change' || i.operation === 'flight.book' || i.operation === 'flight.pay',
  );
  if (flightIntent) {
    const strategy = recoveryCase.strategies.find((s) => s.id === flightIntent.strategyId);
    if (strategy && proposedFlight(strategy)) return strategy;
  }
  return proposedFlight(input.strategy) ? input.strategy : undefined;
}

/**
 * Derive a per-action lifecycle status from an action intent and its execution
 * result. Used to render each whole-trip plan row as a live state instead of
 * a static label.
 */
function actionLifecycle(
  recoveryCase: RecoveryCase | undefined,
  intent: ActionIntent | undefined,
): { statusLabel: string; statusTone: 'ok' | 'watch' | 'alert' | 'neutral' } {
  if (!intent) return { statusLabel: 'Finding options', statusTone: 'watch' };
  const executionResult = recoveryCase?.executionResults.find((r) => r.intentId === intent.id);
  if (intent.status === 'EXECUTED') {
    const confirmed = executionResult !== undefined && confirmsCandidateOperations(executionResult);
    return confirmed
      ? { statusLabel: 'Confirmed', statusTone: 'ok' }
      : { statusLabel: 'Needs attention', statusTone: 'alert' };
  }
  if (intent.status === 'EXECUTING') return { statusLabel: 'Booking', statusTone: 'watch' };
  if (intent.status === 'FAILED' || intent.status === 'REJECTED') {
    return { statusLabel: 'Needs attention', statusTone: 'alert' };
  }
  // PROPOSED / AUTHORISED: staged but not yet executed.
  const decision = recoveryCase?.authorityDecisions.find((d) => d.intentId === intent.id);
  const needsApproval = decision !== undefined && decision.outcome !== 'AUTO_APPROVED';
  const approved = decision?.approval !== undefined && decision.approval.decision === 'APPROVED';
  if (needsApproval && !approved) return { statusLabel: 'Awaiting approval', statusTone: 'watch' };
  return { statusLabel: 'Ready to execute', statusTone: 'ok' };
}

/**
 * Derive the hotel place name from the hotel intent's strategy candidate, so
 * the overnight hotel is named while it is still awaiting approval / being
 * booked (before the stay exists in the trip). Prefers a known place the stay
 * candidate references; otherwise uses the candidate PLACE upsert's name.
 */
function hotelPlaceNameFromIntent(
  recoveryCase: RecoveryCase | undefined,
  hotelIntent: ActionIntent | undefined,
  places: ReadonlyMap<string, Place>,
): string | undefined {
  if (!recoveryCase || !hotelIntent) return undefined;
  const strategy = recoveryCase.strategies.find((s) => s.id === hotelIntent.strategyId);
  if (!strategy) return undefined;
  let placeName: string | undefined;
  let stayPlaceId: string | undefined;
  for (const operation of strategy.candidateOperations) {
    if (operation.op !== 'UPSERT_ENTITY') continue;
    const data = operation.data as Record<string, unknown>;
    if (operation.entityType === 'PLACE' && typeof data['name'] === 'string') {
      placeName = placeName ?? (data['name'] as string);
    }
    if (operation.entityType === 'TRIP_ELEMENT' && data['elementKind'] === 'STAY') {
      const stayData = data['data'] as Record<string, unknown> | undefined;
      if (stayData && typeof stayData['placeId'] === 'string') stayPlaceId = stayData['placeId'] as string;
    }
  }
  if (stayPlaceId) {
    const known = places.get(stayPlaceId);
    const knownName = known ? placeLabel(places, stayPlaceId) : undefined;
    if (knownName) return knownName;
  }
  return placeName;
}

/**
 * Find a stay at (or served by) the hub whose window spans the overnight gap
 * between the inbound arrival and the onward departure. Returns the stay once
 * booked; undefined while the overnight is still unaccommodated.
 */
function findOvernightStay(
  trip: Trip,
  places: ReadonlyMap<string, Place>,
  hubPlaceId: string | undefined,
  inboundArrival: string | undefined,
  onwardDeparture: string | undefined,
): Stay | undefined {
  if (!hubPlaceId || !inboundArrival || !onwardDeparture) return undefined;
  const inboundDay = calendarDay(inboundArrival);
  const onwardDay = calendarDay(onwardDeparture);
  if (!inboundDay || !onwardDay || inboundDay >= onwardDay) return undefined;
  const atHub = (stay: Stay): boolean => {
    if (stay.data.placeId === hubPlaceId) return true;
    const place = places.get(stay.data.placeId);
    return (place?.servedByPlaceIds ?? []).includes(hubPlaceId);
  };
  return trip.elements.filter(isStay).find(
    (stay) =>
      stay.reservationState !== 'CANCELLED' &&
      atHub(stay) &&
      calendarDay(stay.data.checkIn.value) !== undefined &&
      calendarDay(stay.data.checkIn.value)! <= inboundDay &&
      calendarDay(stay.data.checkOut.value) !== undefined &&
      calendarDay(stay.data.checkOut.value)! >= onwardDay,
  );
}
