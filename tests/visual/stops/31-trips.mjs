// Tour stop 31: Trips, the four states of spec 3.5 on a 15-day forecast: in detail range, the broad pattern, too far out, and over.
// People and Places beneath it, separate sections. The trips and pins are set up through the pin store (data setup, not the thing
// under test); every interaction after that is a real tap or click.
import { dragSheet, mustBeVisible } from '../lib/steps.mjs';

export default {
  id: '31-trips',
  owner: 'W3-06',
  gate: false,
  mvpFails: [1, 5],
  mvpReason: 'the home panel itself is clean at both sizes; what still fails is the shell W3-04 owns: the 40 px view-switch buttons (phone) and, with the sheet at full, the view switch and Layers button over the scrubber and sheet handle. Set gate: true when W3-04 lands.',
  viewports: ['phone', 'desktop'],
  data: 'synthetic-15d',
  // the strip's tappable columns lie under their own labels by design (a tap on a word is a tap on its day); the map canvas lies under every map control
  allowOverlap: [['rect.strip-day', 'svg.strip text'], ['rect.strip-end', 'svg.strip text'], ['#map', '*']],
  async run(page, inp, { snap }) {
    await page.eval(`(() => {
      const first = __wse.ui.home.stories.get('home').days.coverage.firstDate;
      const day = (n) => new Date(Date.parse(first + 'T12:00:00Z') + (n - 1) * 86400e3).toISOString().slice(0, 10);
      const c = __wse.pins.home();
      __wse.pins.addTrip({ label: 'Tahoe', city: { ...c, id: 5393015, name: 'South Lake Tahoe', lat: 38.94, lon: -119.98, admin: 'CA', cc: 'US' }, start: day(3), end: day(4) });
      __wse.pins.addTrip({ label: 'Lisbon', city: { ...c, id: 2267057, name: 'Lisbon', lat: 38.72, lon: -9.14, admin: '', cc: 'PT' }, start: day(9), end: day(11) });
      __wse.pins.addTrip({ label: 'Maui', city: { ...c, id: 5850027, name: 'Kahului', lat: 20.89, lon: -156.47, admin: 'HI', cc: 'US' }, start: day(20), end: day(24) });
      __wse.pins.addTrip({ label: 'Denver', city: { ...c, id: 5419384, name: 'Denver', lat: 39.74, lon: -104.99, admin: 'CO', cc: 'US' }, start: day(-6), end: day(-4) });
      __wse.pins.add({ kind: 'person', name: 'Maya', city: { ...c, id: 5746545, name: 'Portland', lat: 45.52, lon: -122.68, admin: 'OR', cc: 'US' } });
      __wse.pins.add({ kind: 'place', name: 'Cabin', city: { ...c, id: 5393015, name: 'South Lake Tahoe', lat: 38.94, lon: -119.98, admin: 'CA', cc: 'US' } });
    })()`);
    await inp.wait(1800);
    await dragSheet(page, inp, 'full', -520);
    await mustBeVisible(page, '#sec-trips .card', 'the trip cards');
    await page.eval(`document.getElementById('sec-trips').scrollIntoView({ block: 'start' })`);
    await inp.wait(300);
    await snap('trips');
    await page.eval(`document.getElementById('sec-people').scrollIntoView({ block: 'start' })`);
    await inp.wait(300);
    await snap('people-places');
  },
};
