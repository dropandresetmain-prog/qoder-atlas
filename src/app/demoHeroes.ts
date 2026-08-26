/**
 * Demo-only hero workflow catalog.
 *
 * Orchestration metadata for the deployed demo control panel. Manifest paths
 * and stop-before step ids are allowed here because this is demo tooling —
 * never imported by domain/engine recovery logic. Each workflow drives an
 * existing acceptance manifest through real HTTP product endpoints and stops
 * before automated authority settlement so manual rehearsal stays real.
 */
export interface DemoHeroWorkflow {
  /** Stable demo control id (URL / button key). */
  id: string;
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

/**
 * Final hero workflows launchable from the deployed demo panel.
 * Catalog may know manifest filenames; generic engine code must not branch
 * on them.
 */
export const DEMO_HERO_WORKFLOWS: readonly DemoHeroWorkflow[] = [
  {
    id: 's1-s3',
    title: 'S1 → S3 continuous story',
    description:
      'Airline schedule-change endangers the critical headline trip, then organiser preview → commit reschedules the commitment and re-evaluates the same trip.',
    manifestPath: 'fixtures/acceptance/manifests/s1-s3-continuity.json',
    // Full continuity story including preview/commit/re-plan; no money-moving decide/execute in this manifest.
    stopBeforeStepIds: [],
  },
  {
    id: 's2',
    title: 'S2 — Missed connection',
    description:
      'Progressive delay, missed connection, overnight recovery planning. Stops before organiser approval so authority stays real.',
    manifestPath: 'fixtures/acceptance/manifests/s2-missed-connection.json',
    stopBeforeStepIds: ['decide_recovery'],
  },
  {
    id: 's5',
    title: 'S5 — Stay until Sunday',
    description:
      'Traveller requests a self-funded hotel extension. Stops awaiting traveller approval so that authority remains required.',
    manifestPath: 'fixtures/acceptance/manifests/s5-stay-until-sunday.json',
    stopBeforeStepIds: ['decide'],
  },
  {
    id: 's7',
    title: 'S7 — Tokyo origin change',
    description:
      'Natural-language origin correction with FX restatement. Stops at human-agent / awaiting approval — no automated settle.',
    manifestPath: 'fixtures/acceptance/manifests/s7-origin-tokyo.json',
    stopBeforeStepIds: ['decide'],
  },
];

export function demoHeroWorkflow(id: string): DemoHeroWorkflow | undefined {
  return DEMO_HERO_WORKFLOWS.find((workflow) => workflow.id === id);
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
