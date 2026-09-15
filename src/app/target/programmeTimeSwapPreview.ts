/**
 * Generic bilateral programme time-swap preview.
 *
 * Exchanges windows between two programme items, evaluates projected
 * participant outcomes, and never mutates authoritative state.
 * Counterpart / commitment IDs are runtime inputs — never hardcoded.
 */
import type { AssessmentTone } from '../../contracts/v2/product/readModels.ts';
import type { Instant } from '../../domain/v2/shared/time.ts';

export interface ProgrammeItemWindowFact {
  itemRef: string;
  title: string;
  window: { start: Instant; end: Instant };
  participantTravellerRef: string;
  participantLabel: string;
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
