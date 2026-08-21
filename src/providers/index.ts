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
