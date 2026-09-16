/**
 * M10 Phase 5 — category handlers beyond the AT23 vertical slice.
 *
 * Each handler answers one question: what does the target genuinely need to
 * hold for this legacy category, given the target's own command surface?
 *
 * Three outcomes recur, and the difference between them matters:
 *
 *  - IMPORTED   — the target has a real command for this, and the data maps
 *                 deterministically onto it.
 *  - ARCHIVED   — the target has no authoring command because in the target
 *                 this state is DERIVED, not authored (cases, signals), or the
 *                 legacy shape has no faithful target expression. The content
 *                 survives as immutable evidence and is never presented as
 *                 current truth.
 *  - QUARANTINED— mapping would require a guess. The source is preserved and
 *                 an owned exception says exactly what is missing.
 *
 * OFFLINE MIGRATION ONLY. Never reachable from normal app composition.
 */

import type { MigrationSourceRecord } from './legacyExportBundle.ts';
import { legacyTripElementRecord, legacyTripElementSourceId } from './legacyExportBundle.ts';
import { isSettledProviderStatus, isUncertainReservationState } from './legacyUncertainty.ts';
import {
  archiveLegacyRecord,
  asObject,
  conflictText,
  str,
  unreadable,
  type ImportContext,
  type RecordException,
  type RecordOutcome,
} from './legacyImportContext.ts';
import { createPlace } from '../persistence/postgres/commands/geographyCommands.ts';
import {
  createEvent,
  createProgramme,
  addProgrammeItem,
} from '../persistence/postgres/commands/programmeCommands.ts';
import {
  createTransportService,
  createReservation,
  addReservationLine,
} from '../persistence/postgres/commands/arrangementCommands.ts';

export const LEGACY_ORGANISATION_ASSERTION = 'LEGACY_ORGANISATION';
export const LEGACY_RULE_SET_ASSERTION = 'LEGACY_RULE_SET';
export const LEGACY_RECOVERY_CASE_ASSERTION = 'LEGACY_RECOVERY_CASE';
export const LEGACY_CHANGE_SIGNAL_ASSERTION = 'LEGACY_CHANGE_SIGNAL';
export const LEGACY_AUDIT_ENTRY_ASSERTION = 'LEGACY_AUDIT_ENTRY';
export const LEGACY_BOOKING_DOSSIER_ASSERTION = 'LEGACY_BOOKING_DOSSIER';
export const LEGACY_PREFERENCE_ASSERTION = 'LEGACY_PREFERENCE';
export const LEGACY_FX_RATE_ASSERTION = 'LEGACY_FX_RATE_OBSERVATION';
export const LEGACY_PROVIDER_DELIVERY_ASSERTION = 'LEGACY_PROVIDER_EVENT_DELIVERY';
export const LEGACY_PROVIDER_BOOKING_REF_ASSERTION = 'LEGACY_PROVIDER_BOOKING_REF';
export const LEGACY_UNBOOKED_ELEMENT_ASSERTION = 'LEGACY_UNBOOKED_ELEMENT';
export const LEGACY_PROGRAMME_ITEM_WINDOW_ASSERTION = 'LEGACY_PROGRAMME_ITEM_WINDOW';

/** A legacy `Fact<T>` wrapper, or a bare value from an older row. */
function factValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const wrapped = asObject(value);
  return wrapped === undefined ? undefined : str(wrapped.value);
}

/**
 * Resolve any legacy id to whatever it migrated into, trying each identity
 * namespace that could plausibly own it. Returns undefined rather than
 * guessing when nothing matches.
 */
async function resolveAnySubject(
  ctx: ImportContext,
  legacyId: string,
): Promise<{ targetKind: string; targetId: string } | undefined> {
  const namespaces = [
    'trips.journey',
    'trips',
    'entities.TRAVELLER',
    'entities.ORGANISATION',
    'entities.PLACE',
    'entities.ANCHOR_EVENT',
    'sources',
  ];
  for (const sourceType of namespaces) {
    const hit = await ctx.resolve(sourceType, legacyId);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Geography and programme
// ---------------------------------------------------------------------------

/**
 * A Place without an IANA zone cannot migrate. Every window the target
 * computes against a place is zone-dependent, so a guessed zone would shift
 * arrival readiness silently rather than fail visibly.
 */
export async function importPlace(ctx: ImportContext, record: MigrationSourceRecord): Promise<RecordOutcome> {
  const payload = asObject(record.payload);
  if (payload === undefined) {
    return unreadable(record, 'PLACE', 'anything scheduled at this place loses its location', false);
  }
  const name = str(payload.name);
  const placeType = str(payload.kind);
  const timeZone = str(payload.timezone);
  const missing = [
    name === undefined ? 'name' : undefined,
    placeType === undefined ? 'kind' : undefined,
    timeZone === undefined ? 'timezone' : undefined,
  ].filter((field): field is string => field !== undefined);

  if (name === undefined || placeType === undefined || timeZone === undefined) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'QUARANTINED_UNREADABLE_SOURCE',
        reason: `legacy PLACE is missing required field(s): ${missing.join(', ')}`,
        affectedScope: `place ${record.sourceId}`,
        safetyImpact:
          missing.includes('timezone')
            ? 'a guessed time zone would shift every window computed against this place without failing'
            : 'the place cannot be named in the target, so anything scheduled there cannot resolve it',
        owner: 'migration owner',
        blocksCutover: false,
      },
    };
  }

  const legacyCoordinates = asObject(payload.coordinates);
  const lat = typeof legacyCoordinates?.latitude === 'number' ? legacyCoordinates.latitude : undefined;
  const lng = typeof legacyCoordinates?.longitude === 'number' ? legacyCoordinates.longitude : undefined;

  const outcome = await createPlace(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: ctx.idempotencyKey(record, 'place'),
    placeId: ctx.targetId(record, 'place'),
    name,
    placeType,
    timeZone,
    ...(lat === undefined || lng === undefined ? {} : { coordinates: { lat, lng } }),
    evidenceRefs: [ctx.runEvidenceId],
  });
  if (!outcome.ok) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'TARGET_REJECTED_WRITE',
        reason: `target rejected PLACE_CREATED — ${conflictText(outcome.conflict)}`,
        affectedScope: `place ${record.sourceId}`,
        safetyImpact: 'anything scheduled at this place cannot resolve its location or zone',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }
  return {
    kind: 'IMPORTED',
    targetKind: 'PLACE',
    targetId: outcome.value.placeId,
    note: `legacy place migrated with its declared zone ${timeZone}`,
  };
}

