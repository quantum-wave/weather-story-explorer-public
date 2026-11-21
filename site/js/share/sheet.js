// The share sheet, on the one sheet (ui/sheet.js, DESIGN-SPEC 8.1 and 8.5): opened by bus 'share:open' ({kind: 'still' | 'loop' |
// 'link'}) or any element with data-share="<kind>". Image, loop and link are tabs of one sheet that keeps its place when you switch.
// Honest by construction: "Copied" is said only after navigator.clipboard.writeText has resolved; when the clipboard is blocked the
// link is shown selected, in a read-only field, with "Select and copy". The app never starts a download (deliver.js): a file goes to
// the host's save, to Web Share, or onto the page to press and hold. Text from the app is set with textContent only.
import { bus, store } from '../state.js';
import { openSheet } from '../ui/sheet.js';
import { exportStill, exportLoop, defaultRange } from './export.js';
import { deliver, canCopyImage } from './deliver.js';
import { shareMeta, primeManifest, activeField } from './meta.js';
import { linkText } from '../links.js';

let sheet = null, ctl = null, previewUrl = null, host = null, watcher = null;

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
}

const TITLES = { still: 'Share an image', loop: 'Share a loop', link: 'Share a link' };
const SAYS = { saved: 'Saved.', shared: 'Shared.', declined: 'Not saved.', inline: '' };
export const LINK_PEOPLE_NOTE = 'Links never include people or their places: a link opens the same map at the same time, nothing more.';

/** Write text to the clipboard. True only once the browser's promise resolves; false when it is missing or refuses. */
export async function copyText(text) {
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch { return false; }
}
/** Copy a PNG to the clipboard; true only after the write resolved. */
async function copyPng(blob) {
  try { await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]); return true; } catch { return false; }
}

function cleanup() {
  ctl?.abort(); ctl = null;
  watcher?.disconnect(); watcher = null;
  host?._release?.(); host = null;
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
}
export function closeShare() {
  const s = sheet; sheet = null;
  cleanup();
  if (s) s.close('close');
}

/** Suggest the one-sentence summary as a headline (J4): best effort, never blocks. */
async function suggestion(state) {
  const f = state.focus;
  if (!f) return null;
  try {
    const story = await import('../story/index.js');
    const days = await story.buildDays(f.lat, f.lon, 0, 7);
    const s = story.summarize(days, { sample: !!state.sample });
    return typeof s === 'string' && s ? s : null;
  } catch { return null; }
}

export async function openShare(kind = 'still') {
  await primeManifest();
  if (store.get().playing) store.set({ playing: false }); // the share is of the moment the user tapped
  const mine = {}; // this sheet's own state, so a late result from a closed sheet changes nothing
  cleanup();
  const content = el('div', { class: 'share-body' });
  const api = openSheet({ title: TITLES[kind] || TITLES.still, content, actions: null, onClose: () => { if (sheet === api) sheet = null; cleanup(); mine.gone = true; } });
  sheet = api;
  render(api, kind, mine);
  return api;
}

