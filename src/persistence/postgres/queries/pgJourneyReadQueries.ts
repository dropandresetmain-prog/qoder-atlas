/**
 * PostgreSQL implementation of the frozen `JourneyReadQueries` port
 * (src/contracts/v2/repository/queries.ts).
 *
 * These are the §9/§12 reverse-lookup access paths M6 and M9 are required to use
 * instead of parsing a JSON bag: `journeys` by Traveller/Trip and active travel
 * window, `journey_items` through a place they reference, and `intended_visits`
 * through jurisdiction plus window. Each method is exactly one statement whose
 * predicates match the index its port doc comment names:
 *
 * | method                            | index                                                     |
 * |-----------------------------------|-----------------------------------------------------------|
 * | journeysForTravellerInWindow      | `idx_journeys_traveller` (0021)                           |
 * | journeysForTrip                   | `idx_journeys_trip` (0021)                                |
 * | itemsReferencingPlace             | `idx_transport_item_details_origin`/`_destination`,       |
 * |                                   | `idx_stay_item_details_place`,                            |
 * |                                   | `idx_resource_use_item_details_place` (0023)              |
 * | intendedVisitsInJurisdictionWindow| `idx_intended_visits_jurisdiction_window` (0024)          |
 *
 * Window overlap is written as `start < $end AND end > $start`, which is the
 * half-open `[start, end)` overlap test for `InstantInterval` and is the form
 * these btree indexes can narrow on. `0029` additionally creates the partial
 * `idx_journeys_traveller_window` / `idx_journeys_trip_window` window indexes for
 * window-only scans; the equality prefix used here is what the port names and is
 * what a planner prefers for a single Traveller/Trip.
 *
 * Constructor dependency note: the frozen `UnitOfWork`
 * (src/contracts/v2/command/unitOfWork.ts) exposes no read-only transaction, so
 * a read seam cannot run inside one. Taking a `Queryable` — `Pool` or
 * `PoolClient` — is the accepted workaround and is recorded as an architecture
 * gap, not patched into that interface.
 */
import type { Pool, PoolClient } from '../pool.ts';
import type {
  ItemPlaceHit,
  JourneyReadQueries,
  JourneyWindowHit,
  JurisdictionVisitHit,
} from '../../../contracts/v2/repository/queries.ts';
import type { Instant, InstantInterval } from '../../../domain/v2/shared/time.ts';

/** Either a pooled connection or the checked-out client of a caller's transaction. */
export type Queryable = Pool | PoolClient;

interface JourneyHitRow {
  id: string;
  trip_id: string;
  traveller_id: string;
  lifecycle_status: string;
  intended_window_start: Date | null;
  intended_window_end: Date | null;
}

interface PlaceHitRow {
  journey_item_id: string;
  journey_id: string;
  kind: string;
  place_role: ItemPlaceHit['placeRole'];
}

interface VisitHitRow {
  intended_visit_id: string;
  journey_id: string;
  traveller_id: string;
  jurisdiction_id: string;
  purpose: string;
  intended_start: Date;
  intended_end: Date;
  transit_intent: boolean;
}

const JOURNEY_HIT_COLUMNS = `
  j.id, j.trip_id, j.traveller_id, j.lifecycle_status,
  j.intended_window_start, j.intended_window_end`;

function toWindowHit(row: JourneyHitRow): JourneyWindowHit {
  return {
    journeyId: row.id,
    tripId: row.trip_id,
    travellerId: row.traveller_id,
    lifecycleStatus: row.lifecycle_status,
    intendedWindow:
      row.intended_window_start && row.intended_window_end
        ? { start: row.intended_window_start.toISOString(), end: row.intended_window_end.toISOString() }
        : null,
  };
}

/**
 * One branch per place-bearing detail table. `kind` comes from the parent
 * `journey_items` row, so the discriminating composite FK of 0023 is what proves
 * the role label matches the item's actual kind. Table and column identifiers
 * are closed in-code literals; every value, including the role label, is bound.
 */
interface PlaceBranchSpec {
  table: 'transport_item_details' | 'stay_item_details' | 'resource_use_item_details';
  placeColumn: string;
  placeRole: ItemPlaceHit['placeRole'];
}