/**
 * A legacy AnchorEvent becomes Event -> Programme -> ProgrammeItem[]. The
 * legacy model had no Programme layer, so exactly one is synthesised per
 * event: a deterministic structural transform, not new information.
 */
export async function importAnchorEvent(
  ctx: ImportContext,
  record: MigrationSourceRecord,
): Promise<RecordOutcome> {
  const payload = asObject(record.payload);
  if (payload === undefined) {
    return unreadable(record, 'ANCHOR_EVENT', 'a shared commitment everyone is travelling for would vanish', true);
  }
  const title = str(payload.name);
  if (title === undefined) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'QUARANTINED_UNREADABLE_SOURCE',
        reason: 'legacy ANCHOR_EVENT has no name; the target requires a title and must not invent one',
        affectedScope: `event ${record.sourceId}`,
        safetyImpact: 'the reason the trips exist becomes unidentifiable',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }

  const legacyOrganiserId = str(payload.organiserOrganisationId);
  const organiser =
    legacyOrganiserId === undefined ? undefined : await ctx.resolve('entities.ORGANISATION', legacyOrganiserId);
  if (legacyOrganiserId !== undefined && organiser === undefined) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'QUARANTINED_AMBIGUOUS_IDENTITY',
        reason: `legacy event names organiser "${legacyOrganiserId}", which has no migrated target identity`,
        affectedScope: `event ${record.sourceId}`,
        safetyImpact: 'organiser authority over the programme would be misattributed',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }

  const eventOutcome = await createEvent(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: ctx.idempotencyKey(record, 'event'),
    eventId: ctx.targetId(record, 'event'),
    title,
    ...(organiser === undefined ? {} : { organiserOrganisationId: organiser.targetId }),
    lifecycleStatus: 'ACTIVE',
    evidenceRefs: [ctx.runEvidenceId],
  });
  if (!eventOutcome.ok) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'TARGET_REJECTED_WRITE',
        reason: `target rejected EVENT_CREATED — ${conflictText(eventOutcome.conflict)}`,
        affectedScope: `event ${record.sourceId}`,
        safetyImpact: 'the shared undertaking behind the trips does not exist in the target',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }

  const commitments = Array.isArray(payload.commitments) ? payload.commitments : [];
  if (commitments.length === 0) {
    return {
      kind: 'IMPORTED',
      targetKind: 'EVENT',
      targetId: eventOutcome.value.eventId,
      note: 'legacy anchor event migrated; it carried no commitments, so no programme was synthesised',
    };
  }

  const programmeOutcome = await createProgramme(ctx.uow(), {
    workspaceId: ctx.workspaceId,
    actorPrincipalId: ctx.actorPrincipalId,
    idempotencyKey: ctx.idempotencyKey(record, 'programme'),
    programmeId: ctx.targetId(record, 'programme'),
    eventId: eventOutcome.value.eventId,
    title,
    lifecycleStatus: 'ACTIVE',
    expectedEventRevision: eventOutcome.value.revision,
    evidenceRefs: [ctx.runEvidenceId],
  });
  if (!programmeOutcome.ok) {
    return {
      kind: 'QUARANTINED',
      exception: {
        classification: 'TARGET_REJECTED_WRITE',
        reason: `target rejected PROGRAMME_CREATED — ${conflictText(programmeOutcome.conflict)}`,
        affectedScope: `event ${record.sourceId} and its ${commitments.length} commitment(s)`,
        safetyImpact: 'the commitments people are travelling for have nowhere to live',
        owner: 'migration owner',
        blocksCutover: true,
      },
    };
  }

  let revision = programmeOutcome.value.revision;
  let migrated = 0;
  const windowless: string[] = [];

  for (const [index, raw] of commitments.entries()) {
    const commitment = asObject(raw);
    const commitmentId = str(commitment?.id) ?? `${record.sourceId}#${index}`;
    const itemTitle = str(commitment?.title);
    if (commitment === undefined || itemTitle === undefined) {
      windowless.push(`${commitmentId} (unreadable)`);
      continue;
    }

    const startsAt = factValue(commitment.startsAt);
    const endsAt = factValue(commitment.endsAt);
    const legacyPlaceId = str(commitment.placeId);
    const place = legacyPlaceId === undefined ? undefined : await ctx.resolve('entities.PLACE', legacyPlaceId);

    // A start with no end cannot form the target's bounded interval, and an
    // invented duration would drive arrival readiness off a fiction. The item
    // migrates without a window and the real start is archived beside it.
    const hasWindow = startsAt !== undefined && endsAt !== undefined && startsAt < endsAt;
    if (!hasWindow && startsAt !== undefined) windowless.push(`${commitmentId} (starts ${startsAt}, no end)`);

    const itemOutcome = await addProgrammeItem(ctx.uow(), {
      workspaceId: ctx.workspaceId,
      actorPrincipalId: ctx.actorPrincipalId,
      idempotencyKey: ctx.idempotencyKey(record, `programme-item:${commitmentId}`),
      programmeId: programmeOutcome.value.programmeId,
      expectedProgrammeRevision: revision,
      item: {
        id: ctx.targetId(record, `programme-item:${commitmentId}`),
        title: itemTitle,
        itemType: str(commitment.kind) ?? 'OTHER',
        ...(place === undefined ? {} : { placeId: place.targetId }),
        ...(hasWindow ? { window: { start: startsAt, end: endsAt } } : {}),
        // An item the target cannot place in time is not SCHEDULED in the
        // target's sense, whatever the legacy row believed.
        lifecycleStatus: hasWindow ? 'SCHEDULED' : 'DRAFT',
        scheduleAuthority: 'EXTERNAL',
        externalSourceRef: `legacy:${ctx.sourceDataset}:anchor-commitment:${commitmentId}`,
      },
      evidenceRefs: [ctx.runEvidenceId],
    });
    if (!itemOutcome.ok) {
      return {
        kind: 'QUARANTINED',
        exception: {
          classification: 'TARGET_REJECTED_WRITE',
          reason: `target rejected PROGRAMME_ITEM_ADDED for commitment ${commitmentId} — ${conflictText(itemOutcome.conflict)}`,
          affectedScope: `event ${record.sourceId}, commitment ${commitmentId}`,
          safetyImpact: 'a commitment people must be present for is missing from the programme',
          owner: 'migration owner',
          blocksCutover: true,
        },
      };
    }
    revision = itemOutcome.value.programmeRevision;
    migrated += 1;
  }

  if (windowless.length > 0) {
    const archived = await archiveLegacyRecord(ctx, record, {
      assertionType: LEGACY_PROGRAMME_ITEM_WINDOW_ASSERTION,
      subject: { kind: 'PROGRAMME', id: programmeOutcome.value.programmeId },
      provenance:
        `legacy commitments ${windowless.join('; ')} carried a start with no end; the target requires a bounded ` +
        'interval, so the items migrated without a window and the legacy timing is archived here rather than ' +
        'completed with an invented duration',
    });
    if (!archived.ok) return archived.outcome;
  }

  return {
    kind: 'IMPORTED',
    targetKind: 'EVENT',
    targetId: eventOutcome.value.eventId,
    note:
      `legacy anchor event migrated as Event + one synthesised Programme with ${migrated}/${commitments.length} ` +
      `item(s)` +
      (windowless.length > 0
        ? `; ${windowless.length} item(s) have no target window — legacy timing archived as ${LEGACY_PROGRAMME_ITEM_WINDOW_ASSERTION}`
        : ''),
  };
}

