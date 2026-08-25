/**
 * Rewrite acceptance manifests + packs to the AiT programme world.
 * Structural preflight readiness only — steps exercise real HTTP boundaries
 * with AiT draft/PNR/commitment ids from data/ait-demo-input-pack.
 *
 * Every step targets a REAL product endpoint:
 *   POST /api/runtime/reset                 (deterministic reset/reseed)
 *   POST /api/events/atlas                  (approved simulated external ingress)
 *   POST /api/runtime/missed-flight         (traveller-state report)
 *   POST /api/programme/:anchor/change-preview
 *   POST /api/resolution/change-request     (structured ChangeRequest envelope)
 *   GET  /api/cases/:caseId                 (observe)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ANCHOR = 'evt-ait-2026';
const trv = (draft) => `trv-${ANCHOR}-${draft}`;
const trip = (draft) => `trip-${trv(draft)}`;
const CHANGE_REQUEST_SOURCE = 'src-acceptance-manifest';

const globalPack = {
  packId: 'ait-global-programme',
  version: '1.0.0',
  description:
    'Global input pack: AiT canonical programme under fixtures/programmes/ait-summit-2026 (built from data/ait-demo-input-pack).',
  programmeRef: '../../programmes/ait-summit-2026',
  anchorEventId: ANCHOR,
  inputPackRoot: '../../../data/ait-demo-input-pack',
};

function atlasEvent({ eventId, orderNo, pnr, eventType, eventTime, depTime }) {
  return {
    eventId,
    orderNo,
    eventType,
    eventStatus: 1,
    eventTime,
    createTime: eventTime,
    airline: 'MN',
    ...(depTime ? { depTime } : {}),
    ...(pnr ? { pnr } : {}),
  };
}

/** Envelope for POST /api/resolution/change-request ({ request, at }). */
function changeRequestBody({ scenarioId, draft, at, intentKind, utterance, target, fundingDeclaration }) {
  return {
    request: {
      id: `cr-ait-${scenarioId.toLowerCase()}-001`,
      tripId: trip(draft),
      travellerId: trv(draft),
      sourceId: CHANGE_REQUEST_SOURCE,
      authority: 'ASSERTED',
      issuedAt: at,
      intentKind,
      urgency: 'HARD_INSTRUCTION',
      utterance,
      target,
      ...(fundingDeclaration ? { fundingDeclaration } : {}),
    },
    at,
  };
}

function resetStep(at) {
  return {
    id: 'reset',
    description: 'Deterministic reset/reseed',
    action: { type: 'http', method: 'POST', path: '/api/runtime/reset', body: { at }, expectStatus: 200 },
  };
}

function observeCaseStep(label) {
  return {
    id: 'observe_case',
    description: 'Observe opened recovery case',
    action: { type: 'observe', path: '/api/cases/{{caseId}}', label, expectStatus: 200 },
  };
}

