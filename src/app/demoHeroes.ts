/**
 * Demo-only manifest workflow catalogs for the deployed demo control panel.
 * Manifest paths and stop-before step ids are allowed here because this is
 * demo tooling — never imported by domain/engine recovery logic.
 */
export interface DemoManifestWorkflow {
  /** Stable demo control id (URL / button key). */
  id: string;
  /** Frozen scenario id for rehearsal catalogue labelling (demo-only). */
  scenarioId?: string;
  title: string;
  description: string;
  /** Path relative to the process cwd (repo root). */
  manifestPath: string;
  /**
   * Do not execute these step ids (and skip the rest). Manual rehearsal
   * continues from the resulting awaiting-authority / inspectable state.
   */
  stopBeforeStepIds: string[];
}

export type DemoHeroWorkflow = DemoManifestWorkflow;

/**
 * Full S1–S8 diagnostic catalogue. Each entry drives the current acceptance
 * manifest through real product endpoints — not legacy scenario fixtures.
 */
export const DEMO_SCENARIO_REHEARSALS: readonly DemoManifestWorkflow[] = [
  {
    id: 'rehearsal-s1',
    scenarioId: 'S1',
    title: 'S1 — Airline schedule change',
    description: 'Groups A/C disruption signals and observe the resulting trip and case state.',
    manifestPath: 'fixtures/acceptance/manifests/s1-airline-schedule-change.json',
    stopBeforeStepIds: [],
  },
  {
    id: 'rehearsal-s2',
    scenarioId: 'S2',
    title: 'S2 — Missed connection',
    description: 'Progressive delay and missed connection through planning. Stops before organiser approval.',
    manifestPath: 'fixtures/acceptance/manifests/s2-missed-connection.json',
    stopBeforeStepIds: ['decide_recovery'],
  },
  {
    id: 'rehearsal-s3',
    scenarioId: 'S3',
    title: 'S3 — Organiser preview',
    description: 'Organiser preview and commit for the headline interview commitment.',
    manifestPath: 'fixtures/acceptance/manifests/s3-organiser-preview.json',
    stopBeforeStepIds: [],
  },
  {
    id: 'rehearsal-s4',
    scenarioId: 'S4',
    title: 'S4 — Thursday morning arrival',
    description: 'Natural-language intake and planning for a Thursday-morning arrival constraint.',
    manifestPath: 'fixtures/acceptance/manifests/s4-thursday-morning-arrival.json',
    stopBeforeStepIds: [],
  },
  {
    id: 'rehearsal-s5',
    scenarioId: 'S5',
    title: 'S5 — Stay until Sunday',
    description: 'Traveller hotel extension request through planning. Stops before traveller approval.',
    manifestPath: 'fixtures/acceptance/manifests/s5-stay-until-sunday.json',
    stopBeforeStepIds: ['decide'],
  },
  {
    id: 'rehearsal-s6',
    scenarioId: 'S6',
    title: 'S6 — Switch hotels',
    description: 'Traveller change request to switch hotels and observe the recovery case.',
    manifestPath: 'fixtures/acceptance/manifests/s6-switch-hotels.json',
    stopBeforeStepIds: [],
  },
  {
    id: 'rehearsal-s7',
    scenarioId: 'S7',
    title: 'S7 — Tokyo origin change',
    description: 'Natural-language origin correction with FX restatement. Stops before automated authority.',
    manifestPath: 'fixtures/acceptance/manifests/s7-origin-tokyo.json',
    stopBeforeStepIds: ['decide'],
  },
  {
    id: 'rehearsal-s8',
    scenarioId: 'S8',
    title: 'S8 — Travel with speakers',
    description: 'Linked-speaker travel change request and observe the resulting case state.',
    manifestPath: 'fixtures/acceptance/manifests/s8-travel-with-speakers.json',
    stopBeforeStepIds: [],
  },
];

/** Final video choreography order: S2 → S1 → S3 → S7 → S5. */
export const DEMO_HERO_WORKFLOWS: readonly DemoHeroWorkflow[] = [
  {
    id: 's2',
    title: 'S2 — Missed connection',
    description:
      'Progressive delay, missed connection, overnight recovery planning. Stops before organiser approval so authority stays real.',
    manifestPath: 'fixtures/acceptance/manifests/s2-missed-connection.json',
    stopBeforeStepIds: ['decide_recovery'],
  },
  {
    id: 's1-s3',
    title: 'S1 → S3 continuous story',
    description:
      'Airline schedule-change endangers the critical headline trip, then organiser preview → commit reschedules the commitment and re-evaluates the same trip.',
    manifestPath: 'fixtures/acceptance/manifests/s1-s3-continuity.json',
    stopBeforeStepIds: [],
  },
  {
    id: 's7',
    title: 'S7 — Tokyo origin change',
    description:
      'Natural-language origin correction with FX restatement. Stops at human-agent / awaiting approval — no automated settle.',
    manifestPath: 'fixtures/acceptance/manifests/s7-origin-tokyo.json',
    stopBeforeStepIds: ['decide'],
  },
  {
    id: 's5',
    title: 'S5 — Stay until Sunday',
    description:
      'Traveller requests a self-funded hotel extension. Stops awaiting traveller approval so that authority remains required.',
    manifestPath: 'fixtures/acceptance/manifests/s5-stay-until-sunday.json',
    stopBeforeStepIds: ['decide'],
  },
];

export function demoManifestWorkflow(id: string): DemoManifestWorkflow | undefined {
  return DEMO_SCENARIO_REHEARSALS.find((workflow) => workflow.id === id)
    ?? DEMO_HERO_WORKFLOWS.find((workflow) => workflow.id === id);
}

export function demoHeroWorkflow(id: string): DemoHeroWorkflow | undefined {
  return demoManifestWorkflow(id);
}

/** Build inspect links from a manifest's declared expect ids (generic). */
export function inspectPathsFromExpect(expect: {
  anchorEventIds?: string[];
  tripIds?: string[];
}): string[] {
  const paths: string[] = [];
  const eventId = expect.anchorEventIds?.[0];
  const tripId = expect.tripIds?.[0];
  if (eventId) {
    paths.push(`/programme?event=${encodeURIComponent(eventId)}`);
    paths.push(`/operator?event=${encodeURIComponent(eventId)}`);
  }
  if (tripId) {
    paths.push(`/traveller?trip=${encodeURIComponent(tripId)}`);
  }
  paths.push('/decisions');
  return paths;
}
