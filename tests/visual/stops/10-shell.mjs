// Tour stop 10: the shell (W3-04, Josh points 4, 5, 14): the one-row header with its data chip, the Display menu (More on the phone)
// and the "About this data" popover. Opened by real taps and clicks; each state is one frame.
export default {
  id: '10-shell',
  owner: 'W3-04',
  gate: true,
  // the open menu and popover float over the chart and panel by design; each strip column's tap target (rect.strip-day) is transparent and spans its whole column, so every label drawn in that column (day, "normal") lies inside it; text against text is still judged
  allowOverlap: [['#map', '*'], ['svg.strip rect.strip-day', 'svg.strip text'], ['#display-menu', '#stage'], ['#display-menu', '#home'], ['#data-popover', '#stage'], ['#data-popover', '#home'], ['#data-popover', '#timeline'], ['#display-menu', '#timeline']],
  // W3-11's collapsed phone legend: its toggle row is 36 px and "What is this?" 28 px high by design (DESIGN-SPEC 5.1, 11.1: one
  // 36 px row; tour stop 24 records the same). Listed so the gate judges this package's controls; the tour prints them every run.
  allowTarget: ['#map-legend .mlg-toggle', '#map-legend .mlg-what'],
  viewports: ['phone', 'desktop'],
  data: 'synthetic',
  async run(page, inp, { snap }) {
    await snap('header');
    await inp.activate('#data-chip');
    await page.waitFor(`!document.getElementById('data-popover').hidden`, { timeout: 5000 });
    await snap('about-data');
    await inp.activate('#data-chip');
    await inp.activate(inp.phone ? '#btn-more' : '#btn-display');
    await page.waitFor(`!document.getElementById('display-menu').hidden`, { timeout: 5000 });
    await snap('menu');
    await inp.activate('#display-menu [data-group="chart"] button[data-value="night"]');
    await inp.key(null, 'Escape');
  },
};
