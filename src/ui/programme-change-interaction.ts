/**
 * Browser interaction for programme change preview/commit on operator surfaces.
 *
 * Editing fields remain a prior step. Preview replaces the form with a
 * mutation-free Now vs Proposed comparison (recovered E1 pattern). Commit
 * alone runs the deterministic programme mutation/fan-out path.
 */
export function renderProgrammeChangeEnhancementScript(): string {
  return `<script>
(function() {
  'use strict';

  var REDUCE = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var PREVIEW_MS = REDUCE ? 200 : 3000;
  var params = new URLSearchParams(window.location.search);
  var actionAt = params.get('at') || new Date().toISOString();
  var actionRow = document.querySelector('[data-ui-section="programme-actions"]');
  var timelineItems = Array.prototype.slice.call(document.querySelectorAll('[data-timeline-key]'));
  var launchButtons = Array.prototype.slice.call(document.querySelectorAll('[data-programme-change-launch]'));

  function resolveAnchorEventId(source) {
    if (source && source.getAttribute('data-anchor-event-id')) {
      return source.getAttribute('data-anchor-event-id');
    }
    return params.get('event');
  }

  function previewErrorText(data) {
    if (!data) return 'Preview could not be completed.';
    if (typeof data === 'string') return data;
    if (data.message) return String(data.message);
    if (data.error) return String(data.error);
    if (Array.isArray(data.issues) && data.issues.length) return data.issues.join(' · ');
    return 'Preview could not be completed.';
  }

  function showStagedOverlay(title, steps, durationMs, done) {
    var existing = document.querySelector('[data-test="lifecycle-progress-overlay"]');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.setAttribute('data-test', 'lifecycle-progress-overlay');
    overlay.className = 'ns-resolve-scrim';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    var stepsHtml = steps.map(function(step, i) {
      return '<li data-step="' + i + '"><span class="ns-resolve-step-mark" aria-hidden="true"></span><span class="ns-resolve-step-body"><span class="ns-resolve-step-label">' + step + '</span></span></li>';
    }).join('');
    overlay.innerHTML =
      '<div class="ns-resolve-modal">' +
        '<p class="ns-resolve-kicker">Northstar progress</p>' +
        '<h2 class="ns-resolve-title">' + title + '</h2>' +
        '<div class="ns-resolve-bar" aria-hidden="true"><i></i></div>' +
        '<ol class="ns-resolve-steps">' + stepsHtml + '</ol>' +
      '</div>';
    document.body.appendChild(overlay);
    var bar = overlay.querySelector('.ns-resolve-bar > i');
    var stepEls = Array.prototype.slice.call(overlay.querySelectorAll('[data-step]'));
    var start = Date.now();
    overlay.hidden = false;
    document.body.classList.add('ns-resolve-open');
    function tick() {
      var elapsed = Date.now() - start;
      var t = Math.min(1, elapsed / durationMs);
      if (bar) bar.style.width = Math.round(t * 100) + '%';
      var idx = Math.min(stepEls.length - 1, Math.floor(t * stepEls.length));
      stepEls.forEach(function(step, i) {
        step.classList.toggle('is-done', i < idx);
        step.classList.toggle('is-active', i === idx);
      });
      if (t >= 1) {
        stepEls.forEach(function(step) {
          step.classList.add('is-done');
          step.classList.remove('is-active');
        });
        overlay.hidden = true;
        document.body.classList.remove('ns-resolve-open');
        overlay.remove();
        if (done) done();
        return;
      }
      window.requestAnimationFrame(tick);
    }
    window.requestAnimationFrame(tick);
  }

  function showLifecycleOverlay(steps, done) {
    var existing = document.querySelector('[data-test="lifecycle-progress-overlay"]');
    if (existing) existing.remove();
    var overlay = document.createElement('div');
    overlay.setAttribute('data-test', 'lifecycle-progress-overlay');
    overlay.setAttribute('role', 'status');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(12,16,22,0.72);display:flex;align-items:center;justify-content:center;padding:24px;';
    var panel = document.createElement('div');
    panel.style.cssText = 'background:#fff;max-width:420px;width:100%;padding:22px 24px;border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,0.28);font:15px/1.45 system-ui,sans-serif;';
    panel.innerHTML = '<p style="margin:0 0 8px;font-size:12px;letter-spacing:0.04em;text-transform:uppercase;color:#667085;">Progress</p><p data-lifecycle-step style="margin:0;font-size:18px;font-weight:600;color:#101828;"></p>';
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    var label = panel.querySelector('[data-lifecycle-step]');
    var i = 0;
    function tick() {
      if (i >= steps.length) {
        window.setTimeout(done, 350);
        return;
      }
      label.textContent = steps[i];
      i += 1;
      window.setTimeout(tick, 420);
    }
    tick();
  }

  function closeModal() {
    var modal = document.querySelector('[data-programme-change-modal]');
    var scrim = document.querySelector('[data-programme-change-scrim]');
    if (modal) modal.remove();
    if (scrim) scrim.remove();
  }

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function(response) {
      return response.json().then(function(data) {
        return { ok: response.ok, status: response.status, data: data };
      });
    });
  }

  function buildPayload(modal) {
    var commitmentId = modal.querySelector('[name="commitmentId"]').value;
    var changeKind = modal.querySelector('[name="changeKind"]').value;
    var startEl = modal.querySelector('[name="newStartsAt"]');
    var endEl = modal.querySelector('[name="newEndsAt"]');
    var newStartsAt = (startEl.getAttribute('data-iso-value') || startEl.value || '').trim();
    var newEndsAt = (endEl.getAttribute('data-iso-value') || endEl.value || '').trim();
    var newPlaceId = modal.querySelector('[name="newPlaceId"]').value.trim();
    var payload = {
      commitmentId: commitmentId,
      changeKind: changeKind,
      at: actionAt
    };
    if (newStartsAt) payload.newStartsAt = newStartsAt;
    if (newEndsAt) payload.newEndsAt = newEndsAt;
    if (newPlaceId) payload.newPlaceId = newPlaceId;
    return payload;
  }

  function changeKindLabel(kind) {
    if (kind === 'RESCHEDULED') return 'Reschedule';
    if (kind === 'RELOCATED') return 'Relocate';
    if (kind === 'CANCELLED') return 'Cancel';
    return 'Other change';
  }

  function formatHumanInstant(iso) {
    if (!iso || typeof iso !== 'string') return iso || '';
    var match = /^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})/.exec(iso.trim());
    if (!match) return iso;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var month = months[Number(match[2]) - 1] || match[2];
    return Number(match[3]) + ' ' + month + ' · ' + match[4] + ':' + match[5];
  }

  function formatClockRange(startIso, endIso) {
    function clock(iso) {
      var match = /^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})/.exec(String(iso || '').trim());
      return match ? (match[4] + ':' + match[5]) : '';
    }
    var start = clock(startIso);
    var end = clock(endIso);
    if (start && end) return start + '–' + end;
    if (start) return start;
    return formatHumanInstant(startIso) || String(startIso || '');
  }

  function splitWhenLabel(label) {
    var text = String(label || '').trim();
    if (!text) return { date: '—', time: '—' };
    var parts = text.split(' · ');
    if (parts.length >= 2) return { date: parts[0], time: parts.slice(1).join(' · ') };
    return { date: text, time: '—' };
  }

  function compareSlotHtml(sideLabel, date, time, venue) {
    return '<div class="cc-box' + (sideLabel === 'Proposed' ? ' to' : '') + '" data-test="programme-compare-' + (sideLabel === 'Proposed' ? 'proposed' : 'now') + '">' +
      '<p class="kv-label">' + sideLabel + '</p>' +
      '<div class="cc-slot"><span class="cc-slot-k">Date</span><span class="cc-slot-v">' + (date || '—') + '</span></div>' +
      '<div class="cc-slot"><span class="cc-slot-k">Time</span><span class="cc-slot-v">' + (time || '—') + '</span></div>' +
      '<div class="cc-slot"><span class="cc-slot-k">Venue</span><span class="cc-slot-v">' + (venue || '—') + '</span></div>' +
    '</div>';
  }

  function sanitizeImpactReason(text) {
    return String(text)
      .replace(/\\bgap\\s+\\d+\\s*min[^·]*/gi, 'arrival no longer protects the headline')
      .replace(/\\b\\d+\\s*min(?:ute)?s?\\b/gi, 'timing')
      .replace(/\\bbuffer\\b/gi, 'margin')
      .replace(/commitment rescheduled/gi, 'Programme commitment moves')
      .replace(/\\bel-trip-[a-z0-9-]+/gi, 'linked engagement')
      .replace(/\\b\\d{4}-\\d{2}-\\d{2}T[\\d:+.-]+/g, function(iso) { return formatHumanInstant(iso); });
  }

  function formatProposedSide(payload) {
    if (payload.changeKind === 'CANCELLED') {
      return { whenLabel: 'Cancelled', dateLabel: '—', timeLabel: 'Cancelled', venueLabel: '—' };
    }
    var when = 'Time not set';
    var dateLabel = '—';
    var timeLabel = '—';
    if (payload.newStartsAt) {
      var startHuman = formatHumanInstant(payload.newStartsAt);
      var endMatch = /^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2})/.exec(String(payload.newEndsAt || '').trim());
      var endClock = endMatch ? (endMatch[4] + ':' + endMatch[5]) : '';
      when = startHuman && endClock && startHuman.indexOf(' · ') !== -1
        ? startHuman + '–' + endClock
        : formatClockRange(payload.newStartsAt, payload.newEndsAt);
      var split = splitWhenLabel(startHuman);
      dateLabel = split.date;
      timeLabel = endClock ? (split.time + '–' + endClock) : split.time;
    }
    return {
      whenLabel: when,
      dateLabel: dateLabel,
      timeLabel: timeLabel,
      venueLabel: payload.newPlaceId ? 'New venue' : 'Unchanged'
    };
  }

  function viabilityLabel(consequence) {
    if (consequence === 'DISRUPTED') return 'Needs Attention';
    if (consequence === 'VIABLE') return 'Viable';
    if (consequence === 'AT_RISK') return 'Watching';
    return 'Affected';
  }

  function viabilityTone(consequence) {
    if (consequence === 'DISRUPTED') return 'alert';
    if (consequence === 'VIABLE') return 'ok';
    if (consequence === 'AT_RISK') return 'watch';
    return 'watch';
  }

  function commitmentMetaFromDom(commitmentId) {
    var item = document.querySelector('[data-timeline-key="' + commitmentId + '"]');
    if (!item) return { when: '', date: '—', time: '—', venue: '—' };
    return {
      when: (item.getAttribute('data-timeline-date') || '') + ' · ' + (item.getAttribute('data-timeline-time') || ''),
      date: item.getAttribute('data-timeline-date') || '—',
      time: item.getAttribute('data-timeline-time') || '—',
      venue: item.getAttribute('data-timeline-venue') || '—',
    };
  }

  function selectedCommitmentMeta(modal) {
    var select = modal ? modal.querySelector('[name="commitmentId"]') : null;
    var id = select ? select.value : '';
    if (id) return commitmentMetaFromDom(id);
    return { when: '', date: '—', time: '—', venue: '—' };
  }

  function renderNowProposedCompare(target, preview, payload, nowLabel, modal) {
    target.replaceChildren();

    var banner = document.createElement('div');
    banner.className = 'preview-banner';
    banner.setAttribute('data-test', 'programme-change-preview-banner');
    banner.innerHTML = '<span class="pb-dot" aria-hidden="true"></span>Preview · no changes made yet';
    target.appendChild(banner);

    var compare = document.createElement('div');
    compare.className = 'change-compare';
    compare.setAttribute('data-test', 'now-vs-proposed');

    var proposed = formatProposedSide(payload);
    var nowMeta = modal ? selectedCommitmentMeta(modal) : { when: nowLabel, date: '—', time: '—', venue: '—' };
    var nowSplit = splitWhenLabel(nowMeta.when || nowLabel);
    compare.innerHTML =
      compareSlotHtml('Now', nowMeta.date || nowSplit.date, nowMeta.time || nowSplit.time, nowMeta.venue) +
      '<div class="cc-arrow" aria-hidden="true">→</div>' +
      compareSlotHtml('Proposed', proposed.dateLabel, proposed.timeLabel, proposed.venueLabel);
    target.appendChild(compare);

    var affected = Array.isArray(preview.affected) ? preview.affected : [];
    var unaffected = Array.isArray(preview.unaffected) ? preview.unaffected : [];

    var touchLabel = document.createElement('p');
    touchLabel.className = 'kv-label';
    touchLabel.style.marginTop = '16px';
    touchLabel.textContent = 'Who this touches';
    target.appendChild(touchLabel);

    var summary = document.createElement('p');
    summary.className = 'planning-result-title';
    summary.setAttribute('data-test', 'preview-impact-summary');
    summary.textContent = affected.length + ' traveller' + (affected.length === 1 ? '' : 's') + ' affected · ' + unaffected.length + ' unaffected';
    target.appendChild(summary);

    if (affected.length === 0) {
      var none = document.createElement('p');
      none.textContent = 'No linked trip becomes affected under this preview.';
      target.appendChild(none);
    } else {
      var seenReasons = {};
      affected.forEach(function(item) {
        var row = document.createElement('div');
        row.className = 'impact-row';
        row.setAttribute('data-test', 'preview-impact-row');

        var names = Array.isArray(item.travellerNames) ? item.travellerNames.filter(Boolean) : [];
        var nameLabel = names.length > 0 ? names.join(', ') : 'Linked participant';
        var count = document.createElement('span');
        count.className = 'i-count';
        count.textContent = nameLabel;
        row.appendChild(count);

        var detail = document.createElement('span');
        var reasonParts = Array.isArray(item.reasons) && item.reasons.length
          ? item.reasons.map(function(reason) {
              return sanitizeImpactReason(reason);
            })
          : ['Affected by the proposed programme change.'];
        var reasonText = reasonParts.join(' · ');
        if (seenReasons[reasonText]) {
          var consequenceHint =
            item.viabilityConsequence === 'VIABLE'
              ? 'confirmed viable after the move'
              : item.viabilityConsequence === 'DISRUPTED'
                ? 'critical — commitment no longer protected'
                : item.viabilityConsequence === 'AT_RISK'
                  ? 'watching — schedule impact remains'
                  : 'impact differs for this trip';
          reasonText = nameLabel + ' · ' + consequenceHint + (reasonParts[0] ? ' · ' + reasonParts[0] : '');
        }
        seenReasons[reasonText] = true;
        detail.textContent = reasonText;
        row.appendChild(detail);

        var badge = document.createElement('span');
        badge.className = 'badge tone-' + viabilityTone(item.viabilityConsequence);
        badge.style.marginLeft = 'auto';
        badge.textContent = viabilityLabel(item.viabilityConsequence);
        row.appendChild(badge);

        target.appendChild(row);
      });
    }

    var note = document.createElement('p');
    note.className = 'footnote';
    note.style.marginTop = '14px';
    note.textContent = 'Checked against current trip constraints. Nothing is committed until you confirm.';
    target.appendChild(note);
  }

  function populateCommitmentSelect(select, items, defaultId) {
    select.replaceChildren();
    items.forEach(function(item) {
      var option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.label;
      select.appendChild(option);
    });
    if (defaultId) select.value = defaultId;
  }

  function commitmentItemsFromTimeline() {
    return timelineItems.map(function(item) {
      var title = item.querySelector('.ttl');
      var time = item.querySelector('.t');
      return {
        id: item.getAttribute('data-timeline-key') || '',
        label: (time ? time.textContent + ' · ' : '') + (title ? title.textContent : item.getAttribute('data-timeline-key'))
      };
    }).filter(function(item) { return item.id; });
  }

  function fetchCommitments(anchorEventId) {
    return fetch('/programme?event=' + encodeURIComponent(anchorEventId))
      .then(function(response) { return response.text(); })
      .then(function(html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        return Array.prototype.slice.call(doc.querySelectorAll('[data-timeline-key]')).map(function(item) {
          var title = item.querySelector('.ttl');
          var time = item.querySelector('.t');
          return {
            id: item.getAttribute('data-timeline-key') || '',
            label: (time ? time.textContent + ' · ' : '') + (title ? title.textContent : item.getAttribute('data-timeline-key'))
          };
        }).filter(function(item) { return item.id; });
      });
  }

  function selectedCommitmentLabel(modal) {
    var select = modal.querySelector('[name="commitmentId"]');
    if (!select || select.selectedIndex < 0) return 'Current commitment';
    return select.options[select.selectedIndex].textContent || 'Current commitment';
  }

  function hasPrefilledProposal(source) {
    if (!source) return false;
    return Boolean(
      source.getAttribute('data-default-commitment-id') &&
      source.getAttribute('data-default-new-starts-at')
    );
  }

  function syncPreviewButton(modal) {
    var previewButton = modal.querySelector('[data-programme-change-preview]');
    var select = modal.querySelector('[name="commitmentId"]');
    if (!previewButton || !select) return;
    var ready = Boolean(select.value && select.value.trim());
    previewButton.disabled = !ready;
    previewButton.setAttribute('aria-disabled', ready ? 'false' : 'true');
  }

  function ensureCommitConfirm(modal) {
    var existing = modal.querySelector('[data-programme-change-confirm]');
    if (existing) return existing;
    var panel = document.createElement('div');
    panel.setAttribute('data-programme-change-confirm', '');
    panel.setAttribute('data-test', 'programme-change-confirm-panel');
    panel.hidden = true;
    panel.className = 'panel';
    panel.style.marginTop = '16px';
    panel.innerHTML =
      '<p class="planning-kicker">Confirm programme change</p>' +
      '<p class="planning-result-title">Commit this headline move?</p>' +
      '<p>Northstar will update the programme and re-check every linked traveller. Nothing changes until you confirm.</p>' +
      '<div class="btn-row" style="margin-top:14px">' +
        '<button type="button" class="btn btn-primary" data-programme-change-confirm-yes data-test="programme-change-confirm-yes">Commit programme change</button>' +
        '<button type="button" class="btn btn-ghost" data-programme-change-confirm-no data-test="programme-change-confirm-no">Go back</button>' +
      '</div>';
    var result = modal.querySelector('[data-programme-change-result]');
    if (result && result.parentNode) result.parentNode.insertBefore(panel, result.nextSibling);
    else modal.appendChild(panel);
    return panel;
  }

  function setStep(modal, step) {
    var edit = modal.querySelector('[data-programme-change-edit]');
    var compare = modal.querySelector('[data-programme-change-compare]');
    var previewPane = modal.querySelector('[data-programme-change-result]');
    var previewButton = modal.querySelector('[data-programme-change-preview]');
    var backButton = modal.querySelector('[data-programme-change-back]');
    var editToggle = modal.querySelector('[data-programme-change-edit-toggle]');
    var commitButton = modal.querySelector('[data-programme-change-commit]');
    var confirmPanel = modal.querySelector('[data-programme-change-confirm]');
    if (confirmPanel) confirmPanel.hidden = true;
    if (step === 'edit') {
      if (edit) edit.hidden = false;
      if (compare) compare.hidden = true;
      if (previewPane) previewPane.replaceChildren();
      if (previewButton) previewButton.hidden = false;
      if (backButton) backButton.hidden = true;
      if (editToggle) editToggle.hidden = true;
      if (commitButton) commitButton.hidden = true;
      modal.setAttribute('data-programme-change-step', 'edit');
      syncPreviewButton(modal);
    } else if (step === 'compare') {
      if (edit) edit.hidden = true;
      if (compare) compare.hidden = false;
      if (previewPane) previewPane.replaceChildren();
      if (previewButton) previewButton.hidden = false;
      if (backButton) backButton.hidden = true;
      if (editToggle) editToggle.hidden = false;
      if (commitButton) commitButton.hidden = true;
      modal.setAttribute('data-programme-change-step', 'compare');
      syncPreviewButton(modal);
    } else {
      if (edit) edit.hidden = true;
      if (compare) compare.hidden = true;
      if (previewButton) previewButton.hidden = true;
      if (backButton) backButton.hidden = false;
      if (editToggle) editToggle.hidden = false;
      if (commitButton) commitButton.hidden = false;
      modal.setAttribute('data-programme-change-step', 'preview');
    }
  }

  function renderPrefilledCompare(modal, payload, nowLabel) {
    var compare = modal.querySelector('[data-programme-change-compare]');
    if (!compare) return;
    compare.replaceChildren();
    var proposed = formatProposedSide(payload);
    var nowMeta = selectedCommitmentMeta(modal);
    var nowSplit = splitWhenLabel(nowMeta.when || nowLabel);
    compare.innerHTML =
      '<div class="change-compare" data-test="programme-change-compare-draft">' +
        compareSlotHtml('Now', nowMeta.date || nowSplit.date, nowMeta.time || nowSplit.time, nowMeta.venue) +
        '<div class="cc-arrow" aria-hidden="true">→</div>' +
        compareSlotHtml('Proposed', proposed.dateLabel, proposed.timeLabel, proposed.venueLabel) +
      '</div>' +
      '<p class="footnote" style="margin-top:12px">Preview is read-only. The live programme stays unchanged until you commit.</p>';
  }

  function openModal(source) {
    var anchorEventId = resolveAnchorEventId(source);
    if (!anchorEventId) return;

    closeModal();

    var defaultCommitmentId = source ? source.getAttribute('data-default-commitment-id') : null;
    var defaultNewStartsAt = source ? source.getAttribute('data-default-new-starts-at') : null;
    var defaultNewEndsAt = source ? source.getAttribute('data-default-new-ends-at') : null;
    var prefilled = hasPrefilledProposal(source);

    var scrim = document.createElement('div');
    scrim.className = 'modal-scrim';
    scrim.setAttribute('data-programme-change-scrim', '');

    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Programme change preview');
    modal.setAttribute('data-programme-change-modal', '');
    modal.setAttribute('data-programme-change-step', prefilled ? 'compare' : 'edit');
    modal.innerHTML =
      '<div class="preview-banner"><span class="pb-dot" aria-hidden="true"></span>Preview · no changes made yet</div>' +
      '<h2>' + (prefilled ? 'Move the headline to the proposed time?' : 'Preview a programme change') + '</h2>' +
      '<p class="m-sub">' + (prefilled
        ? 'This is a preview. The current programme and all trip states remain unchanged until the organiser commits.'
        : 'Edit the proposed change, then preview the Now vs Proposed impact before anything is committed.') + '</p>' +
      '<div data-programme-change-compare' + (prefilled ? '' : ' hidden') + ' style="margin-top:16px"></div>' +
      '<button type="button" class="btn btn-ghost" data-programme-change-edit-toggle' + (prefilled ? '' : ' hidden') + ' style="margin-top:8px">Adjust proposal</button>' +
      '<div data-programme-change-edit' + (prefilled ? ' hidden' : '') + '>' +
        '<div class="panel" style="margin-top:16px">' +
          '<label class="kv-label" for="programme-change-commitment">Commitment</label>' +
          '<select id="programme-change-commitment" name="commitmentId" style="width:100%;margin:6px 0 14px"></select>' +
          '<label class="kv-label" for="programme-change-kind">Change</label>' +
          '<select id="programme-change-kind" name="changeKind" style="width:100%;margin:6px 0 14px">' +
            '<option value="RESCHEDULED">Reschedule</option>' +
            '<option value="RELOCATED">Relocate</option>' +
            '<option value="CANCELLED">Cancel</option>' +
            '<option value="OTHER">Other change</option>' +
          '</select>' +
          '<label class="kv-label" for="programme-change-start">New start</label>' +
          '<input id="programme-change-start" name="newStartsAt" type="text" placeholder="e.g. 1 Oct · 15:30" style="width:100%;box-sizing:border-box;margin:6px 0 14px">' +
          '<label class="kv-label" for="programme-change-end">New end</label>' +
          '<input id="programme-change-end" name="newEndsAt" type="text" placeholder="e.g. 1 Oct · 16:00" style="width:100%;box-sizing:border-box;margin:6px 0 14px">' +
          '<label class="kv-label" for="programme-change-place">New place (optional)</label>' +
          '<input id="programme-change-place" name="newPlaceId" type="text" placeholder="Leave blank to keep the current venue" style="width:100%;box-sizing:border-box;margin:6px 0 0">' +
        '</div>' +
      '</div>' +
      '<div data-programme-change-result style="margin-top:16px" data-test="programme-change-result"></div>' +
      '<div class="btn-row" style="margin-top:18px">' +
        '<button type="button" class="btn btn-primary" data-programme-change-preview data-test="programme-change-preview" disabled>Preview impact</button>' +
        '<button type="button" class="btn btn-ghost" data-programme-change-back hidden data-test="programme-change-back">Back</button>' +
        '<button type="button" class="btn btn-primary" data-programme-change-commit hidden data-test="programme-change-commit">Commit programme change</button>' +
        '<button type="button" class="btn btn-ghost" data-programme-change-cancel>Cancel</button>' +
      '</div>' +
      '<p class="footnote">No programme mutation until you commit.</p>';

    document.body.appendChild(scrim);
    document.body.appendChild(modal);
    ensureCommitConfirm(modal);

    var select = modal.querySelector('[name="commitmentId"]');
    var startInput = modal.querySelector('[name="newStartsAt"]');
    var endInput = modal.querySelector('[name="newEndsAt"]');
    if (defaultNewStartsAt) {
      startInput.value = formatHumanInstant(defaultNewStartsAt);
      startInput.setAttribute('data-iso-value', defaultNewStartsAt);
    }
    if (defaultNewEndsAt) {
      endInput.value = formatHumanInstant(defaultNewEndsAt);
      endInput.setAttribute('data-iso-value', defaultNewEndsAt);
    }

    function afterCommitmentsLoaded() {
      syncPreviewButton(modal);
      if (prefilled) {
        var payload = buildPayload(modal);
        renderPrefilledCompare(modal, payload, selectedCommitmentLabel(modal));
      }
    }

    var timelineCommitments = commitmentItemsFromTimeline();
    if (timelineCommitments.length > 0) {
      populateCommitmentSelect(select, timelineCommitments, defaultCommitmentId);
      afterCommitmentsLoaded();
    } else {
      select.innerHTML = '<option value="">Loading commitments…</option>';
      fetchCommitments(anchorEventId).then(function(items) {
        populateCommitmentSelect(select, items, defaultCommitmentId);
        afterCommitmentsLoaded();
      }).catch(function() {
        select.innerHTML = '<option value="">Could not load commitments</option>';
        syncPreviewButton(modal);
      });
    }
    select.addEventListener('change', function() {
      syncPreviewButton(modal);
      if (prefilled && modal.getAttribute('data-programme-change-step') !== 'preview') {
        renderPrefilledCompare(modal, buildPayload(modal), selectedCommitmentLabel(modal));
      }
    });

    var previewButton = modal.querySelector('[data-programme-change-preview]');
    var commitButton = modal.querySelector('[data-programme-change-commit]');
    var backButton = modal.querySelector('[data-programme-change-back]');
    var editToggle = modal.querySelector('[data-programme-change-edit-toggle]');
    var cancelButton = modal.querySelector('[data-programme-change-cancel]');
    var result = modal.querySelector('[data-programme-change-result]');
    var confirmPanel = ensureCommitConfirm(modal);
    var lastPreviewPayload = null;

    cancelButton.addEventListener('click', closeModal);
    scrim.addEventListener('click', closeModal);
    if (editToggle) {
      editToggle.addEventListener('click', function() {
        setStep(modal, 'edit');
      });
    }
    backButton.addEventListener('click', function() {
      lastPreviewPayload = null;
      setStep(modal, prefilled ? 'compare' : 'edit');
    });
    confirmPanel.querySelector('[data-programme-change-confirm-no]').addEventListener('click', function() {
      confirmPanel.hidden = true;
    });

    function runPreview() {
      var payload = buildPayload(modal);
      if (!payload.commitmentId) {
        result.textContent = 'Select the programme commitment to preview.';
        return;
      }
      if (payload.changeKind === 'RESCHEDULED' && !payload.newStartsAt) {
        result.textContent = 'Enter the proposed new start time.';
        return;
      }
      previewButton.disabled = true;
      commitButton.hidden = true;
      confirmPanel.hidden = true;
      result.replaceChildren();
      var previewSteps = [
        'Checking linked travellers',
        'Testing the proposed headline time',
        'Measuring blast radius across the programme'
      ];
      showStagedOverlay('Computing programme impact', previewSteps, PREVIEW_MS, function() {
        postJson('/api/programme/' + encodeURIComponent(anchorEventId) + '/change-preview', payload)
          .then(function(response) {
            syncPreviewButton(modal);
            if (!response.ok) {
              lastPreviewPayload = null;
              setStep(modal, prefilled ? 'compare' : 'edit');
              result.textContent = previewErrorText(response.data);
              return;
            }
            lastPreviewPayload = payload;
            renderNowProposedCompare(result, response.data, payload, selectedCommitmentLabel(modal), modal);
            setStep(modal, 'preview');
          })
          .catch(function(error) {
            syncPreviewButton(modal);
            lastPreviewPayload = null;
            setStep(modal, prefilled ? 'compare' : 'edit');
            result.textContent = 'Preview failed: ' + (error && error.message ? error.message : 'unknown error');
          });
      });
    }

    previewButton.addEventListener('click', runPreview);

    function runCommit() {
      if (!lastPreviewPayload) return;
      commitButton.disabled = true;
      result.textContent = 'Committing change and re-checking affected trips…';
      postJson('/api/programme/' + encodeURIComponent(anchorEventId) + '/change-commit', lastPreviewPayload)
        .then(function(response) {
          if (!response.ok) {
            commitButton.disabled = false;
            confirmPanel.hidden = true;
            result.textContent = 'Commit failed: ' + previewErrorText(response.data);
            return;
          }
          result.textContent = 'Programme updated. Northstar re-checked the affected trips.';
          showLifecycleOverlay([
            'Committing programme change',
            'Updating linked programme dependencies',
            'Rechecking affected travellers',
            'Updating trip records',
            'Confirming viability'
          ], function() { window.location.reload(); });
        })
        .catch(function(error) {
          commitButton.disabled = false;
          confirmPanel.hidden = true;
          result.textContent = 'Commit failed: ' + (error && error.message ? error.message : 'unknown error');
        });
    }

    commitButton.addEventListener('click', function() {
      if (!lastPreviewPayload) return;
      confirmPanel.hidden = false;
      var yes = confirmPanel.querySelector('[data-programme-change-confirm-yes]');
      yes.onclick = function() {
        confirmPanel.hidden = true;
        runCommit();
      };
    });
  }

  if (actionRow && timelineItems.length > 0 && resolveAnchorEventId(null)) {
    var programmeLaunch = document.createElement('button');
    programmeLaunch.type = 'button';
    programmeLaunch.className = 'btn btn-primary';
    programmeLaunch.textContent = 'Preview programme change';
    programmeLaunch.setAttribute('data-programme-change-launch', '');
    programmeLaunch.setAttribute('data-anchor-event-id', resolveAnchorEventId(null));
    actionRow.insertBefore(programmeLaunch, actionRow.firstChild);
    launchButtons.push(programmeLaunch);
  }

  launchButtons.forEach(function(button) {
    button.addEventListener('click', function() { openModal(button); });
  });
})();
</script>`;
}
