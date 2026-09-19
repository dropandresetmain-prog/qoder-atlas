/**
 * Browser controller for the target programme intake surface.
 *
 * The browser only collects a typed ProgrammeImportBundle, asks the server to
 * preview it, and submits the exact reviewed bundle after an explicit review.
 * It never interprets preview HTML or applies programme state locally.
 */
import type { ProgrammeImportBundle } from '../app/target/programmeImport.ts';

export type ProgrammeCsvTravellerRow = ProgrammeImportBundle['travellers'][number];

export interface ProgrammeIntakePreviewSummary {
  sessions: number;
  travellers: number;
}

/** Contract for the endpoint that the primary target handler will add. */
export type ProgrammeIntakePreviewResponse =
  | {
      bundle: ProgrammeImportBundle;
      summary: ProgrammeIntakePreviewSummary;
      mutatesAuthoritativeState: false;
    }
  | { error: string; message: string; issues?: { field: string; message: string }[] };

type CsvRows = { ok: true; rows: string[][] } | { ok: false; error: string };

/** Small pure CSV tokenizer for the exact intake template. */
function parseCsvRows(text: string): CsvRows {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }
  if (quoted) return { ok: false, error: 'unterminated quoted field' };
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  }
  return { ok: true, rows };
}

/**
 * Parse the documented intake CSV template. The item indices are deliberately
 * kept as bundle indices because the importer contract has no CSV-specific
 * identifier field.
 */
export function parseProgrammeIntakeCsv(text: string): { rows: ProgrammeCsvTravellerRow[]; errors: string[] } {
  const parsed = parseCsvRows(text);
  if (!parsed.ok) return { rows: [], errors: [`CSV could not be read: ${parsed.error}.`] };
  if (parsed.rows.length === 0) return { rows: [], errors: ['CSV is empty.'] };
  const headers = parsed.rows[0]!.map((header) => header.trim().toLowerCase().replace(/[._]+/g, ' ').replace(/\s+/g, ' '));
  const findHeader = (...names: string[]) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
  const nameIndex = findHeader('displayname', 'display name', 'full name', 'name', 'traveller', 'traveller name');
  const itemIndex = findHeader('participatesinitemindices', 'participates in item indices', 'session indexes', 'session indices', 'sessions');
  const obligationIndex = findHeader('obligation');
  const errors: string[] = [];
  if (nameIndex < 0) errors.push('CSV needs a displayName column.');
  if (itemIndex < 0) errors.push('CSV needs a participatesInItemIndices column.');
  if (errors.length > 0) return { rows: [], errors };

  const rows: ProgrammeCsvTravellerRow[] = [];
  for (let rowNumber = 1; rowNumber < parsed.rows.length; rowNumber += 1) {
    const cells = parsed.rows[rowNumber]!;
    const displayName = cells[nameIndex]!.trim();
    const rawIndices = cells[itemIndex]!.trim();
    const rawObligation = obligationIndex >= 0 ? (cells[obligationIndex] ?? '').trim().toUpperCase() : 'REQUIRED';
    if (!displayName) {
      errors.push(`Row ${rowNumber + 1} needs a display name.`);
      continue;
    }
    const indices = rawIndices
      .split(/[;,]/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => Number(value));
    if (indices.length === 0 || indices.some((value) => !Number.isInteger(value) || value < 0)) {
      errors.push(`Row ${rowNumber + 1} needs one or more non-negative session indices.`);
      continue;
    }
    if (new Set(indices).size !== indices.length) {
      errors.push(`Row ${rowNumber + 1} repeats a session index.`);
      continue;
    }
    if (rawObligation !== 'REQUIRED' && rawObligation !== 'OPTIONAL') {
      errors.push(`Row ${rowNumber + 1} obligation must be REQUIRED or OPTIONAL.`);
      continue;
    }
    rows.push({ displayName, participatesInItemIndices: indices, obligation: rawObligation });
  }
  return { rows, errors };
}

