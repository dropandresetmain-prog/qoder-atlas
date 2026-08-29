/**
 * E2 — traveller trip page: mobile-first concierge register (DESIGN.md §1).
 *
 * Approved T1–T7 surfaces: topbar, hero with kicker tones, itinerary rows,
 * commitment card, remainder viability, progress check-rows, choice cards,
 * message thread, and composer. Answers plainly: am I okay, what changed,
 * what matters, what is Northstar doing, what does it need from me, is the
 * rest of my trip viable. No internal engine jargon.
 *
 * An optional TravellerPresentation adds destination photography, itinerary,
 * progress, and thread detail. Without it, every screen still renders
 * completely from the frozen TravellerTripView — presentation never invents
 * facts.
 */
import type {
  ReadModelEnvelope,
  TravellerInputRequest,
  TravellerTripView,
} from '../../contracts/readmodels.ts';
import {
  CASE_OPTIONS_FORMING_NOTE,
  STATUS_LABEL,
  TRAVELLER_HEADLINE,
  TRAVELLER_SUBLINE,
} from '../copy.ts';
import { escapeHtml, formatInstant } from '../html.ts';
import {
  errorPanel,
  loadingPanel,
  viabilityBlock,
} from '../components.ts';
import { ICON_SEND } from '../icons.ts';
import type {
  TravellerItineraryRow,
  TravellerOptionDetail,
  TravellerPresentation,
  TravellerProgressRow,
  TravellerThreadMessage,
} from '../traveller-presentation.ts';

const PROGRESS_ICON: Record<TravellerProgressRow['state'], string> = {
  done: '✓',
  doing: '⟳',
  queued: '○',
  failed: '✕',
};

const STATE_CLASS: Record<TravellerItineraryRow['stateTone'], string> = {
  ok: 's-ok',
  bad: 's-bad',
  watch: 's-watch',
  neutral: 's-neutral',
};

function topbar(presentation?: TravellerPresentation): string {
  const event = presentation?.eventName
    ? `<span class="tt-right">${escapeHtml(presentation.eventName)}</span>`
    : '';
  return `
  <div class="t-topbar">
    <div class="brand"><span class="mark" aria-hidden="true">✦</span>Northstar</div>
    ${event}
  </div>`;
}

function hero(view: TravellerTripView, presentation?: TravellerPresentation): string {
  const image = presentation?.heroImageUrl
    ? `<img src="${escapeHtml(presentation.heroImageUrl)}" alt="${escapeHtml(presentation.heroImageAlt ?? '')}" loading="lazy">`
    : '';
  const changedButWorking = view.status === 'DISRUPTED' && view.remainderViable === 'VIABLE';
  const kicker = presentation?.heroKicker
    ?? (changedButWorking ? 'Trip checked' : STATUS_LABEL[view.status]);
  const kickerTone = presentation?.heroKickerTone
    ?? (changedButWorking || view.status === 'READY' || view.status === 'RESOLVED' ? 'ok' : view.status === 'DISRUPTED' ? 'bad' : undefined);
  const kickerClass = kickerTone === 'ok' ? 'k-ok' : kickerTone === 'bad' ? 'k-bad' : '';
  const headline = presentation?.heroHeadline
    ?? (changedButWorking ? 'Your trip changed, but still works' : TRAVELLER_HEADLINE[view.status]);
  const subline = presentation?.heroSubline
    ?? (changedButWorking
      ? 'The updated booking still protects the important parts of your trip.'
      : TRAVELLER_SUBLINE[view.status]);
  return `
  <div class="t-hero" data-status="${escapeHtml(view.status)}">
    ${image}
    <div class="scrim" aria-hidden="true"></div>
    <div class="t-hero-text">
      <p class="hero-kicker${kickerClass ? ` ${kickerClass}` : ''}">${escapeHtml(kicker)}</p>
      <h1>${escapeHtml(headline)}</h1>
      <p>${escapeHtml(subline)}</p>
    </div>
  </div>`;
}

