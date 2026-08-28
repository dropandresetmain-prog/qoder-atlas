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
import type { RecoveryStrategy } from '../operational/strategy.ts';
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
    return `Policy covers missed connections and trip delay (${excess}); the traveller submits the claim — Northstar does not file it`;
  }
  return undefined;
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
}): WholeTripRecoveryPlanView | undefined {
  const replacement = proposedFlight(input.strategy);
  if (!replacement) return undefined;

  const items: WholeTripPlanItemView[] = [];
  const policyRules = input.ruleSets.flatMap((ruleSet) => ruleSet.rules);
  const origin = placeLabel(input.places, replacement.data.originPlaceId);
  const destination = placeLabel(input.places, replacement.data.destinationPlaceId);
  const depart = formatClock(replacement.data.scheduledDeparture?.value);
  const arrive = formatClock(replacement.data.scheduledArrival?.value);

  items.push({
    id: `plan-flight-${input.strategy.id}`,
    category: 'FLIGHT',
    title: 'Next available flight',
    finding: depart && arrive
      ? `${origin} → ${destination}, departing ${depart}, arriving ${arrive}`
      : `${origin} → ${destination} replacement that protects downstream commitments`,
    kind: 'EXECUTABLE',
  });

  const connection = connectionHubAssessment(input.trip, input.ruleSets);
  const hubElement = input.trip.elements.find(
    (element): element is TransportLeg =>
      element.id === connection?.upstreamId && isFlight(element),
  );
  const hubPlaceId = hubElement?.data.destinationPlaceId;
  const hubName = hubPlaceId ? placeLabel(input.places, hubPlaceId) : origin;
  const inboundArrival = hubElement?.data.scheduledArrival?.value;
  const replacementDay = calendarDay(replacement.data.scheduledDeparture?.value);
  const inboundDay = calendarDay(inboundArrival);
  // An overnight follows only from real topology: a failed/missed connection,
  // or a connection whose inbound and replacement legs land on different days.
  if (
    connection &&
    (connection.viability === 'IMPOSSIBLE' || (inboundDay && replacementDay && inboundDay !== replacementDay))
  ) {
    items.push({
      id: `plan-overnight-${input.strategy.id}`,
      category: 'OVERNIGHT',
      title: 'Overnight stay',
      finding: `Timing requires an overnight stay near ${hubName}; Northstar does not book the hotel — the organiser or traveller confirms it with the provider`,
      kind: 'RECOMMENDED',
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
    });
  }

  for (const element of input.trip.elements.filter(isStay)) {
    const checkIn = element.data.checkIn.value;
    const arrival = replacement.data.scheduledArrival?.value;
    if (!arrival || instantMillis(arrival) <= instantMillis(checkIn)) continue;
    const hotel = placeLabel(input.places, element.data.placeId);
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
    });
  }

  const costNotes: string[] = [];
  let knownIncrementalCost: Money | undefined;
  if (input.intent?.spendExposure ?? input.intent?.providerSpend ?? input.strategy.costImpact) {
    knownIncrementalCost =
      input.intent?.spendExposure ?? input.intent?.providerSpend ?? input.strategy.costImpact;
    items.push({
      id: `plan-cost-${input.strategy.id}`,
      category: 'COST',
      title: 'Known cost',
      finding: `${formatMoney(knownIncrementalCost!)} for the replacement flight, chargeable through Northstar`,
      kind: 'EXECUTABLE',
    });
  } else {
    costNotes.push('Flight cost will be confirmed when inventory is priced');
  }
  const hasNonExecutableCost = items.some(
    (item) => item.kind === 'RECOMMENDED' || item.kind === 'MANUAL_FOLLOWUP',
  );
  if (hasNonExecutableCost) {
    costNotes.push(
      'The total covers only what Northstar executes directly; the follow-ups above are priced by their providers',
    );
  }

  return {
    headline: 'One recovery plan across the whole trip',
    items,
    ...(knownIncrementalCost ? { knownIncrementalCost } : {}),
    costNotes,
  };
}
