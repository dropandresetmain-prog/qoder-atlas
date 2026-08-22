/**
 * E1 — typed UI fixtures compiled against the frozen read-model contracts.
 *
 * Coverage (lane requirement): normal/ready, disrupted, recovering, pending
 * traveller decision, pending organisation approval, uncertainty/UNKNOWN,
 * rejected recovery option, resolved fully, resolved with loss — plus
 * loading/error envelopes for every surface.
 *
 * These are data, not hidden backend JSON: every value is checked by the
 * compiler against `src/contracts/readmodels.ts` (and the UI-local case
 * view model). Names/values are illustrative demo facts; components render
 * any conforming view, proven by the alternate dataset below.
 */
import type {
  OperatorDashboardView,
  OperatorTripView,
  ProgrammeTravellerView,
  ProgrammeView,
  ReadModelEnvelope,
  TravellerTripView,
} from '../../contracts/readmodels.ts';
import type { IsoDateTime } from '../../domain/common.ts';
import type { CaseDetailView } from '../case-view-model.ts';

export const UI_FIXTURE_NOW: IsoDateTime = '2026-09-14T09:30:00+08:00';

// ---------------------------------------------------------------------------
// Operator trip views — one per required state
// ---------------------------------------------------------------------------

export const readyTrip: OperatorTripView = {
  tripId: 'trip-ready',
  label: 'Jordan Lee — Leadership offsite',
  travellerNames: ['Jordan Lee'],
  status: 'READY',
  affectedItems: [],
  systemActivity: [],
  pendingDecisions: [],
  uncertainties: [],
  travellerResponseStatus: 'NOT_REQUIRED',
  updatedAt: '2026-09-14T08:00:00+08:00',
};

export const atRiskTrip: OperatorTripView = {
  tripId: 'trip-at-risk',
  label: 'Ivy Tan — Innovation Summit 2026',
  travellerNames: ['Ivy Tan'],
  anchorEventName: 'Innovation Summit 2026',
  status: 'AT_RISK',
  affectedItems: ['Airport transfer'],
  systemActivity: ['Watching the arrival window against the transfer'],
  pendingDecisions: [],
  uncertainties: ['Whether the expected delay will break the transfer connection'],
  travellerResponseStatus: 'NOT_REQUIRED',
  updatedAt: UI_FIXTURE_NOW,
};

export const disruptedTrip: OperatorTripView = {
  tripId: 'trip-disrupted',
  label: 'Alex Reyes — Innovation Summit 2026',
  travellerNames: ['Alex Reyes'],
  anchorEventName: 'Innovation Summit 2026',
  status: 'DISRUPTED',
  whatChanged: 'The flight on 15 September was cancelled by the airline.',
  affectedItems: ['Airport transfer', 'Hotel arrival window', 'Speaking slot on 16 September'],
  systemActivity: ['Searching replacement flights', 'Checking the hotel and transfer against new arrival times'],
  pendingDecisions: [],
  uncertainties: ['Replacement seat availability is not confirmed yet'],
  travellerResponseStatus: 'NOT_REQUIRED',
  updatedAt: UI_FIXTURE_NOW,
};

export const recoveringTrip: OperatorTripView = {
  tripId: 'trip-recovering',
  label: 'Priya Nair — Innovation Summit 2026',
  travellerNames: ['Priya Nair'],
  anchorEventName: 'Innovation Summit 2026',
  status: 'RECOVERING',
  whatChanged: 'The connecting flight was delayed past the transfer window.',
  affectedItems: ['Airport transfer', 'Evening welcome dinner'],
  systemActivity: ['Comparing replacement options', 'Re-checking the transfer timing'],
  pendingDecisions: [],
  uncertainties: ['Whether the welcome dinner can still be reached'],
  travellerResponseStatus: 'NOT_REQUIRED',
  updatedAt: UI_FIXTURE_NOW,
};

export const awaitingTravellerTrip: OperatorTripView = {
  tripId: 'trip-awaiting-traveller',
  label: 'Sam Okafor — Innovation Summit 2026',
  travellerNames: ['Sam Okafor'],
  anchorEventName: 'Innovation Summit 2026',
  status: 'RECOVERING',
  whatChanged: 'The original flight no longer arrives before the event starts.',
  affectedItems: ['Hotel check-in', 'First-day session'],
  systemActivity: ['Two replacement options are ready', 'Waiting for the traveller to choose'],
  pendingDecisions: [
    {
      caseId: 'case-choice',
      decisionType: 'INPUT',
      description: 'Traveller is choosing between two replacement flights',
      requestedAt: '2026-09-14T09:05:00+08:00',
    },
  ],
  uncertainties: [],
  travellerResponseStatus: 'AWAITING',
  updatedAt: UI_FIXTURE_NOW,
};

