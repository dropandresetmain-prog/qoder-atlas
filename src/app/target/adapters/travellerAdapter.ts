/**
 * TravellerTripView (v2 read model) -> a traveller-facing presentation using the
 * legacy status vocabulary (`ReadModelStatus`, `TRAVELLER_HEADLINE/SUBLINE`).
 *
 * Pure. The status is derived only from what the read model states (am I okay,
 * whether recovery work or an after-recovery summary exists); free text the
 * backend supplied is scrubbed of identifiers before it can reach the page.
 */
import type { TravellerTripView as V2TravellerTripView } from '../../../contracts/v2/product/readModels.ts';
import type { ReadModelStatus, RemainderViability } from '../../../contracts/readmodels.ts';
import { STATUS_LABEL, TRAVELLER_HEADLINE, TRAVELLER_SUBLINE } from '../../../ui/copy.ts';
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
  updatedAt: string;
}

function clean(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const value = scrubText(text);
  return value.length > 0 ? value : undefined;
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
    updatedAt: view.generatedAt,
  };
}
