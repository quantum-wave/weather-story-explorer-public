// Focus: which place the map and the sheet are about. Sets store.focus, tweens the clock, re-centres the map,
// and draws the "you are here" ring (2 px, city name, never a person's name).

export const cityLabel = (c) => {
  if (!c) return '';
  const tail = c.admin && (c.cc === 'US' || c.cc === 'CA' || !c.cc) ? c.admin : c.cc || '';
  return tail ? `${c.name}, ${tail}` : c.name;
};

/** The renderer draws the ring; this adds the city name beside it (also in exports through renderTo overlays). */
export function focusLabelOverlay(ctx, project, state) {
  const f = state.focus;
  if (!f || !f.label) return;
  const p = project([f.lon, f.lat]);
  if (!p) return;
  const k = state.dpr && state.dpr > 1 && ctx.getTransform().a === 1 ? state.dpr : 1;
  const light = state.theme === 'light';
  ctx.save();
  ctx.font = `600 ${13 * k}px -apple-system, "SF Pro Text", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = 4 * k;
  ctx.strokeStyle = light ? 'rgba(249,246,242,.9)' : 'rgba(12,16,20,.85)';
  ctx.strokeText(f.label, p[0] + 17 * k, p[1]);
  ctx.fillStyle = light ? '#1C2024' : '#F4F1EA';
  ctx.fillText(f.label, p[0] + 17 * k, p[1]);
  ctx.restore();
}

/** "Maya · Portland, OR", or just the place when the title says the same thing ("Lisbon" and "Lisbon, PT"). */
export function joinKicker(title, label) {
  const t = String(title || '').trim(), l = String(label || '').trim();
  if (!t) return l;
  if (!l) return t;
  const norm = (x) => x.toLowerCase().replace(/\s+/g, ' ');
  if (norm(l) === norm(t) || norm(l).startsWith(norm(t) + ',')) return l;
  return `${t} · ${l}`;
}

/**
 * The row's reason phrase. It is written by story/phrases.js (reasonPhrase: "Rain likely from Sunday", "Under a trough
 * from Sun 1 Jan") and shown as it is; nothing here rewrites it, and nothing lives only in a tooltip (UX-9).
 */
export function reasonTag(reason) {
  return { text: reason || '', title: '' };
}