export const awaitingApprovalTrip: OperatorTripView = {
  tripId: 'trip-awaiting-approval',
  label: 'Mia Chen — Innovation Summit 2026',
  travellerNames: ['Mia Chen'],
  anchorEventName: 'Innovation Summit 2026',
  status: 'RECOVERING',
  whatChanged: 'The return flight was rescheduled and no longer connects.',
  affectedItems: ['Return flight', 'Airport transfer'],
  systemActivity: ['One workable replacement found', 'Waiting for organisation approval (cost above policy)'],
  pendingDecisions: [
    {
      caseId: 'case-approval',
      decisionType: 'APPROVAL',
      description: 'Approve the replacement flight, which costs above the travel policy',
      amount: { amount: 320, currency: 'SGD' },
      requestedAt: '2026-09-14T09:10:00+08:00',
    },
  ],
  uncertainties: [],
  travellerResponseStatus: 'NOT_REQUIRED',
  updatedAt: UI_FIXTURE_NOW,
};

export const unknownTrip: OperatorTripView = {
  tripId: 'trip-unknown',
  label: 'Noah Park — Innovation Summit 2026',
  travellerNames: ['Noah Park'],
  anchorEventName: 'Innovation Summit 2026',
  status: 'UNKNOWN',
  affectedItems: [],
  systemActivity: ['Trying to confirm the current flight status'],
  pendingDecisions: [],
  uncertainties: [
    'Flight status feed has not confirmed today',
    'Hotel check-in time is unverified',
  ],
  travellerResponseStatus: 'NOT_REQUIRED',
  updatedAt: UI_FIXTURE_NOW,
};

export const resolvedTrip: OperatorTripView = {
  tripId: 'trip-resolved',
  label: 'Emma Fischer — Innovation Summit 2026',
  travellerNames: ['Emma Fischer'],
  anchorEventName: 'Innovation Summit 2026',
  status: 'RESOLVED',
  whatChanged: 'The original flight was cancelled; a replacement was booked and confirmed.',
  affectedItems: ['Airport transfer', 'Hotel arrival window'],
  systemActivity: ['Replacement booked', 'Transfer and hotel updated'],
  pendingDecisions: [],
  uncertainties: [],
  travellerResponseStatus: 'RESPONDED',
  resolutionSummary:
    'Rebooked on the 07:10 flight; transfer and hotel updated. Everything originally planned is kept.',
  updatedAt: '2026-09-14T07:45:00+08:00',
};

export const resolvedWithLossTrip: OperatorTripView = {
  tripId: 'trip-resolved-loss',
  label: 'Lucas Silva — Innovation Summit 2026',
  travellerNames: ['Lucas Silva'],
  anchorEventName: 'Innovation Summit 2026',
  status: 'RESOLVED',
  whatChanged: 'A strike cancelled the original routing; a replacement was booked.',
  affectedItems: ['Welcome dinner', 'Airport transfer'],
  systemActivity: ['Replacement booked', 'Transfer updated'],
  pendingDecisions: [],
  uncertainties: [],
  travellerResponseStatus: 'RESPONDED',
  resolutionSummary:
    'Recovered in time for the main event. The welcome dinner could not be preserved — no option kept both.',
  updatedAt: '2026-09-14T08:20:00+08:00',
};

export const operatorTrips: readonly OperatorTripView[] = [
  readyTrip,
  atRiskTrip,
  disruptedTrip,
  recoveringTrip,
  awaitingTravellerTrip,
  awaitingApprovalTrip,
  unknownTrip,
  resolvedTrip,
  resolvedWithLossTrip,
];

export const operatorDashboard: OperatorDashboardView = {
  generatedAt: UI_FIXTURE_NOW,
  summary: { ready: 1, atRisk: 1, disrupted: 1, recovering: 3, awaitingDecision: 2 },
  trips: [...operatorTrips],
};

/**
 * Materially different dataset (corporate/TMC-flavoured, no event context):
 * proves screens are data-driven — switching fixtures changes no component
 * code. Same frozen types, different facts.
 */
export const operatorDashboardAlt: OperatorDashboardView = {
  generatedAt: UI_FIXTURE_NOW,
  summary: { ready: 1, atRisk: 1, disrupted: 1, recovering: 0, awaitingDecision: 0 },
  trips: [
    {
      tripId: 'trip-alt-1',
      label: 'Client visit — Meridian Group',
      travellerNames: ['Dana Whitfield'],
      status: 'READY',
      affectedItems: [],
      systemActivity: [],
      pendingDecisions: [],
      uncertainties: [],
      travellerResponseStatus: 'NOT_REQUIRED',
      updatedAt: '2026-09-14T06:00:00+08:00',
    },
    {
      tripId: 'trip-alt-2',
      label: 'Regional office rotation',
      travellerNames: ['Kenji Mori'],
      status: 'AT_RISK',
      whatChanged: 'Heavy weather is forecast for the arrival day.',
      affectedItems: ['Onward train connection'],
      systemActivity: ['Watching the connection window'],
      pendingDecisions: [],
      uncertainties: ['Whether the connection will hold'],
      travellerResponseStatus: 'NOT_REQUIRED',
      updatedAt: UI_FIXTURE_NOW,
    },
    {
      tripId: 'trip-alt-3',
      label: 'Quarterly audit travel',
      travellerNames: ['Sofia Marino'],
      status: 'DISRUPTED',
      whatChanged: 'The hotel closed the booking window early; the late arrival is no longer held.',
      affectedItems: ['Hotel stay', 'Early meeting on the first day'],
      systemActivity: ['Looking for a comparable hotel nearby'],
      pendingDecisions: [],
      uncertainties: ['Room availability near the office'],
      travellerResponseStatus: 'NOT_REQUIRED',
      updatedAt: UI_FIXTURE_NOW,
    },
  ],
};

