// Helpers for WP2 checks: decode a Chrome PNG screenshot, measure pixels, mount a renderer canvas in the page.
import zlib from 'node:zlib';
import fs from 'node:fs';

/** Decode an 8-bit, non-interlaced RGB/RGBA PNG. Returns {w, h, ch, px: Uint8Array}. */
export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); ct = body[9]; if (body[8] !== 8 || body[12] !== 0) throw new Error('unsupported PNG'); }
    else if (type === 'IDAT') idat.push(body);
    off += 12 + len;
  }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!ch) throw new Error('unsupported colour type ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i], a = i >= ch ? px[dst + i - ch] : 0, b = y ? px[dst - stride + i] : 0, c = i >= ch && y ? px[dst - stride + i - ch] : 0;
      let v;
      if (f === 0) v = x; else if (f === 1) v = x + a; else if (f === 2) v = x + b; else if (f === 3) v = x + ((a + b) >> 1);
      else { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      px[dst + i] = v & 255;
    }
  }
  return { w, h, ch, px };
}
export const pixel = (img, x, y) => { const i = (y * img.w + x) * img.ch; return [img.px[i], img.px[i + 1], img.px[i + 2]]; };

/** Statistics over a rectangle [x0,x1) x [y0,y1): share of pixels that differ from `bg`, share tinted blue/amber, luminance spread. */
export function stats(img, [x0, y0, x1, y1], bg) {
  let n = 0, off = 0, blue = 0, amber = 0, sum = 0, sum2 = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const [r, g, b] = pixel(img, x, y), l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    n++; sum += l; sum2 += l * l;
    if (Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > 12) off++;
    if (b - r > 22 && b >= g) blue++;
    if (r - b > 22 && r >= g) amber++;
  }
  const mean = sum / n;
  return { n, offBg: off / n, blue: blue / n, amber: amber / n, tinted: (blue + amber) / n, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
}

/** Mean colour of the outermost ring of pixels versus the ring 4 px inside. */
export function edgeRingDiff(img) {
  const ring = (d) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let x = d; x < img.w - d; x++) for (const y of [d, img.h - 1 - d]) { const p = pixel(img, x, y); r += p[0]; g += p[1]; b += p[2]; n++; }
    for (let y = d; y < img.h - d; y++) for (const x of [d, img.w - 1 - d]) { const p = pixel(img, x, y); r += p[0]; g += p[1]; b += p[2]; n++; }
    return [r / n, g / n, b / n];
  };
  const a = ring(0), c = ring(4);
  return Math.max(Math.abs(a[0] - c[0]), Math.abs(a[1] - c[1]), Math.abs(a[2] - c[2]));
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Put a full-viewport renderer canvas on the page; exposes window.__wp2 = {store, data, renderer, canvas, basemap}. */
export async function mount(page, { width, height, dpr = 1 }) {
  await page.setViewport(width, height, dpr);
  await page.eval(`(async () => {
    const [{ store }, { createRenderer }, data, basemap] = await Promise.all([import('/js/state.js'), import('/js/render/index.js'), import('/js/data/index.js'), import('/js/render/basemap.js')]);
    try { (await import('/js/time/clock.js')).pause(); } catch { /* the clock is another package's: pause it if it exists */ }
    store.set({ playing: false });
    window.__wp2?.renderer.destroy();
    document.getElementById('wp2cv')?.remove();
    const canvas = document.createElement('canvas');
    canvas.id = 'wp2cv';
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;display:block';
    document.body.appendChild(canvas);
    window.__wp2 = { store, data, basemap, canvas, renderer: createRenderer(canvas) };
    return true;
  })()`);
  await page.waitFor('window.__wp2.basemap.basemapReady()', { timeout: 10000 });
}

/** Set state, load the data it needs, wait out the first-frame fade, draw, and return a decoded screenshot. */
export async function shoot(page, patch, name = '') {
  await page.eval(`(async () => { const w = window.__wp2; w.store.set(${JSON.stringify(patch)}); await w.renderer.ensureFor({}); })()`);
  await sleep(450);
  // The first-field fade starts when a frame first draws a field. Under load the animation-frame draw may not have
  // run yet, so that first draw can be the synchronous one below: draw, wait out the 300 ms fade, draw again.
  await page.eval('window.__wp2.renderer.draw()');
  await sleep(400);
  await page.eval('window.__wp2.renderer.draw()');
  const png = await page.screenshot();
  if (name && process.env.WSE_SHOT_DIR) fs.writeFileSync(`${process.env.WSE_SHOT_DIR}/${name}.png`, png); // set WSE_SHOT_DIR to look at the pictures
  return decodePNG(png);
}

/** Mean colour chroma (max channel minus min channel) over the pixels in the rectangle that are tinted blue or amber. */
export function meanChroma(img, [x0, y0, x1, y1]) {
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const [r, g, b] = pixel(img, x, y);
    if ((b - r > 22 && b >= g) || (r - b > 22 && r >= g)) { sum += Math.max(r, g, b) - Math.min(r, g, b); n++; }
  }
  return n ? sum / n : 0;
}
/** Share of pixels with a purple/magenta cast (the jet ramp) in the rectangle. */
export function purpleShare(img, [x0, y0, x1, y1]) {
  let n = 0, hit = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const [r, g, b] = pixel(img, x, y); n++; if (r - g > 20 && b - g > 20) hit++; }
  return hit / n;
}
