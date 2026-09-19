/**
 * Read-only PostgreSQL producers for the shell's secondary operator surfaces
 * — Programme, Decisions and Activity.
 *
 * Each runs inside `withProjectionSnapshot`, so a surface never mixes two
 * points in time, and each reads only authoritative rows. They compute no
 * viability, no readiness and no policy: Programme reports the schedule and
 * accepted participation the programme actually holds, Decisions reports the
 * cases the case lifecycle itself says are awaiting authority, and Activity
 * reports committed change records. A baseline world where all three are
 * near-empty is a truthful answer, not a defect to fill in.
 */
import type { Pool } from '../../../persistence/postgres/pool.ts';
import { z } from 'zod';
import type {
  ActivityFeed,
  DecisionQueue,
  ProgrammeSchedule,
} from '../../../contracts/v2/product/readModels.ts';
import { formatInstant, formatShort } from '../../../ui/html.ts';
import { withProjectionSnapshot } from './pgFactAssembler.ts';

/** Commands name themselves in the past tense already; present them as words. */
function phraseCommand(namespace: string): string {
  return namespace
    .toLowerCase()
    .split('_')
    .join(' ');
}

export async function loadProgrammeSchedule(pool: Pool, workspaceId: string): Promise<ProgrammeSchedule> {
  const { value } = await withProjectionSnapshot(pool, async (client) => {
    const generatedAt = new Date().toISOString();
    const event = await client.query<{ title: string }>(
      `SELECT e.title
         FROM programmes prog
         JOIN events e ON e.workspace_id = prog.workspace_id AND e.id = prog.event_id
        WHERE prog.workspace_id = $1 AND prog.lifecycle_status = 'ACTIVE'
        LIMIT 2`,
      [workspaceId],
    );
    const rows = await client.query<{
      id: string;
      title: string;
      item_type: string;
      window_start: Date | null;
      window_end: Date | null;
      lifecycle_status: string;
      place_name: string | null;
      operating_requirements: { requiresPhysicalPresence?: boolean } | null;
      required_participants: number;
      optional_participants: number;
      affected_case_id: string | null;
      affected_case_count: number;
    }>(
      `SELECT pi.id, pi.title, pi.item_type, pi.window_start, pi.window_end,
              pi.lifecycle_status, pl.name AS place_name, pi.operating_requirements,
              count(p.id) FILTER (WHERE p.obligation = 'REQUIRED' AND p.accepted)::int AS required_participants,
              count(p.id) FILTER (WHERE p.obligation <> 'REQUIRED' AND p.accepted)::int AS optional_participants,
              (SELECT (array_agg(DISTINCT rc.id::text))[1]
                 FROM participations pp
                 JOIN journeys jj ON jj.workspace_id = pp.workspace_id AND jj.traveller_id = pp.traveller_id
                 JOIN case_subjects cs ON cs.workspace_id = jj.workspace_id AND cs.subject_kind = 'JOURNEY'
                                       AND cs.subject_id = jj.id
                 JOIN recovery_cases rc ON rc.workspace_id = cs.workspace_id AND rc.id = cs.recovery_case_id
                WHERE pp.workspace_id = pi.workspace_id AND pp.programme_item_id = pi.id
                  AND pp.accepted AND rc.closed_at IS NULL) AS affected_case_id,
              (SELECT count(DISTINCT rc.id)::int
                 FROM participations pp
                 JOIN journeys jj ON jj.workspace_id = pp.workspace_id AND jj.traveller_id = pp.traveller_id
                 JOIN case_subjects cs ON cs.workspace_id = jj.workspace_id AND cs.subject_kind = 'JOURNEY'
                                       AND cs.subject_id = jj.id
                 JOIN recovery_cases rc ON rc.workspace_id = cs.workspace_id AND rc.id = cs.recovery_case_id
                WHERE pp.workspace_id = pi.workspace_id AND pp.programme_item_id = pi.id
                  AND pp.accepted AND rc.closed_at IS NULL) AS affected_case_count
         FROM programme_items pi
         JOIN programmes prog ON prog.workspace_id = pi.workspace_id AND prog.id = pi.programme_id
         LEFT JOIN places pl ON pl.workspace_id = pi.workspace_id AND pl.id = pi.place_id
         LEFT JOIN participations p
                ON p.workspace_id = pi.workspace_id AND p.programme_item_id = pi.id
        WHERE pi.workspace_id = $1 AND prog.lifecycle_status = 'ACTIVE'
        GROUP BY pi.workspace_id, pi.id, pi.title, pi.item_type, pi.window_start, pi.window_end,
                 pi.lifecycle_status, pl.name, pi.operating_requirements
        ORDER BY pi.window_start NULLS LAST, pi.title`,
      [workspaceId],
    );
    return {
      generatedAt,
      // No ACTIVE programme, or more than one, means the workspace has no
      // single "the event you are working" — say so rather than pick one.
      eventTitle: event.rowCount === 1 ? event.rows[0]!.title : 'No single active programme',
      items: rows.rows.map((row) => ({
        itemRef: `PROGRAMME_ITEM:${row.id}`,
        label: row.title,
        itemType: row.item_type,
        ...(row.window_start && row.window_end
          ? {
            windowLabel: `${formatShort(row.window_start.toISOString())} – ${formatShort(row.window_end.toISOString())}`,
            windowStart: row.window_start.toISOString(),
            windowEnd: row.window_end.toISOString(),
          }
          : {}),
        ...(row.affected_case_id ? { affectedCaseRef: row.affected_case_id } : {}),
        ...(row.affected_case_count > 0 ? { affectedCaseCount: row.affected_case_count } : {}),
        ...(row.place_name ? { placeLabel: row.place_name } : {}),
        lifecycleStatus: row.lifecycle_status,
        requiredParticipants: row.required_participants,
        optionalParticipants: row.optional_participants,
        requiresPhysicalPresence: row.operating_requirements?.requiresPhysicalPresence === true,
      })),
    };
  });
  return value;
}

