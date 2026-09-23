/**
 * Atlas SANDBOX-only passenger execution alias.
 *
 * Test/sandbox infrastructure at the Atlas external execution boundary.
 * Gives a disposable CP6 (or similar) run a distinct synthetic Atlas passenger
 * identity so persistent sandbox duplicate detection (status 318) does not
 * collide with an earlier fake booking for the same canonical traveller +
 * itinerary.
 *
 * This is NOT:
 *  - canonical Traveller truth
 *  - application-domain identity
 *  - planner / recovery / authority behaviour
 *
 * Apply ONLY when ALL are true:
 *  1. Atlas base URL host is the known sandbox host
 *  2. Adapter mode is LIVE or RECORD
 *  3. Explicit sandbox passenger alias configuration is present
 *
 * Otherwise use canonical protected traveller identity. If alias config is
 * present against a non-sandbox / unknown host, FAIL CLOSED (never send it).
 */
import type { AdapterMode } from '../../contracts/envelope.ts';
import { ATLAS_SANDBOX_HOST, isAtlasSandboxBaseUrl } from './atlasSandboxHost.ts';

/** Auditable provenance tag for provider-bound requests that used the alias. */
export const SANDBOX_TEST_ALIAS_PROVENANCE = 'SANDBOX_TEST_ALIAS' as const;

export interface AtlasSandboxPassengerAliasConfig {
  givenName: string;
  familyName: string;
}

export type AtlasSandboxPassengerAliasResolution =
  | { status: 'NONE' }
  | {
      status: 'APPLIED';
      alias: AtlasSandboxPassengerAliasConfig;
      provenance: typeof SANDBOX_TEST_ALIAS_PROVENANCE;
    }
  | { status: 'REFUSED'; reason: 'non_sandbox_host' | 'mode_not_live_or_record' | 'incomplete_alias' };

export function resolveAtlasSandboxPassengerAlias(input: {
  configured?: AtlasSandboxPassengerAliasConfig | undefined;
  baseUrl?: string | undefined;
  mode: AdapterMode;
}): AtlasSandboxPassengerAliasResolution {
  const configured = input.configured;
  if (!configured) return { status: 'NONE' };

  const given = configured.givenName.trim();
  const family = configured.familyName.trim();
  if (given === '' || family === '') {
    return { status: 'REFUSED', reason: 'incomplete_alias' };
  }

  if (input.mode !== 'LIVE' && input.mode !== 'RECORD') {
    return { status: 'REFUSED', reason: 'mode_not_live_or_record' };
  }

  if (!input.baseUrl || !isAtlasSandboxBaseUrl(input.baseUrl)) {
    return { status: 'REFUSED', reason: 'non_sandbox_host' };
  }

  return {
    status: 'APPLIED',
    alias: { givenName: given, familyName: family },
    provenance: SANDBOX_TEST_ALIAS_PROVENANCE,
  };
}

/**
 * Replace given/family on a passenger copy for Atlas wire transmission only.
 * Leaves all other fields (gender, DOB, nationality, traveller linkage) intact.
 */
export function applySandboxPassengerAliasToPassengers<
  T extends { givenName: string; familyName: string },
>(passengers: readonly T[], alias: AtlasSandboxPassengerAliasConfig): T[] {
  return passengers.map((passenger) => ({
    ...passenger,
    givenName: alias.givenName,
    familyName: alias.familyName,
  }));
}

/** Human-readable refuse message for boot / adapter fail-closed paths. */
export function sandboxPassengerAliasRefuseMessage(
  reason: Extract<AtlasSandboxPassengerAliasResolution, { status: 'REFUSED' }>['reason'],
): string {
  switch (reason) {
    case 'non_sandbox_host':
      return (
        `ATLAS sandbox passenger alias is configured but ATLAS_BASE_URL is not the verified ` +
        `sandbox host (${ATLAS_SANDBOX_HOST}); refusing rather than sending synthetic identity`
      );
    case 'mode_not_live_or_record':
      return (
        'ATLAS sandbox passenger alias is configured but adapter mode is not LIVE/RECORD; ' +
        'refusing rather than applying synthetic identity outside sanctioned sandbox execution'
      );
    case 'incomplete_alias':
      return (
        'ATLAS sandbox passenger alias is incomplete (both given and family name required); refusing'
      );
  }
}
