// Tour stop 61: The Briefing in the real app, one screenshot per chapter, advanced with Next (the tour emulates reduced motion, so the
// first beat opens paused and nothing moves without a press). Night first, then Paper (the theme is switched from the Display menu
// before the second pass: while a briefing is open the map tools and the header are out of reach by design). Phone and desktop.
// Seeded with two people and one trip, through the same calls the app's own add flow makes. Names are synthetic.
export default {
  id: '61-brief-flow',
  owner: 'C1-04',
  gate: false,
  mvpFails: [],
  mvpReason: 'the briefing lies over the chart by design (the map canvas, the tap layer and the card are one stack); the contact sheet is for a human to look at',
  viewports: ['phone', 'desktop'],
  data: 'synthetic-15d',
  // the map and the tap layer lie under every control by design; the card lies over the chart; the strip's day columns are not pressable here
  // the collapsed phone legend's toggle row is 36 px and "What is this?" 28 px high by design (DESIGN-SPEC 5.1; stops 07 and 24 list the same); under a briefing the legend takes no press
  allowTarget: ['#map-legend .mlg-toggle', '#map-legend .mlg-what'],
  allowOverlap: [['#map', '*'], ['#brief-taps', '*'], ['#stage', '*'], ['#brief-card', '#map-legend'], ['rect.strip-day', 'svg.strip text']],
  async run(page, inp, { snap }) {
    await page.waitFor('window.__wse && __wse.ready && __wse.storyReady', { timeout: 60000 });
    await page.eval(`(() => { const c = __wse.pins.home();
      __wse.pins.add({ kind: 'person', name: 'Maya', city: { ...c, id: 5746545, name: 'Portland', lat: 45.52, lon: -122.68, admin: 'OR', cc: 'US' } });
      __wse.pins.add({ kind: 'person', name: 'Theo', city: { ...c, id: 5809844, name: 'Seattle', lat: 47.61, lon: -122.33, admin: 'WA', cc: 'US' } });
      const cov = __wse.ui.home.stories.get('home').days.coverage, add = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
      __wse.pins.addTrip({ label: 'Lake weekend', city: __wse.pins.home(), start: add(cov.firstDate, 3), end: add(cov.firstDate, 5) }); })()`);
    await page.waitFor('!!window.__wse.ui.brief', { timeout: 20000 });
    await inp.wait(500);
    const pass = async (name) => {
      await snap(`${name}-pill`);
      await inp.activate('#brief-pill');
      await page.waitFor(`!!document.getElementById('brief-card') && __wse.ui.brief.player() && ['paused', 'playing'].includes(__wse.ui.brief.player().state())`, { timeout: 30000 });
      const n = await page.eval('__wse.ui.brief.script().beats.length');
      for (let i = 0; i < n; i++) {
        if (i) { await inp.activate('#brief-card [data-act="next"]'); await page.waitFor(`__wse.ui.brief.player().index() === ${i}`, { timeout: 15000 }); }
        await inp.wait(900); // the camera glide lands (the tour's reduced motion cuts it, but the chart repaints a frame or two later)
        const id = await page.eval('__wse.ui.brief.player().beat().id');
        await snap(`${name}-${String(i + 1).padStart(2, '0')}-${id}`);
      }
      await inp.key(null, 'Escape');
      await page.waitFor(`!document.getElementById('app').hasAttribute('data-brief')`, { timeout: 8000 });
      await inp.wait(700);
    };
    await pass('night');
    await inp.activate(inp.phone ? '#btn-more' : '#btn-display');
    await page.waitFor(`!document.getElementById('display-menu').hidden`, { timeout: 5000 });
    await inp.activate('#display-menu [data-group="theme"] button[data-value="light"]');
    await page.waitFor(`document.documentElement.dataset.theme === 'light'`, { timeout: 5000 });
    await inp.key(null, 'Escape');
    await page.waitFor(`document.getElementById('display-menu').hidden`, { timeout: 5000 });
    await inp.wait(500);
    await pass('paper');
  },
};
