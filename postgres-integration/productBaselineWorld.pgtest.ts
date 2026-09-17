/**
 * First product-integration increment — focused proof that the canonical
 * programme runtime bundle becomes real normalized PostgreSQL state, gets a
 * genuine baseline assessment, and survives re-provisioning and restart.
 *
 * This test file is fixture-aware on purpose: it is the acceptance evidence
 * for one specific canonical bundle. Everything it asserts about the bundle is
 * READ from the bundle, never written into the expectation — the population
 * count, the hero draft ids and the rule ids all come from the loaded dataset,
 * so a bundle change moves the evidence instead of breaking the claim.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Pool } from '../src/persistence/postgres/pool.ts';
import { sharedTestPool } from './harness.ts';
import { loadDataset, type LoadedDataset } from '../src/app/demo/datasetLoader.ts';
import {
  provisionConfiguredDataset,
  provisionDataset,
  DatasetContentConflictError,
  datasetProvisioningIdentity,
} from '../src/app/demo/provisionDataset.ts';
import { composeTargetApplication, type TargetApplication } from '../src/app/target/composeTargetApplication.ts';
import { handleTargetProductHttp } from '../src/app/target/targetHttpHandlers.ts';
import { runBaselineEvaluation } from '../src/app/demo/baselineEvaluation.ts';
import { resolveSourceSubjects, SOURCE_RECORD_TYPES } from '../src/app/demo/externalIdentity.ts';
import { loadOperatorOverviewFacts } from '../src/app/target/readmodels/pgFactAssembler.ts';
import { projectOperatorOverview } from '../src/app/target/readmodels/index.ts';

const BUNDLE_DIR = fileURLToPath(new URL('../fixtures/programmes/ait-summit-2026/', import.meta.url));
const ACTOR = 'principal:product-baseline-test';

let pool: Pool;
let dataset: LoadedDataset;

before(async () => {
  pool = await sharedTestPool();
  dataset = await loadDataset(BUNDLE_DIR);
});

after(async () => {
  await pool.end();
});

async function freshWorkspace(): Promise<string> {
  const workspaceId = randomUUID();
  await pool.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [workspaceId, `baseline:${workspaceId}`]);
  return workspaceId;
}

/**
 * Drive the real HTTP handler with the minimum request/response surface it
 * uses, so these assertions exercise the production route rather than a
 * re-implementation of it.
 */
async function callHandler(
  app: TargetApplication,
  method: 'GET' | 'POST',
  path: string,
): Promise<{ status: number; body: string }> {
  let status = 0;
  const chunks: string[] = [];
  const res = {
    writeHead(code: number) {
      status = code;
      return res;
    },
    end(payload?: string) {
      if (payload) chunks.push(payload);
    },
  };
  const req = {
    method,
    url: path,
    [Symbol.asyncIterator]: async function* () {
      // No request body in these reads.
    },
  };
  const handled = await handleTargetProductHttp(
    { app },
    req as unknown as Parameters<typeof handleTargetProductHttp>[1],
    res as unknown as Parameters<typeof handleTargetProductHttp>[2],
    new URL(path, 'http://localhost'),
  );
  assert.ok(handled, `${method} ${path} was handled`);
  return { status, body: chunks.join('') };
}

const getHtml = (app: TargetApplication, path: string) => callHandler(app, 'GET', path);
const post = (app: TargetApplication, path: string) => callHandler(app, 'POST', path);