// ---------------------------------------------------------------------------
// Programme views (Northstar RV-N10) — preview-only fixtures.
//
// Synthetic programme + traveller names; no real event or attendee is
// implied. The dataset is the demo shape (one healthy ~45-traveller
// programme plus a second view that surfaces an endangered commitment),
// so UI lane evidence can render the page at scale and prove the
// missing-information / endangered / status-priority paths. None of
// these fixtures is wired to the integrated truth path; they exist for
// preview and tests only.
// ---------------------------------------------------------------------------

const PROGRAMME_NOW: IsoDateTime = UI_FIXTURE_NOW;

interface ProgrammeTravellerSeed {
  id: string;
  name: string;
  status: ProgrammeTravellerView['status'];
  caseCount: number;
  decisions: number;
  uncertainties: string[];
}

function makeProgrammeTraveller(
  seed: ProgrammeTravellerSeed,
  anchorEventId: ProgrammeView['anchorEventId'],
): ProgrammeTravellerView {
  return {
    tripId: `trip-${seed.id}` as ProgrammeTravellerView['tripId'],
    travellerId: `trav-${seed.id}` as ProgrammeTravellerView['travellerId'],
    travellerName: seed.name,
    status: seed.status,
    activeCaseIds: Array.from(
      { length: seed.caseCount },
      (_, i) => `case-${anchorEventId}-${seed.id}-${i + 1}` as ProgrammeTravellerView['activeCaseIds'][number],
    ),
    decisionsRequired: seed.decisions,
    uncertainties: seed.uncertainties,
    updatedAt: PROGRAMME_NOW,
  };
}

