// Minimal Chrome DevTools Protocol driver over Node's global WebSocket. No dependencies.
// Every Chrome started here is tracked; killAll() (also wired to 'exit') kills each process group.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromePath } from './chrome.mjs';
import { artifactsDir } from './artifacts.mjs';

/** Resolved lazily so importing this module never throws; Browser.launch throws the clear message instead. */
export function chromeBin() { return chromePath(); }
/** Kept for existing importers: the resolved browser path, or null when none is installed. */
export const CHROME = (() => { try { return chromePath(); } catch { return null; } })();
const live = new Set(); // { child, dir }

function killOne(r) {
  try { process.kill(-r.child.pid, 'SIGKILL'); } catch { try { r.child.kill('SIGKILL'); } catch {} }
  try { fs.rmSync(r.dir, { recursive: true, force: true }); } catch {}
  live.delete(r);
}
/** Synchronous, safe to call from 'exit' handlers. */
export function killAll() { for (const r of [...live]) killOne(r); }
process.on('exit', killAll);

class Page {
  constructor(conn, sessionId, targetId, baseUrl, contextId) {
    Object.assign(this, { conn, sessionId, targetId, baseUrl, contextId });
    this.console = []; // { type: 'error'|'warning'|'log'|..., text }
    this.externalRequests = [];
    conn.onEvent(sessionId, (m, p) => this._event(m, p));
  }
  _event(method, p) {
    if (method === 'Runtime.consoleAPICalled') {
      this.console.push({ type: p.type, text: p.args.map((a) => a.value ?? a.description ?? '').join(' ') });
    } else if (method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails;
      this.console.push({ type: 'error', text: 'exception: ' + (d.exception?.description || d.text) });
    } else if (method === 'Log.entryAdded') {
      if (p.entry.level === 'error' || p.entry.level === 'warning') this.console.push({ type: p.entry.level, text: `${p.entry.source}: ${p.entry.text} ${p.entry.url || ''}`.trim() });
    } else if (method === 'Fetch.requestPaused') {
      const url = p.request.url;
      const ok = url.startsWith(this.baseUrl) || /^(data|blob|about):/.test(url);
      if (!ok) {
        this.externalRequests.push(url);
        this.console.push({ type: 'error', text: 'blocked external request: ' + url });
      }
      this.send(ok ? 'Fetch.continueRequest' : 'Fetch.failRequest', ok ? { requestId: p.requestId } : { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    }
  }
  send(method, params = {}) { return this.conn.send(method, params, this.sessionId); }
  /** Console entries of type error (includes uncaught exceptions, failed loads, blocked external requests). */
  errors() { return this.console.filter((c) => c.type === 'error'); }
  async goto(url, { timeout = 30000 } = {}) {
    const loaded = this.conn.waitEvent(this.sessionId, 'Page.loadEventFired', timeout);
    const r = await this.send('Page.navigate', { url: new URL(url, this.baseUrl).href });
    if (r.errorText) throw new Error('navigate failed: ' + r.errorText);
    await loaded;
  }
  /** Evaluate an expression (promises awaited); returns the value, throws on page exceptions. */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('page eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async waitFor(expression, { timeout = 10000, interval = 50 } = {}) {
    const end = Date.now() + timeout;
    for (;;) {
      let v; try { v = await this.eval(expression); } catch { v = false; }
      if (v) return v;
      if (Date.now() > end) throw new Error('timeout waiting for: ' + expression);
      await new Promise((r) => setTimeout(r, interval));
    }
  }
  async setViewport(width, height, deviceScaleFactor = 1) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile: false });
  }
  /** PNG as a Buffer; also written to `file` when given. */
  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(r.data, 'base64');
    if (file) fs.writeFileSync(file, buf);
    return buf;
  }
  async close() { try { await this.conn.send('Target.disposeBrowserContext', { browserContextId: this.contextId }); } catch {} }
}

class Conn {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = new Map(); this.waiters = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        if (p) m.error ? p.reject(new Error(`${p.method}: ${m.error.message}`)) : p.resolve(m.result);
      } else {
        this.listeners.get(m.sessionId)?.(m.method, m.params);
        this.waiters = this.waiters.filter((w) => !(w.sessionId === m.sessionId && w.method === m.method && (w.resolve(m.params), true)));
      }
    });
    ws.addEventListener('close', () => { for (const p of this.pending.values()) p.reject(new Error('Chrome connection closed')); this.pending.clear(); });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  onEvent(sessionId, fn) { this.listeners.set(sessionId, fn); }
  waitEvent(sessionId, method, timeout) {
    return new Promise((resolve, reject) => {
      const w = { sessionId, method, resolve: (v) => { clearTimeout(t); resolve(v); } };
      const t = setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); reject(new Error(`timeout waiting for ${method}`)); }, timeout);
      this.waiters.push(w);
    });
  }
}

export class Browser {
  /** Launch a headless Chrome with its own fresh --user-data-dir. */
  static async launch({ baseUrl, width = 1440, height = 900, executablePath, headless = 'new' } = {}) {
    const dir = fs.mkdtempSync(path.join(artifactsDir(), 'chrome-profile-'));
    const child = spawn(executablePath || chromeBin(), [`--headless=${headless}`, '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
      '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--mute-audio',
      `--window-size=${width},${height}`, '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'],
    { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const rec = { child, dir }; live.add(rec);
    try {
      const wsUrl = await new Promise((resolve, reject) => {
        let buf = ''; const t = setTimeout(() => reject(new Error('Chrome did not report a DevTools URL')), 20000);
        child.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); resolve(m[1]); } });
        child.once('exit', (c) => { clearTimeout(t); reject(new Error('Chrome exited early, code ' + c)); });
        child.once('error', (e) => { clearTimeout(t); reject(e); });
      });
      child.stderr.on('data', () => {}); // keep draining
      const ws = new WebSocket(wsUrl);
      await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('DevTools websocket failed')), { once: true }); });
      const b = new Browser(); Object.assign(b, { rec, conn: new Conn(ws), baseUrl, ws });
      return b;
    } catch (e) { killOne(rec); throw e; }
  }
  /** A page in a new incognito-style context: its own cookies and localStorage. */
  async newPage() {
    const { browserContextId } = await this.conn.send('Target.createBrowserContext');
    const { targetId } = await this.conn.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await this.conn.send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(this.conn, sessionId, targetId, this.baseUrl, browserContextId);
    for (const m of ['Page.enable', 'Runtime.enable', 'Log.enable']) await page.send(m);
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    return page;
  }
  async close() {
    try { this.ws.close(); } catch {}
    killOne(this.rec);
  }
}
