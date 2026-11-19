// Self-test stop (W1-01): overlaps on purpose (assertion 1) but lists [2, 5] as its MVP failures: a stale list. The run must say so,
// once per stop (the union over both sizes), on the contact sheet and in report.json.
const PAGE = `<!doctype html><meta charset=utf-8><body style="margin:0;background:#fff;color:#111;font:16px system-ui">
<p style="position:absolute;left:20px;top:40px;margin:0">First line of text</p><p style="position:absolute;left:30px;top:44px;margin:0">Second line over it</p>`;
export default { id: '03-stale-mvp', owner: 'W1-01', gate: false, mvpFails: [2, 5], mvpReason: 'selftest: a stale list', viewports: ['phone', 'desktop'], url: 'data:text/html;charset=utf-8,' + encodeURIComponent(PAGE), async run() {} };
