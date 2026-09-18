/**
 * B1 Product Acceptance Repair — the product boundary Founder B1 stopped at.
 *
 * The 2026-09-18 physical session completed the engine loop correctly in the
 * background and still withheld acceptance, because the recovery surface was
 * not operable: Overview rows were not navigation, the focused case rendered
 * outside the product shell, `/operator` 404'd on the normal PostgreSQL
 * runtime, and the options were a wall of "Traveller UNKNOWN" behind two
 * indistinguishable v1/v2 entries.
 *
 * These are the focused checks for that boundary. They need no database and
 * no browser: every assertion is over a projected read model, a rendered
 * fragment, or the target server's own route dispatch.
 *
 * Findings covered: FB1-2 (Overview -> case navigation), FB1-3 (product
 * shell), FB1-4 (`/operator` alias + clean case route), FB1-5 (candidate
 * summary projection), FB1-6 (distinguishable, readable options).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { caseHref, renderInShell, SHELL_LINKS } from '../src/app/target/productShell.ts';
import { loadPostgresTargetConfig } from '../src/persistence/postgres/config.ts';
import { adaptOperatorOverviewToDashboard } from '../src/app/target/adapters/operatorOverviewAdapter.ts';
import { renderProductRecoveryCase } from '../src/ui/screens/product-recovery-case.ts';
import { projectRecoveryCase } from '../src/app/target/readmodels/projectRecoveryCase.ts';
import { createTargetAppServer } from '../src/server/targetHttp.ts';
import type { TargetEndpoints } from '../src/app/target/composeTargetEndpoints.ts';
import type { OperatorOverview } from '../src/contracts/v2/product/readModels.ts';
import type { RecoveryCaseFacts } from '../src/app/target/readmodels/types.ts';

const CASE_REF = '419280db-eff2-5cbe-bbb8-0656348c7997';
const OTHER_CASE_REF = 'b7c1d2e3-0000-5aaa-9bbb-0656348c7000';
const GENERATED_AT = '2026-09-18T09:00:00.000Z';

const EARLY = { start: '2026-10-01T03:30:00.000Z', end: '2026-10-01T04:00:00.000Z' };
const LATER = { start: '2026-10-01T05:30:00.000Z', end: '2026-10-01T06:00:00.000Z' };
const LATEST = { start: '2026-10-01T06:30:00.000Z', end: '2026-10-01T07:00:00.000Z' };

/** An Overview with one case-backed disrupted row and one healthy row. */
function overviewView(): OperatorOverview {
  return {
    generatedAt: GENERATED_AT,
    items: [
      {
        tripRef: 'TRIP:trip-1',
        travellerLabel: 'Sarah Lim',
        status: 'DISRUPTED',
        remainderViability: 'NOT_VIABLE',
        caseRef: CASE_REF,
        whatChanged: 'Inbound service now arrives too late for the opening session.',
        affectedPeople: ['JOURNEY:journey-1'],
        affectedItems: ['JOURNEY:journey-1'],
        decisionRequired: true,
        unresolvedUncertainty: [],
      },
    ],
    summary: { ready: 0, atRisk: 0, disrupted: 1, recovering: 0, unknown: 0 },
    population: [
      {
        journeyRef: 'journey-1',
        tripRef: 'TRIP:trip-1',
        travellerLabel: 'Sarah Lim',
        obligation: 'REQUIRED',
        status: 'DISRUPTED',
        remainderViability: 'NOT_VIABLE',
        evaluation: 'CURRENT',
        caseRef: CASE_REF,
      },
      {
        journeyRef: 'journey-2',
        tripRef: 'TRIP:trip-2',
        travellerLabel: 'Ana Costa',
        obligation: 'REQUIRED',
        status: 'READY',
        remainderViability: 'VIABLE',
        evaluation: 'CURRENT',
      },
    ],
    populationSummary: { total: 2, ready: 1, atRisk: 0, disrupted: 1, recovering: 0 },
    ldg: { scope: 'EVENT_OVERVIEW', nodes: [], edges: [] },
    change: { changeCursor: '1', changedVisibleRefs: [] },
  } as unknown as OperatorOverview;
}

