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
    };
  });
  return value;
}

const ACTIVITY_PAGE = 50;

export async function loadActivityFeed(pool: Pool, workspaceId: string): Promise<ActivityFeed> {
  const { value } = await withProjectionSnapshot(pool, async (client) => {
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
        ORDER BY cr.occurred_at DESC, cr.id DESC
        LIMIT ${ACTIVITY_PAGE + 1}`,
      [workspaceId],
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
    };
  });
  return value;
}
