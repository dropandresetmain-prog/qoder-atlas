/** Traveller concierge request surface; primary wires it into the journey route. */
import { escapeHtml } from '../html.ts';
import { renderTravellerRequestController } from '../traveller-request-controller.ts';

export interface TravellerRequestRenderOptions {
  journeyRef: string;
  eventName?: string;
}

export function renderProductTravellerRequest(options: TravellerRequestRenderOptions): string {
  return `
<style data-traveller-request-style>
.traveller-request .request-intro { margin: 14px 0; color: var(--text-soft); font-size: 14px; line-height: 1.5; }
.traveller-request .request-field { display: grid; gap: 6px; margin: 14px 0; }
.traveller-request .request-field label, .traveller-request .request-legend { color: var(--text-soft); font-size: 12px; font-weight: 650; }
.traveller-request input, .traveller-request textarea, .traveller-request select { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: 9px; padding: 10px 11px; background: var(--surface); color: var(--text); font: inherit; }
.traveller-request textarea { min-height: 112px; resize: vertical; line-height: 1.45; }
.traveller-request input:focus, .traveller-request textarea:focus, .traveller-request select:focus { outline: 2px solid var(--watch-f); outline-offset: 1px; }
.traveller-request .request-choice { display: grid; gap: 8px; margin: 8px 0 14px; }
.traveller-request .request-choice label { display: flex; align-items: flex-start; gap: 8px; color: var(--text-soft); font-size: 13px; font-weight: 400; }
.traveller-request .request-choice input { width: auto; margin-top: 2px; }
.traveller-request .request-help { color: var(--text-faint); font-size: 11px; line-height: 1.4; }
.traveller-request .request-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.traveller-request [data-request-review], .traveller-request [data-request-acknowledgement] { margin-top: 14px; padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
.traveller-request [data-request-review] h3, .traveller-request [data-request-acknowledgement] h3 { margin: 0 0 8px; font-size: 15px; }
.traveller-request [data-request-review] p, .traveller-request [data-request-acknowledgement] p { margin: 6px 0; color: var(--text-soft); font-size: 13px; }
.traveller-request [data-request-review] ul { margin: 8px 0; padding-left: 20px; color: var(--text-soft); font-size: 13px; }
.traveller-request [data-request-status] { min-height: 1.4em; color: var(--text-soft); font-size: 13px; }
</style>
<main class="traveller-shell traveller-request" data-traveller-request data-test="product-traveller-request">
  <div class="t-topbar"><div class="brand"><span class="mark" aria-hidden="true">✦</span>Northstar</div>${options.eventName ? `<span class="tt-right">${escapeHtml(options.eventName)}</span>` : ''}</div>
  <div class="t-card">
    <h1>Tell us what you need</h1>
    <p class="request-intro">Describe the change in your own words. Northstar will show what it understood before anything is sent to planning.</p>
    <form data-request-form novalidate>
      <div class="request-field"><label for="request-message">Your message</label><textarea id="request-message" data-request-message placeholder="For example: I need to arrive before the opening session."></textarea></div>
      <fieldset class="request-choice"><legend class="request-legend">How should we treat this?</legend><label><input type="radio" name="request-urgency" value="HARD_INSTRUCTION" data-request-urgency>Hard instruction — this is a requirement</label><label><input type="radio" name="request-urgency" value="SOFT_PREFERENCE" data-request-urgency>Preference — use this if it works</label></fieldset>
      <div class="request-field"><label for="request-intent">What kind of change is this? <span class="request-help">Optional; Northstar can ask if unclear.</span></label><select id="request-intent" data-request-intent><option value="">Let Northstar interpret</option><option value="ADJUST_TRIP_WINDOW">Trip timing</option><option value="CHANGE_TRANSPORT_SCHEDULE">Transport timing</option><option value="CHANGE_STAY">Stay arrangements</option><option value="ADJUST_OBJECTIVE">Trip priority</option><option value="OTHER">Something else</option></select></div>
      <div class="request-field"><label for="request-timezone">Local timezone for the times below</label><select id="request-timezone" data-request-timezone><option value="+00:00">UTC</option><option value="+08:00">UTC+08:00</option><option value="+01:00">UTC+01:00</option><option value="-05:00">UTC-05:00</option><option value="-08:00">UTC-08:00</option></select><span class="request-help">Times are sent with this offset. You can also include a full ISO time with its own offset.</span></div>
      <div class="request-field"><label for="request-arrive-by">Arrive by <span class="request-help">Optional local date and time</span></label><input id="request-arrive-by" data-request-arriveBy type="text" placeholder="2031-05-01T09:00"></div>
      <div class="request-field"><label for="request-depart-after">Depart after <span class="request-help">Optional local date and time</span></label><input id="request-depart-after" data-request-departAfter type="text" placeholder="2031-05-01T17:00"></div>
      <div class="request-field"><label for="request-stay-checkout">Stay checkout <span class="request-help">Optional local date and time</span></label><input id="request-stay-checkout" data-request-stayCheckOut type="text" placeholder="2031-05-04T11:00"></div>
      <div class="request-field"><label for="request-direct">Transport preference</label><select id="request-direct" data-request-direct><option value="">No direct-flight preference</option><option value="PREFER_DIRECT">Prefer a direct flight where possible</option></select></div>
      <div class="request-field"><label for="request-funding">Funding declaration <span class="request-help">This records what you are declaring; it does not authorize spending.</span></label><select id="request-funding" data-request-funding><option value="">No funding declaration</option><option value="EVENT_FUNDED">Event funded</option><option value="TRAVELLER_FUNDED">Traveller funded</option><option value="SPLIT">Split funding</option><option value="UNKNOWN">Funding is not known</option></select></div>
      <input type="hidden" data-request-idempotency-key>
      <div class="request-actions"><button type="button" class="btn btn-primary" data-request-interpret>Review request</button><button type="button" class="btn btn-primary" data-request-submit disabled>Send request</button></div>
      <p data-request-status role="status" aria-live="polite"></p>
      <div data-request-review hidden></div>
      <div data-request-acknowledgement hidden></div>
    </form>
  </div>
  <p class="t-foot">Your request is reviewed against your current journey</p>
</main>${renderTravellerRequestController(options.journeyRef)}`;
}
