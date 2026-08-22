/**
 * B1 — source materialization and provenance.
 *
 * Every ingested input becomes a persisted SourceRecord (identity, kind,
 * authority, retrieval time) with raw content stored separately — raw
 * material never enters authoritative trip state. Authority is derived
 * deterministically from source kind; ingestion never invents certainty
 * beyond what the source kind justifies.
 */
import { z } from 'zod';
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  SourceKindSchema,
  SourceRecordSchema,
  type FactAuthority,
  type IsoDateTime,
  type SourceKind,
  type SourceRecord,
} from '../domain/common.ts';
import type { SourceInput } from '../contracts/capabilities.ts';
import type { SourceRepository } from '../contracts/repositories.ts';
import { hashId } from './ids.ts';

/** Runtime validation of the frozen SourceInput seam (it is a TS interface). */
export const SourceInputSchema = z.strictObject({
  sourceId: EntityIdSchema.optional(),
  kind: SourceKindSchema,
  title: z.string().optional(),
  uri: z.string().optional(),
  content: z.string().optional(),
  structured: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Generic authority ladder mapping for source kinds. Policy/insurance
 * documents are authoritative for the rules they contain; confirmations and
 * provider state come from connected systems; everything else is asserted
 * content whose claims stay gated by downstream validation.
 */
export const SOURCE_AUTHORITY_BY_KIND: Record<SourceKind, FactAuthority> = {
  WEBPAGE: 'ASSERTED',
  EMAIL: 'ASSERTED',
  DOCUMENT: 'ASSERTED',
  BOOKING_CONFIRMATION: 'CONNECTED',
  POLICY_DOCUMENT: 'AUTHORITATIVE',
  INSURANCE_DOCUMENT: 'AUTHORITATIVE',
  PROFILE: 'ASSERTED',
  PROVIDER_STATE: 'CONNECTED',
  RESEARCH: 'ASSERTED',
  MANUAL: 'ASSERTED',
};

/** Optional binding of ingested artifacts to existing entities. */
export const IngestionContextSchema = z.strictObject({
  tripId: EntityIdSchema.optional(),
  travellerId: EntityIdSchema.optional(),
  organisationId: EntityIdSchema.optional(),
  anchorEventId: EntityIdSchema.optional(),
});
export type IngestionContext = z.infer<typeof IngestionContextSchema>;

export type Clock = () => IsoDateTime;

export const systemClock: Clock = () => new Date().toISOString() as IsoDateTime;

export interface MaterializedSource {
  record: SourceRecord;
  /** Raw evidence, kept outside trip state. */
  content?: string;
  reused: boolean;
}

export interface SourceStore {
  repository?: SourceRepository;
  clock?: Clock;
}

/** Observed/fetched timestamp support where the input carries one. */
function observedAtHint(structured: Record<string, unknown> | undefined): IsoDateTime | undefined {
  if (!structured) return undefined;
  const candidate = structured['observedAt'];
  if (typeof candidate !== 'string') return undefined;
  const parsed = IsoDateTimeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Resolve the SourceRecord for an input: reuse an existing record by id when
 * available, otherwise create one with deterministic identity. Raw content is
 * persisted alongside, never inside trip state.
 */
export async function materializeSource(
  input: SourceInput,
  store: SourceStore = {},
): Promise<MaterializedSource> {
  const now = (store.clock ?? systemClock)();

  if (input.sourceId && store.repository) {
    const existing = await store.repository.getSource(input.sourceId);
    if (existing) {
      if (input.content) {
        await store.repository.saveSourceContent(existing.id, input.content);
      }
      return { record: existing, content: input.content, reused: true };
    }
  }

  const content =
    input.content ??
    (input.structured !== undefined ? JSON.stringify(input.structured) : undefined);

  const record = SourceRecordSchema.parse({
    id:
      input.sourceId ??
      hashId('src', input.kind, input.uri ?? '', input.title ?? '', content ?? ''),
    kind: input.kind,
    ...(input.title ? { title: input.title } : {}),
    ...(input.uri ? { uri: input.uri } : {}),
    authority: SOURCE_AUTHORITY_BY_KIND[input.kind],
    retrievedAt: observedAtHint(input.structured) ?? now,
  });

  if (store.repository) {
    await store.repository.saveSource(record);
    if (content) {
      await store.repository.saveSourceContent(record.id, content);
    }
  }

  return { record, content, reused: false };
}
