/**
 * Registry-level existence checks (M2, integrator-owned).
 *
 * This is the seam that makes C1 amendment (a) enforceable from application
 * code: a `TypedRef` is a *(kind, id)* pair, so "does this subject exist" must
 * be answered by matching the kind too, never by UUID lookup alone. Both
 * statements hit `domain_subjects_workspace_id_id_kind_uidx` (0019) and join
 * `aggregate_heads` in the same statement, because a registry row whose root has
 * no head is not something a caller can safely cite a revision against.
 *
 * Reads are outside the command transaction, so they take an injected
 * `Queryable`; `UnitOfWork` exposes no read-only transaction (recorded as a gap
 * in docs/refactor/evidence/M2.md). Results are workspace-partitioned by the
 * `workspace_id` predicate — a subject that exists in another workspace is a
 * miss, not a leak.
 */
import type { TypedRef } from '../../../domain/v2/shared/identity.ts';
import type { SubjectRegistryReadQueries } from '../../../contracts/v2/repository/queries.ts';
import type { Queryable } from '../commandSupport.ts';

/** Stable map key for a reference; callers use the exported helper, not a guess. */
export function typedRefKey(ref: TypedRef): string {
  return `${ref.kind}:${ref.id}`;
}

interface RegistryRow {
  kind: string;
  subject_id: string;
  aggregate_id: string;
  revision: string;
}

const SELECT_COLUMNS = `
  SELECT s.kind,
         s.id::text AS subject_id,
         s.aggregate_id::text AS aggregate_id,
         h.revision
`;

export class PgSubjectRegistryReadQueries implements SubjectRegistryReadQueries {
  private readonly db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

  async resolve(workspaceId: string, ref: TypedRef): Promise<{ aggregateId: string; revision: number } | undefined> {
    const result = await this.db.query<RegistryRow>(
      `${SELECT_COLUMNS}
         FROM domain_subjects s
         JOIN aggregate_heads h ON h.workspace_id = s.workspace_id AND h.aggregate_id = s.aggregate_id
        WHERE s.workspace_id = $1 AND s.id = $2 AND s.kind = $3`,
      [workspaceId, ref.id, ref.kind],
    );
    const row = result.rows[0];
    return row ? { aggregateId: row.aggregate_id, revision: Number(row.revision) } : undefined;
  }

  async resolveAll(
    workspaceId: string,
    refs: TypedRef[],
  ): Promise<Map<string, { aggregateId: string; revision: number }>> {
    const found = new Map<string, { aggregateId: string; revision: number }>();
    if (refs.length === 0) return found;

    // Parallel arrays + `unnest` keep this one statement and one round trip; the
    // pair join is what rejects a correct UUID under the wrong kind.
    const result = await this.db.query<RegistryRow>(
      `${SELECT_COLUMNS}
         FROM unnest($2::text[], $3::uuid[]) AS ref(kind, id)
         JOIN domain_subjects s ON s.workspace_id = $1 AND s.id = ref.id AND s.kind = ref.kind
         JOIN aggregate_heads h ON h.workspace_id = s.workspace_id AND h.aggregate_id = s.aggregate_id`,
      [workspaceId, refs.map((ref) => ref.kind), refs.map((ref) => ref.id)],
    );
    for (const row of result.rows) {
      found.set(`${row.kind}:${row.subject_id}`, { aggregateId: row.aggregate_id, revision: Number(row.revision) });
    }
    return found;
  }
}
