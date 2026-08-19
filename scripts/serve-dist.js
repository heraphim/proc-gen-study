// Preview dist/ the way GitHub Pages serves it: static files only, directory indexes,
// 404.html as the catch-all, and mounted under whatever base path the build used (read
// back out of the <base> tag). Run `npm run build` first, then `npm run preview`.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(root, 'dist');
const PORT = Number(process.env.PORT ?? 4174);

const index = readFileSync(join(DIST, 'index.html'), 'utf8');
const BASE = index.match(/<base href="([^"]+)">/)?.[1] ?? '/';

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

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (!pathname.startsWith(BASE)) {
    res.writeHead(302, { location: BASE });
    return res.end();
  }

  const rel = normalize(`/${pathname.slice(BASE.length)}`).replace(/^(\.\.[/\\])+/, '');
  const candidate = extname(rel) ? rel : join(rel, 'index.html');

  for (const [file, status] of [[candidate, 200], ['/404.html', 404]]) {
    const abs = join(DIST, file);
    // `continue`, not `break`: a path that escapes dist/ still deserves the 404 page.
    if (!abs.startsWith(DIST + sep)) continue;
    try {
      const body = await readFile(abs);
      res.writeHead(status, { 'content-type': MIME[extname(abs)] ?? 'application/octet-stream' });
      return res.end(body);
    } catch { /* fall through to 404.html */ }
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
}).listen(PORT, () => {
  console.log(`preview of dist/ on http://localhost:${PORT}${BASE}`);
});
