/**
 * Traveller concierge request controller.
 *
 * The browser sends authored text and the frozen ChangeRequest target fields
 * to server-owned interpretation and submission endpoints. It does not infer
 * authority, answer the traveller, mutate trip state, or render server HTML.
 */
import type {
  ChangeRequestIntentKind,
  ChangeRequestUrgency,
  DesiredChangeTarget,
  FundingDeclaration,
} from '../contracts/v2/change/changeRequest.ts';

export interface TravellerRequestInterpretation {
  intentKind: ChangeRequestIntentKind;
  urgency: ChangeRequestUrgency;
  desiredTarget: DesiredChangeTarget;
  fundingDeclaration?: FundingDeclaration;
}

/** Endpoint request: journey identity stays in the trusted route. */
export interface TravellerRequestInterpretRequest {
  sourceUtterance: string;
  intentKind?: ChangeRequestIntentKind;
  urgency?: ChangeRequestUrgency;
  desiredTarget?: Partial<DesiredChangeTarget>;
  fundingDeclaration?: FundingDeclaration;
  idempotencyKey: string;
}

export type TravellerRequestInterpretResponse =
  | { status: 'READY'; interpretation: TravellerRequestInterpretation }
  | { status: 'CLARIFICATION_REQUIRED'; questions: string[]; interpretation?: Partial<TravellerRequestInterpretation> }
  | { status: 'VALIDATION_ERROR'; message: string; issues?: { field: string; message: string }[] };

export interface TravellerRequestPlanningOutcome {
  state: 'PENDING' | 'IN_PROGRESS' | 'AVAILABLE' | 'BLOCKED' | 'UNKNOWN';
  detail: string;
  caseRef?: string;
}

export interface TravellerRequestSubmitResponse {
  status: 'SUBMITTED';
  changeRequestId: string;
  lifecycle: 'SUBMITTED';
  revision: number;
  planningOutcome: TravellerRequestPlanningOutcome;
}

type InstantField = 'arriveBy' | 'departAfter' | 'stayCheckOut';

function toInstant(value: string, offset: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}:00${offset}`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(trimmed)) return `${trimmed}${offset}`;
  return trimmed;
}

function jsString(value: string): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' })[character] ?? character);
}

export function renderTravellerRequestController(journeyRef: string): string {
  return `<script data-traveller-request-controller>
