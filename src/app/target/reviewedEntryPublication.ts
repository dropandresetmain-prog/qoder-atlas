/**
 * Publishes a reviewed, source-verified entry question through existing M5
 * commands. Call before capturing the planning basis: knowledge publication
 * must never be hidden inside evaluation of an older snapshot.
 *
 * Commands are individually durable and retryable. Coverage is written last,
 * so an interrupted prefix cannot claim that research is complete. Neither
 * publication nor complete coverage asserts that the traveller passes the
 * rule; the entry and credential evaluators still make that decision.
 */
import { z } from 'zod';
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { PgUnitOfWork } from '../../persistence/postgres/pgUnitOfWork.ts';
import { canonicalPayloadHash } from '../../persistence/postgres/canonicalHash.ts';
import {
  createRuleSet, recordEvidence, recordKnowledgeCoverage, recordRuleAssignment, recordSource,
} from '../../persistence/postgres/commands/knowledgeCommands.ts';
import { entryPredicateRegistry } from '../../resolution/evaluation/entryPredicates.ts';
import {
  verifyReviewedEntryEvidence, type VerifyReviewedEntryEvidenceInput,
} from '../../resolution/planning/reviewedEntryEvidence.ts';
import { deterministicUuid, RUNTIME_ID_NAMESPACES } from './deterministicId.ts';

export interface EntryPublicationDeps {
  pool: Pool;
  workspaceId: string;
  actorPrincipalId: string;
  /** The registered reviewer publishing the interpretation, not a fabricated foreign authority. */
  reviewerRef: { kind: 'ORGANISATION' | 'PRINCIPAL'; id: string };
  uow: () => PgUnitOfWork;
}

export type EntryPublicationResult =
  | { ok: true; evidenceId: string; ruleSetId: string; ruleSetVersionId: string; coverageId: string; expiresAt: string }
  | { ok: false; reason: string };

export async function publishReviewedEntryKnowledge(
  deps: EntryPublicationDeps,
  input: VerifyReviewedEntryEvidenceInput,
): Promise<EntryPublicationResult> {
  const verified = verifyReviewedEntryEvidence(input);
  if (!verified.ok) return { ok: false, reason: verified.reason };
  const { policy, scope, documents, expiresAt } = verified;
  if (![deps.workspaceId, deps.reviewerRef.id, scope.journeyId, scope.visitId, scope.jurisdictionId]
    .every((id) => z.uuid().safeParse(id).success)
    || !['ORGANISATION', 'PRINCIPAL'].includes(deps.reviewerRef.kind)
    || !deps.actorPrincipalId.trim()) return { ok: false, reason: 'invalid_publication_identity' };

  // A visit may still be a proposal. Its Journey, jurisdiction and reviewer
  // must already be real subjects of this workspace. Country-code resolution
  // is supplied by the authoritative context resolver, never a name heuristic.
  const subjects = await deps.pool.query<{ kind: string; id: string }>(
    `SELECT kind, id FROM domain_subjects WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
    [deps.workspaceId, [scope.journeyId, scope.jurisdictionId, deps.reviewerRef.id]],
  );
  const has = (kind: string, id: string) => subjects.rows.some((row) => row.kind === kind && row.id === id);
  if (!has('JOURNEY', scope.journeyId) || !has('JURISDICTION', scope.jurisdictionId)
    || !has(deps.reviewerRef.kind, deps.reviewerRef.id)) return { ok: false, reason: 'publication_scope_not_registered' };

  // Stable observations, policy, scope and reviewer define this publication.
  // Retrying later does not change its command payload or original timestamp.
  const publicationAt = documents.reduce((latest, document) =>
    Date.parse(document.observedAt) > Date.parse(latest) ? document.observedAt : latest, documents[0]!.observedAt);
  const digest = canonicalPayloadHash({ policy, scope, documents: documents.map(({ text: _text, ...metadata }) => metadata), reviewer: deps.reviewerRef });
  const id = (part: string) => deterministicUuid(RUNTIME_ID_NAMESPACES.planning, `${deps.workspaceId}|reviewed-entry|${digest}|${part}`);
  const context = (part: string) => ({
    workspaceId: deps.workspaceId, actorPrincipalId: deps.actorPrincipalId,
    idempotencyKey: `reviewed-entry:${digest}:${part}`,
  });
  const sourceIds: string[] = [];
  for (const [index, document] of documents.entries()) {
    const sourceId = id(`source:${index}`);
    const result = await recordSource(deps.uow(), {
      ...context(`source:${index}`), sourceId, sourceIdentity: document.url,
      receivedAt: document.observedAt, contentHash: document.contentSha256, contentType: 'text/plain',
      captureMetadata: { sourceId: document.sourceId, publisher: document.publisher, url: document.url,
        policyId: policy.id, sourceObservedAt: document.observedAt },
      captureMetadataVersion: 'reviewed-entry-source/1',
    });
    if (!result.ok) return { ok: false, reason: `source:${result.conflict.kind}` };
    sourceIds.push(sourceId);
  }
  const evidenceId = id('evidence');
  const evidence = await recordEvidence(deps.uow(), {
    ...context('evidence'), evidenceId, assertionType: 'REVIEWED_ENTRY_REQUIREMENTS',
    observedAt: publicationAt, schemaVersion: 'reviewed-entry/1', sourceIds,
    subjectRefs: [{ kind: 'JOURNEY', id: scope.journeyId }, { kind: 'JURISDICTION', id: scope.jurisdictionId }],
    interpretationProvenance: `Reviewed policy ${policy.id}; exact retrieved source content verified. Individual admission is not an observed outcome.`,
  });
  if (!evidence.ok) return { ok: false, reason: `evidence:${evidence.conflict.kind}` };

  const ruleSetId = id('rules');
  const ruleSetVersionId = id('edition');
  const rule = await createRuleSet(deps.uow(), {
    ...context('rules'), ruleSetId, versionId: ruleSetVersionId, issuerRef: deps.reviewerRef,
    policyFamily: 'entry', editionNumber: 1, status: 'PUBLISHED', effectiveWindow: policy.effectiveWindow,
    expression: policy.expression, publishedAt: publicationAt, publishedByActorId: deps.actorPrincipalId,
    predicateRegistry: entryPredicateRegistry,
  });
  if (!rule.ok) return { ok: false, reason: `rules:${rule.conflict.kind}` };
  const assignment = await recordRuleAssignment(deps.uow(), {
    ...context('assignment'), assignmentId: id('assignment'), ruleSetId, ruleSetVersionId,
    subjectRef: { kind: 'JOURNEY', id: scope.journeyId }, jurisdictionId: scope.jurisdictionId,
    validFrom: scope.visitWindow.start, validUntil: scope.visitWindow.end,
  });
  if (!assignment.ok) return { ok: false, reason: `assignment:${assignment.conflict.kind}` };
  const coverageId = id('coverage');
  const coverage = await recordKnowledgeCoverage(deps.uow(), {
    ...context('coverage'), coverageId, evidenceId, topic: 'ENTRY_REQUIREMENT', edition: policy.id,
    queryBoundsVersion: 'reviewed-entry-visit/1',
    queryBounds: { ...scope, ruleSetVersionId, policyId: policy.id },
    completeness: 'COMPLETE', completenessLimitations: [], expiresAt,
  });
  if (!coverage.ok) return { ok: false, reason: `coverage:${coverage.conflict.kind}` };
  return { ok: true, evidenceId, ruleSetId, ruleSetVersionId, coverageId, expiresAt };
}
