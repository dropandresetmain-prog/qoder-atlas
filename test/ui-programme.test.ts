/**
 * Lane E evidence — RV-N10 programme surface proofs.
 *
 * The frozen ProgrammeView read model is rendered by a pure function in
 * src/ui/screens/operator-programme.ts. These tests prove:
 *  - LOADING / ERROR / LOADED envelope branches all render honestly.
 *  - The 45-traveller demo scale renders every row (no truncation).
 *  - The deterministic status priority order (DISRUPTED first, RESOLVED
 *    last, with PLANNING / NEEDS_TRAVELLER_INFO / CHANGE_REQUESTED in
 *    between) is preserved.
 *  - The endangered-commitment section is hidden when absent and shown
 *    with the deterministic reason and affected count when present.
 *  - Every dynamic value passes through escapeHtml, including hostile
 *    traveller names like <script>.
 *  - All rendered copy is jargon-free (no FORBIDDEN_UI_TERMS leakage).
 *  - Preview-only fixtures type-check against the frozen ProgrammeView.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { EntityIdSchema, IsoDateTimeSchema } from '../src/domain/common.ts';
import { FORBIDDEN_UI_TERMS } from '../src/ui/copy.ts';
import {
  renderProgramme,
  renderProgrammeBody,
  renderProgrammeChangePreview,
  renderProgrammeIntake,
  STATUS_PRIORITY,
  dedupeProgrammeTimeline,
} from '../src/ui/screens/operator-programme.ts';
import {
  healthyProgramme,
  healthyProgrammeLoaded,
  programmeError,
  programmeLoading,
  programmeWithEndangeredCommitment,
  programmeWithEndangeredCommitmentLoaded,
} from '../src/ui/fixtures/readmodels.ts';
import type { ProgrammeView } from '../src/contracts/readmodels.ts';

function assertNoJargon(html: string, screenId: string): void {
  const lowered = html.toLowerCase();
  for (const term of FORBIDDEN_UI_TERMS) {
    assert.ok(!lowered.includes(term), `jargon "${term}" leaked in ${screenId}`);
  }
  for (const term of ['trip signal', 'blast radius', 'recovery strategy']) {
    assert.ok(!lowered.includes(term), `internal phrase "${term}" leaked in ${screenId}`);
  }
}

test('envelope LOADING surfaces the loading panel without fabricating data', () => {
  const html = renderProgramme(programmeLoading);
  assert.ok(html.includes('data-ui-state="loading"'));
  assert.ok(html.includes('Loading the programme'));
  assert.ok(!html.includes('data-trip-id'));
  assert.ok(!html.includes('Atlas Innovation Summit 2026'));
  assertNoJargon(html, 'programme-loading');
});

test('envelope ERROR surfaces the error panel with the message', () => {
  const html = renderProgramme(programmeError);
  assert.ok(html.includes('data-ui-state="error"'));
  assert.ok(html.includes('The programme is unavailable right now'));
  assert.ok(html.includes('programme service did not respond'));
  assert.ok(!html.includes('data-trip-id'));
  assertNoJargon(html, 'programme-error');
});

test('envelope LOADED renders the programme body', () => {
  const html = renderProgramme(healthyProgrammeLoaded);
  assert.ok(html.includes('Atlas Innovation Summit 2026'));
  // R3D simplified managed-travel presentation buckets + Local cohort.
  assert.ok(html.includes('data-summary-key="confirmed"'));
  assert.ok(html.includes('data-summary-key="needs-attention"'));
  assert.ok(html.includes('data-summary-key="watching"'));
  assert.ok(html.includes('data-summary-key="unconfirmed"'));
  assert.ok(html.includes('data-summary-key="local"'));
  assert.ok(html.includes('href="/programme/import"'));
  assert.ok(html.includes('Import an updated sheet'));
  assertNoJargon(html, 'programme-loaded');
});

test('45-traveller scale renders every row with no truncation', () => {
  const html = renderProgrammeBody(healthyProgramme);
  const rowCount = (html.match(/<tr[^>]*data-trip-id=/g) ?? []).length;
  assert.equal(rowCount, 45, 'every traveller row must be rendered');
  // Scale banner and confirmed/local presentation remain coherent.
  assert.ok(html.includes('data-summary-key="confirmed"'));
  assert.ok(html.includes('45 participants'));
  assert.ok(html.includes('45 Northstar-managed'));
  for (const traveller of healthyProgramme.travellers) {
    assert.ok(
      html.includes(`data-traveller-id="${traveller.travellerId}"`),
      `traveller row missing: ${traveller.travellerId}`,
    );
  }
});

test('deterministic status ordering puts attention first, resolved last', () => {
  // The status priority is single-sourced from operator-programme so the
  // table and any future sort widget cannot disagree with the dashboard.
  assert.ok(STATUS_PRIORITY.DISRUPTED < STATUS_PRIORITY.AT_RISK);
  assert.ok(STATUS_PRIORITY.AT_RISK < STATUS_PRIORITY.RECOVERING);
  assert.ok(STATUS_PRIORITY.RECOVERING < STATUS_PRIORITY.NEEDS_TRAVELLER_INFO);
  assert.ok(STATUS_PRIORITY.NEEDS_TRAVELLER_INFO < STATUS_PRIORITY.CHANGE_REQUESTED);
  assert.ok(STATUS_PRIORITY.CHANGE_REQUESTED < STATUS_PRIORITY.UNKNOWN);
  assert.ok(STATUS_PRIORITY.UNKNOWN < STATUS_PRIORITY.PLANNING);
  assert.ok(STATUS_PRIORITY.PLANNING < STATUS_PRIORITY.READY);
  assert.ok(STATUS_PRIORITY.READY < STATUS_PRIORITY.RESOLVED);

  const html = renderProgrammeBody(healthyProgramme);
  // First three travellers in the rendered DOM should be the two DISRUPTED
  // and the four AT_RISK rows (in id order, all from the dataset).
  const disruptedAt = html.indexOf('data-status="DISRUPTED"');
  const atRiskAt = html.indexOf('data-status="AT_RISK"');
  const readyAt = html.indexOf('data-status="READY"');
  const resolvedAt = html.indexOf('data-status="RESOLVED"');
  assert.ok(disruptedAt > 0 && atRiskAt > 0 && disruptedAt < atRiskAt);
  assert.ok(readyAt > 0 && disruptedAt < readyAt);
  assert.ok(resolvedAt > 0 && atRiskAt < resolvedAt);
  // PLANNING rows must precede READY rows.
  const planningAt = html.indexOf('data-status="PLANNING"');
  assert.ok(planningAt > 0 && planningAt < readyAt);
});

test('programme links travellers to trip detail and keeps active cases separately discoverable', () => {
  const html = renderProgrammeBody(healthyProgramme);
  for (const traveller of healthyProgramme.travellers) {
    assert.match(html, new RegExp(`href="/traveller\\?trip=${traveller.tripId}"`));
    const caseId = traveller.activeCaseIds[0];
    if (caseId) assert.match(html, new RegExp(`href="/operator/cases/${caseId}"`));
  }
  assert.match(html, /data-test="programme-traveller-link"/);
});

test('endangered-commitments section is omitted when the list is empty', () => {
  const html = renderProgrammeBody(healthyProgramme);
  assert.ok(!html.includes('data-ui-section="endangered-commitments"'));
});

test('endangered-commitments section is rendered with reason and affected count when present', () => {
  const html = renderProgrammeBody(programmeWithEndangeredCommitment);
  assert.ok(html.includes('data-ui-section="endangered-commitments"'));
  assert.ok(html.includes('Welcome dinner at the riverside venue'));
  assert.ok(html.includes('Original venue closed'));
  assert.ok(html.includes('3 travellers affected'));
  assert.ok(html.includes('href="/programme/import"'));
  assertNoJargon(html, 'programme-endangered');
});

test('missing-information panel lists every NEEDS_TRAVELLER_INFO traveller', () => {
  const html = renderProgrammeBody(healthyProgramme);
  assert.ok(html.includes('data-ui-section="missing-info"'));
  assert.ok(html.includes('Passport number is missing from the intake form'));
  assert.ok(html.includes('Priya Subramanian'));
  assert.ok(html.includes('Quentin Lefebvre'));
  assert.ok(html.includes('Welcome dinner venue capacity not yet confirmed'));
});

test('footer actions are link-only and labelled honestly', () => {
  const html = renderProgrammeBody(healthyProgramme);
  assert.ok(html.includes('data-ui-section="programme-actions"'));
  assert.ok(html.includes('href="/programme/import"'));
  assert.ok(html.includes('Import an updated sheet'));
  assert.ok(html.includes('Export roster'));
  // No fake form actions or scripted submission.
  assert.ok(!html.includes('onsubmit='));
  assert.ok(!html.includes('fetch('));
});

test('HTML escaping neutralises injected traveller names', () => {
  const hostile: ProgrammeView = {
    ...healthyProgramme,
    travellers: healthyProgramme.travellers.map((traveller, index) =>
      index === 0
        ? { ...traveller, travellerName: '<script>alert(1)</script>' }
        : index === 1
          ? { ...traveller, travellerName: 'A "quoted" & <angled> name' }
          : traveller,
    ),
  };
  const html = renderProgrammeBody(hostile);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('A &quot;quoted&quot; &amp; &lt;angled&gt; name'));
  assertNoJargon(html, 'programme-xss');
});

test('preview fixtures parse against the frozen ProgrammeView shape', () => {
  // Type-level proof: each fixture is constructed via a typed const and
  // the structural shape is asserted at runtime. If the contract moves,
  // this test catches the regression at compile time (TS) and at runtime
  // (the explicit field assertions below).
  const sample: ProgrammeView = healthyProgramme;
  for (const required of [
    'generatedAt',
    'anchorEventId',
    'anchorEventName',
    'summary',
    'travellers',
    'endangeredCommitments',
    'unresolvedUncertainties',
  ] as const) {
    assert.ok(required in sample, `ProgrammeView missing field: ${required}`);
  }
  assert.equal(EntityIdSchema.safeParse(sample.anchorEventId).success, true);
  assert.equal(IsoDateTimeSchema.safeParse(sample.generatedAt).success, true);

  // All ids/timestamps inside the 45-traveller fixture must satisfy the
  // frozen domain formats — same gate the existing UI tests use.
  for (const traveller of sample.travellers) {
    assert.equal(EntityIdSchema.safeParse(traveller.tripId).success, true);
    assert.equal(EntityIdSchema.safeParse(traveller.travellerId).success, true);
    assert.equal(IsoDateTimeSchema.safeParse(traveller.updatedAt).success, true);
    for (const caseId of traveller.activeCaseIds) {
      assert.equal(EntityIdSchema.safeParse(caseId).success, true);
    }
  }
  for (const commitment of programmeWithEndangeredCommitment.endangeredCommitments) {
    assert.equal(EntityIdSchema.safeParse(commitment.commitmentId).success, true);
    for (const ref of commitment.affectedTravellerIds) {
      assert.equal(EntityIdSchema.safeParse(ref).success, true);
    }
  }

  // Summary counts must match the dataset (the fixture uses the same
  // helper, so this is both a sanity check and a regression guard).
  const counts = sample.travellers.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});
  assert.equal(sample.summary.total, sample.travellers.length);
  assert.equal(sample.summary.ready, counts.READY ?? 0);
  assert.equal(sample.summary.planning, counts.PLANNING ?? 0);
  assert.equal(sample.summary.needsTravellerInfo, counts.NEEDS_TRAVELLER_INFO ?? 0);
  assert.equal(sample.summary.changeRequested, counts.CHANGE_REQUESTED ?? 0);
  assert.equal(sample.summary.atRisk, counts.AT_RISK ?? 0);
  assert.equal(sample.summary.disrupted, counts.DISRUPTED ?? 0);
  assert.equal(sample.summary.recovering, counts.RECOVERING ?? 0);
  assert.equal(sample.summary.resolved, counts.RESOLVED ?? 0);
  assert.equal(sample.summary.unknown, counts.UNKNOWN ?? 0);
});

test('all programme surface output is jargon-free', () => {
  const screens = [
    { id: 'healthy-body', html: renderProgrammeBody(healthyProgramme) },
    { id: 'endangered-body', html: renderProgrammeBody(programmeWithEndangeredCommitment) },
    { id: 'healthy-envelope', html: renderProgramme(healthyProgrammeLoaded) },
    { id: 'endangered-envelope', html: renderProgramme(programmeWithEndangeredCommitmentLoaded) },
  ];
  for (const screen of screens) assertNoJargon(screen.html, screen.id);
});

// ---------------------------------------------------------------------------
// Approved-design augmentations: timeline, case links, preview modal, intake
// ---------------------------------------------------------------------------

const sampleTimeline = [
  {
    dateLabel: 'Wed 1 Oct',
    items: [
      { key: 'rehearsal', timeLabel: '09:00', title: 'Keynote rehearsal (closed)', tag: 'Arjun lands 09:25', tone: 'endangered' as const },
      { key: 'keynote', timeLabel: '10:00', title: 'Keynote', tag: 'Depends on recovery', tone: 'watch' as const },
      { key: 'thinktank', timeLabel: '11:00', title: 'Thinktank', tone: 'ok' as const },
    ],
  },
];

test('timeline section renders only when the augmentation supplies it', () => {
  const without = renderProgrammeBody(healthyProgramme);
  assert.ok(!without.includes('class="timeline"'));
  const withTimeline = renderProgrammeBody(healthyProgramme, { timeline: sampleTimeline });
  assert.ok(withTimeline.includes('class="timeline"'));
  assert.ok(withTimeline.includes('3 commitments · 1 day'));
  assert.ok(withTimeline.includes('tl-item endangered'));
  assert.ok(withTimeline.includes('d-watch'));
  assertNoJargon(withTimeline, 'programme-timeline');
});

test('timeline deduplicates repeated commitments and surfaces affected travellers once', () => {
  const duplicateTimeline = [
    {
      dateLabel: 'Tue 30 Sep',
      items: [
        { key: 'cmt-boot', timeLabel: '14:00', title: 'AiT Bootcamp — Opening Remarks', tone: 'ok' as const, tag: 'Traveller A' },
        { key: 'cmt-boot', timeLabel: '14:00', title: 'AiT Bootcamp — Opening Remarks', tone: 'ok' as const, tag: 'Traveller B' },
        { key: 'cmt-boot', timeLabel: '14:00', title: 'AiT Bootcamp — Opening Remarks', tone: 'ok' as const, tag: 'Traveller C' },
      ],
    },
  ];
  const deduped = dedupeProgrammeTimeline(duplicateTimeline);
  assert.equal(deduped[0]?.items.length, 1);
  assert.equal(deduped[0]?.items[0]?.affectedLabels?.length, 3);
  const html = renderProgrammeBody(healthyProgramme, { timeline: duplicateTimeline });
  assert.equal((html.match(/data-timeline-key="cmt-boot"/g) ?? []).length, 1);
  assert.match(html, /3 travellers/);
  assert.match(html, /class="tl-affected"/);
  assert.match(html, /Traveller A/);
});

test('traveller table uses recovered-style fixed columns without scroll bleed', () => {
  const html = renderProgrammeBody(healthyProgramme);
  assert.match(html, /data-ui-section="traveller-table"/);
  assert.match(html, /class="table-wrap"/);
  assert.match(html, /table-layout:fixed/);
  assert.match(html, /<colgroup>/);
  assert.doesNotMatch(html, /class="table-scroll"/);
});

test('endangered commitments render the case link only when the augmentation maps one', () => {
  const withoutLink = renderProgrammeBody(programmeWithEndangeredCommitment);
  assert.ok(!withoutLink.includes('Open the case →'), 'no case link without the augmentation');
  const withLink = renderProgrammeBody(programmeWithEndangeredCommitment, {
    commitmentHrefFor: (item) => ({ href: `/operator/cases/case-for-${item.commitmentId}`, label: 'Open the case →' }),
  });
  assert.ok(withLink.includes('Open the case →'));
  assert.ok(withLink.includes('href="/operator/cases/case-for-'));
});

test('committed notice and just-changed markers render from augmentations only', () => {
  const plain = renderProgrammeBody(healthyProgramme);
  assert.ok(!plain.includes('data-ui-section="committed-notice"'));
  assert.ok(!plain.includes('just-changed'));
  const committed = renderProgrammeBody(healthyProgramme, {
    timeline: sampleTimeline,
    committedNotice: { title: 'Session moved — 22 Sep, 10:02', body: 'The session is now later.', footnote: 'Roster and timeline updated.' },
    justChangedTimelineKeys: new Set(['keynote']),
    justChangedTripIds: new Set([healthyProgramme.travellers[0]!.tripId]),
  });
  assert.ok(committed.includes('data-ui-section="committed-notice"'));
  assert.ok(committed.includes('Session moved — 22 Sep, 10:02'));
  assert.ok(committed.includes('tl-item just-changed'));
  assert.ok(committed.includes('tr class="just-changed"'));
  assertNoJargon(committed, 'programme-committed');
});

test('change preview modal renders over an inert backdrop with honest framing', () => {
  const html = renderProgrammeChangePreview(healthyProgramme, {
    title: 'Move the welcome dinner?',
    subtitle: 'A what-if for the programme team.',
    current: { whenLabel: 'Wed 1 Oct · 14:00–14:20', whereLabel: 'Main hall' },
    proposed: { whenLabel: 'Wed 1 Oct · 09:50–10:10', whereLabel: 'Main hall — same room' },
    impacts: [
      { countLabel: '1', text: 'One traveller lands close to the new time.', badgeLabel: 'At risk', badgeTone: 'watch' },
      { countLabel: '44', text: 'unaffected — arrivals, stays and commitments all still hold.', badgeLabel: 'No impact', badgeTone: 'ok' },
    ],
    alternatives: [
      { label: 'Keep the 14:00 slot', note: 'no impact — the default' },
      { label: 'Move to 11:30 instead', note: 'viable for everyone' },
    ],
    checksFootnote: 'Checked against all 45 trips. No bookings have been touched.',
    confirmLabel: 'Confirm the move',
    cancelLabel: 'Cancel — keep 14:00',
  });
  assert.ok(html.includes('aria-hidden="true"'));
  assert.ok(html.includes('class="modal-scrim"'));
  assert.ok(html.includes('role="dialog"'));
  assert.ok(html.includes('Preview · no changes made yet'));
  assert.ok(html.includes('class="change-compare"'));
  assert.ok(html.includes('class="impact-row"'));
  assert.ok(html.includes('class="alt-row"'));
  // Without hrefs the actions are inert buttons — never fake links.
  assert.ok(!html.includes('Confirm the move</a>'));
  assertNoJargon(html, 'programme-preview');
});

test('intake screen shows the on-file programme honestly', () => {
  const html = renderProgrammeIntake(healthyProgrammeLoaded, {
    programmeHref: '/programme',
    importHref: '/programme/import',
    sources: [{ label: 'roster.xlsx', note: '45 rows · 12 Sep' }],
    timeline: sampleTimeline,
  });
  assert.ok(html.includes('Programme intake'));
  assert.ok(html.includes('class="intake-grid"'));
  assert.ok(html.includes('class="dropzone"'));
  assert.ok(html.includes('On file — Atlas Innovation Summit 2026'));
  assert.ok(html.includes('3 commitments across 1 day'));
  assert.ok(html.includes('45 people'));
  assert.ok(html.includes('Travel arranged by us'));
  assert.ok(html.includes('roster.xlsx'));
  // Upload / manual entry are inert until the integrator wires them.
  assert.ok(!html.includes('onsubmit='));
  assert.ok(!html.includes('fetch('));
  const loading = renderProgrammeIntake(programmeLoading);
  assert.ok(loading.includes('data-ui-state="loading"'));
  assertNoJargon(html, 'programme-intake');
});

test('augmentation content is HTML-escaped like any other data', () => {
  const hostile = renderProgrammeBody(healthyProgramme, {
    roleFor: () => '<script>alert(1)</script>',
    arrivalFor: () => '30 Sep, 09:15',
    timeline: [
      { dateLabel: 'Wed 1 Oct', items: [{ key: 'x', timeLabel: '09:00', title: '<b>hostile</b>', tone: 'ok' as const }] },
    ],
  });
  assert.ok(!hostile.includes('<script>alert(1)</script>'));
  assert.ok(!hostile.includes('<b>hostile</b>'));
  assert.ok(hostile.includes('&lt;script&gt;'));
  assert.ok(hostile.includes('&lt;b&gt;hostile&lt;/b&gt;'));
});
