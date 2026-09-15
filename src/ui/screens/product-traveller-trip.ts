/**
 * M9 — product traveller trip surface from v2 TravellerTripView read models.
 * Concierge register: plain answers to what changed, what matters, and whether
 * the rest of the trip still works.
 */
import type { TravellerTripView } from '../../contracts/v2/product/readModels.ts';
import { escapeHtml, formatInstant } from '../html.ts';
import { viabilityBlock } from '../components.ts';

const AM_I_OKAY_LABEL: Record<TravellerTripView['amIOkay'], string> = {
  YES: 'You are okay',
  NO: 'You need attention',
  UNKNOWN: 'Still checking',
};

const AM_I_OKAY_TONE: Record<TravellerTripView['amIOkay'], string> = {
  YES: 'ok',
  NO: 'alert',
  UNKNOWN: 'neutral',
};

function optionalCard(title: string, body: string | undefined, testId: string): string {
  if (!body) return '';
  return `
  <div class="t-card" data-test="${testId}">
    <h2>${escapeHtml(title)}</h2>
    <p class="lead">${escapeHtml(body)}</p>
  </div>`;
}

export function renderProductTravellerTrip(view: TravellerTripView): string {
  const heroTone = AM_I_OKAY_TONE[view.amIOkay];
  const kickerClass = heroTone === 'ok' ? 'k-ok' : heroTone === 'alert' ? 'k-bad' : '';
  return `
<main class="traveller-shell product-traveller-trip" data-test="product-traveller-trip">
  <div class="t-topbar">
    <div class="brand"><span class="mark" aria-hidden="true">✦</span>Northstar</div>
    <span class="tt-right">Trip ${escapeHtml(view.tripRef)}</span>
  </div>
  <div class="t-hero">
    <div class="scrim" aria-hidden="true"></div>
    <div class="t-hero-text">
      <p class="hero-kicker ${kickerClass}">${escapeHtml(AM_I_OKAY_LABEL[view.amIOkay])}</p>
      <h1>${escapeHtml(view.whatMattersNow ?? 'Your trip update')}</h1>
      <p>${escapeHtml(view.whatChanged ?? 'We are still confirming what changed.')}</p>
    </div>
  </div>
  ${viabilityBlock(view.doesTheRestWork)}
  ${optionalCard('What changed', view.whatChanged, 'traveller-what-changed')}
  ${optionalCard('What matters now', view.whatMattersNow, 'traveller-what-matters')}
  ${optionalCard('What Northstar is doing', view.whatNorthstarIsDoing, 'traveller-northstar-doing')}
  ${optionalCard('What we need from you', view.whatDoYouNeedFromMe, 'traveller-need-from-me')}
  ${optionalCard('After recovery', view.whatChangedAfterRecovery, 'traveller-after-recovery')}
  <p class="t-foot">Updated ${escapeHtml(formatInstant(view.generatedAt))}</p>
</main>`;
}
