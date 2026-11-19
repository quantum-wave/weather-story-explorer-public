// Image diff in a headless page (canvas), per pixel with a small-area tolerance; no npm dependency (spec W1-01 item 4).
// A pixel differs when any channel moves by more than `pixelDelta`. The image is cut into `block` x `block` px cells; a cell
// is "changed" only when it holds at least `minPixels` differing pixels, so isolated anti-aliasing noise is ignored.
// The comparison is over when the changed cells are more than `maxChangedFraction` of all cells (default 0.2 %).
export const DEFAULTS = { pixelDelta: 24, block: 16, minPixels: 12, maxChangedFraction: 0.002 };

/** Runs in the page. a, b are base64 PNGs. Returns { w, h, sizeMismatch, changedBlocks, totalBlocks, differingPixels, diffPng }. */
export async function pageDiff(aB64, bB64, o) {
  const load = (b64) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image failed to decode')); i.src = 'data:image/png;base64,' + b64; });
  const [A, B] = await Promise.all([load(aB64), load(bB64)]);
  if (A.width !== B.width || A.height !== B.height) return { sizeMismatch: true, a: [A.width, A.height], b: [B.width, B.height] };
  const w = A.width, h = A.height;
  const px = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h); };
  const da = px(A), db = px(B), out = new ImageData(w, h);
  const bw = Math.ceil(w / o.block), bh = Math.ceil(h / o.block), cells = new Uint32Array(bw * bh);
  let diffPx = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const d = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2]));
    const gray = (da.data[i] * 0.3 + da.data[i + 1] * 0.59 + da.data[i + 2] * 0.11) * 0.35 + 140 * 0.65 * 0.4;
    if (d > o.pixelDelta) { diffPx++; cells[Math.floor(y / o.block) * bw + Math.floor(x / o.block)]++; out.data[i] = 235; out.data[i + 1] = 40; out.data[i + 2] = 60; }
    else { out.data[i] = out.data[i + 1] = out.data[i + 2] = gray; }
    out.data[i + 3] = 255;
  }
  let changed = 0; for (const c of cells) if (c >= o.minPixels) changed++;
  const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(out, 0, 0);
  return { w, h, sizeMismatch: false, changedBlocks: changed, totalBlocks: bw * bh, differingPixels: diffPx, diffPng: c.toDataURL('image/png').split(',')[1] };
}

/** Node side: compare two PNG Buffers in `page`. Returns { exceeds, changedFraction, ..., diffPng: Buffer|null }. */
export async function compareImages(page, aBuf, bBuf, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const r = await page.eval(`(${pageDiff.toString()})(${JSON.stringify(aBuf.toString('base64'))}, ${JSON.stringify(bBuf.toString('base64'))}, ${JSON.stringify(o)})`);
  if (r.sizeMismatch) return { exceeds: true, sizeMismatch: true, changedFraction: 1, note: `size ${r.a.join('x')} vs ${r.b.join('x')}`, diffPng: null, tolerance: o.maxChangedFraction };
  const changedFraction = r.changedBlocks / r.totalBlocks;
  return { exceeds: changedFraction > o.maxChangedFraction, sizeMismatch: false, changedFraction, changedBlocks: r.changedBlocks, totalBlocks: r.totalBlocks, differingPixels: r.differingPixels, tolerance: o.maxChangedFraction, diffPng: Buffer.from(r.diffPng, 'base64'), note: '' };
}

/** Runs in the page: a JPEG thumbnail (base64) of a PNG, at most maxW px wide. Keeps the contact sheet small. */
export async function pageThumb(b64, maxW, quality) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image failed to decode')); i.src = 'data:image/png;base64,' + b64; });
  const k = Math.min(1, maxW / img.width), c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}
export async function thumbnail(page, buf, maxW = 640, quality = 0.88) {
  return page.eval(`(${pageThumb.toString()})(${JSON.stringify(buf.toString('base64'))}, ${maxW}, ${quality})`);
}
