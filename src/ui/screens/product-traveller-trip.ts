/**
 * Traveller trip surface — the concierge register, served at `/traveller` and
 * `/api/v2/travellers/journeys/:id`.
 *
 * Built from the v2 TravellerTripView through `adaptTravellerTrip`, which maps
 * onto the legacy status vocabulary. It answers, in plain words: am I okay,
 * what changed, what matters, what is Northstar doing, do you need anything
 * from me, does the rest of my trip work. There is deliberately no composer or
 * choice form: the backend exposes neither a message nor a traveller-decision
 * endpoint for this trip, and a control that goes nowhere would be dishonest.
 */
import type { TravellerTripView } from '../../contracts/v2/product/readModels.ts';
import { adaptTravellerTrip, type TravellerItineraryView, type TravellerSurfaceView } from '../../app/target/adapters/travellerAdapter.ts';
import { escapeHtml, formatInstant } from '../html.ts';
import { viabilityBlock } from '../components.ts';

function card(title: string, body: string | undefined, testId: string): string {
  if (!body) return '';
  return `
  <div class="t-card" data-test="${testId}" data-ui-section="${testId}">
    <h2>${escapeHtml(title)}</h2>
    <p class="lead">${escapeHtml(body)}</p>
  </div>`;
}

function qualifiedRange(item: TravellerItineraryView): string {
  const startZone = resolveTimeZone(item.startTimeZone);
  const endZone = resolveTimeZone(item.endTimeZone);
  const start = item.startsAt ? formatZonedInstant(item.startsAt, startZone) : '';
  const end = item.endsAt ? formatZonedInstant(item.endsAt, endZone) : '';
  const times = start && end ? `${start} – ${end}` : start || end;
  const zones = startZone !== endZone ? `${startZone} → ${endZone}` : startZone;
  return [times, zones].filter(Boolean).join(' · ') || 'Time not confirmed';
}

function itineraryRow(item: TravellerItineraryView): string {
  const route = item.originLabel && item.destinationLabel
    ? `${item.originLabel} → ${item.destinationLabel}`
    : item.placeLabel;
  const detail = [route, qualifiedRange(item)].filter(Boolean).join(' · ');
  return `<div class="itin-row" data-test="traveller-itinerary-row">
    <span class="i-ic" aria-hidden="true">•</span>
    <div class="i-main"><div class="i-title">${escapeHtml(item.label)}</div><div class="i-sub">${escapeHtml(detail)}</div></div>
    <span class="i-state s-${item.stateTone}">${escapeHtml(item.stateLabel)}</span>
  </div>`;
}

function itinerarySection(view: TravellerSurfaceView): string {
  if (!view.itinerary || view.itinerary.length === 0) {
    return `
  <div class="t-card" data-ui-section="itinerary" data-test="traveller-itinerary">
    <h2>Your itinerary</h2>
    <p class="lead">No confirmed itinerary details are available yet.</p>
  </div>`;
  }
  return `
  <div class="t-card" data-ui-section="itinerary" data-test="traveller-itinerary">
    <h2>Your itinerary</h2>
    ${view.itinerary.map(itineraryRow).join('')}
  </div>`;
}

function commitmentSection(view: TravellerSurfaceView): string {
  if (!view.commitment) {
    return `
  <div class="commit-card" data-ui-section="commitment" data-test="traveller-commitment">
    <p class="cc-label">Next commitment</p>
    <p class="cc-title">No required commitment is on file yet.</p>
  </div>`;
  }
  const timeZone = resolveTimeZone(view.commitment.timeZone);
  const meta = [
    view.commitment.windowStart ? formatZonedInstant(view.commitment.windowStart, timeZone) : '',
    view.commitment.windowEnd ? formatZonedInstant(view.commitment.windowEnd, timeZone) : '',
    timeZone,
    view.commitment.placeLabel ?? '',
  ].filter(Boolean).join(' · ');
  return `
  <div class="commit-card" data-ui-section="commitment" data-test="traveller-commitment">
    <p class="cc-label">Next commitment</p>
    <p class="cc-title">${escapeHtml(view.commitment.label)}</p>
    ${meta ? `<p class="cc-meta">${escapeHtml(meta)}</p>` : '<p class="cc-meta">Time and place are not confirmed yet.</p>'}
  </div>`;
}

function resolveTimeZone(timeZone: string | undefined): string {
  if (!timeZone?.trim()) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone }).format();
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function formatZonedInstant(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return `${iso} UTC`;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
    timeZoneName: 'short',
  }).format(date);
}

export function renderTravellerSurface(view: TravellerSurfaceView, eventName?: string): string {
  const kickerClass = view.kickerTone === 'ok' ? 'k-ok' : view.kickerTone === 'bad' ? 'k-bad' : '';
  const event = eventName ? `<span class="tt-right">${escapeHtml(eventName)}</span>` : '';
  return `
<main class="traveller-shell product-traveller-trip" data-test="product-traveller-trip" data-poll-region="traveller-trip">
  <div class="t-topbar">
    <div class="brand"><span class="mark" aria-hidden="true">✦</span>Northstar</div>${event}
  </div>
  <div class="t-hero">
    <div class="scrim" aria-hidden="true"></div>
    <div class="t-hero-text">
      <p class="hero-kicker ${kickerClass}">${escapeHtml(view.kicker)}</p>
      <h1>${escapeHtml(view.headline)}</h1>
      <p>${escapeHtml(view.subline)}</p>
    </div>
  </div>
  ${commitmentSection(view)}
  ${itinerarySection(view)}
  ${viabilityBlock(view.remainderViable)}
  ${card('What changed', view.whatChanged, 'traveller-what-changed')}
  ${card('What matters now', view.whatMattersNow, 'traveller-what-matters')}
  ${card('What Northstar is doing', view.whatNorthstarIsDoing, 'traveller-northstar-doing')}
  ${card('What we need from you', view.whatWeNeedFromYou, 'traveller-need-from-me')}
  ${card('Your new plan', view.afterRecovery, 'traveller-after-recovery')}
  <p class="t-foot">Updated ${escapeHtml(formatInstant(view.updatedAt))}<br>Northstar keeps the whole trip working</p>
</main>`;
}

export function renderProductTravellerTrip(view: TravellerTripView, eventName?: string): string {
  return renderTravellerSurface(adaptTravellerTrip(view), eventName);
}
