/**
 * R4 (lane E2) — product recovery Case workspace.
 *
 * Restores the legacy Case information architecture onto the PostgreSQL v2
 * `RecoveryCaseView`. The read model is first turned into a plain-language
 * workspace model by `presentCaseWorkspace` (pure, no HTML); this file only lays
 * that model out:
 *
 *   header -> lead callout -> graph (Current/Original) -> what this affects ->
 *   recovery options (ONE recommended card) -> "What you’re approving" ->
 *   execution progress -> what NORTHSTAR did -> what we checked -> resolution ->
 *   Technical details (collapsed)
 *
 * Interaction contract (docs/work/ACTIVE_TASK.md, frozen):
 *  - every replaceable section is a `data-poll-region="<name>"` container that is
 *    ALWAYS emitted (possibly empty) so the region patcher can add/remove content;
 *  - `<details>` carry `data-region-key` so open state survives patching;
 *  - controls are `data-action="recover|decline|escalate"` + data attributes and
 *    carry NO inline listeners — one document-level delegated handler owns them.
 */
import type { RecoveryCaseView } from '../../contracts/v2/product/readModels.ts';
import {
  presentCaseWorkspace,
  type CaseChangeLine,
  type CaseOptionModel,
  type CaseRow,
  type CaseWorkspaceModel,
} from '../../app/target/adapters/caseWorkspacePresenter.ts';
import { SHELL_LINKS } from '../../app/target/productShell.ts';
import { CASE_COPY } from '../copy.ts';
import { escapeHtml, formatInstant } from '../html.ts';
import { renderFocusedCaseGraph } from '../graph/index.ts';
import { buildOriginalCurrentRegion, originalCurrentToggleScript } from '../originalCurrent.ts';
import { casePollingScript } from '../casePolling.ts';

const CASE_WORKSPACE_CSS = `<style>
.case-workspace .cw-lead { margin: 0 0 18px; }
.case-workspace .cw-lead .callout { padding: 16px 20px; }
.case-workspace .cw-lead .callout h2 { margin: 0 0 6px; font-size: 18px; }
.case-workspace .cw-lead .callout p { font-size: 14.5px; }
.case-workspace .cw-stake { font-weight: 600; }
.case-workspace .back-link { color: var(--text-soft); font-weight: 600; text-decoration: none; }
.case-workspace .back-link:hover { color: var(--text); text-decoration: underline; }
.case-workspace .cw-graph .graph-caption { margin: 0 0 10px; font-size: 13.5px; color: var(--text-soft); }
.case-workspace .cw-rec { padding: 20px 22px; }
.case-workspace .cw-rec .opt-title { font-size: 19px; }
.case-workspace .cw-facts { display: grid; grid-template-columns: 130px 1fr; gap: 10px 16px; margin: 14px 0 0; font-size: 14px; }
.case-workspace .cw-facts dt { color: var(--text-faint); font-family: var(--font-mono); font-size: 10.5px; letter-spacing: .07em; text-transform: uppercase; padding-top: 3px; }
.case-workspace .cw-facts dd { margin: 0; }
.case-workspace .cw-facts ul { margin: 0; padding-left: 18px; }
.case-workspace .cw-alt { margin-top: 12px; padding: 14px 18px; }
.case-workspace .cw-alt .cw-facts { margin-top: 8px; }
.case-workspace .cw-approve { background: var(--paper-warm); border: 1px solid var(--watch-border); border-radius: var(--radius); padding: 18px 20px; margin: 18px 0; }
.case-workspace .cw-approve h2 { margin: 0 0 10px; font-size: 18px; }
.case-workspace .cw-approve .btn-row { margin-top: 14px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.case-workspace .cw-status { min-height: 1.2em; margin: 10px 0 0; font-size: 13px; color: var(--text-soft); }
.case-workspace .cw-progress { height: 8px; border-radius: 4px; background: var(--line-soft); overflow: hidden; margin: 6px 0 12px; }
.case-workspace .cw-progress > i { display: block; height: 100%; background: var(--ok-f); }
.case-workspace details.cw-details { margin-top: 14px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 10px 14px; }
.case-workspace details.cw-details > summary { cursor: pointer; font-weight: 600; font-size: 14.5px; }
.case-workspace .cw-tech { font-size: 12.5px; color: var(--text-soft); }
.case-workspace .cw-tech ul { margin: 6px 0 12px; padding-left: 18px; }
.case-workspace .cw-tech code { font-family: var(--font-mono); font-size: 11.5px; word-break: break-all; }
.case-workspace .cw-considered { margin: 10px 0 0; padding: 0; list-style: none; }
.case-workspace .cw-considered li { padding: 10px 0; border-top: 1px solid var(--line-soft); font-size: 13.5px; }
.case-workspace .cw-considered li:first-child { border-top: 0; }
.case-workspace .cw-empty { margin: 0; }
</style>`;

