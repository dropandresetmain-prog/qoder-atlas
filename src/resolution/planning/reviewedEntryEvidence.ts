/**
 * A reviewed entry-policy artifact may consume official-document evidence only
 * when the retrieved documents are the exact reviewed sources and are still
 * fresh for the bounded policy window. This module proves provenance and
 * scope; it never publishes coverage or decides legal feasibility.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { SubjectIdSchema } from '../../domain/v2/shared/identity.ts';
import {
  InstantIntervalSchema,
  InstantSchema,
  compareInstants,
  type Instant,
  type InstantInterval,
} from '../../domain/v2/shared/time.ts';
import {
  RuleExpressionSchema,
  validateRuleExpression,
} from '../../domain/v2/knowledge/information.ts';
import { entryPredicateRegistry } from '../evaluation/entryPredicates.ts';
import type { OfficialDocumentEvidence } from '../../providers/research/officialDocuments.ts';

const MAX_LIST_ITEMS = 32;
const ISO2 = /^[A-Z]{2}$/;
const SHA256 = /^[a-f0-9]{64}$/;

const reviewedHttpsUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
}, 'source URL must be HTTPS without credentials or fragment');

const sourceSchema = z.strictObject({
  sourceId: SubjectIdSchema,
  url: reviewedHttpsUrl,
  publisher: z.string().trim().min(1).max(256),
  contentSha256: z.string().regex(SHA256),
});

const purposesSchema = z.array(z.string().trim().min(1).max(128)).min(1).max(MAX_LIST_ITEMS);
const nationalityCodesSchema = z.array(z.string().regex(ISO2)).min(1).max(MAX_LIST_ITEMS);

/** A reviewed policy artifact whose expression is executable by the entry library. */
export const ReviewedEntryPolicySchema = z
  .strictObject({
    id: SubjectIdSchema,
    countryCode: z.string().regex(ISO2),
    purposes: purposesSchema,
    nationalityCodes: nationalityCodesSchema,
    effectiveWindow: InstantIntervalSchema,
    maxEvidenceAgeSeconds: z.number().int().positive().max(86_400),
    sources: z.array(sourceSchema).min(1).max(MAX_LIST_ITEMS),
    expression: RuleExpressionSchema,
  })
  .superRefine((policy, context) => {
    const sourceIds = new Set<string>();
    for (const [index, source] of policy.sources.entries()) {
      if (sourceIds.has(source.sourceId)) {
        context.addIssue({
          code: 'custom',
          path: ['sources', index, 'sourceId'],
          message: `duplicate policy source id ${source.sourceId}`,
        });
      }
      sourceIds.add(source.sourceId);
    }
    const expression = validateRuleExpression(policy.expression, entryPredicateRegistry);
    if (!expression.ok) {
      for (const issue of expression.issues) {
        context.addIssue({ code: 'custom', path: ['expression'], message: issue });
      }
    }
  });
export type ReviewedEntryPolicy = z.infer<typeof ReviewedEntryPolicySchema>;

/** Caller-captured scope. The downstream evaluator still owns legal evaluation. */
export const ReviewedEntryEvidenceContextSchema = z.strictObject({
  journeyId: SubjectIdSchema,
  visitId: SubjectIdSchema,
  jurisdictionId: SubjectIdSchema,
  countryCode: z.string().regex(ISO2),
  purpose: z.string().trim().min(1).max(128),
  nationalityCode: z.string().regex(ISO2),
  visitWindow: InstantIntervalSchema,
});
export type ReviewedEntryEvidenceContext = z.infer<typeof ReviewedEntryEvidenceContextSchema>;

const officialDocumentEvidenceSchema = z.strictObject({
  sourceId: SubjectIdSchema,
  publisher: z.string().trim().min(1).max(256),
  url: reviewedHttpsUrl,
  observedAt: InstantSchema,
  contentSha256: z.string().regex(SHA256),
  text: z.string().min(1).max(1_048_576),
});

export type ReviewedEntryEvidenceFailureReason =
  | 'invalid_policy'
  | 'duplicate_policy_source'
  | 'unsupported_predicate'
  | 'invalid_context'
  | 'invalid_now'
  | 'expired_policy'
  | 'scope_mismatch'
  | 'invalid_document_evidence'
  | 'missing_source_evidence'
  | 'duplicate_source_evidence'
  | 'source_provenance_mismatch'
  | 'future_source_evidence'
  | 'stale_source_evidence';

export interface VerifiedReviewedEntryEvidence {
  ok: true;
  policy: ReviewedEntryPolicy;
  scope: ReviewedEntryEvidenceContext;
  documents: readonly OfficialDocumentEvidence[];
  expiresAt: Instant;
}

export interface RefusedReviewedEntryEvidence {
  ok: false;
  reason: ReviewedEntryEvidenceFailureReason;
}

export type ReviewedEntryEvidenceVerification =
  | VerifiedReviewedEntryEvidence
  | RefusedReviewedEntryEvidence;

export interface VerifyReviewedEntryEvidenceInput {
  policy: ReviewedEntryPolicy;
  actualOfficialDocumentEvidence: readonly OfficialDocumentEvidence[];
  now: Instant;
  context: ReviewedEntryEvidenceContext;
}

function failure(reason: ReviewedEntryEvidenceFailureReason): RefusedReviewedEntryEvidence {
  return { ok: false, reason };
}