// Synthetic demo names — distinct, ordered, and never duplicated. The
// number 45 is the demo-programme scale; the deterministic order makes
// the dataset easy to eyeball while building the screen.
const HEALTHY_PROGRAMME_SEEDS: readonly ProgrammeTravellerSeed[] = [
  { id: '01', name: 'Aaliyah Brooks', status: 'READY', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '02', name: 'Beatrice Cho', status: 'READY', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '03', name: 'Camila Duarte', status: 'READY', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '04', name: 'Daniyar Iskakov', status: 'READY', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '05', name: 'Eleanor Vance', status: 'READY', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '06', name: 'Felix Hartmann', status: 'READY', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '07', name: 'Greta Lindqvist', status: 'READY', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '08', name: 'Hiroshi Tanaka', status: 'READY', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '09', name: 'Ines Costa', status: 'READY', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '10', name: 'Jasper O\u2019Donnell', status: 'READY', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '11', name: 'Kenji Mori', status: 'PLANNING', caseCount: 1, decisions: 0, uncertainties: [] },
  { id: '12', name: 'Lila Ben Salah', status: 'PLANNING', caseCount: 1, decisions: 0, uncertainties: [] },
  { id: '13', name: 'Mateo Aguirre', status: 'PLANNING', caseCount: 1, decisions: 0, uncertainties: [] },
  { id: '14', name: 'Naomi Eze', status: 'PLANNING', caseCount: 1, decisions: 0, uncertainties: [] },
  { id: '15', name: 'Owen MacLeod', status: 'PLANNING', caseCount: 1, decisions: 0, uncertainties: [] },
  { id: '16', name: 'Priya Subramanian', status: 'NEEDS_TRAVELLER_INFO', caseCount: 0, decisions: 0, uncertainties: [
    'Passport number is missing from the intake form',
    'Preferred arrival window is unconfirmed',
  ] },
  { id: '17', name: 'Quentin Lefebvre', status: 'NEEDS_TRAVELLER_INFO', caseCount: 0, decisions: 0, uncertainties: [
    'Dietary requirements not yet supplied',
  ] },
  { id: '18', name: 'Rosa Marin', status: 'NEEDS_TRAVELLER_INFO', caseCount: 0, decisions: 0, uncertainties: [
    'Home airport not recorded',
  ] },
  { id: '19', name: 'Soren Iverson', status: 'NEEDS_TRAVELLER_INFO', caseCount: 0, decisions: 0, uncertainties: [
    'Mobility statement missing from intake',
    'Emergency contact not recorded',
  ] },
  { id: '20', name: 'Tariq Al-Sayed', status: 'CHANGE_REQUESTED', caseCount: 1, decisions: 1, uncertainties: [
    'Requested change being checked against the current trip',
  ] },
  { id: '21', name: 'Una Petrova', status: 'CHANGE_REQUESTED', caseCount: 1, decisions: 1, uncertainties: [
    'Requested change being checked against the current trip',
  ] },
  { id: '22', name: 'Valentina Cruz', status: 'CHANGE_REQUESTED', caseCount: 1, decisions: 1, uncertainties: [
    'Requested change being checked against the current trip',
  ] },
  { id: '23', name: 'Wesley Owens', status: 'AT_RISK', caseCount: 1, decisions: 0, uncertainties: [
    'Onward connection may not hold for the new arrival',
  ] },
  { id: '24', name: 'Xiulan Zhao', status: 'AT_RISK', caseCount: 1, decisions: 0, uncertainties: [
    'Hotel check-in window depends on a transfer that is not yet confirmed',
  ] },
  { id: '25', name: 'Yusuf Demir', status: 'AT_RISK', caseCount: 1, decisions: 0, uncertainties: [
    'Visa appointment confirmation still pending',
  ] },
  { id: '26', name: 'Zara Khan', status: 'AT_RISK', caseCount: 1, decisions: 0, uncertainties: [
    'Conference pass collection window is unconfirmed',
  ] },
  { id: '27', name: 'Arvid Sjoberg', status: 'DISRUPTED', caseCount: 1, decisions: 0, uncertainties: [
    'Replacement flight availability is not yet confirmed',
  ] },
  { id: '28', name: 'Beatriz Almeida', status: 'DISRUPTED', caseCount: 1, decisions: 0, uncertainties: [
    'Replacement hotel not yet identified',
  ] },
  { id: '29', name: 'Cyrus Mehrabi', status: 'RECOVERING', caseCount: 1, decisions: 1, uncertainties: [
    'Replacement option is being checked against the rest of the trip',
  ] },
  { id: '30', name: 'Daria Volkova', status: 'RECOVERING', caseCount: 1, decisions: 1, uncertainties: [
    'Replacement option is being checked against the rest of the trip',
  ] },
  { id: '31', name: 'Elias Okafor', status: 'RECOVERING', caseCount: 1, decisions: 0, uncertainties: [
    'Transfer is being rebooked',
  ] },
  { id: '32', name: 'Faye Larrabee', status: 'RECOVERING', caseCount: 1, decisions: 0, uncertainties: [] },
  { id: '33', name: 'Gianluca Romano', status: 'RESOLVED', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '34', name: 'Halle Bergstrom', status: 'RESOLVED', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '35', name: 'Ibrahim Coulibaly', status: 'RESOLVED', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '36', name: 'Junia Park', status: 'RESOLVED', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '37', name: 'Kasper Vogel', status: 'RESOLVED', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '38', name: 'Lior Adler', status: 'RESOLVED', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '39', name: 'Mira Haq', status: 'RESOLVED', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '40', name: 'Nina Volkov', status: 'RESOLVED', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '41', name: 'Otto Larsson', status: 'RESOLVED', caseCount: 0, decisions: 0, uncertainties: [] },
  { id: '42', name: 'Polly Nyong\u2019o', status: 'UNKNOWN', caseCount: 0, decisions: 0, uncertainties: [
    'No flight status update in the last 24 hours',
    'Hotel check-in time not on file',
  ] },
  { id: '43', name: 'Quincy Adebayo', status: 'UNKNOWN', caseCount: 0, decisions: 0, uncertainties: [
    'Train connection not yet confirmed',
  ] },
  { id: '44', name: 'Rina Suzuki', status: 'UNKNOWN', caseCount: 0, decisions: 0, uncertainties: [
    'Connecting flight status feed delayed',
  ] },
  { id: '45', name: 'Sami Lehtinen', status: 'UNKNOWN', caseCount: 0, decisions: 0, uncertainties: [
    'Pickup time from venue not yet scheduled',
  ] },
];

// Helper local to the fixture module: cast a literal to the frozen
// ProgrammeTravellerView so the seeds above stay readable.
function traveller(
  seed: ProgrammeTravellerSeed,
  anchorEventId: ProgrammeView['anchorEventId'],
): ProgrammeTravellerView {
  return makeProgrammeTraveller(seed, anchorEventId);
}

function summaryFor(travellers: readonly ProgrammeTravellerView[]): ProgrammeView['summary'] {
  const counts: ProgrammeView['summary'] = {
    total: travellers.length,
    ready: 0,
    planning: 0,
    needsTravellerInfo: 0,
    changeRequested: 0,
    atRisk: 0,
    disrupted: 0,
    recovering: 0,
    awaitingDecision: 0,
    resolved: 0,
    unknown: 0,
  };
  for (const t of travellers) {
    switch (t.status) {
      case 'READY':
        counts.ready += 1;
        break;
      case 'PLANNING':
        counts.planning += 1;
        break;
      case 'NEEDS_TRAVELLER_INFO':
        counts.needsTravellerInfo += 1;
        break;
      case 'CHANGE_REQUESTED':
        counts.changeRequested += 1;
        break;
      case 'AT_RISK':
        counts.atRisk += 1;
        break;
      case 'DISRUPTED':
        counts.disrupted += 1;
        break;
      case 'RECOVERING':
        counts.recovering += 1;
        break;
      case 'RESOLVED':
        counts.resolved += 1;
        break;
      case 'UNKNOWN':
        counts.unknown += 1;
        break;
    }
    counts.awaitingDecision += t.decisionsRequired;
  }
  return counts;
}

