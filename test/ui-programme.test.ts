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
  STATUS_PRIORITY,
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
  assert.ok(html.includes('data-summary-key="total"'));
  assert.ok(html.includes('data-summary-key="ready"'));
  assert.ok(html.includes('data-summary-key="needsTravellerInfo"'));
  assert.ok(html.includes('Add one traveller'));
  assert.ok(html.includes('Bulk import travellers'));
  assert.ok(html.includes('href="/programme/intake"'));
  assert.ok(html.includes('href="/programme/import"'));
  assertNoJargon(html, 'programme-loaded');
});

test('45-traveller scale renders every row with no truncation', () => {
  const html = renderProgrammeBody(healthyProgramme);
  const rowCount = (html.match(/<tr data-trip-id=/g) ?? []).length;
  assert.equal(rowCount, 45, 'every traveller row must be rendered');
  // The summary total tile must match the dataset size, and the table
  // tbody must include all 45 traveller ids, not just a sample.
  assert.ok(html.includes('data-summary-key="total"'));
  assert.ok(html.includes('<div class="tile-count">45</div>'));
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

test('programme links only active cases and keeps operator context', () => {
  const html = renderProgrammeBody(healthyProgramme);
  for (const traveller of healthyProgramme.travellers) {
    const caseId = traveller.activeCaseIds[0];
    if (caseId) assert.ok(html.includes(`href="/operator/cases/${caseId}"`));
  }
  assert.ok(!html.includes('href="/traveller?trip='));
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
  assert.ok(html.includes('href="/programme/intake"'));
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

test('intake affordances are link-only and labelled honestly', () => {
  const html = renderProgrammeBody(healthyProgramme);
  assert.ok(html.includes('href="/programme/intake"'));
  assert.ok(html.includes('href="/programme/import"'));
  assert.ok(html.includes('Add one traveller'));
  assert.ok(html.includes('Bulk import travellers'));
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
