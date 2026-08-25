/**
 * Scenario-run provenance modes for the acceptance runner.
 *
 * AdapterMode (LIVE|RECORD|REPLAY) remains the provider-boundary contract.
 * ScenarioExecutionMode adds SIMULATED_EXTERNAL_EVENT so evidence can
 * distinguish an approved simulated ingress from real downstream provider
 * execution that may still be LIVE/RECORD/REPLAY.
 */
import { z } from 'zod';
import { AdapterModeSchema } from '../config/config.ts';

export const ScenarioExecutionModeSchema = z.enum([
  'LIVE',
  'RECORD',
  'REPLAY',
  'SIMULATED_EXTERNAL_EVENT',
]);
export type ScenarioExecutionMode = z.infer<typeof ScenarioExecutionModeSchema>;

/** Provider adapter mode implied by a scenario-run mode. */
export function adapterModeFor(mode: ScenarioExecutionMode): z.infer<typeof AdapterModeSchema> {
  if (mode === 'SIMULATED_EXTERNAL_EVENT') return 'REPLAY';
  return mode;
}

/** True when the step/source is an approved simulated external ingress. */
export function isSimulatedExternal(mode: ScenarioExecutionMode): boolean {
  return mode === 'SIMULATED_EXTERNAL_EVENT';
}
