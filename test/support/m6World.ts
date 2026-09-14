/**
 * Test-only builder for pure M6 evaluator tests: an empty, internally
 * consistent CapturedWorld that a test fills with exactly the rows it needs.
 * No scenario data lives here.
 */
import { randomUUID } from 'node:crypto';
import type { CapturedWorld } from '../../src/resolution/world/world.ts';
import { projectEffectiveWorld } from '../../src/resolution/world/effectiveItinerary.ts';
import type { EffectiveWorld } from '../../src/resolution/world/effectiveTypes.ts';

export function emptyWorld(overrides: Partial<CapturedWorld> = {}): CapturedWorld {
  const workspaceId = randomUUID();
  return {
    workspaceId,
    focus: [],
    edges: [],
    capture: { isolation: 'REPEATABLE_READ', readOnly: true, databaseSnapshot: 'test:1:1:', capturedAt: '2030-01-01T00:00:00.000Z', modelVersion: 'm6-world/1' },
    manifest: { evaluatedAt: '2030-01-01T00:00:00.000Z', evaluatorVersions: [], aggregateReads: [], scopeReads: [], evidenceReads: [], coverageReads: [], missingCoverage: [] },
    travellers: [], profileAssertions: [], credentials: [], credentialVersions: [], credentialLinks: [], travelHistory: [], organisations: [],
    trips: [], journeys: [], journeyItems: [], intendedVisits: [], credentialSelections: [], coordinationGroups: [], groupMemberships: [],
    accompanimentRequirements: [], supportAssignments: [],
    transportServices: [], resources: [], reservations: [], reservationLines: [], allocations: [], entitlements: [], budgets: [], budgetCommitments: [],
    costAllocations: [], fxObservations: [],
    programmes: [], programmeItems: [], participations: [], resourceAssignments: [], places: [], jurisdictions: [], placeJurisdictions: [],
    objectives: [], constraints: [], dependencies: [], ruleSetVersions: [], ruleAssignments: [], informationVersions: [], coverage: [],
    ...overrides,
  };
}

export function effectiveOf(world: CapturedWorld): EffectiveWorld {
  return projectEffectiveWorld(world);
}

export function id(): string {
  return randomUUID();
}
