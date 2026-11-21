// Settings panel pieces: storage warning, "Back up your pins" prompt, Copy all pins, CSV export (SPEC section 5).
import { h, themed } from './dom.js';
import { bus } from '../state.js';
import { pins as defaultPins } from './index.js';

/** Put text on the clipboard from a click handler. Falls back to a selectable box when the host refuses. */
export async function copyText(text, { fallbackInto } = {}) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return 'copied'; }
  } catch { /* fall through */ }
  try {
    const t = h('textarea', { 'aria-hidden': 'true' }); t.value = text; t.style.cssText = 'position:fixed;left:-999px;top:0;opacity:0';
    document.body.append(t); t.select();
    const ok = document.execCommand && document.execCommand('copy'); t.remove();
    if (ok) return 'copied';
  } catch { /* fall through */ }
  if (fallbackInto) {
    const box = h('textarea', { class: 'pn-copybox', readonly: true, 'aria-label': 'Pins, ready to copy' }); box.value = text;
    fallbackInto.replaceChildren(box); box.focus(); box.select();
  }
  return 'manual';
}

/**
 * @param {HTMLElement} root
 * @param {{pins?:object, deliver?:(blob:Blob, filename:string)=>Promise<string>}} [o]
 */
export function mountPinsPanel(root, { pins = defaultPins, deliver = null } = {}) {
  const wrap = h('div', { class: 'pn-panel' });
  const un = themed(wrap);
  root.append(wrap);
  const status = h('div', { class: 'pn-msg', role: 'status' });
  const manual = h('div', {});

  async function doCopy() {
    const text = pins.copyAllText();
    const n = text ? text.split('\n').length : 0;
    if (!n) { status.className = 'pn-msg'; status.textContent = 'Nothing to copy yet.'; return; }
    const r = await copyText(text, { fallbackInto: manual });
    status.className = 'pn-msg' + (r === 'manual' ? ' warn' : '');
    status.textContent = r === 'copied' ? `Copied ${n} line${n === 1 ? '' : 's'}. Paste them into the Add box on another device.` : 'Your browser blocked copying. Select the text below and copy it.';
  }
  async function doCsv() {
    const blob = new Blob([pins.exportCSV()], { type: 'text/csv' });
    const filename = 'weather-story-pins.csv';
    let how = 'failed';
    try {
      const d = deliver || (await import('../share/index.js')).deliver;
      how = await d(blob, filename); // the file goes to the host's save or Web Share, or into the page as text to copy: never a download link
    } catch { how = 'failed'; }
    status.className = 'pn-msg' + (how === 'declined' || how === 'failed' ? ' warn' : '');
    status.textContent = how === 'declined' ? 'Not saved.' : how === 'failed' ? 'Could not save the file. Use Copy all pins instead.' : how === 'inline' ? 'Select the text and copy it.' : 'CSV ready.';
  }

  function render() {
    const kids = [];
    if (!pins.storageOk()) {
      kids.push(h('div', { class: 'pn-card warn', 'data-card': 'storage' },
        h('p', {}, "This browser isn't keeping your pins between visits."),
        h('p', { class: 'dim' }, 'Copy them now and paste them back later.')));
    }
    if (pins.needsBackupPrompt()) {
      kids.push(h('div', { class: 'pn-card', 'data-card': 'backup' },
        h('p', {}, h('b', { text: 'Back up your pins' })),
        h('p', { class: 'dim' }, `You have ${pins.all().length} pins. They live only in this browser, so a cleared browser would lose them.`),
        h('div', { class: 'pn-qa-row' },
          h('button', { class: 'pn-btn primary', type: 'button', 'data-act': 'copy', onclick: doCopy }, 'Copy all pins'),
          h('button', { class: 'pn-btn', type: 'button', 'data-act': 'csv', onclick: doCsv }, 'Download CSV'),
          h('button', { class: 'pn-btn quiet', type: 'button', onclick: () => { pins.dismissBackupPrompt(); } }, 'Not now'))));
    }
    const n = pins.all().length + pins.trips().length;
    kids.push(h('div', { class: 'pn-card', 'data-card': 'transfer' },
      h('p', {}, h('b', { text: 'Move your pins' })),
      h('p', { class: 'dim' }, 'Copy all pins, then paste them into the Add box on your other device.'),
      h('div', { class: 'pn-qa-row' },
        h('button', { class: 'pn-btn', type: 'button', 'data-act': 'copy', disabled: n === 0, onclick: doCopy }, 'Copy all pins'),
        h('button', { class: 'pn-btn', type: 'button', 'data-act': 'csv', disabled: n === 0, onclick: doCsv }, 'Download CSV'))));
    kids.push(status, manual);
    wrap.replaceChildren(...kids);
  }
  render();
  const offBus = bus.on('pins:changed', render);
  return { render, destroy() { un(); offBus(); wrap.remove(); }, copy: doCopy, csv: doCsv };
}
