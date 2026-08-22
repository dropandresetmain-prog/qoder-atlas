/**
 * Northstar RV-N2 — programme intake adapter tests.
 *
 * Covers (a) messy CSV header aliases + row without name,
 *          (b) CSV <-> table equivalence,
 *          (c) missing fields stay missing (no fabrication),
 *          (d) malformed LLM JSON and schema-invalid LLM JSON are rejected,
 *          (e) scripted valid LLM roster -> drafts,
 *          (f) recognized policy clauses -> rules / uncertainties,
 *          (g) dependency-free xlsx round-trip.
 *
 * No network. No file system fixtures (xlsx is built in-test).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseRosterCsv } from '../src/intake/programmeCsv.ts';
import { tableRowsToDrafts } from '../src/intake/programmeTable.ts';
import { parseXlsxRoster } from '../src/intake/programmeXlsx.ts';
import { mapRosterWithModel } from '../src/intelligence/programmeExtraction.ts';
import type {
  CompletionRequest,
  CompletionResponse,
} from '../src/intelligence/client.ts';
import { recognizedPolicyClausesToRuleSet } from '../src/ingest/programmeClauses.ts';
import { ProgrammeTravellerDraftSchema } from '../src/contracts/programmeIntake.ts';
import { buildMinimalXlsx } from './northstar-xlsx-helper.ts';

// ---------------------------------------------------------------------------
// a. Messy CSV with weird header aliases
// ---------------------------------------------------------------------------

test('csv: messy headers alias to canonical fields', () => {
  const csv = [
    'Full Name,E-mail,DOB,Nationalities,home airport,notes',
    '"Anne-Marie d_Arc",anne@example.com,1990-04-12,"FR;JP",CDG,vegetarian;arrives day before',
    ',no-name@example.com,1985-01-02,DE,MUC,lone row',
  ].join('\n');
  const result = parseRosterCsv(csv, 'evt-1');

  assert.equal(result.drafts.length, 1, 'only the row with a name produces a draft');
  const d = result.drafts[0]!;
  assert.equal(d.draftId, 'evt-1-1');
  assert.equal(d.displayName, "Anne-Marie d_Arc");
  assert.equal(d.identity.email, 'anne@example.com');
  assert.equal(d.identity.dateOfBirth, '1990-04-12');
  assert.deepEqual(d.nationalityCodes, ['FR', 'JP']);
  assert.equal(d.homeLocationText, 'CDG');
  // The free-text notes cell plus any "unrecognized column" we mapped to it.
  // We do not assert exact ordering; just that the "vegetarian;arrives day
  // before" string survived.
  assert.ok(d.notes.some((n) => n.includes('vegetarian')));

  // The name-less row becomes an unresolved statement, not a draft.
  assert.equal(result.unresolvedStatements.length, 1);
  assert.match(result.unresolvedStatements[0]!, /no displayName/);
  assert.match(result.unresolvedStatements[0]!, /no-name@example\.com/);
});

// ---------------------------------------------------------------------------
// b. CSV <-> table equivalence
// ---------------------------------------------------------------------------

test('csv <-> table: same data yields deep-equal drafts', () => {
  const csv = [
    'Full Name,E-mail,DOB,Nationalities,home airport,notes',
    '"Bo Kwon",bo@example.com,1992-07-11,KR,ICN,wheelchair-accessible room',
    '"Cee Lim",cee@example.com,1988-12-30,SG/UK,SIN,vegan',
  ].join('\n');
  const rows = [
    {
      'Full Name': 'Bo Kwon',
      'E-mail': 'bo@example.com',
      'DOB': '1992-07-11',
      'Nationalities': 'KR',
      'home airport': 'ICN',
      'notes': 'wheelchair-accessible room',
    },
    {
      'Full Name': 'Cee Lim',
      'E-mail': 'cee@example.com',
      'DOB': '1988-12-30',
      'Nationalities': 'SG/UK',
      'home airport': 'SIN',
      'notes': 'vegan',
    },
  ];

  const csvResult = parseRosterCsv(csv, 'evt-2');
  const tableResult = tableRowsToDrafts(rows, 'evt-2');

  assert.deepEqual(csvResult.drafts, tableResult.drafts);
  assert.deepEqual(csvResult.unresolvedStatements, tableResult.unresolvedStatements);
});

// ---------------------------------------------------------------------------
// c. Missing fields stay missing
// ---------------------------------------------------------------------------

test('rows: missing fields stay missing (no fabricated passport/home)', () => {
  const rows = [
    { 'Full Name': 'Dee Vu', 'DOB': '1990-05-05' },
  ];
  const result = tableRowsToDrafts(rows, 'evt-3');
  const d = result.drafts[0]!;
  assert.equal(d.displayName, 'Dee Vu');
  assert.deepEqual(d.nationalityCodes, [], 'absent nationality -> []');
  assert.equal(d.identity.passportNumber, undefined, 'no fabricated passport');
  assert.equal(d.homeLocationText, undefined, 'no fabricated home');
  assert.equal(d.identity.dateOfBirth, '1990-05-05');
  // Schema-strict validation must still pass for the sparse draft.
  assert.equal(ProgrammeTravellerDraftSchema.safeParse(d).success, true);
});

// ---------------------------------------------------------------------------
// d. Malformed LLM output -> ok:false
// ---------------------------------------------------------------------------

interface ScriptedClientOptions {
  contentText: string;
}

function scriptedClient(opts: ScriptedClientOptions) {
  const client = {
    async complete(_req: CompletionRequest, _timeoutMs: number): Promise<CompletionResponse> {
      return { contentText: opts.contentText };
    },
  };
  return client;
}

test('llm: non-JSON model output is rejected as ok:false (no repair)', async () => {
  const client = scriptedClient({ contentText: 'not json' });
  const result = await mapRosterWithModel(client, {
    content: 'free text',
    at: '2026-08-22T00:00:00Z',
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /not valid JSON/);
  }
});

test('llm: schema-invalid JSON is rejected as ok:false (no repair)', async () => {
  const bad = JSON.stringify({
    travellers: [{ displayName: 42 }], // wrong type
    unresolvedStatements: 'not an array',
  });
  const client = scriptedClient({ contentText: bad });
  const result = await mapRosterWithModel(client, {
    content: 'free text',
    at: '2026-08-22T00:00:00Z',
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /schema/);
  }
});

// ---------------------------------------------------------------------------
// e. Scripted valid LLM output -> drafts
// ---------------------------------------------------------------------------

test('llm: scripted valid roster output produces expected drafts', async () => {
  const valid = JSON.stringify({
    travellers: [
      {
        displayName: 'Eli Reed',
        email: 'eli@example.com',
        phoneE164: '+1-555-0100',
        dateOfBirth: '1985-02-14',
        nationalityCodes: ['US'],
        homeLocationText: 'SFO',
        accessibilityStatements: ['step-free seating'],
        notes: ['panel speaker'],
        commitmentTitles: ['Day 1 keynote', 'Workshop B'],
      },
    ],
    unresolvedStatements: ['group arrival bus times TBD'],
  });
  const client = scriptedClient({ contentText: valid });
  const result = await mapRosterWithModel(client, {
    content: 'intake description',
    at: '2026-08-22T00:00:00Z',
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.drafts.length, 1);
  const d = result.drafts[0]!;
  assert.equal(d.draftId, 'llm-1');
  assert.equal(d.displayName, 'Eli Reed');
  assert.equal(d.identity.email, 'eli@example.com');
  // Phone was stripped of dashes and retains the leading +.
  assert.equal(d.identity.phoneE164, '+15550100');
  assert.equal(d.identity.dateOfBirth, '1985-02-14');
  assert.deepEqual(d.nationalityCodes, ['US']);
  assert.equal(d.homeLocationText, 'SFO');
  assert.deepEqual(d.accessibilityStatements, ['step-free seating']);
  assert.ok(d.notes.some((n) => n.includes('panel speaker')));
  assert.ok(d.notes.some((n) => n.includes('commitment title: Day 1 keynote')));
  // commitment titles are NOT turned into ids; they surface as unresolved.
  assert.ok(
    result.unresolvedStatements.some((s) => s.includes('commitment titles cannot be promoted without ids')),
  );
  // The model-supplied unresolved statement is also preserved.
  assert.ok(result.unresolvedStatements.includes('group arrival bus times TBD'));
  // No anchor ids invented.
  assert.deepEqual(d.anchorCommitmentIds, []);
});

// ---------------------------------------------------------------------------
// f. Recognized policy clauses -> rules / uncertainties
// ---------------------------------------------------------------------------

test('clauses: valid FUNDED_WINDOW yields offset-bearing ISO rules', () => {
  const result = recognizedPolicyClausesToRuleSet({
    ruleSetId: 'rs_evt',
    sourceId: 'src_evt',
    timezone: 'Asia/Singapore',
    clauses: [
      {
        kind: 'FUNDED_WINDOW',
        statement: 'covered by event organiser',
        windowStart: '2026-09-01',
        windowEnd: '2026-09-05',
      },
    ],
  });
  assert.ok(result.ruleSet, 'ruleSet must be present');
  assert.equal(result.uncertainties.length, 0);
  const rule = result.ruleSet!.rules[0]!;
  assert.equal(rule.kind, 'FUNDED_WINDOW');
  if (rule.kind === 'FUNDED_WINDOW') {
    assert.equal(rule.windowStart, '2026-09-01T00:00:00+08:00');
    assert.equal(rule.windowEnd, '2026-09-05T00:00:00+08:00');
    assert.equal(rule.coveredBy, 'EVENT_ORGANISATION');
    assert.equal(rule.incrementalPayer, 'TRAVELLER');
  }
});

test('clauses: unparseable temporal -> clause dropped + uncertainty', () => {
  const result = recognizedPolicyClausesToRuleSet({
    ruleSetId: 'rs_evt',
    sourceId: 'src_evt',
    timezone: 'Asia/Singapore',
    clauses: [
      {
        kind: 'FUNDED_WINDOW',
        statement: 'covered by event organiser',
        windowStart: 'next tuesday morning',
        windowEnd: '2026-09-05',
      },
    ],
  });
  assert.equal(result.ruleSet, undefined, 'no rules -> no ruleSet');
  assert.equal(result.uncertainties.length, 1);
  assert.match(result.uncertainties[0]!.statement, /FUNDED_WINDOW/);
});

test('clauses: unknown kind -> uncertainty only, no rule', () => {
  const result = recognizedPolicyClausesToRuleSet({
    ruleSetId: 'rs_evt',
    sourceId: 'src_evt',
    timezone: 'Asia/Singapore',
    clauses: [
      {
        kind: 'PERSONAL_BUTLER_LIMIT',
        statement: 'butler only on Tuesday',
      },
    ],
  });
  assert.equal(result.ruleSet, undefined);
  assert.equal(result.uncertainties.length, 1);
  assert.match(result.uncertainties[0]!.statement, /Unrecognized clause kind/);
  assert.equal(result.uncertainties[0]!.severity, 'MEDIUM');
});

// ---------------------------------------------------------------------------
// g. XLSX round-trip
// ---------------------------------------------------------------------------

test('xlsx: minimal in-test xlsx buffer round-trips through parseXlsxRoster', () => {
  const buffer = buildMinimalXlsx({
    headers: ['Full Name', 'Email'],
    rows: [
      ['Fay Zee', 'fay@example.com'],
    ],
  });
  // Sanity: first four bytes are the local file header signature.
  assert.equal(buffer.readUInt32LE(0), 0x04034b50);
  const result = parseXlsxRoster(buffer, 'evt-x');
  if (!result.ok) {
    assert.fail(`parseXlsxRoster returned ok:false with reason: ${result.reason}`);
    return;
  }
  assert.equal(result.drafts.length, 1);
  const d = result.drafts[0]!;
  assert.equal(d.draftId, 'evt-x-1');
  assert.equal(d.displayName, 'Fay Zee');
  assert.equal(d.identity.email, 'fay@example.com');
  assert.deepEqual(d.nationalityCodes, []);
});
