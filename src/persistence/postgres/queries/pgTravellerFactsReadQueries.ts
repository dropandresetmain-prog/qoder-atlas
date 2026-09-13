/**
 * NORTHSTAR M2 lane P — facts recorded about a person.
 *
 * Read-only over `Queryable` (see `pgCredentialReadQueries.ts` for why). Both
 * methods are a single statement and workspace-scoped.
 *
 * The rule these reads exist to protect is that a query never upgrades evidence:
 * a `PARTIAL` travel-history row stays `PARTIAL`, and a relationship stays
 * directional in storage while being findable from both ends.
 */
import type { DateInterval, Instant, LocalDate } from '../../../domain/v2/shared/time.ts';
import type { RelationshipType } from '../../../domain/v2/people/traveller.ts';
import type { TravellerFactsReadQueries } from '../../../contracts/v2/repository/queries.ts';
import type { Queryable } from '../commandSupport.ts';

interface RelationshipRow {
  relationship_id: string;
  from_traveller_id: string;
  to_traveller_id: string;
  relationship_type: RelationshipType;
  valid_from: string;
  valid_until: string | null;
}

interface HistoryRow {
  history_id: string;
  jurisdiction_id: string;
  entry_date: string | null;
  exit_date: string | null;
  coverage_claim: 'PARTIAL' | 'WINDOW_COMPLETE';
  uncertainty_note: string | null;
  evidence_id: string;
}

/**
 * An `at` instant is a moment; 0017/0016 store date-only validity. The UTC
 * calendar day of the instant is used, stated rather than silently rounded into
 * a fake local midnight, because §1 forbids converting a date-only rule into a
 * derived instant.
 */
function utcDayOf(instant: Instant): string {
  return new Date(instant).toISOString().slice(0, 10);
}

export class PgTravellerFactsReadQueries implements TravellerFactsReadQueries {
  private readonly db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  /**
   * `idx_traveller_relationships_from` + `idx_traveller_relationships_to`
   * (planner BitmapOr over the two equality arms). The row keeps its direction:
   * `fromTravellerId`/`toTravellerId` are returned as recorded so a caller can
   * never read "connected" as "dependent".
   */
  async relationshipsInvolving(
    workspaceId: string,
    travellerId: string,
    at?: Instant,
  ): Promise<
    {
      relationshipId: string;
      fromTravellerId: string;
      toTravellerId: string;
      relationshipType: RelationshipType;
      validRange: { start: LocalDate; end: LocalDate | null };
    }[]
  > {
    const result = await this.db.query<RelationshipRow>(
      `SELECT r.id AS relationship_id,
              r.from_traveller_id,
              r.to_traveller_id,
              r.relationship_type,
              to_char(r.effective_from, 'YYYY-MM-DD') AS valid_from,
              to_char(r.effective_to, 'YYYY-MM-DD') AS valid_until
         FROM traveller_relationships r
        WHERE r.workspace_id = $1
          AND (r.from_traveller_id = $2 OR r.to_traveller_id = $2)
          AND ($3::date IS NULL
               OR (r.effective_from <= $3::date AND (r.effective_to IS NULL OR r.effective_to > $3::date)))
        ORDER BY r.effective_from, r.id`,
      [workspaceId, travellerId, at === undefined ? null : utcDayOf(at)],
    );
    return result.rows.map((row) => ({
      relationshipId: row.relationship_id,
      fromTravellerId: row.from_traveller_id,
      toTravellerId: row.to_traveller_id,
      relationshipType: row.relationship_type,
      validRange: { start: row.valid_from, end: row.valid_until },
    }));
  }

  /**
   * `idx_travel_history_traveller_window` is the index the frozen port names,
   * and it does not exist: 0016 creates
   * `idx_travel_history_traveller (workspace_id, traveller_id, entry_date)`, and
   * 0029 adds no window variant for this table (reported as an architecture
   * gap). That index still serves this lookup exactly — the workspace,
   * traveller and `entry_date` predicates are its three columns in order.
   *
   * An entry date is the only ordering key a movement has, so a row with no
   * recorded entry date is not claimed to fall inside a window; it is simply not
   * returned by a windowed read. Coverage claims pass through untouched.
   */
  async travelHistoryFor(
    workspaceId: string,
    travellerId: string,
    range: DateInterval,
  ): Promise<
    {
      historyId: string;
      jurisdictionId: string;
      entryDate: LocalDate | null;
      exitDate: LocalDate | null;
      coverageClaim: 'PARTIAL' | 'WINDOW_COMPLETE';
      uncertaintyNote: string | null;
      evidenceId: string;
    }[]
  > {
    const result = await this.db.query<HistoryRow>(
      `SELECT h.id AS history_id,
              h.jurisdiction_id,
              to_char(h.entry_date, 'YYYY-MM-DD') AS entry_date,
              to_char(h.exit_date, 'YYYY-MM-DD') AS exit_date,
              h.coverage_claim,
              h.uncertainty_note,
              h.evidence_id
         FROM travel_history h
        WHERE h.workspace_id = $1
          AND h.traveller_id = $2
          AND h.entry_date >= $3::date
          AND ($4::date IS NULL OR h.entry_date < $4::date)
        ORDER BY h.entry_date, h.id`,
      [workspaceId, travellerId, range.start, range.end ?? null],
    );
    return result.rows.map((row) => ({
      historyId: row.history_id,
      jurisdictionId: row.jurisdiction_id,
      entryDate: row.entry_date,
      exitDate: row.exit_date,
      coverageClaim: row.coverage_claim,
      uncertaintyNote: row.uncertainty_note,
      evidenceId: row.evidence_id,
    }));
  }
}
