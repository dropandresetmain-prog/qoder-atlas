import type { Pool, PoolClient } from '../../persistence/postgres/pool.ts';
import type { ChangeRequestRecord } from '../../contracts/v2/change/changeRequest.ts';
import type { ChangeRequestPlanningBasis } from '../../contracts/v2/planning/changeRequestPlanning.ts';
import { planningBasisFromChangeRequest } from '../../contracts/v2/planning/changeRequestPlanning.ts';
import { PgChangeRequestRepository } from '../../persistence/postgres/repositories/pgChangeRequestRepository.ts';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export type CaseRequestRead =
  | { ok: true; request?: ChangeRequestRecord; basis?: ChangeRequestPlanningBasis }
  | { ok: false; code: 'REQUEST_NOT_FOUND' | 'REQUEST_NOT_LINKED' | 'REQUEST_CASE_SCOPE_MISMATCH' | 'REQUEST_NOT_ACCEPTED' | 'MULTIPLE_CASE_REQUESTS'; message: string };

async function linkedRequestIds(db: Queryable, workspaceId: string, caseId: string): Promise<string[]> {
  const rows = await db.query<{ subject_id: string }>(
    `SELECT subject_id FROM case_subjects
      WHERE workspace_id = $1 AND recovery_case_id = $2 AND subject_kind = 'CHANGE_REQUEST'
      ORDER BY subject_id`,
    [workspaceId, caseId],
  );
  return rows.rows.map((row) => row.subject_id);
}

/** Resolve the single request explicitly owned by a Case. */
export async function loadCaseRequest(
  db: Queryable,
  workspaceId: string,
  caseId: string,
  requestedId?: string,
  options: { requireAccepted?: boolean } = {},
): Promise<CaseRequestRead> {
  const linkedIds = await linkedRequestIds(db, workspaceId, caseId);
  if (requestedId) {
    if (!linkedIds.includes(requestedId)) {
      return { ok: false, code: 'REQUEST_NOT_LINKED', message: `change request ${requestedId} is not a subject of recovery case ${caseId}` };
    }
  } else if (linkedIds.length === 0) {
    return { ok: true };
  } else if (linkedIds.length > 1) {
    return { ok: false, code: 'MULTIPLE_CASE_REQUESTS', message: `recovery case ${caseId} has ${linkedIds.length} change requests; select one explicitly` };
  }

  const requestId = requestedId ?? linkedIds[0]!;
  const request = await new PgChangeRequestRepository(db).loadChangeRequest(workspaceId, requestId);
  if (!request) return { ok: false, code: 'REQUEST_NOT_FOUND', message: `change request ${requestId} does not exist` };

  const journey = await db.query<{ present: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM case_subjects
        WHERE workspace_id = $1 AND recovery_case_id = $2
          AND subject_kind = 'JOURNEY' AND subject_id = $3
     ) AS present`,
    [workspaceId, caseId, request.journeyId],
  );
  if (journey.rows[0]?.present !== true) {
    return { ok: false, code: 'REQUEST_CASE_SCOPE_MISMATCH', message: `request ${request.id} journey ${request.journeyId} is outside recovery case ${caseId}` };
  }
  if (options.requireAccepted && request.lifecycle !== 'ACCEPTED_FOR_PLANNING') {
    return { ok: false, code: 'REQUEST_NOT_ACCEPTED', message: `change request ${request.id} is ${request.lifecycle}, expected ACCEPTED_FOR_PLANNING` };
  }
  if (request.lifecycle !== 'ACCEPTED_FOR_PLANNING') return { ok: true, request };
  return { ok: true, request, basis: planningBasisFromChangeRequest(request) };
}
