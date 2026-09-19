/**
 * Generic bilateral programme time-swap preview.
 *
 * Exchanges windows between two programme items, evaluates projected
 * participant outcomes, and never mutates authoritative state.
 * Counterpart / commitment IDs are runtime inputs — never hardcoded.
 */
import { randomUUID } from 'node:crypto';
import type { AssessmentTone } from '../../contracts/v2/product/readModels.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';
import type { Pool } from '../../persistence/postgres/pool.ts';
import type { TypedRef, ExpectedRevision } from '../../domain/v2/shared/identity.ts';
import { captureWorld } from '../../persistence/postgres/world/pgCurrentState.ts';
import { createM6Registry } from '../../resolution/evaluation/registry.ts';
import { evaluateRecoveryStrategy } from '../../resolution/scenarios/evaluate.ts';
import type { ScenarioChange } from '../../contracts/v2/scenario/scenarioChange.ts';

export interface ProgrammeItemWindowFact {
  itemRef: string;
  title: string;
  window: { start: Instant; end: Instant };
  timeZone?: string;
  participantTravellerRef: string;
  participantLabel: string;
  participantLabels?: string[];
}

export interface ProgrammeParticipantProjection {
  travellerRef: string;
  personLabel: string;
  itemRef: string;
  verdict: AssessmentTone;
  detail?: string;
}

export interface BilateralProgrammeTimeSwapInput {
  itemA: ProgrammeItemWindowFact;
  itemB: ProgrammeItemWindowFact;
  /** Evaluate a traveller against a proposed window on an item (injected). */
  evaluate: (args: {
    travellerRef: string;
    itemRef: string;
    window: { start: Instant; end: Instant };
    role: 'CURRENT' | 'PROPOSED';
  }) => { verdict: AssessmentTone; detail?: string };
  /** Optional other affected people that must remain viable under the proposal. */
  otherAffected?: readonly {
    travellerRef: string;
    personLabel: string;
    itemRef: string;
  }[];
}

export interface BilateralProgrammeTimeSwapPreview {
  mutatesAuthoritativeState: false;
  current: {
    itemA: ProgrammeItemWindowFact;
    itemB: ProgrammeItemWindowFact;
    projections: ProgrammeParticipantProjection[];
  };
  proposed: {
    itemA: ProgrammeItemWindowFact;
    itemB: ProgrammeItemWindowFact;
    projections: ProgrammeParticipantProjection[];
  };
  bothPartiesProjectedViable: boolean;
  othersRemainViable: boolean;
  previewAccepted: boolean;
}

