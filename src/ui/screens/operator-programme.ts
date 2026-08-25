/**
 * E2 — operator programme surface (Northstar RV-N10).
 *
 * Pure projection over the frozen ProgrammeView read model: a one-page
 * summary for one AnchorEvent — the event name, a per-status tile row,
 * any endangered shared commitments, the per-traveller table (~45 rows
 * on the demo programme), an honest "missing information" panel for
 * travellers with NEEDS_TRAVELLER_INFO, and the two intake affordances
 * (single add / bulk import). Renderers are pure functions of the frozen
 * contract — no fetch, no authoritative state, no scenario branching.
 */
import type {
  ProgrammeStatusSummary,
  ProgrammeTravellerView,
  ProgrammeView,
  ReadModelEnvelope,
  ReadModelStatus,
} from '../../contracts/readmodels.ts';
import {
  PROGRAMME_ENDANGERED_TITLE,
  PROGRAMME_HEADING,
  PROGRAMME_INTAKE_ADD_LABEL,
  PROGRAMME_INTAKE_BULK_LABEL,
  PROGRAMME_MISSING_INFO_TITLE,
  PROGRAMME_SUBHEADING,
  PROGRAMME_TABLE_HEADERS,
  PROGRAMME_TILE_LABEL,
  PROGRAMME_TILES_LEGEND,
  type StatusTone,
} from '../copy.ts';
import { escapeHtml, formatInstant } from '../html.ts';
import {
  bulletList,
  errorPanel,
  loadingPanel,
  statusBadge,
  toneClass,
} from '../components.ts';

/**
 * Deterministic urgency ordering for the programme traveller table.
 * Extends the operator-dashboard priority with the programme-only
 * statuses (PLANNING, NEEDS_TRAVELLER_INFO, CHANGE_REQUESTED) in a
 * single consistent table so the dashboard and the programme screen
 * never disagree about what is most urgent.
 */
export const STATUS_PRIORITY: Record<ReadModelStatus, number> = {
  DISRUPTED: 0,
  AT_RISK: 1,
  RECOVERING: 2,
  NEEDS_TRAVELLER_INFO: 3,
  CHANGE_REQUESTED: 4,
  UNKNOWN: 5,
  PLANNING: 6,
  READY: 7,
  RESOLVED: 8,
};

/** Tile tone for each ProgrammeStatusSummary field; mirrors STATUS_TONE where possible. */
const SUMMARY_TILE_TONE: Record<keyof Omit<ProgrammeStatusSummary, 'total'>, StatusTone> = {
  ready: 'ok',
  planning: 'active',
  needsTravellerInfo: 'watch',
  changeRequested: 'active',
  atRisk: 'watch',
  disrupted: 'alert',
  recovering: 'active',
  awaitingDecision: 'alert',
  resolved: 'done',
  unknown: 'neutral',
};

/** Statuses that should be drawn to operator attention on a tile. */
const ATTENTION_KEYS: ReadonlySet<keyof ProgrammeStatusSummary> = new Set([
  'disrupted',
  'atRisk',
  'needsTravellerInfo',
  'changeRequested',
  'unknown',
]);

function tile(key: keyof ProgrammeStatusSummary, count: number, label: string, tone: StatusTone): string {
  const attention = ATTENTION_KEYS.has(key) && count > 0 ? ' is-attention' : '';
  return `
  <div class="${toneClass(tone, 'tile')}${attention}" data-summary-key="${escapeHtml(key)}">
    <div class="tile-count">${count}</div>
    <div class="tile-label">${escapeHtml(label)}</div>
  </div>`;
}

function summaryTiles(summary: ProgrammeStatusSummary): string {
  const totalTile = tile('total', summary.total, PROGRAMME_TILE_LABEL.total, 'neutral');
  const statusTiles: string = (
    [
      'ready',
      'planning',
      'needsTravellerInfo',
      'changeRequested',
      'atRisk',
      'disrupted',
      'recovering',
      'awaitingDecision',
      'resolved',
      'unknown',
    ] as ReadonlyArray<keyof Omit<ProgrammeStatusSummary, 'total'>>
  )
    .map((key) => tile(key, summary[key], PROGRAMME_TILE_LABEL[key], SUMMARY_TILE_TONE[key]))
    .join('');
  return `
  <section class="tiles" aria-label="${escapeHtml(PROGRAMME_TILES_LEGEND)}">
    ${totalTile}${statusTiles}
  </section>`;
}