function badge(label: string, tone: string): string {
  return `<span class="badge tone-${tone}">${escapeHtml(label)}</span>`;
}

function region(name: string, html: string, extra = ''): string {
  return `<div data-poll-region="${name}"${extra ? ` ${extra}` : ''}>${html}</div>`;
}

function details(key: string, summary: string, body: string): string {
  return `<details class="cw-details" data-region-key="${escapeHtml(key)}" data-test="${escapeHtml(key)}"><summary>${escapeHtml(summary)}</summary>${body}</details>`;
}

// --------------------------------------------------------------------------
// Sections
// --------------------------------------------------------------------------

function headerHtml(m: CaseWorkspaceModel): string {
  return `<div class="page-head">
    <h1>${escapeHtml(m.heading)} ${badge(m.statusLabel, m.statusTone)}</h1>
    <p class="sub">Trip recovery</p>
    <p class="meta"><a class="back-link" href="${SHELL_LINKS.dashboard}" data-test="back-to-overview">${escapeHtml(CASE_COPY.backToOverview)}</a> · Updated <time datetime="${escapeHtml(m.generatedAt)}">${escapeHtml(formatInstant(m.generatedAt))}</time></p>
  </div>`;
}

function leadHtml(m: CaseWorkspaceModel): string {
  const attention = m.attention
    ? `<div class="callout tone-alert" data-test="case-attention"><h2>${escapeHtml(m.attention.title)}</h2><p>${escapeHtml(m.attention.body)}</p></div>`
    : '';
  return `<div class="cw-lead">
    <div class="callout tone-${m.lead.tone}" data-test="case-lead">
      <h2>${escapeHtml(m.lead.title)}</h2>
      <p>${escapeHtml(m.lead.body)}</p>
      ${m.lead.stake ? `<p class="cw-stake">${escapeHtml(m.lead.stake)}</p>` : ''}
    </div>
    ${attention}
  </div>`;
}

function graphHtml(view: RecoveryCaseView, m: CaseWorkspaceModel): string {
  const currentHtml = renderFocusedCaseGraph({
    ldg: view.ldg,
    ...(view.focusedGraph ? { focusedGraph: view.focusedGraph } : {}),
    caseStatus: view.status,
  });
  const stored = view.originalFocusedGraph;
  const toggle = buildOriginalCurrentRegion({
    currentHtml,
    ...(stored
      ? {
          original: {
            graphHtml: renderFocusedCaseGraph({
              ldg: stored.ldg,
              ...(stored.focusedGraph ? { focusedGraph: stored.focusedGraph } : {}),
              caseStatus: stored.caseStatusAtCapture,
              role: 'original',
              includeAssets: false,
            }),
            capturedAt: stored.capturedAt,
            capturedLabel: formatInstant(stored.capturedAt),
          },
        }
      : {}),
  });
  const where = m.whereItBreaks
    ? `<p class="graph-caption" data-test="focused-graph-first-breakpoint">Where it breaks: <strong>${escapeHtml(m.whereItBreaks.label)}</strong> — ${escapeHtml(m.whereItBreaks.phrase)}.</p>`
    : '';
  const resolvedNote = m.phase === 'recovered'
    ? `<p class="graph-caption" data-test="graph-resolved-note">${escapeHtml(CASE_COPY.graphResolvedNote)}</p>`
    : '';
  return `<section class="section cw-graph" data-test="focused-case-graph-section">
    <h2>${escapeHtml(CASE_COPY.graphHeading)}</h2>
    ${where}${resolvedNote}
    ${toggle}
  </section>`;
}

