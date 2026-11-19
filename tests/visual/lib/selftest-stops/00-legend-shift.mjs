// Self-test stop (W1-01): a small page with a legend above a timeline. With WSE_SELFTEST_SHIFT=1 the run moves the legend 40 px down
// over the timeline, which must fail layout assertion 1 and exceed the pixel-diff tolerance against the unshifted baseline.
const PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#0c1014;color:#e6e9ed;font:14px/18px system-ui,sans-serif}
#map{position:absolute;inset:0 0 96px 0;background:linear-gradient(135deg,#1f4e79,#0c1014 55%,#b8741a)}
#legend{position:absolute;left:16px;bottom:112px;width:300px;padding:8px 12px;background:#12171c;border-radius:8px}
#legend p{margin:0 0 4px}
#timeline{position:absolute;left:0;right:0;bottom:0;height:96px;background:#161c22;border-top:1px solid #2a323a}
#timeline .row{display:flex;gap:8px;padding:8px 16px}
#timeline button{width:100px;height:44px;border:1px solid #3a444e;border-radius:8px;background:#1d242b;color:inherit;font:inherit}
#timeline .days{padding:0 16px;display:flex;justify-content:space-between}</style>
<div id=map></div>
<div id=legend><p>500 hPa height vs normal</p><p>Blue: lower, Amber: higher</p><p>Sample data</p></div>
<div id=timeline><div class=row><button type=button>Play</button><button type=button>Step</button><button type=button>Speed</button></div><div class=days><span>Mon</span><span>Tue</span><span>Wed</span></div></div>`;

export default {
  id: '00-legend-shift',
  owner: 'W1-01',
  gate: true,
  viewports: ['phone', 'desktop'],
  url: 'data:text/html;charset=utf-8,' + encodeURIComponent(PAGE),
  async run(page) {
    if (process.env.WSE_SELFTEST_SHIFT !== '1') return;
    await page.eval(`(() => { const l = document.getElementById('legend'), t = document.getElementById('timeline');
      const dy = t.getBoundingClientRect().top - l.getBoundingClientRect().bottom + 40; l.style.transform = 'translateY(' + dy + 'px)'; })()`);
  },
};