/**
 * Case facts carrying two genuinely different options. The deterministic
 * proposer emits one candidate per distinct programme swap pair, so both
 * options move the same blocked item — into two different slots. That
 * difference is the whole point of showing two.
 */
function caseFacts(): RecoveryCaseFacts {
  const projectedPeople = [
    { subjectRef: 'JOURNEY:journey-1', personLabel: 'Sarah Lim', verdict: 'PASS' as const },
    { subjectRef: 'JOURNEY:journey-2', personLabel: 'Ana Costa', verdict: 'PASS' as const },
    { subjectRef: 'JOURNEY:journey-3', personLabel: 'Mei Chen', verdict: 'UNKNOWN' as const },
  ];
  const resolves = [
    {
      subjectRef: 'JOURNEY:journey-1',
      personLabel: 'Sarah Lim',
      currentVerdict: 'FAIL' as const,
      projectedVerdict: 'PASS' as const,
    },
  ];
  const projectedSummary = { total: 3, pass: 2, fail: 0, unknown: 1 };
  return {
    generatedAt: GENERATED_AT,
    caseRef: CASE_REF,
    nodes: [],
    edges: [],
    projectionRevision: 1,
    changedVisibleRefs: [],
    changedEdgeIds: [],
    currentSemanticState: 'AFFECTED',
    status: 'AWAITING_AUTHORITY',
    changeSummary: 'Inbound service now arrives too late for the opening session.',
    bookingServiceState: { label: 'Replacement booking', state: 'AFFECTED' },
    tripViability: { label: 'Journey viability', verdict: 'FAIL' },
    affectedItems: ['JOURNEY:journey-1'],
    causalPath: [],
    strategies: [
      {
        strategyRef: 'a51540b2-59ee-574f-99a2-d99bc84fbf59',
        version: 1,
        viability: 'VIABLE',
        status: 'EVALUATED',
        optionNumber: 1,
        changes: [
          { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', subjectRef: 'PROGRAMME_ITEM:item-a', subjectLabel: 'Headline interview', currentWindow: EARLY, proposedWindow: LATER },
          { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', subjectRef: 'PROGRAMME_ITEM:item-b', subjectLabel: 'Partner briefing', currentWindow: LATER, proposedWindow: EARLY },
        ],
        resolves,
        projectedSummary,
        projectedPeople,
      },
      {
        strategyRef: '310f6fa3-2208-5f7a-bfb1-903a6d6f66f7',
        version: 2,
        viability: 'VIABLE',
        status: 'EVALUATED',
        optionNumber: 2,
        changes: [
          { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', subjectRef: 'PROGRAMME_ITEM:item-a', subjectLabel: 'Headline interview', currentWindow: EARLY, proposedWindow: LATEST },
          { effectKind: 'CHANGE_PROGRAMME_ITEM_TIME', subjectRef: 'PROGRAMME_ITEM:item-c', subjectLabel: 'Closing panel', currentWindow: LATEST, proposedWindow: EARLY },
        ],
        resolves,
        projectedSummary,
        projectedPeople,
      },
    ],
    authorityState: 'awaiting',
    executionState: 'idle',
    reconciliationState: 'idle',
    uncertainty: [],
    recoveryActions: [],
  } as unknown as RecoveryCaseFacts;
}

describe('B1 product acceptance — Overview navigation (FB1-2)', () => {
  test('a case-backed queue row is a link to the clean focused-case route', () => {
    const { itemsHtml } = adaptOperatorOverviewToDashboard(overviewView());
    assert.match(itemsHtml, /<a class="qrow" href="\/operator\/cases\/419280db-eff2-5cbe-bbb8-0656348c7997"/);
    assert.match(itemsHtml, /Sarah Lim/);
  });

  test('the link uses the read model caseRef verbatim — never a derived or invented id', () => {
    const view = overviewView();
    const { itemsHtml } = adaptOperatorOverviewToDashboard(view);
    assert.match(itemsHtml, new RegExp(`data-test-case-link="${view.items[0]!.caseRef}"`));
    // The case id never appears anywhere but inside the one route builder's output.
    assert.equal(itemsHtml.includes(caseHref(CASE_REF)), true);
  });

  test('a population row with a current case navigates; a healthy row fabricates nothing', () => {
    // Force the population branch: no open cases, so the queue shows the world.
    const view = { ...overviewView(), items: [] } as unknown as OperatorOverview;
    const { itemsHtml } = adaptOperatorOverviewToDashboard(view);
    assert.match(itemsHtml, /<a class="qrow" href="\/operator\/cases\/419280db-eff2-5cbe-bbb8-0656348c7997"[^>]*data-test="population-row"/);
    // Ana Costa has no case: her row stays a plain div with no href at all.
    const anaStart = itemsHtml.lastIndexOf('<', itemsHtml.indexOf('data-journey-ref="journey-2"'));
    const anaRow = itemsHtml.slice(anaStart);
    assert.match(anaRow, /^<div class="qrow" data-test="population-row"/, anaRow.slice(0, 120));
    assert.equal(anaRow.includes('href='), false, anaRow);
    assert.equal(anaRow.includes('data-test-case-link'), false);
    assert.equal(itemsHtml.includes(caseHref(OTHER_CASE_REF)), false);
  });
});

describe('B1 product acceptance — readable recovery options (FB1-5, FB1-6)', () => {
  const view = projectRecoveryCase(caseFacts());
  const html = renderProductRecoveryCase(view);

  test('the projection carries the persisted verdict and resolved identity, not a placeholder', () => {
    const option = view.strategies[0]!;
    assert.deepEqual(
      option.projectedPeople.map((p) => p.personLabel),
      ['Sarah Lim', 'Ana Costa', 'Mei Chen'],
    );
    assert.deepEqual(option.projectedPeople.map((p) => p.verdict), ['PASS', 'PASS', 'UNKNOWN']);
    // A genuine UNKNOWN survives; it is a real evaluation outcome, not a gap.
    assert.equal(option.projectedSummary.unknown, 1);
  });

  test('no "Traveller UNKNOWN" spam reaches the rendered page', () => {
    assert.equal(/Traveller\s+UNKNOWN/.test(html), false, html.slice(0, 400));
    assert.equal(html.includes('>Traveller<'), false);
    // The reached set is summarised rather than dumped row by row.
    assert.match(html, /Assessed against 3 reached subjects: 2 pass · 0 fail · 1 unknown\./);
  });

  test('each option states what it changes, in current -> proposed terms', () => {
    assert.match(html, /Move <strong>Headline interview<\/strong> from 1 Oct, 03:30 to 1 Oct, 05:30/);
    assert.match(html, /Move <strong>Partner briefing<\/strong> from 1 Oct, 05:30 to 1 Oct, 03:30/);
    assert.match(html, /Move <strong>Closing panel<\/strong> from 1 Oct, 06:30 to 1 Oct, 03:30/);
  });

  test('each option states who it fixes', () => {
    assert.match(html, /data-test="strategy-resolves"[^>]*>\s*Sarah Lim/);
    assert.match(html, /FAIL<\/span> → <span class="badge tone-done">PASS/);
  });

  test('two viable options are presented as distinguishable alternatives, not versions', () => {
    assert.match(html, /Option 1/);
    assert.match(html, /Option 2/);
    assert.match(html, /2 viable options — each changes the programme differently\. Choose one\./);
    // The difference is visible: the same blocked item moves to two different slots.
    assert.match(html, /to 1 Oct, 05:30/);
    assert.match(html, /to 1 Oct, 06:30/);
  });

  test('approval still carries the real strategyRef and posts to the normal application route', () => {
    for (const strategy of view.strategies) {
      assert.match(
        html,
        new RegExp(`data-test="approve-strategy" data-strategy-ref="${strategy.strategyRef}"`),
        `option ${strategy.optionNumber} approves by its real strategy id`,
      );
    }
    assert.match(html, /'\/api\/v2\/cases\/' \+ encodeURIComponent\(caseRef\) \+ '\/strategies\/' \+ encodeURIComponent\(strategyRef\) \+ '\/approve'/);
    assert.match(html, /'\/api\/v2\/cases\/' \+ encodeURIComponent\(caseRef\) \+ '\/strategies'/);
    // Internal refs stay available, as secondary metadata rather than the headline.
    assert.match(html, /Strategy <span class="mono">a51540b2-59ee-574f-99a2-d99bc84fbf59<\/span> · v1/);
  });

  test('an option whose change already executed says so instead of a no-op move', () => {
    // After an approved option executes, canonical state has caught up with
    // what that option proposed, so current == proposed.
    const facts = caseFacts() as unknown as { status: string; strategies: { changes: { currentWindow: unknown; proposedWindow: unknown }[] }[] };
    facts.status = 'RESOLVED';
    for (const change of facts.strategies[1]!.changes) change.currentWindow = change.proposedWindow;
    const executedHtml = renderProductRecoveryCase(projectRecoveryCase(facts as unknown as RecoveryCaseFacts));
    assert.match(executedHtml, /<strong>Headline interview<\/strong> is already at 1 Oct, 06:30–1 Oct, 07:00/);
    assert.equal(/from 1 Oct, 06:30 to 1 Oct, 06:30/.test(executedHtml), false, 'no "from X to X" move');
    assert.match(executedHtml, /data-change-state="IN_EFFECT"/);
    // Option 1 was never executed, so it still reads as a proposal.
    assert.match(executedHtml, /data-change-state="PROPOSED"/);
  });

  test('a terminal case offers no approval control', () => {
    const resolved = projectRecoveryCase({ ...caseFacts(), status: 'RESOLVED' } as unknown as RecoveryCaseFacts);
    const resolvedHtml = renderProductRecoveryCase(resolved);
    assert.equal(resolvedHtml.includes('data-test="approve-strategy"'), false);
    assert.equal(resolvedHtml.includes('data-test="propose-strategies"'), false);
    // The options themselves stay readable after resolution.
    assert.match(resolvedHtml, /Option 1/);
  });
});

describe('B1 product acceptance — focused case renders in the product shell (FB1-3)', () => {
  test('the case body inside the shell carries the same chrome and nav as Overview', () => {
    const view = projectRecoveryCase(caseFacts());
    const shelled = renderInShell('case', 'Recovery case', {}, renderProductRecoveryCase(view));
    assert.match(shelled, /<!DOCTYPE html>/i);
    for (const href of Object.values(SHELL_LINKS)) {
      assert.match(shelled, new RegExp(`href="${href.replace('/', '\\/')}"`), `shell links to ${href}`);
    }
    assert.match(shelled, /data-test="product-recovery-case"/);
    // The shell is given no event or decision count here, and invents neither.
    assert.equal(/class="pill alert"/.test(shelled), false);
  });
});

describe('B1 product acceptance — clean product routes (FB1-4)', () => {
  /** A target server whose product endpoints are stubbed: routing only. */
  function startServer(seen: string[]): Promise<{ server: Server; base: string }> {
    const endpoints: TargetEndpoints = {
      app: {} as TargetEndpoints['app'],
      async handle(_req: IncomingMessage, res: ServerResponse, url: URL) {
        if (!url.pathname.startsWith('/api/v2/')) return false;
        seen.push(`${url.pathname}${url.search}`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"stub":true}');
        return true;
      },
      close: async () => undefined,
    };
    const server = createTargetAppServer(
      { environment: 'test', workspaceId: '11111111-1111-1111-1111-111111111111' },
      endpoints,
    );
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        resolve({ server, base: `http://127.0.0.1:${port}` });
      });
    });
  }

  test('/, /operator and /operator/cases/:id all reach product handlers; API stays intact', async () => {
    const seen: string[] = [];
    const { server, base } = await startServer(seen);
    try {
      const overview = await fetch(`${base}/`, { redirect: 'follow' });
      assert.equal(overview.status, 200);

      const alias = await fetch(`${base}/operator`, { redirect: 'manual' });
      assert.equal(alias.status, 302, 'FB1-4: /operator is no longer a 404');
      assert.equal(alias.headers.get('location'), '/api/v2/operator/overview?format=html');

      const focused = await fetch(`${base}/operator/cases/${CASE_REF}`, { redirect: 'manual' });
      assert.equal(focused.status, 302);
      assert.equal(focused.headers.get('location'), `/api/v2/cases/${CASE_REF}?format=html`);

      // Followed through, the focused route lands on the shell-rendering handler.
      const followed = await fetch(`${base}/operator/cases/${CASE_REF}`, { redirect: 'follow' });
      assert.equal(followed.status, 200);
      assert.ok(seen.includes(`/api/v2/cases/${CASE_REF}?format=html`), JSON.stringify(seen));

      // The API JSON route is untouched and is not forced through the product shell.
      const api = await fetch(`${base}/api/v2/cases/${CASE_REF}`);
      assert.equal(api.status, 200);
      assert.equal(await api.text(), '{"stub":true}');

      // The clean route is what `caseHref` builds, so chrome and server agree.
      assert.equal(caseHref(CASE_REF), `/operator/cases/${CASE_REF}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('unknown paths still 404, and the case route does not swallow deeper paths', async () => {
    const seen: string[] = [];
    const { server, base } = await startServer(seen);
    try {
      assert.equal((await fetch(`${base}/operator/cases`, { redirect: 'manual' })).status, 404);
      assert.equal((await fetch(`${base}/operator/cases/${CASE_REF}/extra`, { redirect: 'manual' })).status, 404);
      assert.equal((await fetch(`${base}/nope`, { redirect: 'manual' })).status, 404);
      // POST is not a product navigation verb.
      assert.equal((await fetch(`${base}/operator`, { method: 'POST', redirect: 'manual' })).status, 404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('B1 retest readiness — PG_TARGET_SSL means what it says', () => {
  // `.env.example` documents `PG_TARGET_SSL=false`, and the config used
  // `z.coerce.boolean()`, which reads every non-empty string as true. Copying
  // the documented recipe therefore turned SSL ON and failed normal boot with
  // "The server does not support SSL connections" — which would have blocked
  // the founder's fresh-workspace retest before it started.
  const ssl = (value?: string): boolean =>
    loadPostgresTargetConfig(value === undefined ? {} : { PG_TARGET_SSL: value }).ssl;

  test('documented off values disable SSL', () => {
    for (const value of ['false', 'FALSE', ' false ', '0', 'no', 'off', '']) {
      assert.equal(ssl(value), false, `PG_TARGET_SSL=${JSON.stringify(value)}`);
    }
    assert.equal(ssl(undefined), false, 'unset defaults to off');
  });

  test('on values enable SSL', () => {
    for (const value of ['true', 'TRUE', '1', 'yes', 'on']) {
      assert.equal(ssl(value), true, `PG_TARGET_SSL=${JSON.stringify(value)}`);
    }
  });

  test('an ambiguous value is refused, never silently guessed', () => {
    // Whether the connection is encrypted must not be decided by a typo.
    assert.throws(() => ssl('flase'), /true\/false/);
    assert.throws(() => ssl('maybe'));
  });
});

describe('B1 product acceptance — regression guards', () => {
  test('no LLM or external provider call is involved in rendering a recovery option', () => {
    const html = renderProductRecoveryCase(projectRecoveryCase(caseFacts()));
    for (const term of ['openai', 'anthropic', 'dashscope', 'model-studio', 'qwen', 'atlas']) {
      assert.equal(html.toLowerCase().includes(term), false, `rendered case must not reference ${term}`);
    }
  });

  test('the repaired routes import no retired SQLite/legacy runtime', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/server/targetHttp.ts', import.meta.url), 'utf8'),
    );
    // Only real import statements count — the module's own prose explains the
    // boundary by naming the retired composition, which is not a reference to it.
    const imports = [...source.matchAll(/^\s*import[^;]*from\s+'([^']+)';/gm)].map((m) => m[1]!);
    assert.ok(imports.length > 0, 'the module does import something');
    for (const specifier of imports) {
      assert.equal(/compose\.ts$|server\/http\.ts$|node:sqlite|persistence\/(database|repositories|entityStore)/.test(specifier), false, specifier);
    }
    // The new case route is served by the same target endpoints as every
    // other product route — it introduces no second dispatcher.
    assert.match(source, /CASE_ROUTE/);
    assert.match(source, /\/api\/v2\/cases\//);
  });
});
