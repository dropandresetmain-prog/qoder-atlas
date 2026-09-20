/**
 * Retrieves configured publisher documents as evidence, never as a legal verdict.
 * Callers select a catalog ID, so a model cannot supply an arbitrary fetch URL.
 * LIVE and replay share normalization and preserve the original observation time.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AdapterMode, CapabilityResult, ProviderAdapter } from '../../contracts/envelope.ts';
import { capabilityError } from '../../contracts/envelope.ts';
import type { RecordingStore } from '../recordingStore.ts';
import { capabilityFailure, runAdapter } from '../runner.ts';
import { sanitizeRaw } from '../sanitize.ts';

const MAX_BYTES = 1_048_576;
const PROVIDER = 'official-documents';
const sourceSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  url: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  }, 'publisher URL must be HTTPS without credentials or fragment'),
  publisher: z.string().trim().min(1).max(256),
});

export const OfficialDocumentCatalogSchema = z.array(sourceSchema).min(1).max(32)
  .refine((sources) => new Set(sources.map((source) => source.id)).size === sources.length, 'duplicate source ID');
export type OfficialDocumentSource = z.infer<typeof sourceSchema>;

const rawSchema = z.strictObject({
  url: z.url(),
  contentType: z.enum(['text/html', 'text/plain']),
  body: z.string().min(1).max(MAX_BYTES),
  observedAt: z.iso.datetime({ offset: true }),
});
type RawDocument = z.infer<typeof rawSchema>;

export interface OfficialDocumentEvidence {
  sourceId: string;
  publisher: string;
  url: string;
  observedAt: string;
  /** Hash of the returned readable evidence text, identical across live and replay. */
  contentSha256: string;
  text: string;
}

/** Plain evidence text only; never interpret page scripts or render remote HTML. */
function readableText(raw: RawDocument): string {
  if (raw.contentType === 'text/plain') return raw.body.trim();
  return raw.body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_match, code: string) => {
      const point = code.toLowerCase().startsWith('x') ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : ' ';
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_match, name: string) =>
      ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[name] ?? ' ')
    .replace(/\s+/g, ' ').trim();
}

async function boundedBody(response: Response): Promise<string> {
  if (!response.body) throw capabilityFailure('PROVIDER_ERROR', 'document_empty', 'Publisher returned no document');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel();
        throw capabilityFailure('PROVIDER_ERROR', 'document_too_large', 'Publisher document exceeds the evidence size limit');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

export interface OfficialDocumentReaderOptions {
    catalog: readonly OfficialDocumentSource[];
    mode: AdapterMode;
    store: RecordingStore;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}

export class OfficialDocumentReader {
  private readonly sources: ReadonlyMap<string, OfficialDocumentSource>;
  private readonly options: OfficialDocumentReaderOptions;
  constructor(options: OfficialDocumentReaderOptions) {
    this.options = options;
    this.sources = new Map(OfficialDocumentCatalogSchema.parse(options.catalog).map((source) => [source.id, source]));
    if (options.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 60_000)) {
      throw new Error('document timeout must be between 1 and 60000 milliseconds');
    }
  }

  async read(sourceId: string): Promise<CapabilityResult<OfficialDocumentEvidence>> {
    const source = this.sources.get(sourceId);
    if (!source) return capabilityError({ category: 'UNAVAILABLE', code: 'document_source_not_configured', message: 'Requested publisher source is not configured' }, {
      providerId: PROVIDER, mode: this.options.mode, requestedAt: new Date().toISOString(),
    });
    const adapter: ProviderAdapter<OfficialDocumentSource, RawDocument, OfficialDocumentEvidence> = {
      providerId: PROVIDER,
      mode: this.options.mode,
      obtainRaw: async (request) => {
        const response = await (this.options.fetchImpl ?? fetch)(request.url, {
          redirect: 'manual',
          headers: { Accept: 'text/html, text/plain' },
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 15_000),
        });
        // A redirect needs an explicitly reviewed catalog change. Never follow
        // it to an unconfigured publisher or accept an error page as evidence.
        if (!response.ok) {
          await response.body?.cancel();
          throw capabilityFailure('PROVIDER_ERROR', 'document_http_error', `Publisher document returned HTTP ${response.status}`, response.status >= 500);
        }
        const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
        if (contentType !== 'text/html' && contentType !== 'text/plain') {
          await response.body?.cancel();
          throw capabilityFailure('UNAVAILABLE', 'document_content_unsupported', 'Publisher document is not supported text or HTML');
        }
        // Public pages can include contact details. Sanitize before both live
        // normalization and recording so replay cannot silently change its hash.
        const body = sanitizeRaw(await boundedBody(response)) as string;
        return { url: request.url, contentType, body, observedAt: new Date().toISOString() };
      },
      normalize: (input) => {
        const raw = rawSchema.parse(input);
        if (raw.url !== source.url || Buffer.byteLength(raw.body, 'utf8') > MAX_BYTES) throw new Error('Document does not match the configured source or size limit');
        const text = readableText(raw);
        if (!text) throw new Error('Publisher document has no readable evidence');
        return { sourceId: source.id, publisher: source.publisher, url: raw.url, observedAt: raw.observedAt,
          contentSha256: createHash('sha256').update(text, 'utf8').digest('hex'), text };
      },
    };
    return runAdapter(adapter, this.options.store, source, { operation: 'document.read' });
  }
}
