// The share sheet: opened by bus 'share:open' ({kind: 'still'|'loop'|'link'}) or any element with data-share="<kind>".
// Text from the app is set with textContent only.
import { bus, store } from '../state.js';
import { exportStill, exportLoop, defaultRange } from './export.js';
import { deliver, copyImage, canCopyImage } from './deliver.js';
import { shareMeta, primeManifest, activeField } from './meta.js';
import { copyLink, linkText } from '../links.js';

let dlg = null, ctl = null, previewUrl = null;

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
}
const btn = (text, onClick, cls = '') => { const b = el('button', { type: 'button', class: 'share-btn ' + cls, text }); b.addEventListener('click', onClick); return b; };

export function closeShare() {
  ctl?.abort(); ctl = null;
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  dlg?.remove(); dlg = null;
  document.removeEventListener('keydown', onKey);
}
function onKey(e) { if (e.key === 'Escape') closeShare(); }

const SAYS = { saved: 'Saved.', shared: 'Shared.', downloaded: 'Downloaded.', inline: 'Press and hold the image to save it.', declined: 'Not saved.' };

/** Suggest the one-sentence summary as a headline (J4): best effort, never blocks. */
async function suggestion(state) {
  const f = state.focus;
  if (!f) return null;
  if (state.sample && state.case !== 'A') return null; // the story reads case A only
  try {
    const story = await import('../story/index.js');
    const days = await story.buildDays(f.lat, f.lon, 0, 7);
    const s = story.summarize(days, { sample: !!state.sample });
    return typeof s === 'string' && s ? s : null;
  } catch { return null; }
}

export async function openShare(kind = 'still') {
  closeShare();
  await primeManifest();
  if (store.get().playing) store.set({ playing: false }); // the share is of the moment the user tapped
  const state = store.get();
  const meta = shareMeta(state);
  dlg = el('div', { class: 'share-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Share this view' });
  const card = el('div', { class: 'share-card' });
  const title = el('h2', { class: 'share-title', text: kind === 'loop' ? 'Share a loop' : kind === 'link' ? 'Share a link' : 'Share an image' });
  const status = el('p', { class: 'share-status', role: 'status', 'aria-live': 'polite' });
  const preview = el('div', { class: 'share-preview' });
  const actions = el('div', { class: 'share-actions' });
  const closeBtn = btn('Close', closeShare, 'share-close');
  card.append(title);
  // Image, loop and link are one sheet: the header's Share button opens it, the tabs switch the kind.
  const tabs = el('div', { class: 'share-tabs', role: 'group', 'aria-label': 'What to share' });
  for (const [k, label] of [['still', 'Image'], ['loop', 'Loop'], ['link', 'Link']]) {
    const b = el('button', { type: 'button', class: 'share-tab', 'data-kind': k, 'aria-pressed': k === kind ? 'true' : 'false', text: label });
    b.addEventListener('click', () => { if (k !== kind) openShare(k); });
    tabs.append(b);
  }
  card.append(tabs);

  let headlineInput = null;
  if (kind === 'still') {
    headlineInput = el('input', { class: 'share-headline', type: 'text', maxlength: '140', 'aria-label': 'Headline', value: meta.headline });
    const chips = el('div', { class: 'share-chips' });
    card.append(el('label', { class: 'share-label', text: 'Headline' }), headlineInput, chips);
    suggestion(state).then((s) => {
      if (!s || !dlg) return;
      chips.append(btn('Use the summary sentence', () => { headlineInput.value = s.slice(0, 140); }, 'share-chip'));
    });
  }
  if (kind === 'loop') {
    const r = defaultRange(state, activeField(state));
    card.append(el('p', { class: 'share-note', text: `Loop of ${Math.round((r.to - r.from) / 24 * 10) / 10} days, with a pause on the day you are looking at.` }));
  }
  const bar = el('progress', { class: 'share-progress', max: '1', value: '0' }); bar.hidden = true;
  card.append(preview, bar, status, actions, closeBtn);
  dlg.append(card);
  document.body.append(dlg);
  document.addEventListener('keydown', onKey);

  const say = (t) => { status.textContent = t; };
  let current = null; // { blob, filename }

  const showPreview = (blob) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);
    const img = el('img', { src: previewUrl, alt: kind === 'loop' ? 'Preview of the loop' : 'Preview of the image' });
    preview.replaceChildren(img);
  };
  const stamp = () => new Date().toISOString().slice(0, 10);
  const doDeliver = async () => {
    try {
      const out = await deliver(current.blob, current.filename);
      say(SAYS[out] || '');
    } catch (e) {
      say(e && e.code === 'too_large' ? 'That file is too large to save here. Try the image instead.' : 'Could not save that file.');
    }
  };
  const afterMake = (blob, filename) => {
    current = { blob, filename };
    showPreview(blob);
    actions.replaceChildren(btn('Save', doDeliver, 'share-primary'));
    if (blob.type === 'image/png' && canCopyImage()) {
      actions.append(btn('Copy image', async (ev) => {
        const ok = await copyImage(blob);
        if (ok) say('Image copied.'); else { ev.target.remove(); say('Copying images is not available here.'); }
      }));
    }
    actions.append(btn('Copy link', async () => { say((await copyLink()) ? 'Link copied.' : 'Could not copy. Link: ' + (await linkText())); }));
  };

  if (kind === 'link') {
    const input = el('input', { class: 'share-headline', type: 'text', readonly: '', 'aria-label': 'Link' });
    linkText().then((t) => { if (input.isConnected) input.value = t; });
    card.insertBefore(input, preview);
    actions.append(btn('Copy link', async () => { say((await copyLink()) ? 'Link copied.' : 'Select the link above and copy it.'); }, 'share-primary'));
    return dlg;
  }
  if (kind === 'still') {
    actions.append(btn('Make image', async (ev) => {
      ev.target.disabled = true; say('Drawing…');
      try {
        const blob = await exportStill({ headline: headlineInput.value });
        say(''); afterMake(blob, `weather-story-${stamp()}.png`);
      } catch { say('Could not draw the image.'); ev.target.disabled = false; }
    }, 'share-primary'));
    actions.firstChild.click();
  } else {
    const make = btn('Make loop', async (ev) => {
      ev.target.disabled = true; bar.hidden = false; say('Encoding…');
      ctl = new AbortController();
      const cancel = btn('Cancel', () => ctl?.abort());
      actions.append(cancel);
      try {
        const blob = await exportLoop({ onProgress: (f) => { bar.value = f; }, signal: ctl.signal });
        bar.hidden = true; say(''); afterMake(blob, `weather-story-${stamp()}.gif`);
      } catch (e) {
        bar.hidden = true;
        say(e && e.name === 'AbortError' ? 'Cancelled.' : 'Could not make the loop.');
        actions.replaceChildren(make); make.disabled = false;
      }
    }, 'share-primary');
    actions.append(make);
  }
  return dlg;
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
