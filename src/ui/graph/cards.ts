/**
 * Node card HTML rendering (V5.6 card language).
 *
 * Header: type label + state dot. Title. Optional detail line. Footer: state
 * badge (+ independent "Checking…" badge for pending reassessment). Focal card
 * (first breakpoint) is larger with an amber ring/halo; causal cards carry the
 * causal emphasis; context cards are small and quiet.
 *
 * The card is split into `nodeClass` / `nodeInnerHtml` (so the scene can carry the
 * inner markup for the client patcher) and `renderNodeCard` (full <article>).
 */
import { escapeHtml as esc } from '../html.ts';
import { TONE_CLASS, SEMANTIC_GLYPHS } from '../semantics/grammar.ts';
import type { PresentationNode } from '../semantics/model.ts';
import type { LayoutNode } from './layout.ts';

export interface CardContext {
  readonly layoutNode: LayoutNode;
  readonly presentationNode: PresentationNode;
  readonly isFocal: boolean;
  readonly isCausal: boolean;
  readonly isChecking: boolean;
  /** Retained for call compatibility; cards no longer blink (pulses live on edges). */
  readonly pulseClass?: string;
}

export function nodeClass(ctx: CardContext): string {
  const { layoutNode, presentationNode: node, isFocal, isCausal } = ctx;
  return [
    'fg-node',
    TONE_CLASS[node.indicator.tone],
    `fg-size-${layoutNode.sizeClass}`,
    isFocal ? 'fg-focal' : '',
    isCausal ? 'fg-causal' : '',
    node.focusRole === 'context' ? 'fg-context' : '',
  ].filter(Boolean).join(' ');
}

function formatTimingInstant(instant: string, timeZone: string | undefined): string {
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short', timeZone: timeZone ?? 'UTC' };
  try { return new Intl.DateTimeFormat('en-GB', options).format(new Date(instant)); }
  catch { return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(instant)); }
}

/** Before → after when a published baseline differs; otherwise the current instant. */
export function timingText(timing: { currentAt: string; publishedAt?: string; timeZone?: string } | undefined): string {
  if (!timing) return '';
  const current = formatTimingInstant(timing.currentAt, timing.timeZone);
  if (timing.publishedAt && timing.publishedAt !== timing.currentAt) {
    return `${formatTimingInstant(timing.publishedAt, timing.timeZone)} → ${current}`;
  }
  return current;
}

export function nodeInnerHtml(ctx: CardContext): string {
  const { presentationNode: node, isChecking } = ctx;
  const toneClass = TONE_CLASS[node.indicator.tone];
  const glyph = SEMANTIC_GLYPHS[node.indicator.glyph];
  const timing = node.timing;
  const timingLine = timingText(timing);
  const detail = timingLine
    ? `<p class="fg-detail"><time datetime="${esc(timing!.currentAt)}">${esc(timingLine)}</time></p>${node.secondaryLabel ? `<p class="fg-detail">${esc(node.secondaryLabel)}</p>` : ''}`
    : node.secondaryLabel
    ? `<p class="fg-detail">${esc(node.secondaryLabel)}</p>`
    : '';
  const checking = isChecking ? `<span class="fg-checking-badge">Checking…</span>` : '';
  return `<div class="fg-nh"><span class="fg-type">${esc(node.entityLabel)}</span><span class="fg-dot ${toneClass}" aria-hidden="true"></span></div>
<h3 class="fg-title">${esc(node.label)}</h3>
${detail}
<div class="fg-footer"><span class="fg-badge ${toneClass}"><span class="fg-glyph" aria-hidden="true">${glyph}</span>${esc(node.indicator.label)}</span>${checking}</div>`;
}

export function nodeAttrs(ctx: CardContext): Record<string, string> {
  const node = ctx.presentationNode;
  return {
    'data-ref': node.ref,
    'data-state': node.semanticState,
    'data-kind': node.entityKind,
    'data-tone': node.indicator.tone,
    'data-truth': node.truthMode,
    'data-focus': node.focusRole,
    'data-evaluation': node.evaluationState,
    title: node.secondaryLabel ? `${node.label} — ${node.secondaryLabel}` : node.label,
    ...(timingText(node.timing) ? { 'data-timing-text': timingText(node.timing) } : {}),
    role: 'button',
    tabindex: '0',
    'aria-label': `${node.label} — ${node.indicator.label}${node.timing ? ` — ${node.timing.currentAt}` : ''}`,
  };
}

export function nodeStyle(n: LayoutNode): string {
  return `left:${n.x}px;top:${n.y}px;width:${n.width}px;height:${n.height}px;`;
}

export function attrsToHtml(attrs: Record<string, string>): string {
  return Object.entries(attrs).map(([k, v]) => `${k}="${esc(v)}"`).join(' ');
}

/** Render a node card as a full <article>. */
export function renderNodeCard(ctx: CardContext): string {
  return `<article class="${nodeClass(ctx)}" style="${nodeStyle(ctx.layoutNode)}" ${attrsToHtml(nodeAttrs(ctx))}>
${nodeInnerHtml(ctx)}
</article>`;
}
