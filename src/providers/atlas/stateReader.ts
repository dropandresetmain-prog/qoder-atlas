/**
 * DR-3 reconciliation — Atlas provider flight-state read adapter.
 *
 * An unauthenticated push event is ASSERTED at best (ADR-044). The intended
 * completion of the flow is to reconcile it against the provider's own
 * current state: this adapter reads the documented incident/reconciliation
 * surface (`POST /event/getPageList.do`) through the SAME LIVE/RECORD/REPLAY
 * runAdapter path every other Atlas capability uses, and maps the wire
 * records into provider-neutral StructuredProviderFlightState. Downstream,
 * the shared PROVIDER_STATE ingestion path turns those states into
 * CONNECTED signals — which legitimately outrank the ASSERTED push.
 *
 * Atlas wire vocabulary stays entirely in this file + eventTypes.ts; this
 * adapter never interprets business policy.
 */
import type { AdapterMode, CapabilityResult, ProviderAdapter } from '../../contracts/envelope.ts';
import type { StructuredProviderFlightState } from '../../ingest/structured.ts';
import type { RecordingStore } from '../recordingStore.ts';
import { capabilityFailure, runAdapter } from '../runner.ts';
import { AtlasClient, assertProviderSuccess } from './client.ts';
import { classifyAtlasEventCategory } from './eventNormalizer.ts';
import {
  AtlasIncidentListBodySchema,
  type AtlasIncidentListBody,
  type AtlasIncidentRecord,
} from './eventTypes.ts';
import { ATLAS_PROVIDER_ID } from './adapter.ts';
import { IsoDateTimeSchema } from '../../domain/common.ts';

export const ATLAS_FLIGHT_STATE_OPERATION = 'flight_state_query';

export interface FlightStateReadRequest {
  /** Booking/order reference the provider state is read for. */
  orderReference: string;
}

export interface AtlasFlightStateReaderOptions {
  mode: AdapterMode;
  store: RecordingStore;
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Best-effort ISO-8601 parse; Atlas's own timestamp format is undocumented. */
function toIsoOrUndefined(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const parsed = IsoDateTimeSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** eventType keyword classification -> generic provider flight-state status. */
function statusForRecord(record: AtlasIncidentRecord): StructuredProviderFlightState['status'] {
  switch (classifyAtlasEventCategory(record.eventType)) {
    case 'FLIGHT_CANCELLATION':
      return 'CANCELLED';
    case 'FLIGHT_DELAY':
      return 'DELAYED';
    case 'FLIGHT_SCHEDULE_CHANGE':
      return 'SCHEDULE_CHANGED';
    default:
      // An incident record without disruption vocabulary is the provider's
      // confirmation of current state — never a guessed disruption.
      return 'CONFIRMED';
  }
}

function normalizeIncidentRecords(raw: AtlasIncidentListBody): { states: StructuredProviderFlightState[] } {
  const states: StructuredProviderFlightState[] = [];
  for (const record of raw.data ?? []) {
    const occurredAt = toIsoOrUndefined(record.eventTime) ?? toIsoOrUndefined(record.createTime);
    const newDeparture = toIsoOrUndefined(record.depTime);
    const newArrival = toIsoOrUndefined(record.arrTime);
    states.push({
      bookingReference: record.orderNo,
      ...(record.airline ? { carrierCode: record.airline } : {}),
      ...(record.flightNo ? { flightNumber: record.flightNo } : {}),
      status: statusForRecord(record),
      ...(occurredAt ? { occurredAt } : {}),
      ...(newDeparture ? { newDeparture } : {}),
      ...(newArrival ? { newArrival } : {}),
    });
  }
  return { states };
}

/**
 * Reads the provider's current flight state for one booking reference.
 * LIVE/RECORD require credentials (fail closed); REPLAY resolves the
 * deterministic recording and runs the identical normalizer.
 */
export class AtlasFlightStateReader {
  readonly providerId = ATLAS_PROVIDER_ID;
  private readonly mode: AdapterMode;
  private readonly store: RecordingStore;
  private readonly baseUrl?: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly timeoutMs?: number;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: AtlasFlightStateReaderOptions) {
    this.mode = options.mode;
    this.store = options.store;
    this.baseUrl = options.baseUrl;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl;
  }

  async readFlightStates(
    request: FlightStateReadRequest,
  ): Promise<CapabilityResult<{ states: StructuredProviderFlightState[] }>> {
    const adapter: ProviderAdapter<FlightStateReadRequest, AtlasIncidentListBody, { states: StructuredProviderFlightState[] }> = {
      providerId: ATLAS_PROVIDER_ID,
      mode: this.mode,
      obtainRaw: async (query) => {
        const client = this.liveClient();
        const raw = await client.post('/event/getPageList.do', {
          cid: this.clientId,
          orderNo: query.orderReference,
        });
        assertProviderSuccess(raw, '/event/getPageList.do');
        return AtlasIncidentListBodySchema.parse(raw);
      },
      normalize: (raw) => normalizeIncidentRecords(raw),
    };
    return runAdapter(adapter, this.store, request, {
      operation: ATLAS_FLIGHT_STATE_OPERATION,
      secrets: this.secrets(),
    });
  }

  private liveClient(): AtlasClient {
    if (this.mode === 'REPLAY') {
      throw capabilityFailure('PROVIDER_ERROR', 'atlas_live_call_in_replay', 'REPLAY must not call the provider');
    }
    if (!this.baseUrl || !this.clientId || !this.clientSecret) {
      throw capabilityFailure(
        'NOT_CONFIGURED',
        'atlas_missing_credentials',
        'Atlas LIVE/RECORD requires ATLAS_BASE_URL, ATLAS_CLIENT_ID and ATLAS_CLIENT_SECRET',
      );
    }
    return new AtlasClient({
      baseUrl: this.baseUrl,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      ...(this.timeoutMs === undefined ? {} : { timeoutMs: this.timeoutMs }),
      ...(this.fetchImpl === undefined ? {} : { fetchImpl: this.fetchImpl }),
    });
  }

  private secrets(): string[] {
    return [this.clientId, this.clientSecret].filter((value): value is string => typeof value === 'string');
  }
}
