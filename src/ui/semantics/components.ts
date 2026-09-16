import { escapeHtml as esc } from '../html.ts';
import {
  CHANGE_LABEL, EVALUATION_LABEL, FOCUS_LABEL, SEMANTIC_GLYPHS, SEMANTIC_ICONS, TONE_CLASS, TRUTH_LABEL,
} from './grammar.ts';
import type { PresentationEdge, PresentationNode, SemanticIndicator } from './model.ts';

export function semanticBadge(value: SemanticIndicator): string {
  return `<span class="sem-indicator ${TONE_CLASS[value.tone]}" role="status"><span class="sem-glyph" aria-hidden="true">${SEMANTIC_GLYPHS[value.glyph]}</span>${esc(value.label)}</span>`;
}

export function semanticNode(node: PresentationNode): string {
  return `<article class="sem-node ${TONE_CLASS[node.indicator.tone]}" data-ref="${esc(node.ref)}" data-state="${esc(node.semanticState)}" data-kind="${esc(node.entityKind)}" data-truth="${node.truthMode}" data-change="${node.changeState}" data-focus="${node.focusRole}" data-evaluation="${node.evaluationState}">
    <div class="sem-heading"><span class="sem-icon">${SEMANTIC_ICONS[node.iconKind]}</span><div>
      <div class="sem-kind">${esc(node.entityLabel)}</div><h3 class="sem-title">${esc(node.label)}</h3>
      ${semanticBadge(node.indicator)}
    </div></div>
    ${node.secondaryLabel ? `<p class="sem-detail">${esc(node.secondaryLabel)}</p>` : ''}
    <span class="sem-truth">${TRUTH_LABEL[node.truthMode]}</span>
    <span class="sem-evaluation">${EVALUATION_LABEL[node.evaluationState]}</span>
    <div class="sem-meta"><span class="sem-change">${CHANGE_LABEL[node.changeState]}</span><span class="sem-focus">${FOCUS_LABEL[node.focusRole]}</span></div>
  </article>`;
}

export function semanticEdge(edge: PresentationEdge): string {
  return `<article class="sem-edge ${TONE_CLASS[edge.indicator.tone]}" data-render-key="${esc(edge.renderKey)}" data-relationship="${esc(edge.relationshipKind)}" data-state="${esc(edge.semanticState ?? 'NOT_SUPPLIED')}" data-truth="${edge.truthMode}" data-change="${edge.changeState}" data-focus="${edge.focusRole}" data-source-ref="${esc(edge.sourceRef)}" data-target-ref="${esc(edge.targetRef)}">
    <h3 class="sem-title">${esc(edge.label)}</h3>
    <div class="sem-endpoints"><span>From: ${esc(edge.sourceLabel)}</span><span>To: ${esc(edge.targetLabel)}</span></div>
    <div class="sem-connector" aria-hidden="true"></div>
    ${semanticBadge(edge.indicator)}
    <span class="sem-truth">${TRUTH_LABEL[edge.truthMode]}</span>
    <div class="sem-meta"><span class="sem-change">${CHANGE_LABEL[edge.changeState]}</span><span>${FOCUS_LABEL[edge.focusRole]}</span></div>
  </article>`;
}

export function semanticContractError(message: string): string {
  return `<div class="sem-error" role="alert"><strong>${esc(message)}</strong><p>Presentation refused. No state has been changed.</p></div>`;
}