const manifests = {
  's1-airline-schedule-change.json': {
    scenarioId: 'S1',
    title: 'Airline schedule change affects several speakers',
    localDir: 's1',
    mode: 'SIMULATED_EXTERNAL_EVENT',
    expect: {
      anchorEventIds: [ANCHOR],
      travellerIds: [trv('ait-draft-14'), trv('ait-draft-15'), trv('ait-draft-13')],
      tripIds: [trip('ait-draft-14'), trip('ait-draft-15'), trip('ait-draft-13')],
    },
    boundaries: [
      { seam: 'atlas.event_ingress', mode: 'SIMULATED_EXTERNAL_EVENT', note: 'Provider-shaped schedule/cancel events via POST /api/events/atlas' },
      { seam: 'atlas.flight_adapter', mode: 'REPLAY', note: 'Downstream adapter REPLAY unless LIVE acceptance overrides' },
    ],
    steps: [
      resetStep('2026-09-21T09:00:00+08:00'),
      {
        id: 'trigger_mn218_hero',
        description: 'Simulated MN218 schedule change for hero booking MNSYN14',
        action: {
          type: 'simulated_external_event',
          path: '/api/events/atlas',
          query: { at: '2026-09-21T09:45:00+08:00' },
          body: atlasEvent({
            eventId: 'sim-mn-evt-20260921-001-mnsyn14',
            orderNo: 'MNSYN14',
            pnr: 'MNSYN14',
            eventType: 'SCHEDULE_CHANGE',
            eventTime: '2026-09-21T09:40:00+08:00',
            depTime: '2026-09-30T06:15:00+08:00',
          }),
          capture: { caseId: 'results.0.caseId', tripId: 'results.0.tripId' },
          expectStatus: 200,
        },
      },
      {
        id: 'trigger_mn218_peer',
        description: 'Same schedule-change shape for peer booking MNSYN15 (multi-trip fan-out)',
        action: {
          type: 'simulated_external_event',
          path: '/api/events/atlas',
          query: { at: '2026-09-21T09:46:00+08:00' },
          body: atlasEvent({
            eventId: 'sim-mn-evt-20260921-001-mnsyn15',
            orderNo: 'MNSYN15',
            pnr: 'MNSYN15',
            eventType: 'SCHEDULE_CHANGE',
            eventTime: '2026-09-21T09:40:00+08:00',
            depTime: '2026-09-30T06:15:00+08:00',
          }),
          expectStatus: 200,
        },
      },
      {
        id: 'trigger_mn204',
        description: 'Simulated MN204 cancellation for booking MNSYN13',
        action: {
          type: 'simulated_external_event',
          path: '/api/events/atlas',
          query: { at: '2026-09-21T09:55:00+08:00' },
          body: atlasEvent({
            eventId: 'sim-mn-evt-20260921-002',
            orderNo: 'MNSYN13',
            pnr: 'MNSYN13',
            eventType: 'CANCELLATION',
            eventTime: '2026-09-21T09:55:00+08:00',
            depTime: '2026-09-30T08:35:00+08:00',
          }),
          expectStatus: 200,
        },
      },
      observeCaseStep('case_after_simulated_ingress'),
    ],
  },
  's2-missed-connection.json': {
    scenarioId: 'S2',
    title: 'Missed connection after late inbound',
    localDir: 's2',
    mode: 'REPLAY',
    expect: {
      anchorEventIds: [ANCHOR],
      travellerIds: [trv('ait-draft-09')],
      tripIds: [trip('ait-draft-09')],
    },
    boundaries: [
      { seam: 'runtime.missed_flight', mode: 'REPLAY', note: 'Traveller-state report through POST /api/runtime/missed-flight' },
      { seam: 'atlas.flight_adapter', mode: 'REPLAY', note: 'Provider reprotection state stays REPLAY' },
    ],
    steps: [
      resetStep('2026-09-29T18:00:00+08:00'),
      {
        id: 'traveller_report',
        description: 'Traveller reports missed KUL->SIN connection (pack msg-ait-s2-001); explicit elementId because the report lands after the leg\'s scheduled departure (DR-7 seam)',
        action: {
          type: 'http',
          method: 'POST',
          path: '/api/runtime/missed-flight',
          body: {
            tripId: trip('ait-draft-09'),
            elementId: 'el-' + trip('ait-draft-09') + '-leg-2',
            travellerReport:
              'Hi - stuck in KL. My flight out of Sydney left about five hours late (weather holding) and I missed my connection to Singapore. The airline desk rebooked me on a flight tomorrow morning at 8:10, landing just after 9. I present at the hackathon finals tomorrow afternoon and I am supposed to be at the lab in the morning too. My suitcase went on the morning flight apparently. What do we do?',
            at: '2026-09-29T19:40:00+08:00',
          },
          expectStatus: 200,
          capture: { caseId: 'caseId' },
        },
      },
      observeCaseStep('case_after_missed_connection'),
    ],
  },
  's3-organiser-preview.json': {
    scenarioId: 'S3',
    title: 'Organiser event-side preview',
    localDir: 's3',
    mode: 'REPLAY',
    expect: {
      anchorEventIds: [ANCHOR],
      travellerIds: [trv('ait-draft-04'), trv('ait-draft-20'), trv('ait-draft-02')],
      tripIds: [],
    },
    boundaries: [
      { seam: 'programme.change_preview', mode: 'REPLAY', note: 'Organiser Preview through real programme HTTP surface' },
      { seam: 'programme.change_commit', mode: 'REPLAY', note: 'Organiser Commit through real programme HTTP surface' },
    ],
    steps: [
      resetStep('2026-09-22T10:00:00+08:00'),
      {
        id: 'organiser_preview',
        description: 'Organiser Preview (counterfactual, no mutation): move future-provocation into the 09:50-10:10 Day-1 slot',
        action: {
          type: 'ui_action',
          kind: 'organiser_preview',
          params: {
            anchorEventId: ANCHOR,
            commitmentId: 'cmt-ait-d1-future-provocation',
            changeKind: 'RESCHEDULED',
            newStartsAt: '2026-10-01T09:50:00+08:00',
            newEndsAt: '2026-10-01T10:10:00+08:00',
            at: '2026-09-22T11:05:00+08:00',
          },
          expectStatus: 200,
        },
      },
      {
        id: 'organiser_commit',
        description: 'Organiser Commit fan-out through the same programme HTTP surface',
        action: {
          type: 'ui_action',
          kind: 'organiser_commit',
          params: {
            anchorEventId: ANCHOR,
            commitmentId: 'cmt-ait-d1-future-provocation',
            changeKind: 'RESCHEDULED',
            newStartsAt: '2026-10-01T09:50:00+08:00',
            newEndsAt: '2026-10-01T10:10:00+08:00',
            at: '2026-09-22T11:20:00+08:00',
          },
          expectStatus: 200,
        },
      },
      {
        id: 'observe_programme',
        action: { type: 'observe', path: `/api/programme/${ANCHOR}`, label: 'programme_after_commit', expectStatus: 200 },
      },
    ],
  },
  's4-thursday-morning-arrival.json': {
    scenarioId: 'S4',
    title: 'Can I arrive Thursday morning instead?',
    localDir: 's4',
    mode: 'REPLAY',
    expect: {
      anchorEventIds: [ANCHOR],
      travellerIds: [trv('ait-draft-34')],
      tripIds: [trip('ait-draft-34')],
    },
    routeParams: [{ origin: 'CNX', destination: 'SIN', date: '2026-10-01' }],
    boundaries: [{ seam: 'traveller.change_request', mode: 'REPLAY', note: 'Structured ChangeRequest through resolution HTTP' }],
    steps: [
      resetStep('2026-09-20T10:00:00+08:00'),
      {
        id: 'change_request',
        action: {
          type: 'http',
          method: 'POST',
          path: '/api/resolution/change-request',
          body: changeRequestBody({
            scenarioId: 'S4',
            draft: 'ait-draft-34',
            at: '2026-09-20T10:05:00+08:00',
            intentKind: 'ADJUST_TRIP_WINDOW',
            utterance: 'Can I arrive Thursday morning instead?',
            target: { arriveBy: '2026-10-01T09:00:00+08:00' },
          }),
          expectStatus: 200,
          capture: { caseId: 'caseId' },
        },
      },
      observeCaseStep('case_after_change_request'),
    ],
  },
  's5-stay-until-sunday.json': {
    scenarioId: 'S5',
    title: 'Can I stay until Sunday?',
    localDir: 's5',
    mode: 'REPLAY',
    expect: {
      anchorEventIds: [ANCHOR],
      travellerIds: [trv('ait-draft-35')],
      tripIds: [trip('ait-draft-35')],
    },
    boundaries: [{ seam: 'traveller.change_request', mode: 'REPLAY', note: 'Structured ChangeRequest through resolution HTTP' }],
    steps: [
      resetStep('2026-09-25T10:00:00+08:00'),
      {
        id: 'change_request',
        action: {
          type: 'http',
          method: 'POST',
          path: '/api/resolution/change-request',
          body: changeRequestBody({
            scenarioId: 'S5',
            draft: 'ait-draft-35',
            at: '2026-09-25T10:05:00+08:00',
            intentKind: 'ADJUST_TRIP_WINDOW',
            utterance: 'Can I stay until Sunday?',
            target: {
              departAfter: '2026-10-04T12:00:00+08:00',
              stayCheckOut: '2026-10-04T11:00:00+08:00',
            },
            fundingDeclaration: 'TRAVELLER_FUNDED',
          }),
          expectStatus: 200,
          capture: { caseId: 'caseId' },
        },
      },
      observeCaseStep('case_after_change_request'),
    ],
  },
  's6-switch-hotels.json': {
    scenarioId: 'S6',
    title: 'Can I switch hotels? My partner is joining.',
    localDir: 's6',
    mode: 'REPLAY',
    expect: {
      anchorEventIds: [ANCHOR],
      travellerIds: [trv('ait-draft-31')],
      tripIds: [trip('ait-draft-31')],
    },
    boundaries: [{ seam: 'traveller.change_request', mode: 'REPLAY', note: 'Structured ChangeRequest through resolution HTTP' }],
    steps: [
      resetStep('2026-09-22T10:00:00+08:00'),
      {
        id: 'change_request',
        action: {
          type: 'http',
          method: 'POST',
          path: '/api/resolution/change-request',
          body: changeRequestBody({
            scenarioId: 'S6',
            draft: 'ait-draft-31',
            at: '2026-09-22T10:05:00+08:00',
            intentKind: 'CHANGE_STAY',
            utterance: 'Can I switch hotels? My partner is joining.',
            target: {
              preferredStayPlaceId: 'place-hotel-harbourline',
              guests: 2,
            },
            fundingDeclaration: 'TRAVELLER_FUNDED',
          }),
          expectStatus: 200,
          capture: { caseId: 'caseId' },
        },
      },
      observeCaseStep('case_after_change_request'),
    ],
  },
  's7-origin-tokyo.json': {
    scenarioId: 'S7',
    title: 'I am actually flying from Tokyo, not London.',
    localDir: 's7',
    mode: 'REPLAY',
    expect: {
      anchorEventIds: [ANCHOR],
      travellerIds: [trv('ait-draft-38')],
      tripIds: [trip('ait-draft-38')],
    },
    routeParams: [{ origin: 'HND', destination: 'SIN', date: '2026-09-29' }],
    boundaries: [{ seam: 'traveller.change_request', mode: 'REPLAY', note: 'Structured ChangeRequest through resolution HTTP' }],
    steps: [
      resetStep('2026-09-18T10:00:00+08:00'),
      {
        id: 'change_request',
        action: {
          type: 'http',
          method: 'POST',
          path: '/api/resolution/change-request',
          body: changeRequestBody({
            scenarioId: 'S7',
            draft: 'ait-draft-38',
            at: '2026-09-18T10:05:00+08:00',
            intentKind: 'CHANGE_TRANSPORT_SCHEDULE',
            utterance: 'I am actually flying from Tokyo, not London.',
            target: { departureOrigin: { system: 'airport-code', value: 'HND' } },
          }),
          expectStatus: 200,
          capture: { caseId: 'caseId' },
        },
      },
      observeCaseStep('case_after_change_request'),
    ],
  },
  's8-travel-with-speakers.json': {
    scenarioId: 'S8',
    title: 'Can I travel with the other speakers?',
    localDir: 's8',
    mode: 'REPLAY',
    expect: {
      anchorEventIds: [ANCHOR],
      travellerIds: [trv('ait-draft-30'), trv('ait-draft-10'), trv('ait-draft-11')],
      tripIds: [trip('ait-draft-30'), trip('ait-draft-10'), trip('ait-draft-11')],
    },
    boundaries: [{ seam: 'traveller.change_request', mode: 'REPLAY', note: 'Structured ChangeRequest through resolution HTTP' }],
    steps: [
      resetStep('2026-09-19T10:00:00+08:00'),
      {
        id: 'change_request',
        action: {
          type: 'http',
          method: 'POST',
          path: '/api/resolution/change-request',
          body: changeRequestBody({
            scenarioId: 'S8',
            draft: 'ait-draft-30',
            at: '2026-09-19T10:05:00+08:00',
            intentKind: 'ADJUST_TRIP_WINDOW',
            utterance: 'Can I travel with the other speakers on the same flight?',
            target: { arriveBy: '2026-09-30T08:00:00+08:00' },
          }),
          expectStatus: 200,
          capture: { caseId: 'caseId' },
        },
      },
      observeCaseStep('case_after_change_request'),
    ],
  },
};

