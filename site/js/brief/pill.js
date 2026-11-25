// The Briefing's entry pill (C1-03): one text button that opens the briefing. No data, no store, no player: the wiring sets its words.
// mountPill(root, {onOpen}) -> {set({text, isNew, inert}), destroy()}. DOM: button#brief-pill; with isNew the word "New" leads the text.

function ensureCss() {
  if (document.getElementById('wse-brief-css')) return;
  const link = document.createElement('link');
  link.id = 'wse-brief-css'; link.rel = 'stylesheet'; link.href = new URL('../../css/brief.css', import.meta.url).href;
  document.head.append(link);
}

export function mountPill(root, { onOpen } = {}) {
  ensureCss();
  const el = document.createElement('button');
  el.type = 'button'; el.id = 'brief-pill'; el.className = 'brief-pill';
  const mark = document.createElement('span'); mark.className = 'brief-pill-mark'; mark.setAttribute('aria-hidden', 'true');
  const isNewEl = document.createElement('span'); isNewEl.className = 'brief-pill-new'; isNewEl.textContent = 'New ';
  const text = document.createElement('span'); text.className = 'brief-pill-text';
  el.append(mark, text);
  const click = () => { if (!el.disabled && onOpen) onOpen(); };
  el.addEventListener('click', click);
  root.append(el);
  return {
    set({ text: t = '', isNew = false, inert = false } = {}) {
      text.textContent = t;
      if (isNew) text.before(isNewEl); else isNewEl.remove(); // not in the DOM unless new, so the accessible name never carries a hidden word
      el.dataset.new = isNew ? 'true' : 'false';
      el.disabled = !!inert;
    },
    destroy() { el.removeEventListener('click', click); el.remove(); },
  };
}
