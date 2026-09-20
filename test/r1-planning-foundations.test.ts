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
  dimensionReasonToken,
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

test('dispatcher: nextRound chains normalized flight results into hotel search and quote reads', async () => {
  const flight = request({ id: 'flight-1' });
  const calls: string[] = [];
  const outcome = await dispatchResearch({
    rounds: [[flight]],
    budget: { maxRounds: 3, maxRequests: 6 },
    transport: async (req) => {
      calls.push(req.operation);
      return resultFor(req, {
        normalizedEvidence: req.operation === 'flight.search'
          ? { offers: [{ offerId: 'offer-1' }] }
          : req.operation === 'hotel.search'
            ? { rates: [{ rateId: 'rate-1' }] }
            : { status: 'QUOTED', quoteId: 'quote-1' },
      });
    },
    nextRound: ({ completedRound, results }) => {
      if (completedRound === 1) {
        assert.equal(results[0]?.operation, 'flight.search');
        return [request({
          id: 'hotel-search-1',
          capability: 'HOTEL',
          operation: 'hotel.search',
          parameters: { checkInDate: '2030-06-02', checkOutDate: '2030-06-03' },
          purpose: 'find the required overnight accommodation',
          evidenceGapCode: 'overnight_accommodation',
          round: 2,
        })];
      }
      if (completedRound === 2) {
        assert.equal(results[1]?.operation, 'hotel.search');
        return [request({
          id: 'hotel-quote-1',
          capability: 'HOTEL',
          operation: 'hotel.quote',
          parameters: { rateId: 'rate-1' },
          purpose: 'confirm the researched overnight rate',
          evidenceGapCode: 'overnight_rate',
          round: 3,
        })];
      }
      return [];
    },
  });

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(calls, ['flight.search', 'hotel.search', 'hotel.quote']);
  assert.equal(outcome.results.length, 3);
  assert.equal(outcome.evidence.length, 3);
  assert.equal(outcome.results[2]?.normalizedEvidence && (outcome.results[2].normalizedEvidence as { status: string }).status, 'QUOTED');
});

test('dispatcher: dynamic follow-up respects maxRequests and preserves prior evidence', async () => {
  const calls: string[] = [];
  const outcome = await dispatchResearch({
    rounds: [[request({ id: 'flight-1' })]],
    budget: { maxRounds: 3, maxRequests: 2 },
    transport: async (req) => {
      calls.push(req.operation);
      return resultFor(req);
    },
    nextRound: ({ completedRound }) => completedRound === 1
      ? [request({ id: 'hotel-search-1', capability: 'HOTEL', operation: 'hotel.search', round: 2 })]
      : [request({ id: 'hotel-quote-1', capability: 'HOTEL', operation: 'hotel.quote', parameters: { rateId: 'rate-1' }, round: 3 })],
  });

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.refusal.kind, 'PLANNING_BUDGET_EXCEEDED');
  assert.equal(outcome.refusal.attemptedRound, 3);
  assert.equal(outcome.refusal.attemptedRequests, 3);
  assert.equal(outcome.evidence.length, 2);
  assert.deepEqual(calls, ['flight.search', 'hotel.search']);
});

test('dispatcher: dynamic requests merge with the next static round', async () => {
  const calls: string[] = [];
  const outcome = await dispatchResearch({
    rounds: [
      [request({ id: 'flight-1' })],
      [request({
        id: 'static-context-1',
        capability: 'HOTEL',
        operation: 'hotel.context',
        parameters: { stayElementId: 'stay-1' },
        round: 2,
      })],
    ],
    budget: { maxRounds: 3, maxRequests: 6 },
    transport: async (req) => {
      calls.push(req.operation);
      return resultFor(req);
    },
    nextRound: ({ completedRound }) => completedRound === 1
      ? [request({ id: 'dynamic-search-1', capability: 'HOTEL', operation: 'hotel.search', round: 2 })]
      : [],
  });

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(calls, ['flight.search', 'hotel.context', 'hotel.search']);
  assert.equal(outcome.dispatched, 3);
});

test('dispatcher: nextRound cannot dispatch beyond maxRounds', async () => {
  let callbackCalls = 0;
  const calls: string[] = [];
  const outcome = await dispatchResearch({
    rounds: [[request({ id: 'flight-1' })]],
    budget: { maxRounds: 2, maxRequests: 4 },
    transport: async (req) => {
      calls.push(req.operation);
      return resultFor(req);
    },
    nextRound: ({ completedRound }) => {
      callbackCalls += 1;
      return [request({
        id: `follow-up-${completedRound}`,
        capability: 'HOTEL',
        operation: 'hotel.search',
        round: completedRound + 1,
      })];
    },
  });

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(callbackCalls, 1);
  assert.deepEqual(calls, ['flight.search', 'hotel.search']);
});

test('dispatcher: duplicate dynamic follow-ups do not create another transport call', async () => {
  const first = request({ id: 'flight-1' });
  let callbackCalls = 0;
  let transportCalls = 0;
  const outcome = await dispatchResearch({
    rounds: [[first]],
    budget: { maxRounds: 3, maxRequests: 4 },
    transport: async (req) => {
      transportCalls += 1;
      return resultFor(req);
    },
    nextRound: ({ completedRound }) => {
      callbackCalls += 1;
      if (completedRound === 1) return [request({ id: 'duplicate-flight', round: 2 })];
      return [];
    },
  });

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(callbackCalls, 2);
  assert.equal(transportCalls, 1);
  assert.equal(outcome.dispatched, 1);
});

test('dispatcher: empty static rounds preserve later static work', async () => {
  const calls: string[] = [];
  const outcome = await dispatchResearch({
    rounds: [[], [request({ id: 'later-static', round: 2 })]],
    transport: async (req) => {
      calls.push(req.id);
      return resultFor(req);
    },
  });

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.deepEqual(calls, ['later-static']);
  assert.equal(outcome.dispatched, 1);
});

test('dispatcher: malformed consequential dynamic request is rejected before transport', async () => {
  let transportCalls = 0;
  const outcome = dispatchResearch({
    rounds: [[request({ id: 'flight-1' })]],
    transport: async (req) => {
      transportCalls += 1;
      return resultFor(req);
    },
    nextRound: () => [{
      ...request({ id: 'bad-follow-up', round: 2 }),
      operation: 'flight.book',
    } as never],
  });

  await assert.rejects(outcome, /nextRound generated invalid planning request/);
  assert.equal(transportCalls, 1, 'the malformed follow-up never reaches transport');
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

test('registry: an arrival-readiness deficit on programme participation ALSO makes movement recovery relevant', () => {
  const token = dimensionReasonToken('programme_participation', 'insufficient_arrival_readiness');
  const decisions = new Map(resolveRecoveryDomainDecisions(defaultRecoveryDomainRegistry(), contextFor(['programme_participation', token])).map((d) => [d.domainId, d]));
  assert.equal(decisions.get('PROGRAMME')?.disposition, 'INVESTIGATED');
  assert.equal(decisions.get('TRANSPORT')?.disposition, 'INVESTIGATED');
  assert.equal(decisions.get('TRANSPORT')?.reasonCode, `blocking_${token}`);
  // Another reason on the same dimension does not.
  const other = new Map(resolveRecoveryDomainDecisions(defaultRecoveryDomainRegistry(), contextFor(['programme_participation', dimensionReasonToken('programme_participation', 'other_reason')])).map((d) => [d.domainId, d]));
  assert.equal(other.get('TRANSPORT')?.disposition, 'NOT_APPLICABLE');
});
