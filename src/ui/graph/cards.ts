/**
 * R2 LANE B — node card HTML rendering.
 *
 * V5.6 card visual language: type label, title, state badge, health border.
 * Focal emphasis for firstBreakpoint; causal emphasis for causal chain;
 * checking badge for pending-reassessment evaluation state.
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
  readonly pulseClass?: string;
}

/**
 * Render a node card as HTML.
 * Card includes: type label, title, state badge, health border treatment.
 * Focal cards get larger size + amber ring.
 * Checking cards get independent "Checking…" badge.
 */
export function renderNodeCard(ctx: CardContext): string {
  const { layoutNode, presentationNode, isFocal, isCausal, isChecking, pulseClass = '' } = ctx;
  const node = presentationNode;

  const toneClass = TONE_CLASS[node.indicator.tone];
  const glyph = SEMANTIC_GLYPHS[node.indicator.glyph];

  // Card classes
  const classes = [
    'fg-node',
    toneClass,
    pulseClass,
    isFocal ? 'fg-focal' : '',
    isCausal ? 'fg-causal' : '',
    node.focusRole === 'context' ? 'fg-context' : '',
  ].filter(Boolean).join(' ');

  // Position from layout
  const style = `left:${layoutNode.x}px;top:${layoutNode.y}px;width:${layoutNode.width}px;height:${layoutNode.height}px;`;

  // State badge
  const badge = `<span class="fg-badge ${toneClass}">
    <span class="fg-glyph" aria-hidden="true">${glyph}</span>
    ${esc(node.indicator.label)}
  </span>`;

  // Checking badge (independent of semantic tone)
  const checkingBadge = isChecking
    ? `<span class="fg-checking-badge">Checking…</span>`
    : '';

  // Secondary label (detail)
  const detail = node.secondaryLabel
    ? `<p class="fg-detail">${esc(node.secondaryLabel)}</p>`
    : '';

  return `<article
    class="${classes}"
    style="${style}"
    data-ref="${esc(node.ref)}"
    data-state="${esc(node.semanticState)}"
    data-kind="${esc(node.entityKind)}"
    data-tone="${node.indicator.tone}"
    data-focus="${node.focusRole}"
    data-evaluation="${node.evaluationState}"
    title="${esc(node.secondaryLabel ? `${node.label} — ${node.secondaryLabel}` : node.label)}"
    role="button"
    tabindex="0"
    aria-label="${esc(node.label)} — ${esc(node.indicator.label)}"
  >
    <div class="fg-type">${esc(node.entityLabel)}</div>
    <h3 class="fg-title">${esc(node.label)}</h3>
    ${detail}
    <div class="fg-footer">
      ${badge}
      ${checkingBadge}
    </div>
  </article>`;
}
