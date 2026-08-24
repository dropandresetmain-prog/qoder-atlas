/**
 * E2 — traveller trip page: mobile-first concierge register (DESIGN.md §1).
 *
 * Answers the traveller journey: am I okay, what changed, what matters,
 * what is being done, what input is needed, and whether the rest of the
 * trip is viable. RECOVERED_WITH_LOSS is shown honestly, never as "all
 * good". Decision buttons are inert markup the integrator (E3) wires to
 * real endpoints; nothing here fabricates a submitted state.
 *
 * An optional TravellerPresentation adds destination photography, the ink
 * commitment card, and rich option cards. Without it, every screen still
 * renders completely in plain language — presentation never invents facts.
 */
import type {
  ReadModelEnvelope,
  TravellerInputRequest,
  TravellerTripView,
} from '../../contracts/readmodels.ts';
import {
  STATUS_LABEL,
  TRAVELLER_HEADLINE,
  TRAVELLER_SUBLINE,
} from '../copy.ts';
import { escapeHtml, formatInstant } from '../html.ts';
import {
  errorPanel,
  iconList,
  loadingPanel,
  viabilityBlock,
  type IconRow,
} from '../components.ts';
import type {
  TravellerOptionDetail,
  TravellerPresentation,
} from '../traveller-presentation.ts';

function hero(view: TravellerTripView, presentation?: TravellerPresentation): string {
  const image = presentation?.heroImageUrl
    ? `<img src="${escapeHtml(presentation.heroImageUrl)}" alt="${escapeHtml(presentation.heroImageAlt ?? '')}" loading="lazy">`
    : '';
  return `
  <div class="t-hero" data-status="${escapeHtml(view.status)}">
    ${image}
    <div class="scrim" aria-hidden="true"></div>
    <div class="t-hero-text">
      <p class="hero-kicker">${escapeHtml(STATUS_LABEL[view.status])}</p>
      <h1>${escapeHtml(TRAVELLER_HEADLINE[view.status])}</h1>
      <p>${escapeHtml(TRAVELLER_SUBLINE[view.status])}</p>
    </div>
  </div>`;
}

/** The ink commitment card — the thing that must not be missed. */
function commitmentCard(presentation?: TravellerPresentation): string {
  const card = presentation?.commitmentCard;
  if (!card) return '';
  const meta = card.meta ? `<p class="cc-meta">${escapeHtml(card.meta)}</p>` : '';
  return `
  <div class="commit-card" data-ui-section="commitment">
    <p class="cc-label">✦ ${escapeHtml(card.label)}</p>
    <p class="cc-title">${escapeHtml(card.title)}</p>
    ${meta}
  </div>`;
}

/** One choice as a rich option card when presentation detail exists. */
function richOptionButton(option: string, detail: TravellerOptionDetail): string {
  const edgeClass = detail.commitmentEffect === 'keeps' ? 'opt-reco' : detail.commitmentEffect === 'breaks' ? 'opt-miss' : '';
  const flag = detail.flag
    ? `<span class="opt-flag ${detail.commitmentEffect === 'breaks' ? 'f-bad' : 'f-ok'}">${escapeHtml(detail.flag)}</span>`
    : '';
  const route = detail.route
    ? `<div class="opt-route"><span>${escapeHtml(detail.route.from)}</span><span class="arr">→</span><span>${escapeHtml(detail.route.to)}</span><span class="opt-stops">${escapeHtml(detail.route.stops)}</span></div>`
    : '';
  const noteClass = detail.commitmentEffect === 'breaks' ? 'n-bad' : detail.commitmentEffect === 'keeps' ? 'n-ok' : '';
  const note = detail.note ? `<div class="opt-note ${noteClass}">${escapeHtml(detail.note)}</div>` : '';
  return `<button type="submit" name="choice" value="${escapeHtml(option)}" class="optcard ${edgeClass}">
    <div class="opt-head"><span class="opt-title">${escapeHtml(option)}</span>${flag}</div>
    ${route}
    ${note}
  </button>`;
}

