// Delivery per host (SPEC section 7): the artifact `downloads` capability, else inline on the artifact,
// else Web Share, else <a download>. Returns 'saved' | 'shared' | 'downloaded' | 'inline' | 'declined'.
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

export async function deliver(blob, filename) {
  const downloads = await resolveDownloads();
  if (downloads) {
    try {
      const r = await downloads.save({ filename, data: blob });
      void r; return 'saved';
    } catch (e) {
      const code = e && e.code;
      if (code === 'declined') return 'declined';
      if (!UNUSABLE.has(code) && code !== undefined) throw e; // too_large, rate_limited, bad_request: the caller explains
    }
  }
  if (onArtifact()) { showInline(blob, filename); return 'inline'; }
  const file = typeof File === 'function' ? new File([blob], filename, { type: blob.type }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'declined'; /* else fall through to a download */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
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
