/**
 * R4 / G09 — stored EXPLICIT/INFERRED preferences reach the planning comparator
 * on real PostgreSQL. Two viable candidates (the real programme time-swap and an
 * identical-effect twin under another proposer id) are indistinguishable to the
 * deterministic facts, so ONLY preferences can order them. In each world the
 * EXPLICIT preference favours one candidate and an INFERRED one favours the
 * other; the EXPLICIT one must win in both, and the use is visible in the
 * persisted planning evidence. Generic world; no traveller/scenario is keyed.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sharedTestPool } from './harness.ts';
import { openDisruptionCase, type OpenCase } from './r1ProgrammeWorld.ts';
import { createRecoveryPlanningCoordinator, defaultDomainProposers } from '../src/app/target/recoveryPlanningCoordinator.ts';
import { createProgrammeTimeSwapProposer } from '../src/resolution/planning/proposers/programmeTimeSwapProposer.ts';
import { PgUnitOfWork } from '../src/persistence/postgres/pgUnitOfWork.ts';
import { recordEvidence, recordPreference, recordSource } from '../src/persistence/postgres/commands/knowledgeCommands.ts';
import { PLANNING_PREFERENCE_SCHEMA_VERSION } from '../src/app/target/planningPreferences.ts';

after(async () => { await (await sharedTestPool()).end(); });

const TWIN_ID = 'proposer.twin-of-programme-swap';
const REAL_ID = 'proposer.programme-time-swap';
const twin = () => { const real = createProgrammeTimeSwapProposer(); return { id: TWIN_ID, version: real.version, async propose(input: Parameters<typeof real.propose>[0]) { return (await real.propose(input)).map((cand) => ({ ...cand, key: `twin:${cand.key}` })); } }; };

function mustOk<T>(o: { ok: true; value: T } | { ok: false; conflict: { kind: string; message: string } }): T {
  if (!o.ok) throw new Error(`${o.conflict.kind}: ${o.conflict.message}`);
  return o.value;
}

async function seedPreference(c: OpenCase, ownerId: string, source: 'EXPLICIT' | 'INFERRED', preferenceKind: string, value: unknown): Promise<void> {
  const uow = new PgUnitOfWork(c.pool, c.world.workspaceId);
  const ctx = () => ({ workspaceId: c.world.workspaceId, actorPrincipalId: c.world.actorId, idempotencyKey: `r4-pref:${randomUUID()}` });
  const sourceId = randomUUID();
  mustOk(await recordSource(uow, { ...ctx(), sourceId, sourceIdentity: `r4-pref:${sourceId}`, receivedAt: '2031-01-01T00:00:00.000Z', contentHash: 'c'.repeat(64), contentType: 'application/json', protectedLocationRef: `vault://r4/${sourceId}`, rawContentHash: 'd'.repeat(64), rawAccessPolicyId: `policy:${c.world.workspaceId}`, captureMetadata: { capture: 'r4-fixture' }, captureMetadataVersion: 'r4/1' } as never));
  const evidenceId = randomUUID();
  mustOk(await recordEvidence(uow, { ...ctx(), evidenceId, assertionType: 'R4_PREFERENCE_STATEMENT', observedAt: '2031-01-01T00:00:00.000Z', issuedAt: '2031-01-01T00:00:00.000Z', schemaVersion: 'r4/1', sourceIds: [sourceId], subjectRefs: [{ kind: 'TRAVELLER', id: ownerId }], interpretationProvenance: 'deterministic integration fixture' } as never));
  mustOk(await recordPreference(uow, { ...ctx(), ownerRef: { kind: 'TRAVELLER', id: ownerId }, preferenceKind, source, value, valueSchemaVersion: PLANNING_PREFERENCE_SCHEMA_VERSION, effectiveWindow: { start: '2031-01-01T00:00:00.000Z', end: '2032-01-01T00:00:00.000Z' }, evidenceId }));
}

async function planWith(favouredExplicit: string, favouredInferred: string) {
  const c = await openDisruptionCase(`r4 prefs ${favouredExplicit}`);
  const traveller = c.world.people[0]!.travellerId;
  await seedPreference(c, traveller, 'EXPLICIT', 'candidate_source', { key: 'explicit_pick', summary: 'declared: prefer this proposer', match: { proposerIds: [favouredExplicit] } });
  await seedPreference(c, traveller, 'INFERRED', 'candidate_source_inferred', { key: 'inferred_pick', summary: 'guessed: prefer the other proposer', match: { proposerIds: [favouredInferred] } });
  const planner = createRecoveryPlanningCoordinator({
    pool: c.pool, workspaceId: c.world.workspaceId, actorPrincipalId: c.world.actorId, uow: () => c.app.unitOfWork(), now: c.now,
    proposers: [...defaultDomainProposers(), { domain: 'PROGRAMME', proposer: twin() }],
  });
  const out = await planner.planCaseDetailed({ recoveryCaseId: c.caseId as never, reason: 'CASE_OPENED' });
  assert.ok(out.ok, JSON.stringify(out));
  const attempt = (await c.pool.query<{ material_candidates: { proposerId: string; strategyRef?: string; disposition: string }[] }>(
    'SELECT material_candidates FROM recovery_planning_attempts WHERE workspace_id = $1', [c.world.workspaceId])).rows[0]!;
  const recommended = attempt.material_candidates.find((m) => m.strategyRef === out.result.recommendation?.recommendedStrategyRef);
  return { c, out, recommended };
}

describe('R4 G09 planning preferences (real PostgreSQL)', () => {
  test('EXPLICIT outranks INFERRED in both directions and the use is in persisted evidence', async () => {
    for (const [explicit, inferred] of [[REAL_ID, TWIN_ID], [TWIN_ID, REAL_ID]] as const) {
      const { c, out, recommended } = await planWith(explicit, inferred);
      try {
        assert.ok(out.ok);
        assert.equal(out.result.viableStrategyRefs.length, 2, 'both viable candidates are retained');
        assert.equal(recommended?.proposerId, explicit, 'the explicit preference decides the recommendation');
        const basis = out.result.recommendation!.recommendationBasis;
        assert.ok(basis.some((b) => b.code === 'explicit_pick' && b.kind === 'EXPLICIT_PREFERENCE'), JSON.stringify(basis));
        assert.ok(!basis.some((b) => b.code === 'inferred_pick'), 'the inference of the losing candidate is not the basis');
      } finally { await c.app.close(); }
    }
  });
});