function inputCard(request: TravellerInputRequest, presentation?: TravellerPresentation): string {
  const buttons = (request.options ?? [])
    .map((option) => {
      const detail = presentation?.optionDetails?.[option];
      return detail
        ? richOptionButton(option, detail)
        : `<button type="submit" name="choice" value="${escapeHtml(option)}" class="plain-choice">${escapeHtml(option)}</button>`;
    })
    .join('');
  const contact = presentation?.contactName
    ? ` Questions? Message ${escapeHtml(presentation.contactName)}.`
    : '';
  const decided = request.decidedAt
    ? `<p class="choice-note">You answered on ${escapeHtml(formatInstant(request.decidedAt))}. Thank you.</p>`
    : `<form class="choice-form" data-case-id="${escapeHtml(request.caseId)}" method="post" action="/api/cases/${escapeHtml(request.caseId)}/traveller-decision">
        ${buttons}
        <p class="choice-note">Nothing is booked until you choose. We will check your choice against the rest of your trip first.${contact}</p>
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
export function renderTravellerTripBody(view: TravellerTripView, presentation?: TravellerPresentation): string {
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
  const inputs = view.inputRequested.map((request) => inputCard(request, presentation)).join('');
  // Northstar RV-N10: when the traveller is blocked on intake, surface the
  // prompts in a single "What we need from you" panel. Choice requests
  // already carry their prompt inside the decision card, so the aggregate
  // panel is intake-only — never a duplicate ask.
  const needsFromYou = renderNeedsFromYouPanel(view);
  const resolution = view.resolutionSummary
    ? `
  <div class="card t-card" data-ui-section="resolution">
    <h2>Your new plan</h2>
    <p>${escapeHtml(view.resolutionSummary)}</p>
  </div>`
    : '';
  return `
<main class="traveller-shell">
  ${hero(view, presentation)}
  ${commitmentCard(presentation)}
  ${whatChanged}
  ${whatMatters}
  ${needsFromYou}
  ${inputs}
  ${actions}
  ${resolution}
  ${viabilityBlock(view.remainderViable)}
  <p class="t-foot">Updated ${escapeHtml(formatInstant(view.updatedAt))}</p>
</main>`;
}

/**
 * Northstar addition: when the trip is blocked on intake
 * (NEEDS_TRAVELLER_INFO), render a single panel that lists every prompt
 * together so the traveller sees the whole ask in one place. Omitted when
 * the block is a choice — the decision card already carries that prompt.
 */
function renderNeedsFromYouPanel(view: TravellerTripView): string {
  if (view.status !== 'NEEDS_TRAVELLER_INFO') return '';
  const items = view.inputRequested
    .map((request) => `<li>${escapeHtml(request.prompt)}</li>`)
    .join('');
  return `
  <div class="card t-card" data-ui-section="needs-from-you">
    <h2>What we need from you</h2>
    <ul class="plain-list">${items || '<li>Nothing right now — we will come back when we do need you.</li>'}</ul>
  </div>`;
}

/** Full traveller screen from the frozen envelope; honest about loading/error. */
export function renderTravellerTrip(
  envelope: ReadModelEnvelope<TravellerTripView>,
  presentation?: TravellerPresentation,
): string {
  if (envelope.state === 'LOADING') {
    return `<main class="traveller-shell">${loadingPanel('Checking your trip', 'We are loading the latest confirmed details.')}</main>`;
  }
  if (envelope.state === 'ERROR') {
    return `<main class="traveller-shell">${errorPanel('We can\u2019t show your trip right now', envelope.errorMessage)}</main>`;
  }
  if (!envelope.data) {
    return `<main class="traveller-shell">${errorPanel('We can\u2019t show your trip right now')}</main>`;
  }
  return renderTravellerTripBody(envelope.data, presentation);
}
