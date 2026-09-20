/**
 * Target read-only HOTEL research composition.
 *
 * This mirrors targetTransportResearch: provider config -> the existing
 * Nuitee adapter -> the existing read-only dispatch bridge. The adapter still
 * exposes its full capability descriptor for its own transaction boundary,
 * but this composition only hands planning the closed HOTEL context/search/
 * quote/retrieve operations. It is not boot wiring and cannot book or cancel.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../config/config.ts';
import { hasLiveCredentials } from '../config/config.ts';
import { capabilityError, type CapabilityResult } from '../contracts/envelope.ts';
import type {
  HotelCapability,
  HotelSearchQuery,
  HotelSearchOutcome,
} from '../contracts/capabilities.ts';
import { createPlanningToolTransport } from '../resolution/planning/replayPlanningTransport.ts';
import { FileRecordingStore, type RecordingStore } from '../providers/recordingStore.ts';
import { NuiteeAdapter } from '../providers/hotel/nuiteeAdapter.ts';
import type { PlanningToolTransport } from '../resolution/planning/researchDispatcher.ts';

const GUEST_NATIONALITY = /^[A-Z]{2}$/;

export interface TargetHotelResearch {
  transport: PlanningToolTransport;
  metadata: {
    family: 'HOTEL';
    providerId: 'nuitee';
    mode: AppConfig['adapterMode'];
    readOnlyOperations: readonly ['hotel.context', 'hotel.search', 'hotel.quote', 'hotel.retrieve'];
    guestNationalityRequired: true;
  };
}

export interface TargetHotelResearchOptions {
  /** Test/recording seam; normal composition uses config paths. */
  recordingStore?: RecordingStore;
  /** Test seam only; production uses the platform fetch implementation. */
  fetchImpl?: typeof fetch;
}

function recordingStore(config: AppConfig, cwd: string): RecordingStore {
  const readDirs = [config.recordingsDir, join(config.fixturesDir, 'recordings')];
  const scenariosRoot = join(cwd, config.fixturesDir, 'scenarios');
  const scenarioRecordingDirs: string[] = [];
  try {
    for (const entry of readdirSync(scenariosRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) scenarioRecordingDirs.push(join(config.fixturesDir, 'scenarios', entry.name, 'recordings'));
    }
  } catch {
    // A caller may supply a deliberately minimal recording root in a focused
    // composition test; an absent optional scenario directory is not a claim
    // that HOTEL is available or unavailable.
  }
  return new FileRecordingStore({
    readDirs: [...readDirs, ...scenarioRecordingDirs],
    ...(config.adapterMode === 'RECORD' ? { writeDir: config.recordingsDir } : {}),
  });
}

function hotelCapabilityIsHonest(config: AppConfig): boolean {
  if (config.adapterMode === 'REPLAY') return true;
  return hasLiveCredentials(config, 'nuitee');
}

function invalidNationality(adapter: HotelCapability): CapabilityResult<HotelSearchOutcome> {
  return capabilityError(
    {
      category: 'INVALID_REQUEST',
      code: 'guest_nationality_required',
      message: 'hotel.search requires an explicit ISO 3166-1 alpha-2 guestNationality',
    },
    {
      providerId: adapter.descriptor.providerId,
      mode: adapter.descriptor.mode,
      requestedAt: new Date().toISOString(),
    },
  );
}

/** Guard the provider default so target research cannot silently use US. */
export function withExplicitHotelGuestNationality(adapter: HotelCapability): HotelCapability {
  return {
    descriptor: adapter.descriptor,
    getStayContext: (query) => adapter.getStayContext(query),
    searchHotels: (query: HotelSearchQuery) => {
      if (!query.guestNationality || !GUEST_NATIONALITY.test(query.guestNationality)) return Promise.resolve(invalidNationality(adapter));
      return adapter.searchHotels(query);
    },
    quoteRate: (query) => adapter.quoteRate(query),
    bookStay: (query) => adapter.bookStay(query),
    retrieveBooking: (query) => adapter.retrieveBooking(query),
    ...(adapter.findBookingsByClientReference ? { findBookingsByClientReference: (query) => adapter.findBookingsByClientReference!(query) } : {}),
    modifyStay: (query) => adapter.modifyStay(query),
    cancelStay: (query) => adapter.cancelStay(query),
  };
}

/** Compose a provider-backed, read-only HOTEL planning transport. */
export function composeTargetHotelResearch(
  config: AppConfig,
  cwd: string,
  options: TargetHotelResearchOptions = {},
): TargetHotelResearch | undefined {
  if (!hotelCapabilityIsHonest(config)) return undefined;
  const adapter = new NuiteeAdapter({
    mode: config.adapterMode,
    store: options.recordingStore ?? recordingStore(config, cwd),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(config.providers.nuitee.searchBaseUrl ? { searchBaseUrl: config.providers.nuitee.searchBaseUrl } : {}),
    ...(config.providers.nuitee.bookingBaseUrl ? { bookingBaseUrl: config.providers.nuitee.bookingBaseUrl } : {}),
    ...(config.providers.nuitee.apiKey ? { apiKey: config.providers.nuitee.apiKey } : {}),
  });
  const hotel = withExplicitHotelGuestNationality(adapter);
  return {
    transport: createPlanningToolTransport({
      capabilities: { hotel },
      observedAt: () => new Date().toISOString(),
    }),
    metadata: {
      family: 'HOTEL',
      providerId: 'nuitee',
      mode: config.adapterMode,
      readOnlyOperations: ['hotel.context', 'hotel.search', 'hotel.quote', 'hotel.retrieve'],
      guestNationalityRequired: true,
    },
  };
}
