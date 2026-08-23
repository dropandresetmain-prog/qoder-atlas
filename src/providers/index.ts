/**
 * Lane C — travel capability adapters. Provider-specific code lives only in
 * this tree; the domain consumes the frozen capability contracts.
 */
export { CapabilityFailure, capabilityFailure, runAdapter, toCapabilityError } from './runner.ts';
export type { RunAdapterOptions } from './runner.ts';
export { FileRecordingStore, recordingIdFor, canonicalJson } from './recordingStore.ts';
export type { FileRecordingStoreOptions, RecordingStore } from './recordingStore.ts';
export { REDACTED, containsAnySecret, sanitizeRaw } from './sanitize.ts';
export { ATLAS_PROVIDER_ID, AtlasFlightAdapter } from './atlas/adapter.ts';
export type { AtlasAdapterOptions } from './atlas/adapter.ts';
export { atlasScheduleAtAirport, atlasScheduleToIso } from './atlas/normalize.ts';
export type { AtlasTimezoneResolver } from './atlas/normalize.ts';
export { GOOGLE_ROUTES_PROVIDER_ID, GoogleRoutesAdapter, normalizeRouteContext } from './googleRoutes/adapter.ts';
export type { GoogleRoutesAdapterOptions } from './googleRoutes/adapter.ts';
export {
  NUITEE_PROVIDER_ID,
  NUITEE_DEFAULT_SEARCH_BASE_URL,
  NUITEE_DEFAULT_BOOKING_BASE_URL,
  NUITEE_HOTEL_ID_REF_SYSTEM,
  NuiteeAdapter,
  mapBookingStatus,
  normalizeBook,
  normalizeCancel,
  normalizeQuote,
  normalizeRetrieve,
  normalizeSearch,
  normalizeStayContext,
  splitGuestName,
} from './hotel/nuiteeAdapter.ts';
export type {
  NuiteeAdapterOptions,
  NuiteeBookRaw,
  NuiteeCancelPolicyInfoRaw,
  NuiteeCancelRaw,
  NuiteeMoneyRaw,
  NuiteePrebookRaw,
  NuiteeRateRaw,
  NuiteeRetrieveRaw,
  NuiteeRoomTypeRaw,
  NuiteeSearchRaw,
} from './hotel/nuiteeAdapter.ts';
export {
  routeContextFor,
  transferWindowImpact,
} from './routing/reasoning.ts';
export type {
  RouteContextForOptions,
  RouteContextForResult,
  TransferWindowClassification,
  TransferWindowInputs,
  TransferWindowOutcome,
} from './routing/reasoning.ts';