function affectsHtml(m: CaseWorkspaceModel): string {
  if (m.affects.items.length === 0 && !m.affects.healthyNote) return '';
  const rows = m.affects.items
    .map((item) => `<li data-tone="${item.tone}"><strong>${escapeHtml(item.label)}</strong> <span class="meta">— ${escapeHtml(item.note)}</span></li>`)
    .join('');
  return `<section class="section" data-test="case-affects">
    <h2>${escapeHtml(CASE_COPY.whatThisAffects)}</h2>
    <div class="panel">
      ${rows ? `<ul class="plain-list">${rows}</ul>` : ''}
      ${m.affects.healthyNote ? `<p class="meta">${escapeHtml(m.affects.healthyNote)}</p>` : ''}
    </div>
  </section>`;
}

function changeLineHtml(line: CaseChangeLine): string {
  const subject = `<strong>${escapeHtml(line.subject)}</strong>`;
  const ref = `data-subject-ref="${escapeHtml(line.subjectRef)}"`;
  switch (line.kind) {
    case 'IN_EFFECT':
      return `<li data-test="strategy-change" data-change-state="IN_EFFECT" ${ref}>${subject} is already at ${escapeHtml(line.toWindow ?? '')}</li>`;
    case 'MOVE':
      return `<li data-test="strategy-change" data-change-state="PROPOSED" ${ref}>Move ${subject} from ${escapeHtml(line.from ?? '')} to ${escapeHtml(line.to ?? '')} <span class="meta">(${escapeHtml(line.toWindow ?? '')})</span></li>`;
    case 'SET':
      return `<li data-test="strategy-change" ${ref}>Set ${subject} to ${escapeHtml(line.toWindow ?? '')}</li>`;
    default:
      return `<li data-test="strategy-change" ${ref}>${escapeHtml(line.phrase ?? 'Change')}</li>`;
  }
}