function policyFailure(issues: readonly string[]): RefusedReviewedEntryEvidence {
  if (issues.some((issue) => issue.includes('duplicate policy source id'))) {
    return failure('duplicate_policy_source');
  }
  if (issues.some((issue) => issue.includes('predicate '))) {
    return failure('unsupported_predicate');
  }
  return failure('invalid_policy');
}

function cloneDocument(document: OfficialDocumentEvidence): OfficialDocumentEvidence {
  return {
    sourceId: document.sourceId,
    publisher: document.publisher,
    url: document.url,
    observedAt: document.observedAt,
    contentSha256: document.contentSha256,
    text: document.text,
  };
}

function clonePolicy(policy: ReviewedEntryPolicy): ReviewedEntryPolicy {
  return {
    ...policy,
    purposes: [...policy.purposes],
    nationalityCodes: [...policy.nationalityCodes],
    effectiveWindow: { ...policy.effectiveWindow },
    sources: policy.sources.map((source) => ({ ...source })),
    expression: structuredClone(policy.expression),
  };
}

function cloneContext(context: ReviewedEntryEvidenceContext): ReviewedEntryEvidenceContext {
  return { ...context, visitWindow: { ...context.visitWindow } };
}

function withinWindow(inner: InstantInterval, outer: InstantInterval): boolean {
  return compareInstants(inner.start, outer.start) >= 0
    && compareInstants(inner.end, outer.end) <= 0;
}

function expiresAt(policy: ReviewedEntryPolicy, documents: readonly OfficialDocumentEvidence[]): Instant {
  const policyEnd = Date.parse(policy.effectiveWindow.end);
  const evidenceEnds = documents.map((document) => Date.parse(document.observedAt) + policy.maxEvidenceAgeSeconds * 1000);
  const end = Math.min(policyEnd, ...evidenceEnds);
  return new Date(end).toISOString() as Instant;
}

/**
 * Verify that current official-document observations can support one reviewed
 * entry-policy artifact for one caller-captured visit scope. Refusal means the
 * evidence is unknown; it is never a legal ineligibility verdict.
 */
export function verifyReviewedEntryEvidence(
  input: VerifyReviewedEntryEvidenceInput,
): ReviewedEntryEvidenceVerification {
  let policyResult: ReturnType<typeof ReviewedEntryPolicySchema.safeParse>;
  try {
    policyResult = ReviewedEntryPolicySchema.safeParse(input.policy);
  } catch {
    return failure('invalid_policy');
  }
  if (!policyResult.success) return policyFailure(policyResult.error.issues.map((issue) => issue.message));

  const nowResult = InstantSchema.safeParse(input.now);
  if (!nowResult.success) return failure('invalid_now');
  let contextResult: ReturnType<typeof ReviewedEntryEvidenceContextSchema.safeParse>;
  try {
    contextResult = ReviewedEntryEvidenceContextSchema.safeParse(input.context);
  } catch {
    return failure('invalid_context');
  }
  if (!contextResult.success) return failure('invalid_context');
  const documentsResult = z.array(officialDocumentEvidenceSchema).max(MAX_LIST_ITEMS).safeParse(input.actualOfficialDocumentEvidence);
  if (!documentsResult.success) return failure('invalid_document_evidence');

  const policy = policyResult.data;
  const context = contextResult.data;
  const documents = documentsResult.data;
  if (Date.parse(nowResult.data) >= Date.parse(policy.effectiveWindow.end)) {
    return failure('expired_policy');
  }
  if (
    policy.countryCode !== context.countryCode
    || !policy.purposes.includes(context.purpose)
    || !policy.nationalityCodes.includes(context.nationalityCode)
    || !withinWindow(context.visitWindow, policy.effectiveWindow)
  ) {
    return failure('scope_mismatch');
  }

  const seenDocumentIds = new Set<string>();
  for (const document of documents) {
    if (seenDocumentIds.has(document.sourceId)) return failure('duplicate_source_evidence');
    seenDocumentIds.add(document.sourceId);
  }
  for (const source of policy.sources) {
    const matches = documents.filter((document) => document.sourceId === source.sourceId);
    if (matches.length === 0) return failure('missing_source_evidence');
    if (matches.length !== 1) return failure('duplicate_source_evidence');
    const document = matches[0]!;
    const actualHash = createHash('sha256').update(document.text, 'utf8').digest('hex');
    if (document.url !== source.url || document.publisher !== source.publisher
      || document.contentSha256 !== source.contentSha256 || actualHash !== document.contentSha256) {
      return failure('source_provenance_mismatch');
    }
    const observed = Date.parse(document.observedAt);
    const now = Date.parse(nowResult.data);
    if (observed > now) return failure('future_source_evidence');
    if (observed + policy.maxEvidenceAgeSeconds * 1000 <= now) return failure('stale_source_evidence');
  }

  // Extra observations are harmless, but never become part of the verified
  // result. Only the exact reviewed source set is returned to the caller.
  const reviewedDocuments = policy.sources.map((source) => cloneDocument(
    documents.find((document) => document.sourceId === source.sourceId)!,
  ));
  return {
    ok: true,
    policy: clonePolicy(policy),
    scope: cloneContext(context),
    documents: reviewedDocuments,
    expiresAt: expiresAt(policy, reviewedDocuments),
  };
}