export function previewBilateralProgrammeTimeSwap(
  input: BilateralProgrammeTimeSwapInput,
): BilateralProgrammeTimeSwapPreview {
  const currentA = input.evaluate({
    travellerRef: input.itemA.participantTravellerRef,
    itemRef: input.itemA.itemRef,
    window: input.itemA.window,
    role: 'CURRENT',
  });
  const currentB = input.evaluate({
    travellerRef: input.itemB.participantTravellerRef,
    itemRef: input.itemB.itemRef,
    window: input.itemB.window,
    role: 'CURRENT',
  });

  // Swap windows only — item identities and participants stay put.
  const proposedItemA: ProgrammeItemWindowFact = {
    ...input.itemA,
    window: { ...input.itemB.window },
  };
  const proposedItemB: ProgrammeItemWindowFact = {
    ...input.itemB,
    window: { ...input.itemA.window },
  };

  const proposedA = input.evaluate({
    travellerRef: proposedItemA.participantTravellerRef,
    itemRef: proposedItemA.itemRef,
    window: proposedItemA.window,
    role: 'PROPOSED',
  });
  const proposedB = input.evaluate({
    travellerRef: proposedItemB.participantTravellerRef,
    itemRef: proposedItemB.itemRef,
    window: proposedItemB.window,
    role: 'PROPOSED',
  });

  const otherProjections: ProgrammeParticipantProjection[] = [];
  let othersRemainViable = true;
  for (const other of input.otherAffected ?? []) {
    // Others keep their own item windows; swap must not break them.
    const item = other.itemRef === input.itemA.itemRef
      ? proposedItemA
      : other.itemRef === input.itemB.itemRef
        ? proposedItemB
        : undefined;
    const window = item?.window ?? input.itemA.window;
    const result = input.evaluate({
      travellerRef: other.travellerRef,
      itemRef: other.itemRef,
      window,
      role: 'PROPOSED',
    });
    otherProjections.push({
      travellerRef: other.travellerRef,
      personLabel: other.personLabel,
      itemRef: other.itemRef,
      verdict: result.verdict,
      ...(result.detail ? { detail: result.detail } : {}),
    });
    if (result.verdict !== 'PASS') othersRemainViable = false;
  }

  const bothPartiesProjectedViable = proposedA.verdict === 'PASS' && proposedB.verdict === 'PASS';

  return {
    mutatesAuthoritativeState: false,
    current: {
      itemA: { ...input.itemA, window: { ...input.itemA.window } },
      itemB: { ...input.itemB, window: { ...input.itemB.window } },
      projections: [
        {
          travellerRef: input.itemA.participantTravellerRef,
          personLabel: input.itemA.participantLabel,
          itemRef: input.itemA.itemRef,
          verdict: currentA.verdict,
          ...(currentA.detail ? { detail: currentA.detail } : {}),
        },
        {
          travellerRef: input.itemB.participantTravellerRef,
          personLabel: input.itemB.participantLabel,
          itemRef: input.itemB.itemRef,
          verdict: currentB.verdict,
          ...(currentB.detail ? { detail: currentB.detail } : {}),
        },
      ],
    },
    proposed: {
      itemA: proposedItemA,
      itemB: proposedItemB,
      projections: [
        {
          travellerRef: proposedItemA.participantTravellerRef,
          personLabel: proposedItemA.participantLabel,
          itemRef: proposedItemA.itemRef,
          verdict: proposedA.verdict,
          ...(proposedA.detail ? { detail: proposedA.detail } : {}),
        },
        {
          travellerRef: proposedItemB.participantTravellerRef,
          personLabel: proposedItemB.participantLabel,
          itemRef: proposedItemB.itemRef,
          verdict: proposedB.verdict,
          ...(proposedB.detail ? { detail: proposedB.detail } : {}),
        },
        ...otherProjections,
      ],
    },
    bothPartiesProjectedViable,
    othersRemainViable,
    previewAccepted: bothPartiesProjectedViable && othersRemainViable,
  };
}

/**
 * M9 1B — authoritative server-side preview (real evaluator, no caller-supplied
 * evaluation logic).
 *
 * The HTTP caller may only identify the two programme items to swap. This
 * function loads authoritative PostgreSQL state for them, builds the real M7
 * counterfactual overlay (two CHANGE_PROGRAMME_ITEM_TIME effects — genuinely
 * bilateral, not "move one side"), and invokes the real M6 evaluator
 * (`createM6Registry()` via `evaluateRecoveryStrategy`) over an isolated
 * overlay world. Nothing is persisted and canonical state is never touched
 * (`mutatesAuthoritativeState: false`, matching `evaluateRecoveryStrategy`'s
 * own `canonicalUntouched` proof).
 */
export interface AuthoritativeProgrammeSwapPreviewInput {
  workspaceId: string;
  /** Existing case this preview is for, when one exists — descriptive only, never persisted here. */
  recoveryCaseId?: string;
  itemARef: string;
  itemBRef: string;
  now: string;
}

export interface AuthoritativeSwapParticipantProjection {
  journeyRef: string;
  travellerRef: string;
  personLabel: string;
  /** Which side of the swap this journey's participation sits on, or 'other' for a linked/collision subject. */
  side: 'ITEM_A' | 'ITEM_B' | 'OTHER';
  currentVerdict: AssessmentTone;
  verdict: AssessmentTone;
}

