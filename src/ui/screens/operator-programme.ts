/**
 * E2 — operator programme surface (Northstar RV-N10), approved P1/P2 design.
 *
 * Pure projection over the frozen ProgrammeView read model plus optional,
 * additive augmentations for what the frozen contract does not carry yet
 * (per-day commitment timeline, traveller role/arrival summaries, case links
 * for endangered commitments, change-preview notices). Augmentations are an
 * integrator contract: the screen renders them when present and omits the
 * decoration when absent — the gap is reported, never hardcoded around.
 *
 * Approved summary tiles aggregate the frozen per-status counts into the
 * programme-health vocabulary used consistently across the P1/P2/E1/E2
 * renders: Travellers · On track · Watching · In recovery · Unconfirmed ·
 * Endangered commitments. DISRUPTED trips surface through the endangered-
 * commitment callouts and the attention-first traveller table, matching the
 * approved screens; a zero-count alert/watch tile renders tone-ok ("nothing
 * wrong"), which is the approved zero-state treatment.
 *
 * No fetch, no authoritative state, no scenario branching.
 */
import type {
  EndangeredCommitmentView,
  ProgrammeTravellerView,
  ProgrammeView,
  ReadModelEnvelope,
  ReadModelStatus,
} from '../../contracts/readmodels.ts';
import {
  PROGRAMME_ASK_TRAVELLERS_LABEL,
  PROGRAMME_CHANGE_PREVIEW_LABEL,
  PROGRAMME_ENDANGERED_TITLE,
  PROGRAMME_EXPORT_LABEL,
  PROGRAMME_HEADING,
  PROGRAMME_IMPORT_UPDATED_LABEL,
  PROGRAMME_MESSAGE_AFFECTED_LABEL,
  PROGRAMME_MISSING_INFO_TITLE,
  PROGRAMME_SUBHEADING,
  PROGRAMME_TABLE_HEADERS,
  PROGRAMME_TILE_LABEL,
  PROGRAMME_TILES_LEGEND,
  PROGRAMME_TIMELINE_TITLE,
  type StatusTone,
} from '../copy.ts';
import { escapeHtml, formatInstant } from '../html.ts';
import {
  bulletList,
  errorPanel,
  loadingPanel,
  statusBadge,
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

// ---------------------------------------------------------------------------
// Integrator augmentation contracts (optional, additive; never fabricated)
// ---------------------------------------------------------------------------

/** Tone for one timeline commitment: ok / watching / endangered. */
export type ProgrammeTimelineTone = 'ok' | 'watch' | 'endangered';

/** One commitment on the programme timeline. Display strings are formatted
 * by the projection (it owns the event timezone); the UI never re-times. */
export interface ProgrammeTimelineItemView {
  /** Stable identity, used to mark freshly changed items after a commit. */
  key: string;
  /** Event-local time label, e.g. "08:30". */
  timeLabel: string;
  title: string;
  /** Right-aligned note (venue, owner, or why it is watching). */
  tag?: string;
  tone: ProgrammeTimelineTone;
}

/** One day column of the programme timeline. */
export interface ProgrammeTimelineDayView {
  /** Event-local day label, e.g. "Tue 30 Sep". */
  dateLabel: string;
  items: readonly ProgrammeTimelineItemView[];
}

/** A proposed-but-uncommitted programme change notice (tone-watch callout). */
export interface ProgrammeChangeNotice {
  title: string;
  body: string;
  href?: string;
  linkLabel?: string;
}

/** Confirmation callout shown after a programme change is committed (E2). */
export interface ProgrammeCommittedNotice {
  title: string;
  body: string;
  footnote?: string;
}

/**
 * Optional, additive programme data the frozen read model does not carry
 * yet. Every field renders only when the projection supplies it.
 */
export interface ProgrammeAugmentations {
  /** Commitments grouped by event day for the approved timeline section. */
  timeline?: readonly ProgrammeTimelineDayView[];
  /** Role/organisation line for a traveller row (from the intake profile). */
  roleFor?: (traveller: ProgrammeTravellerView) => string | undefined;
  /** Arrival summary for a traveller row (event-local, projection-formatted). */
  arrivalFor?: (traveller: ProgrammeTravellerView) => string | undefined;
  /** Link to the open recovery case for an endangered commitment. */
  commitmentHrefFor?: (item: EndangeredCommitmentView) => { href: string; label: string } | undefined;
  /** Proposed-change preview notices (tone-watch callouts above the timeline). */
  changeNotices?: readonly ProgrammeChangeNotice[];
  /** Committed-change confirmation callout (E2 after-commit state). */
  committedNotice?: ProgrammeCommittedNotice;
  /** Timeline item keys changed by the latest commit (just-changed wash). */
  justChangedTimelineKeys?: ReadonlySet<string>;
  /** Trip ids whose rows changed with the latest commit (just-changed wash). */
  justChangedTripIds?: ReadonlySet<string>;
  /** Footer action targets; rendered only when provided. */
  changePreviewHref?: string;
  importHref?: string;
}

/** Default bulk-import target used when the integrator does not override it. */
const DEFAULT_IMPORT_HREF = '/programme/import';

// ---------------------------------------------------------------------------
// Summary tiles — the approved six-bucket programme-health vocabulary
// ---------------------------------------------------------------------------

interface TileSpec {
  key: string;
  count: number;
  label: string;
  tone: StatusTone;
  attention?: boolean;
}

function tile(spec: TileSpec, index: number): string {
  const attention = spec.attention && spec.count > 0 ? ' is-attention' : '';
  return `
  <div class="tile tone-${spec.tone}${attention}" style="--i:${index}" data-summary-key="${escapeHtml(spec.key)}">
    <div class="tile-count">${spec.count}</div>
    <div class="tile-label">${escapeHtml(spec.label)}</div>
  </div>`;
}

/**
 * Aggregate the frozen per-status summary into the approved buckets. A zero
 * count on an alert/watch/active bucket is good news and renders tone-ok —
 * the approved zero-state treatment from the healthy programme render.
 */
function summaryTiles(view: ProgrammeView): string {
  const summary = view.summary;
  const onTrack = summary.ready + summary.resolved;
  const watching = summary.atRisk + summary.needsTravellerInfo;
  const inRecovery = summary.recovering + summary.changeRequested + summary.awaitingDecision;
  const activeIssues =
    summary.disrupted +
    summary.atRisk +
    summary.needsTravellerInfo +
    summary.recovering +
    summary.changeRequested +
    summary.awaitingDecision +
    summary.planning;
  const specs: TileSpec[] = [
    { key: 'total', count: summary.total, label: PROGRAMME_TILE_LABEL.total, tone: 'neutral' },
    {
      key: 'on-track',
      count: onTrack,
      label: activeIssues === 0 ? PROGRAMME_TILE_LABEL.onTrackCalm : PROGRAMME_TILE_LABEL.onTrackActive,
      tone: 'ok',
    },
    { key: 'watching', count: watching, label: PROGRAMME_TILE_LABEL.watching, tone: watching > 0 ? 'watch' : 'ok' },
    { key: 'in-recovery', count: inRecovery, label: PROGRAMME_TILE_LABEL.inRecovery, tone: inRecovery > 0 ? 'active' : 'ok' },
  ];
  if (summary.planning > 0) {
    specs.push({ key: 'being-planned', count: summary.planning, label: PROGRAMME_TILE_LABEL.beingPlanned, tone: 'active' });
  }
  specs.push(
    { key: 'unconfirmed', count: summary.unknown, label: PROGRAMME_TILE_LABEL.unconfirmed, tone: 'neutral' },
    {
      key: 'endangered-commitments',
      count: view.endangeredCommitments.length,
      label: PROGRAMME_TILE_LABEL.endangered,
      tone: view.endangeredCommitments.length > 0 ? 'alert' : 'ok',
      attention: true,
    },
  );
  return `
  <div class="tiles stagger" role="group" aria-label="${escapeHtml(PROGRAMME_TILES_LEGEND)}">
    ${specs.map(tile).join('')}
  </div>`;
}

// ---------------------------------------------------------------------------
// Committed-change notice (E2) and endangered commitments (P2)
// ---------------------------------------------------------------------------

function committedNoticeCallout(notice: ProgrammeCommittedNotice): string {
  return `
  <div class="callout tone-active" data-ui-section="committed-notice">
    <h3>${escapeHtml(notice.title)}</h3>
    <p>${escapeHtml(notice.body)}</p>
    ${notice.footnote ? `<p class="footnote" style="margin-top:8px">${escapeHtml(notice.footnote)}</p>` : ''}
  </div>`;
}

function endangeredCallout(
  item: EndangeredCommitmentView,
  augment: ProgrammeAugmentations,
): string {
  const affected = item.affectedTravellerIds.length;
  const link = augment.commitmentHrefFor?.(item);
  const action = link
    ? `<div class="btn-row"><a class="btn btn-ghost" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></div>`
    : '';
  return `
  <div class="callout tone-alert" data-commitment-id="${escapeHtml(item.commitmentId)}">
    <h3>${escapeHtml(item.title)}</h3>
    <p>${escapeHtml(item.reason)} — ${affected} ${affected === 1 ? 'traveller' : 'travellers'} affected.</p>
    ${action}
  </div>`;
}

function changeNoticeCallout(notice: ProgrammeChangeNotice): string {
  const action = notice.href
    ? `<div class="btn-row"><a class="btn btn-ghost" href="${escapeHtml(notice.href)}">${escapeHtml(notice.linkLabel ?? 'Review the preview →')}</a></div>`
    : '';
  return `
  <div class="callout tone-watch">
    <h3>${escapeHtml(notice.title)}</h3>
    <p>${escapeHtml(notice.body)}</p>
    ${action}
  </div>`;
}

function endangeredSection(view: ProgrammeView, augment: ProgrammeAugmentations): string {
  const notices = augment.changeNotices ?? [];
  const items = view.endangeredCommitments;
  if (items.length === 0 && notices.length === 0) return '';
  const countBadge = items.length > 0 ? ` <span class="count c-alert">${items.length}</span>` : '';
  return `
  <section class="section" aria-label="${escapeHtml(PROGRAMME_ENDANGERED_TITLE)}" data-ui-section="endangered-commitments">
    <h2>${escapeHtml(PROGRAMME_ENDANGERED_TITLE)}${countBadge}</h2>
    ${items.map((item) => endangeredCallout(item, augment)).join('')}
    ${notices.map(changeNoticeCallout).join('')}
  </section>`;
}

// ---------------------------------------------------------------------------
// Programme timeline (augmentation; section omitted entirely when absent)
// ---------------------------------------------------------------------------

function timelineItem(item: ProgrammeTimelineItemView, justChanged: boolean): string {
  const classes = [
    'tl-item',
    item.tone === 'endangered' ? 'endangered' : '',
    justChanged ? 'just-changed' : '',
  ].filter(Boolean).join(' ');
  const dotClass = item.tone === 'ok' ? 'd-ok' : item.tone === 'watch' ? 'd-watch' : '';
  return `<div class="${classes}" data-timeline-key="${escapeHtml(item.key)}"><span class="dot ${dotClass}"></span><span class="t">${escapeHtml(item.timeLabel)}</span><span class="ttl">${escapeHtml(item.title)}</span>${item.tag ? `<span class="tag">${escapeHtml(item.tag)}</span>` : ''}</div>`;
}

function timelineSection(
  timeline: readonly ProgrammeTimelineDayView[],
  augment: ProgrammeAugmentations,
): string {
  if (timeline.length === 0) return '';
  const itemCount = timeline.reduce((sum, day) => sum + day.items.length, 0);
  const countLabel = `${itemCount} ${itemCount === 1 ? 'commitment' : 'commitments'} · ${timeline.length} ${timeline.length === 1 ? 'day' : 'days'}`;
  const days = timeline
    .map(
      (day) => `
      <div class="tl-day">
        <div class="tl-date">${escapeHtml(day.dateLabel)}</div>
        <div class="tl-items">${day.items.map((item) => timelineItem(item, augment.justChangedTimelineKeys?.has(item.key) ?? false)).join('')}</div>
      </div>`,
    )
    .join('');
  return `
  <section class="section" aria-label="${escapeHtml(PROGRAMME_TIMELINE_TITLE)}">
    <h2>${escapeHtml(PROGRAMME_TIMELINE_TITLE)} <span class="count">${escapeHtml(countLabel)}</span></h2>
    <div class="timeline">${days}
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Traveller table — approved columns: Traveller · Role · Arrival · Status
// ---------------------------------------------------------------------------

function orderTravellers(rows: readonly ProgrammeTravellerView[]): ProgrammeTravellerView[] {
  return [...rows].sort((a, b) => {
    const diff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
    if (diff !== 0) return diff;
    return a.travellerId.localeCompare(b.travellerId);
  });
}

function travellerRow(row: ProgrammeTravellerView, augment: ProgrammeAugmentations): string {
  const firstActiveCaseId = row.activeCaseIds[0];
  const name = `<strong>${escapeHtml(row.travellerName)}</strong>`;
  const nameCell = firstActiveCaseId
    ? `<a href="/operator/cases/${escapeHtml(firstActiveCaseId)}" class="traveller-link" data-test="programme-traveller-link">${name}</a>`
    : `<span class="traveller-name">${name}</span>`;
  const role = augment.roleFor?.(row) ?? '—';
  const arrival = augment.arrivalFor?.(row) ?? '—';
  const justChanged = augment.justChangedTripIds?.has(row.tripId) ?? false;
  return `
    <tr${justChanged ? ' class="just-changed"' : ''} data-trip-id="${escapeHtml(row.tripId)}" data-traveller-id="${escapeHtml(row.travellerId)}" data-status="${escapeHtml(row.status)}">
      <td>${nameCell}</td>
      <td>${escapeHtml(role)}</td>
      <td class="num">${escapeHtml(arrival)}</td>
      <td>${statusBadge(row.status)}</td>
    </tr>`;
}

function travellerTable(view: ProgrammeView, augment: ProgrammeAugmentations): string {
  const sorted = orderTravellers(view.travellers);
  const header = `
    <thead>
      <tr>
        <th scope="col">${escapeHtml(PROGRAMME_TABLE_HEADERS.name)}</th>
        <th scope="col">${escapeHtml(PROGRAMME_TABLE_HEADERS.role)}</th>
        <th scope="col">${escapeHtml(PROGRAMME_TABLE_HEADERS.arrival)}</th>
        <th scope="col">${escapeHtml(PROGRAMME_TABLE_HEADERS.status)}</th>
      </tr>
    </thead>`;
  return `
  <section class="section" aria-label="Travellers">
    <h2>Travellers <span class="count">${view.travellers.length}</span></h2>
    <div class="panel table-panel" data-ui-section="traveller-table">
      <div class="table-scroll" tabindex="0" aria-label="Programme traveller roster">
      <table class="traveller-table">
        ${header}
        <tbody>${sorted.map((row) => travellerRow(row, augment)).join('')}</tbody>
      </table>
      </div>
      <p class="footnote">Ordered by what needs attention first; ties broken by traveller id.</p>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Missing traveller information (approved icon-list panel)
// ---------------------------------------------------------------------------

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
        `<li><span class="ic ic-unknown" aria-hidden="true">?</span><span><strong>${escapeHtml(entry.travellerName)}</strong> — ${escapeHtml(entry.prompt)}</span></li>`,
    )
    .join('');
  const programmeWide = view.unresolvedUncertainties.length
    ? bulletList(view.unresolvedUncertainties, '')
    : '';
  return `
  <section class="section" aria-label="${escapeHtml(PROGRAMME_MISSING_INFO_TITLE)}">
    <h2>${escapeHtml(PROGRAMME_MISSING_INFO_TITLE)} <span class="count">${entries.length}</span></h2>
    <div class="panel" data-ui-section="missing-info">
      <ul class="icon-list">${items}</ul>
      ${programmeWide}
      <div class="btn-row">
        <span class="btn btn-ghost">${escapeHtml(PROGRAMME_ASK_TRAVELLERS_LABEL)}</span>
      </div>
      <p class="footnote">Nothing here is guessed. The list mirrors what the travellers and the system have not confirmed yet.</p>
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// Footer actions (approved P1/P2 btn-row)
// ---------------------------------------------------------------------------

function footerActions(view: ProgrammeView, augment: ProgrammeAugmentations): string {
  const summary = view.summary;
  const hasActiveIssues =
    summary.disrupted + summary.atRisk + summary.recovering + summary.changeRequested + summary.awaitingDecision > 0;
  const actions: string[] = [];
  if (augment.changePreviewHref) {
    actions.push(
      `<a class="btn ${hasActiveIssues ? 'btn-primary' : 'btn-ghost'}" href="${escapeHtml(augment.changePreviewHref)}">${escapeHtml(PROGRAMME_CHANGE_PREVIEW_LABEL)}</a>`,
    );
  }
  if (hasActiveIssues) {
    actions.push(`<span class="btn btn-ghost">${escapeHtml(PROGRAMME_MESSAGE_AFFECTED_LABEL)}</span>`);
  }
  actions.push(`<a class="btn btn-ghost" href="${escapeHtml(augment.importHref ?? DEFAULT_IMPORT_HREF)}">${escapeHtml(PROGRAMME_IMPORT_UPDATED_LABEL)}</a>`);
  actions.push(`<span class="btn btn-ghost">${escapeHtml(PROGRAMME_EXPORT_LABEL)}</span>`);
  return `
  <div class="btn-row" data-ui-section="programme-actions">
    ${actions.join('\n    ')}
  </div>`;
}

// ---------------------------------------------------------------------------
// Screen assembly
// ---------------------------------------------------------------------------

function programmeBody(view: ProgrammeView, augment: ProgrammeAugmentations, inert: boolean): string {
  return `
<main class="shell"${inert ? ' aria-hidden="true"' : ''}>
  <div class="page-head">
    <h1>${escapeHtml(view.anchorEventName)}</h1>
    <p class="sub">${escapeHtml(PROGRAMME_SUBHEADING)}</p>
    <p class="meta">${escapeHtml(PROGRAMME_HEADING)} · generated ${escapeHtml(formatInstant(view.generatedAt))}</p>
  </div>
  ${augment.committedNotice ? committedNoticeCallout(augment.committedNotice) : ''}
  ${summaryTiles(view)}
  ${endangeredSection(view, augment)}
  ${timelineSection(augment.timeline ?? [], augment)}
  ${missingInformationPanel(view)}
  ${travellerTable(view, augment)}
  ${footerActions(view, augment)}
</main>`;
}

/** Programme body from a loaded view (also used directly by tests). */
export function renderProgrammeBody(view: ProgrammeView, augment: ProgrammeAugmentations = {}): string {
  return programmeBody(view, augment, false);
}

/** Full programme screen from the frozen envelope; honest about loading/error. */
export function renderProgramme(
  envelope: ReadModelEnvelope<ProgrammeView>,
  augment: ProgrammeAugmentations = {},
): string {
  if (envelope.state === 'LOADING') {
    return `<main class="shell">${loadingPanel('Loading the programme', 'We are gathering the latest confirmed trip information for this event.')}</main>`;
  }
  if (envelope.state === 'ERROR') {
    return `<main class="shell">${errorPanel('The programme is unavailable right now', envelope.errorMessage)}</main>`;
  }
  if (!envelope.data) {
    return `<main class="shell">${errorPanel('The programme is unavailable right now')}</main>`;
  }
  return programmeBody(envelope.data, augment, false);
}

// ---------------------------------------------------------------------------
// Programme intake (approved intake.html) — how a programme gets in
// ---------------------------------------------------------------------------

/** One source document already on file for the programme. */
export interface ProgrammeSourceView {
  label: string;
  note?: string;
}

/** Optional intake-page data the frozen read model does not carry yet. */
export interface ProgrammeIntakeAugmentations {
  /** Link target for the on-file programme facts (the programme page). */
  programmeHref?: string;
  /** Link target for the "add updated files" dropzone (bulk import). */
  importHref?: string;
  /** Source documents already on file (name + note), from ingestion state. */
  sources?: readonly ProgrammeSourceView[];
  /** Commitment timeline summary, when the projection supplies it. */
  timeline?: readonly ProgrammeTimelineDayView[];
}

function intakeNewProgrammeCard(): string {
  return `
    <div class="card">
      <div class="card-head"><p class="card-title">Start a new programme</p></div>
      <p class="card-sub">Event brief, roster, session schedule — whatever you already have. Northstar reads it and builds a draft for you to check.</p>
      <div class="dropzone" style="margin-top:14px">
        <div class="dz-icon" aria-hidden="true">⇪</div>
        <div class="dz-title">Drop files here — PDF · CSV · XLSX</div>
        <div class="dz-sub">Event brief · traveller roster · session schedule — one file or many</div>
      </div>
      <div class="btn-row" style="margin-top:14px">
        <span class="btn btn-primary">Upload files</span>
        <span class="btn btn-ghost">Enter details manually</span>
      </div>
      <p class="card-foot">Manual entry opens the same draft — one traveller or one session at a time.</p>
    </div>`;
}

function intakeOnFileCard(view: ProgrammeView, augment: ProgrammeIntakeAugmentations): string {
  const summary = view.summary;
  const unconfirmed = summary.unknown > 0 ? ` · ${summary.unknown} unconfirmed` : '';
  const facts: string[] = [];
  const timeline = augment.timeline ?? [];
  if (timeline.length > 0) {
    const itemCount = timeline.reduce((sum, day) => sum + day.items.length, 0);
    facts.push(
      `<div class="alt-row"><span><strong>Event schedule</strong> — ${itemCount} ${itemCount === 1 ? 'commitment' : 'commitments'} across ${timeline.length} ${timeline.length === 1 ? 'day' : 'days'}</span>${augment.programmeHref ? `<span class="a-note"><a href="${escapeHtml(augment.programmeHref)}">View / edit →</a></span>` : ''}</div>`,
    );
  }
  facts.push(
    `<div class="alt-row"><span><strong>Speakers &amp; travellers</strong> — ${summary.total} people${unconfirmed}</span>${augment.programmeHref ? `<span class="a-note"><a href="${escapeHtml(augment.programmeHref)}">View / edit →</a></span>` : ''}</div>`,
  );
  const counts = view.arrangementCounts;
  const arrangements: ReadonlyArray<readonly [string, number]> = [
    ['Travel arranged by us', counts.northstarArranged],
    ['Travelling on their own arrangements', counts.selfOrOtherArranged],
    ['Not declared yet', counts.unspecified],
  ];
  const sources = augment.sources ?? [];
  const sourcesBlock = sources.length > 0
    ? `<p class="kv-label" style="margin-top:18px">Sources on file</p>
      <div>${sources.map((source) => `<div class="alt-row"><span>${escapeHtml(source.label)}</span>${source.note ? `<span class="a-note">${escapeHtml(source.note)}</span>` : ''}</div>`).join('')}</div>`
    : '';
  const addFiles = augment.importHref
    ? `<a class="dropzone" style="margin-top:12px;padding:12px 14px" href="${escapeHtml(augment.importHref)}">
        <div class="dz-title" style="margin-top:0;font-size:13px">+ Add updated files</div>
        <div class="dz-sub">A new version replaces the old — the programme re-checks itself against it</div>
      </a>`
    : '';
  return `
    <div class="card">
      <div class="card-head"><p class="card-title">On file — ${escapeHtml(view.anchorEventName)}</p><span class="badge tone-ok">Live</span></div>
      <p class="card-sub">${counts.total} people on this programme</p>
      <div style="margin-top:12px">${facts.join('')}</div>
      <p class="kv-label" style="margin-top:18px">Travel arrangements as declared at intake</p>
      <div>${arrangements.map(([label, count]) => `<div class="alt-row"><span>${escapeHtml(label)}</span><span class="a-note">${count}</span></div>`).join('')}</div>
      ${sourcesBlock}
      ${addFiles}
    </div>`;
}

/**
 * Programme intake screen (approved intake.html). The new-programme card is
 * always available; the on-file card reflects the loaded programme envelope
 * honestly (loading/error states render the same honest panels).
 */
export function renderProgrammeIntake(
  envelope: ReadModelEnvelope<ProgrammeView>,
  augment: ProgrammeIntakeAugmentations = {},
): string {
  let onFile: string;
  if (envelope.state === 'LOADING') {
    onFile = loadingPanel('Checking the programme on file', 'We are looking up what is already on file for this event.');
  } else if (envelope.state === 'ERROR' || !envelope.data) {
    onFile = errorPanel('The programme on file is unavailable right now', envelope.state === 'ERROR' ? envelope.errorMessage : undefined);
  } else {
    onFile = intakeOnFileCard(envelope.data, augment);
  }
  return `
<main class="shell">
  <div class="page-head">
    <h1>Programme intake</h1>
    <p class="sub">Bring an event into Northstar — drop the files in, or open the programme already on file.</p>
    <p class="meta">Uploads are read, mapped, and shown back for confirmation — nothing is guessed · nothing touches live trips until you confirm</p>
  </div>
  <div class="intake-grid">
    ${intakeNewProgrammeCard()}
    ${onFile}
  </div>
  <p class="footnote">Intake is just how a programme gets in. The working flows run from the overview and the cases.</p>
</main>`;
}

// ---------------------------------------------------------------------------
// Programme-change preview (approved E1 modal)
// ---------------------------------------------------------------------------

/** One side of the change comparison (Now / Proposed). */
export interface ProgrammeChangeCompareSide {
  whenLabel: string;
  whereLabel?: string;
}

/** One impact row: who or what the proposed change touches. */
export interface ProgrammeChangeImpact {
  /** Short count or scope label, e.g. "1" or "66". */
  countLabel: string;
  text: string;
  badgeLabel: string;
  badgeTone: StatusTone;
}

/** One honest alternative the operator could pick instead. */
export interface ProgrammeChangeAlternative {
  label: string;
  note?: string;
}

/**
 * UI-local projection for the programme-change preview modal (E1). The
 * integrator builds this from the deterministic what-if evaluation; the UI
 * only renders it. Confirm/cancel are links the integrator wires — without
 * hrefs they render as inert buttons, never fake actions.
 */
export interface ProgrammeChangePreviewView {
  title: string;
  subtitle: string;
  current: ProgrammeChangeCompareSide;
  proposed: ProgrammeChangeCompareSide;
  impacts: readonly ProgrammeChangeImpact[];
  alternatives: readonly ProgrammeChangeAlternative[];
  /** Honest statement of what the preview was checked against. */
  checksFootnote: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmFootnote?: string;
}

function compareBox(label: string, side: ProgrammeChangeCompareSide, proposed: boolean): string {
  return `
    <div class="cc-box${proposed ? ' to' : ''}">
      <p class="kv-label">${escapeHtml(label)}</p>
      <div class="cc-when">${escapeHtml(side.whenLabel)}</div>
      ${side.whereLabel ? `<div class="cc-where">${escapeHtml(side.whereLabel)}</div>` : ''}
    </div>`;
}

/**
 * E1 — the what-if modal over the dimmed, inert programme page. Nothing in
 * the backdrop is interactive; the modal carries the whole decision.
 */
export function renderProgrammeChangePreview(
  view: ProgrammeView,
  preview: ProgrammeChangePreviewView,
  options: { augment?: ProgrammeAugmentations; confirmHref?: string; cancelHref?: string } = {},
): string {
  const backdrop = programmeBody(view, options.augment ?? {}, true);
  const impacts = preview.impacts
    .map(
      (impact) => `
  <div class="impact-row">
    <span class="i-count">${escapeHtml(impact.countLabel)}</span>
    <span>${escapeHtml(impact.text)}</span>
    <span class="badge tone-${impact.badgeTone}" style="margin-left:auto">${escapeHtml(impact.badgeLabel)}</span>
  </div>`,
    )
    .join('');
  const alternatives = preview.alternatives
    .map(
      (alt) =>
        `<div class="alt-row"><span>${escapeHtml(alt.label)}</span>${alt.note ? `<span class="a-note">${escapeHtml(alt.note)}</span>` : ''}</div>`,
    )
    .join('');
  const confirm = options.confirmHref
    ? `<a class="btn btn-primary" href="${escapeHtml(options.confirmHref)}">${escapeHtml(preview.confirmLabel)}</a>`
    : `<span class="btn btn-primary">${escapeHtml(preview.confirmLabel)}</span>`;
  const cancel = options.cancelHref
    ? `<a class="btn btn-ghost" href="${escapeHtml(options.cancelHref)}">${escapeHtml(preview.cancelLabel)}</a>`
    : `<span class="btn btn-ghost">${escapeHtml(preview.cancelLabel)}</span>`;
  return `${backdrop}

<div class="modal-scrim"></div>

<div class="modal" role="dialog" aria-modal="true" aria-label="Event change preview">
  <div class="preview-banner"><span class="pb-dot" aria-hidden="true"></span>Preview · no changes made yet</div>
  <h2>${escapeHtml(preview.title)}</h2>
  <p class="m-sub">${escapeHtml(preview.subtitle)}</p>

  <div class="change-compare">
    ${compareBox('Now', preview.current, false)}
    <div class="cc-arrow" aria-hidden="true">→</div>
    ${compareBox('Proposed', preview.proposed, true)}
  </div>

  <p class="kv-label">Who this touches</p>
  ${impacts}

  <p class="kv-label" style="margin-top:16px">Ways to make it work</p>
  ${alternatives}

  <p class="footnote" style="margin-top:14px">${escapeHtml(preview.checksFootnote)}</p>

  <div class="btn-row">
    ${confirm}
    ${cancel}
  </div>
  ${preview.confirmFootnote ? `<p class="footnote">${escapeHtml(preview.confirmFootnote)}</p>` : ''}
</div>`;
}