function endangeredItem(item: ProgrammeView['endangeredCommitments'][number]): string {
  const affected = item.affectedTravellerIds.length;
  return `
  <li>
    <strong>${escapeHtml(item.title)}</strong>
    <span class="card-sub"> — ${escapeHtml(item.reason)}</span>
    <span class="chip">${affected} ${affected === 1 ? 'traveller' : 'travellers'} affected</span>
  </li>`;
}

function endangeredSection(items: readonly ProgrammeView['endangeredCommitments'][number][]): string {
  if (items.length === 0) return '';
  return `
  <section class="section" aria-label="${escapeHtml(PROGRAMME_ENDANGERED_TITLE)}">
    <h2>${escapeHtml(PROGRAMME_ENDANGERED_TITLE)}</h2>
    <div class="panel callout tone-alert" data-ui-section="endangered-commitments">
      <ul class="plain-list">${items.map(endangeredItem).join('')}</ul>
    </div>
  </section>`;
}

function orderTravellers(rows: readonly ProgrammeTravellerView[]): ProgrammeTravellerView[] {
  return [...rows].sort((a, b) => {
    const diff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (diff !== 0) return diff;
    return a.travellerId.localeCompare(b.travellerId);
  });
}

function travellerRow(row: ProgrammeTravellerView): string {
  const uncertainties = row.uncertainties.length
    ? `<ul class="plain-list">${row.uncertainties.map((u) => `<li>${escapeHtml(u)}</li>`).join('')}</ul>`
    : `<p class="empty-note">—</p>`;
  const firstActiveCaseId = row.activeCaseIds[0];
  const caseLink = firstActiveCaseId
    ? `/operator/cases/${escapeHtml(firstActiveCaseId)}`
    : `/traveller?trip=${escapeHtml(row.tripId)}`;
  const actionIndicator = row.decisionsRequired > 0
    ? `<span class="action-indicator" title="${row.decisionsRequired} action${row.decisionsRequired === 1 ? '' : 's'} required">⚡</span>`
    : '';
  return `
    <tr data-trip-id="${escapeHtml(row.tripId)}" data-traveller-id="${escapeHtml(row.travellerId)}" data-status="${escapeHtml(row.status)}">
      <td><a href="${caseLink}" class="traveller-link" data-test="programme-traveller-link">${escapeHtml(row.travellerName)}${actionIndicator}</a></td>
      <td>${statusBadge(row.status)}</td>
      <td>${row.activeCaseIds.length}</td>
      <td>${row.decisionsRequired}</td>
      <td>${uncertainties}</td>
    </tr>`;
}

function travellerTable(rows: readonly ProgrammeTravellerView[]): string {
  const sorted = orderTravellers(rows);
  const header = `
    <thead>
      <tr>
        <th scope="col">${escapeHtml(PROGRAMME_TABLE_HEADERS.name)}</th>
        <th scope="col">${escapeHtml(PROGRAMME_TABLE_HEADERS.status)}</th>
        <th scope="col">${escapeHtml(PROGRAMME_TABLE_HEADERS.cases)}</th>
        <th scope="col">${escapeHtml(PROGRAMME_TABLE_HEADERS.decisions)}</th>
        <th scope="col">${escapeHtml(PROGRAMME_TABLE_HEADERS.uncertainties)}</th>
      </tr>
    </thead>`;
  return `
  <section class="section" aria-label="Travellers">
    <h2>Travellers</h2>
    <div class="panel" data-ui-section="traveller-table">
      <table class="traveller-table">
        ${header}
        <tbody>${sorted.map(travellerRow).join('')}</tbody>
      </table>
      <p class="footnote">Ordered by what needs attention first; ties broken by traveller id.</p>
    </div>
  </section>`;
}

interface MissingInfoEntry {
  travellerName: string;
  prompt: string;
}

function collectMissingInfo(view: ProgrammeView): MissingInfoEntry[] {
  const entries: MissingInfoEntry[] = [];
  for (const traveller of view.travellers) {
    if (traveller.status !== 'NEEDS_TRAVELLER_INFO') continue;
    for (const prompt of traveller.uncertainties) {
      entries.push({ travellerName: traveller.travellerName, prompt });
    }
  }
  return entries;
}