const HEALTHY_ANCHOR_EVENT_ID = 'event-summit-2026' as ProgrammeView['anchorEventId'];

export const healthyProgramme: ProgrammeView = {
  generatedAt: PROGRAMME_NOW,
  anchorEventId: HEALTHY_ANCHOR_EVENT_ID,
  anchorEventName: 'Atlas Innovation Summit 2026',
  summary: summaryFor(HEALTHY_PROGRAMME_SEEDS.map((s) => traveller(s, HEALTHY_ANCHOR_EVENT_ID))),
  travellers: HEALTHY_PROGRAMME_SEEDS.map((s) => traveller(s, HEALTHY_ANCHOR_EVENT_ID)),
  endangeredCommitments: [],
  unresolvedUncertainties: [
    'Welcome dinner venue capacity not yet confirmed with the venue',
  ],
};

const ENDANGERED_ANCHOR_EVENT_ID = 'event-summit-2026-alt' as ProgrammeView['anchorEventId'];

export const programmeWithEndangeredCommitment: ProgrammeView = {
  generatedAt: PROGRAMME_NOW,
  anchorEventId: ENDANGERED_ANCHOR_EVENT_ID,
  anchorEventName: 'Atlas Innovation Summit 2026 \u2014 venue shift',
  summary: summaryFor([
    traveller({ id: 'a1', name: 'Wren Calloway', status: 'DISRUPTED', caseCount: 1, decisions: 0, uncertainties: ['Hotel closed the booking window early'] }, ENDANGERED_ANCHOR_EVENT_ID),
    traveller({ id: 'a2', name: 'Xander Olufemi', status: 'AT_RISK', caseCount: 1, decisions: 0, uncertainties: ['Transfer is at risk because of the venue change'] }, ENDANGERED_ANCHOR_EVENT_ID),
    traveller({ id: 'a3', name: 'Yael Berenson', status: 'NEEDS_TRAVELLER_INFO', caseCount: 0, decisions: 0, uncertainties: ['New venue address not yet confirmed to the traveller'] }, ENDANGERED_ANCHOR_EVENT_ID),
  ]),
  travellers: [
    traveller({ id: 'a1', name: 'Wren Calloway', status: 'DISRUPTED', caseCount: 1, decisions: 0, uncertainties: ['Hotel closed the booking window early'] }, ENDANGERED_ANCHOR_EVENT_ID),
    traveller({ id: 'a2', name: 'Xander Olufemi', status: 'AT_RISK', caseCount: 1, decisions: 0, uncertainties: ['Transfer is at risk because of the venue change'] }, ENDANGERED_ANCHOR_EVENT_ID),
    traveller({ id: 'a3', name: 'Yael Berenson', status: 'NEEDS_TRAVELLER_INFO', caseCount: 0, decisions: 0, uncertainties: ['New venue address not yet confirmed to the traveller'] }, ENDANGERED_ANCHOR_EVENT_ID),
  ],
  endangeredCommitments: [
    {
      commitmentId: 'commit-venue-shift' as ProgrammeView['endangeredCommitments'][number]['commitmentId'],
      title: 'Welcome dinner at the riverside venue',
      reason: 'Original venue closed; replacement not yet booked for everyone travelling.',
      affectedTravellerIds: [
        'trav-a1' as ProgrammeView['endangeredCommitments'][number]['affectedTravellerIds'][number],
        'trav-a2' as ProgrammeView['endangeredCommitments'][number]['affectedTravellerIds'][number],
        'trav-a3' as ProgrammeView['endangeredCommitments'][number]['affectedTravellerIds'][number],
      ],
    },
  ],
  unresolvedUncertainties: [
    'Whether the welcome dinner can be moved to the alternate venue in time',
  ],
};

export const programmeLoading: ReadModelEnvelope<ProgrammeView> = { state: 'LOADING' };

export const programmeError: ReadModelEnvelope<ProgrammeView> = {
  state: 'ERROR',
  errorMessage: 'The programme service did not respond. The trips have not been changed by this.',
};

export const healthyProgrammeLoaded: ReadModelEnvelope<ProgrammeView> = {
  state: 'LOADED',
  generatedAt: PROGRAMME_NOW,
  data: healthyProgramme,
};

export const programmeWithEndangeredCommitmentLoaded: ReadModelEnvelope<ProgrammeView> = {
  state: 'LOADED',
  generatedAt: PROGRAMME_NOW,
  data: programmeWithEndangeredCommitment,
};

// ---------------------------------------------------------------------------
// Envelope states — loading / error for both surfaces
// ---------------------------------------------------------------------------

export const operatorDashboardLoading: ReadModelEnvelope<OperatorDashboardView> = {
  state: 'LOADING',
};

export const operatorDashboardError: ReadModelEnvelope<OperatorDashboardView> = {
  state: 'ERROR',
  errorMessage: 'The trip summary service did not respond. Your trips have not been changed by this.',
};

export const operatorDashboardLoaded: ReadModelEnvelope<OperatorDashboardView> = {
  state: 'LOADED',
  generatedAt: UI_FIXTURE_NOW,
  data: operatorDashboard,
};

