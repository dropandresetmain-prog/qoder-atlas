/**
 * E2 — traveller trip page: mobile-first, plain language, honest states.
 *
 * Answers the traveller journey: am I okay, what changed, what matters,
 * what is being done, what input is needed, and whether the rest of the
 * trip is viable. RECOVERED_WITH_LOSS is shown honestly, never as "all
 * good". Decision buttons are inert markup the integrator (E3) wires to
 * real endpoints; nothing here fabricates a submitted state.
 */
import type {
  ReadModelEnvelope,
  TravellerInputRequest,
  TravellerTripView,
} from '../../contracts/readmodels.ts';
import {
  STATUS_LABEL,
  STATUS_TONE,
  TRAVELLER_HEADLINE,
  TRAVELLER_SUBLINE,
} from '../copy.ts';
import { escapeHtml, formatInstant } from '../html.ts';
import {
  errorPanel,
  iconList,
  loadingPanel,
  toneClass,
  viabilityBlock,
  type IconRow,
} from '../components.ts';

function hero(view: TravellerTripView): string {
  const tone = STATUS_TONE[view.status];
  return `
  <div class="${toneClass(tone, 'hero')}" data-status="${escapeHtml(view.status)}">
    <p class="hero-kicker">${escapeHtml(STATUS_LABEL[view.status])}</p>
    <h1>${escapeHtml(TRAVELLER_HEADLINE[view.status])}</h1>
    <p>${escapeHtml(TRAVELLER_SUBLINE[view.status])}</p>
  </div>`;
}

function inputCard(request: TravellerInputRequest): string {
  const buttons = (request.options ?? [])
    .map(
      (option) =>
        `<button type="submit" name="choice" value="${escapeHtml(option)}">${escapeHtml(option)}</button>`,
    )
    .join('');
  const decided = request.decidedAt
    ? `<p class="choice-note">You answered on ${escapeHtml(formatInstant(request.decidedAt))}. Thank you.</p>`
    : `<form class="choice-form" data-case-id="${escapeHtml(request.caseId)}" method="post">
        ${buttons}
        <p class="choice-note">Nothing is booked until you choose. We will check your choice against the rest of your trip first.</p>
      </form>`;
  return `
  <div class="card t-card" data-ui-section="input-requested">
    <h2>We need your input</h2>
    <p>${escapeHtml(request.prompt)}</p>
    ${decided}
  </div>`;
}

function actionRows(view: TravellerTripView): IconRow[] {
  return view.actionsInProgress.map((action) => ({
    icon: '▶',
    iconClass: 'ic-progress',
    text: action,
  }));
}

/** Traveller body from a loaded view. */
export function renderTravellerTripBody(view: TravellerTripView): string {
  const whatChanged = view.whatChanged
    ? `
  <div class="card t-card">
    <h2>What changed</h2>
    <p>${escapeHtml(view.whatChanged)}</p>
  </div>`
    : '';
  const whatMatters = view.whatMattersNow
    ? `
  <div class="card t-card">
    <h2>What matters now</h2>
    <p>${escapeHtml(view.whatMattersNow)}</p>
  </div>`
    : '';
  const actions =
    view.actionsInProgress.length > 0
      ? `
  <div class="card t-card">
    <h2>What we are doing</h2>
    ${iconList(actionRows(view))}
  </div>`
      : '';
  const inputs = view.inputRequested.map(inputCard).join('');
  const resolution = view.resolutionSummary
    ? `
  <div class="card t-card" data-ui-section="resolution">
    <h2>Your new plan</h2>
    <p>${escapeHtml(view.resolutionSummary)}</p>
  </div>`
    : '';
  return `
<main class="traveller-shell">
  ${hero(view)}
  ${whatChanged}
  ${whatMatters}
  ${inputs}
  ${actions}
  ${resolution}
  ${viabilityBlock(view.remainderViable)}
  <p class="t-foot">Updated ${escapeHtml(formatInstant(view.updatedAt))}</p>
</main>`;
}

/** Full traveller screen from the frozen envelope; honest about loading/error. */
export function renderTravellerTrip(envelope: ReadModelEnvelope<TravellerTripView>): string {
  if (envelope.state === 'LOADING') {
    return `<main class="traveller-shell">${loadingPanel('Checking your trip', 'We are loading the latest confirmed details.')}</main>`;
  }
  if (envelope.state === 'ERROR') {
    return `<main class="traveller-shell">${errorPanel('We can\u2019t show your trip right now', envelope.errorMessage)}</main>`;
  }
  if (!envelope.data) {
    return `<main class="traveller-shell">${errorPanel('We can\u2019t show your trip right now')}</main>`;
  }
  return renderTravellerTripBody(envelope.data);
}
