/**
 * M2 evidence — command-layer invariants provable without a database.
 *
 * The PostgreSQL suites (`postgres-integration/m2*.pgtest.ts`) prove what only a
 * real transaction can prove. This file proves the layer in front of it: a
 * rejected payload never reaches a transaction, protected document content
 * cannot be submitted as plain text, and the receipt/provenance values a
 * serializable retry recomputes are stable functions of the envelope.
 *
 * Every handler here is the exported one the product will call, driven with a
 * `UnitOfWork` that records and refuses every entry point, so "nothing was
 * opened" is an observation rather than an assumption.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { canonicalPayloadHash } from '../src/persistence/postgres/canonicalHash.ts';
import {
  buildReceipt,
  derivedCommandRef,
  lockedRevisionOf,
  missingHeadConflict,
  staleRevisionConflict,
} from '../src/persistence/postgres/commandSupport.ts';
import {
  appendCredentialVersion,
  assignResponsibility,
  issueAuthorityGrant,
  recordTraveller,
  recordTravellerRelationship,
  type RecordTravellerParams,
} from '../src/persistence/postgres/commands/peopleCommands.ts';
import {
  CommandReceiptSchema,
  DomainCommandEnvelopeSchema,
  parseCommandResult,
  serializeCommandResult,
} from '../src/contracts/v2/command/domainCommand.ts';
import type { UnitOfWork } from '../src/contracts/v2/command/unitOfWork.ts';
import type { ProtectedDataRef } from '../src/domain/v2/shared/identity.ts';
import type { TypedConflict, TypedResult } from '../src/domain/v2/shared/errors.ts';

const protectedRef: ProtectedDataRef = {
  contentHash: 'sha256:1f4c9b0a7d6e5f3b2a190817abcdef01',
  storageRef: 'vault://credentials/m2-unit/placeholder',
  accessPolicyId: 'policy:credential-vault-read',
};

/** Every handler is called with these; each test changes exactly one field. */
const context = { workspaceId: randomUUID(), actorPrincipalId: randomUUID(), idempotencyKey: randomUUID() };

const travellerId = randomUUID();
const credentialId = randomUUID();
const evidenceId = randomUUID();
const organisationId = randomUUID();

const validRecordTraveller = () => ({
  ...context,
  displayName: {
    nameKind: 'LEGAL' as const,
    displayValue: 'A. Traveller',
    familyName: 'Traveller',
    givenName: 'A',
    effectiveRange: { start: '1990-04-01' },
    evidenceId,
  },
});

const validAppendCredentialVersion = () => ({
  ...context,
  travellerId,
  credentialId,
  versionId: randomUUID(),
  kind: 'PASSPORT' as const,
  issuerCountry: 'NZ',
  issueDate: '2020-05-01',
  expiryDate: '2030-05-01',
  issuerStatus: 'VALID' as const,
  evidenceId,
  expectedRevision: 1,
});

const validRelationship = () => ({
  ...context,
  fromTravellerId: travellerId,
  toTravellerId: randomUUID(),
  relationshipType: 'PARENT_GUARDIAN' as const,
  effectiveRange: { start: '2015-01-01' },
  evidenceId,
});

const validResponsibility = () => ({
  ...context,
  organisationId,
  subjectRef: { kind: 'TRAVELLER' as const, id: travellerId },
  role: 'DUTY_OF_CARE' as const,
  effectiveRange: { start: '2024-01-01' },
});

const validGrant = () => ({
  ...context,
  principalId: randomUUID(),
  representedPartyRef: { kind: 'TRAVELLER' as const, id: travellerId },
  issuedByPrincipalId: context.actorPrincipalId,
  actions: ['TRIP_READ'],
  scopes: [{ kind: 'WORKSPACE' as const, id: context.workspaceId }],
  authorisingReceipt: { commandNamespace: 'AUTHORITY_GRANT_ISSUED', idempotencyKey: randomUUID() },
  expectedAggregateRevisions: [],
});

type Run = (uow: UnitOfWork) => Promise<TypedResult<unknown>>;

/**
 * A `UnitOfWork` that records what it was asked for and refuses it. Reaching any
 * member means a handler started transaction work for a payload validation
 * should have turned away.
 */