export interface AuthoritativeProgrammeSwapPreviewResult {
  mutatesAuthoritativeState: false;
  expectedProgrammeRevisions?: ExpectedRevision[];
  itemA: { itemRef: string; title: string; timeZone?: string; participantLabels: string[]; currentWindow: { start: string; end: string }; proposedWindow: { start: string; end: string } };
  itemB: { itemRef: string; title: string; timeZone?: string; participantLabels: string[]; currentWindow: { start: string; end: string }; proposedWindow: { start: string; end: string } };
  projections: AuthoritativeSwapParticipantProjection[];
  bothPartiesProjectedViable: boolean;
  othersRemainViable: boolean;
  previewAccepted: boolean;
  strategyViability: string;
}

export type AuthoritativeProgrammeSwapPreviewOutcome =
  | { ok: true; result: AuthoritativeProgrammeSwapPreviewResult }
  | { ok: false; error: string };

export async function previewAuthoritativeBilateralProgrammeTimeSwap(
  pool: Pool,
  input: AuthoritativeProgrammeSwapPreviewInput,
): Promise<AuthoritativeProgrammeSwapPreviewOutcome> {
  const itemRows = await pool.query<{
    id: string; programme_id: string; title: string; window_start: Date | null; window_end: Date | null; time_zone: string | null; schedule_authority: string;
  }>(
    `SELECT id, programme_id, title, window_start, window_end, time_zone, schedule_authority
       FROM programme_items WHERE workspace_id = $1 AND id = ANY($2::uuid[])`,
    [input.workspaceId, [input.itemARef, input.itemBRef]],
  );
  const itemA = itemRows.rows.find((r) => r.id === input.itemARef);
  const itemB = itemRows.rows.find((r) => r.id === input.itemBRef);
  if (!itemA || !itemB) return { ok: false, error: 'PROGRAMME_ITEM_NOT_FOUND' };
  if (itemA.window_start === null || itemA.window_end === null || itemB.window_start === null || itemB.window_end === null) {
    return { ok: false, error: 'PROGRAMME_ITEM_WINDOW_MISSING' };
  }

  const participantRows = await pool.query<{ programme_item_id: string; traveller_id: string }>(
    `SELECT programme_item_id, traveller_id FROM participations
      WHERE workspace_id = $1 AND programme_item_id = ANY($2::uuid[])`,
    [input.workspaceId, [input.itemARef, input.itemBRef]],
  );
  const participantsOf = (itemRef: string): Set<string> =>
    new Set(participantRows.rows.filter((r) => r.programme_item_id === itemRef).map((r) => r.traveller_id));
  const itemAParticipants = participantsOf(itemA.id);
  const itemBParticipants = participantsOf(itemB.id);

  const registry = createM6Registry();
  const focus: TypedRef[] = [
    { kind: 'PROGRAMME_ITEM', id: itemA.id },
    { kind: 'PROGRAMME_ITEM', id: itemB.id },
  ];
  const baseWorld = await captureWorld(pool, {
    workspaceId: input.workspaceId,
    focus,
    at: input.now,
    informationTopics: registry.informationTopics,
  });

  const strategyId = randomUUID();
  const scenarioChange: ScenarioChange = {
    id: randomUUID(),
    recoveryStrategyId: strategyId,
    strategyVersion: 1,
    affectedSubjectRefs: focus,
    effects: [
      {
        effectKind: 'CHANGE_PROGRAMME_ITEM_TIME',
        programmeItemId: itemA.id,
        proposedWindow: { start: itemB.window_start.toISOString(), end: itemB.window_end.toISOString() },
      },
      {
        effectKind: 'CHANGE_PROGRAMME_ITEM_TIME',
        programmeItemId: itemB.id,
        proposedWindow: { start: itemA.window_start.toISOString(), end: itemA.window_end.toISOString() },
      },
    ],
    basisAssessmentId: randomUUID(),
  };

  const evaluated = evaluateRecoveryStrategy({
    recoveryCaseId: input.recoveryCaseId ?? randomUUID(),
    strategyId,
    baseWorld,
    baseManifest: baseWorld.manifest,
    basisAssessmentId: scenarioChange.basisAssessmentId,
    scenarioChange,
    now: input.now,
    registry,
  });
  if (!evaluated.ok) return { ok: false, error: evaluated.conflict.message };

  const travellerIds = [...new Set([
    ...baseWorld.journeys.map((j) => j.travellerId),
    ...participantRows.rows.map((row) => row.traveller_id),
  ])];
  const names = travellerIds.length === 0
    ? { rows: [] as { id: string; display_value: string }[] }
    : await pool.query<{ id: string; display_value: string }>(
        `SELECT t.id, n.display_value
           FROM travellers t
           JOIN traveller_names n ON n.workspace_id = t.workspace_id AND n.id = t.display_name_ref
          WHERE t.workspace_id = $1 AND t.id = ANY($2::uuid[])`,
        [input.workspaceId, travellerIds],
      );
  const nameByTraveller = new Map(names.rows.map((r) => [r.id, r.display_value]));

  const labelsFor = (itemRef: string): string[] => participantRows.rows
    .filter((row) => row.programme_item_id === itemRef)
    .map((row) => nameByTraveller.get(row.traveller_id) ?? `Traveller ${row.traveller_id.slice(0, 8)}`)
    .sort((a, b) => a.localeCompare(b));
  const itemAParticipantLabels = labelsFor(itemA.id);
  const itemBParticipantLabels = labelsFor(itemB.id);

  const { strategy } = evaluated.value;
  const baselineByJourney = new Map(evaluated.value.baselineAssessments.map((assessment) => [assessment.subjectRef.id, assessment]));
  const projections: AuthoritativeSwapParticipantProjection[] = strategy.candidateAssessments.map((c) => {
    const journeyId = c.subjectRef.id;
    const travellerId = baseWorld.journeys.find((j) => j.id === journeyId)?.travellerId ?? '';
    const side: AuthoritativeSwapParticipantProjection['side'] = itemAParticipants.has(travellerId)
      ? 'ITEM_A'
      : itemBParticipants.has(travellerId)
        ? 'ITEM_B'
        : 'OTHER';
    return {
      journeyRef: journeyId,
      travellerRef: travellerId,
      personLabel: nameByTraveller.get(travellerId) ?? `Traveller ${travellerId.slice(0, 8)}`,
      side,
      currentVerdict: (baselineByJourney.get(journeyId)?.overallVerdict ?? 'UNKNOWN') as AssessmentTone,
      verdict: c.overallVerdict as AssessmentTone,
    };
  });

  const allPass = (rows: readonly AuthoritativeSwapParticipantProjection[]): boolean => rows.length > 0 && rows.every((p) => p.verdict === 'PASS');
  const itemAViable = allPass(projections.filter((p) => p.side === 'ITEM_A'));
  const itemBViable = allPass(projections.filter((p) => p.side === 'ITEM_B'));
  const others = projections.filter((p) => p.side === 'OTHER');
  const othersRemainViable = others.length === 0 || allPass(others);
  const bothPartiesProjectedViable = itemAViable && itemBViable;

  return {
    ok: true,
    result: {
      mutatesAuthoritativeState: false,
      expectedProgrammeRevisions: baseWorld.manifest.aggregateReads
        .filter((read) => read.aggregateRef.kind === 'PROGRAMME'
          && [itemA.programme_id, itemB.programme_id].includes(read.aggregateRef.id))
        .map((read) => ({ aggregateRef: read.aggregateRef, expectedRevision: read.revision })),
      itemA: {
        itemRef: itemA.id,
        title: itemA.title,
        ...(itemA.time_zone ? { timeZone: itemA.time_zone } : {}),
        participantLabels: itemAParticipantLabels,
        currentWindow: { start: itemA.window_start.toISOString(), end: itemA.window_end.toISOString() },
        proposedWindow: { start: itemB.window_start.toISOString(), end: itemB.window_end.toISOString() },
      },
      itemB: {
        itemRef: itemB.id,
        title: itemB.title,
        ...(itemB.time_zone ? { timeZone: itemB.time_zone } : {}),
        participantLabels: itemBParticipantLabels,
        currentWindow: { start: itemB.window_start.toISOString(), end: itemB.window_end.toISOString() },
        proposedWindow: { start: itemA.window_start.toISOString(), end: itemA.window_end.toISOString() },
      },
      projections,
      bothPartiesProjectedViable,
      othersRemainViable,
      previewAccepted: strategy.viability === 'VIABLE',
      strategyViability: strategy.viability,
    },
  };
}

