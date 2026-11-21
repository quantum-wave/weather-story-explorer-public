// Delivery per host (DESIGN-SPEC section 8.5): the artifact `downloads` capability, else the picture shown in the page to press and
// hold (on the artifact), else Web Share, else the picture shown in the page. The app never starts a download itself: no
// <a download>, no blob navigation (both are blocked in the artifact host), and it never says "saved" for what it did not observe.
// Returns 'saved' | 'shared' | 'inline' | 'declined'. With `host` (an element) the inline picture goes into it, else a full-page overlay.
import { showInline } from './inline.js';

let capPromise = null;
/** Resolve the downloads capability once (null off the artifact or when this view cannot run it). */
export function resolveDownloads() {
  if (!capPromise) {
    const c = globalThis.claude;
    capPromise = c && typeof c.use === 'function' ? Promise.resolve(c.use('downloads')).catch(() => null) : Promise.resolve(null);
  }
  return capPromise;
}
export const onArtifact = () => !!(globalThis.claude && typeof globalThis.claude.use === 'function');
/** Test hook: forget the memoised capability. */
export function _resetDeliver() { capPromise = null; }

const UNUSABLE = new Set(['unavailable', 'not_granted', 'capability_disabled', 'capability_removed', 'extension_not_enabled']);

export async function deliver(blob, filename, { host = null } = {}) {
  const downloads = await resolveDownloads();
  if (downloads) {
    try {
      await downloads.save({ filename, data: blob });
      return 'saved';
    } catch (e) {
      const code = e && e.code;
      if (code === 'declined') return 'declined';
      if (!UNUSABLE.has(code) && code !== undefined) throw e; // too_large, rate_limited, bad_request: the caller explains
    }
  }
  if (!onArtifact()) {
    const file = typeof File === 'function' ? new File([blob], filename, { type: blob.type }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return 'shared'; }
      catch (e) { if (e && e.name === 'AbortError') return 'declined'; /* else show it in the page */ }
    }
  }
  showInline(blob, filename, host);
  return 'inline';
}

/** Best-effort: copy a PNG to the clipboard. Resolves true on success, false when unsupported or refused. */
export async function copyImage(blob) {
  try {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false;
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch { return false; }
}
export const canCopyImage = () => typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;
