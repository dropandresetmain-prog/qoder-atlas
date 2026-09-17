/**
 * F4 — Overview polling swap: disclosure survival + trigger status re-application.
 *
 * Evaluates the inline <script> from renderOverviewPollingScript() inside a
 * hand-rolled minimal DOM stub. No refactoring of polling.ts required.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderOverviewPollingScript } from '../src/ui/polling.ts';

// ── Minimal DOM stub ────────────────────────────────────────────────────────

type TriggerEvent = { type: string; target: StubElement; preventDefault: () => void };

class StubElement {
  tagName: string;
  attrs: Map<string, string>;
  classes: Set<string>;
  children: StubElement[];
  parent: StubElement | null = null;
  text = '';
  disabled = false;
  private _listeners = new Map<string, Array<(ev: TriggerEvent) => void>>();

  constructor(tag: string, attrs: Record<string, string> = {}) {
    this.tagName = tag;
    this.attrs = new Map(Object.entries(attrs));
    this.classes = new Set();
    this.children = [];
  }

  appendChild(child: StubElement) {
    child.parent = this;
    this.children.push(child);
  }

  get outerHTML(): string {
    return serialize(this);
  }

  set outerHTML(html: string) {
    if (!this.parent) return;
    const nodes = parse(html);
    const idx = this.parent.children.indexOf(this);
    if (idx >= 0) {
      this.parent.children.splice(idx, 1, ...nodes);
      for (const n of nodes) n.parent = this.parent;
    }
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

  closest(sel: string): StubElement | null {
    if (matchFull(this, sel)) return this;
    return this.parent?.closest(sel) ?? null;
  }

  get classList() {
    return {
      add: (c: string) => { this.classes.add(c); },
      remove: (c: string) => { this.classes.delete(c); },
    };
  }

  get textContent(): string {
    return this.text;
  }

  set textContent(v: string) {
    this.text = v;
    this.children = [];
  }

  addEventListener(type: string, fn: (ev: TriggerEvent) => void) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type)!.push(fn);
  }

  dispatchEvent(ev: { type: string; target: StubElement; preventDefault: () => void }) {
    for (const fn of this._listeners.get(ev.type) || []) fn(ev);
  }
}

function serialize(el: StubElement): string {
  const a = Array.from(el.attrs.entries())
    .map(([k, v]) => (v ? `${k}="${v}"` : k))
    .join(' ');
  const cls = el.classes.size ? ` class="${[...el.classes].join(' ')}"` : '';
  const attr = (a ? ' ' + a : '') + cls;
  const inner = el.text + el.children.map(serialize).join('');
  return `<${el.tagName}${attr}>${inner}</${el.tagName}>`;
}

function parse(html: string): StubElement[] {
  let pos = 0;
  function nodes(parent: StubElement | null): StubElement[] {
    const out: StubElement[] = [];
    while (pos < html.length) {
      if (html[pos] === '<') {
        if (html[pos + 1] === '/') {
          const end = html.indexOf('>', pos);
          pos = end + 1;
          return out;
        }
        pos++;
        let tag = '';
        while (pos < html.length && !/[\s>/]/.test(html[pos]!)) {
          tag += html[pos];
          pos++;
        }
        const attrs: Record<string, string> = {};
        const cls: string[] = [];
        while (pos < html.length && html[pos] !== '>' && html[pos] !== '/') {
          while (pos < html.length && /\s/.test(html[pos]!)) pos++;
          if (html[pos] === '>' || html[pos] === '/') break;
          let name = '';
          while (pos < html.length && !/[\s=>/]/.test(html[pos]!)) {
            name += html[pos];
            pos++;
          }
          if (html[pos] === '=') {
            pos++;
            const q = html[pos]!;
            pos++;
            let val = '';
            while (pos < html.length && html[pos] !== q) {
              val += html[pos];
              pos++;
            }
            pos++;
            if (name === 'class') cls.push(...val.split(/\s+/));
            else attrs[name] = val;
          } else if (name) {
            attrs[name] = '';
          }
        }
        const selfClose = html[pos] === '/';
        if (selfClose) pos++;
        pos++; // skip >
        const el = new StubElement(tag, attrs);
        for (const c of cls) el.classes.add(c);
        if (!selfClose) {
          for (const child of nodes(el)) el.appendChild(child);
        }
        out.push(el);
      } else {
        let txt = '';
        while (pos < html.length && html[pos] !== '<') {
          txt += html[pos];
          pos++;
        }
        txt = txt.trim();
        if (txt && parent) {
          parent.text = txt;
        }
      }
    }
    return out;
  }
  return nodes(null);
}

function matchSimple(el: StubElement, sel: string): boolean {
  let r = sel;
  const tm = r.match(/^([a-zA-Z]+)/);
  if (tm) {
    if (el.tagName !== tm[1]) return false;
    r = r.slice(tm[0].length);
  }
  const cm = r.match(/^\.([a-zA-Z0-9_-]+)/);
  if (cm) {
    if (!el.classes.has(cm[1]!)) return false;
    r = r.slice(cm[0].length);
  }
  const am = r.match(/^\[([a-zA-Z-]+)(?:="([^"]*)")?\]/);
  if (am) {
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

// ── Test environment ────────────────────────────────────────────────────────

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
  return `<main data-test="product-operator-overview" data-assessment-lifecycle="${lifecycle}" data-assessment-pending-count="${pending}" data-stable-revision="${revision}"><p data-test="overview-reconciling"${reconcilingHidden}>Reconciling changes…</p><div data-test="ready-count">${ready}</div><details data-test="simulated-airline-update" data-configured="true"${openAttr}><span data-test="simulated-airline-update-status">${statusText}</span><button data-test="simulated-airline-update-apply">Apply</button></details></main><header class="topbar">Nav</header>`;
}

interface TriggerResponseShape {
  ok: boolean;
  status: number;
  body?: unknown;
  raw?: string;
}

interface WindowStub {
  __northstarRefreshOverview?: () => void;
  [key: string]: unknown;
}

interface Env {
  window: WindowStub;
  doc: StubElement;
  setOverviewHTML: (html: string) => void;
  setTriggerResponse: (r: TriggerResponseShape) => void;
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
  // Build initial DOM.
  const doc = new StubElement('document');
  const lifecycle = domOpts.lifecycle ?? 'SETTLED';
  const main = new StubElement('main', {
    'data-test': 'product-operator-overview',
    'data-assessment-lifecycle': lifecycle,
    'data-assessment-pending-count': String(domOpts.pendingCount ?? 0),
    'data-stable-revision': domOpts.revision ?? '1',
  });
  const reconciling = new StubElement('p', { 'data-test': 'overview-reconciling' });
  if (lifecycle !== 'RECONCILING') reconciling.setAttribute('hidden', '');
  reconciling.text = 'Reconciling changes…';
  main.appendChild(reconciling);
  const ready = new StubElement('div', { 'data-test': 'ready-count' });
  ready.text = domOpts.readyCount ?? '50';
  main.appendChild(ready);
  const detailsAttrs: Record<string, string> = {
    'data-test': 'simulated-airline-update',
    'data-configured': 'true',
  };
  if (domOpts.disclosureOpen) detailsAttrs['open'] = '';
  const details = new StubElement('details', detailsAttrs);
  const status = new StubElement('span', { 'data-test': 'simulated-airline-update-status' });
  status.text = domOpts.statusText ?? '';
  const button = new StubElement('button', { 'data-test': 'simulated-airline-update-apply' });
  button.text = 'Apply';
  details.appendChild(status);
  details.appendChild(button);
  main.appendChild(details);
  doc.appendChild(main);
  const topbar = new StubElement('header');
  topbar.classes.add('topbar');
  topbar.text = 'Nav';
  doc.appendChild(topbar);

  const win: WindowStub = {};
  let overviewHTML = responseHTML({
    lifecycle: domOpts.lifecycle,
    pendingCount: domOpts.pendingCount,
    revision: domOpts.revision,
    readyCount: domOpts.readyCount,
  });
  let triggerResp = { ok: true, status: 200, raw: '{}' };

  const fetchStub = (url: string) => {
    if (url.includes('/api/v2/operator/overview')) {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(overviewHTML) });
    }
    if (url.includes('/api/v2/demo/provider-event/airline-rebooking')) {
      return Promise.resolve({
        ok: triggerResp.ok,
        status: triggerResp.status,
        text: () => Promise.resolve(triggerResp.raw),
      });
    }
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
  };

  const intervals: Array<{ cb: () => void; ms: number }> = [];
  const setIntervalStub = (cb: () => void, ms: number) => {
    intervals.push({ cb, ms });
    return intervals.length;
  };

  class StubDOMParser {
    parseFromString(html: string) {
      const nodes = parse(html);
      return {
        querySelector(sel: string) {
          for (const n of nodes) {
            if (matchFull(n, sel)) return n;
            const f = n.querySelector(sel);
            if (f) return f;
          }
          return null;
        },
      };
    }
  }

  const script = renderOverviewPollingScript();
  const body = script.replace(/<\/?script>/g, '');
  const fn = new Function(
    'window', 'document', 'DOMParser', 'fetch', 'setInterval', 'console', body,
  ) as (w: Record<string, unknown>, d: StubElement, p: unknown, f: unknown, s: unknown, c: unknown) => void;
  fn(win, doc, StubDOMParser, fetchStub, setIntervalStub, { warn() {} });

  return {
    window: win,
    doc,
    setOverviewHTML: (html: string) => { overviewHTML = html; },
    setTriggerResponse: (r) => {
      triggerResp = {
        ok: r.ok,
        status: r.status,
        raw: r.raw ?? (r.body ? JSON.stringify(r.body) : ''),
      };
    },
    intervals,
  };
}

async function flush() {
  for (let i = 0; i < 20; i++) await new Promise(r => setTimeout(r, 0));
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('setInterval captures default 2000ms interval', () => {
  const env = createEnv();
  assert.equal(env.intervals.length, 1, 'exactly one interval registered');
  assert.equal(env.intervals[0]!.ms, 2000, 'default interval is 2000ms');
});

test('Scenario A: user-opened disclosure survives the main swap', async () => {
  const env = createEnv({ disclosureOpen: true, revision: '1' });
  // Response HTML has details WITHOUT open attribute; new revision forces apply.
  env.setOverviewHTML(responseHTML({ disclosureOpen: false, revision: '2' }));
  env.window.__northstarRefreshOverview!();
  await flush();
  const details = env.doc.querySelector('[data-test="simulated-airline-update"]');
  assert.ok(details, 'details element must exist after swap');
  assert.ok(details.hasAttribute('open'), 'open attribute must be restored after swap');
});

test('Scenario B1: APPLIED status re-applied after swap', async () => {
  const env = createEnv({ disclosureOpen: true, revision: '1' });
  // Simulate click on apply button.
  const button = env.doc.querySelector('[data-test="simulated-airline-update-apply"]')!;
  env.doc.dispatchEvent({ type: 'click', target: button, preventDefault() {} });
  // Trigger response: APPLIED.
  env.setTriggerResponse({ ok: true, status: 200, body: { status: 'APPLIED' } });
  // Overview response (from refresh after apply) has empty status text.
  env.setOverviewHTML(responseHTML({ disclosureOpen: false, statusText: '', revision: '2' }));
  await flush();
  const status = env.doc.querySelector('[data-test="simulated-airline-update-status"]');
  assert.ok(status);
  assert.equal(status.textContent, 'Applied. Authoritative state will refresh automatically.');
  const btn = env.doc.querySelector('[data-test="simulated-airline-update-apply"]');
  assert.ok(btn);
  assert.equal(btn.disabled, false, 'button must be re-enabled after response');
});

test('Scenario B2: ALREADY_APPLIED status re-applied after swap', async () => {
  const env = createEnv({ disclosureOpen: true, revision: '1' });
  const button = env.doc.querySelector('[data-test="simulated-airline-update-apply"]')!;
  env.doc.dispatchEvent({ type: 'click', target: button, preventDefault() {} });
  env.setTriggerResponse({ ok: true, status: 200, body: { status: 'ALREADY_APPLIED' } });
  env.setOverviewHTML(responseHTML({ disclosureOpen: false, statusText: '', revision: '2' }));
  await flush();
  const status = env.doc.querySelector('[data-test="simulated-airline-update-status"]');
  assert.ok(status);
  assert.equal(status.textContent, 'Already applied. No duplicate incident created.');
});

test('Scenario C1: error response sets error status and re-enables button', async () => {
  const env = createEnv({ disclosureOpen: true });
  // Set error response BEFORE click (click handler calls fetch immediately).
  env.setTriggerResponse({ ok: false, status: 500, body: { code: 'BOOM', message: 'kaboom' } });
  const button = env.doc.querySelector('[data-test="simulated-airline-update-apply"]')!;
  env.doc.dispatchEvent({ type: 'click', target: button, preventDefault() {} });
  await flush();
  const status = env.doc.querySelector('[data-test="simulated-airline-update-status"]');
  assert.ok(status);
  assert.ok(status.textContent.startsWith('The simulated update was not applied.'), `expected error text, got: ${status.textContent}`);
  assert.ok(status.textContent.includes('BOOM: kaboom'), `expected error text, got: ${status.textContent}`);
  const btn = env.doc.querySelector('[data-test="simulated-airline-update-apply"]');
  assert.ok(btn);
  assert.equal(btn.disabled, false, 'button must be re-enabled after error');
});

test('Scenario C2: no invented business state on plain refresh', async () => {
  const serverStatusText = 'Server-provided status';
  const env = createEnv({ disclosureOpen: false, statusText: 'Initial' });
  // No click — lastTriggerStatus stays null.
  env.setOverviewHTML(responseHTML({ disclosureOpen: false, statusText: serverStatusText, revision: '2' }));
  env.window.__northstarRefreshOverview!();
  await flush();
  const status = env.doc.querySelector('[data-test="simulated-airline-update-status"]');
  assert.ok(status);
  assert.equal(status.textContent, serverStatusText, 'status must come from server HTML, not invented');
});

test('Founder defect: RECONCILING holds settled ready count (no 0 rebuild)', async () => {
  const env = createEnv({ revision: '10', readyCount: '50', lifecycle: 'SETTLED' });
  env.setOverviewHTML(responseHTML({
    lifecycle: 'RECONCILING',
    pendingCount: 5,
    revision: '11',
    readyCount: '0',
  }));
  env.window.__northstarRefreshOverview!();
  await flush();
  const ready = env.doc.querySelector('[data-test="ready-count"]');
  assert.ok(ready);
  assert.equal(ready.textContent, '50', 'must hold last SETTLED ready count during RECONCILING');
  const indicator = env.doc.querySelector('[data-test="overview-reconciling"]');
  assert.ok(indicator);
  assert.equal(indicator.hasAttribute('hidden'), false, 'reconciling indicator must be visible');
});

test('Founder defect: SETTLED result replaces held content once', async () => {
  const env = createEnv({ revision: '10', readyCount: '50', lifecycle: 'SETTLED' });
  env.setOverviewHTML(responseHTML({
    lifecycle: 'RECONCILING',
    pendingCount: 5,
    revision: '11',
    readyCount: '0',
  }));
  env.window.__northstarRefreshOverview!();
  await flush();
  env.setOverviewHTML(responseHTML({
    lifecycle: 'SETTLED',
    pendingCount: 0,
    revision: '12',
    readyCount: '49',
  }));
  env.window.__northstarRefreshOverview!();
  await flush();
  const ready = env.doc.querySelector('[data-test="ready-count"]');
  assert.ok(ready);
  assert.equal(ready.textContent, '49', 'SETTLED snapshot must apply after reconciliation');
  const indicator = env.doc.querySelector('[data-test="overview-reconciling"]');
  assert.ok(indicator);
  assert.equal(indicator.hasAttribute('hidden'), true, 'reconciling indicator must hide when SETTLED');
});

test('Founder defect: unchanged SETTLED poll does not rewrite DOM', async () => {
  const env = createEnv({ revision: '10', readyCount: '49', lifecycle: 'SETTLED' });
  const before = env.doc.querySelector('main[data-test="product-operator-overview"]');
  assert.ok(before);
  env.setOverviewHTML(responseHTML({
    lifecycle: 'SETTLED',
    pendingCount: 0,
    revision: '10',
    readyCount: '49',
    statusText: 'Generated later',
  }));
  env.window.__northstarRefreshOverview!();
  await flush();
  const after = env.doc.querySelector('main[data-test="product-operator-overview"]');
  assert.equal(after, before, 'identical stable revision must keep the same main node');
});