function refusal() {
  const reached: string[] = [];
  const refuse = (member: string): never => {
    reached.push(member);
    throw new Error(`command reached ${member} — validation must return before any transaction work`);
  };
  const uow: UnitOfWork = {
    heads: {
      loadHead: async (ref) => refuse(`heads.loadHead(${ref.kind})`),
      lockHeads: async (refs) => refuse(`heads.lockHeads(${refs.length})`),
    },
    idempotency: { claim: async () => refuse('idempotency.claim') },
    scopes: {
      currentGeneration: async (ref) => refuse(`scopes.currentGeneration(${ref.scopeKind})`),
      advance: async (ref) => refuse(`scopes.advance(${ref.scopeKind})`),
    },
    execute: async () => refuse('execute'),
  };

  async function assertRefused(label: string, run: Run): Promise<TypedConflict> {
    reached.length = 0;
    const outcome = await run(uow);
    assert.equal(outcome.ok, false, `${label}: expected a conflict`);
    if (outcome.ok) return assert.fail(`${label}: expected a conflict`);
    assert.equal(
      outcome.conflict.kind,
      'VALIDATION_FAILED',
      `${label}: expected VALIDATION_FAILED, got ${outcome.conflict.kind}`,
    );
    assert.deepEqual(reached, [], `${label}: validation reached ${reached.join(', ')} before returning`);
    return outcome.conflict;
  }

  async function assertReachesExecute(label: string, run: Run): Promise<void> {
    reached.length = 0;
    await assert.rejects(() => run(uow));
    assert.deepEqual(reached, ['execute'], `${label}: must reach execute, or the refusals prove nothing`);
  }

  return { assertRefused, assertReachesExecute };
}

// ---------------------------------------------------------------------------
// 1. Validation is fail-closed and happens before the transaction boundary
// ---------------------------------------------------------------------------

test('M2 unit: a well-formed people command does reach the UnitOfWork', async () => {
  const gate = refusal();
  await gate.assertReachesExecute('recordTraveller', (uow) => recordTraveller(uow, validRecordTraveller()));
  await gate.assertReachesExecute('appendCredentialVersion', (uow) =>
    appendCredentialVersion(uow, validAppendCredentialVersion()),
  );
  await gate.assertReachesExecute('recordTravellerRelationship', (uow) =>
    recordTravellerRelationship(uow, validRelationship()),
  );
  await gate.assertReachesExecute('assignResponsibility', (uow) => assignResponsibility(uow, validResponsibility()));
  await gate.assertReachesExecute('issueAuthorityGrant', (uow) => issueAuthorityGrant(uow, validGrant()));
});

test('M2 unit: a rejected traveller payload is a typed conflict with zero transaction work', async () => {
  const gate = refusal();
  const name = () => validRecordTraveller().displayName;

  await gate.assertRefused('unknown name kind', (uow) =>
    recordTraveller(uow, { ...validRecordTraveller(), displayName: { ...name(), nameKind: 'NICKNAME' as 'LEGAL' } }),
  );
  await gate.assertRefused('empty display value', (uow) =>
    recordTraveller(uow, { ...validRecordTraveller(), displayName: { ...name(), displayValue: '' } }),
  );
  await gate.assertRefused('non-UUID evidence reference', (uow) =>
    recordTraveller(uow, { ...validRecordTraveller(), displayName: { ...name(), evidenceId: 'evidence-1' } }),
  );

  const smuggled = { ...validRecordTraveller(), displayName: { ...name(), nickname: 'Fred' } };
  await gate.assertRefused('undeclared extra field', (uow) =>
    recordTraveller(uow, smuggled as RecordTravellerParams),
  );
});

test('M2 unit: relationships and responsibilities accept only the frozen vocabularies', async () => {
  const gate = refusal();

  await gate.assertRefused('relationship type outside the frozen four', (uow) =>
    recordTravellerRelationship(uow, {
      ...validRelationship(),
      relationshipType: 'GUARDIAN_WITH_AUTHORISATION' as 'PARENT_GUARDIAN',
    }),
  );
  await gate.assertRefused('responsibility role outside the frozen five', (uow) =>
    assignResponsibility(uow, { ...validResponsibility(), role: 'OWNER' as 'DUTY_OF_CARE' }),
  );
});

// ---------------------------------------------------------------------------
// 2. Credentials: content stays behind a protected reference
// ---------------------------------------------------------------------------

