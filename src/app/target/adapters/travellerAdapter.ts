/**
 * TravellerTripView (v2 read model) -> a traveller-facing presentation using the
 * legacy status vocabulary (`ReadModelStatus`, `TRAVELLER_HEADLINE/SUBLINE`).
 *
 * Pure. The status is derived only from what the read model states (am I okay,
 * whether recovery work or an after-recovery summary exists); free text the
 * backend supplied is scrubbed of identifiers before it can reach the page.
 */
import type {
  TravellerCommitment,
  TravellerItineraryItem,
  TravellerTripView as V2TravellerTripView,
} from '../../../contracts/v2/product/readModels.ts';
import type { ReadModelStatus, RemainderViability } from '../../../contracts/readmodels.ts';
import { CASE_STATUS_BADGE, STATUS_LABEL, TRAVELLER_HEADLINE, TRAVELLER_SUBLINE } from '../../../ui/copy.ts';
import { scrubText } from './surfaceLabels.ts';

export interface TravellerSurfaceView {
  status: ReadModelStatus;
  kicker: string;
  kickerTone: 'ok' | 'bad' | 'neutral';
  headline: string;
  subline: string;
  remainderViable: RemainderViability;
  whatChanged?: string;
  whatMattersNow?: string;
  whatNorthstarIsDoing?: string;
  whatWeNeedFromYou?: string;
  afterRecovery?: string;
  itinerary?: TravellerItineraryView[];
  commitment?: TravellerCommitment;
  updatedAt: string;
}

export interface TravellerItineraryView extends Omit<TravellerItineraryItem, 'status'> {
  stateTone: 'ok' | 'bad' | 'watch' | 'neutral';
  stateLabel: string;
}

/** Lifecycle sentences the projection assembles around a raw status code. */
function humanizeLifecycleSentence(text: string): string {
  const status = (code: string) => (CASE_STATUS_BADGE[code]?.label ?? 'In progress').toLowerCase();
  return text
    .replace(/Linked recovery case\s+\S+\s+is\s+([A-Z_]+)/g, (_m, code: string) => `A recovery case is open for your trip (${status(code)})`)
    .replace(/Recovery case status:\s*([A-Z_]+)/g, (_m, code: string) => `Recovery status: ${status(code)}`);
}

function clean(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const value = scrubText(humanizeLifecycleSentence(text));
  return value.length > 0 ? value : undefined;
}

function itineraryState(status: string): Pick<TravellerItineraryView, 'stateTone' | 'stateLabel'> {
  switch (status.toUpperCase()) {
    case 'CONFIRMED':
    case 'FULFILLED':
    case 'COMPLETED':
      return { stateTone: 'ok', stateLabel: 'Confirmed' };
    case 'HELD':
      return { stateTone: 'watch', stateLabel: 'Held' };
    case 'CANCELLED':
    case 'DROPPED':
      return { stateTone: 'bad', stateLabel: 'Cancelled' };
    case 'SCHEDULED':
    case 'ACTIVE':
      return { stateTone: 'ok', stateLabel: 'Scheduled' };
    case 'PLANNED':
      return { stateTone: 'neutral', stateLabel: 'Planned' };
    default:
      return { stateTone: 'neutral', stateLabel: 'Status unconfirmed' };
  }
}

export function travellerStatus(view: V2TravellerTripView): ReadModelStatus {
  if (view.amIOkay === 'YES') return view.whatChangedAfterRecovery ? 'RESOLVED' : 'READY';
  if (view.amIOkay === 'NO') return view.whatNorthstarIsDoing ? 'RECOVERING' : 'DISRUPTED';
  return 'UNKNOWN';
}

export function adaptTravellerTrip(view: V2TravellerTripView): TravellerSurfaceView {
  const status = travellerStatus(view);
  const changedButWorking = view.amIOkay === 'YES' && view.doesTheRestWork === 'VIABLE' && !!view.whatChanged;
  const whatChanged = clean(view.whatChanged);
  const whatMatters = clean(view.whatMattersNow);
  const need = clean(view.whatDoYouNeedFromMe);
  const itinerary = view.itinerary?.map((item) => ({
    label: scrubText(item.label) || 'Travel segment',
    ...(item.originLabel ? { originLabel: scrubText(item.originLabel) } : {}),
    ...(item.destinationLabel ? { destinationLabel: scrubText(item.destinationLabel) } : {}),
    ...(item.placeLabel ? { placeLabel: scrubText(item.placeLabel) } : {}),
    ...(item.startsAt ? { startsAt: item.startsAt } : {}),
    ...(item.endsAt ? { endsAt: item.endsAt } : {}),
    ...(item.startTimeZone ? { startTimeZone: scrubText(item.startTimeZone) } : {}),
    ...(item.endTimeZone ? { endTimeZone: scrubText(item.endTimeZone) } : {}),
    ...itineraryState(item.status),
  }));
  return {
    status,
    kicker: changedButWorking ? 'Trip checked' : status === 'UNKNOWN' ? 'Still checking' : STATUS_LABEL[status],
    kickerTone: status === 'READY' || status === 'RESOLVED' || changedButWorking
      ? 'ok'
      : status === 'DISRUPTED' || status === 'RECOVERING' ? 'bad' : 'neutral',
    headline: changedButWorking ? 'Your trip changed, but still works' : (whatMatters ?? TRAVELLER_HEADLINE[status]),
    subline: changedButWorking
      ? 'The updated booking still protects the important parts of your trip.'
      : (whatChanged ?? TRAVELLER_SUBLINE[status]),
    remainderViable: view.doesTheRestWork,
    ...(whatChanged ? { whatChanged } : {}),
    ...(whatMatters ? { whatMattersNow: whatMatters } : {}),
    ...(clean(view.whatNorthstarIsDoing) ? { whatNorthstarIsDoing: clean(view.whatNorthstarIsDoing)! } : {}),
    ...(need ? { whatWeNeedFromYou: need } : {}),
    ...(clean(view.whatChangedAfterRecovery) ? { afterRecovery: clean(view.whatChangedAfterRecovery)! } : {}),
    ...(itinerary && itinerary.length > 0 ? { itinerary } : {}),
    ...(view.commitment ? {
      commitment: {
        label: scrubText(view.commitment.label) || 'Required commitment',
        ...(view.commitment.windowStart ? { windowStart: view.commitment.windowStart } : {}),
        ...(view.commitment.windowEnd ? { windowEnd: view.commitment.windowEnd } : {}),
        ...(view.commitment.timeZone ? { timeZone: scrubText(view.commitment.timeZone) } : {}),
        ...(view.commitment.placeLabel ? { placeLabel: scrubText(view.commitment.placeLabel) } : {}),
      },
    } : {}),
    updatedAt: view.generatedAt,
  };
}
