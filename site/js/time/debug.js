// Debug readout (SPEC section 4): `#debug` in the hash, or five taps on #data-chip, shows frame p95 and JS heap
// so a real phone can report them. Keeps window.__wse.frameTimes (loop frame intervals in ms, last 600).
import { onFrame } from './clock.js';
import { percentile } from './model.js';

const KEEP = 600;
const fmt = (v) => (v == null ? 'n/a' : v.toFixed(1));

let instance = null;

/** Idempotent: a second call returns the readout that is already installed (a double install would toggle twice per tap). */
export function installDebug() {
  if (instance) return instance;
  const w = (window.__wse ||= {});
  const frameTimes = (w.frameTimes ||= []);
  const workTimes = (w.workTimes ||= []);
  const off = onFrame((interval, work) => {
    frameTimes.push(interval); workTimes.push(work);
    if (frameTimes.length > KEEP) frameTimes.splice(0, frameTimes.length - KEEP);
    if (workTimes.length > KEEP) workTimes.splice(0, workTimes.length - KEEP);
  });

  let el = document.getElementById('debug');
  if (!el) { el = document.createElement('div'); el.id = 'debug'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.hidden = true;
  let timer = 0;

  const render = () => {
    const p95 = percentile(frameTimes.slice(-120), 95);
    const work95 = percentile(workTimes.slice(-120), 95);
    const heap = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null;
    el.textContent = `frame p95 ${fmt(p95)} ms · draw p95 ${fmt(work95)} ms · heap ${heap == null ? 'n/a' : heap.toFixed(0) + ' MB'} · n ${frameTimes.length}`;
  };
  const show = (on) => {
    el.hidden = !on;
    clearInterval(timer);
    if (on) { render(); timer = setInterval(render, 500); }
  };
  const fromHash = () => show(/^#debug$/.test(location.hash));
  fromHash();
  window.addEventListener('hashchange', fromHash);

  let taps = [];
  const onTap = (e) => {
    if (!e.target.closest || !e.target.closest('#data-chip')) return;
    const now = Date.now();
    taps = taps.filter((t) => now - t < 3000); taps.push(now);
    if (taps.length >= 5) { taps = []; show(el.hidden); }
  };
  document.addEventListener('click', onTap);

  instance = {
    frameTimes, element: el, show,
    uninstall() { off(); clearInterval(timer); window.removeEventListener('hashchange', fromHash); document.removeEventListener('click', onTap); el.hidden = true; instance = null; },
  };
  return instance;
}
