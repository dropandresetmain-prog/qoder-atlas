/**
 * Reviewed, property-level hotel policy evidence.
 *
 * This is a read-only evidence seam. It turns a reviewed local check-in and
 * check-out policy into offset-bearing instants only while the exact official
 * source observations are present, fresh, and unchanged. It does not assert
 * that a particular rate or booking will honour the general property policy.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { OfficialDocumentEvidence } from '../../providers/research/officialDocuments.ts';
import { normalizeExtractedTemporal } from '../../ingest/temporal.ts';
import {
  DateIntervalSchema,
  InstantIntervalSchema,
  InstantSchema,
  IanaTimeZoneSchema,
  type Instant,
} from '../../domain/v2/shared/time.ts';

const SHA256 = /^[a-f0-9]{64}$/;
const HH_MM = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

const sourceRefSchema = z.strictObject({
  sourceId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  url: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  }, 'source URL must be HTTPS without credentials or fragment'),
  publisher: z.string().trim().min(1).max(256),
  contentSha256: z.string().regex(SHA256),
});

const sourcePlaceAliasSchema = z.strictObject({
  system: z.string().trim().min(1).max(128),
  value: z.string().trim().min(1).max(256),
});

/** A reviewed property standard, not a rate-specific reservation guarantee. */
export const HotelPropertyPolicySchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  canonicalPlaceId: z.string().trim().min(1).max(256),
  sourcePlaceAliases: z.array(sourcePlaceAliasSchema).min(1).max(16),
  timeZone: IanaTimeZoneSchema,
  standardCheckIn: z.string().regex(HH_MM),
  standardCheckOut: z.string().regex(HH_MM),
  lateArrivalSupported: z.boolean().nullable(),
  effectiveWindow: DateIntervalSchema,
  maxEvidenceAgeSeconds: z.number().int().positive().max(86_400),
  sources: z.array(sourceRefSchema).min(1).max(16),
  note: z.string().trim().min(1).max(1024),
}).superRefine((policy, context) => {
  const sourceIds = new Set<string>();
  for (const [index, source] of policy.sources.entries()) {
    if (sourceIds.has(source.sourceId)) {
      context.addIssue({ code: 'custom', path: ['sources', index, 'sourceId'], message: `duplicate source id ${source.sourceId}` });
    }
    sourceIds.add(source.sourceId);
  }
});

export type HotelPropertyPolicy = z.infer<typeof HotelPropertyPolicySchema>;

export interface HotelPolicySourceProvenance {
  sourceId: string;
  publisher: string;
  url: string;
  observedAt: string;
  contentSha256: string;
}

export type HotelPropertyPolicyRefusalReason =
  | 'invalid_policy'
  | 'invalid_now'
  | 'invalid_quoted_dates'
  | 'policy_not_yet_effective'
  | 'expired_policy'
  | 'duplicate_source_evidence'
  | 'missing_source_evidence'
  | 'source_provenance_mismatch'
  | 'future_source_evidence'
  | 'stale_source_evidence'
  | 'invalid_local_window';

export interface RefusedHotelPropertyPolicyWindow {
  ok: false;
  status: 'UNKNOWN';
  reason: HotelPropertyPolicyRefusalReason;
  policyId?: string;
  canonicalPlaceId?: string;
}

export interface VerifiedHotelPropertyPolicyWindow {
  ok: true;
  status: 'KNOWN';
  policy: HotelPropertyPolicy;
  quotedLocalDates: { checkInDate: string; checkOutDate: string };
  localCheckIn: string;
  localCheckOut: string;
  stayWindow: { start: Instant; end: Instant };
  /** null is intentional: the reviewed source did not establish this fact. */
  lateArrivalSupported: boolean | null;
  sourceProvenance: readonly HotelPolicySourceProvenance[];
}

export type HotelPropertyPolicyWindow =
  | RefusedHotelPropertyPolicyWindow
  | VerifiedHotelPropertyPolicyWindow;

export interface BuildHotelPropertyPolicyWindowInput {
  /** Parsed and reviewed policy data, commonly loaded from the dataset JSON. */
  policy: unknown;
  actualOfficialDocumentEvidence: readonly OfficialDocumentEvidence[];
  quotedLocalDates: { checkInDate: unknown; checkOutDate: unknown };
  now: string;
}

function refusal(reason: HotelPropertyPolicyRefusalReason, policy?: Partial<HotelPropertyPolicy>): RefusedHotelPropertyPolicyWindow {
  return {
    ok: false,
    status: 'UNKNOWN',
    reason,
    ...(policy?.id ? { policyId: policy.id } : {}),
    ...(policy?.canonicalPlaceId ? { canonicalPlaceId: policy.canonicalPlaceId } : {}),
  };
}

