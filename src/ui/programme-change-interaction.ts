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
    var newStartsAt = modal.querySelector('[name="newStartsAt"]').value.trim();
    var newEndsAt = modal.querySelector('[name="newEndsAt"]').value.trim();
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

  function formatProposedSide(payload) {
    if (payload.changeKind === 'CANCELLED') return { whenLabel: 'Cancelled', whereLabel: undefined };
    var when = payload.newStartsAt
      ? formatClockRange(payload.newStartsAt, payload.newEndsAt)
      : 'Time not set';
    return {
      whenLabel: when,
      whereLabel: payload.newPlaceId ? undefined : undefined
    };
  }

  function viabilityLabel(consequence) {
    if (consequence === 'DISRUPTED') return 'Needs Attention';
    if (consequence === 'AT_RISK') return 'Watching';
    return 'Affected';
  }

  function viabilityTone(consequence) {
    if (consequence === 'DISRUPTED') return 'alert';
    if (consequence === 'AT_RISK') return 'watch';
    return 'watch';
  }

  function renderNowProposedCompare(target, preview, payload, nowLabel) {
    target.replaceChildren();

    var banner = document.createElement('div');
    banner.className = 'preview-banner';
    banner.setAttribute('data-test', 'programme-change-preview-banner');
    banner.innerHTML = '<span class="pb-dot" aria-hidden="true"></span>Preview · no changes made yet';
    target.appendChild(banner);

    var compare = document.createElement('div');
    compare.className = 'change-compare';
    compare.setAttribute('data-test', 'now-vs-proposed');

    var nowBox = document.createElement('div');
    nowBox.className = 'cc-box';
    nowBox.innerHTML = '<p class="kv-label">Now</p><div class="cc-when"></div>';
    nowBox.querySelector('.cc-when').textContent = nowLabel || 'Current commitment';
    compare.appendChild(nowBox);

    var arrow = document.createElement('div');
    arrow.className = 'cc-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    compare.appendChild(arrow);

    var proposed = formatProposedSide(payload);
    var proposedBox = document.createElement('div');
    proposedBox.className = 'cc-box to';
    proposedBox.innerHTML = '<p class="kv-label">Proposed</p><div class="cc-when"></div>';
    proposedBox.querySelector('.cc-when').textContent = changeKindLabel(payload.changeKind) + ' · ' + proposed.whenLabel;
    if (proposed.whereLabel) {
      var where = document.createElement('div');
      where.className = 'cc-where';
      where.textContent = proposed.whereLabel;
      proposedBox.appendChild(where);
    }
    compare.appendChild(proposedBox);
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
    summary.textContent = affected.length + ' trip' + (affected.length === 1 ? '' : 's') + ' affected · ' + unaffected.length + ' unaffected';
    target.appendChild(summary);

    if (affected.length === 0) {
      var none = document.createElement('p');
      none.textContent = 'No linked trip becomes affected under this preview.';
      target.appendChild(none);
    } else {
      affected.forEach(function(item) {
        var row = document.createElement('div');
        row.className = 'impact-row';
        row.setAttribute('data-test', 'preview-impact-row');

        var names = Array.isArray(item.travellerNames) ? item.travellerNames.filter(Boolean) : [];
        var count = document.createElement('span');
        count.className = 'i-count';
        count.textContent = names.length > 0
          ? names.join(', ')
          : String(Array.isArray(item.travellerIds) ? item.travellerIds.length : 1);
        row.appendChild(count);

        var detail = document.createElement('span');
        var reasons = Array.isArray(item.reasons) && item.reasons.length
          ? item.reasons.map(function(reason) {
              return String(reason)
                .replace(/commitment rescheduled/gi, 'Programme commitment moves')
                .replace(/\\b\\d{4}-\\d{2}-\\d{2}T[\\d:+.-]+/g, function(iso) { return formatHumanInstant(iso); });
            }).join(' · ')
          : 'Affected by the proposed programme change.';
        detail.textContent = reasons;
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

  function setStep(modal, step) {
    var edit = modal.querySelector('[data-programme-change-edit]');
    var previewPane = modal.querySelector('[data-programme-change-result]');
    var previewButton = modal.querySelector('[data-programme-change-preview]');
    var backButton = modal.querySelector('[data-programme-change-back]');
    var commitButton = modal.querySelector('[data-programme-change-commit]');
    if (step === 'edit') {
      if (edit) edit.hidden = false;
      if (previewPane) previewPane.replaceChildren();
      if (previewButton) previewButton.hidden = false;
      if (backButton) backButton.hidden = true;
      if (commitButton) commitButton.hidden = true;
      modal.setAttribute('data-programme-change-step', 'edit');
    } else {
      if (edit) edit.hidden = true;
      if (previewButton) previewButton.hidden = true;
      if (backButton) backButton.hidden = false;
      if (commitButton) commitButton.hidden = false;
      modal.setAttribute('data-programme-change-step', 'preview');
    }
  }

  function openModal(source) {
    var anchorEventId = resolveAnchorEventId(source);
    if (!anchorEventId) return;

    closeModal();

    var defaultCommitmentId = source ? source.getAttribute('data-default-commitment-id') : null;
    var defaultNewStartsAt = source ? source.getAttribute('data-default-new-starts-at') : null;
    var defaultNewEndsAt = source ? source.getAttribute('data-default-new-ends-at') : null;

    var scrim = document.createElement('div');
    scrim.className = 'modal-scrim';
    scrim.setAttribute('data-programme-change-scrim', '');

    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Programme change preview');
    modal.setAttribute('data-programme-change-modal', '');
    modal.setAttribute('data-programme-change-step', 'edit');
    modal.innerHTML =
      '<div class="preview-banner"><span class="pb-dot" aria-hidden="true"></span>What-if check · nothing changes until you commit</div>' +
      '<h2>Preview a programme change</h2>' +
      '<p class="m-sub">Edit the proposed change, then preview the Now vs Proposed impact before anything is committed.</p>' +
      '<div data-programme-change-edit>' +
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
          '<input id="programme-change-start" name="newStartsAt" type="text" placeholder="e.g. 1 Oct · 15:30 (or full ISO with offset)" style="width:100%;box-sizing:border-box;margin:6px 0 14px">' +
          '<label class="kv-label" for="programme-change-end">New end</label>' +
          '<input id="programme-change-end" name="newEndsAt" type="text" placeholder="e.g. 1 Oct · 16:00 (or full ISO with offset)" style="width:100%;box-sizing:border-box;margin:6px 0 14px">' +
          '<label class="kv-label" for="programme-change-place">New place (optional)</label>' +
          '<input id="programme-change-place" name="newPlaceId" type="text" placeholder="Leave blank to keep the current venue" style="width:100%;box-sizing:border-box;margin:6px 0 0">' +
        '</div>' +
      '</div>' +
      '<div data-programme-change-result style="margin-top:16px" data-test="programme-change-result"></div>' +
      '<div class="btn-row" style="margin-top:18px">' +
        '<button type="button" class="btn btn-primary" data-programme-change-preview data-test="programme-change-preview">Preview impact</button>' +
        '<button type="button" class="btn btn-ghost" data-programme-change-back hidden data-test="programme-change-back">Back</button>' +
        '<button type="button" class="btn btn-primary" data-programme-change-commit hidden data-test="programme-change-commit">Commit change</button>' +
        '<button type="button" class="btn btn-ghost" data-programme-change-cancel>Cancel</button>' +
      '</div>' +
      '<p class="footnote">Preview is read-only. Commit uses the existing programme-change fan-out and re-evaluates affected trips.</p>';

    document.body.appendChild(scrim);
    document.body.appendChild(modal);

    var select = modal.querySelector('[name="commitmentId"]');
    var startInput = modal.querySelector('[name="newStartsAt"]');
    var endInput = modal.querySelector('[name="newEndsAt"]');
    if (defaultNewStartsAt) startInput.value = defaultNewStartsAt;
    if (defaultNewEndsAt) endInput.value = defaultNewEndsAt;

    var timelineCommitments = commitmentItemsFromTimeline();
    if (timelineCommitments.length > 0) {
      populateCommitmentSelect(select, timelineCommitments, defaultCommitmentId);
    } else {
      select.innerHTML = '<option value="">Loading commitments…</option>';
      fetchCommitments(anchorEventId).then(function(items) {
        populateCommitmentSelect(select, items, defaultCommitmentId);
      }).catch(function() {
        select.innerHTML = '<option value="">Could not load commitments</option>';
      });
    }

    var previewButton = modal.querySelector('[data-programme-change-preview]');
    var commitButton = modal.querySelector('[data-programme-change-commit]');
    var backButton = modal.querySelector('[data-programme-change-back]');
    var cancelButton = modal.querySelector('[data-programme-change-cancel]');
    var result = modal.querySelector('[data-programme-change-result]');
    var lastPreviewPayload = null;

    cancelButton.addEventListener('click', closeModal);
    scrim.addEventListener('click', closeModal);
    backButton.addEventListener('click', function() {
      lastPreviewPayload = null;
      setStep(modal, 'edit');
    });

    previewButton.addEventListener('click', function() {
      var payload = buildPayload(modal);
      if (payload.changeKind === 'RESCHEDULED' && !payload.newStartsAt) {
        result.textContent = 'Enter the proposed new start time, including its timezone offset.';
        return;
      }
      previewButton.disabled = true;
      commitButton.hidden = true;
      result.textContent = 'Checking affected trips…';
      postJson('/api/programme/' + encodeURIComponent(anchorEventId) + '/change-preview', payload)
        .then(function(response) {
          previewButton.disabled = false;
          if (!response.ok) {
            lastPreviewPayload = null;
            setStep(modal, 'edit');
            result.textContent = 'Preview failed: ' + JSON.stringify(response.data);
            return;
          }
          lastPreviewPayload = payload;
          renderNowProposedCompare(result, response.data, payload, selectedCommitmentLabel(modal));
          setStep(modal, 'preview');
        })
        .catch(function(error) {
          previewButton.disabled = false;
          lastPreviewPayload = null;
          setStep(modal, 'edit');
          result.textContent = 'Preview failed: ' + error.message;
        });
    });

    commitButton.addEventListener('click', function() {
      if (!lastPreviewPayload) return;
      if (!window.confirm('Commit this programme change and re-check affected trips?')) return;
      commitButton.disabled = true;
      result.textContent = 'Committing change and re-checking affected trips…';
      postJson('/api/programme/' + encodeURIComponent(anchorEventId) + '/change-commit', lastPreviewPayload)
        .then(function(response) {
          if (!response.ok) {
            commitButton.disabled = false;
            result.textContent = 'Commit failed: ' + JSON.stringify(response.data);
            return;
          }
          result.textContent = 'Programme updated. Northstar re-checked the affected trips.';
          window.setTimeout(function() { window.location.reload(); }, 220);
        })
        .catch(function(error) {
          commitButton.disabled = false;
          result.textContent = 'Commit failed: ' + error.message;
        });
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