mkdirSync('fixtures/acceptance/packs/global', { recursive: true });
writeFileSync('fixtures/acceptance/packs/global/pack.json', `${JSON.stringify(globalPack, null, 2)}\n`);

for (const [file, spec] of Object.entries(manifests)) {
  const localDir = spec.localDir;
  const manifest = {
    scenarioId: spec.scenarioId,
    title: spec.title,
    mode: spec.mode,
    globalInputPack: { packId: globalPack.packId, version: '1.0.0', path: '../packs/global' },
    localInputPack: { packId: `ait-${localDir}`, version: '1.0.0', path: `../packs/${localDir}` },
    boundaries: spec.boundaries,
    requiredEnv: [],
    requiredProviders: [],
    expect: spec.expect,
    routeParams: spec.routeParams ?? [],
    steps: spec.steps,
  };
  writeFileSync(join('fixtures/acceptance/manifests', file), `${JSON.stringify(manifest, null, 2)}\n`);
  mkdirSync(join('fixtures/acceptance/packs', localDir), { recursive: true });
  writeFileSync(
    join('fixtures/acceptance/packs', localDir, 'pack.json'),
    `${JSON.stringify(
      {
        packId: `ait-${localDir}`,
        version: '1.0.0',
        scenarioId: spec.scenarioId,
        description: `Local acceptance pack for ${spec.scenarioId}; facts live in data/ait-demo-input-pack`,
        inputPackPath: '../../../../data/ait-demo-input-pack/scenarios',
        expect: spec.expect,
      },
      null,
      2,
    )}\n`,
  );
}

console.log(`rewrote ${Object.keys(manifests).length} manifests + global pack for ${ANCHOR}`);
