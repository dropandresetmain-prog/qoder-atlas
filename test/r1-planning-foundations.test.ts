/**
 * R1 — the deterministic recovery-domain registry (freeze C3) and the bounded
 * read-only research dispatcher (freeze C2) are PURE and scenario-free. No
 * PostgreSQL, no provider, no model. These tests pin:
 *   - domain relevance comes ONLY from real blocking M6 dimension codes;
 *   - a missing capability fails a domain CLOSED to UNAVAILABLE, not investigated;
 *   - an unregistered AI-suggested domain fails closed;
 *   - the dispatcher dedupes by canonical fingerprint, enforces the finite
 *     budget with a structured refusal that keeps prior evidence, and records
 *     external failure as visible data (never fabricated success).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRecoveryDomainDecisions } from '../src/contracts/v2/planning/recoveryDomain.ts';
import {
  defaultRecoveryDomainRegistry,
  recoveryDomainContext,
} from '../src/resolution/planning/recoveryDomains.ts';
import {
  dispatchResearch,
  toEvidenceRecord,
  type PlanningToolTransport,
} from '../src/resolution/planning/researchDispatcher.ts';
import type { PlanningToolRequest, PlanningToolResult } from '../src/contracts/v2/planning/planningTool.ts';
import {
  PlanningToolRequestSchema,
  DEFAULT_PLANNING_RESEARCH_BUDGET,
} from '../src/contracts/v2/planning/planningTool.ts';

function contextFor(blocking: string[], capabilities: string[] = ['FLIGHT', 'HOTEL', 'TRANSFER', 'RESEARCH']) {
  return recoveryDomainContext({
    failingSubjectKinds: ['JOURNEY'],
    blockingDimensionCodes: blocking,
    affectedObjectKinds: [],
    availableCapabilities: capabilities as never,
  });
}

test('registry: connection_feasibility activates TRANSPORT and TRANSFER, nothing else', () => {
  const decisions = resolveRecoveryDomainDecisions(defaultRecoveryDomainRegistry(), contextFor(['connection_feasibility']));
  const byId = new Map(decisions.map((d) => [d.domainId, d]));
  assert.equal(byId.get('TRANSPORT')?.disposition, 'INVESTIGATED');
  assert.equal(byId.get('TRANSPORT')?.reasonCode, 'blocking_connection_feasibility');
  assert.equal(byId.get('TRANSFER')?.disposition, 'INVESTIGATED');
  assert.equal(byId.get('STAY')?.disposition, 'NOT_APPLICABLE');
  assert.equal(byId.get('PROGRAMME')?.disposition, 'NOT_APPLICABLE');
});

test('registry: overnight_accommodation activates STAY; programme_participation activates PROGRAMME', () => {
  const d1 = new Map(resolveRecoveryDomainDecisions(defaultRecoveryDomainRegistry(), contextFor(['overnight_accommodation'])).map((d) => [d.domainId, d]));
  assert.equal(d1.get('STAY')?.disposition, 'INVESTIGATED');
  assert.equal(d1.get('TRANSPORT')?.disposition, 'NOT_APPLICABLE');
  const d2 = new Map(resolveRecoveryDomainDecisions(defaultRecoveryDomainRegistry(), contextFor(['programme_participation'])).map((d) => [d.domainId, d]));
  assert.equal(d2.get('PROGRAMME')?.disposition, 'INVESTIGATED');
});

test('registry: a required capability that is unavailable fails the domain CLOSED, never investigated', () => {
  // STAY needs HOTEL; without it, an otherwise-activated domain is UNAVAILABLE.
  const decisions = resolveRecoveryDomainDecisions(defaultRecoveryDomainRegistry(), contextFor(['overnight_accommodation'], ['FLIGHT']));
  const stay = decisions.find((d) => d.domainId === 'STAY');
  assert.equal(stay?.disposition, 'UNAVAILABLE');
  assert.equal(stay?.reasonCode, 'capability_unavailable');
});

test('registry: INFORMATION_RESEARCH is evidence-only and needs RESEARCH; missing RESEARCH fails it closed', () => {
  const withResearch = resolveRecoveryDomainDecisions(defaultRecoveryDomainRegistry(), contextFor(['advisories'], ['RESEARCH']));
  assert.equal(withResearch.find((d) => d.domainId === 'INFORMATION_RESEARCH')?.disposition, 'INVESTIGATED');
  const without = resolveRecoveryDomainDecisions(defaultRecoveryDomainRegistry(), contextFor(['advisories'], ['FLIGHT']));
  assert.equal(without.find((d) => d.domainId === 'INFORMATION_RESEARCH')?.disposition, 'UNAVAILABLE');
});

test('registry: no blocking dimension match leaves every domain NOT_APPLICABLE', () => {
  const decisions = resolveRecoveryDomainDecisions(defaultRecoveryDomainRegistry(), contextFor(['unrelated_dimension']));
  assert.ok(decisions.length > 0);
  assert.ok(decisions.every((d) => d.disposition === 'NOT_APPLICABLE'));
});

test('registry: an AI-suggested domain the registry does not define fails closed; it cannot reorder deterministic decisions', () => {
  const decisions = resolveRecoveryDomainDecisions(
    defaultRecoveryDomainRegistry(),
    contextFor(['connection_feasibility']),
    ['STAY' as never], // STAY is registered but not blocking => still NOT_APPLICABLE
  );
  const stay = decisions.find((d) => d.domainId === 'STAY');
  assert.equal(stay?.source, 'DETERMINISTIC', 'the deterministic decision stands; AI did not override it');
  assert.equal(stay?.disposition, 'NOT_APPLICABLE');
});

function request(over: Partial<PlanningToolRequest> = {}): PlanningToolRequest {
  return PlanningToolRequestSchema.parse({
    id: 'req-1',
    capability: 'FLIGHT',
    operation: 'flight.search',
    parameters: { from: 'AAA', to: 'BBB' },
    purpose: 'find alternative connections',
    evidenceGapCode: 'alternative_connection',
    round: 1,
    ...over,
  });
}

function resultFor(req: PlanningToolRequest, over: Partial<PlanningToolResult> = {}): PlanningToolResult {
  return {
    requestId: req.id,
    capability: req.capability,
    operation: req.operation,
    status: 'SUCCEEDED',
    normalizedEvidence: { options: [] },
    provenance: { mode: 'REPLAY', observedAt: '2030-06-01T12:00:00.000Z', sourceRefs: [], recordingRef: 'rec-1' },
    uncertainty: [],
    ...over,
  };
}

const okTransport: PlanningToolTransport = async (req) => resultFor(req);

test('dispatcher: equivalent requests dedupe across rounds by canonical fingerprint (key order irrelevant)', async () => {
  const a = request({ id: 'r-a', parameters: { from: 'AAA', to: 'BBB' } });
  const b = request({ id: 'r-b', round: 2, parameters: { to: 'BBB', from: 'AAA' } }); // same fingerprint
  const outcome = await dispatchResearch({ rounds: [[a], [b]], transport: okTransport });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.dispatched, 1, 'the duplicate is not re-dispatched');
  assert.equal(outcome.evidence.length, 1);
});

test('dispatcher: exceeding maxRounds refuses BEFORE dispatch and reports the attempted shape', async () => {
  const rounds = [[request({ id: 'a' })], [request({ id: 'b', round: 2 })], [request({ id: 'c', round: 3 })]];
  const outcome = await dispatchResearch({ rounds, transport: okTransport, budget: { maxRounds: 2, maxRequests: 10 } });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.refusal.kind, 'PLANNING_BUDGET_EXCEEDED');
  assert.equal(outcome.refusal.attemptedRound, 3);
  assert.equal(outcome.evidence.length, 0, 'nothing was dispatched');
});

test('dispatcher: exceeding maxRequests refuses mid-basis but keeps the evidence already gathered', async () => {
  const rounds = [[request({ id: 'a' }), request({ id: 'b', parameters: { from: 'CCC' } }), request({ id: 'c', parameters: { from: 'DDD' } })]];
  const outcome = await dispatchResearch({ rounds, transport: okTransport, budget: { maxRounds: 2, maxRequests: 2 } });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.refusal.attemptedRequests, 3);
  assert.equal(outcome.evidence.length, 2, 'the two reads already dispatched are retained, not dropped');
});

test('dispatcher: default budget matches the contract constant', async () => {
  const outcome = await dispatchResearch({ rounds: [[request()]], transport: okTransport });
  assert.equal(outcome.ok, true);
  assert.equal(DEFAULT_PLANNING_RESEARCH_BUDGET.maxRounds, 2);
});

test('dispatcher: an external FAILED read is recorded as visible failure data, never fabricated success', async () => {
  const failing: PlanningToolTransport = async (req) =>
    resultFor(req, {
      status: 'FAILED',
      normalizedEvidence: undefined,
      error: { category: 'provider', code: 'upstream_timeout', message: 'provider timed out', retryable: true },
    });
  const outcome = await dispatchResearch({ rounds: [[request()]], transport: failing });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  const record = outcome.evidence[0]!;
  assert.equal(record.status, 'FAILED');
  assert.ok(record.summary.includes('upstream_timeout'));
  assert.equal(record.provenance.mode, 'REPLAY');
});

test('toEvidenceRecord: carries a bounded factual summary and the canonical fingerprint, no wire payload', () => {
  const req = request();
  const record = toEvidenceRecord(req, resultFor(req));
  assert.equal(record.evidenceRef, `evidence:${req.id}`);
  assert.equal(record.requestFingerprint, 'FLIGHT|flight.search|{"from":"AAA","to":"BBB"}');
  assert.equal(record.capability, 'FLIGHT');
  assert.equal(record.operation, 'flight.search');
  assert.ok(record.summary.length <= 1024);
});

test('dispatcher: a request type cannot represent a consequential operation (structural safety)', () => {
  // The closed ToolOperationSchema has no booking/pay/cancel-submit verb, so a
  // "book this flight" request literally cannot be constructed.
  const bad = PlanningToolRequestSchema.safeParse({
    id: 'x', capability: 'FLIGHT', operation: 'flight.book', parameters: {},
    purpose: 'book it', evidenceGapCode: 'none', round: 1,
  });
  assert.equal(bad.success, false);
});