function itineraryRow(row: TravellerItineraryRow): string {
  const struck = row.struck ? ' struck' : '';
  const sub = row.sub ? `<div class="i-sub">${escapeHtml(row.sub)}</div>` : '';
  // Icons come from the shared projection as solid inline SVGs — insert raw
  // so the state colour can fill them (escaping would render the markup).
  return `<div class="itin-row${struck}"><span class="i-ic" aria-hidden="true">${row.icon}</span><div class="i-main"><div class="i-title">${escapeHtml(row.title)}</div>${sub}</div><span class="i-state ${STATE_CLASS[row.stateTone]}">${escapeHtml(row.stateLabel)}</span></div>`;
}

function itinerarySection(view: TravellerTripView, presentation?: TravellerPresentation): string {
  if (presentation?.itinerary && presentation.itinerary.length > 0) {
    const heading = presentation.itineraryHeading ?? 'Your trip';
    return `
  <div class="t-card" data-ui-section="itinerary">
    <h2>${escapeHtml(heading)}</h2>
    ${presentation.itinerary.map(itineraryRow).join('')}</div>`;
  }
  // Choice-focused surfaces (approved T4) lead with options — do not also
  // restack whatChanged above them when presentation already owns the story.
  if (presentation?.optionDetails && Object.keys(presentation.optionDetails).length > 0) {
    return '';
  }
  if (view.whatChanged) {
    return `
  <div class="t-card" data-ui-section="what-changed">
    <h2>What changed</h2>
    <p>${escapeHtml(view.whatChanged)}</p>
  </div>`;
  }
  return '';
}

function commitmentCard(view: TravellerTripView, presentation?: TravellerPresentation): string {
  const card = presentation?.commitmentCard
    ?? (presentation?.optionDetails && Object.keys(presentation.optionDetails).length > 0
      ? undefined
      : view.whatMattersNow
        ? { label: 'The reason for the trip', title: view.whatMattersNow }
        : undefined);
  if (!card) return '';
  const meta = card.meta ? `<p class="cc-meta">${escapeHtml(card.meta)}</p>` : '';
  const body = card.body ? `<p class="cc-body">${escapeHtml(card.body)}</p>` : '';
  const ifMissed = card.ifMissed ? `<p class="cc-if-missed">${escapeHtml(card.ifMissed)}</p>` : '';
  const okClass = card.ok ? ' is-ok' : '';
  return `
  <div class="commit-card${okClass}" data-ui-section="commitment">
    <p class="cc-label">${escapeHtml(card.label)}</p>
    <p class="cc-title">${escapeHtml(card.title)}</p>
    ${meta}
    ${body}
    ${ifMissed}
  </div>`;
}

function progressRow(row: TravellerProgressRow): string {
  const detail = row.detail ? `<span class="c-sub">${escapeHtml(row.detail)}</span>` : '<span class="c-sub"></span>';
  return `<div class="check-row ${row.state}"><span class="c-ic" aria-hidden="true">${PROGRESS_ICON[row.state]}</span><span class="c-t">${escapeHtml(row.text)}</span>${detail}</div>`;
}

function progressSection(view: TravellerTripView, presentation?: TravellerPresentation): string {
  if (presentation?.progress && presentation.progress.length > 0) {
    const heading = presentation.progressHeading ?? 'What Northstar is doing';
    const note = presentation.progressNote
      ? `<p style="margin-top:10px">${escapeHtml(presentation.progressNote)}</p>`
      : '';
    return `
  <div class="t-card" data-ui-section="progress">
    <h2>${escapeHtml(heading)}</h2>
    ${presentation.progress.map(progressRow).join('')}
    ${note}
  </div>`;
  }
  if (view.actionsInProgress.length === 0) return '';
  const rows = view.actionsInProgress.map((action) =>
    progressRow({ state: 'doing', text: action }),
  );
  return `
  <div class="t-card" data-ui-section="progress">
    <h2>What we are doing</h2>
    ${rows.join('')}
  </div>`;
}

function optionsSkeleton(presentation?: TravellerPresentation): string {
  if (!presentation?.optionsSkeleton) return '';
  const note = presentation.optionsSkeletonNote ?? CASE_OPTIONS_FORMING_NOTE;
  return `
  <div class="t-card" data-ui-section="options-skeleton">
    <div class="skeleton" style="height:52px"></div>
    <div class="skeleton" style="height:52px;margin-top:8px"></div>
    <p style="margin-top:10px">${escapeHtml(note)}</p>
  </div>`;
}

