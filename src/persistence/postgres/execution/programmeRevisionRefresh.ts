/**
 * Dependency-aware Programme revision refresh for sequential same-aggregate
 * ActionIntents. Reads durable observation payloads — never mutates
 * append-only action_intents.
 */
import type { Pool, PoolClient } from '../pool.ts';

export const INTERNAL_PROGRAMME_SCHEDULE_CAPABILITY_REF = 'internal:programme.schedule';

type Queryable = Pick<Pool | PoolClient, 'query'>;

export async function observedProgrammeRevisionFromPrerequisites(
  db: Queryable,
  workspaceId: string,
  intentId: string,
  programmeId: string,
): Promise<number | undefined> {
  const prereq = await db.query<{ observed_revision: string | null }>(
    `SELECT MAX((eo.source_owned_fields->>'programmeRevision')::int)::text AS observed_revision
       FROM action_dependencies d
       JOIN execution_attempts ea
         ON ea.workspace_id = d.workspace_id
        AND ea.action_intent_id = d.from_action_intent_id
        AND ea.status IN ('OBSERVED_SUCCESS', 'COMPLETED', 'RECONCILED')
       JOIN execution_observations eo
         ON eo.workspace_id = ea.workspace_id
        AND eo.attempt_id = ea.id
       JOIN action_intents ai
         ON ai.workspace_id = d.workspace_id
        AND ai.id = d.from_action_intent_id
      WHERE d.workspace_id = $1
        AND d.to_action_intent_id = $2
        AND ai.capability_ref = $3
        AND eo.source_owned_fields->>'programmeId' = $4
        AND eo.source_owned_fields ? 'programmeRevision'`,
    [workspaceId, intentId, INTERNAL_PROGRAMME_SCHEDULE_CAPABILITY_REF, programmeId],
  );
  const observed = prereq.rows[0]?.observed_revision;
  if (observed == null || observed === '') return undefined;
  return Number(observed);
}
