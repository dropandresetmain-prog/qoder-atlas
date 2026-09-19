import {
  TravellerTripViewSchema,
  type TravellerTripView,
} from '../../../contracts/v2/product/readModels.ts';
import { buildChangeAwareness } from './changeAwareness.ts';
import type { TravellerTripFacts } from './types.ts';

export function projectTravellerTrip(input: TravellerTripFacts): TravellerTripView {
  return TravellerTripViewSchema.parse({
    generatedAt: input.generatedAt,
    tripRef: input.tripRef,
    amIOkay: input.amIOkay,
    ...(input.whatChanged ? { whatChanged: input.whatChanged } : {}),
    ...(input.whatMattersNow ? { whatMattersNow: input.whatMattersNow } : {}),
    ...(input.whatNorthstarIsDoing ? { whatNorthstarIsDoing: input.whatNorthstarIsDoing } : {}),
    ...(input.whatDoYouNeedFromMe ? { whatDoYouNeedFromMe: input.whatDoYouNeedFromMe } : {}),
    doesTheRestWork: input.doesTheRestWork,
    ...(input.whatChangedAfterRecovery ? { whatChangedAfterRecovery: input.whatChangedAfterRecovery } : {}),
    ...(input.itinerary && input.itinerary.length > 0 ? { itinerary: input.itinerary } : {}),
    ...(input.commitment ? { commitment: input.commitment } : {}),
    change: buildChangeAwareness(input),
  });
}