export function renderProgrammeIntakeController(): string {
  return `<script data-programme-intake-controller>
(function () {
  'use strict';
  var parseCsvRows = ${parseCsvRows.toString()};
  var parseProgrammeIntakeCsv = ${parseProgrammeIntakeCsv.toString()};
  var root = document.querySelector('[data-programme-intake]');
  if (!root || root.__programmeIntakeInit) return;
  root.__programmeIntakeInit = true;
  var form = root.querySelector('[data-programme-intake-form]');
  var sessions = root.querySelector('[data-intake-sessions]');
  var travellers = root.querySelector('[data-intake-travellers]');
  var previewButton = root.querySelector('[data-preview-programme]');
  var importButton = root.querySelector('[data-import-programme]');
  var status = root.querySelector('[data-intake-status]');
  var review = root.querySelector('[data-intake-review]');
  var success = root.querySelector('[data-intake-success]');
  var pendingBundle = null;

  function field(name) { return root.querySelector('[data-intake-field="' + name + '"]'); }
  function value(element) { return element ? String(element.value || '').trim() : ''; }
  function setStatus(message) { status.textContent = message; }
  function invalidate() {
    pendingBundle = null;
    importButton.disabled = true;
    review.hidden = true;
    success.hidden = true;
  }
  function addSession(item) {
    var row = document.createElement('div');
    row.className = 'panel';
    row.setAttribute('data-intake-session-row', '');
    row.setAttribute('data-test', 'programme-intake-session');
    row.innerHTML = '<div class="intake-row-grid"><label>Session title<input type="text" data-session-field="title" placeholder="Opening session"></label><label>Session type<input type="text" data-session-field="itemType" value="SESSION" placeholder="SESSION"></label><label>Start (ISO time with timezone)<input type="text" data-session-field="windowStart" placeholder="2031-05-01T09:00:00.000Z"></label><label>End (ISO time with timezone)<input type="text" data-session-field="windowEnd" placeholder="2031-05-01T10:00:00.000Z"></label></div><button type="button" class="btn btn-ghost" data-remove-session>Remove session</button>';
    var fields = row.querySelectorAll('[data-session-field]');
    if (item) Array.prototype.forEach.call(fields, function (input) { if (item[input.getAttribute('data-session-field')]) input.value = item[input.getAttribute('data-session-field')]; });
    sessions.appendChild(row);
  }
  function addTraveller(rowData) {
    var row = document.createElement('div');
    row.className = 'panel';
    row.setAttribute('data-intake-traveller-row', '');
    row.setAttribute('data-test', 'programme-intake-traveller');
    row.innerHTML = '<div class="intake-row-grid"><label>Traveller name<input type="text" data-traveller-field="displayName" placeholder="Avery Example"></label><label>Session indexes<input type="text" data-traveller-field="participatesInItemIndices" placeholder="0, 1"></label><label>Attendance requirement<select data-traveller-field="obligation"><option value="REQUIRED">Required</option><option value="OPTIONAL">Optional</option></select></label></div><button type="button" class="btn btn-ghost" data-remove-traveller>Remove traveller</button>';
    if (rowData) {
      row.querySelector('[data-traveller-field="displayName"]').value = rowData.displayName || '';
      row.querySelector('[data-traveller-field="participatesInItemIndices"]').value = rowData.participatesInItemIndices.join(', ');
      row.querySelector('[data-traveller-field="obligation"]').value = rowData.obligation || 'REQUIRED';
    }
    travellers.appendChild(row);
  }
  function collectBundle() {
    var errors = [];
    var organisationLegalName = value(field('organisationLegalName'));
    var eventTitle = value(field('eventTitle'));
    var programmeTitle = value(field('programmeTitle'));
    var importKey = value(field('importKey'));
    if (!importKey) { importKey = 'programme-intake-' + Date.now().toString(36); field('importKey').value = importKey; }
    if (!organisationLegalName) errors.push('Add an organiser name.');
    if (!eventTitle) errors.push('Add an event title.');
    if (!programmeTitle) errors.push('Add a programme title.');
    var items = Array.prototype.map.call(sessions.querySelectorAll('[data-intake-session-row]'), function (row, index) {
      var item = {};
      Array.prototype.forEach.call(row.querySelectorAll('[data-session-field]'), function (input) { item[input.getAttribute('data-session-field')] = value(input); });
      if (!item.title || !item.itemType || !item.windowStart || !item.windowEnd) errors.push('Complete every field for session ' + (index + 1) + '.');
      if (item.windowStart && item.windowEnd && !(Date.parse(item.windowStart) < Date.parse(item.windowEnd))) errors.push('Session ' + (index + 1) + ' must end after it starts.');
      return item;
    });
    if (items.length === 0) errors.push('Add at least one session.');
    var people = Array.prototype.map.call(travellers.querySelectorAll('[data-intake-traveller-row]'), function (row, rowIndex) {
      var displayName = value(row.querySelector('[data-traveller-field="displayName"]'));
      var rawIndices = value(row.querySelector('[data-traveller-field="participatesInItemIndices"]'));
      var indices = rawIndices.split(/[;,]/).map(function (part) { return Number(part.trim()); }).filter(function (part) { return Number.isFinite(part); });
      var obligation = value(row.querySelector('[data-traveller-field="obligation"]')) || 'REQUIRED';
      if (!displayName) errors.push('Add a name for person ' + (rowIndex + 1) + '.');
      if (indices.length === 0 || indices.some(function (index) { return !Number.isInteger(index) || index < 0 || index >= items.length; })) errors.push('Use valid session indexes for ' + (displayName || ('person ' + (rowIndex + 1))) + '.');
      if (new Set(indices).size !== indices.length) errors.push('Remove repeated session indexes for ' + (displayName || ('person ' + (rowIndex + 1))) + '.');
      return { displayName: displayName, participatesInItemIndices: indices, obligation: obligation };
    });
    if (people.length === 0) errors.push('Add at least one person.');
    if (errors.length > 0) { setStatus(errors.join(' ')); return null; }
    return { importKey: importKey, organisationLegalName: organisationLegalName, eventTitle: eventTitle, programmeTitle: programmeTitle, items: items, travellers: people };
  }
  function appendText(parent, tag, text) { var node = document.createElement(tag); node.textContent = text; parent.appendChild(node); return node; }
  function renderReview(bundle, response) {
    review.replaceChildren();
    var title = document.createElement('h3'); title.textContent = 'Server preview'; review.appendChild(title);
    appendText(review, 'p', (response.summary ? response.summary.travellers : bundle.travellers.length) + ' people across ' + (response.summary ? response.summary.sessions : bundle.items.length) + ' sessions.');
    var sessionsList = document.createElement('ul');
    bundle.items.forEach(function (item) { appendText(sessionsList, 'li', item.title + ' · ' + item.windowStart + ' to ' + item.windowEnd); });
    review.appendChild(sessionsList);
    var peopleList = document.createElement('ul');
    bundle.travellers.forEach(function (person) { appendText(peopleList, 'li', person.displayName + ' · sessions ' + person.participatesInItemIndices.join(', ') + ' · ' + person.obligation.toLowerCase()); });
    review.appendChild(peopleList);
    var errors = Array.isArray(response.errors) ? response.errors : (Array.isArray(response.issues) ? response.issues.map(function (issue) { return issue.field + ': ' + issue.message; }) : []);
    if (errors.length > 0) { var errorList = document.createElement('ul'); errors.forEach(function (error) { appendText(errorList, 'li', String(error)); }); review.appendChild(errorList); }
    review.hidden = false;
  }
  function parseResponse(response) { return response.text().then(function (body) { var data; try { data = JSON.parse(body); } catch (error) { data = {}; } return { ok: response.ok, data: data }; }); }
  function preview() {
    var bundle = collectBundle();
    if (!bundle) return;
    pendingBundle = null; previewButton.disabled = true; importButton.disabled = true; setStatus('Checking this programme…');
    fetch('/api/v2/programme/import/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(bundle) }).then(parseResponse).then(function (result) {
      if (!result.ok || !result.data || !result.data.bundle) {
        if (result.data) renderReview(bundle, result.data);
        throw new Error((result.data && result.data.message) || 'The programme could not be previewed.');
      }
      renderReview(bundle, result.data);
      pendingBundle = bundle; importButton.disabled = false; setStatus('Preview ready. Nothing has been imported.');
    }).catch(function (error) { setStatus(error && error.message ? error.message : 'The programme could not be previewed.'); }).then(function () { previewButton.disabled = false; });
  }
  function importProgramme() {
    if (!pendingBundle) { setStatus('Preview the programme before importing it.'); return; }
    var bundle = pendingBundle; pendingBundle = null; previewButton.disabled = true; importButton.disabled = true; setStatus('Adding the reviewed programme…');
    fetch('/api/v2/programme/import', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(bundle) }).then(parseResponse).then(function (result) {
      if (!result.ok) throw new Error((result.data && result.data.message) || 'The programme could not be added.');
      success.replaceChildren(); appendText(success, 'p', 'Programme added: ' + bundle.travellers.length + ' people across ' + bundle.items.length + ' sessions are on file.');
      var link = document.createElement('a'); link.href = '/programme'; link.textContent = 'Open programme'; success.appendChild(link); success.hidden = false; setStatus('Import complete.');
    }).catch(function (error) { pendingBundle = bundle; importButton.disabled = false; setStatus(error && error.message ? error.message + ' Your draft is still here; you can retry safely.' : 'Import failed. Your draft is still here; you can retry safely.'); }).then(function () { previewButton.disabled = false; });
  }
  root.addEventListener('input', invalidate);
  root.addEventListener('change', invalidate);
  root.addEventListener('click', function (event) {
    var target = event.target;
    if (target.matches('[data-add-session]')) { addSession(); invalidate(); }
    if (target.matches('[data-add-traveller]')) { addTraveller(); invalidate(); }
    if (target.matches('[data-remove-session]')) { target.closest('[data-intake-session-row]').remove(); invalidate(); }
    if (target.matches('[data-remove-traveller]')) { target.closest('[data-intake-traveller-row]').remove(); invalidate(); }
    if (target.matches('[data-apply-csv]')) {
      var parsed = parseProgrammeIntakeCsv(value(root.querySelector('[data-intake-csv]')));
      if (parsed.errors.length > 0) { setStatus(parsed.errors.join(' ')); return; }
      travellers.replaceChildren(); parsed.rows.forEach(addTraveller); invalidate(); setStatus('CSV people rows applied. Review the assignments before previewing.');
    }
    if (target.matches('[data-preview-programme]')) preview();
    if (target.matches('[data-import-programme]')) importProgramme();
  });
  root.querySelector('[data-csv-file]').addEventListener('change', function (event) {
    var file = event.target.files && event.target.files[0]; if (!file) return;
    file.text().then(function (text) { root.querySelector('[data-intake-csv]').value = text; setStatus('CSV loaded. Apply it to people when ready.'); });
  });
})();
</script>`;
}
