// Chunk decoding (frozen byte format, contract.js): gzip, then per frame a dx-shuffle filter.
// Pure functions: no DOM, usable from Node unit tests.

const GZIP_MAGIC = [0x1f, 0x8b];

/** Inflate a gzip file. Checks the magic; uses DecompressionStream, or vendored fflate where that is missing. */
export async function gunzip(bytes, { forceFflate = false } = {}) {
  if (bytes.length < 2 || bytes[0] !== GZIP_MAGIC[0] || bytes[1] !== GZIP_MAGIC[1]) {
    throw new Error('chunk is not gzip (bad magic)');
  }
  if (!forceFflate && typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const { fflate } = await import('../vendor.js');
  return fflate.gunzipSync(bytes);
}

/**
 * Undo the filter on `nFrames` consecutive frames of ny*nx Int16.
 * "none": little-endian Int16 as they are. "dx-shuffle": per frame, all low bytes then all high bytes
 * (row-major); each row holds column differences (first column raw), so a cumulative sum mod 65536 restores it.
 * Returns one Int16Array per frame (views into one buffer).
 */
export function unfilter(raw, nx, ny, nFrames, filter) {
  const n = nx * ny;
  if (raw.length !== n * 2 * nFrames) {
    throw new Error(`chunk size ${raw.length} != ${nFrames} frames of ${nx}x${ny} Int16`);
  }
  const all = new Int16Array(n * nFrames);
  for (let f = 0; f < nFrames; f++) {
    const out = all.subarray(f * n, (f + 1) * n);
    const base = f * n * 2;
    if (filter === 'dx-shuffle') {
      const lo = base, hi = base + n;
      for (let j = 0; j < ny; j++) {
        let acc = 0;
        const row = j * nx;
        for (let i = 0; i < nx; i++) {
          acc = (acc + (raw[lo + row + i] | (raw[hi + row + i] << 8))) & 0xffff;
          out[row + i] = (acc << 16) >> 16;
        }
      }
    } else if (filter === 'none') {
      for (let k = 0; k < n; k++) out[k] = ((raw[base + 2 * k] | (raw[base + 2 * k + 1] << 8)) << 16) >> 16;
    } else {
      throw new Error('unknown filter ' + filter);
    }
  }
  return Array.from({ length: nFrames }, (_, f) => all.subarray(f * n, (f + 1) * n));
}

/** gzip bytes -> Int16Array frames. */
export async function decodeChunk(bytes, { nx, ny, nFrames, filter }, opts) {
  return unfilter(await gunzip(bytes, opts), nx, ny, nFrames, filter);
}