async function count(workspaceId: string, table: string): Promise<number> {
  const result = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE workspace_id = $1`, [
    workspaceId,
  ]);
  return Number(result.rows[0]!.n);
}

// ---------------------------------------------------------------------------
// One provisioned world, shared by the assertions below. Materializing the
// full bundle is the expensive part; re-doing it per assertion would prove
// nothing extra.
// ---------------------------------------------------------------------------
let world: { workspaceId: string; report: Awaited<ReturnType<typeof provisionDataset>> };

test('canonical runtime bundle materializes into a fresh PostgreSQL workspace', async () => {
  const workspaceId = await freshWorkspace();
  const outcome = await provisionDataset({ pool, workspaceId, actorPrincipalId: ACTOR, dataset });
  world = { workspaceId, report: outcome };

  assert.equal(outcome.status, 'MATERIALIZED');
  if (outcome.status !== 'MATERIALIZED') return;

  // Expected population comes from the bundle, not from a number typed here.
  const expectedTravellers = dataset.programme.importDraft.travellers.length;
  const expectedCommitments = dataset.programme.context.anchorEvent.commitments.length;
  const expectedPlaces = dataset.programme.context.places.length;

  assert.equal(await count(workspaceId, 'travellers'), expectedTravellers, 'one traveller per roster entry');
  assert.equal(await count(workspaceId, 'trips'), expectedTravellers, 'one trip per traveller');
  assert.equal(await count(workspaceId, 'journeys'), expectedTravellers, 'one journey per traveller');
  assert.equal(await count(workspaceId, 'programme_items'), expectedCommitments);
  assert.equal(await count(workspaceId, 'places'), expectedPlaces);
  assert.equal(await count(workspaceId, 'events'), 1);
  assert.equal(await count(workspaceId, 'programmes'), 1);
  assert.equal(await count(workspaceId, 'organisations'), 1);

  console.log(`[evidence] materialized counts ${JSON.stringify(outcome.report.counts)}`);
  console.log(`[evidence] not materialized:\n  - ${outcome.report.notMaterialized.join('\n  - ')}`);
});

test('Programme / Traveller / Trip / Journey relationships are valid', async () => {
  const { workspaceId } = world;

  const orphanJourneys = await pool.query(
    `SELECT j.id FROM journeys j
      LEFT JOIN trips t ON t.workspace_id = j.workspace_id AND t.id = j.trip_id
      LEFT JOIN travellers tr ON tr.workspace_id = j.workspace_id AND tr.id = j.traveller_id
      WHERE j.workspace_id = $1 AND (t.id IS NULL OR tr.id IS NULL)`,
    [workspaceId],
  );
  assert.equal(orphanJourneys.rowCount, 0, 'every journey resolves its trip and traveller');

  const orphanParticipations = await pool.query(
    `SELECT p.id FROM participations p
      LEFT JOIN programme_items i ON i.workspace_id = p.workspace_id AND i.id = p.programme_item_id
      WHERE p.workspace_id = $1 AND i.id IS NULL`,
    [workspaceId],
  );
  assert.equal(orphanParticipations.rowCount, 0, 'every participation resolves its programme item');

  const oneProgramme = await pool.query<{ programme_id: string }>(
    `SELECT DISTINCT programme_id FROM programme_items WHERE workspace_id = $1`,
    [workspaceId],
  );
  assert.equal(oneProgramme.rowCount, 1, 'all programme items belong to the one active programme');
});

test('supplied travel, booking and stay objects survive normalization', async () => {
  const { workspaceId } = world;
  const travellers = dataset.programme.importDraft.travellers;
  const expectedLegs = new Set(
    travellers.flatMap((t) =>
      t.declaredTravel
        .filter((item) => item.itemKind === 'TRANSPORT_LEG')
        .map((item) => ('carrierRef' in item ? JSON.stringify(item.carrierRef) + item.scheduledDeparture : '')),
    ),
  );
  const expectedStays = travellers.flatMap((t) => t.declaredTravel.filter((item) => item.itemKind === 'STAY')).length;
  const expectedTransportItems = travellers.flatMap((t) =>
    t.declaredTravel.filter((item) => item.itemKind === 'TRANSPORT_LEG'),
  ).length;

  assert.equal(
    await count(workspaceId, 'transport_services'),
    expectedLegs.size,
    'one transport service per distinct published service, shared across travellers',
  );
  assert.equal(
    await count(workspaceId, 'transport_item_details'),
    expectedTransportItems,
    'one transport journey item per declared leg',
  );
  assert.equal(await count(workspaceId, 'stay_item_details'), expectedStays, 'one stay journey item per declared stay');

  assert.ok((await count(workspaceId, 'reservations')) > 0, 'reservations materialized');
  assert.ok((await count(workspaceId, 'reservation_lines')) > 0, 'reservation lines materialized');
  assert.ok((await count(workspaceId, 'reservation_allocations')) > 0, 'traveller allocations materialized');

  // Provider booking identity is bound through external records, not names.
  const bookingRefs = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM external_records
      WHERE workspace_id = $1 AND record_type = $2 AND identity_state = 'LINKED'`,
    [workspaceId, SOURCE_RECORD_TYPES.RESERVATION],
  );
  assert.ok(Number(bookingRefs.rows[0]!.n) > 0, 'booking references are bound as linked external records');
});