export async function loadDecisionQueue(pool: Pool, workspaceId: string): Promise<DecisionQueue> {
  const { value } = await withProjectionSnapshot(pool, async (client) => {
    const rows = await client.query<{
      id: string;
      lifecycle_status: string;
      opened_at: Date;
      subject_labels: string[] | null;
    }>(
      `SELECT rc.id, rc.lifecycle_status, rc.opened_at,
              array_remove(array_agg(DISTINCT n.display_value), NULL) AS subject_labels
         FROM recovery_cases rc
         LEFT JOIN case_subjects cs
                ON cs.workspace_id = rc.workspace_id AND cs.recovery_case_id = rc.id
               AND cs.subject_kind = 'JOURNEY'
         LEFT JOIN journeys j ON j.workspace_id = cs.workspace_id AND j.id = cs.subject_id
         LEFT JOIN travellers t ON t.workspace_id = j.workspace_id AND t.id = j.traveller_id
         LEFT JOIN traveller_names n ON n.workspace_id = t.workspace_id AND n.id = t.display_name_ref
        WHERE rc.workspace_id = $1 AND rc.closed_at IS NULL
        GROUP BY rc.id, rc.lifecycle_status, rc.opened_at
        ORDER BY rc.opened_at DESC
        LIMIT 100`,
      [workspaceId],
    );
    const recent = await client.query<{
      event_id: string;
      case_id: string;
      operation_namespace: string;
      capability_ref: string;
      decision_at: Date;
      decision_kind: 'approval' | 'revocation';
      actor_principal_id: string;
      actor_label: string | null;
    }>(
      `WITH decision_events AS (
         SELECT a.id AS event_id, ap.recovery_case_id AS case_id,
                ai.operation_namespace, ai.capability_ref,
                a.approved_at AS decision_at, 'approval'::text AS decision_kind,
                a.approver_principal_id AS actor_principal_id
           FROM approvals a
           JOIN authority_decisions ad
             ON ad.workspace_id = a.workspace_id AND ad.id = a.decision_id
           JOIN action_plans ap
             ON ap.workspace_id = ad.workspace_id AND ap.id = ad.action_plan_id
           JOIN action_intents ai
             ON ai.workspace_id = ad.workspace_id AND ai.id = ad.action_intent_id
          WHERE a.workspace_id = $1
         UNION ALL
         SELECT r.id AS event_id, ap.recovery_case_id AS case_id,
                ai.operation_namespace, ai.capability_ref,
                r.revoked_at AS decision_at, 'revocation'::text AS decision_kind,
                r.revoked_by_principal_id AS actor_principal_id
           FROM approval_revocations r
           JOIN approvals a
             ON a.workspace_id = r.workspace_id AND a.id = r.approval_id
           JOIN authority_decisions ad
             ON ad.workspace_id = a.workspace_id AND ad.id = a.decision_id
           JOIN action_plans ap
             ON ap.workspace_id = ad.workspace_id AND ap.id = ad.action_plan_id
           JOIN action_intents ai
             ON ai.workspace_id = ad.workspace_id AND ai.id = ad.action_intent_id
          WHERE r.workspace_id = $1
       )
       SELECT de.event_id, de.case_id, de.operation_namespace, de.capability_ref,
              de.decision_at, de.decision_kind, de.actor_principal_id,
              actor.actor_label
         FROM decision_events de
         LEFT JOIN LATERAL (
           SELECT CASE
                    WHEN grant_party.represented_party_kind = 'ORGANISATION'
                         AND COALESCE(org.display_name, org.legal_name) IS NOT NULL
                      THEN COALESCE(org.display_name, org.legal_name)
                    WHEN p.actor_type = 'HUMAN' THEN 'Person'
                    ELSE 'Reviewer'
                  END AS actor_label
             FROM principals p
             LEFT JOIN LATERAL (
               SELECT g.represented_party_kind, g.represented_party_id
                 FROM authority_grants g
                WHERE g.workspace_id = $1
                  AND g.principal_id = de.actor_principal_id
                  AND g.issued_at <= de.decision_at
                  AND (g.revoked_at IS NULL OR g.revoked_at >= de.decision_at)
                  AND (g.expires_at IS NULL OR g.expires_at > de.decision_at)
                ORDER BY g.issued_at DESC, g.id DESC
                LIMIT 1
             ) grant_party ON true
             LEFT JOIN organisations org
               ON org.workspace_id = $1
              AND grant_party.represented_party_kind = 'ORGANISATION'
              AND org.id = grant_party.represented_party_id
            WHERE p.workspace_id = $1 AND p.id = de.actor_principal_id
            LIMIT 1
         ) actor ON true
        ORDER BY decision_at DESC, event_id DESC
        LIMIT 20`,
      [workspaceId],
    );
    const operationLabels: Record<string, string> = {
      'internal.programme': 'Programme time change',
      'internal.reservation': 'Reservation change',
      'internal.journey': 'Journey change',
      'internal.support': 'Traveller support change',
      'internal.objective': 'Programme objective change',
      'provider.flight': 'Flight booking',
      'provider.offer': 'Flight booking',
      'provider.hotel': 'Hotel booking',
      'provider.transfer': 'Transfer booking',
    };
    const operationLabel = (row: { operation_namespace: string; capability_ref: string }): string =>
      operationLabels[row.operation_namespace] ?? operationLabels[row.capability_ref] ?? 'Recovery action';
    return {
      generatedAt: new Date().toISOString(),
      decisions: rows.rows.map((row) => ({
        caseRef: row.id,
        status: row.lifecycle_status,
        openedAtLabel: formatInstant(row.opened_at.toISOString()),
        openedAt: row.opened_at.toISOString(),
        subjectLabels: row.subject_labels ?? [],
        awaitingAuthority: row.lifecycle_status === 'AWAITING_AUTHORITY',
      })),
      ...(recent.rows.length > 0
        ? {
            recentDecisions: recent.rows.map((row) => ({
              caseRef: row.case_id,
              label: operationLabel(row),
              decisionAt: row.decision_at.toISOString(),
              actorLabel: row.actor_label ?? 'Reviewer',
              kind: row.decision_kind,
            })),
          }
        : {}),
    };
  });
  return value;
}

