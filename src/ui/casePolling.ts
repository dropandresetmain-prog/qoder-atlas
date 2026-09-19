/**
 * Case-page polling configuration.
 *
 * The polling itself lives in the shell's ONE runtime (`shellRuntime.ts`,
 * emitted by `renderPage` outside `<main>`): it fetches the authoritative case
 * HTML, guards on `projectionRevision` (the xmin `data-change-cursor` is only
 * echoed back as `sinceCursor`, never a redraw signal), parses with DOMParser
 * and patches only `[data-poll-region]` regions whose content changed. It never
 * replaces `<main>`, so delegated `[data-action]` controls, open `<details>`,
 * focus, scroll and the graph canvas survive.
 *
 * This function is kept as the case screen's hook: it only tells the shell
 * runtime which case it is on and how often to poll. It carries no polling
 * logic of its own and is safe to emit any number of times.
 */
export function casePollingScript(options: { caseRef: string; intervalMs?: number }): string {
  const config = {
    caseRef: options.caseRef,
    intervalMs: options.intervalMs ?? 4000,
    pollUrl: `/api/v2/cases/${encodeURIComponent(options.caseRef)}?format=html`,
    cursorParam: 'sinceCursor',
  };
  const json = JSON.stringify(config).replace(/</g, '\u003c');
  return `<script>(function(){var c=window.__northstarPollConfig=window.__northstarPollConfig||{};var v=${json};for(var k in v)c[k]=v[k];})();</script>`;
}