test('organiser rules and the constraints they state survive', async () => {
  const { workspaceId } = world;
  const expectedRuleSets = dataset.programme.context.ruleSets.length;
  const expectedRules = dataset.programme.context.ruleSets.flatMap((rs) => rs.rules).length;

  assert.equal(await count(workspaceId, 'rule_sets'), expectedRuleSets);
  assert.equal(await count(workspaceId, 'rules'), expectedRules);
  assert.ok((await count(workspaceId, 'rule_assignments')) > 0, 'rule sets are assigned to the organisation');

  const constraints = await pool.query<{ registered_type: string; n: string }>(
    `SELECT registered_type, count(*)::text AS n FROM constraint_definitions
      WHERE workspace_id = $1 GROUP BY registered_type ORDER BY registered_type`,
    [workspaceId],
  );
  const byType = new Map(constraints.rows.map((row) => [row.registered_type, Number(row.n)]));
  console.log(`[evidence] constraints ${JSON.stringify([...byType])}`);
  assert.ok(
    (byType.get('programme_arrival_readiness_minutes') ?? 0) > 0,
    'programme arrival readiness minutes came from organiser policy, not from code',
  );
  assert.ok((byType.get('minimum_connection_minutes') ?? 0) > 0, 'connection minimum came from organiser policy');
  assert.ok((byType.get('transfer_minutes') ?? 0) > 0, 'ground transfer durations are registered transfer constraints');
});

