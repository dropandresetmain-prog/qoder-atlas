import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildHotelPropertyPolicyWindow, HotelPropertyPolicySchema } from '../src/resolution/planning/hotelPropertyPolicy.ts';
import type { OfficialDocumentEvidence } from '../src/providers/research/officialDocuments.ts';

const POLICY = {
  id: 'hotel-policy-test',
  canonicalPlaceId: 'place-test-hotel',
  sourcePlaceAliases: [{ system: 'test-hotel-id', value: 'test-1' }],
  timeZone: 'Asia/Singapore',
  standardCheckIn: '15:00',
  standardCheckOut: '11:00',
  lateArrivalSupported: null,
  effectiveWindow: { start: '2026-01-01', end: '2027-01-01' },
  maxEvidenceAgeSeconds: 86_400,
  sources: [
    { sourceId: 'test-source', url: 'https://hotel.example/policy', publisher: 'Test Hotel', contentSha256: createHash('sha256').update('policy').digest('hex') },
  ],
  note: 'General property standard; rate-specific terms may override it.',
} as const;

function document(overrides: Partial<OfficialDocumentEvidence> = {}): OfficialDocumentEvidence {
  return {
    sourceId: 'test-source',
    publisher: 'Test Hotel',
    url: 'https://hotel.example/policy',
    observedAt: '2026-09-19T12:00:00Z',
    contentSha256: POLICY.sources[0]!.contentSha256,
    text: 'policy',
    ...overrides,
  };
}

test('builds an offset-bearing window using the property IANA timezone', () => {
  const result = buildHotelPropertyPolicyWindow({ policy: POLICY, actualOfficialDocumentEvidence: [document()], quotedLocalDates: { checkInDate: '2026-09-29', checkOutDate: '2026-10-01' }, now: '2026-09-20T00:00:00Z' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stayWindow.start, '2026-09-29T15:00:00+08:00');
  assert.equal(result.stayWindow.end, '2026-10-01T11:00:00+08:00');
  assert.equal(result.lateArrivalSupported, null);
  assert.equal(result.sourceProvenance[0]!.contentSha256, POLICY.sources[0]!.contentSha256);
});

test('checked-in Narita policy data produces the reviewed local stay window', () => {
  const policies = JSON.parse(readFileSync('data/ait-demo-input-pack/global/hotel-property-policies.json', 'utf8')) as unknown[];
  const configured = HotelPropertyPolicySchema.parse(policies[0]);
  // Check configured property facts using synthetic source-boundary evidence.
  // This unit test does not impersonate a live read of the reviewed official page.
  const policy = { ...configured, sources: [...POLICY.sources] };
  const documents = [document()];
  const result = buildHotelPropertyPolicyWindow({ policy, actualOfficialDocumentEvidence: documents, quotedLocalDates: { checkInDate: '2026-09-29', checkOutDate: '2026-09-30' }, now: '2026-09-20T00:00:00Z' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.policy.canonicalPlaceId, 'place-hotel-narita-gateway');
  assert.deepEqual(result.stayWindow, { start: '2026-09-29T15:00:00+09:00', end: '2026-09-30T11:00:00+09:00' });
});

test('handles a DST-aware zone through the shared temporal normalizer', () => {
  const policy = { ...POLICY, timeZone: 'America/New_York' };
  const result = buildHotelPropertyPolicyWindow({ policy, actualOfficialDocumentEvidence: [document()], quotedLocalDates: { checkInDate: '2026-10-31', checkOutDate: '2026-11-02' }, now: '2026-09-20T00:00:00Z' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.stayWindow.start, '2026-10-31T15:00:00-04:00');
  assert.equal(result.stayWindow.end, '2026-11-02T11:00:00-05:00');
});

test('refuses malformed dates, reversed windows, and invalid policy timezone', () => {
  for (const quotedLocalDates of [
    { checkInDate: '2026-02-30', checkOutDate: '2026-03-01' },
    { checkInDate: '2026-10-02', checkOutDate: '2026-10-01' },
  ]) {
    const result = buildHotelPropertyPolicyWindow({ policy: POLICY, actualOfficialDocumentEvidence: [document()], quotedLocalDates, now: '2026-09-20T00:00:00Z' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 'UNKNOWN');
  }
  const invalidTimeZone = buildHotelPropertyPolicyWindow({
    policy: { ...POLICY, timeZone: 'Not/AZone' },
    actualOfficialDocumentEvidence: [document()],
    quotedLocalDates: { checkInDate: '2026-09-29', checkOutDate: '2026-10-01' },
    now: '2026-09-20T00:00:00Z',
  });
  assert.equal(invalidTimeZone.ok, false);
  if (!invalidTimeZone.ok) assert.equal(invalidTimeZone.reason, 'invalid_local_window');
});

test('refuses changed, missing, duplicate, future, and stale source evidence', () => {
  const cases: Array<[OfficialDocumentEvidence[], string]> = [
    [[], 'missing_source_evidence'],
    [[document({ contentSha256: 'b'.repeat(64) })], 'source_provenance_mismatch'],
    [[document(), document({ sourceId: 'test-source' })], 'duplicate_source_evidence'],
    [[document({ observedAt: '2026-09-21T00:00:00Z' })], 'future_source_evidence'],
    [[document({ observedAt: '2026-09-18T00:00:00Z' })], 'stale_source_evidence'],
  ];
  for (const [actualOfficialDocumentEvidence, reason] of cases) {
    const result = buildHotelPropertyPolicyWindow({ policy: POLICY, actualOfficialDocumentEvidence, quotedLocalDates: { checkInDate: '2026-09-29', checkOutDate: '2026-10-01' }, now: '2026-09-20T00:00:00Z' });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, reason);
    assert.equal('stayWindow' in result, false);
  }
});

test('refuses expired policy and never turns unknown late arrival into a claim', () => {
  const result = buildHotelPropertyPolicyWindow({ policy: POLICY, actualOfficialDocumentEvidence: [document()], quotedLocalDates: { checkInDate: '2026-09-29', checkOutDate: '2026-10-01' }, now: '2027-01-01T00:00:00Z' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'expired_policy');
});