function choiceValue(option: string): string {
  return option.toLowerCase() === 'decline' ? 'DECLINED' : 'APPROVED';
}

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
  return `<button type="submit" name="decision" value="${choiceValue(option)}" class="optcard ${edgeClass}">
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
        : `<button type="submit" name="decision" value="${choiceValue(option)}" class="plain-choice">${escapeHtml(option)}</button>`;
    })
    .join('');
  const contact = presentation?.contactName
    ? ` Questions? Message ${escapeHtml(presentation.contactName)}.`
    : '';
  const choiceNote = presentation?.choiceNote
    ? `<p class="choice-note">${escapeHtml(presentation.choiceNote)}</p>`
    : '';
  const decided = request.decidedAt
    ? `<p class="choice-note">You answered on ${escapeHtml(formatInstant(request.decidedAt))}. Thank you.</p>`
    : `<form class="choice-form inline-form" data-case-id="${escapeHtml(request.caseId)}" method="post" action="/api/cases/${escapeHtml(request.caseId)}/traveller-decision">
        ${buttons}
        <p class="choice-note">Nothing is booked until you choose. We will check your choice against the rest of your trip first.${contact}</p>
      </form>${choiceNote}`;
  return `
  <div class="t-card" data-ui-section="input-requested">
    <h2>We need your input</h2>
    <p>${escapeHtml(request.prompt)}</p>
    ${decided}
  </div>`;
}

function renderNeedsFromYouPanel(view: TravellerTripView): string {
  if (view.status !== 'NEEDS_TRAVELLER_INFO') return '';
  // Choice requests already carry their prompt inside the decision card.
  if (view.inputRequested.some((request) => (request.options?.length ?? 0) > 0)) return '';
  const items = view.inputRequested
    .map((request) => `<li>${escapeHtml(request.prompt)}</li>`)
    .join('');
  return `
  <div class="t-card" data-ui-section="needs-from-you">
    <h2>What we need from you</h2>
    <ul class="plain-list">${items || '<li>Nothing right now — we will come back when we do need you.</li>'}</ul>
  </div>`;
}

function resolutionCard(view: TravellerTripView): string {
  if (!view.resolutionSummary) return '';
  return `
  <div class="t-card" data-ui-section="resolution">
    <h2>Your new plan</h2>
    <p>${escapeHtml(view.resolutionSummary)}</p>
  </div>`;
}

function viabilitySection(view: TravellerTripView, presentation?: TravellerPresentation): string {
  if (presentation?.hideViability) return '';
  if (presentation?.viability) {
    const detail = presentation.viability.detail ? ` ${escapeHtml(presentation.viability.detail)}` : '';
    const toneMap = {
      VIABLE: 'v-ok',
      AT_RISK: 'v-watch',
      NOT_VIABLE: 'v-bad',
      UNKNOWN: 'v-neutral',
    } as const;
    return `<div class="viab ${toneMap[view.remainderViable]}" data-viability="${escapeHtml(view.remainderViable)}"><strong>${escapeHtml(presentation.viability.lead)}</strong>${detail}</div>`;
  }
  // Healthy ready trips do not need the viability callout when itinerary already answers.
  if (view.status === 'READY' && view.remainderViable === 'VIABLE' && !view.whatChanged) {
    return '';
  }
  return viabilityBlock(view.remainderViable);
}

function threadMessage(msg: TravellerThreadMessage): string {
  const side = msg.from === 'me' ? 'from-me' : 'from-ns';
  return `
  <div class="msg ${side}">
    <div class="m-meta">${escapeHtml(msg.meta)}</div>
    ${escapeHtml(msg.body)}
  </div>`;
}

function threadSection(presentation?: TravellerPresentation): string {
  if (!presentation?.messages || presentation.messages.length === 0) return '';
  return `
  <div class="thread" data-ui-section="thread">
    ${presentation.messages.map(threadMessage).join('')}
  </div>`;
}

/**
 * Compact composer matching approved T1–T7. When travellerId is known, it is
 * a real change-request form posting to the existing seam; otherwise a
 * non-interactive placeholder so the surface still reads as a concierge.
 */
function composer(view: TravellerTripView, presentation?: TravellerPresentation): string {
  const placeholder = presentation?.composerPlaceholder ?? 'Ask Northstar anything…';
  if (!view.travellerId) {
    return `
  <div class="composer" data-ui-section="traveller-request" aria-hidden="true">
    <span class="c-placeholder">${escapeHtml(placeholder)}</span>
    <span class="c-send">${ICON_SEND}</span>
  </div>`;
  }
  return `
  <form class="composer inline-form" method="post" action="/api/traveller/change-request" data-result-target="traveller-request-result" data-ui-section="traveller-request">
    <input type="hidden" name="travellerId" value="${escapeHtml(view.travellerId)}">
    <input type="hidden" name="tripId" value="${escapeHtml(view.tripId)}">
    <input type="hidden" name="at" value="${escapeHtml(view.updatedAt)}">
    <label class="sr-only" for="traveller-request-text">Ask Northstar</label>
    <input id="traveller-request-text" class="c-input" name="text" type="text" minlength="1" required placeholder="${escapeHtml(placeholder)}">
    <button type="submit" class="c-send" aria-label="Send">${ICON_SEND}</button>
  </form>
  <div id="traveller-request-result" class="form-result" role="status" aria-live="polite"></div>`;
}

function footer(view: TravellerTripView, presentation?: TravellerPresentation): string {
  const name = presentation?.travellerName ? `${escapeHtml(presentation.travellerName)} · ` : '';
  return `<p class="t-foot">${name}${escapeHtml(formatInstant(view.updatedAt))}<br>Northstar keeps the whole trip working</p>`;
}

/** Traveller body from a loaded view. */
export function renderTravellerTripBody(view: TravellerTripView, presentation?: TravellerPresentation): string {
  // Thread-first surface (T7): messages + composer answer the journey.
  if (presentation?.messages && presentation.messages.length > 0) {
    return `