test('hero baselines are resolvable from source identity, not from display names', async () => {
  const { workspaceId } = world;
  const travellers = dataset.programme.importDraft.travellers;

  // "Hero" here is a property of the DATA, discovered from the bundle: the
  // traveller with the most transport legs (a multi-leg connection journey),
  // and a traveller who shares an inbound service with someone else and holds
  // a REQUIRED programme commitment. Neither is named in this test.
  const legCount = (draftId: string): number =>
    travellers.find((t) => t.draftId === draftId)!.declaredTravel.filter((i) => i.itemKind === 'TRANSPORT_LEG').length;
  const multiLeg = [...travellers].sort((a, b) => legCount(b.draftId) - legCount(a.draftId))[0]!;
  assert.ok(legCount(multiLeg.draftId) >= 2, 'the bundle contains a multi-leg connection journey');

  const requiredCommitted = travellers.filter((t) =>
    t.engagementImportance.some((e) => e.importance === 'REQUIRED'),
  );
  assert.ok(requiredCommitted.length > 0, 'the bundle contains REQUIRED programme commitments');

  // Resolution goes through the live external identity mapping — the same
  // read any later slice would use, not a UUID remembered from the write.
  assert.equal(world.report.status, 'MATERIALIZED');
  if (world.report.status !== 'MATERIALIZED') return;
  const mapping = await resolveSourceSubjects(pool, workspaceId, world.report.report.connectionId);

  for (const traveller of [multiLeg, requiredCommitted[0]!]) {
    const resolved = mapping.get(`${SOURCE_RECORD_TYPES.TRAVELLER}:${traveller.draftId}`);
    assert.ok(resolved, `traveller draft ${traveller.draftId} resolves through external identity`);
    assert.equal(resolved.subject.kind, 'TRAVELLER');
    const travellerId = resolved.subject.id;

    const journey = await pool.query<{ id: string; item_count: string }>(
      `SELECT j.id, count(i.id)::text AS item_count
         FROM journeys j LEFT JOIN journey_items i ON i.workspace_id = j.workspace_id AND i.journey_id = j.id
        WHERE j.workspace_id = $1 AND j.traveller_id = $2
        GROUP BY j.id`,
      [workspaceId, travellerId],
    );
    assert.equal(journey.rowCount, 1, 'exactly one journey for this traveller');
    assert.ok(Number(journey.rows[0]!.item_count) > 0, 'the journey carries the travel the bundle declared');
  }

  // The multi-leg hero's connection is governed by a real constraint.
  const connection = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM constraint_definitions
      WHERE workspace_id = $1 AND registered_type = 'minimum_connection_minutes'`,
    [workspaceId],
  );
  assert.ok(Number(connection.rows[0]!.n) > 0);

  // A shared inbound service: at least one transport service is allocated to
  // more than one traveller, which is what makes a shared-disruption baseline
  // possible later without reseeding.
  const shared = await pool.query<{ service_id: string; travellers: string }>(
    `SELECT d.transport_service_id AS service_id, count(DISTINCT a.traveller_id)::text AS travellers
       FROM transport_line_details d
       JOIN reservation_allocations a
         ON a.workspace_id = d.workspace_id AND a.line_id = d.line_id
      WHERE d.workspace_id = $1
      GROUP BY d.transport_service_id
     HAVING count(DISTINCT a.traveller_id) > 1
      ORDER BY count(DISTINCT a.traveller_id) DESC
      LIMIT 3`,
    [workspaceId],
  );
  console.log(
    `[evidence] shared services ${JSON.stringify(shared.rows.map((r) => Number(r.travellers)))}`,
  );
  assert.ok(shared.rowCount! > 0, 'a booked service is shared by more than one traveller');
});

test('baseline evaluation is honest: real verdicts, mixed population, no fabricated pass', async () => {
  const { workspaceId } = world;
  const first = await runBaselineEvaluation({ pool, workspaceId, actorPrincipalId: ACTOR });
  console.log(`[evidence] baseline verdicts ${JSON.stringify(first.verdicts)} over ${first.evaluated} journeys`);

  assert.equal(first.evaluated, dataset.programme.importDraft.travellers.length, 'every journey was assessed');
  const verdicts = Object.keys(first.verdicts);
  assert.ok(verdicts.length > 0);
  assert.ok(
    verdicts.some((v) => v !== 'PASS'),
    'not every journey is green — incomplete evidence stays UNKNOWN',
  );

  // Dimensions are persisted, so the read model can explain a verdict.
  const dimensions = await pool.query<{ dimension: string; verdict: string; n: string }>(
    `SELECT dimension, verdict, count(*)::text AS n FROM assessment_results
      WHERE workspace_id = $1 GROUP BY dimension, verdict ORDER BY dimension, verdict`,
    [workspaceId],
  );
  assert.ok(dimensions.rowCount! > 0, 'dimension detail is persisted');
  console.log(
    `[evidence] dimensions ${JSON.stringify(dimensions.rows.map((r) => `${r.dimension}:${r.verdict}=${r.n}`))}`,
  );

  // Re-running does not re-assess an already-assessed world.
  const second = await runBaselineEvaluation({ pool, workspaceId, actorPrincipalId: ACTOR });
  assert.equal(second.evaluated, 0, 'baseline evaluation is restart-safe');
});

test('operator overview shows the population before any RecoveryCase exists', async () => {
  const { workspaceId } = world;
  assert.equal(await count(workspaceId, 'recovery_cases'), 0, 'no case exists in the baseline world');

  const facts = await loadOperatorOverviewFacts(pool, workspaceId);
  const view = projectOperatorOverview(facts);

  assert.equal(view.items.length, 0, 'no case-driven rows, because no case exists');
  assert.ok(view.population.length > 0, 'the in-scope population is visible without inventing a case');
  assert.equal(
    view.populationSummary.total,
    dataset.programme.importDraft.travellers.length,
    'the summary counts the real population',
  );
  assert.ok(view.eventContext, 'event context is present for the shell');
  console.log(
    `[evidence] overview population=${view.population.length} summary=${JSON.stringify(view.populationSummary)}`,
  );

  // The frontend receives authoritative statuses; it computes none of them.
  // A subject with no current assessment reads UNKNOWN, never READY.
  for (const entry of view.population) {
    if (entry.evaluation !== 'CURRENT') {
      assert.equal(entry.status, 'UNKNOWN', 'a non-current assessment is never presented as ready');
    }
  }
});

test('re-provisioning the same dataset is idempotent and does not duplicate the world', async () => {
  const { workspaceId } = world;
  const tables = [
    'travellers',
    'trips',
    'journeys',
    'journey_items',
    'programme_items',
    'participations',
    'events',
    'programmes',
    'organisations',
    'places',
    'reservations',
    'reservation_lines',
    'reservation_allocations',
    'transport_services',
  ];
  const before = new Map<string, number>();
  for (const table of tables) before.set(table, await count(workspaceId, table));

  const again = await provisionDataset({ pool, workspaceId, actorPrincipalId: ACTOR, dataset });
  assert.equal(again.status, 'ALREADY_PROVISIONED');

  for (const table of tables) {
    assert.equal(await count(workspaceId, table), before.get(table), `${table} was not duplicated`);
  }

  const marker = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM source_records WHERE workspace_id = $1 AND source_identity = $2`,
    [workspaceId, datasetProvisioningIdentity(dataset.datasetKey)],
  );
  assert.equal(Number(marker.rows[0]!.n), 1, 'exactly one provisioning marker');
});

