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
      actor_role: string;
      required_party_kind: string | null;
      organisation_label: string | null;
      traveller_label: string | null;
    }>(
      `WITH decision_events AS (
         SELECT a.id AS event_id, ap.recovery_case_id AS case_id,
                ai.operation_namespace, ai.capability_ref,
                a.approved_at AS decision_at, 'approval'::text AS decision_kind,
                ar.actor_role, ar.required_party_kind,
                COALESCE(org.display_name, org.legal_name) AS organisation_label,
                tn.display_value AS traveller_label
           FROM approvals a
           JOIN authority_decisions ad
             ON ad.workspace_id = a.workspace_id AND ad.id = a.decision_id
           JOIN action_plans ap
             ON ap.workspace_id = ad.workspace_id AND ap.id = ad.action_plan_id
           JOIN action_intents ai
             ON ai.workspace_id = ad.workspace_id AND ai.id = ad.action_intent_id
           JOIN approval_requirements ar
             ON ar.workspace_id = a.workspace_id AND ar.id = a.requirement_id
           LEFT JOIN organisations org
             ON org.workspace_id = ar.workspace_id
            AND ar.required_party_kind = 'ORGANISATION'
            AND org.id = ar.required_party_id
           LEFT JOIN LATERAL (
             SELECT tn.display_value
               FROM case_subjects cs
               JOIN journeys j ON j.workspace_id = cs.workspace_id AND j.id = cs.subject_id
               JOIN travellers t ON t.workspace_id = j.workspace_id AND t.id = j.traveller_id
               JOIN traveller_names tn ON tn.workspace_id = t.workspace_id AND tn.id = t.display_name_ref
              WHERE cs.workspace_id = ap.workspace_id AND cs.recovery_case_id = ap.recovery_case_id
                AND cs.subject_kind = 'JOURNEY'
              ORDER BY cs.subject_id
              LIMIT 1
           ) tn ON true
          WHERE a.workspace_id = $1
         UNION ALL
         SELECT r.id AS event_id, ap.recovery_case_id AS case_id,
                ai.operation_namespace, ai.capability_ref,
                r.revoked_at AS decision_at, 'revocation'::text AS decision_kind,
                ar.actor_role, ar.required_party_kind,
                COALESCE(org.display_name, org.legal_name) AS organisation_label,
                tn.display_value AS traveller_label
           FROM approval_revocations r
           JOIN approvals a
             ON a.workspace_id = r.workspace_id AND a.id = r.approval_id
           JOIN authority_decisions ad
             ON ad.workspace_id = a.workspace_id AND ad.id = a.decision_id
           JOIN action_plans ap
             ON ap.workspace_id = ad.workspace_id AND ap.id = ad.action_plan_id
           JOIN action_intents ai
             ON ai.workspace_id = ad.workspace_id AND ai.id = ad.action_intent_id
           JOIN approval_requirements ar
             ON ar.workspace_id = a.workspace_id AND ar.id = a.requirement_id
           LEFT JOIN organisations org
             ON org.workspace_id = ar.workspace_id
            AND ar.required_party_kind = 'ORGANISATION'
            AND org.id = ar.required_party_id
           LEFT JOIN LATERAL (
             SELECT tn.display_value
               FROM case_subjects cs
               JOIN journeys j ON j.workspace_id = cs.workspace_id AND j.id = cs.subject_id
               JOIN travellers t ON t.workspace_id = j.workspace_id AND t.id = j.traveller_id
               JOIN traveller_names tn ON tn.workspace_id = t.workspace_id AND tn.id = t.display_name_ref
              WHERE cs.workspace_id = ap.workspace_id AND cs.recovery_case_id = ap.recovery_case_id
                AND cs.subject_kind = 'JOURNEY'
              ORDER BY cs.subject_id
              LIMIT 1
           ) tn ON true
          WHERE r.workspace_id = $1
       )
       SELECT event_id, case_id, operation_namespace, capability_ref, decision_at,
              decision_kind, actor_role, required_party_kind, organisation_label,
              traveller_label
         FROM decision_events
        ORDER BY decision_at DESC, event_id DESC
        LIMIT 20`,
      [workspaceId],
    );
    const actorLabel = (row: { actor_role: string; required_party_kind: string | null; organisation_label: string | null }): string => {
      if (row.required_party_kind === 'TRAVELLER' || /traveller/i.test(row.actor_role)) return 'Traveller';
      if (row.organisation_label) return row.organisation_label;
      return 'Organiser';
    };
    const operationLabel = (row: { operation_namespace: string; capability_ref: string; traveller_label: string | null }): string => {
      const operation = (row.operation_namespace || row.capability_ref)
        .replace(/[_:.-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const humanOperation = operation ? `${operation[0]!.toUpperCase()}${operation.slice(1)}` : 'Recovery action';
      return row.traveller_label ? `${row.traveller_label} · ${humanOperation}` : humanOperation;
    };
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
              actorLabel: actorLabel(row),
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