function factsHtml(option: CaseOptionModel, fullApprover: boolean): string {
  const changes = option.changes.length > 0
    ? `<ul>${option.changes.map(changeLineHtml).join('')}</ul>`
    : 'No schedule or booking change is recorded for this option.';
  const people = option.people.length > 0 ? escapeHtml(option.people.join(', ')) : '';
  const why = option.why.length > 0 ? `<ul>${option.why.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : '';
  return `<dl class="cw-facts">
    <dt>What changes</dt><dd>${changes}</dd>
    ${people ? `<dt>Who is affected</dt><dd>${people}</dd>` : ''}
    ${why ? `<dt>Why it works</dt><dd>${why}</dd>` : ''}
    ${option.costLine ? `<dt>Cost</dt><dd>${escapeHtml(option.costLine)}</dd>` : ''}
    ${fullApprover ? `<dt>Approval</dt><dd>${escapeHtml(option.approverLine)}</dd>` : ''}
  </dl>`;
}

function recoverButton(caseRef: string, strategyRef: string, label: string, primary: boolean, extra = ''): string {
  const path = `/api/v2/cases/${encodeURIComponent(caseRef)}/strategies/${encodeURIComponent(strategyRef)}/approve`;
  return `<button type="button" class="btn ${primary ? 'btn-primary' : 'btn-ghost'}" data-action="recover" data-test="approve-strategy" data-case-ref="${escapeHtml(caseRef)}" data-strategy-ref="${escapeHtml(strategyRef)}" data-request-path="${escapeHtml(path)}" data-busy-label="Recording your approval…"${extra}>${escapeHtml(label)}</button>`;
}

function optionsHtml(m: CaseWorkspaceModel): string {
  const parts: string[] = [];
  if (m.recommended) {
    parts.push(`<div class="option-card is-recommended cw-rec" data-test="recovery-strategy" data-strategy-ref="${escapeHtml(m.recommended.strategyRef)}" data-option-number="${m.recommended.optionNumber}">
      <div class="opt-head"><h3 class="opt-title">${escapeHtml(m.recommended.title)}</h3>${badge(CASE_COPY.recommended, 'ok')}</div>
      ${factsHtml(m.recommended, true)}
    </div>`);
  }
  if (m.alternatives.length > 0) {
    parts.push(...m.alternatives.map((alt) => `<div class="option-card cw-alt" data-test="recovery-strategy" data-strategy-ref="${escapeHtml(alt.strategyRef)}" data-option-number="${alt.optionNumber}">
      <div class="opt-head"><h3 class="opt-title">Alternative: ${escapeHtml(alt.title)}</h3>${badge('Also works', 'neutral')}</div>
      ${factsHtml(alt, false)}
      ${alt.approvable ? `<div class="btn-row">${recoverButton(m.caseRef, alt.strategyRef, 'Choose this option instead', false)}</div>` : ''}
    </div>`));
  }
  if (m.showFindRecovery) {
    parts.push(`<div class="section-primary-action" data-test="find-recovery">
      <h3 class="opt-title">${escapeHtml(CASE_COPY.findRecovery)}</h3>
      <p class="meta">${escapeHtml(CASE_COPY.findRecoveryHint)}</p>
      <div class="btn-row"><button type="button" class="btn btn-primary" data-action="recover" data-test="propose-strategies" data-case-ref="${escapeHtml(m.caseRef)}" data-request-path="/api/v2/cases/${encodeURIComponent(m.caseRef)}/strategies" data-busy-label="Checking the trip…">${escapeHtml(CASE_COPY.findRecovery)}</button></div>
      <p class="cw-status" data-test="recovery-controls-status" role="status"></p>
    </div>`);
  }
  if (m.noPlan) {
    parts.push(`<div class="panel" data-test="no-plan">
      <p class="meta">${escapeHtml(CASE_COPY.noPlanBody)}</p>
      <div class="btn-row"><button type="button" class="btn btn-ghost" data-action="escalate" data-test="escalate-case" data-case-ref="${escapeHtml(m.caseRef)}" data-busy-label="Handing off…">${escapeHtml(CASE_COPY.escalate)}</button></div>
      <p class="cw-status" data-test="recovery-controls-status" role="status"></p>
    </div>`);
  }
  if (m.considered.length > 0) {
    const rows = m.considered.map((c) => `<li><strong>${escapeHtml(c.label)}</strong> — ${escapeHtml(c.reason)}${c.movements.length > 0 ? `<br><span class="meta">${c.movements.map(escapeHtml).join('; ')}</span>` : ''}${c.unchangedNote ? `<br><span class="meta">${escapeHtml(c.unchangedNote)}</span>` : ''}</li>`).join('');
    parts.push(details('other-options', `${CASE_COPY.otherOptionsConsidered} (${m.considered.length})`, `<ul class="cw-considered">${rows}</ul>`));
  }
  if (parts.length === 0) return '';
  return `<section class="section" data-test="recovery-controls" data-case-ref="${escapeHtml(m.caseRef)}">
    <h2>${escapeHtml(CASE_COPY.recoveryOptions)}</h2>
    ${parts.join('')}
  </section>`;
}

function approvalHtml(m: CaseWorkspaceModel): string {
  const a = m.approval;
  if (!a) return '';
  const changes = a.changeLines.length > 0 ? `<ul>${a.changeLines.map(changeLineHtml).join('')}</ul>` : '';
  return `<section class="cw-approve" data-test="approval-panel">
    <h2>${escapeHtml(CASE_COPY.whatYoureApproving)}</h2>
    <dl class="cw-facts">
      <dt>The change</dt><dd>${changes || 'No schedule or booking change is recorded.'}</dd>
      ${a.people.length > 0 ? `<dt>Who is affected</dt><dd>${escapeHtml(a.people.join(', '))}</dd>` : ''}
      ${a.costLine ? `<dt>Cost</dt><dd>${escapeHtml(a.costLine)}</dd>` : ''}
      <dt>Authority</dt><dd>${escapeHtml(a.authorityLine)}</dd>
    </dl>
    <div class="btn-row">
      ${recoverButton(m.caseRef, a.strategyRef, a.ctaLabel, true)}
      <button type="button" class="btn btn-danger-ghost" data-action="decline" data-test="decline-strategy" data-case-ref="${escapeHtml(m.caseRef)}" data-strategy-ref="${escapeHtml(a.strategyRef)}" data-busy-label="Declining…">${escapeHtml(CASE_COPY.decline)}</button>
    </div>
    <p class="cw-status" data-test="recovery-controls-status" role="status"></p>
  </section>`;
}

const ROW_ICON: Record<CaseRow['state'], string> = { done: '✓', doing: '⟳', queued: '○', failed: '✕', note: '–' };

function rowsHtml(rows: readonly CaseRow[]): string {
  return rows.map((r) => `<div class="check-row ${r.state === 'note' ? 'queued' : r.state}" data-row-state="${r.state}">
    <span class="c-ic" aria-hidden="true">${ROW_ICON[r.state]}</span>
    <span class="c-t">${escapeHtml(r.label)}</span>
    ${r.note ? `<span class="c-sub">${escapeHtml(r.note)}</span>` : ''}
  </div>`).join('');
}

function activityHtml(m: CaseWorkspaceModel): string {
  if (m.activity.rows.length === 0) return '';
  return `<section class="section" data-test="case-activity">
    <h2>${escapeHtml(m.activity.title)}</h2>
    <div class="panel">${rowsHtml(m.activity.rows)}</div>
  </section>`;
}

function executionHtml(m: CaseWorkspaceModel): string {
  const e = m.execution;
  if (!e) return '';
  const pct = e.total > 0 ? Math.round((e.done / e.total) * 100) : 0;
  const warnings = e.warnings.map((w) => `<div class="callout tone-watch"><p>${escapeHtml(w)}</p></div>`).join('');
  return `<section class="section" data-test="execution-progress" data-progress-done="${e.done}" data-progress-total="${e.total}">
    <h2>${escapeHtml(e.title)}</h2>
    <div class="panel">
      <div class="cw-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
      ${rowsHtml(e.rows)}
      ${warnings}
    </div>
  </section>`;
}

function checkedHtml(m: CaseWorkspaceModel): string {
  if (m.checked.length === 0) return '';
  const icon = (ok: boolean | null): string => (ok === true ? '✓' : ok === false ? '✕' : '?');
  const cls = (ok: boolean | null): string => (ok === true ? 'ic-pass' : ok === false ? 'ic-fail' : 'ic-unknown');
  return `<section class="section" data-test="case-checked">
    <h2>${escapeHtml(CASE_COPY.whatWeChecked)}</h2>
    <div class="panel">
      <ul class="icon-list">${m.checked.map((c) => `<li><span class="ic ${cls(c.ok)}" aria-hidden="true">${icon(c.ok)}</span> ${escapeHtml(c.label)}</li>`).join('')}</ul>
      ${m.checkedFootnote ? `<p class="footnote">${escapeHtml(m.checkedFootnote)}</p>` : ''}
    </div>
  </section>`;
}

function resolutionHtml(m: CaseWorkspaceModel): string {
  if (!m.resolution) return '';
  return `<section class="section-primary-action" data-test="resolution-panel">
    <p class="kv-label">Trip recovered</p>
    <h2>${escapeHtml(m.resolution.title)}</h2>
    <p class="meta">${escapeHtml(m.resolution.body)}</p>
    <div class="btn-row"><a class="btn btn-primary" href="${SHELL_LINKS.dashboard}" data-test="back-to-overview-cta">${escapeHtml(CASE_COPY.backToOverviewButton)}</a></div>
  </section>`;
}

function technicalHtml(m: CaseWorkspaceModel, caseRef: string): string {
  const t = m.technical;
  const list = (items: readonly string[]): string => (items.length > 0 ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : '');
  const unmapped = t.unmappedSteps.length > 0
    ? `<div data-test="focused-graph-unmapped"><p><strong>${t.unmappedSteps.length} causal step${t.unmappedSteps.length === 1 ? '' : 's'} not shown on the graph</strong></p>${list(t.unmappedSteps)}</div>`
    : '';
  const body = `<div class="cw-tech">
    <p>Case <code>${escapeHtml(caseRef)}</code> · status ${escapeHtml(t.caseStatus)} · authority ${escapeHtml(t.authorityState)} · execution ${escapeHtml(t.executionState)} · reconciliation ${escapeHtml(t.reconciliationState)}</p>
    ${list(t.strategies)}
    ${list(t.planning)}
    ${unmapped}
    <p>Full evidence: <a href="/api/v2/cases/${encodeURIComponent(caseRef)}">JSON view</a></p>
  </div>`;
  return details('technical-details', CASE_COPY.technicalDetails, body);
}

function railHtml(m: CaseWorkspaceModel): string {
  const stake = m.lead.stake
    ? `<div class="rail-card ink" data-test="rail-stake"><p class="kv-label">${m.phase === 'recovered' ? 'The commitment that held' : 'The commitment at stake'}</p><p class="rc-body">${escapeHtml(m.lead.stake.replace(/^At stake: /, ''))}</p></div>`
    : '';
  return `${stake}<div class="rail-card" data-test="rail-authority"><p class="kv-label">Authority</p><p class="rc-body">NORTHSTAR checks who is allowed to approve each change before anything is applied. Every action is recorded.</p></div>`;
}

// --------------------------------------------------------------------------
// Entry
// --------------------------------------------------------------------------

export function renderProductRecoveryCase(view: RecoveryCaseView): string {
  const m = presentCaseWorkspace(view);
  // Change-awareness attributes read by the polling + Original/Current scripts.
  const changeAttrs = [
    `data-case-ref="${escapeHtml(view.caseRef)}"`,
    `data-case-status="${escapeHtml(view.status)}"`,
    `data-case-phase="${m.phase}"`,
    `data-projection-revision="${escapeHtml(String(view.change.projectionRevision))}"`,
    view.change.changeCursor ? `data-change-cursor="${escapeHtml(view.change.changeCursor)}"` : '',
  ].filter(Boolean).join(' ');

  return `${CASE_WORKSPACE_CSS}
<main class="shell product-recovery-case case-workspace" data-test="product-recovery-case" ${changeAttrs}>
  ${region('header', headerHtml(m))}
  ${region('lead', leadHtml(m))}
  ${region('graph', graphHtml(view, m))}
  <div class="case-grid">
    <div class="case-flow">
      ${region('affects', affectsHtml(m))}
      ${region('options', optionsHtml(m))}
      ${region('approval', approvalHtml(m))}
      ${region('execution', executionHtml(m))}
      ${region('activity', activityHtml(m))}
      ${region('checked', checkedHtml(m))}
      ${region('resolution', resolutionHtml(m))}
      ${region('technical', technicalHtml(m, view.caseRef))}
    </div>
    <aside class="case-rail">${region('rail', railHtml(m))}</aside>
  </div>
</main>
${originalCurrentToggleScript()}
${casePollingScript({ caseRef: view.caseRef })}`;
}
