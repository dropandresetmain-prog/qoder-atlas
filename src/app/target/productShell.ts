/**
 * The operator product shell: wraps a rendered surface in the accepted
 * `renderPage(...)` chrome (brand, event context, Overview / Programme /
 * Decisions / Activity nav, operator area).
 *
 * Nav links are the clean product routes, which the HTTP layer maps onto the
 * same read-only handlers — so the chrome never points at an endpoint that
 * does not answer. The event name and decision count are passed in from
 * authoritative read models; this module invents neither, and renders the
 * event select only when the backend identified one event.
 */
import { renderPage, type NavTarget } from '../../ui/page.ts';

export const SHELL_LINKS = {
  dashboard: '/',
  programme: '/programme',
  decisions: '/decisions',
  activity: '/activity',
} as const;

export interface ShellContext {
  /** Present only when the read model identified a single active programme. */
  eventName?: string;
  /** Number of items the backend reports as requiring a decision. */
  decisionCount?: number;
}

export function renderInShell(
  active: NavTarget,
  title: string,
  context: ShellContext,
  bodyHtml: string,
): string {
  return renderPage(
    {
      title,
      active,
      links: { ...SHELL_LINKS },
      surface: 'operator',
      ...(context.eventName ? { eventName: context.eventName } : {}),
      ...(context.decisionCount !== undefined ? { decisionCount: context.decisionCount } : {}),
    },
    bodyHtml,
  );
}