// ---------------------------------------------------------------------------
// Archive-only categories
// ---------------------------------------------------------------------------

/**
 * Legacy rule sets are free text with ad-hoc parameters; the target requires
 * a RuleExpression validated against a predicate registry. Translating one to
 * the other is a policy judgement, not a deterministic transform.
 */
export async function importRuleSet(ctx: ImportContext, record: MigrationSourceRecord): Promise<RecordOutcome> {
  const payload = asObject(record.payload);
  const name = str(payload?.name) ?? record.sourceId;
  const archived = await archiveLegacyRecord(ctx, record, {
    assertionType: LEGACY_RULE_SET_ASSERTION,
    contentKind: 'rule-set',
    provenance:
      `legacy rule set "${name}" (${record.sourceId}) as it stood at export; archived verbatim because the ` +
      'target evaluates registered rule expressions and this policy has no deterministic expression mapping',
  });
  if (!archived.ok) return archived.outcome;
  return {
    kind: 'QUARANTINED',
    exception: {
      classification: 'ARCHIVED_REQUIRES_TARGET_POLICY_INPUT',
      reason:
        `legacy rule set "${name}" is preserved as ${LEGACY_RULE_SET_ASSERTION} evidence but is not enforced: ` +
        'the target needs a registered rule expression an owner must author',
      affectedScope: `rule set ${record.sourceId} and anything that cited it as governing policy`,
      safetyImpact:
        'a supplier/operational policy that used to be checked is not checked in the target until re-authored',
      owner: 'policy owner',
      blocksCutover: true,
    },
  };
}

/**
 * A target RecoveryCase is derived by the evaluate -> strategy -> plan ->
 * authority pipeline; there is no case-authoring command, by design. A
 * migrated case would therefore have no strategy, plan or authority lineage.
 * History is archived; an open case becomes unfinished work the target
 * re-derives from migrated state after cutover.
 */
