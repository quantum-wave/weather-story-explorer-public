// A page clock moved to a chosen time: install with Page.addScriptToEvaluateOnNewDocument before the page loads. Date.now(),
// new Date() and Date() read the chosen time plus the real time gone since; Date(...) with arguments, Date.parse, Date.UTC,
// performance.now() and timers are untouched. Pair it with makeLiveLike(dir, src, { now }) so the run is the one live at that time.
export function fakeClockScript(nowMs) {
  return `(() => {
    const R = Date, shift = ${Number(nowMs)} - R.now();
    const now = () => R.now() + shift;
    window.Date = new Proxy(R, {
      construct: (t, a, nt) => Reflect.construct(t, a.length ? a : [now()], nt),
      apply: () => new R(now()).toString(),
      get: (t, k, r) => (k === 'now' ? now : Reflect.get(t, k, r)),
    });
  })();`;
}

/** Epoch ms of today's UTC date (the real clock's) at `h` hours UTC: a time of day that recurs whenever the check runs. */
export const todayAtUTC = (h, real = Date.now()) => Math.floor(real / 86400e3) * 86400e3 + h * 3600e3;