<main class="traveller-shell">
  ${topbar(presentation)}
  ${threadSection(presentation)}
  ${composer(view, presentation)}
  ${footer(view, presentation)}
</main>`;
  }

  const inputs = view.inputRequested.map((request) => inputCard(request, presentation)).join('');

  // Approved T1/T6 put the ink commitment before the itinerary; T2 puts
  // "What changed" first so the disruption is the lead story.
  const changeFirst =
    view.status === 'DISRUPTED' ||
    presentation?.itineraryHeading?.toLowerCase() === 'what changed';
  const itinerary = itinerarySection(view, presentation);
  const commitment = commitmentCard(view, presentation);
  const leadBlocks = changeFirst ? `${itinerary}${commitment}` : `${commitment}${itinerary}`;

  return `
<main class="traveller-shell">
  ${topbar(presentation)}
  ${hero(view, presentation)}
  ${leadBlocks}
  ${viabilitySection(view, presentation)}
  ${renderNeedsFromYouPanel(view)}
  ${inputs}
  ${progressSection(view, presentation)}
  ${optionsSkeleton(presentation)}
  ${resolutionCard(view)}
  ${composer(view, presentation)}
  ${footer(view, presentation)}
</main>`;
}

/** Full traveller screen from the frozen envelope; honest about loading/error. */
export function renderTravellerTrip(
  envelope: ReadModelEnvelope<TravellerTripView>,
  presentation?: TravellerPresentation,
): string {
  if (envelope.state === 'LOADING') {
    return `<main class="traveller-shell">${topbar(presentation)}${loadingPanel('Checking your trip', 'We are loading the latest confirmed details.')}</main>`;
  }
  if (envelope.state === 'ERROR') {
    return `<main class="traveller-shell">${topbar(presentation)}${errorPanel('We can\u2019t show your trip right now', envelope.errorMessage)}</main>`;
  }
  if (!envelope.data) {
    return `<main class="traveller-shell">${topbar(presentation)}${errorPanel('We can\u2019t show your trip right now')}</main>`;
  }
  return renderTravellerTripBody(envelope.data, presentation);
}