function missingInformationPanel(view: ProgrammeView): string {
  const entries = collectMissingInfo(view);
  if (entries.length === 0) return '';
  const items = entries
    .map(
      (entry) =>
        `<li><strong>${escapeHtml(entry.travellerName)}</strong> — ${escapeHtml(entry.prompt)}</li>`,
    )
    .join('');
  const programmeWide = view.unresolvedUncertainties.length
    ? bulletList(view.unresolvedUncertainties, '')
    : '';
  return `
  <section class="section" aria-label="${escapeHtml(PROGRAMME_MISSING_INFO_TITLE)}">
    <h2>${escapeHtml(PROGRAMME_MISSING_INFO_TITLE)}</h2>
    <div class="panel callout tone-watch" data-ui-section="missing-info">
      <ul class="plain-list">${items}</ul>
      ${programmeWide}
      <p class="footnote">Nothing here is guessed. The list mirrors what the travellers and the system have not confirmed yet.</p>
    </div>
  </section>`;
}

function intakeAffordances(): string {
  return `
  <section class="section" aria-label="Add travellers">
    <h2>Add travellers to this programme</h2>
    <div class="panel" data-ui-section="intake">
      <p class="card-sub">Bring new travellers into the programme through one of the two paths below.</p>
      <ul class="plain-list">
        <li>
          <a class="chip" href="/programme/intake">${escapeHtml(PROGRAMME_INTAKE_ADD_LABEL)}</a>
          <span class="card-sub"> — for a single traveller, entered by hand.</span>
        </li>
        <li>
          <a class="chip" href="/programme/import">${escapeHtml(PROGRAMME_INTAKE_BULK_LABEL)}</a>
          <span class="card-sub"> — for a list of travellers from a file or a brief.</span>
        </li>
      </ul>
    </div>
  </section>`;
}

function arrangementPanel(view: ProgrammeView): string {
  const counts = view.arrangementCounts;
  const rows = [
    { label: 'Travel arranged by us', count: counts.northstarArranged, key: 'northstar-arranged' },
    { label: 'Travelling on their own arrangements', count: counts.selfOrOtherArranged, key: 'self-or-other-arranged' },
    { label: 'Not declared yet', count: counts.unspecified, key: 'unspecified' },
  ]
    .map(
      (row) => `
      <div class="arrangement-row" data-arrangement="${escapeHtml(row.key)}">
        <span class="tile-label">${escapeHtml(row.label)}</span>
        <span class="tile-count">${row.count}</span>
      </div>`,
    )
    .join('');
  return `
  <section class="section" aria-label="Travel arrangements">
    <h2>Travel arrangements</h2>
    <div class="panel" data-ui-section="arrangements">
      <p class="card-sub">${counts.total} people on this programme</p>
      ${rows}
      <p class="footnote">Counts reflect what the organiser declared at intake. Undeclared travellers are shown as "not declared yet" — nothing is guessed.</p>
    </div>
  </section>`;
}

/** Programme body from a loaded view (also used directly by tests). */
export function renderProgrammeBody(view: ProgrammeView): string {
  return `
<main class="shell">
  <div class="page-head">
    <h1>${escapeHtml(PROGRAMME_HEADING)} — ${escapeHtml(view.anchorEventName)}</h1>
    <p class="sub">${escapeHtml(PROGRAMME_SUBHEADING)}</p>
    <p class="meta">Generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  ${summaryTiles(view.summary)}
  ${arrangementPanel(view)}
  ${endangeredSection(view.endangeredCommitments)}
  ${travellerTable(view.travellers)}
  ${missingInformationPanel(view)}
  ${intakeAffordances()}
</main>`;
}

/** Full programme screen from the frozen envelope; honest about loading/error. */
export function renderProgramme(envelope: ReadModelEnvelope<ProgrammeView>): string {
  if (envelope.state === 'LOADING') {
    return `<main class="shell">${loadingPanel('Loading the programme', 'We are gathering the latest confirmed trip information for this event.')}</main>`;
  }
  if (envelope.state === 'ERROR') {
    return `<main class="shell">${errorPanel('The programme is unavailable right now', envelope.errorMessage)}</main>`;
  }
  if (!envelope.data) {
    return `<main class="shell">${errorPanel('The programme is unavailable right now')}</main>`;
  }
  return renderProgrammeBody(envelope.data);
}
