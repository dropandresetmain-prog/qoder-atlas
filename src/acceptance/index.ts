/**
 * Acceptance tooling — generic LIVE/RECORD/REPLAY/SIMULATED scenario runner.
 * Orchestration and evidence only; no domain/recovery decisions.
 */
export {
  ScenarioExecutionModeSchema,
  adapterModeFor,
  isSimulatedExternal,
} from './modes.ts';
export type { ScenarioExecutionMode } from './modes.ts';

export {
  AcceptanceManifestSchema,
  ManifestLoadError,
  loadAcceptanceManifest,
  resolveManifestPath,
  resolvePackPath,
} from './manifest.ts';
export type {
  AcceptanceManifest,
  BoundaryDeclaration,
  HttpAction,
  InputPackRef,
  ManifestStep,
  ObserveAction,
  SimulatedExternalEventAction,
  TravellerMessageAction,
  UiAction,
} from './manifest.ts';

export {
  EvidenceBuilder,
  ScenarioEvidenceSchema,
} from './evidence.ts';
export type {
  EvidenceExternalCall,
  EvidenceProvenance,
  EvidenceStateTransition,
  ScenarioEvidence,
} from './evidence.ts';

export { runPreflight } from './preflight.ts';
export type { PreflightCheck, PreflightOptions, PreflightReport } from './preflight.ts';

export { runAcceptanceManifest } from './runner.ts';
export type { RunnerOptions, RunnerResult } from './runner.ts';

export { hashDirectory, hashFile, hashValue, sha256Hex } from './hashes.ts';
