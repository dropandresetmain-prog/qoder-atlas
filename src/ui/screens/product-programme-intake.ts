/** Target programme intake screen renderer. */
import type { ProgrammeImportBundle } from '../../app/target/programmeImport.ts';
import { escapeHtml } from '../html.ts';
import { renderProgrammeIntakeController } from '../programme-intake-controller.ts';

export interface ProgrammeIntakeRenderOptions {
  initialBundle?: Partial<ProgrammeImportBundle>;
}

function sessionRow(item: Partial<ProgrammeImportBundle['items'][number]> = {}): string {
  return `<div class="panel" data-intake-session-row data-test="programme-intake-session">
    <div class="intake-row-grid">
      <label>Session title<input type="text" data-session-field="title" value="${escapeHtml(item.title ?? '')}" placeholder="Opening session"></label>
      <label>Session type<input type="text" data-session-field="itemType" value="${escapeHtml(item.itemType ?? 'SESSION')}" placeholder="SESSION"></label>
      <label>Start (ISO time with timezone)<input type="text" data-session-field="windowStart" value="${escapeHtml(item.windowStart ?? '')}" placeholder="2031-05-01T09:00:00.000Z"></label>
      <label>End (ISO time with timezone)<input type="text" data-session-field="windowEnd" value="${escapeHtml(item.windowEnd ?? '')}" placeholder="2031-05-01T10:00:00.000Z"></label>
    </div>
    <button type="button" class="btn btn-ghost" data-remove-session>Remove session</button>
  </div>`;
}

function travellerRow(traveller: Partial<ProgrammeImportBundle['travellers'][number]> = {}): string {
  const obligation = traveller.obligation ?? 'REQUIRED';
  return `<div class="panel" data-intake-traveller-row data-test="programme-intake-traveller">
    <div class="intake-row-grid">
      <label>Traveller name<input type="text" data-traveller-field="displayName" value="${escapeHtml(traveller.displayName ?? '')}" placeholder="Avery Example"></label>
      <label>Session indexes<input type="text" data-traveller-field="participatesInItemIndices" value="${escapeHtml(traveller.participatesInItemIndices?.join(', ') ?? '')}" placeholder="0, 1"></label>
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
    <p class="meta">The intake accepts sessions with confirmed ISO times and traveller attendance rows.</p>
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
      <p class="sub">Use the session index shown by its order below when assigning people.</p>
      <div data-intake-sessions>${items.map((item) => sessionRow(item)).join('')}</div>
    </section>
    <section class="section" aria-label="Programme travellers">
      <div class="section-head"><h2>People and attendance</h2><button type="button" class="btn btn-ghost" data-add-traveller>Add traveller</button></div>
      <p class="sub">Session indexes start at 0. Required attendance is checked during preview.</p>
      <div data-intake-travellers>${travellers.map((traveller) => travellerRow(traveller)).join('')}</div>
    </section>
    <section class="section" aria-label="CSV roster">
      <h2>Paste or upload a roster CSV</h2>
      <p class="sub">Supported columns: <code>displayName</code>, <code>participatesInItemIndices</code>, and <code>obligation</code>. Quote values such as <code>"0, 1"</code>.</p>
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

