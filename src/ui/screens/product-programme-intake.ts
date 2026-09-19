/** Target programme intake screen renderer. */
import type { ProgrammeImportBundle } from '../../app/target/programmeImport.ts';
import { escapeHtml } from '../html.ts';
import { renderProgrammeIntakeController } from '../programme-intake-controller.ts';

export interface ProgrammeIntakeRenderOptions {
  initialBundle?: Partial<ProgrammeImportBundle>;
}

const TIMEZONE_OFFSETS = ['+00:00', '+01:00', '+08:00', '-05:00', '-08:00'] as const;

function offsetMinutes(offset: string): number {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

function localParts(instant: string | undefined, displayOffset?: string): { date: string; time: string; offset: string } {
  if (!instant) return { date: '', time: '', offset: '+00:00' };
  const match = /([+-]\d{2}:\d{2}|Z)$/.exec(instant);
  const sourceOffset = displayOffset ?? (match?.[1] === 'Z' ? '+00:00' : match?.[1] ?? '+00:00');
  const local = new Date(Date.parse(instant) + (offsetMinutes(sourceOffset) * 60_000));
  if (Number.isNaN(local.getTime())) return { date: '', time: '', offset: sourceOffset };
  return { date: local.toISOString().slice(0, 10), time: local.toISOString().slice(11, 16), offset: sourceOffset };
}

function timezoneOptions(selected: string): string {
  const offsets = Array.from(new Set([...TIMEZONE_OFFSETS, selected]));
  return offsets.map((offset) => `<option value="${offset}"${offset === selected ? ' selected' : ''}>UTC${offset === '+00:00' ? '' : offset}</option>`).join('');
}

function sessionRow(item: Partial<ProgrammeImportBundle['items'][number]> = {}): string {
  const start = localParts(item.windowStart);
  const selectedOffset = start.offset;
  const end = localParts(item.windowEnd, selectedOffset);
  return `<div class="panel" data-intake-session-row data-test="programme-intake-session">
    <div class="intake-row-grid">
      <label>Session title<input type="text" data-session-field="title" value="${escapeHtml(item.title ?? '')}" placeholder="Opening session"></label>
      <label>Session type<input type="text" data-session-field="itemType" value="${escapeHtml(item.itemType ?? 'SESSION')}" placeholder="SESSION"></label>
      <label>Start date<input type="date" data-session-field="startDate" value="${escapeHtml(start.date)}"></label>
      <label>Start time<input type="time" data-session-field="startTime" value="${escapeHtml(start.time)}"></label>
      <label>End date<input type="date" data-session-field="endDate" value="${escapeHtml(end.date)}"></label>
      <label>End time<input type="time" data-session-field="endTime" value="${escapeHtml(end.time)}"></label>
      <label>Timezone for this session<select data-session-field="timeZoneOffset">${timezoneOptions(selectedOffset)}</select></label>
    </div>
    <p class="field-help">The selected timezone is attached to both local times; nothing is inferred from the browser.</p>
    <button type="button" class="btn btn-ghost" data-remove-session>Remove session</button>
  </div>`;
}

function travellerRow(traveller: Partial<ProgrammeImportBundle['travellers'][number]> = {}): string {
  const obligation = traveller.obligation ?? 'REQUIRED';
  return `<div class="panel" data-intake-traveller-row data-test="programme-intake-traveller">
    <div class="intake-row-grid">
      <label>Traveller name<input type="text" data-traveller-field="displayName" value="${escapeHtml(traveller.displayName ?? '')}" placeholder="Avery Example"></label>
      <label>Sessions to attend<input type="text" data-traveller-field="participatesInItemNumbers" value="${escapeHtml(traveller.participatesInItemIndices?.map((index) => index + 1).join(', ') ?? '')}" placeholder="1, 2"></label>
      <label>Attendance requirement<select data-traveller-field="obligation"><option value="REQUIRED"${obligation === 'REQUIRED' ? ' selected' : ''}>Required</option><option value="OPTIONAL"${obligation === 'OPTIONAL' ? ' selected' : ''}>Optional</option></select></label>
    </div>
    <button type="button" class="btn btn-ghost" data-remove-traveller>Remove traveller</button>
  </div>`;
}

export function renderProductProgrammeIntake(options: ProgrammeIntakeRenderOptions = {}): string {
  const bundle = options.initialBundle ?? {};
  const items = bundle.items?.length ? bundle.items : [{}];
  const travellers = bundle.travellers?.length ? bundle.travellers : [{}];
  const importKey = bundle.importKey ?? '';
  return `
<style data-programme-intake-style>
.product-programme-intake label { display: grid; gap: 6px; font-size: 12px; font-weight: 650; color: var(--text-soft); }
.product-programme-intake input, .product-programme-intake select, .product-programme-intake textarea { box-sizing: border-box; width: 100%; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); color: var(--text); padding: 9px 10px; font: inherit; font-size: 13px; }
.product-programme-intake textarea { resize: vertical; line-height: 1.45; }
.product-programme-intake input:focus, .product-programme-intake select:focus, .product-programme-intake textarea:focus { outline: 2px solid var(--watch-f); outline-offset: 1px; }
.intake-row-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
.section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.section-head h2 { margin-bottom: 0; }
.field-help { display: block; color: var(--text-faint); font-size: 11px; font-weight: 400; line-height: 1.4; }
.file-button { cursor: pointer; }
.product-programme-intake [data-intake-review], .product-programme-intake [data-intake-success] { margin-top: 14px; padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
.product-programme-intake [data-intake-review] h3 { margin: 0 0 8px; font-size: 15px; }
.product-programme-intake [data-intake-review] ul { margin: 8px 0 0; padding-left: 20px; color: var(--text-soft); font-size: 13px; }
.product-programme-intake [data-intake-status] { min-height: 1.4em; color: var(--text-soft); }
@media (max-width: 620px) { .section-head { align-items: flex-start; flex-direction: column; } .product-programme-intake .panel { padding: 14px; } }
</style>
<main class="shell product-programme-intake" data-programme-intake data-test="product-programme-intake">
  <div class="page-head">
    <h1>Load a programme</h1>
    <p class="sub">Add the event, its sessions, and the people who need to attend. Review the server check before anything is added.</p>
    <p class="meta">Add confirmed session times and choose who needs to attend.</p>
  </div>
  <form data-programme-intake-form novalidate>
    <section class="section" aria-label="Programme details">
      <h2>Programme details</h2>
      <div class="intake-row-grid">
        <label>Organiser name<input type="text" data-intake-field="organisationLegalName" value="${escapeHtml(bundle.organisationLegalName ?? '')}" placeholder="Organisation name"></label>
        <label>Event title<input type="text" data-intake-field="eventTitle" value="${escapeHtml(bundle.eventTitle ?? '')}" placeholder="Event title"></label>
        <label>Programme title<input type="text" data-intake-field="programmeTitle" value="${escapeHtml(bundle.programmeTitle ?? '')}" placeholder="Programme title"></label>
        <label>Import reference<input type="text" data-intake-field="importKey" value="${escapeHtml(importKey)}" placeholder="Generated when previewed"><span class="field-help">Kept with this draft so a safe retry uses the same import identity.</span></label>
      </div>
    </section>
    <section class="section" aria-label="Programme sessions">
      <div class="section-head"><h2>Sessions</h2><button type="button" class="btn btn-ghost" data-add-session>Add session</button></div>
      <p class="sub">People choose session numbers as they appear here, starting at 1.</p>
      <div data-intake-sessions>${items.map((item) => sessionRow(item)).join('')}</div>
    </section>
    <section class="section" aria-label="Programme travellers">
      <div class="section-head"><h2>People and attendance</h2><button type="button" class="btn btn-ghost" data-add-traveller>Add traveller</button></div>
      <p class="sub">Use the human session numbers above. Required attendance is checked during preview.</p>
      <div data-intake-travellers>${travellers.map((traveller) => travellerRow(traveller)).join('')}</div>
    </section>
    <section class="section" aria-label="CSV roster">
      <h2>Paste or upload a roster CSV</h2>
      <p class="sub">Advanced CSV format: <code>displayName</code>, <code>participatesInItemIndices</code>, and <code>obligation</code>. This column stays zero-based for imports: <code>0</code> means the first session. Quote values such as <code>"0, 1"</code>.</p>
      <textarea data-intake-csv rows="5" placeholder="displayName,participatesInItemIndices,obligation&#10;Avery Example,\"0, 1\",REQUIRED"></textarea>
      <div class="btn-row"><button type="button" class="btn btn-ghost" data-apply-csv>Apply CSV to people</button><label class="btn btn-ghost file-button">Choose CSV file<input type="file" accept=".csv,text/csv" data-csv-file hidden></label></div>
      <p class="field-help">Applying a CSV replaces the people rows and leaves programme details and sessions unchanged.</p>
    </section>
    <section class="section" aria-label="Preview and import">
      <h2>Review before import</h2>
      <p class="sub">Preview checks the bundle on the server. Import stays unavailable until that exact draft passes.</p>
      <div class="btn-row"><button type="button" class="btn btn-primary" data-preview-programme>Preview programme</button><button type="button" class="btn btn-primary" data-import-programme disabled>Import programme</button></div>
      <p data-intake-status role="status" aria-live="polite"></p>
      <div data-intake-review hidden></div>
      <div data-intake-success hidden></div>
    </section>
  </form>
</main>${renderProgrammeIntakeController()}`;
}