test('M2 unit: a credential edition cannot carry a raw document number', async () => {
  const gate = refusal();

  await gate.assertRefused('document number as plain text', (uow) =>
    appendCredentialVersion(uow, {
      ...validAppendCredentialVersion(),
      documentNumber: 'PA0123456' as unknown as ProtectedDataRef,
    }),
  );
  await gate.assertRefused('protected reference missing its access policy', (uow) =>
    appendCredentialVersion(uow, {
      ...validAppendCredentialVersion(),
      documentNumber: { contentHash: protectedRef.contentHash, storageRef: protectedRef.storageRef } as ProtectedDataRef,
    }),
  );
});

test('M2 unit: a credential edition rejects an unmappable or unencodable detail', async () => {
  const gate = refusal();

  await gate.assertRefused('detail kind contradicting the credential kind', (uow) =>
    appendCredentialVersion(uow, {
      ...validAppendCredentialVersion(),
      detail: { kind: 'VISA', documentNumber: protectedRef, visaClass: 'WORK' },
    }),
  );
  await gate.assertRefused('credential kind with no M2 typed table', (uow) =>
    appendCredentialVersion(uow, { ...validAppendCredentialVersion(), kind: 'DRIVING_LICENCE' as 'PASSPORT' }),
  );
  await gate.assertRefused('non-ISO expiry date', (uow) =>
    appendCredentialVersion(uow, { ...validAppendCredentialVersion(), expiryDate: '31/12/2030' }),
  );
  await gate.assertRefused('issuer country that is not a country code', (uow) =>
    appendCredentialVersion(uow, { ...validAppendCredentialVersion(), issuerCountry: 'NEW ZEALAND' }),
  );

  // Architecture gap G-P5: `passport_details` stores neither nationality nor
  // machine-readable facts, so the value is refused at the boundary instead of
  // being accepted and silently dropped on its way to the database.
  const gapMessage = await gate.assertRefused('passport facts the typed table cannot store', (uow) =>
    appendCredentialVersion(uow, {
      ...validAppendCredentialVersion(),
      detail: { kind: 'PASSPORT', documentNumber: protectedRef, nationalityCountry: 'NZ' },
    }),
  );
  assert.match(gapMessage.message, /G-P5/);
});

// ---------------------------------------------------------------------------
// 3. Authority needs a named authoriser; a typed ref needs a real subject id
// ---------------------------------------------------------------------------

test('M2 unit: an authority grant cannot be issued without its authorising receipt', async () => {
  const gate = refusal();

  await gate.assertRefused('no authorising receipt', (uow) => {
    const { authorisingReceipt: _omitted, ...rest } = validGrant();
    return issueAuthorityGrant(uow, rest as unknown as Parameters<typeof issueAuthorityGrant>[1]);
  });
  await gate.assertRefused('empty action set', (uow) =>
    issueAuthorityGrant(uow, { ...validGrant(), actions: [] }),
  );
  await gate.assertRefused('empty scope set', (uow) => issueAuthorityGrant(uow, { ...validGrant(), scopes: [] }),
  );
});

test('M2 unit: a TypedRef naming a non-UUID subject is refused before registration', async () => {
  const gate = refusal();

  await gate.assertRefused('responsibility subject is a legacy text id', (uow) =>
    assignResponsibility(uow, { ...validResponsibility(), subjectRef: { kind: 'TRAVELLER', id: 'traveller-legacy-7' } }),
  );
  await gate.assertRefused('grant scope is a legacy text id', (uow) =>
    issueAuthorityGrant(uow, { ...validGrant(), scopes: [{ kind: 'WORKSPACE', id: 'workspace-legacy-1' }] }),
  );
});

// ---------------------------------------------------------------------------
// 4. Idempotency, replay and provenance are pure functions of the envelope
// ---------------------------------------------------------------------------

test('M2 unit: the canonical payload hash ignores key order and keeps value order', () => {
  const a = canonicalPayloadHash({ kind: 'PASSPORT', detail: { documentNumber: protectedRef, serial: 3 } });
  const b = canonicalPayloadHash({ detail: { serial: 3, documentNumber: protectedRef }, kind: 'PASSPORT' });
  assert.equal(a, b, 'semantically identical payloads must hash identically or replay misfires');

  assert.notEqual(
    canonicalPayloadHash({ scopes: ['A', 'B'] }),
    canonicalPayloadHash({ scopes: ['B', 'A'] }),
    'array order is meaning-bearing',
  );
  assert.notEqual(a, canonicalPayloadHash({ kind: 'VISA', detail: { documentNumber: protectedRef, serial: 3 } }));
});

