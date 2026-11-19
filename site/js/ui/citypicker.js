// A small modal that asks for a city (WP5's city picker inside) and resolves with it, or null when dismissed.
import { h } from './dom.js';
import { mountCityPicker } from '../pins/picker.js';

export function openModal(build) {
  const prev = document.activeElement;
  const scrim = h('div', { class: 'modal-scrim' });
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
  scrim.append(modal);
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(scrim);
  build(modal, close);
  return close;
}

export function pickCity({ title = 'Where are you?' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    openModal((modal, close) => {
      const finish = (c) => { if (done) return; done = true; close(); resolve(c); };
      const picker = mountCityPicker({ label: 'City', placeholder: 'Search for your city', onPick: finish });
      modal.append(h('h2', { text: title }), picker.el,
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', text: 'Cancel', onclick: () => finish(null) })));
      setTimeout(() => picker.input.focus(), 30);
      const obs = new MutationObserver(() => { if (!document.body.contains(modal) && !done) { done = true; obs.disconnect(); resolve(null); } });
      obs.observe(document.body, { childList: true });
    });
  });
}