function sourceProvenance(document: OfficialDocumentEvidence): HotelPolicySourceProvenance {
  return {
    sourceId: document.sourceId,
    publisher: document.publisher,
    url: document.url,
    observedAt: document.observedAt,
    contentSha256: document.contentSha256,
  };
}

function clonePolicy(policy: HotelPropertyPolicy): HotelPropertyPolicy {
  return {
    ...policy,
    sourcePlaceAliases: policy.sourcePlaceAliases.map((alias) => ({ ...alias })),
    effectiveWindow: { ...policy.effectiveWindow },
    sources: policy.sources.map((source) => ({ ...source })),
  };
}

/**
 * Verify reviewed source evidence and build a quoted local-date stay window.
 * Any uncertainty returns UNKNOWN without a fabricated interval.
 */
export function buildHotelPropertyPolicyWindow(
  input: BuildHotelPropertyPolicyWindowInput,
): HotelPropertyPolicyWindow {
  const policyResult = HotelPropertyPolicySchema.safeParse(input.policy);
  const policyCandidate = input.policy && typeof input.policy === 'object' ? input.policy as Partial<HotelPropertyPolicy> : undefined;
  if (!policyResult.success) return refusal('invalid_policy', policyCandidate);
  const policy = policyResult.data;

  const nowResult = InstantSchema.safeParse(input.now);
  if (!nowResult.success) return refusal('invalid_now', policy);
  const nowMs = Date.parse(nowResult.data);

  const checkInResult = z.iso.date().safeParse(input.quotedLocalDates.checkInDate);
  const checkOutResult = z.iso.date().safeParse(input.quotedLocalDates.checkOutDate);
  if (!checkInResult.success || !checkOutResult.success) return refusal('invalid_quoted_dates', policy);
  const quotedLocalDates = { checkInDate: checkInResult.data, checkOutDate: checkOutResult.data };
  if (quotedLocalDates.checkInDate >= quotedLocalDates.checkOutDate) return refusal('invalid_quoted_dates', policy);

  const effectiveStartMs = Date.parse(`${policy.effectiveWindow.start}T00:00:00Z`);
  if (Number.isNaN(effectiveStartMs) || nowMs < effectiveStartMs) return refusal('policy_not_yet_effective', policy);
  if (policy.effectiveWindow.end) {
    const effectiveEndMs = Date.parse(`${policy.effectiveWindow.end}T00:00:00Z`);
    if (Number.isNaN(effectiveEndMs) || nowMs >= effectiveEndMs) return refusal('expired_policy', policy);
    if (quotedLocalDates.checkInDate < policy.effectiveWindow.start || quotedLocalDates.checkOutDate > policy.effectiveWindow.end) {
      return refusal('expired_policy', policy);
    }
  } else if (quotedLocalDates.checkInDate < policy.effectiveWindow.start) {
    return refusal('expired_policy', policy);
  }

  const documents = input.actualOfficialDocumentEvidence;
  const seen = new Set<string>();
  for (const document of documents) {
    if (seen.has(document.sourceId)) return refusal('duplicate_source_evidence', policy);
    seen.add(document.sourceId);
  }
  const now = Date.parse(nowResult.data);
  const reviewedDocuments: OfficialDocumentEvidence[] = [];
  for (const source of policy.sources) {
    const matches = documents.filter((document) => document.sourceId === source.sourceId);
    if (matches.length === 0) return refusal('missing_source_evidence', policy);
    const document = matches[0]!;
    if (document.url !== source.url || document.publisher !== source.publisher || document.contentSha256 !== source.contentSha256
      || createHash('sha256').update(document.text, 'utf8').digest('hex') !== document.contentSha256) {
      return refusal('source_provenance_mismatch', policy);
    }
    const observed = Date.parse(document.observedAt);
    if (Number.isNaN(observed) || observed > now) return refusal('future_source_evidence', policy);
    if (observed + policy.maxEvidenceAgeSeconds * 1000 <= now) return refusal('stale_source_evidence', policy);
    reviewedDocuments.push(document);
  }

  const localCheckIn = `${quotedLocalDates.checkInDate}T${policy.standardCheckIn}:00`;
  const localCheckOut = `${quotedLocalDates.checkOutDate}T${policy.standardCheckOut}:00`;
  const start = normalizeExtractedTemporal(localCheckIn, policy.timeZone);
  const end = normalizeExtractedTemporal(localCheckOut, policy.timeZone);
  const interval = start && end ? InstantIntervalSchema.safeParse({ start, end }) : undefined;
  if (!interval?.success) return refusal('invalid_local_window', policy);

  return {
    ok: true,
    status: 'KNOWN',
    policy: clonePolicy(policy),
    quotedLocalDates,
    localCheckIn,
    localCheckOut,
    stayWindow: interval.data,
    lateArrivalSupported: policy.lateArrivalSupported,
    sourceProvenance: reviewedDocuments.map(sourceProvenance),
  };
}
