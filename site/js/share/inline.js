// Last-resort delivery: show the image on the page so the viewer can press and hold to save it.
let host = null;
export function showInline(blob, filename) {
  const url = URL.createObjectURL(blob);
  if (host) host.remove();
  host = document.createElement('div');
  host.className = 'share-inline';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-label', 'Your image');
  const img = document.createElement('img');
  img.src = url; img.alt = filename || 'Shared weather image';
  const msg = document.createElement('p');
  msg.textContent = 'Press and hold the image to save it.';
  const close = document.createElement('button');
  close.type = 'button'; close.className = 'share-btn'; close.textContent = 'Close';
  close.addEventListener('click', () => { host.remove(); host = null; URL.revokeObjectURL(url); });
  host.append(msg, img, close);
  document.body.append(host);
  return host;
}