function envelopeFor(overrides: {
  commandType?: string;
  workspaceId?: string;
  idempotencyKey?: string;
}) {
  return DomainCommandEnvelopeSchema.parse({
    commandType: overrides.commandType ?? 'CREDENTIAL_VERSION_APPENDED',
    schemaVersion: '1',
    workspaceId: overrides.workspaceId ?? context.workspaceId,
    actorPrincipalId: context.actorPrincipalId,
    idempotencyKey: overrides.idempotencyKey ?? context.idempotencyKey,
    canonicalPayloadHash: canonicalPayloadHash({ credentialId }),
    expectedAggregateRevisions: [{ aggregateRef: { kind: 'TRAVELLER', id: travellerId }, expectedRevision: 1 }],
    expectedScopeGenerations: [],
    evidenceRefs: [evidenceId],
    typedPayload: { credentialId },
  });
}

test('M2 unit: provenance and receipt values a retry recomputes are stable', () => {
  const envelope = envelopeFor({});
  const advanced = [
    { aggregateRef: { kind: 'TRAVELLER' as const, id: travellerId }, beforeRevision: 1, afterRevision: 2 },
    {
      aggregateRef: { kind: 'AUTHORITY_GRANT' as const, id: credentialId },
      beforeRevision: null,
      afterRevision: 1,
    },
  ];
  const value = { travellerId, credentialId, versionId: randomUUID(), editionNumber: 2, revision: 2 };

  const receipt = buildReceipt({ envelope, value, advanced, committedAt: '2026-09-14T00:00:00.000Z' });
  CommandReceiptSchema.parse(receipt);
  assert.deepEqual(
    receipt.committedRevisions.map((entry) => entry.expectedRevision),
    [2, 1],
    'the receipt must publish the post-commit revision of every root the command moved',
  );
  assert.deepEqual(parseCommandResult(receipt.resultRef), value, 'replay decodes the committed result itself');

  assert.equal(derivedCommandRef(envelope), derivedCommandRef(envelopeFor({})), 'a retry derives the same command ref');
  for (const [label, overrides] of [
    ['a different idempotency key', { idempotencyKey: randomUUID() }],
    ['a different workspace', { workspaceId: randomUUID() }],
    ['a different command type', { commandType: 'TRAVELLER_RECORDED' }],
  ] as const) {
    assert.notEqual(derivedCommandRef(envelope), derivedCommandRef(envelopeFor(overrides)), label);
  }
});

test('M2 unit: an unreplayable command result is refused rather than stored', () => {
  assert.throws(() => serializeCommandResult(undefined), /JSON-compatible/);

  const opaque = CommandReceiptSchema.safeParse({
    workspaceId: context.workspaceId,
    commandNamespace: 'CREDENTIAL_VERSION_APPENDED',
    idempotencyKey: context.idempotencyKey,
    payloadHash: canonicalPayloadHash({}),
    resultRef: 'traveller/12',
    committedRevisions: [],
    committedAt: '2026-09-14T00:00:00.000Z',
  });
  assert.equal(opaque.success, false, 'resultRef must be the JSON result, never an opaque pointer');
});

// ---------------------------------------------------------------------------
// 5. Compare-and-set failures use the frozen conflict vocabulary
// ---------------------------------------------------------------------------

test('M2 unit: a lost CAS race and a missing head are the same typed conflict kind', () => {
  const ref = { kind: 'TRAVELLER' as const, id: travellerId };
  const stale = staleRevisionConflict(ref, 4);
  const missing = missingHeadConflict(ref);

  assert.equal(stale.kind, 'STALE_AGGREGATE_REVISION');
  assert.equal(missing.kind, 'STALE_AGGREGATE_REVISION');
  assert.match(stale.message, new RegExp(`TRAVELLER:${travellerId} at revision 4`));
  assert.deepEqual(stale.subjectRefs, [ref], 'the conflict must name the aggregate the caller can re-read');
  assert.deepEqual(missing.subjectRefs, [ref]);
});

test('M2 unit: the locked revision is read by aggregate identity, not by position', () => {
  const lockedHeads = [
    { aggregateRef: { kind: 'TRIP' as const, id: randomUUID() }, revision: 9 },
    { aggregateRef: { kind: 'TRAVELLER' as const, id: travellerId }, revision: 3 },
  ];
  assert.equal(lockedRevisionOf(lockedHeads, travellerId), 3);
  assert.equal(lockedRevisionOf(lockedHeads, randomUUID()), undefined);
});