export async function importRecoveryCase(ctx: ImportContext, record: MigrationSourceRecord): Promise<RecordOutcome> {
  const payload = asObject(record.payload);
  if (payload === undefined) {
    return unreadable(record, 'RECOVERY_CASE', 'unfinished recovery work could not be accounted for', true);
  }
  const status = str(payload.status) ?? 'UNKNOWN';
  const legacyTripId = str(payload.tripId);
  const journey = legacyTripId === undefined ? undefined : await ctx.resolve('trips.journey', legacyTripId);
  const isOpen = status !== 'RESOLVED' && status !== 'CLOSED' && status !== 'CANCELLED';

  const archived = await archiveLegacyRecord(ctx, record, {
    assertionType: LEGACY_RECOVERY_CASE_ASSERTION,
    ...(journey === undefined ? {} : { subject: { kind: journey.targetKind, id: journey.targetId } }),
    contentKind: 'recovery-case',
    provenance:
      `legacy recovery case ${record.sourceId} stood at status ${status} at export` +
      (legacyTripId === undefined ? '' : ` for legacy trip ${legacyTripId}`) +
      '; archived as history — it is not a target RecoveryCase and confers no authority',
  });
  if (!archived.ok) return archived.outcome;

  if (!isOpen) {
    return {
      kind: 'ARCHIVED',
      evidenceId: archived.evidenceId,
      note: `closed legacy case (${status}) archived as ${LEGACY_RECOVERY_CASE_ASSERTION} history`,
    };
  }

  return {
    kind: 'QUARANTINED',
    exception: {
      classification: 'ARCHIVED_NOT_REPLAYED_AS_LIVE_STATE',
      reason:
        `legacy recovery case ${record.sourceId} was still open (${status}) at export. The target has no ` +
        'case-authoring command because a case is derived from evaluation, strategy, plan and authority; ' +
        'fabricating one by direct write would produce a case with no lineage and no authority basis',
      affectedScope:
        journey === undefined
          ? `case ${record.sourceId} (legacy trip ${legacyTripId ?? 'unknown'}, not migrated)`
          : `case ${record.sourceId} on ${journey.targetKind} ${journey.targetId}`,
      safetyImpact:
        'in-flight recovery work is not carried across as an open case; the target must re-derive it from ' +
        'migrated state, and until it does nobody is working this disruption',
      owner: 'operations owner',
      blocksCutover: true,
    },
  };
}

/**
 * Archive, never replay. Re-injecting a historical signal into a live target
 * would re-trigger recovery for a disruption that is long over.
 */
export async function importSignal(ctx: ImportContext, record: MigrationSourceRecord): Promise<RecordOutcome> {
  const payload = asObject(record.payload);
  const legacyTripId = str(payload?.tripId);
  const journey = legacyTripId === undefined ? undefined : await ctx.resolve('trips.journey', legacyTripId);
  const kind = str(payload?.kind) ?? 'unknown kind';
  const archived = await archiveLegacyRecord(ctx, record, {
    assertionType: LEGACY_CHANGE_SIGNAL_ASSERTION,
    ...(journey === undefined ? {} : { subject: { kind: journey.targetKind, id: journey.targetId } }),
    ...(record.sourceTimestamp === undefined ? {} : { observedAt: record.sourceTimestamp }),
    contentKind: 'change-signal',
    provenance:
      `legacy change signal ${record.sourceId} (${kind}) observed by the legacy runtime; archived as history ` +
      'and deliberately not replayed as a live target signal, which would re-trigger recovery for a past event',
  });
  if (!archived.ok) return archived.outcome;
  return {
    kind: 'ARCHIVED',
    evidenceId: archived.evidenceId,
    note: `legacy signal archived as ${LEGACY_CHANGE_SIGNAL_ASSERTION} history, not replayed as live state`,
  };
}

/**
 * Append-only legacy audit. `change_records` can only be written by the
 * commands that make the change, and their before/after revisions never
 * existed in the legacy model, so the entry is archived against whatever
 * subject it named rather than fabricated as a target revision.
 */
export async function importAuditEntry(ctx: ImportContext, record: MigrationSourceRecord): Promise<RecordOutcome> {
  const payload = asObject(record.payload);
  if (payload === undefined) {
    return unreadable(record, 'AUDIT_HISTORY', 'a record of who changed what would be lost', false);
  }
  const action = str(payload.action) ?? 'UNKNOWN_ACTION';
  const actor = str(payload.actor) ?? 'unknown actor';
  const legacySubject = str(payload.subject);
  const subject = legacySubject === undefined ? undefined : await resolveAnySubject(ctx, legacySubject);
  const occurredAt = str(payload.occurredAt);

  const archived = await archiveLegacyRecord(ctx, record, {
    assertionType: LEGACY_AUDIT_ENTRY_ASSERTION,
    ...(subject === undefined ? {} : { subject: { kind: subject.targetKind, id: subject.targetId } }),
    ...(occurredAt === undefined ? {} : { observedAt: occurredAt }),
    contentKind: 'audit-entry',
    provenance:
      `legacy audit entry ${record.sourceId}: ${actor} performed ${action}` +
      (legacySubject === undefined
        ? ' against no recorded subject'
        : subject === undefined
          ? ` against legacy subject ${legacySubject}, which has no migrated target identity`
          : ` against legacy subject ${legacySubject}`) +
      '; archived as history — the target revision it would correspond to never existed in the legacy model',
  });
  if (!archived.ok) return archived.outcome;

  return {
    kind: 'ARCHIVED',
    evidenceId: archived.evidenceId,
    note:
      `legacy audit entry archived as ${LEGACY_AUDIT_ENTRY_ASSERTION}` +
      (legacySubject !== undefined && subject === undefined
        ? ` (subject ${legacySubject} unmapped — archived against its own capture so the entry survives)`
        : ''),
  };
}

/**
 * Dossier content is resolved provider detail for a traveller. The target
 * stores contact and payment values as ProtectedDataRef triples pointing at a
 * protected store; there is no protected store to put legacy plaintext in, so
 * the content is archived and the gap is owned rather than faked with a
 * synthetic hash.
 */
