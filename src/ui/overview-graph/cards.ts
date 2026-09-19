/**
 * Event Overview graph — server-rendered cards and connectors.
 *
 * Health classes are the only visual state; liveness (pulses) derives from the
 * relation's own health: green normal, amber slower, red never.
 */
import { escapeHtml } from '../html.ts';
import { caseHref } from '../../app/target/productShell.ts';
import { connectorPath, type Box } from './layout.ts';
import type { OgNode, OgRelation } from './model.ts';

const MAX_MARKS = 12;

function styleFor(box: Box): string {
  return `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`;
}

function marks(node: OgNode): string {
  if (!node.marks) return '';
  const { ready, unknown, attention, total } = node.marks;
  // Scale the dots to the cohort while never exceeding the cap.
  const cap = Math.min(MAX_MARKS, total);
  const scale = total > 0 ? cap / total : 0;
  let red = attention > 0 ? Math.max(1, Math.round(attention * scale)) : 0;
  let grey = unknown > 0 ? Math.max(1, Math.round(unknown * scale)) : 0;
  let green = Math.max(0, cap - red - grey);
  if (ready === 0) green = 0;
  red = Math.min(red, cap);
  grey = Math.min(grey, cap - red);
  const dots = [
    ...Array.from({ length: green }, () => '<i class="og-mark og-m-ok"></i>'),
    ...Array.from({ length: grey }, () => '<i class="og-mark og-m-unk"></i>'),
    ...Array.from({ length: red }, () => '<i class="og-mark og-m-bad"></i>'),
  ];
  return `<div class="og-marks" aria-hidden="true">${dots.join('')}</div>`;
}

function body(node: OgNode): string {
  switch (node.kind) {
    case 'dependency':
      return `<div class="og-type">${escapeHtml(node.type)}</div>
        <div class="og-name" title="${escapeHtml(node.title)}">${escapeHtml(node.title)}</div>
        ${node.meta ? `<div class="og-meta">${escapeHtml(node.meta)}</div>` : ''}
        ${node.badge ? `<div class="og-badge">${escapeHtml(node.badge)}</div>` : ''}`;
    case 'landmark':
      return `${node.when ? `<div class="og-when">${escapeHtml(node.when)}</div>` : ''}
        <div class="og-name" title="${escapeHtml(node.title)}">${escapeHtml(node.title)}</div>
        ${node.badge ? `<div class="og-badge">${escapeHtml(node.badge)}</div>` : ''}`;
    case 'cohort':
      return `<div class="og-name" title="${escapeHtml(node.title)}">${escapeHtml(node.title)}</div>
        ${node.meta ? `<div class="og-meta">${escapeHtml(node.meta)}</div>` : ''}
        ${marks(node)}`;
    case 'traveller':
      return `<div class="og-type">${escapeHtml(node.type)}</div>
        <div class="og-name" title="${escapeHtml(node.title)}">${escapeHtml(node.title)}</div>
        ${node.meta ? `<div class="og-meta">${escapeHtml(node.meta)}</div>` : ''}
        <div class="og-badge-row">${node.badge ? `<span class="og-badge">${escapeHtml(node.badge)}</span>` : ''}${node.caseRef && !node.faded
          ? `<a class="og-open" href="${escapeHtml(caseHref(node.caseRef))}" data-og-case-link="${escapeHtml(node.caseRef)}">Open case</a>`
          : ''}</div>`;
  }
}

export function renderNodeCard(node: OgNode, box: Box): string {
  const classes = [
    'og-node',
    `og-${node.kind}`,
    `og-h-${node.health}`,
    node.dim ? 'og-dim' : '',
    node.faded ? 'og-faded' : '',
    node.attention ? 'og-attention' : '',
  ].filter(Boolean).join(' ');
  const description = [node.type, node.title, node.when, node.meta, node.badge].filter(Boolean).join(' · ');
  return `<div class="${classes}" tabindex="0" role="button" aria-label="${escapeHtml(description)}" data-og-description="${escapeHtml(description)}" data-og-node="${escapeHtml(node.id)}" data-og-kind="${node.kind}" data-health="${node.health}" style="${styleFor(box)}">${body(node)}</div>`;
}

/** Amber pulses travel slower than green; red and context never pulse. */
export function pulseSeconds(health: OgRelation['health']): number | null {
  if (health === 'green') return 2.55;
  if (health === 'amber') return 3.7;
  return null;
}

export function renderEdges(
  relations: readonly OgRelation[],
  boxes: ReadonlyMap<string, Box>,
  size: { readonly width: number; readonly height: number },
): string {
  const paths: string[] = [];
  const pulses: string[] = [];
  let pulseIndex = 0;
  relations.forEach((rel, i) => {
    const from = boxes.get(rel.from);
    const to = boxes.get(rel.to);
    if (!from || !to) return;
    const id = `og-e${i}`;
    paths.push(`<path id="${id}" class="og-edge og-h-${rel.health}${rel.dim ? ' og-dim' : ''}" d="${connectorPath(from, to)}" data-og-from="${escapeHtml(rel.from)}" data-og-to="${escapeHtml(rel.to)}" data-health="${rel.health}" data-live="${rel.live && pulseSeconds(rel.health) !== null ? 'true' : 'false'}"/>`);
    const seconds = rel.live ? pulseSeconds(rel.health) : null;
    if (seconds === null) return;
    const begin = -(pulseIndex % 5) * 0.31;
    pulses.push(`<circle class="og-pulse og-h-${rel.health}${rel.dim ? ' og-dim' : ''}" r="${rel.health === 'amber' ? 3 : 2.8}"><animateMotion dur="${seconds}s" repeatCount="indefinite" begin="${begin.toFixed(2)}s"><mpath href="#${id}"/></animateMotion></circle>`);
    pulseIndex += 1;
  });
  return `<svg class="og-edges" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}" aria-hidden="true"><g>${paths.join('')}</g><g>${pulses.join('')}</g></svg>`;
}
