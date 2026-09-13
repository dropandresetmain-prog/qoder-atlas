/**
 * NORTHSTAR M2 lane P — credential reverse-lookup reads.
 *
 * Takes a `Queryable` (pool or client) because the frozen `UnitOfWork` exposes no
 * read-only transaction; that omission is recorded in
 * `src/persistence/postgres/commandSupport.ts` and reported again in the lane
 * evidence rather than patched into an accepted interface.
 *
 * Each method is a single statement and uses the index named in the frozen
 * `CredentialReadQueries` doc comment (0025/0014/0029). All of them are
 * workspace-scoped on both sides of every join, so a foreign workspace UUID can
 * never be pulled in through a join key alone.
 */
import type { DateInterval } from '../../../domain/v2/shared/time.ts';
import type {
  CredentialReadQueries,
  CredentialExposureHit,
  CredentialExpiryHit,
} from '../../../contracts/v2/repository/queries.ts';
import type { CredentialKind } from '../../../domain/v2/people/traveller.ts';
import type { Queryable } from '../commandSupport.ts';

interface ExposureRow {
  selection_id: string;
  journey_id: string;
  traveller_id: string;
  credential_id: string;
  credential_version_id: string;
  intended_visit_ids: string[] | null;
}

interface ExpiryRow {
  credential_id: string;
  traveller_id: string;
  kind: CredentialKind;
  version_id: string;
  edition_number: number;
  expiry_date: string | null;
}

/**
 * The visit-scope association is a child row set, so it is aggregated per
 * selection inside the same statement instead of a second round-trip.
 */
const EXPOSURE_SELECT = `
  SELECT s.id AS selection_id,
         s.journey_id,
         j.traveller_id,
         s.credential_id,
         s.credential_version_id,
         COALESCE(
           (SELECT array_agg(v.intended_visit_id ORDER BY v.intended_visit_id)
              FROM credential_selection_visits v
             WHERE v.workspace_id = s.workspace_id AND v.selection_id = s.id),
           '{}'
         ) AS intended_visit_ids
    FROM credential_selections s
    JOIN journeys j ON j.workspace_id = s.workspace_id AND j.id = s.journey_id
`;

function toExposure(row: ExposureRow): CredentialExposureHit {
  return {
    selectionId: row.selection_id,
    journeyId: row.journey_id,
    travellerId: row.traveller_id,
    credentialId: row.credential_id,
    credentialVersionId: row.credential_version_id,
    intendedVisitIds: row.intended_visit_ids ?? [],
  };
}

export class PgCredentialReadQueries implements CredentialReadQueries {
  private readonly db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  /** `idx_credential_selections_version (workspace_id, credential_version_id)`. */
  async selectionsPinningVersion(workspaceId: string, credentialVersionId: string): Promise<CredentialExposureHit[]> {
    const result = await this.db.query<ExposureRow>(
      `${EXPOSURE_SELECT} WHERE s.workspace_id = $1 AND s.credential_version_id = $2 ORDER BY s.id`,
      [workspaceId, credentialVersionId],
    );
    return result.rows.map(toExposure);
  }

  /** `idx_credential_selections_credential (workspace_id, credential_id)`. */
  async selectionsForCredential(workspaceId: string, credentialId: string): Promise<CredentialExposureHit[]> {
    const result = await this.db.query<ExposureRow>(
      `${EXPOSURE_SELECT} WHERE s.workspace_id = $1 AND s.credential_id = $2 ORDER BY s.id`,
      [workspaceId, credentialId],
    );
    return result.rows.map(toExposure);
  }

  /**
   * "Is this document in active use at all?" is the question *the edition a
   * credential currently accepts* has been pinned by a selection — a superseded
   * edition still has selections against it, which is exactly why F06 keeps the
   * claim separate. `idx_travel_credentials_current_version
   * (workspace_id, current_version_id)` is the join that answers it; the
   * Traveller restriction rides on the credential row's own FK.
   */
  async credentialsInUseByTraveller(workspaceId: string, travellerId: string): Promise<string[]> {
    const result = await this.db.query<{ credential_id: string }>(
      `SELECT c.id AS credential_id
         FROM credential_selections s
         JOIN travel_credentials c
           ON c.workspace_id = s.workspace_id
          AND c.current_version_id = s.credential_version_id
        WHERE s.workspace_id = $1 AND c.traveller_id = $2
        GROUP BY c.id
        ORDER BY c.id`,
      [workspaceId, travellerId],
    );
    return result.rows.map((row) => row.credential_id);
  }

  /**
   * Partial index `idx_credential_versions_expiry (workspace_id, expiry_date)
   * WHERE expiry_date IS NOT NULL`, so the NOT NULL predicate is stated
   * explicitly rather than implied. "Current" is decided through
   * `travel_credentials.current_version_id`; an edition that is not current is
   * excluded even when its own date falls inside `range`, and the half-open
   * `[start, end)` reading of `DateInterval` is applied in SQL. Expiry is an
   * observed validity fact: nothing here guesses whether the person still holds
   * the document.
   */
  async credentialsExpiringIn(workspaceId: string, range: DateInterval): Promise<CredentialExpiryHit[]> {
    const result = await this.db.query<ExpiryRow>(
      `SELECT c.id AS credential_id,
              c.traveller_id,
              c.kind,
              v.id AS version_id,
              v.edition_number,
              to_char(v.expiry_date, 'YYYY-MM-DD') AS expiry_date
         FROM credential_versions v
         JOIN travel_credentials c
           ON c.workspace_id = v.workspace_id
          AND c.current_version_id = v.id
        WHERE v.workspace_id = $1
          AND v.expiry_date IS NOT NULL
          AND v.expiry_date >= $2::date
          AND ($3::date IS NULL OR v.expiry_date < $3::date)
        ORDER BY v.expiry_date, v.id`,
      [workspaceId, range.start, range.end ?? null],
    );
    return result.rows.map((row) => ({
      credentialId: row.credential_id,
      travellerId: row.traveller_id,
      kind: row.kind,
      versionId: row.version_id,
      editionNumber: Number(row.edition_number),
      expiryDate: row.expiry_date,
    }));
  }
}
