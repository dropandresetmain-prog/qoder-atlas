import {
  ICON_COMMITMENT, ICON_GROUND, ICON_IMPACT, ICON_PROVIDER,
  ICON_SEARCH, ICON_TIME, ICON_TRAVELLERS,
} from '../icons.ts';
import type { ChangeMarker, FocusRole, IconKind, SemanticIndicator, TruthMode, VisualTone } from './model.ts';

export const SEMANTIC_ICONS: Record<IconKind, string> = {
  signal: ICON_IMPACT, booking: ICON_PROVIDER, person: ICON_TRAVELLERS,
  time: ICON_TIME, support: ICON_GROUND, commitment: ICON_COMMITMENT, proposal: ICON_SEARCH,
};
export const SEMANTIC_GLYPHS: Record<SemanticIndicator['glyph'], string> = {
  check: '✓', change: '↻', attention: '!', cross: '×', proposal: '◇', active: '…', question: '?',
};
export const TONE_CLASS: Record<VisualTone, string> = {
  ok: 'sem-ok', watch: 'sem-watch', alert: 'sem-alert', active: 'sem-active', neutral: 'sem-neutral',
};
/** Existing theme status-dot classes, keyed by tone so no surface re-collapses tones. */
export const TONE_DOT_CLASS: Record<VisualTone, string> = {
  ok: 'd-ok', watch: 'd-watch', alert: 'd-bad', active: 'd-active', neutral: 'd-unconfirmed',
};
export const TRUTH_LABEL: Record<TruthMode, string> = {
  current: 'Current · authoritative', proposed: 'Proposed · not committed', unspecified: 'Authority not supplied',
};
export const CHANGE_LABEL: Record<ChangeMarker, string> = {
  marked: 'Marked changed', 'not-marked': 'Not marked changed', 'not-supplied': 'Change metadata not supplied',
};
export const FOCUS_LABEL: Record<FocusRole, string> = {
  primary: 'Primary focus', causal: 'Causal focus · UI selected', context: 'Context',
};

export const SEMANTIC_CSS = `
.sem-ok { --sem-tone: var(--ok); }
.sem-watch { --sem-tone: var(--watch); }
.sem-alert { --sem-tone: var(--alert); }
.sem-active { --sem-tone: var(--active); }
.sem-neutral { --sem-tone: var(--neutral); }
.sem-node, .sem-edge {
  --sem-boundary: var(--sem-tone);
  --sem-border-style: solid;
  color: var(--text); background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 16px; min-width: 0; overflow-wrap: anywhere;
}
.sem-node { border-inline-start: 3px var(--sem-border-style) var(--sem-boundary); }
.sem-node[data-truth="proposed"], .sem-edge[data-truth="proposed"] {
  --sem-boundary: var(--watch); --sem-border-style: dashed;
  border-style: dashed; border-color: var(--watch);
}
.sem-edge[data-truth="unspecified"] { --sem-boundary: var(--neutral); --sem-border-style: dotted; }
.sem-node[data-focus="primary"] { box-shadow: 0 0 0 2px var(--ink); }
.sem-node[data-focus="causal"], .sem-edge[data-focus="causal"] { border-block-start-width: 3px; }
.sem-node[data-focus="context"], .sem-edge[data-focus="context"] { background: var(--surface-2); }
.sem-node[data-focus="primary"] .sem-title, .sem-node[data-focus="causal"] .sem-title { font-weight: 700; }
.sem-node[data-change="marked"] .sem-change, .sem-edge[data-change="marked"] .sem-change {
  color: var(--watch); font-weight: 650; border-bottom: 1px solid var(--watch);
}
.sem-heading { display: flex; gap: 12px; align-items: flex-start; }
.sem-icon { width: 22px; height: 22px; flex: none; color: var(--sem-tone); }
.sem-icon svg { width: 100%; height: 100%; }
.sem-kind, .sem-focus { font-family: var(--font-mono); font-size: 11px; letter-spacing: .04em; }
.sem-kind { color: var(--neutral); }
.sem-title { margin: 4px 0 10px; font-size: 15px; line-height: 1.4; font-weight: 600; }
.sem-detail { font-size: 13px; margin: 12px 0; }
.sem-indicator { color: var(--sem-tone); display: inline-flex; gap: 6px; align-items: baseline; font-size: 13px; font-weight: 650; }
.sem-glyph { font-family: var(--font-mono); font-weight: 700; }
.sem-meta { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 12px; font-size: 11px; color: var(--neutral); }
.sem-truth { font-size: 11px; color: var(--neutral); display: block; margin-top: 12px; }
[data-truth="proposed"] > .sem-truth { color: var(--watch); font-weight: 650; }
.sem-connector { display: flex; align-items: center; gap: 10px; color: var(--sem-boundary); margin: 12px 0; }
.sem-connector::before { content: ''; flex: 1; border-top: 2px var(--sem-border-style) var(--sem-boundary); }
.sem-connector::after { content: '→'; font: 700 20px var(--font-mono); }
.sem-endpoints { display: flex; gap: 12px; justify-content: space-between; font-size: 12px; }
.sem-edge .sem-title { margin-bottom: 8px; }
.sem-empty { padding: 24px; border: 1px dotted var(--neutral); border-radius: var(--radius); }
.sem-error { padding: 20px; border: 2px solid var(--ink); border-radius: var(--radius); }
`;
