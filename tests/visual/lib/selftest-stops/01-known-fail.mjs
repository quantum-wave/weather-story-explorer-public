// Self-test stop (W1-01): always overlaps, but gate:false, so the run still passes; the sheet must show it as a known failure.
const PAGE = `<!doctype html><meta charset=utf-8><body style="margin:0;background:#fff;color:#111;font:16px system-ui">
<p style="position:absolute;left:20px;top:40px;margin:0">First line of text</p><p style="position:absolute;left:30px;top:44px;margin:0">Second line over it</p>`;
export default { id: '01-known-fail', owner: 'W1-01', gate: false, mvpFails: [1], mvpReason: 'selftest: two lines of text overlap on purpose', viewports: ['desktop'], url: 'data:text/html;charset=utf-8,' + encodeURIComponent(PAGE), async run() {} };
