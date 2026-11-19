// Header: run label and age, the amber sample badge, theme and share buttons.
import { icon, clear } from './dom.js';
import { prefs } from './prefs.js';
import { runLabel, ageHours, isStale } from './format.js';

/** Real start of a sample case, '1 Jan 2017 00Z' (never the rebased run time). */
export function caseStartLabel(manifest, caseId) {
  for (const f of manifest?.cases?.[caseId]?.fields || []) {
    const v = manifest.fields?.[f]?.source?.valid?.[0];
    if (v) { const d = runLabel(v), y = new Date(String(v).replace(/Z$/, ':00Z').replace(/(:\d\d):00Z$/, '$1Z')).getUTCFullYear(); return d.replace(/ (\d\dZ)$/, ` ${y} $1`); }
  }
  return '';
}

export const THEME_COLOR = { dark: '#0C1014', light: '#F9F6F2' };

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
}

/** The badge sentence of SPEC section 11. */
export function sampleBadgeText(manifest, caseId) {
  const label = manifest?.cases?.[caseId]?.label || '';
  return label ? `Sample data · ${label} · not a forecast` : 'Sample data · not a forecast';
}

export function mountHeader({ store, bus }) {
  const top = document.getElementById('topbar');
  const runEl = document.getElementById('run-label');
  const badge = document.getElementById('sample-badge');
  const themeBtn = document.getElementById('btn-theme');
  const shareBtn = document.getElementById('btn-share'); // WP6 opens the share sheet from data-share
  let manifest = null;

  function paint() {
    const s = store.get();
    if (!manifest) { runEl.textContent = ''; badge.hidden = true; return; }
    if (manifest.sample) {
      const t = sampleBadgeText(manifest, s.case);
      badge.textContent = t; badge.title = t; badge.hidden = false;
      runEl.textContent = `Sample · ${caseStartLabel(manifest, s.case) || 'past data'}`;
      runEl.classList.remove('stale');
    } else {
      badge.hidden = true;
      const age = ageHours(manifest.run);
      const stale = isStale(age);
      runEl.textContent = stale ? `Forecast from ${age} h ago` : `Run ${runLabel(manifest.run)} · ${age} h ago`;
      runEl.classList.toggle('stale', stale);
    }
    top.classList.toggle('has-badge', !badge.hidden);
    const dark = s.theme === 'dark';
    clear(themeBtn).append(icon(dark ? 'sun' : 'moon'));
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  }

  clear(shareBtn).append(icon('share'));
  themeBtn.addEventListener('click', () => {
    const theme = store.get().theme === 'dark' ? 'light' : 'dark';
    prefs.set('theme', theme);
    store.set({ theme });
  });

  store.subscribe((s, p) => { if ('theme' in p) applyTheme(s.theme); if ('theme' in p || 'case' in p) paint(); });
  applyTheme(store.get().theme);
  paint();
  return { setManifest(m) { manifest = m; paint(); }, paint };
}
