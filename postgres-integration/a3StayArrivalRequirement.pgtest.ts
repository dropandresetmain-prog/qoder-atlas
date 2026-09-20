/** A3 proof: the organiser's stay-arrival policy is a real Journey constraint. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildAitFixtureDatabase, cloneAitFixtureDatabase, type AitCloneHandle, type AitFixtureHandle, AIT_FIXTURE_NOW } from './aitFixtureClone.ts';
import { captureWorld } from '../src/persistence/postgres/world/pgCurrentState.ts';
import { assessSubject } from '../src/resolution/evaluation/assess.ts';
import { createM6Registry } from '../src/resolution/evaluation/registry.ts';
import { projectEffectiveWorld } from '../src/resolution/world/effectiveItinerary.ts';

test('Jordan stay-arrival source policy is PASS at baseline and FAILS after arrival date changes', async () => {
  let fixture: AitFixtureHandle | undefined;
  let clone: AitCloneHandle | undefined;
  try {
    fixture = await buildAitFixtureDatabase({ runBaseline: true });
    clone = await cloneAitFixtureDatabase(fixture.databaseName);
    const { pool, workspaceId } = clone;
    const registry = createM6Registry();
    const journeyRow = await pool.query<{ journey_id: string }>(
      `SELECT j.id AS journey_id
         FROM journeys j
         JOIN travellers t ON t.workspace_id = j.workspace_id AND t.id = j.traveller_id
         JOIN external_record_links l ON l.workspace_id = t.workspace_id
          AND l.canonical_subject_kind = 'TRAVELLER' AND l.canonical_subject_id = t.id AND l.superseded_at IS NULL
         JOIN external_records r ON r.workspace_id = l.workspace_id AND r.id = l.external_record_id
        WHERE j.workspace_id = $1 AND r.record_type = 'SOURCE_TRAVELLER_DRAFT' AND r.external_id = 'ait-draft-09'`,
      [workspaceId],
    );
    assert.equal(journeyRow.rowCount, 1);
    const journeyId = journeyRow.rows[0]!.journey_id;
    const world = await captureWorld(pool, { workspaceId, focus: [{ kind: 'JOURNEY', id: journeyId }], at: AIT_FIXTURE_NOW, informationTopics: registry.informationTopics });
    const constraint = world.constraints.find((candidate) => candidate.registeredType === 'stay_arrival_date_aligned' && candidate.owner.kind === 'JOURNEY' && candidate.owner.id === journeyId);
    assert.ok(constraint, 'materialized source policy is owned by Jordan Journey');
    const operand = (key: string) => constraint.operands.find((candidate) => candidate.key === key)?.subject?.id;
    const originalStayId = operand('original_stay_item');
    const arrivalItemId = operand('arrival_item');
    assert.ok(originalStayId);
    assert.ok(arrivalItemId);
    const arrivalItem = world.journeyItems.find((item) => item.id === arrivalItemId);
    assert.ok(arrivalItem?.selectedServiceId);
    assert.equal(world.journeyItems.find((item) => item.id === originalStayId)?.kind, 'STAY');
    assert.equal(arrivalItem?.kind, 'TRANSPORT');

    const evaluate = (candidate: typeof world) => assessSubject({
      registry,
      world: candidate,
      effective: projectEffectiveWorld(candidate),
      subject: { kind: 'JOURNEY', id: journeyId },
      now: AIT_FIXTURE_NOW,
      assessmentId: randomUUID(),
    }).result.dimensions.find((dimension) => dimension.dimension === 'stay_arrival_date_aligned');
    assert.equal(evaluate(world)?.verdict, 'PASS', 'original booked stay starts on the selected arrival local date');

    const changed = structuredClone(world);
    const service = changed.transportServices.find((candidate) => candidate.id === arrivalItem.selectedServiceId);
    assert.ok(service?.published.arrival);
    service.published.arrival = { ...service.published.arrival, value: '2026-10-01T15:00:00.000Z' };
    assert.equal(evaluate(changed)?.verdict, 'FAIL', 'a changed arrival local date requires a replacement stay');
  } finally {
    await clone?.drop().catch(() => undefined);
    await fixture?.drop().catch(() => undefined);
  }
});