// ---------------------------------------------------------------------------
// Traveller trip views
// ---------------------------------------------------------------------------

export const travellerReady: TravellerTripView = {
  tripId: 'trip-ready',
  status: 'READY',
  actionsInProgress: [],
  inputRequested: [],
  remainderViable: 'VIABLE',
  updatedAt: '2026-09-14T08:00:00+08:00',
};

export const travellerDisrupted: TravellerTripView = {
  tripId: 'trip-disrupted',
  status: 'DISRUPTED',
  whatChanged: 'Your flight on 15 September was cancelled by the airline.',
  whatMattersNow: 'Getting you there in time for your talk on 16 September.',
  actionsInProgress: [
    'Looking for replacement flights',
    'Checking your hotel and transfer against the new arrival time',
  ],
  inputRequested: [],
  remainderViable: 'UNKNOWN',
  updatedAt: UI_FIXTURE_NOW,
};

export const travellerRecovering: TravellerTripView = {
  tripId: 'trip-recovering',
  status: 'RECOVERING',
  whatChanged: 'Your connection was delayed and your transfer no longer lines up.',
  whatMattersNow: 'Reaching the venue before the evening session.',
  actionsInProgress: ['Comparing replacement options', 'Re-checking your transfer timing'],
  inputRequested: [],
  remainderViable: 'AT_RISK',
  updatedAt: UI_FIXTURE_NOW,
};

export const travellerAwaitingInput: TravellerTripView = {
  tripId: 'trip-awaiting-traveller',
  status: 'RECOVERING',
  whatChanged: 'Your original flight no longer arrives before the event starts.',
  whatMattersNow: 'Choosing how you want to travel so we can book it.',
  actionsInProgress: [],
  inputRequested: [
    {
      caseId: 'case-choice',
      prompt: 'We found two ways to get you there. Which do you prefer?',
      options: [
        'Earlier flight — arrive with time to spare',
        'Later flight — cheaper, but you would miss the welcome dinner',
      ],
    },
  ],
  remainderViable: 'AT_RISK',
  updatedAt: UI_FIXTURE_NOW,
};

export const travellerUnknown: TravellerTripView = {
  tripId: 'trip-unknown',
  status: 'UNKNOWN',
  actionsInProgress: ['Trying to confirm your current flight status'],
  inputRequested: [],
  remainderViable: 'UNKNOWN',
  updatedAt: UI_FIXTURE_NOW,
};

export const travellerResolvedFully: TravellerTripView = {
  tripId: 'trip-resolved',
  status: 'RESOLVED',
  whatChanged: 'Your original flight was cancelled.',
  actionsInProgress: [],
  inputRequested: [],
  remainderViable: 'VIABLE',
  resolutionSummary:
    'You are rebooked on the 07:10 flight. Your transfer and hotel were updated, and everything originally planned is kept.',
  updatedAt: '2026-09-14T07:45:00+08:00',
};

export const travellerResolvedWithLoss: TravellerTripView = {
  tripId: 'trip-resolved-loss',
  status: 'RESOLVED',
  whatChanged: 'A strike cancelled your original routing.',
  actionsInProgress: [],
  inputRequested: [],
  remainderViable: 'VIABLE',
  resolutionSummary:
    'You are rebooked and will arrive in time for the main event. The welcome dinner could not be kept — no option preserved both.',
  updatedAt: '2026-09-14T08:20:00+08:00',
};

export const travellerLoading: ReadModelEnvelope<TravellerTripView> = { state: 'LOADING' };

export const travellerError: ReadModelEnvelope<TravellerTripView> = {
  state: 'ERROR',
  errorMessage: 'We could not load your trip right now. Nothing about your trip has changed.',
};

export const travellerDisruptedEnvelope: ReadModelEnvelope<TravellerTripView> = {
  state: 'LOADED',
  generatedAt: UI_FIXTURE_NOW,
  data: travellerDisrupted,
};

export const travellerAwaitingInputEnvelope: ReadModelEnvelope<TravellerTripView> = {
  state: 'LOADED',
  generatedAt: UI_FIXTURE_NOW,
  data: travellerAwaitingInput,
};

export const travellerResolvedWithLossEnvelope: ReadModelEnvelope<TravellerTripView> = {
  state: 'LOADED',
  generatedAt: UI_FIXTURE_NOW,
  data: travellerResolvedWithLoss,
};

// ---------------------------------------------------------------------------
// Case detail views (UI-local projection) — decision/approval/rejection/resolution
// ---------------------------------------------------------------------------

