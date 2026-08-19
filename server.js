// Local research server for the procedural generation catalogue.
// No dependencies: node:http + node:sqlite. Start with `npm start`.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { openCatalogue, ROUTES } from './lib/catalogue.js';

const root = join(dirname(fileURLToPath(import.meta.url)));
const PUBLIC = join(root, 'public');
const PORT = Number(process.env.PORT ?? 4173);

const { bootstrap, runQuery, entryCount } = openCatalogue(root);
const routes = new Set(ROUTES);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function serveStatic(res, urlPath) {
  const isAsset = extname(urlPath) !== '';
  const rel = normalize(isAsset ? urlPath : '/index.html').replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + sep)) return send(res, 403, { error: 'forbidden' });

  // Unknown non-asset paths get index.html too, but with a 404 status, so a typo in the
  // address bar is visible to tooling without breaking the page for a human.
  const status = isAsset || routes.has(urlPath) ? 200 : 404;

  try {
    const body = await readFile(file);
    res.writeHead(status, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    send(res, 404, { error: 'not found' });
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    // Same filename the static build writes, so the client fetches one path either way.
    if (url.pathname === '/api/bootstrap.json') return send(res, 200, bootstrap());

    if (url.pathname === '/api/query' && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const { sql } = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      try {
        return send(res, 200, runQuery(sql ?? ''));
      } catch (err) {
        return send(res, 400, { error: err.message });
      }
    }

    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'no such endpoint' });
    return serveStatic(res, url.pathname);
  } catch (err) {
    send(res, 500, { error: err.message });
  }
}).listen(PORT, () => {
  console.log(`catalogue: ${entryCount()} entries`);
  console.log(`listening on http://localhost:${PORT}`);
});
