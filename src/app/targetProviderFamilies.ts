/**
 * G01 — the ONE place normal boot decides which provider capability families
 * are really composed, and therefore which families the recovery planning
 * coordinator may advertise. Advertised === composed: a family with no real
 * adapter is never advertised, so its domain fails CLOSED (UNAVAILABLE /
 * capability_unavailable) instead of producing a fake INVESTIGATED record.
 *
 * Non-provider domains (PROGRAMME, SUPPORT_COORDINATION) require no capability
 * family in the domain registry and are always available.
 *
 * EXTENSION POINT: `composeTransportFamilies(..., { composeTransport })`. The
 * default composer is the R3 read-only Atlas flight research seam. A future
 * Atlas composition (verify / fare-rule / rules) plugs in by passing a different
 * `composeTransport` — one line at the boot call site; the advertised family set
 * follows automatically from what that composer actually returns.
 */
import type { AppConfig } from '../config/config.ts';
import type { CapabilityFamily } from '../operational/strategy.ts';
import type { AtlasTimezoneResolver } from '../providers/atlas/normalize.ts';
import { composeTargetTransportResearch, type TargetTransportResearch } from './targetTransportResearch.ts';

export type TransportComposer = (
  config: AppConfig,
  cwd: string,
  timezoneResolverFactory?: () => Promise<AtlasTimezoneResolver | undefined>,
) => TargetTransportResearch | undefined;

export interface ComposedProviderFamilies {
  /** Present iff a real read-only transport capability was composed. */
  transportPlanning?: TargetTransportResearch;
  /** Exactly the composed families. Empty when nothing is composed. */
  availableCapabilities: readonly CapabilityFamily[];
}

/** Pure: the advertised family set for what was actually composed. */
export function capabilitiesForComposition(composed: { transportPlanning?: unknown }): readonly CapabilityFamily[] {
  const families: CapabilityFamily[] = [];
  if (composed.transportPlanning) families.push('FLIGHT');
  return families;
}

export function composeTransportFamilies(
  config: AppConfig,
  cwd: string,
  timezoneResolverFactory?: () => Promise<AtlasTimezoneResolver | undefined>,
  options: { composeTransport?: TransportComposer } = {},
): ComposedProviderFamilies {
  const transportPlanning = (options.composeTransport ?? composeTargetTransportResearch)(config, cwd, timezoneResolverFactory);
  return {
    ...(transportPlanning ? { transportPlanning } : {}),
    availableCapabilities: capabilitiesForComposition({ ...(transportPlanning ? { transportPlanning } : {}) }),
  };
}

