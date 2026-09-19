/**
 * R4 — Overview polling via shell runtime (region/fallback patch; never replace <main>).
 * Uses a minimal DOM stub against the stringified shellRuntime + overview config hook.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderOverviewPollingScript } from '../src/ui/polling.ts';
import { renderShellRuntimeScript } from '../src/ui/shellRuntime.ts';

type TriggerEvent = { type: string; target: StubElement; preventDefault: () => void; detail?: unknown };

class StubElement {
  tagName: string;
  attrs: Map<string, string>;
  classes: Set<string>;
  children: StubElement[];
  parent: StubElement | null = null;
  text = '';
  disabled = false;
  value = '';
  scrollTop = 0;
  private _listeners = new Map<string, Array<(ev: TriggerEvent) => void>>();

  constructor(tag: string, attrs: Record<string, string> = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = new Map(Object.entries(attrs));
    this.classes = new Set();
    this.children = [];
  }

  get isConnected(): boolean {
    let n: StubElement | null = this;
    while (n) {
      if (n.tagName === 'DOCUMENT' || n.tagName === '#DOCUMENT') return true;
      n = n.parent;
    }
    return false;
  }

  appendChild(child: StubElement) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  get innerHTML(): string {
    return this.children.map((c) => serialize(c)).join('') + (this.children.length ? '' : escapeText(this.text));
  }

  set innerHTML(html: string) {
    this.children = [];
    this.text = '';
    for (const n of parse(html)) this.appendChild(n);
  }

  get outerHTML(): string {
    return serialize(this);
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  querySelector(sel: string): StubElement | null {
    for (const c of this.children) {
      if (matchFull(c, sel)) return c;
      const found = c.querySelector(sel);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(sel: string): StubElement[] {
    const out: StubElement[] = [];
    const walk = (el: StubElement) => {
      if (matchFull(el, sel)) out.push(el);
      for (const c of el.children) walk(c);
    };
    for (const c of this.children) walk(c);
    return out;
  }

  closest(sel: string): StubElement | null {
    if (matchFull(this, sel)) return this;
    return this.parent?.closest(sel) ?? null;
  }

  contains(other: StubElement): boolean {
    let n: StubElement | null = other;
    while (n) {
      if (n === this) return true;
      n = n.parent;
    }
    return false;
  }

  replaceWith(node: StubElement): void {
    if (!this.parent) return;
    const idx = this.parent.children.indexOf(this);
    if (idx < 0) return;
    node.parent = this.parent;
    this.parent.children.splice(idx, 1, node);
    this.parent = null;
  }

  get classList() {
    return {
      add: (c: string) => { this.classes.add(c); },
      remove: (c: string) => { this.classes.delete(c); },
      contains: (c: string) => this.classes.has(c),
    };
  }

  get textContent(): string {
    if (this.children.length === 0) return this.text;
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(v: string) {
    this.text = v;
    this.children = [];
  }

  addEventListener(type: string, fn: (ev: TriggerEvent) => void) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type)!.push(fn);
  }

  dispatchEvent(ev: TriggerEvent) {
    const list = this._listeners.get(ev.type) ?? [];
    for (const fn of list) fn(ev);
    return true;
  }

  focus(_opts?: unknown) {}
}

function escapeText(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function serialize(el: StubElement): string {
  const attrs = [...el.attrs.entries()].map(([k, v]) => ` ${k}="${v}"`).join('');
  const cls = el.classes.size ? ` class="${[...el.classes].join(' ')}"` : '';
  const open = `<${el.tagName.toLowerCase()}${cls}${attrs}>`;
  if (['BR', 'IMG', 'INPUT', 'HR'].includes(el.tagName)) return open.replace(/>$/, ' />');
  return `${open}${el.children.map(serialize).join('')}${escapeText(el.children.length ? '' : el.text)}</${el.tagName.toLowerCase()}>`;
}

function parse(html: string): StubElement[] {
  const nodes: StubElement[] = [];
  const re = /<([a-z0-9]+)([^>]*)>([\s\S]*?)<\/\1>|<([a-z0-9]+)([^>]*)\s*\/>/gi;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(html))) {
    if (m.index > last) {
      const t = html.slice(last, m.index).trim();
      if (t) {
        const span = new StubElement('span');
        span.text = t;
        nodes.push(span);
      }
    }
    if (m[4]) {
      nodes.push(new StubElement(m[4], parseAttrs(m[5] ?? '')));
    } else {
      const el = new StubElement(m[1]!, parseAttrs(m[2] ?? ''));
      for (const c of parse(m[3] ?? '')) el.appendChild(c);
      if (!(m[3] ?? '').includes('<') && (m[3] ?? '').length) el.text = m[3]!;
      nodes.push(el);
    }
    last = m.index + m[0].length;
  }
  return nodes;
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z0-9:-]+)(?:=\"([^\"]*)\"|=\'([^\']*)\')?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]!] = m[2] ?? m[3] ?? '';
  return out;
}

function matchSimple(el: StubElement, sel: string): boolean {
  let r = sel.trim();
  const tag = r.match(/^[a-z0-9]+/i);
  if (tag) {
    if (el.tagName !== tag[0]!.toUpperCase()) return false;
    r = r.slice(tag[0]!.length);
  }
  const cls = r.match(/^\.([a-zA-Z0-9_-]+)/);
  if (cls) {
    if (!el.classes.has(cls[1]!)) return false;
    r = r.slice(cls[0].length);
  }
  while (r.startsWith('[')) {
    const am = r.match(/^\[([a-zA-Z0-9:-]+)(?:=\"([^\"]*)\")?\]/);
    if (!am) return false;
    if (!el.attrs.has(am[1]!)) return false;
    if (am[2] !== undefined && el.attrs.get(am[1]!) !== am[2]) return false;
    r = r.slice(am[0].length);
  }
  return r === '';
}

function matchFull(el: StubElement, sel: string): boolean {
  const parts = sel.trim().split(/\s+/);
  if (!matchSimple(el, parts[parts.length - 1]!)) return false;
  let anc: StubElement | null = el.parent;
  for (let i = parts.length - 2; i >= 0; i--) {
    let found = false;
    while (anc) {
      if (matchSimple(anc, parts[i]!)) {
        anc = anc.parent;
        found = true;
        break;
      }
      anc = anc.parent;
    }
    if (!found) return false;
  }
  return true;
}

function responseHTML(opts: {
  disclosureOpen?: boolean;
  statusText?: string;
  lifecycle?: 'SETTLED' | 'RECONCILING';
  pendingCount?: number;
  revision?: string;
  readyCount?: string;
} = {}): string {
  const openAttr = opts.disclosureOpen ? ' open' : '';
  const statusText = opts.statusText ?? '';
  const lifecycle = opts.lifecycle ?? 'SETTLED';
  const pending = opts.pendingCount ?? 0;
  const revision = opts.revision ?? '1';
  const ready = opts.readyCount ?? '50';
  const reconcilingHidden = lifecycle === 'RECONCILING' ? '' : ' hidden';
  return `<main data-test="product-operator-overview" data-assessment-lifecycle="${lifecycle}" data-assessment-pending-count="${pending}" data-stable-revision="${revision}"><p data-test="overview-reconciling"${reconcilingHidden}>Reconciling changes…</p><div data-test="ready-count">${ready}</div><details data-test="simulated-airline-update" data-configured="true"${openAttr}><span data-test="simulated-airline-update-status">${statusText}</span><button data-test="simulated-airline-update-apply" data-action="trigger-disruption">Apply</button></details></main>`;
}

interface Env {
  window: { __northstarRefreshOverview?: () => Promise<void> | void; [k: string]: unknown };
  doc: StubElement;
  setOverviewHTML: (html: string) => void;
  intervals: Array<{ cb: () => void; ms: number }>;
}

function createEnv(domOpts: {
  disclosureOpen?: boolean;
  statusText?: string;
  lifecycle?: 'SETTLED' | 'RECONCILING';
  pendingCount?: number;
  revision?: string;
  readyCount?: string;
} = {}): Env {
  const doc = new StubElement('document');
  for (const n of parse(responseHTML(domOpts))) doc.appendChild(n);

  const win: Env['window'] = { scrollY: 0, hidden: false };
  Object.defineProperty(win, 'document', { get: () => doc });
  let overviewHTML = responseHTML(domOpts);
  const intervals: Env['intervals'] = [];

  const fetchStub = (url: string) => {
    if (url.includes('/api/v2/operator/overview')) {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(overviewHTML) });
    }
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
  };

  class StubDOMParser {
    parseFromString(html: string) {
      const root = new StubElement('document');
      for (const n of parse(html)) root.appendChild(n);
      return {
        querySelector: (sel: string) => root.querySelector(sel),
        querySelectorAll: (sel: string) => root.querySelectorAll(sel),
      };
    }
  }

  (doc as unknown as { importNode: (n: StubElement, _deep: boolean) => StubElement }).importNode = (n) => n;
  (doc as unknown as { hidden: boolean }).hidden = false;

  const shell = renderShellRuntimeScript({ intervalMs: 2000 }).replace(/<\/?script[^>]*>/g, '');
  const overview = renderOverviewPollingScript({ intervalMs: 2000 }).replace(/<\/?script>/g, '');
  const CustomEvent = function (this: { type: string; detail: unknown }, type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  };
  const fn = new Function(
    'window', 'document', 'DOMParser', 'fetch', 'setInterval', 'console', 'CustomEvent',
    `${overview}\n${shell}`,
  );
  fn(win, doc, StubDOMParser, fetchStub, (cb: () => void, ms: number) => { intervals.push({ cb, ms }); return intervals.length; }, { warn() {} }, CustomEvent);

  return {
    window: win,
    doc,
    setOverviewHTML: (html: string) => { overviewHTML = html; },
    intervals,
  };
}

async function flush() {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
}

test('overview config + shell runtime register a 2000ms interval', () => {
  const env = createEnv();
  assert.ok(env.intervals.some((i) => i.ms === 2000));
  assert.equal(typeof env.window.__northstarRefreshOverview, 'function');
});

test('RECONCILING holds settled ready count (no 0 rebuild)', async () => {
  const env = createEnv({ revision: '10', readyCount: '50', lifecycle: 'SETTLED' });
  env.setOverviewHTML(responseHTML({
    lifecycle: 'RECONCILING',
    pendingCount: 5,
    revision: '11',
    readyCount: '0',
  }));
  await env.window.__northstarRefreshOverview!();
  await flush();
  const ready = env.doc.querySelector('[data-test="ready-count"]');
  assert.ok(ready);
  assert.equal(ready.textContent, '50');
  const indicator = env.doc.querySelector('[data-test="overview-reconciling"]');
  assert.ok(indicator);
  assert.equal(indicator.hasAttribute('hidden'), false);
});

test('SETTLED result replaces held content once', async () => {
  const env = createEnv({ revision: '10', readyCount: '50', lifecycle: 'SETTLED' });
  env.setOverviewHTML(responseHTML({ lifecycle: 'RECONCILING', pendingCount: 5, revision: '11', readyCount: '0' }));
  await env.window.__northstarRefreshOverview!();
  await flush();
  env.setOverviewHTML(responseHTML({ lifecycle: 'SETTLED', revision: '12', readyCount: '48' }));
  await env.window.__northstarRefreshOverview!();
  await flush();
  const ready = env.doc.querySelector('[data-test="ready-count"]');
  assert.ok(ready);
  assert.equal(ready.textContent, '48');
});

test('unchanged SETTLED poll does not rewrite ready count', async () => {
  const env = createEnv({ revision: '10', readyCount: '50', lifecycle: 'SETTLED' });
  env.setOverviewHTML(responseHTML({ lifecycle: 'SETTLED', revision: '10', readyCount: '999' }));
  await env.window.__northstarRefreshOverview!();
  await flush();
  const ready = env.doc.querySelector('[data-test="ready-count"]');
  assert.ok(ready);
  assert.equal(ready.textContent, '50', 'same projection revision must not rewrite');
});

test('user-opened disclosure survives content patch', async () => {
  const env = createEnv({ disclosureOpen: true, revision: '1' });
  env.setOverviewHTML(responseHTML({ disclosureOpen: false, revision: '2' }));
  await env.window.__northstarRefreshOverview!();
  await flush();
  const details = env.doc.querySelector('[data-test="simulated-airline-update"]');
  assert.ok(details);
  assert.ok(details.hasAttribute('open'), 'open attribute must be restored');
});
