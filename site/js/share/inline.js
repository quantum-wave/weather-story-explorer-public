// Last-resort delivery: show the file in the page so the viewer can press and hold, or right-click, to save it (an image), or
// select and copy it (text). No download is started and no blob URL is navigated to: the blob is only an <img> source.
let overlay = null;
/** Show `blob` in `host` (an element; its content is replaced) or, without one, in a full-page overlay with a Close button. */
export function showInline(blob, filename, host = null) {
  const own = !host;
  let url = null;
  const release = () => { if (url) { URL.revokeObjectURL(url); url = null; } };
  const body = document.createElement('div');
  body.className = 'share-inline-body';
  const msg = document.createElement('p');
  msg.className = 'share-inline-msg';
  if (/^image\//.test(blob.type || '')) {
    url = URL.createObjectURL(blob);
    const img = document.createElement('img');
    img.src = url; img.alt = filename || 'Shared weather image';
    msg.textContent = 'Press and hold, or right-click, the image to save it.';
    body.append(msg, img);
  } else {
    const ta = document.createElement('textarea');
    ta.className = 'share-inline-text'; ta.readOnly = true; ta.setAttribute('aria-label', filename || 'File contents');
    msg.textContent = 'Select the text and copy it.';
    body.append(msg, ta);
    blob.text().then((t) => { ta.value = t; ta.focus(); ta.select(); }, () => { msg.textContent = 'Could not show this file.'; });
  }
  if (!own) { host.replaceChildren(body); host._release = release; return host; }
  if (overlay) { overlay.remove(); overlay._release?.(); }
  overlay = document.createElement('div');
  overlay.className = 'share-inline';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Your file');
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'share-btn'; close.textContent = 'Close';
  const host2 = overlay;
  close.addEventListener('click', () => { host2.remove(); release(); if (overlay === host2) overlay = null; });
  overlay.append(body, close);
  document.body.append(overlay);
  return overlay;
}
