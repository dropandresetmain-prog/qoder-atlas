/**
 * Overview polling configuration.
 *
 * Polling is owned by the shell runtime (`shellRuntime.ts`): it guards on the
 * overview's `data-stable-revision` (projectionRevision), holds the last
 * SETTLED presentation while `data-assessment-lifecycle="RECONCILING"`, and
 * patches only changed `[data-poll-region]` regions — never `<main>`. The
 * simulated-airline-update trigger is a delegated `[data-action]` control
 * handled by the same runtime.
 *
 * `renderPage` already sizes the interval per surface; this remains only as a
 * compatibility hook to override it, and carries no polling logic.
 */
export function renderOverviewPollingScript(options?: { intervalMs?: number }): string {
  const interval = options?.intervalMs ?? 2000;
  return `<script>(function(){var c=window.__northstarPollConfig=window.__northstarPollConfig||{};c.intervalMs=${interval};})();</script>`;
}