test('the same dataset identity with different content fails visibly', async () => {
  const { workspaceId } = world;
  await assert.rejects(
    () =>
      provisionDataset({
        pool,
        workspaceId,
        actorPrincipalId: ACTOR,
        dataset: { ...dataset, contentHash: 'f'.repeat(64) },
      }),
    (error: unknown) => error instanceof DatasetContentConflictError,
    'conflicting content is refused rather than layered on top',
  );
});

test('the operator shell serves Overview / Programme / Decisions / Activity, read-only', async () => {
  const { workspaceId } = world;
  const app = await composeTargetApplication({ workspaceId });
  try {
    const changesBefore = await count(workspaceId, 'change_records');
    const assessmentsBefore = await count(workspaceId, 'assessments');

    const surfaces = [
      { path: '/api/v2/operator/overview', marker: 'data-test="product-operator-overview"' },
      { path: '/api/v2/operator/programme', marker: 'data-test="product-programme-schedule"' },
      { path: '/api/v2/operator/decisions', marker: 'data-test="product-decision-queue"' },
      { path: '/api/v2/operator/activity', marker: 'data-test="product-activity-feed"' },
    ];

    for (const surface of surfaces) {
      // Two identical GETs: the second is the browser refresh.
      for (const attempt of [1, 2]) {
        const response = await getHtml(app, `${surface.path}?format=html`);
        assert.equal(response.status, 200, `${surface.path} attempt ${attempt}`);
        assert.ok(response.body.includes(surface.marker), `${surface.path} rendered its surface`);
        // The accepted shell chrome, not a second one.
        assert.ok(response.body.includes('data-surface="operator"'), `${surface.path} rendered inside the shell`);
        assert.ok(response.body.includes('Northstar'), `${surface.path} carries the brand`);
        for (const link of ['href="/"', 'href="/programme"', 'href="/decisions"', 'href="/activity"']) {
          assert.ok(response.body.includes(link), `${surface.path} nav has ${link}`);
        }
      }
    }

    // The event context reaches the chrome, and the population reaches the page.
    const overview = await getHtml(app, '/api/v2/operator/overview?format=html');
    assert.ok(overview.body.includes('class="event-select"'), 'the shell shows the event it is working');
    assert.ok(overview.body.includes('data-test="product-population-queue"'), 'the population is visible');
    assert.ok(overview.body.includes('data-test="event-context"'));

    // Reads mutate nothing.
    assert.equal(await count(workspaceId, 'change_records'), changesBefore, 'refresh wrote no change records');
    assert.equal(await count(workspaceId, 'assessments'), assessmentsBefore, 'refresh created no assessments');
  } finally {
    await app.close();
  }
});