(function () {
  'use strict';
  var journeyRef = ${jsString(journeyRef)};
  var journeyId = journeyRef.indexOf('JOURNEY:') === 0 ? journeyRef.slice(8) : journeyRef;
  var root = document.querySelector('[data-traveller-request]');
  if (!root || root.__travellerRequestInit) return;
  root.__travellerRequestInit = true;
  var form = root.querySelector('[data-request-form]');
  var interpretButton = root.querySelector('[data-request-interpret]');
  var submitButton = root.querySelector('[data-request-submit]');
  var status = root.querySelector('[data-request-status]');
  var review = root.querySelector('[data-request-review]');
  var acknowledgement = root.querySelector('[data-request-acknowledgement]');
  var retryKeyInput = root.querySelector('[data-request-idempotency-key]');
  var interpreted = null;
  var submittedDraft = null;

  function value(selector) { var node = root.querySelector(selector); return node ? String(node.value || '').trim() : ''; }
  function checkedValue(selector) { var node = root.querySelector(selector + ':checked'); return node ? String(node.value || '').trim() : ''; }
  function setStatus(text) { status.textContent = text; }
  function appendText(parent, tag, text) { var node = document.createElement(tag); node.textContent = text; parent.appendChild(node); return node; }
  function invalidate() {
    interpreted = null;
    submitButton.disabled = true;
    review.hidden = true;
    acknowledgement.hidden = true;
  }
  function requestKey() {
    var current = value('[data-request-idempotency-key]');
    if (current) return current;
    var created = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : 'traveller-request-' + Date.now().toString(36);
    retryKeyInput.value = created;
    return created;
  }
  function collectDraft() {
    var message = value('[data-request-message]');
    var offset = value('[data-request-timezone]') || '+00:00';
    var target = {};
    ['arriveBy', 'departAfter', 'stayCheckOut'].forEach(function (fieldName) {
      var raw = value('[data-request-' + fieldName + ']');
      var instant = raw ? (${toInstant.toString()})(raw, offset) : undefined;
      if (instant) target[fieldName] = instant;
    });
    var direct = value('[data-request-direct]');
    if (direct === 'PREFER_DIRECT') target.transport = { preferDirect: true };
    if (!message) { setStatus('Tell us what you need changed before asking Northstar to interpret it.'); return null; }
    var urgency = checkedValue('[data-request-urgency]');
    if (!urgency) { setStatus('Choose whether this is a hard instruction or a preference.'); return null; }
    var draft = {
      sourceUtterance: message,
      intentKind: value('[data-request-intent]') || undefined,
      urgency: urgency,
      desiredTarget: Object.keys(target).length > 0 ? target : undefined,
      fundingDeclaration: value('[data-request-funding]') || undefined,
      idempotencyKey: requestKey(),
    };
    return draft;
  }
  function targetLabel(key) {
    return { arriveBy: 'Arrive by', departAfter: 'Depart after', stayCheckOut: 'Stay checkout' }[key] || key;
  }
  function intentLabel(value) {
    return { ADJUST_TRIP_WINDOW: 'Trip timing', CHANGE_TRANSPORT_SCHEDULE: 'Transport timing', CHANGE_STAY: 'Stay arrangements', CANCEL_BOOKING: 'Booking cancellation', ADJUST_OBJECTIVE: 'Trip priority', OTHER: 'Other request' }[value] || 'Other request';
  }
  function renderTarget(parent, target) {
    var known = false;
    ['arriveBy', 'departAfter', 'stayCheckOut'].forEach(function (key) {
      if (target[key]) { appendText(parent, 'p', targetLabel(key) + ': ' + target[key]); known = true; }
    });
    if (target.transport && target.transport.preferDirect === true) { appendText(parent, 'p', 'Transport: prefer a direct flight.'); known = true; }
    if (target.transport && (target.transport.earliestDeparture || target.transport.latestDeparture)) {
      appendText(parent, 'p', 'Departure window: ' + (target.transport.earliestDeparture || 'not set') + ' to ' + (target.transport.latestDeparture || 'not set') + '.'); known = true;
    }
    var extraKeys = Object.keys(target).filter(function (key) { return ['arriveBy', 'departAfter', 'stayCheckOut', 'transport'].indexOf(key) < 0; });
    if (extraKeys.length > 0 || (target.transport && Object.keys(target.transport).some(function (key) { return ['preferDirect', 'earliestDeparture', 'latestDeparture'].indexOf(key) < 0; }))) {
      appendText(parent, 'p', 'Additional details were recorded for planner review.');
      known = true;
    }
    if (!known) appendText(parent, 'p', 'No typed target was returned yet. Northstar needs clarification before planning.');
  }
  function renderReview(response) {
    review.replaceChildren();
    var title = document.createElement('h3'); title.textContent = response.status === 'READY' ? 'Review what Northstar understood' : 'More detail needed'; review.appendChild(title);
    if (response.status === 'CLARIFICATION_REQUIRED') {
      var questions = document.createElement('ul'); (response.questions || []).forEach(function (question) { appendText(questions, 'li', String(question)); }); review.appendChild(questions); review.hidden = false; return;
    }
    appendText(review, 'p', 'Request type: ' + intentLabel(response.interpretation.intentKind));
    appendText(review, 'p', response.interpretation.urgency === 'HARD_INSTRUCTION' ? 'This will be treated as a hard instruction.' : 'This will be treated as a preference.');
    var targetBox = document.createElement('div'); targetBox.setAttribute('data-request-target-review', ''); renderTarget(targetBox, response.interpretation.desiredTarget); review.appendChild(targetBox);
    if (response.interpretation.fundingDeclaration) appendText(review, 'p', 'Funding declaration: ' + response.interpretation.fundingDeclaration.replaceAll('_', ' ').toLowerCase() + '. This is a declaration, not authorization.');
    review.hidden = false;
  }
  function messageFor(data, fallback) {
    var message = data && data.message ? String(data.message) : fallback;
    if (data && Array.isArray(data.issues) && data.issues.length > 0) message += ' ' + data.issues.map(function (issue) { return String(issue.field || 'request') + ': ' + String(issue.message || 'invalid'); }).join(' ');
    return message;
  }
  function parseResponse(response) { return response.text().then(function (body) { var data; try { data = JSON.parse(body); } catch (error) { data = { status: 'VALIDATION_ERROR', message: 'The server returned an unreadable response.' }; } return { ok: response.ok, data: data }; }); }
  function interpret() {
    var draft = collectDraft(); if (!draft) return;
    interpreted = null; submitButton.disabled = true; interpretButton.disabled = true; setStatus('Checking what you mean…');
    fetch('/api/v2/travellers/journeys/' + encodeURIComponent(journeyId) + '/requests/interpret', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(draft) }).then(parseResponse).then(function (result) {
      if (!result.ok || !result.data || (result.data.status !== 'READY' && result.data.status !== 'CLARIFICATION_REQUIRED')) throw new Error(messageFor(result.data, 'Northstar could not interpret this request.'));
      renderReview(result.data);
      if (result.data.status === 'READY') { interpreted = result.data.interpretation; submitButton.disabled = false; setStatus('Review the interpreted request before sending it.'); }
      else setStatus('Northstar needs clarification before it can plan this request.');
    }).catch(function (error) { setStatus(error && error.message ? error.message : 'Northstar could not interpret this request.'); }).then(function () { interpretButton.disabled = false; });
  }
  function caseLink(caseRef) {
    var link = document.createElement('a'); link.href = '/operator/cases/' + encodeURIComponent(caseRef); link.textContent = 'Open case'; return link;
  }
  function submit() {
    if (!interpreted) { setStatus('Review the interpreted request before sending it.'); return; }
    var draft = collectDraft(); if (!draft) return;
    var body = { sourceUtterance: draft.sourceUtterance, intentKind: interpreted.intentKind, urgency: interpreted.urgency, desiredTarget: interpreted.desiredTarget, fundingDeclaration: interpreted.fundingDeclaration, idempotencyKey: draft.idempotencyKey };
    submittedDraft = body; interpreted = null; submitButton.disabled = true; interpretButton.disabled = true; setStatus('Sending the reviewed request…');
    fetch('/api/v2/travellers/journeys/' + encodeURIComponent(journeyId) + '/requests', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(body) }).then(parseResponse).then(function (result) {
      if (!result.ok || !result.data || result.data.status !== 'SUBMITTED') throw new Error(messageFor(result.data, 'The request could not be recorded.'));
      acknowledgement.replaceChildren(); appendText(acknowledgement, 'h3', 'Request recorded'); appendText(acknowledgement, 'p', 'Your request has been saved for the travel coordinator.');
      if (result.data.planningOutcome) { appendText(acknowledgement, 'p', 'Planning: ' + result.data.planningOutcome.detail); if (result.data.planningOutcome.caseRef) acknowledgement.appendChild(caseLink(result.data.planningOutcome.caseRef)); }
      else appendText(acknowledgement, 'p', 'Planning outcome is not available yet.');
      acknowledgement.hidden = false; setStatus('Request recorded.');
    }).catch(function (error) { interpreted = submittedDraft ? { intentKind: submittedDraft.intentKind, urgency: submittedDraft.urgency, desiredTarget: submittedDraft.desiredTarget, fundingDeclaration: submittedDraft.fundingDeclaration } : null; submitButton.disabled = !interpreted; setStatus(error && error.message ? error.message + ' Your draft is still here; retry safely.' : 'The request could not be recorded. Your draft is still here; retry safely.'); }).then(function () { interpretButton.disabled = false; });
  }
  root.addEventListener('input', invalidate);
  root.addEventListener('change', invalidate);
  root.addEventListener('click', function (event) { var target = event.target; if (target.matches('[data-request-interpret]')) interpret(); if (target.matches('[data-request-submit]')) submit(); });
})();
</script>`;
}