const PLACE_BRANCHES: PlaceBranchSpec[] = [
  { table: 'transport_item_details', placeColumn: 'desired_origin_place_id', placeRole: 'ORIGIN' },
  { table: 'transport_item_details', placeColumn: 'desired_destination_place_id', placeRole: 'DESTINATION' },
  { table: 'stay_item_details', placeColumn: 'intended_place_id', placeRole: 'INTENDED' },
  { table: 'resource_use_item_details', placeColumn: 'intended_location_place_id', placeRole: 'LOCATION' },
];

function placeHitBranch(spec: PlaceBranchSpec, roleParamIndex: number): string {
  return `SELECT i.id AS journey_item_id, i.journey_id, i.kind, $${roleParamIndex}::text AS place_role
            FROM ${spec.table} d
            JOIN journey_items i
              ON i.workspace_id = d.workspace_id AND i.id = d.journey_item_id
           WHERE d.workspace_id = $1 AND d.${spec.placeColumn} = $2`;
}

export class PgJourneyReadQueries implements JourneyReadQueries {
  private readonly db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  async journeysForTravellerInWindow(
    workspaceId: string,
    travellerId: string,
    window: InstantInterval,
    opts?: { includeCancelled?: boolean },
  ): Promise<JourneyWindowHit[]> {
    // A CANCELLED journey is excluded unless the caller opts in. The fragment is
    // chosen from a closed pair of literals — no caller value reaches the SQL.
    const statusPredicate = opts?.includeCancelled ? '' : `     AND j.lifecycle_status <> 'CANCELLED'\n`;
    const result = await this.db.query<JourneyHitRow>(
      `SELECT ${JOURNEY_HIT_COLUMNS}
         FROM journeys j
        WHERE j.workspace_id = $1
          AND j.traveller_id = $2
          AND j.intended_window_start IS NOT NULL
          AND j.intended_window_start < $4
          AND j.intended_window_end > $3
        ${statusPredicate}
        ORDER BY j.intended_window_start, j.id`,
      [workspaceId, travellerId, window.start, window.end],
    );
    return result.rows.map(toWindowHit);
  }

  async journeysForTrip(workspaceId: string, tripId: string): Promise<JourneyWindowHit[]> {
    const result = await this.db.query<JourneyHitRow>(
      `SELECT ${JOURNEY_HIT_COLUMNS}
         FROM journeys j
        WHERE j.workspace_id = $1
          AND j.trip_id = $2
        ORDER BY j.created_at, j.id`,
      [workspaceId, tripId],
    );
    return result.rows.map(toWindowHit);
  }

  async itemsReferencingPlace(workspaceId: string, placeId: string): Promise<ItemPlaceHit[]> {
    const branches = PLACE_BRANCHES.map((branch, index) => placeHitBranch(branch, index + 3));
    const boundRoles = PLACE_BRANCHES.map((branch) => branch.placeRole);
    const result = await this.db.query<PlaceHitRow>(
      `${branches.join('\nUNION ALL\n')}
        ORDER BY journey_item_id, place_role`,
      [workspaceId, placeId, ...boundRoles],
    );
    return result.rows.map((row) => ({
      journeyItemId: row.journey_item_id,
      journeyId: row.journey_id,
      kind: row.kind,
      placeRole: row.place_role,
    }));
  }

  async intendedVisitsInJurisdictionWindow(
    workspaceId: string,
    jurisdictionId: string,
    window: InstantInterval,
  ): Promise<JurisdictionVisitHit[]> {
    const result = await this.db.query<VisitHitRow>(
      `SELECT iv.id AS intended_visit_id,
              iv.journey_id,
              j.traveller_id,
              iv.jurisdiction_id,
              iv.purpose,
              iv.intended_start,
              iv.intended_end,
              iv.transit_intent
         FROM intended_visits iv
         JOIN journeys j
           ON j.workspace_id = iv.workspace_id AND j.id = iv.journey_id
        WHERE iv.workspace_id = $1
          AND iv.jurisdiction_id = $2
          AND iv.intended_start < $4
          AND iv.intended_end > $3
        ORDER BY iv.intended_start, iv.id`,
      [workspaceId, jurisdictionId, window.start, window.end],
    );
    return result.rows.map((row) => ({
      intendedVisitId: row.intended_visit_id,
      journeyId: row.journey_id,
      travellerId: row.traveller_id,
      jurisdictionId: row.jurisdiction_id,
      purpose: row.purpose,
      intendedDates: {
        start: row.intended_start.toISOString() satisfies Instant,
        end: row.intended_end.toISOString() satisfies Instant,
      },
      transitIntent: row.transit_intent,
    }));
  }
}