test('demo reset refuses to layer a second world onto a provisioned dataset', async () => {
  const { workspaceId } = world;
  const app = await composeTargetApplication({ workspaceId });
  const previousDir = process.env.NORTHSTAR_DEMO_DATASET_DIR;
  process.env.NORTHSTAR_DEMO_DATASET_DIR = BUNDLE_DIR;
  try {
    const travellersBefore = await count(workspaceId, 'travellers');
    const response = await post(app, '/api/v2/demo/reset');
    assert.equal(response.status, 409);
    assert.match(response.body, /DEMO_DATASET_PROVISIONED/);
    assert.equal(await count(workspaceId, 'travellers'), travellersBefore, 'no second world was seeded');
  } finally {
    if (previousDir === undefined) delete process.env.NORTHSTAR_DEMO_DATASET_DIR;
    else process.env.NORTHSTAR_DEMO_DATASET_DIR = previousDir;
    await app.close();
  }
});

test('restarting the boot sequence against the same database preserves the same world', async () => {
  const { workspaceId } = world;
  const tables = ['travellers', 'trips', 'journeys', 'journey_items', 'programme_items', 'events', 'programmes', 'assessments'];
  const before = new Map<string, number>();
  for (const table of tables) before.set(table, await count(workspaceId, table));

  // Exactly what boot does, with nothing reset in between.
  const outcome = await provisionConfiguredDataset({
    pool,
    workspaceId,
    actorPrincipalId: ACTOR,
    env: { NORTHSTAR_DEMO_DATASET_DIR: BUNDLE_DIR } as NodeJS.ProcessEnv,
  });
  assert.equal(outcome.status, 'ALREADY_PROVISIONED');
  const baseline = await runBaselineEvaluation({ pool, workspaceId, actorPrincipalId: ACTOR });
  assert.equal(baseline.evaluated, 0, 'restart re-assessed nothing');

  for (const table of tables) {
    assert.equal(await count(workspaceId, table), before.get(table), `${table} survived the restart unchanged`);
  }

  // And the surface still shows the same world.
  const facts = await loadOperatorOverviewFacts(pool, workspaceId);
  const view = projectOperatorOverview(facts);
  assert.equal(view.populationSummary.total, dataset.programme.importDraft.travellers.length);
});

test('boot does nothing when no demo dataset is configured', async () => {
  const workspaceId = await freshWorkspace();
  const outcome = await provisionConfiguredDataset({
    pool,
    workspaceId,
    actorPrincipalId: ACTOR,
    env: {} as NodeJS.ProcessEnv,
  });
  assert.equal(outcome.status, 'NOT_CONFIGURED');
  assert.equal(await count(workspaceId, 'travellers'), 0);
});

test('a repeated provisioning interrupted mid-way completes the same world, not a second one', async () => {
  // Deterministic ids + command idempotency keys mean the second attempt
  // replays committed commands and executes only what never ran. Proven by
  // materializing the bundle into a workspace twice in a row through the
  // materializer directly (bypassing the marker), then asserting identity.
  const workspaceId = await freshWorkspace();
  const first = await provisionDataset({ pool, workspaceId, actorPrincipalId: ACTOR, dataset });
  assert.equal(first.status, 'MATERIALIZED');
  const { materializeDataset } = await import('../src/app/demo/materializeDataset.ts');
  const before = await count(workspaceId, 'journeys');
  const replay = await materializeDataset({ pool, workspaceId, actorPrincipalId: ACTOR, dataset });
  assert.equal(await count(workspaceId, 'journeys'), before, 'replay created no second journey population');
  if (first.status === 'MATERIALIZED') {
    assert.equal(replay.eventId, first.report.eventId, 'the event kept its identity across the replay');
    assert.equal(replay.programmeId, first.report.programmeId, 'the programme kept its identity');
  }
});
