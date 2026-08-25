/**
 * Rewrite acceptance manifests + packs to the AiT programme world.
 * Structural preflight readiness only — steps exercise real HTTP boundaries
 * with AiT draft/PNR/commitment ids from data/ait-demo-input-pack.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ANCHOR = 'evt-ait-2026';
const trv = (draft) => `trv-${ANCHOR}-${draft}`;
const trip = (draft) => `trip-${trv(draft)}`;

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

function baseManifest({ scenarioId, title, localPackId, expect, boundaries, steps, routeParams = [] }) {
  return {
    scenarioId,
    title,
    mode: boundaries[0]?.mode ?? 'REPLAY',
    globalInputPack: { packId: globalPack.packId, version: globalPack.version, path: '../packs/global' },
    localInputPack: { packId: localPackId, version: '1.0.0', path: `../packs/${localPackId.replace(/^s(\d).*/, 's$1').replace(/-.*/, '') || localPackId}` },
    boundaries,
    requiredEnv: [],
    requiredProviders: [],
    expect,
    routeParams,
    steps,
  };
}

// Fix local pack paths explicitly per scenario
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
      {
        id: 'reset',
        description: 'Deterministic reset/reseed',
        action: { type: 'http', method: 'POST', path: '/api/runtime/reset', body: { at: '2026-09-21T09:00:00+08:00' }, expectStatus: 200 },
      },
      {
        id: 'trigger_mn218_hero',
        description: 'Simulated MN218 schedule change for hero PNR MNSYN14',
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
        description: 'Same schedule-change shape for peer PNR MNSYN15 (multi-trip fan-out)',
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
        description: 'Simulated MN204 cancellation for PNR MNSYN13',
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
      {
        id: 'observe_case',
        description: 'Observe opened recovery case for hero',
        action: { type: 'observe', path: '/api/cases/{{caseId}}', label: 'case_after_simulated_ingress', expectStatus: 200 },
      },
    ],
  },
  's2-missed-connection.json': {
    scenarioId: 'S2',
    title: 'Missed connection after late inbound',
    localDir: 's2',
    mode: 'SIMULATED_EXTERNAL_EVENT',
    expect: {
      anchorEventIds: [ANCHOR],
      travellerIds: [trv('ait-draft-09')],
      tripIds: [trip('ait-draft-09')],
    },
    boundaries: [
      { seam: 'traveller.report', mode: 'LIVE', note: 'Natural traveller report through product HTTP' },
      { seam: 'atlas.event_ingress', mode: 'SIMULATED_EXTERNAL_EVENT', note: 'Provider reprotection state is simulated' },
    ],
    steps: [
      {
        id: 'reset',
        action: { type: 'http', method: 'POST', path: '/api/runtime/reset', body: { at: '2026-09-29T18:00:00+08:00' }, expectStatus: 200 },
      },
      {
        id: 'traveller_report',
        action: {
          type: 'http',
          method: 'POST',
          path: '/api/runtime/report-missed-flight',
          body: {
            tripId: trip('ait-draft-09'),
            at: '2026-09-29T19:30:00+08:00',
            summary: 'Missed connection after late inbound; need recovery options',
          },
          expectStatus: 200,
          capture: { caseId: 'caseId', tripId: 'tripId' },
        },
      },
      {
        id: 'observe_case',
        action: { type: 'observe', path: '/api/cases/{{caseId}}', label: 'case_after_missed_connection', expectStatus: 200 },
      },
    ],
  },
  's3-organiser-preview.json': {
    scenarioId: 'S3',
    title: 'Organiser event-side preview',
    localDir: 's3',
    mode: 'REPLAY',
    expect: { anchorEventIds: [ANCHOR], travellerIds: [], tripIds: [] },
    boundaries: [{ seam: 'programme.event_change', mode: 'REPLAY', note: 'Preview/commit through programme HTTP; mutation-free preview' }],
    steps: [
      {
        id: 'reset',
        action: { type: 'http', method: 'POST', path: '/api/runtime/reset', body: { at: '2026-09-28T10:00:00+08:00' }, expectStatus: 200 },
      },
      {
        id: 'preview',
        action: {
          type: 'http',
          method: 'POST',
          path: `/api/programme/${ANCHOR}/change-preview`,
          body: {
            commitmentId: 'cmt-ait-d1-future-provocation',
            changeKind: 'RESCHEDULED',
            newStartsAt: '2026-10-01T16:00:00+08:00',
            newEndsAt: '2026-10-01T17:00:00+08:00',
            at: '2026-09-28T10:05:00+08:00',
          },
          expectStatus: 200,
          capture: { previewId: 'previewId' },
        },
      },
      {
        id: 'observe_programme',
        action: { type: 'observe', path: `/api/programme/${ANCHOR}`, label: 'programme_after_preview', expectStatus: 200 },
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
    boundaries: [{ seam: 'traveller.change_request', mode: 'REPLAY', note: 'Natural ChangeRequest through resolution HTTP' }],
    steps: [
      {
        id: 'reset',
        action: { type: 'http', method: 'POST', path: '/api/runtime/reset', body: { at: '2026-09-20T10:00:00+08:00' }, expectStatus: 200 },
      },
      {
        id: 'change_request',
        action: {
          type: 'http',
          method: 'POST',
          path: '/api/resolution/change-request',
          body: {
            tripId: trip('ait-draft-34'),
            travellerId: trv('ait-draft-34'),
            at: '2026-09-20T10:05:00+08:00',
            utterance: 'Can I arrive Thursday morning instead?',
            target: { arriveBy: '2026-10-01T09:00:00+08:00' },
          },
          expectStatus: 200,
        },
      },
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
    boundaries: [{ seam: 'traveller.change_request', mode: 'REPLAY' }],
    steps: [
      {
        id: 'reset',
        action: { type: 'http', method: 'POST', path: '/api/runtime/reset', body: { at: '2026-09-25T10:00:00+08:00' }, expectStatus: 200 },
      },
      {
        id: 'change_request',
        action: {
          type: 'http',
          method: 'POST',
          path: '/api/resolution/change-request',
          body: {
            tripId: trip('ait-draft-35'),
            travellerId: trv('ait-draft-35'),
            at: '2026-09-25T10:05:00+08:00',
            utterance: 'Can I stay until Sunday?',
            target: {
              departAfter: '2026-10-04T12:00:00+08:00',
              stayCheckOut: '2026-10-04T11:00:00+08:00',
            },
            fundingDeclaration: { incrementalPayer: 'TRAVELLER' },
          },
          expectStatus: 200,
        },
      },
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
    boundaries: [{ seam: 'traveller.change_request', mode: 'REPLAY' }],
    steps: [
      {
        id: 'reset',
        action: { type: 'http', method: 'POST', path: '/api/runtime/reset', body: { at: '2026-09-22T10:00:00+08:00' }, expectStatus: 200 },
      },
      {
        id: 'change_request',
        action: {
          type: 'http',
          method: 'POST',
          path: '/api/resolution/change-request',
          body: {
            tripId: trip('ait-draft-31'),
            travellerId: trv('ait-draft-31'),
            at: '2026-09-22T10:05:00+08:00',
            utterance: 'Can I switch hotels? My partner is joining.',
            target: {
              preferredStayPlaceId: 'place-hotel-harbourline',
              guests: 2,
            },
            fundingDeclaration: { incrementalPayer: 'TRAVELLER' },
          },
          expectStatus: 200,
        },
      },
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
    boundaries: [{ seam: 'traveller.change_request', mode: 'REPLAY' }],
    steps: [
      {
        id: 'reset',
        action: { type: 'http', method: 'POST', path: '/api/runtime/reset', body: { at: '2026-09-18T10:00:00+08:00' }, expectStatus: 200 },
      },
      {
        id: 'change_request',
        action: {
          type: 'http',
          method: 'POST',
          path: '/api/resolution/change-request',
          body: {
            tripId: trip('ait-draft-38'),
            travellerId: trv('ait-draft-38'),
            at: '2026-09-18T10:05:00+08:00',
            utterance: 'I am actually flying from Tokyo, not London.',
            target: { departureOrigin: { system: 'airport-code', value: 'HND' } },
          },
          expectStatus: 200,
        },
      },
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
    boundaries: [{ seam: 'traveller.change_request', mode: 'REPLAY' }],
    steps: [
      {
        id: 'reset',
        action: { type: 'http', method: 'POST', path: '/api/runtime/reset', body: { at: '2026-09-19T10:00:00+08:00' }, expectStatus: 200 },
      },
      {
        id: 'change_request',
        action: {
          type: 'http',
          method: 'POST',
          path: '/api/resolution/change-request',
          body: {
            tripId: trip('ait-draft-30'),
            travellerId: trv('ait-draft-30'),
            at: '2026-09-19T10:05:00+08:00',
            utterance: 'Can I travel with the other speakers on the same flight?',
            target: { arriveBy: '2026-09-30T08:00:00+08:00' },
          },
          expectStatus: 200,
        },
      },
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
        inputPackPath: `../../../../data/ait-demo-input-pack/scenarios`,
        expect: spec.expect,
      },
      null,
      2,
    )}\n`,
  );
}

console.log(`rewrote ${Object.keys(manifests).length} manifests + global pack for ${ANCHOR}`);
