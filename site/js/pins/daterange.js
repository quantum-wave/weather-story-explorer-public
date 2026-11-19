// A date range that edits a draft (spec 8.3, UX-3). The two native date inputs write only to the draft they were typed
// into; nothing here touches the pin store, and no code path assigns .value on the input the person is editing.
// Validation is shown, never applied: an end before the start marks To invalid and changes neither date.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MSG_INVERTED = 'Ends before it starts';
export const MSG_INCOMPLETE = 'Choose both dates';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** UTC ms of a complete, real ISO date, else null. */
function utc(s) {
  const m = ISO.exec(s || '');
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(t);
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t : null;
}
const short = (t) => { const d = new Date(t); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };

/**
 * The draft. `start` and `end` hold whatever the inputs last reported (an ISO date, or '' while a date is partial).
 * @param {{start?:string, end?:string}} [init]
 */
export function createDraft({ start = '', end = '' } = {}) {
  const orig = { start, end };
  const cur = { start, end };
  return {
    /** Update one field only. Unknown fields are ignored. */
    set(field, value) { if (field === 'start' || field === 'end') cur[field] = typeof value === 'string' ? value : ''; return this; },
    value() { return { start: cur.start, end: cur.end }; },
    valid() {
      const a = utc(cur.start), b = utc(cur.end);
      if (a === null || b === null) return { ok: false, message: MSG_INCOMPLETE };
      if (b < a) return { ok: false, message: MSG_INVERTED };
      return { ok: true, message: '' };
    },
    dirty() { return cur.start !== orig.start || cur.end !== orig.end; },
    /** "Fri 27 Nov → Mon 30 Nov · 4 days", the error message, or the incomplete prompt. */
    summary() {
      const v = this.valid();
      if (!v.ok) return v.message;
      const a = utc(cur.start), b = utc(cur.end), n = Math.round((b - a) / 864e5) + 1;
      return `${short(a)} → ${short(b)} · ${n} ${n === 1 ? 'day' : 'days'}`;
    },
  };
}

let cssLink = null;
function ensureStyles(doc) {
  if (cssLink || !doc.head || typeof URL === 'undefined') return;
  cssLink = doc.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = new URL('../../css/daterange.css', import.meta.url).href;
  doc.head.append(cssLink);
}

let seq = 0;
/**
 * Mount two labelled native date inputs and a summary line into `root`.
 * @param {HTMLElement} root
 * @param {ReturnType<typeof createDraft>} draft
 * @param {{labels?:{from?:string,to?:string}, onChange?:(state:{value:object, valid:object})=>void}} [o]
 * @returns {{el:HTMLElement, from:HTMLInputElement, to:HTMLInputElement, summary:HTMLElement, refresh:Function, destroy:Function}}
 */
export function mountDateRange(root, draft, { labels = {}, onChange } = {}) {
  const doc = root.ownerDocument || document;
  ensureStyles(doc);
  const id = 'dr' + (++seq);
  const mk = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const init = draft.value();
  const field = (which, text, v) => {
    const label = mk('label', 'dr-field');
    label.append(mk('span', 'dr-label', text));
    const input = mk('input', 'dr-input');
    input.setAttribute('type', 'date');
    input.setAttribute('name', which);
    if (v) input.value = v; // initial value, before the input can be focused
    label.append(input);
    return { label, input };
  };
  const f = field('from', labels.from || 'From', init.start);
  const t = field('to', labels.to || 'To', init.end);
  const sum = mk('p', 'dr-summary');
  sum.id = id + '-s';
  sum.setAttribute('role', 'status');
  sum.setAttribute('aria-live', 'polite');
  const row = mk('div', 'dr-row');
  row.append(f.label, t.label);
  const el = mk('div', 'dr');
  el.append(row, sum);
  root.append(el);

  const paint = () => {
    const v = draft.valid(), cur = draft.value();
    sum.textContent = draft.summary();
    const inverted = !v.ok && v.message === MSG_INVERTED;
    sum.classList.toggle('dr-bad', inverted);
    const has = (a) => t.input.getAttribute(a) !== null;
    if (inverted) { if (!has('aria-invalid')) { t.input.setAttribute('aria-invalid', 'true'); t.input.setAttribute('aria-describedby', sum.id); } }
    else if (has('aria-invalid')) { t.input.removeAttribute('aria-invalid'); t.input.removeAttribute('aria-describedby'); }
    // Touch an attribute only when it changes: re-setting min or aria-* on a date input mid-edit resets its segments.
    const min = utc(cur.start) !== null ? cur.start : null;
    if (min !== null) { if (t.input.getAttribute('min') !== min) t.input.setAttribute('min', min); }
    else if (t.input.getAttribute('min') !== null) t.input.removeAttribute('min');
  };
  const notify = () => { paint(); onChange?.({ value: draft.value(), valid: draft.valid() }); };
  const onFrom = () => { draft.set('start', f.input.value); notify(); };
  const onTo = () => { draft.set('end', t.input.value); notify(); };
  for (const ev of ['input', 'change']) { f.input.addEventListener(ev, onFrom); t.input.addEventListener(ev, onTo); }
  paint();

  return {
    el, from: f.input, to: t.input, summary: sum,
    /** Pull an externally changed draft into the inputs. Never rewrites the input that has focus. */
    refresh() {
      const v = draft.value();
      for (const [inp, val] of [[f.input, v.start], [t.input, v.end]]) {
        if (doc.activeElement === inp || inp.value === val) continue;
        inp.value = val;
      }
      paint();
    },
    destroy() { el.remove?.(); },
  };
}
