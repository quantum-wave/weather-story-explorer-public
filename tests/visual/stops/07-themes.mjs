// Tour stop 07: dark and light themes, switched from the Display menu (More on the phone) with real taps and clicks (Josh points 4, 6, 7, 14).
// Gated since W3-04.
export default {
  id: '07-themes',
  owner: 'W3-04',
  gate: true,
  // the open menu floats over the chart and panel by design; each strip column's tap target (rect.strip-day) is transparent and spans its whole column, so every label drawn in that column (day, "normal") lies inside it; text against text is still judged
  allowOverlap: [['#map', '*'], ['svg.strip rect.strip-day', 'svg.strip text'], ['#display-menu', '#stage'], ['#display-menu', '#home'], ['#data-popover', '#stage'], ['#data-popover', '#home'], ['#data-popover', '#timeline'], ['#display-menu', '#timeline']],
  // W3-11's collapsed phone legend: its toggle row is 36 px and "What is this?" 28 px high by design (DESIGN-SPEC 5.1, 11.1: one
  // 36 px row; tour stop 24 records the same). Listed so the gate judges this package's controls; the tour prints them every run.
  allowTarget: ['#map-legend .mlg-toggle', '#map-legend .mlg-what'],
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  theme: 'dark',
  async run(page, inp, { snap }) {
    await snap('dark');
    await inp.activate(inp.phone ? '#btn-more' : '#btn-display');
    await page.waitFor(`!document.getElementById('display-menu').hidden`, { timeout: 5000 });
    await inp.activate('#display-menu [data-group="theme"] button[data-value="light"]');
    await page.waitFor(`document.documentElement.dataset.theme === 'light'`, { timeout: 5000 });
    await inp.key(null, 'Escape');
    await page.waitFor(`document.getElementById('display-menu').hidden`, { timeout: 5000 });
  },
};
