/**
 * Candidate-only landside visit and document-use projection for a new stay.
 * The overlay may add Journey intent, but it cannot edit Traveller credentials
 * or supplier facts. Canonical persistence is deliberately a later observed
 * command.
 */
import type { ScenarioEffect } from '../../contracts/v2/scenario/scenarioChange.ts';
import type { TypedRef } from '../../domain/v2/shared/identity.ts';
import { typedConflict, type TypedResult, ok, conflict } from '../../domain/v2/shared/errors.ts';
import { InstantIntervalSchema } from '../../domain/v2/shared/time.ts';
import type { CapturedWorld, WJourney } from '../world/world.ts';

type AddStayEffect = Extract<ScenarioEffect, { effectKind: 'ADD_JOURNEY_STAY' }>;

function invalid(message: string, refs: TypedRef[] = []): TypedResult<never> {
  return conflict(typedConflict('VALIDATION_FAILED', message, refs));
}

function covers(outer: { start: string; end: string }, inner: { start: string; end: string }): boolean {
  return Date.parse(outer.start) <= Date.parse(inner.start) && Date.parse(outer.end) >= Date.parse(inner.end);
}

function hasCapturedPlaceJurisdiction(world: CapturedWorld, placeId: string, jurisdictionId: string): boolean {
  return world.placeJurisdictions.some((membership) => membership.placeId === placeId && membership.jurisdictionId === jurisdictionId);
}

/**
 * Adds or validates the entry encounter attached to a proposed stay. The
 * passed world must already be the isolated overlay clone and contain the new
 * stay's captured place/window.
 */
export function applyStayVisitOverlay(params: {
  world: CapturedWorld;
  journey: WJourney;
  effect: AddStayEffect;
  placeId: string;
  stayWindow: { start: string; end: string };
}): TypedResult<true> {
  const { world, journey, effect, placeId, stayWindow } = params;
  const visit = effect.visit;
  if (visit.kind === 'EXISTING') {
    const existing = world.intendedVisits.find((candidate) => candidate.id === visit.visitId);
    if (!existing || existing.journeyId !== journey.id) {
      return invalid('ADD_JOURNEY_STAY existing visit must belong to its owning Journey', [
        { kind: 'JOURNEY', id: journey.id },
      ]);
    }
    if (existing.transitIntent) {
      return invalid('ADD_JOURNEY_STAY existing visit must be landside, not transit intent', [
        { kind: 'JOURNEY', id: journey.id },
      ]);
    }
    if (!hasCapturedPlaceJurisdiction(world, placeId, existing.jurisdictionId)) {
      return invalid('ADD_JOURNEY_STAY existing visit jurisdiction does not match the captured stay place', [
        { kind: 'JOURNEY', id: journey.id },
        { kind: 'PLACE', id: placeId },
        { kind: 'JURISDICTION', id: existing.jurisdictionId },
      ]);
    }
    if (!covers(existing.intended, stayWindow)) {
      return invalid('ADD_JOURNEY_STAY existing visit must cover the full stay window', [
        { kind: 'JOURNEY', id: journey.id },
      ]);
    }
    return ok(true);
  }

  if (world.intendedVisits.some((candidate) => candidate.id === visit.proposedVisitId)) {
    return invalid('ADD_JOURNEY_STAY proposed visit id already exists', [{ kind: 'JOURNEY', id: journey.id }]);
  }
  let window: ReturnType<typeof InstantIntervalSchema.safeParse>;
  try {
    window = InstantIntervalSchema.safeParse(visit.intendedWindow);
  } catch {
    return invalid('ADD_JOURNEY_STAY proposed visit window is not a valid positive offset-bearing interval', [{ kind: 'JOURNEY', id: journey.id }]);
  }
  if (!window.success) {
    return invalid('ADD_JOURNEY_STAY proposed visit window is not a valid positive offset-bearing interval', [{ kind: 'JOURNEY', id: journey.id }]);
  }
  if (!hasCapturedPlaceJurisdiction(world, placeId, visit.jurisdictionId)) {
    return invalid('ADD_JOURNEY_STAY proposed visit jurisdiction does not match the captured stay place', [
      { kind: 'JOURNEY', id: journey.id },
      { kind: 'PLACE', id: placeId },
      { kind: 'JURISDICTION', id: visit.jurisdictionId },
    ]);
  }
  if (!covers(window.data, stayWindow)) {
    return invalid('ADD_JOURNEY_STAY proposed visit must cover the full stay window', [{ kind: 'JOURNEY', id: journey.id }]);
  }

  const seenSelectionIds = new Set<string>();
  const seenCredentials = new Set<string>();
  for (const selection of visit.credentialSelections) {
    if (seenSelectionIds.has(selection.proposedSelectionId) || seenCredentials.has(selection.credentialId)) {
      return invalid('ADD_JOURNEY_STAY proposed credential selections contain duplicate ids or credentials', [{ kind: 'JOURNEY', id: journey.id }]);
    }
    if (world.credentialSelections.some((candidate) => candidate.id === selection.proposedSelectionId)) {
      return invalid('ADD_JOURNEY_STAY proposed credential selection id already exists', [{ kind: 'JOURNEY', id: journey.id }]);
    }
    seenSelectionIds.add(selection.proposedSelectionId);
    seenCredentials.add(selection.credentialId);
  }

  world.intendedVisits.push({
    id: visit.proposedVisitId,
    journeyId: journey.id,
    jurisdictionId: visit.jurisdictionId,
    purpose: visit.purpose,
    intended: { ...window.data },
    transitIntent: false,
  });

  for (const requested of visit.credentialSelections) {
    const credential = world.credentials.find((candidate) => candidate.id === requested.credentialId);
    const version = world.credentialVersions.find((candidate) => candidate.id === requested.credentialVersionId);
    if (!credential || credential.travellerId !== journey.travellerId) {
      return invalid('ADD_JOURNEY_STAY selected credential must belong to the Journey traveller', [{ kind: 'JOURNEY', id: journey.id }]);
    }
    if (!version || version.credentialId !== credential.id) {
      return invalid('ADD_JOURNEY_STAY selected credential version must belong to its stated credential', [{ kind: 'JOURNEY', id: journey.id }]);
    }
    const existing = world.credentialSelections.filter((candidate) => candidate.journeyId === journey.id && candidate.credentialId === credential.id);
    if (existing.length > 1) {
      return invalid('ADD_JOURNEY_STAY captured Journey has duplicate credential selections', [{ kind: 'JOURNEY', id: journey.id }]);
    }
    if (existing.length === 1) {
      if (existing[0]!.credentialVersionId !== version.id) {
        return invalid('ADD_JOURNEY_STAY cannot re-pin an existing Journey credential selection', [{ kind: 'JOURNEY', id: journey.id }]);
      }
      existing[0]!.intendedVisitIds = [...new Set([...existing[0]!.intendedVisitIds, visit.proposedVisitId])].sort();
      continue;
    }
    world.credentialSelections.push({
      id: requested.proposedSelectionId,
      journeyId: journey.id,
      credentialId: credential.id,
      credentialVersionId: version.id,
      intendedVisitIds: [visit.proposedVisitId],
    });
  }
  return ok(true);
}