function render(api, kind, mine) {
  cleanup();
  const state = store.get();
  const meta = shareMeta(state);
  api.setTitle(TITLES[kind] || TITLES.still);
  const body = el('div', { class: 'share-body' });
  const status = el('p', { class: 'share-status', role: 'status', 'aria-live': 'polite' });
  const preview = el('div', { class: 'share-preview' });
  const say = (t) => { status.textContent = t; };
  const alive = () => !mine.gone && sheet === api;

  // Image, loop and link are one sheet: the header's Share button opens it, the tabs switch the kind.
  const tabs = el('div', { class: 'share-tabs', role: 'group', 'aria-label': 'What to share' });
  for (const [k, label] of [['still', 'Image'], ['loop', 'Loop'], ['link', 'Link']]) {
    const b = el('button', { type: 'button', class: 'share-tab', 'data-kind': k, 'aria-pressed': k === kind ? 'true' : 'false', text: label });
    b.addEventListener('click', () => { if (k !== kind) render(api, k, mine); });
    tabs.append(b);
  }
  body.append(tabs);
  const bar = el('progress', { class: 'share-progress', max: '1', value: '0' }); bar.hidden = true;
  body.append(preview, bar, status);

  let headlineInput = null;
  if (kind === 'still') {
    headlineInput = el('input', { class: 'share-headline', id: 'share-headline', type: 'text', maxlength: '140', value: meta.headline });
    const chips = el('div', { class: 'share-chips' });
    body.append(el('label', { class: 'share-label', for: 'share-headline', text: 'Headline' }), headlineInput, chips);
    suggestion(state).then((s) => {
      if (!s || !alive() || !headlineInput.isConnected) return;
      const b = el('button', { type: 'button', class: 'share-chip', text: 'Use the summary sentence' });
      b.addEventListener('click', () => { headlineInput.value = s.slice(0, 140); });
      chips.append(b);
    });
  }
  if (kind === 'loop') {
    const r = defaultRange(state, activeField(state));
    body.append(el('p', { class: 'share-note', text: `Loop of ${Math.round((r.to - r.from) / 24 * 10) / 10} days, with a pause on the day you are looking at.` }));
  }
  api.setContent(body).then(() => {});
  // The sheet is as tall as its content. The content changes after setContent (the link tab swaps the preview for the field and adds
  // its note and hint; every status line adds text), so the sheet re-measures whenever the body's own height changes.
  if (typeof ResizeObserver === 'function') {
    watcher = new ResizeObserver(() => { if (alive()) api.resize(); });
    watcher.observe(body);
  }

  const actions = (list) => { if (alive()) api.setActions(list); };
  let current = null; // { blob, filename }

  const showPreview = (blob) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);
    const img = el('img', { src: previewUrl, alt: kind === 'loop' ? 'Preview of the loop' : 'Preview of the image' });
    img.addEventListener('load', () => { if (alive()) api.resize(); });
    preview.replaceChildren(img);
    api.resize();
  };
  const stamp = () => new Date().toISOString().slice(0, 10);
  const save = async () => {
    if (!current) return;
    try {
      const out = await deliver(current.blob, current.filename, { host: preview }); // 'inline' puts the picture in the sheet
      if (!alive()) return;
      if (out === 'inline') { host = preview; api.resize(); }
      say(SAYS[out] || '');
    } catch (e) {
      say(e && e.code === 'too_large' ? 'That file is too large to save here. Try the image instead.' : 'Could not save that file.');
    }
  };
  const afterMake = (blob, filename) => {
    current = { blob, filename };
    showPreview(blob);
    const list = [{ id: 'save', label: 'Save', kind: 'primary', onClick: save }];
    if (blob.type === 'image/png' && canCopyImage()) {
      list.push({ id: 'copy-image', label: 'Copy image', kind: 'secondary', onClick: async () => {
        say('Copying…');
        const ok = await copyPng(blob);
        if (!alive()) return;
        say(ok ? 'Copied. Paste the image where you want it.' : 'Copying images is not available here. Use Save, or press and hold the image.');
      } });
    }
    actions(list);
  };

  if (kind === 'link') {
    const input = el('input', { class: 'share-headline share-link', type: 'text', readonly: '', 'aria-label': 'Link', 'data-testid': 'share-link' });
    const note = el('p', { class: 'share-note share-people', text: LINK_PEOPLE_NOTE });
    const hint = el('p', { class: 'share-note share-select', hidden: '' });
    preview.replaceWith(input); // the link field sits where a picture would
    status.before(note); status.after(hint);
    const person = state.focus?.kind === 'person';
    let text = '';
    linkText().then((t) => { text = t; if (input.isConnected) input.value = t; });
    const copy = async () => {
      if (!text) text = await linkText();
      input.value = text;
      say('Copying…'); hint.hidden = true;
      const ok = await copyText(text); // says "Copied" only once the clipboard has taken it
      if (!alive()) return;
      if (ok) say(person ? 'Copied. This link leaves out the person you are looking at: links never include people.' : 'Copied.');
      else {
        say('Could not copy automatically.');
        hint.hidden = false; hint.textContent = 'Select and copy the link above.';
        input.focus(); input.select(); input.scrollLeft = 0;
        api.resize();
      }
    };
    actions([{ id: 'copy-link', label: 'Copy link', kind: 'primary', onClick: copy }]);
    api.resize(); // the link layout is complete: measure it now rather than waiting for the observer
    return;
  }
  if (kind === 'still') {
    const make = async () => {
      actions([{ id: 'make', label: 'Make image', kind: 'primary', disabled: true }]); say('Drawing…');
      try {
        const blob = await exportStill({ headline: headlineInput.value });
        if (!alive()) return;
        say(''); afterMake(blob, `weather-story-${stamp()}.png`);
      } catch { if (alive()) { say('Could not draw the image.'); actions([{ id: 'make', label: 'Make image', kind: 'primary', onClick: make }]); } }
    };
    actions([{ id: 'make', label: 'Make image', kind: 'primary', onClick: make }]);
    make();
    // an edited headline redraws the picture (after a pause in typing), so what is saved is what the field says
    let typing = null;
    headlineInput.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => { if (alive()) make(); }, 450); });
  } else {
    const make = async () => {
      bar.hidden = false; say('Encoding…');
      ctl = new AbortController();
      const signal = ctl.signal;
      actions([{ id: 'cancel', label: 'Cancel', kind: 'secondary', onClick: () => ctl?.abort() }]);
      try {
        const blob = await exportLoop({ onProgress: (f) => { bar.value = f; }, signal });
        if (!alive()) return;
        bar.hidden = true; say(''); afterMake(blob, `weather-story-${stamp()}.gif`);
      } catch (e) {
        if (!alive()) return;
        bar.hidden = true;
        say(e && e.name === 'AbortError' ? 'Cancelled.' : 'Could not make the loop.');
        actions([{ id: 'make', label: 'Make loop', kind: 'primary', onClick: make }]);
      }
    };
    actions([{ id: 'make', label: 'Make loop', kind: 'primary', onClick: make }]);
  }
}

let installed = false;
export function installShareSheet() {
  if (installed) return;
  installed = true;
  bus.on('share:open', (d) => { openShare(d && d.kind); });
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-share]');
    if (t) { e.preventDefault(); openShare(t.getAttribute('data-share') || 'still'); }
  });
}