export const caseWithRejectedOption: CaseDetailView = {
  caseId: 'case-disrupted',
  tripId: 'trip-disrupted',
  tripLabel: 'Alex Reyes — Innovation Summit 2026',
  travellerNames: ['Alex Reyes'],
  status: 'RECOVERING',
  whatChanged: 'The flight on 15 September was cancelled by the airline.',
  affectedItems: ['Airport transfer', 'Hotel arrival window', 'Speaking slot on 16 September'],
  criticalObjectiveAtRisk: 'Speaking slot on 16 September at 09:00 — this cannot move.',
  checks: [
    { id: 'chk-arrival', label: 'New arrival is before the speaking slot', result: 'PASS' },
    { id: 'chk-transfer', label: 'Enough time from the airport to the hotel', result: 'PASS' },
    { id: 'chk-hotel', label: 'Hotel check-in still works with the new arrival', result: 'UNKNOWN' },
  ],
  options: [
    {
      id: 'opt-earlier',
      title: 'Earlier flight — arrives 14:20 on 15 September',
      summary: 'Same airline, one stop. Keeps the transfer, hotel and speaking slot.',
      verdict: 'VIABLE',
      recommended: true,
      costDelta: { amount: 145, currency: 'SGD' },
    },
    {
      id: 'opt-cheaper',
      title: 'Cheaper flight — arrives 21:40 on 16 September',
      summary: 'Lowest fare found.',
      verdict: 'NOT_VIABLE',
      rejectionReason: 'Arrives after the speaking slot on 16 September. The event time cannot move.',
      costDelta: { amount: -210, currency: 'SGD' },
    },
    {
      id: 'opt-nextday',
      title: 'Next available flight — 17 September',
      summary: 'Still being checked against the rest of the trip.',
      verdict: 'UNKNOWN',
    },
  ],
  actions: [],
  uncertainties: ['Seat availability on the earlier flight is not confirmed yet'],
  updatedAt: UI_FIXTURE_NOW,
};

export const caseAwaitingTravellerChoice: CaseDetailView = {
  caseId: 'case-choice',
  tripId: 'trip-awaiting-traveller',
  tripLabel: 'Sam Okafor — Innovation Summit 2026',
  travellerNames: ['Sam Okafor'],
  status: 'RECOVERING',
  whatChanged: 'The original flight no longer arrives before the event starts.',
  affectedItems: ['Hotel check-in', 'First-day session'],
  checks: [
    { id: 'chk-arrival-a', label: 'Option A arrives before the first-day session', result: 'PASS' },
    { id: 'chk-arrival-b', label: 'Option B arrives before the first-day session', result: 'PASS' },
  ],
  options: [
    {
      id: 'opt-a',
      title: 'Earlier flight — arrive with time to spare',
      summary: 'Keeps the welcome dinner and the first-day session.',
      verdict: 'VIABLE',
      recommended: true,
      costDelta: { amount: 95, currency: 'SGD' },
    },
    {
      id: 'opt-b',
      title: 'Later flight — cheaper, tighter arrival',
      summary: 'Saves money, but the welcome dinner would be missed.',
      verdict: 'VIABLE',
      costDelta: { amount: -60, currency: 'SGD' },
    },
  ],
  approval: {
    requestedFrom: 'TRAVELLER',
    reason: 'Both options work; we need the traveller to choose before booking.',
    state: 'PENDING',
  },
  actions: [],
  uncertainties: [],
  updatedAt: UI_FIXTURE_NOW,
};

export const caseAwaitingOrganisationApproval: CaseDetailView = {
  caseId: 'case-approval',
  tripId: 'trip-awaiting-approval',
  tripLabel: 'Mia Chen — Innovation Summit 2026',
  travellerNames: ['Mia Chen'],
  status: 'RECOVERING',
  whatChanged: 'The return flight was rescheduled and no longer connects.',
  affectedItems: ['Return flight', 'Airport transfer'],
  checks: [
    { id: 'chk-return', label: 'Replacement return connects in time', result: 'PASS' },
    { id: 'chk-policy', label: 'Cost is within the travel policy', result: 'FAIL' },
  ],
  options: [
    {
      id: 'opt-return',
      title: 'Replacement return flight — same day',
      summary: 'Only option that keeps the connection.',
      verdict: 'VIABLE',
      recommended: true,
      costDelta: { amount: 320, currency: 'SGD' },
      requiresApproval: true,
    },
  ],
  approval: {
    requestedFrom: 'ORGANISATION',
    reason: 'The replacement costs more than the travel policy allows.',
    amount: { amount: 320, currency: 'SGD' },
    state: 'PENDING',
  },
  actions: [],
  uncertainties: [],
  updatedAt: UI_FIXTURE_NOW,
};

export const caseRecoveringActions: CaseDetailView = {
  caseId: 'case-executing',
  tripId: 'trip-awaiting-approval',
  tripLabel: 'Mia Chen — Innovation Summit 2026',
  travellerNames: ['Mia Chen'],
  status: 'RECOVERING',
  whatChanged: 'The return flight was rescheduled and no longer connects.',
  affectedItems: ['Return flight', 'Airport transfer'],
  checks: [
    { id: 'chk-return', label: 'Replacement return connects in time', result: 'PASS' },
  ],
  options: [
    {
      id: 'opt-return',
      title: 'Replacement return flight — same day',
      verdict: 'VIABLE',
      recommended: true,
      costDelta: { amount: 320, currency: 'SGD' },
    },
  ],
  approval: {
    requestedFrom: 'ORGANISATION',
    reason: 'The replacement costs more than the travel policy allows.',
    amount: { amount: 320, currency: 'SGD' },
    state: 'APPROVED',
  },
  actions: [
    { id: 'act-flight', label: 'Rebooking the return flight', state: 'IN_PROGRESS' },
    { id: 'act-transfer', label: 'Updating the airport transfer', state: 'QUEUED' },
    { id: 'act-confirm', label: 'Confirming the new itinerary with the traveller', state: 'QUEUED' },
  ],
  uncertainties: [],
  updatedAt: UI_FIXTURE_NOW,
};

