/**
 * M10 — target PostgreSQL demo/product world seeding.
 *
 * Real product capability, not test scaffolding: a thin, deterministic
 * bundle over `programmeImport.ts` (the same real command pipeline
 * programme intake uses). No SQLite, no named personas — generic "Demo
 * Traveller N" labels only (anti-hardcoding gate rules target specific
 * fixture personas/ids, not generic demo labels).
 *
 * Does not bootstrap authority grants: seeding a world to look at is a
 * separate concern from authorising a recovery action against it — a
 * recovery flow bootstraps its own organiser authority when it starts
 * (`provisionOrganiserAuthority`, `grantIssuance.ts`), scoped to what that
 * flow actually needs. Calling it here would mint a second, unrelated
 * Organisation (it creates its own), not grant authority over this one.
 */
import { importProgrammeBundle, type ProgrammeImportResult } from './programmeImport.ts';
import type { Pool } from '../../persistence/postgres/pool.ts';

export type DemoSeedResult = ProgrammeImportResult;

/**
 * Seeds a small, coherent demo world: one Organisation, one Event+Programme
 * with a session item, and two Travellers each with a Trip/Journey
 * participating in that item.
 */
export async function seedDemoWorld(pool: Pool, workspaceId: string, actorPrincipalId: string): Promise<DemoSeedResult> {
  return importProgrammeBundle(pool, workspaceId, actorPrincipalId, {
    organisationLegalName: 'Demo Organiser Co',
    eventTitle: 'Demo Programme Event',
    programmeTitle: 'Demo Programme',
    items: [
      {
        title: 'Demo Session',
        itemType: 'SESSION',
        windowStart: '2031-01-01T09:00:00.000Z',
        windowEnd: '2031-01-01T10:00:00.000Z',
      },
    ],
    travellers: [
      { displayName: 'Demo Traveller 1', participatesInItemIndices: [0], obligation: 'REQUIRED' },
      { displayName: 'Demo Traveller 2', participatesInItemIndices: [0], obligation: 'REQUIRED' },
    ],
  });
}
