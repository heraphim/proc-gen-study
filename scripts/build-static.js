// Build the published (static) catalogue into dist/.
//
// GitHub Pages serves files, not Node, so the two API endpoints are handled like this:
//   /api/bootstrap.json  frozen to a file — the whole payload the client reads at start-up
//   /api/query           dropped, along with the SQL tab; it needs a live database
//
// Each client-side route also gets its own copy of the shell, so a deep link is a real
// 200 rather than a redirect, plus 404.html as the catch-all for anything else.
//
// Usage: node scripts/build-static.js [--base=/repo/]   (or BASE_PATH=/repo/)

import { mkdir, rm, cp, copyFile, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openCatalogue, ROUTES, SERVER_ONLY_ROUTES } from '../lib/catalogue.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(root, 'public');
const DIST = join(root, 'dist');

/** Where the site will be mounted. `/` for a user site, `/<repo>/` for a project site. */
function basePath() {
  const arg = process.argv.find(a => a.startsWith('--base='))?.slice('--base='.length);
  const raw = (arg ?? process.env.BASE_PATH ?? '/').trim();
  if (!raw || raw === '/') return '/';
  return `/${raw.replace(/^\/+|\/+$/g, '')}/`;
}

/** Drop what only a server can serve: the SQL tab and its view. */
function stripSqlConsole(html) {
  const cuts = [
    [/[ \t]*<button data-view="sql">[\s\S]*?<\/button>\r?\n/, 'the SQL tab'],
    [/[ \t]*<section class="view" id="view-sql">[\s\S]*?<\/section>\r?\n/, 'the SQL view'],
  ];
  for (const [pattern, what] of cuts) {
    if (!pattern.test(html)) throw new Error(`could not find ${what} in index.html`);
    html = html.replace(pattern, '');
  }
  return html;
}

/* Every copy of the shell needs the base tag, including at base `/`. Each route is served
   from a directory of its own — /algorithms/ — so `href="style.css"` in the copy written
   there resolves to /algorithms/style.css, and app.js reads its own mount point off
   document.baseURI, so it would look for /algorithms/api/bootstrap.json to match. Skipping
   the tag at `/` left the site working only when published under a repo path. */
const shellFor = (html, base) =>
  html.replace('<head>', `<head>\n<base href="${base}">`);

async function main() {
  if (!existsSync(join(root, 'data', 'catalogue.db'))) {
    throw new Error('data/catalogue.db is missing — run `npm run migrate` first');
  }

  const base = basePath();
  const { bootstrap, entryCount } = openCatalogue(root);

  await rm(DIST, { recursive: true, force: true });
  await mkdir(join(DIST, 'api'), { recursive: true });

  // Assets, verbatim — subdirectories included. index.html is handled separately, below.
  for (const ent of await readdir(PUBLIC, { withFileTypes: true })) {
    if (ent.name === 'index.html') continue;
    if (ent.isDirectory()) await cp(join(PUBLIC, ent.name), join(DIST, ent.name), { recursive: true });
    else await copyFile(join(PUBLIC, ent.name), join(DIST, ent.name));
  }

  await writeFile(join(DIST, 'api', 'bootstrap.json'), JSON.stringify(bootstrap()));

  const shell = shellFor(stripSqlConsole(await readFile(join(PUBLIC, 'index.html'), 'utf8')), base);
  await writeFile(join(DIST, 'index.html'), shell);
  await writeFile(join(DIST, '404.html'), shell);

  const published = ROUTES.filter(r => r !== '/' && !SERVER_ONLY_ROUTES.includes(r));
  for (const route of published) {
    await mkdir(join(DIST, route.slice(1)), { recursive: true });
    await writeFile(join(DIST, route.slice(1), 'index.html'), shell);
  }

  // Pages runs Jekyll over the artifact otherwise, which eats files starting with _.
  await writeFile(join(DIST, '.nojekyll'), '');

  console.log(`dist/: ${entryCount()} entries, ${published.length + 1} routes, base ${base}`);
  console.log('SQL console: excluded (needs a live database)');
}

await main();