const ACTIVITY_PAGE = 20;

export class ActivityCursorError extends Error {}

export async function loadActivityFeed(pool: Pool, workspaceId: string, beforeCursor?: string): Promise<ActivityFeed> {
  if (beforeCursor !== undefined && !z.string().uuid().safeParse(beforeCursor).success) {
    throw new ActivityCursorError('This activity page link is invalid. Open the latest activity and try again.');
  }
  const { value } = await withProjectionSnapshot(pool, async (client) => {
    if (beforeCursor !== undefined) {
      const cursor = await client.query('SELECT 1 FROM change_records WHERE workspace_id = $1 AND id = $2', [workspaceId, beforeCursor]);
      if (cursor.rowCount !== 1) throw new ActivityCursorError('This activity page is no longer available. Open the latest activity.');
    }
    // Compare the stored tuple inside PostgreSQL: converting the anchor through
    // JavaScript Date would discard microseconds and skip tied audit entries.
    const rows = await client.query<{
      id: string;
      occurred_at: Date;
      actor_principal_id: string;
      subject_kind: string;
      subject_id: string;
      command_namespace: string;
      reason: string | null;
      actor_type: 'HUMAN' | 'SERVICE' | 'SYSTEM' | null;
      subject_name: string | null;
      case_id: string | null;
    }>(
      `SELECT cr.id, cr.occurred_at, cr.actor_principal_id, cr.subject_kind, cr.subject_id,
              cr.command_namespace, cr.reason, pr.actor_type,
              (SELECT n.display_value
                 FROM travellers t
                 JOIN traveller_names n ON n.workspace_id = t.workspace_id AND n.id = t.display_name_ref
                WHERE t.workspace_id = cr.workspace_id
                  AND ((cr.subject_kind = 'TRAVELLER' AND t.id = cr.subject_id)
                    OR (cr.subject_kind = 'JOURNEY' AND t.id = (
                          SELECT j.traveller_id FROM journeys j
                           WHERE j.workspace_id = cr.workspace_id AND j.id = cr.subject_id)))
                LIMIT 1) AS subject_name,
              CASE WHEN cr.subject_kind = 'RECOVERY_CASE' THEN cr.subject_id::text
                   ELSE (SELECT cs.recovery_case_id::text FROM case_subjects cs
                          WHERE cs.workspace_id = cr.workspace_id AND cs.subject_id = cr.subject_id
                          LIMIT 1) END AS case_id
         FROM change_records cr
         LEFT JOIN principals pr ON pr.workspace_id = cr.workspace_id AND pr.id::text = cr.actor_principal_id
        WHERE cr.workspace_id = $1
          AND ($2::uuid IS NULL OR (cr.occurred_at, cr.id) < (
            SELECT anchor.occurred_at, anchor.id FROM change_records anchor
             WHERE anchor.workspace_id = $1 AND anchor.id = $2::uuid
          ))
        ORDER BY cr.occurred_at DESC, cr.id DESC
        LIMIT ${ACTIVITY_PAGE + 1}`,
      [workspaceId, beforeCursor ?? null],
    );
    const page = rows.rows.slice(0, ACTIVITY_PAGE);
    return {
      generatedAt: new Date().toISOString(),
      entries: page.map((row) => ({
        entryRef: row.id,
        atLabel: formatInstant(row.occurred_at.toISOString()),
        actorLabel: row.actor_principal_id,
        subjectLabel: `${row.subject_kind}:${row.subject_id}`,
        what: phraseCommand(row.command_namespace),
        ...(row.reason ? { reason: row.reason } : {}),
        subjectKind: row.subject_kind,
        ...(row.subject_name ? { subjectName: row.subject_name } : {}),
        ...(row.actor_type ? { actorKind: row.actor_type } : {}),
        ...(row.case_id ? { caseRef: row.case_id } : {}),
      })),
      truncated: rows.rows.length > ACTIVITY_PAGE,
      ...(rows.rows.length > ACTIVITY_PAGE ? { nextCursor: page.at(-1)!.id } : {}),
      ...(beforeCursor ? { beforeCursor } : {}),
    };
  });
  return value;
}