export async function importBookingDossier(
  ctx: ImportContext,
  record: MigrationSourceRecord,
): Promise<RecordOutcome> {
  const payload = asObject(record.payload);
  if (payload === undefined) {
    return unreadable(record, 'BOOKING_DOSSIER', 'resolved provider detail for a traveller would be lost', false);
  }
  const legacyTravellerId = str(payload.travellerId) ?? record.sourceId;
  const traveller = await ctx.resolve('entities.TRAVELLER', legacyTravellerId);

  const archived = await archiveLegacyRecord(ctx, record, {
    assertionType: LEGACY_BOOKING_DOSSIER_ASSERTION,
    ...(traveller === undefined ? {} : { subject: { kind: traveller.targetKind, id: traveller.targetId } }),
    contentKind: 'booking-dossier',
    provenance:
      `legacy booking dossier for traveller ${legacyTravellerId} as resolved at export; archived verbatim so the ` +
      'provider detail survives with lineage',
  });
  if (!archived.ok) return archived.outcome;

  return {
    kind: 'QUARANTINED',
    exception: {
      classification: 'ARCHIVED_REQUIRES_PROTECTED_CONTENT_STORE',
      reason:
        `dossier content for traveller ${legacyTravellerId} is preserved as ${LEGACY_BOOKING_DOSSIER_ASSERTION} ` +
        'evidence but is not active target profile data: contact and payment values require a ProtectedDataRef ' +
        'into a real protected store, and minting one over legacy plaintext would fabricate custody',
      affectedScope:
        traveller === undefined
          ? `dossier for legacy traveller ${legacyTravellerId} (traveller not migrated)`
          : `dossier for ${traveller.targetKind} ${traveller.targetId}`,
      safetyImpact:
        'the target cannot contact this traveller or reference their payment instrument from migrated data ' +
        'alone; anything needing it must re-collect it',
      owner: 'data protection owner',
      blocksCutover: false,
    },
  };
}

/**
 * Legacy preferences are free-text statements with an origin but no effective
 * window; the target requires a bounded one. An invented expiry would either
 * silently drop an instruction or keep a stale one alive forever.
 */
export async function importPreference(ctx: ImportContext, record: MigrationSourceRecord): Promise<RecordOutcome> {
  const payload = asObject(record.payload);
  if (payload === undefined) {
    return unreadable(record, 'PREFERENCE', 'a stated traveller preference would be lost', false);
  }
  const statement = str(payload.statement) ?? '(no statement recorded)';
  const origin = asObject(payload.origin);
  const originKind = str(origin?.kind) ?? 'UNKNOWN';
  // Explicit instructions outrank latent preferences, so losing one is a
  // materially different event from losing a soft inferred signal.
  const isExplicit = originKind.startsWith('EXPLICIT');
  const legacyTravellerId = str(payload.travellerId);
  const traveller =
    legacyTravellerId === undefined ? undefined : await ctx.resolve('entities.TRAVELLER', legacyTravellerId);

  const archived = await archiveLegacyRecord(ctx, record, {
    assertionType: LEGACY_PREFERENCE_ASSERTION,
    ...(traveller === undefined ? {} : { subject: { kind: traveller.targetKind, id: traveller.targetId } }),
    contentKind: 'preference',
    provenance:
      `legacy preference ${record.sourceId} (${originKind}): "${statement}"; archived with its original ` +
      'provenance because the target preference requires an effective window the legacy record never held',
  });
  if (!archived.ok) return archived.outcome;

  return {
    kind: 'QUARANTINED',
    exception: {
      classification: 'ARCHIVED_REQUIRES_TARGET_POLICY_INPUT',
      reason:
        `${originKind} preference "${statement}" is preserved as ${LEGACY_PREFERENCE_ASSERTION} evidence but is ` +
        'not an active target Preference: the target requires a bounded effective window, and inventing one ' +
        'would either expire a standing instruction or keep a stale one alive indefinitely',
      affectedScope:
        traveller === undefined
          ? `preference ${record.sourceId} (legacy traveller ${legacyTravellerId ?? 'unknown'}, not migrated)`
          : `preference ${record.sourceId} for ${traveller.targetKind} ${traveller.targetId}`,
      safetyImpact: isExplicit
        ? 'an explicit instruction that outranks inferred signals is not applied by target planning until an ' +
          'owner supplies its effective window'
        : 'a soft inferred signal is not applied by target planning; it never established certainty and does ' +
          'not change what is safe to do',
      owner: 'migration owner',
      blocksCutover: isExplicit,
    },
  };
}

/**
 * FX quotes are market observations with no target subject of their own, so
 * each becomes its own capture and the evidence cites it.
 */
export async function importFxRate(ctx: ImportContext, record: MigrationSourceRecord): Promise<RecordOutcome> {
  const payload = asObject(record.payload);
  const base = str(payload?.baseCurrency) ?? 'unknown base';
  const home = str(payload?.homeCurrency) ?? 'unknown home';
  const archived = await archiveLegacyRecord(ctx, record, {
    assertionType: LEGACY_FX_RATE_ASSERTION,
    contentKind: 'fx-rate',
    provenance:
      `legacy FX observation ${record.sourceId} (${base} -> ${home}) as held at export; archived as a dated ` +
      'market observation — the target converts using its own current evidence, never a migrated rate',
  });
  if (!archived.ok) return archived.outcome;
  return {
    kind: 'ARCHIVED',
    evidenceId: archived.evidenceId,
    note: `legacy FX rate archived as ${LEGACY_FX_RATE_ASSERTION}; never used as a current conversion rate`,
  };
}

/**
 * Provider deliveries are raw captures in their own right, so each becomes a
 * `source_records` row. A delivery the legacy runtime never finished
 * processing keeps its unknown outcome — it is not resolved into a failure.
 */