export const caseResolvedFully: CaseDetailView = {
  caseId: 'case-resolved',
  tripId: 'trip-resolved',
  tripLabel: 'Emma Fischer — Innovation Summit 2026',
  travellerNames: ['Emma Fischer'],
  status: 'RESOLVED',
  whatChanged: 'The original flight was cancelled; a replacement was booked and confirmed.',
  affectedItems: ['Airport transfer', 'Hotel arrival window'],
  checks: [
    { id: 'chk-arrival', label: 'New arrival is before the speaking slot', result: 'PASS' },
    { id: 'chk-transfer', label: 'Transfer lines up with the new arrival', result: 'PASS' },
    { id: 'chk-hotel', label: 'Hotel check-in works with the new arrival', result: 'PASS' },
  ],
  options: [
    {
      id: 'opt-booked',
      title: 'Earlier flight — arrives 07:10',
      summary: 'Booked and confirmed.',
      verdict: 'VIABLE',
      recommended: true,
      costDelta: { amount: 120, currency: 'SGD' },
    },
  ],
  actions: [
    { id: 'act-flight', label: 'Rebooking the flight', state: 'DONE' },
    { id: 'act-transfer', label: 'Updating the airport transfer', state: 'DONE' },
    { id: 'act-hotel', label: 'Updating the hotel arrival', state: 'DONE' },
  ],
  uncertainties: [],
  resolution: {
    outcome: 'FULLY_RECOVERED',
    summary: 'Rebooked on the 07:10 flight; transfer and hotel updated. Everything originally planned is kept.',
  },
  updatedAt: '2026-09-14T07:45:00+08:00',
};

export const caseResolvedWithLoss: CaseDetailView = {
  caseId: 'case-resolved-loss',
  tripId: 'trip-resolved-loss',
  tripLabel: 'Lucas Silva — Innovation Summit 2026',
  travellerNames: ['Lucas Silva'],
  status: 'RESOLVED',
  whatChanged: 'A strike cancelled the original routing; a replacement was booked.',
  affectedItems: ['Welcome dinner', 'Airport transfer'],
  checks: [
    { id: 'chk-event', label: 'Arrives before the main event', result: 'PASS' },
    { id: 'chk-dinner', label: 'Arrives before the welcome dinner', result: 'FAIL' },
  ],
  options: [
    {
      id: 'opt-booked',
      title: 'Replacement routing — arrives before the main event',
      summary: 'Booked and confirmed.',
      verdict: 'VIABLE',
      recommended: true,
      costDelta: { amount: 180, currency: 'SGD' },
    },
  ],
  actions: [
    { id: 'act-flight', label: 'Rebooking the flight', state: 'DONE' },
    { id: 'act-transfer', label: 'Updating the airport transfer', state: 'DONE' },
  ],
  uncertainties: [],
  resolution: {
    outcome: 'RECOVERED_WITH_LOSS',
    summary: 'Recovered in time for the main event. The welcome dinner could not be preserved.',
    remainingLosses: ['Welcome dinner with the organisers'],
  },
  updatedAt: '2026-09-14T08:20:00+08:00',
};

// ---------------------------------------------------------------------------
// Catalogues for tests and the preview generator
// ---------------------------------------------------------------------------

export interface NamedFixture<T> {
  id: string;
  title: string;
  view: T;
}

export const CASE_FIXTURES: readonly NamedFixture<CaseDetailView>[] = [
  { id: 'rejected-option', title: 'Rejected attractive option', view: caseWithRejectedOption },
  { id: 'awaiting-traveller', title: 'Awaiting traveller choice', view: caseAwaitingTravellerChoice },
  { id: 'awaiting-approval', title: 'Awaiting organisation approval', view: caseAwaitingOrganisationApproval },
  { id: 'actions-in-progress', title: 'Actions in progress', view: caseRecoveringActions },
  { id: 'resolved-fully', title: 'Resolved — fully recovered', view: caseResolvedFully },
  { id: 'resolved-with-loss', title: 'Resolved — recovered with loss', view: caseResolvedWithLoss },
];

export const TRAVELLER_FIXTURES: readonly NamedFixture<TravellerTripView>[] = [
  { id: 'ready', title: 'Ready', view: travellerReady },
  { id: 'disrupted', title: 'Disrupted', view: travellerDisrupted },
  { id: 'recovering', title: 'Recovering', view: travellerRecovering },
  { id: 'awaiting-input', title: 'Decision needed', view: travellerAwaitingInput },
  { id: 'unknown', title: 'Uncertain', view: travellerUnknown },
  { id: 'resolved-fully', title: 'Resolved — fully', view: travellerResolvedFully },
  { id: 'resolved-with-loss', title: 'Resolved — with loss', view: travellerResolvedWithLoss },
];
