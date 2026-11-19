// Static server for the site tests: `/` serves site/, `/data/` serves a chosen directory (default: the
// synthetic fixture). Binds 127.0.0.1 on a free port. Serves a stub /config.json when site/ has none.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, '..', '..', '..');
export const SITE_DIR = path.join(REPO, 'site');
export const DEFAULT_DATA = path.join(REPO, 'tests', 'site', 'fixtures', 'synthetic');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.bin': 'application/octet-stream',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain; charset=utf-8',
};

function resolveFile(root, rel) {
  const p = path.resolve(root, '.' + path.sep + rel);
  if (p !== root && !p.startsWith(root + path.sep)) return null; // path traversal
  return p;
}

export function startServer({ dataDir = DEFAULT_DATA, siteDir = SITE_DIR } = {}) {
  const dataRoot = path.resolve(dataDir);
  const siteRoot = path.resolve(siteDir);
  const server = http.createServer((req, res) => {
    let url;
    try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    if (url === '/favicon.ico') { res.writeHead(204).end(); return; }
    let file;
    if (url.startsWith('/data/')) file = resolveFile(dataRoot, url.slice('/data/'.length));
    else file = resolveFile(siteRoot, url === '/' ? 'index.html' : url.slice(1));
    if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } else if (url === '/config.json') {
      res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' }).end('{"canonicalUrl":null}');
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${port}/`,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}