export async function importProviderDelivery(
  ctx: ImportContext,
  record: MigrationSourceRecord,
): Promise<RecordOutcome> {
  const payload = asObject(record.payload);
  if (payload === undefined) {
    return unreadable(record, 'PROVIDER_EVENT_INBOX', 'a provider notification would be unaccounted for', false);
  }
  const providerId = str(payload.providerId) ?? 'unknown provider';
  const providerEventId = str(payload.providerEventId) ?? 'unknown event';
  const status = str(payload.processedStatus);
  const receivedAt = str(payload.receivedAt);
  // Shared with the reconciler: one definition of a settled provider outcome.
  const settled = isSettledProviderStatus(status);

  const archived = await archiveLegacyRecord(ctx, record, {
    assertionType: LEGACY_PROVIDER_DELIVERY_ASSERTION,
    ...(receivedAt === undefined ? {} : { observedAt: receivedAt }),
    contentKind: 'provider-event-delivery',
    provenance:
      `provider ${providerId} delivered event ${providerEventId}; legacy processing status ` +
      `${status ?? 'UNRECORDED'}. Archived as the raw capture it is — correlation to a target subject requires ` +
      'external-identity resolution and is not guessed here',
  });
  if (!archived.ok) return archived.outcome;

  if (settled) {
    return {
      kind: 'ARCHIVED',
      evidenceId: archived.evidenceId,
      note: `provider delivery archived with its settled legacy outcome (${status})`,
    };
  }

  return {
    kind: 'QUARANTINED',
    exception: {
      classification: 'PRESERVED_UNKNOWN_EXTERNAL_OUTCOME',
      reason:
        `provider ${providerId} delivery ${providerEventId} was never observed to finish processing (status ` +
        `${status ?? 'UNRECORDED'}); its effect on the world is unknown and is not resolved by migration`,
      affectedScope: `provider delivery ${record.sourceId}`,
      safetyImpact:
        'a provider may have told the legacy runtime something that was never acted on; treating it as handled ' +
        'or as failed would both be assertions the evidence does not support',
      owner: 'operations owner',
      blocksCutover: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Trip elements -> target arrangements
// ---------------------------------------------------------------------------

/** Legacy reservation state -> target observed status, refusing to upgrade uncertainty. */
function reservationStatus(legacy: string | undefined): {
  reservation: 'HELD' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'UNKNOWN';
  line: 'HELD' | 'CONFIRMED' | 'CANCELLED' | 'FULFILLED' | 'UNKNOWN';
} {
  switch (legacy) {
    case 'HELD':
      return { reservation: 'HELD', line: 'HELD' };
    case 'CONFIRMED':
      return { reservation: 'CONFIRMED', line: 'CONFIRMED' };
    case 'CANCELLED':
      return { reservation: 'CANCELLED', line: 'CANCELLED' };
    case 'COMPLETED':
      return { reservation: 'COMPLETED', line: 'FULFILLED' };
    // Everything else — CHANGED, UNKNOWN, or an unrecognised value — reaches
    // the target as UNKNOWN. See `legacyUncertainty.ts`, which the reconciler
    // reads from the same constants so it can prove this happened.
    default:
      return { reservation: 'UNKNOWN', line: 'UNKNOWN' };
  }
}

export interface TripElementMigration {
  imported: number;
  notes: string[];
  exceptions: RecordException[];
}

/**
 * Migrate a legacy trip's elements into target arrangements.
 *
 * Booked elements become Reservation + line (+ TransportService for legs) so
 * the obligation, its status and its money-bearing identity survive as real
 * target state. The provider booking reference is archived as evidence
 * against the reservation: binding it as target external identity needs the
 * M3 external-identity resolution that remains a documented open seam.
 */
export async function migrateTripElements(
  ctx: ImportContext,
  record: MigrationSourceRecord,
  params: { journeyTargetId: string; travellerTargetId: string; elements: unknown[] },
): Promise<TripElementMigration> {
  const result: TripElementMigration = { imported: 0, notes: [], exceptions: [] };
  const observedAt = record.sourceTimestamp ?? ctx.now;

  // An element-scoped finding must carry the same fact identity the
  // reconciler derives, so the two cannot drift and so "this element was held
  // back" can never be answered by a finding about a different element.
  const forElement = (elementId: string, exception: RecordException): RecordException => ({
    ...exception,
    factSourceId: legacyTripElementSourceId(record.sourceId, elementId),
  });

  for (const raw of params.elements) {
    const element = asObject(raw);
    const elementId = str(element?.id);
    if (element === undefined || elementId === undefined) {
      // Deliberately unbound: there is no element id to name, so this finding
      // is about the trip row, not about a provable fact.
      result.exceptions.push({
        classification: 'QUARANTINED_UNREADABLE_SOURCE',
        reason: 'legacy trip element is unreadable or has no id',
        affectedScope: `an element of trip ${record.sourceId}`,
        safetyImpact: 'a travel obligation cannot be proven migrated or absent',
        owner: 'migration owner',
        blocksCutover: true,
      });
      continue;
    }

    const kind = str(element.elementKind);
    const data = asObject(element.data) ?? {};
    const legacyState = str(element.reservationState);
    const status = reservationStatus(legacyState);
    const bookingRef = asObject(data.bookingRef);

    // NONE is an unbooked intent, not an arrangement. There is nothing for a
    // Reservation to be about, so the need is archived rather than invented.
    if (legacyState === 'NONE' || legacyState === undefined) {
      const archived = await archiveLegacyRecord(ctx, legacyTripElementRecord(record, elementId), {
        assertionType: LEGACY_UNBOOKED_ELEMENT_ASSERTION,
        subject: { kind: 'JOURNEY', id: params.journeyTargetId },
        provenance:
          `legacy ${kind ?? 'element'} ${elementId} on trip ${record.sourceId} had no reservation ` +
          `(${legacyState ?? 'unrecorded'}); archived as an unbooked need rather than migrated as an arrangement`,
      });
      if (!archived.ok && archived.outcome.kind === 'QUARANTINED') {
        result.exceptions.push(forElement(elementId, archived.outcome.exception));
      } else result.notes.push(`${elementId}: unbooked need archived`);
      continue;
    }

    if (kind === 'ENGAGEMENT') {
      result.exceptions.push(
        forElement(elementId, {
          classification: 'QUARANTINED_NO_DETERMINISTIC_TARGET_MAPPING',
          reason:
            `legacy ENGAGEMENT ${elementId} links this trip to an anchor commitment; the target expresses that as ` +
            'Participation against a migrated ProgrammeItem, which requires the commitment to have migrated and ' +
            'the obligation level to be known — the legacy engagement records neither reliably',
          affectedScope: `element ${elementId} on trip ${record.sourceId}`,
          safetyImpact:
            'the traveller is not linked to the programme item they are attending, so programme-driven readiness ' +
            'does not consider them',
          owner: 'migration owner',
          blocksCutover: true,
        }),
      );
      continue;
    }

    if (kind !== 'TRANSPORT_LEG' && kind !== 'STAY') {
      result.exceptions.push(
        forElement(elementId, {
          classification: 'QUARANTINED_NO_DETERMINISTIC_TARGET_MAPPING',
          reason: `legacy element ${elementId} has unrecognised kind "${kind ?? 'absent'}"`,
          affectedScope: `element ${elementId} on trip ${record.sourceId}`,
          safetyImpact: 'an obligation of unknown type is not represented in the target',
          owner: 'migration owner',
          blocksCutover: true,
        }),
      );
      continue;
    }

    const elementRecord = legacyTripElementRecord(record, elementId);
    let transportServiceId: string | undefined;

    if (kind === 'TRANSPORT_LEG') {
      const legacyOrigin = str(data.originPlaceId);
      const legacyDestination = str(data.destinationPlaceId);
      const origin = legacyOrigin === undefined ? undefined : await ctx.resolve('entities.PLACE', legacyOrigin);
      const destination =
        legacyDestination === undefined ? undefined : await ctx.resolve('entities.PLACE', legacyDestination);
      if (origin === undefined || destination === undefined) {
        result.exceptions.push(
          forElement(elementId, {
            classification: 'QUARANTINED_AMBIGUOUS_IDENTITY',
            reason:
              `legacy transport leg ${elementId} runs ${legacyOrigin ?? 'unknown'} -> ${legacyDestination ?? 'unknown'}; ` +
              'at least one place has no migrated target identity, and a service must name real endpoints',
            affectedScope: `element ${elementId} on trip ${record.sourceId}`,
            safetyImpact: 'a booked journey leg is absent from the target and will not be monitored or recovered',
            owner: 'migration owner',
            blocksCutover: true,
          }),
        );
        continue;
      }

      const carrier = asObject(data.carrierRef);
      const operator = str(carrier?.value) ?? str(bookingRef?.system) ?? 'UNKNOWN_OPERATOR';
      const departure = factValue(data.scheduledDeparture);
      const arrival = factValue(data.scheduledArrival);
      // The observation's provenance is the migration evidence itself: this
      // schedule is asserted by the legacy dataset, not by a carrier feed.
      const observed = (value: string) => ({ value, observedAt, sourceId: ctx.runEvidenceId });

      const service = await createTransportService(ctx.uow(), {
        workspaceId: ctx.workspaceId,
        actorPrincipalId: ctx.actorPrincipalId,
        idempotencyKey: ctx.idempotencyKey(elementRecord, 'transport-service'),
        service: {
          id: ctx.targetId(elementRecord, 'transport-service'),
          mode: str(data.mode) === 'RAIL' ? 'RAIL' : str(data.mode) === 'ROAD' ? 'ROAD' : str(data.mode) === 'SEA' ? 'SEA' : 'AIR',
          operator,
          originPlaceId: origin.targetId,
          destinationPlaceId: destination.targetId,
          ...(departure === undefined ? {} : { publishedDeparture: observed(departure) }),
          ...(arrival === undefined ? {} : { publishedArrival: observed(arrival) }),
        },
        evidenceRefs: [ctx.runEvidenceId],
      });
      if (!service.ok) {
        result.exceptions.push(
          forElement(elementId, {
            classification: 'TARGET_REJECTED_WRITE',
            reason: `target rejected TRANSPORT_SERVICE_CREATED for element ${elementId} — ${conflictText(service.conflict)}`,
            affectedScope: `element ${elementId} on trip ${record.sourceId}`,
            safetyImpact: 'a booked journey leg is absent from the target',
            owner: 'migration owner',
            blocksCutover: true,
          }),
        );
        continue;
      }
      transportServiceId = service.value.id;
    }

    const reservation = await createReservation(ctx.uow(), {
      workspaceId: ctx.workspaceId,
      actorPrincipalId: ctx.actorPrincipalId,
      idempotencyKey: ctx.idempotencyKey(elementRecord, 'reservation'),
      reservation: {
        id: ctx.targetId(elementRecord, 'reservation'),
        reservationType: kind === 'TRANSPORT_LEG' ? 'TRANSPORT' : 'STAY',
        observedStatus: status.reservation,
        // UNKNOWN carries no observation time; a known status must.
        ...(status.reservation === 'UNKNOWN' ? {} : { observedStatusAt: observedAt }),
        responsibleTravellerId: params.travellerTargetId,
      },
      evidenceRefs: [ctx.runEvidenceId],
    });
    if (!reservation.ok) {
      result.exceptions.push(
        forElement(elementId, {
          classification: 'TARGET_REJECTED_WRITE',
          reason: `target rejected RESERVATION_CREATED for element ${elementId} — ${conflictText(reservation.conflict)}`,
          affectedScope: `element ${elementId} on trip ${record.sourceId}`,
          safetyImpact: 'a live booking obligation is absent from the target',
          owner: 'migration owner',
          blocksCutover: true,
        }),
      );
      continue;
    }

    const checkIn = factValue(data.checkIn);
    const checkOut = factValue(data.checkOut);
    const stayPlaceId = str(data.placeId);
    const stayPlace = stayPlaceId === undefined ? undefined : await ctx.resolve('entities.PLACE', stayPlaceId);
    const line = await addReservationLine(ctx.uow(), {
      workspaceId: ctx.workspaceId,
      actorPrincipalId: ctx.actorPrincipalId,
      idempotencyKey: ctx.idempotencyKey(elementRecord, 'reservation-line'),
      reservationId: reservation.value.id,
      expectedRevision: reservation.value.revision,
      line: {
        id: ctx.targetId(elementRecord, 'reservation-line'),
        productType: kind === 'TRANSPORT_LEG' ? 'TRANSPORT' : 'STAY',
        observedStatus: status.line,
        // A known line status must name the evidence that observed it. Here
        // that is the migration itself: the legacy dataset is what asserts
        // this booking was confirmed, and the chain says so explicitly.
        ...(status.line === 'UNKNOWN'
          ? {}
          : { observedStatusAt: observedAt, observationEvidenceId: ctx.runEvidenceId }),
        ...(transportServiceId === undefined ? {} : { transportServiceId }),
        ...(checkIn !== undefined && checkOut !== undefined && checkIn < checkOut
          ? { stayInterval: { start: checkIn, end: checkOut } }
          : {}),
      },
      detail:
        kind === 'TRANSPORT_LEG'
          ? { productType: 'TRANSPORT', transportServiceId: transportServiceId as string }
          : {
              productType: 'STAY',
              ...(checkIn !== undefined && checkOut !== undefined && checkIn < checkOut
                ? { stayInterval: { start: checkIn, end: checkOut } }
                : {}),
              ...(stayPlace === undefined ? {} : { placeId: stayPlace.targetId }),
              ...(typeof data.guests === 'number' ? { occupancy: { guests: data.guests } } : {}),
            },
      evidenceRefs: [ctx.runEvidenceId],
    });
    if (!line.ok) {
      result.exceptions.push(
        forElement(elementId, {
          classification: 'TARGET_REJECTED_WRITE',
          reason: `target rejected RESERVATION_LINE_ADDED for element ${elementId} — ${conflictText(line.conflict)}`,
          affectedScope: `element ${elementId} on trip ${record.sourceId}`,
          safetyImpact: 'the reservation exists but holds nothing, so what was actually booked is unrecorded',
          owner: 'migration owner',
          blocksCutover: true,
        }),
      );
      continue;
    }

    // The provider reference is the thread back to the real-world booking.
    // It is archived with lineage rather than bound as target external
    // identity, which needs the external-identity resolution seam.
    if (bookingRef !== undefined) {
      const system = str(bookingRef.system) ?? 'unknown system';
      const reference = str(bookingRef.reference) ?? 'unknown reference';
      const archived = await archiveLegacyRecord(ctx, elementRecord, {
        assertionType: LEGACY_PROVIDER_BOOKING_REF_ASSERTION,
        subject: { kind: 'RESERVATION', id: reservation.value.id },
        observedAt,
        provenance:
          `legacy element ${elementId} was booked as ${system} reference ${reference}; preserved verbatim against ` +
          'the migrated reservation. Binding it as target external identity requires external-identity ' +
          'resolution, which is a documented open seam, so it is not asserted as a correlated provider record',
      });
      if (!archived.ok && archived.outcome.kind === 'QUARANTINED') {
        result.exceptions.push(forElement(elementId, archived.outcome.exception));
      }
    }

    // Every uncertain legacy state earns its own named exception, not just
    // CHANGED: a legacy UNKNOWN is equally an unresolved external outcome, and
    // the reconciler holds both to the same standard. Bound to the fact on
    // purpose: this finding asserts the element DID migrate, so the
    // reconciler must be able to tell that from a hold-back for the same fact.
    if (isUncertainReservationState(legacyState)) {
      result.exceptions.push(
        forElement(elementId, {
          classification: 'PRESERVED_UNKNOWN_EXTERNAL_OUTCOME',
          reason:
            `legacy element ${elementId} stood at ${legacyState} — the supplier state was never reconciled by the ` +
            'legacy runtime. The target has no such status, and both CONFIRMED and CANCELLED ' +
            'would assert something never observed, so it migrated as UNKNOWN',
          affectedScope: `element ${elementId} on trip ${record.sourceId}, reservation ${reservation.value.id}`,
          safetyImpact:
            'the real supplier state must be re-observed before anyone relies on this booking; until then the ' +
            'target correctly reports that it does not know',
          owner: 'operations owner',
          blocksCutover: false,
        }),
      );
    }

    result.imported += 1;
    result.notes.push(
      `${elementId}: ${kind} -> reservation ${reservation.value.id} (${status.reservation})` +
        (bookingRef === undefined ? '' : ' with archived provider ref'),
    );
  }

  return result;
}
