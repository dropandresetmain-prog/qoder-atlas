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
import { adaptTravellerTrip, type TravellerSurfaceView } from '../../app/target/adapters/travellerAdapter.ts';
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

export function renderTravellerSurface(view: TravellerSurfaceView): string {
  const kickerClass = view.kickerTone === 'ok' ? 'k-ok' : view.kickerTone === 'bad' ? 'k-bad' : '';
  return `
<main class="traveller-shell product-traveller-trip" data-test="product-traveller-trip" data-poll-region="traveller-trip">
  <div class="t-topbar">
    <div class="brand"><span class="mark" aria-hidden="true">✦</span>Northstar</div>
  </div>
  <div class="t-hero">
    <div class="scrim" aria-hidden="true"></div>
    <div class="t-hero-text">
      <p class="hero-kicker ${kickerClass}">${escapeHtml(view.kicker)}</p>
      <h1>${escapeHtml(view.headline)}</h1>
      <p>${escapeHtml(view.subline)}</p>
    </div>
  </div>
  ${viabilityBlock(view.remainderViable)}
  ${card('What changed', view.whatChanged, 'traveller-what-changed')}
  ${card('What matters now', view.whatMattersNow, 'traveller-what-matters')}
  ${card('What Northstar is doing', view.whatNorthstarIsDoing, 'traveller-northstar-doing')}
  ${card('What we need from you', view.whatWeNeedFromYou, 'traveller-need-from-me')}
  ${card('Your new plan', view.afterRecovery, 'traveller-after-recovery')}
  <p class="t-foot">Updated ${escapeHtml(formatInstant(view.updatedAt))}<br>Northstar keeps the whole trip working</p>
</main>`;
}

export function renderProductTravellerTrip(view: TravellerTripView): string {
  return renderTravellerSurface(adaptTravellerTrip(view));
}