/**
 * Adapter for the existing HTML renderer only (`renderProductProgrammePreview`
 * still expects the legacy shape). The JSON API returns
 * `AuthoritativeProgrammeSwapPreviewResult` directly — this never round-trips
 * through the caller-supplied-`evaluate` path.
 */
export function toLegacyRenderableShape(
  result: AuthoritativeProgrammeSwapPreviewResult,
): BilateralProgrammeTimeSwapPreview {
  const itemAParticipant = result.projections.find((p) => p.side === 'ITEM_A');
  const itemBParticipant = result.projections.find((p) => p.side === 'ITEM_B');
  const windowFact = (
    itemRef: string,
    title: string,
    window: { start: string; end: string },
    timeZone: string | undefined,
    participantLabels: string[],
    participant?: AuthoritativeSwapParticipantProjection,
  ): ProgrammeItemWindowFact => ({
    itemRef,
    title,
    ...(timeZone ? { timeZone } : {}),
    window,
    participantTravellerRef: participant?.travellerRef ?? 'unresolved',
    participantLabel: participant?.personLabel ?? participantLabels[0] ?? 'Unresolved participant',
    participantLabels,
  });
  const projectionOf = (
    itemRef: string,
    p: AuthoritativeSwapParticipantProjection,
    verdict: AssessmentTone,
  ): ProgrammeParticipantProjection => ({
    travellerRef: p.travellerRef,
    personLabel: p.personLabel,
    itemRef,
    verdict,
  });
  const itemRefFor = (p: AuthoritativeSwapParticipantProjection): string =>
    p.side === 'ITEM_A' ? result.itemA.itemRef : p.side === 'ITEM_B' ? result.itemB.itemRef : 'OTHER';
  return {
    mutatesAuthoritativeState: false,
    current: {
      itemA: windowFact(result.itemA.itemRef, result.itemA.title, result.itemA.currentWindow, result.itemA.timeZone, result.itemA.participantLabels, itemAParticipant),
      itemB: windowFact(result.itemB.itemRef, result.itemB.title, result.itemB.currentWindow, result.itemB.timeZone, result.itemB.participantLabels, itemBParticipant),
      projections: result.projections.map((p) => projectionOf(itemRefFor(p), p, p.currentVerdict)),
    },
    proposed: {
      itemA: windowFact(result.itemA.itemRef, result.itemA.title, result.itemA.proposedWindow, result.itemA.timeZone, result.itemA.participantLabels, itemAParticipant),
      itemB: windowFact(result.itemB.itemRef, result.itemB.title, result.itemB.proposedWindow, result.itemB.timeZone, result.itemB.participantLabels, itemBParticipant),
      projections: result.projections.map((p) => projectionOf(itemRefFor(p), p, p.verdict)),
    },
    bothPartiesProjectedViable: result.bothPartiesProjectedViable,
    othersRemainViable: result.othersRemainViable,
    previewAccepted: result.previewAccepted,
  };
}
