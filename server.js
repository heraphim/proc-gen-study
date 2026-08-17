// Local research server for the procedural generation catalogue.
// No dependencies: node:http + node:sqlite. Start with `npm start`.

import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)));
const PUBLIC = join(root, 'public');
const DB_PATH = join(root, 'data', 'catalogue.db');
const TIER_ANNOTATIONS = join(root, 'data', 'annotations', 'tier.json');
const FACET_ANNOTATIONS = join(root, 'data', 'annotations', 'facet.json');
const PORT = Number(process.env.PORT ?? 4173);

/** Definitions and contested calls come from the annotation files, not the database. */
const readJson = p => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});

const tierAnn = readJson(TIER_ANNOTATIONS);
const tierMeta = {
  definitions: tierAnn._tiers ?? {},
  test: tierAnn._test ?? null,
  contested: tierAnn._contested ?? [],
};

const ALGO_ANNOTATIONS = join(root, 'data', 'annotations', 'algorithms.json');
const IMPL_ANNOTATIONS = join(root, 'data', 'annotations', 'implementations.json');

const facetAnn = readJson(FACET_ANNOTATIONS);
const facetMeta = {
  kinds: facetAnn._kinds ?? {},
  tests: facetAnn._tests ?? {},
  note: facetAnn._note ?? null,
  contains: facetAnn._contains ?? {},
  contested: facetAnn._contested ?? [],
};

const algoAnn = readJson(ALGO_ANNOTATIONS);
const implAnn = readJson(IMPL_ANNOTATIONS);
const algoMeta = {
  rule: algoAnn._rule ?? null,
  coverage: algoAnn._coverage ?? null,
  candidates: algoAnn.candidates ?? {},
};
const implMeta = {
  method: implAnn._method ?? null,
  caveat: implAnn._caveat ?? null,
  roles: implAnn._roles ?? {},
};

const db = new DatabaseSync(DB_PATH, { readOnly: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const all = (sql, ...params) => db.prepare(sql).all(...params);

/** Entries with their tags collapsed into an array, plus domain/group context. */
function entries() {
  const rows = all(`
    SELECT e.id, e.name, e.description, e.tier, e.output_type, e.input_class,
           e.compute_cost, e.deterministic, e.realtime, e.difficulty, e.confidence,
           g.name AS group_name, d.id AS domain_id, d.name AS domain_name,
           d.position AS dpos, g.position AS gpos, e.position AS epos
    FROM entry e
    JOIN grp g    ON g.id = e.group_id
    JOIN domain d ON d.id = g.domain_id
    ORDER BY d.position, g.position, e.position`);

  const tags = new Map();
  for (const { entry_id, tag_id } of all(`SELECT entry_id, tag_id FROM entry_tag`)) {
    if (!tags.has(entry_id)) tags.set(entry_id, []);
    tags.get(entry_id).push(tag_id);
  }
  return rows.map(r => ({ ...r, tags: tags.get(r.id) ?? [] }));
}

function bootstrap() {
  const caseStudyTags = new Map();
  for (const { case_study_id, tag_id } of all(`SELECT case_study_id, tag_id FROM case_study_tag`)) {
    if (!caseStudyTags.has(case_study_id)) caseStudyTags.set(case_study_id, []);
    caseStudyTags.get(case_study_id).push(tag_id);
  }

  const implAlgo = new Map();
  for (const { implementation_id, algorithm_id } of
       all(`SELECT implementation_id, algorithm_id FROM implementation_algorithm`)) {
    if (!implAlgo.has(implementation_id)) implAlgo.set(implementation_id, []);
    implAlgo.get(implementation_id).push(algorithm_id);
  }

  const implTech = new Map();
  for (const { implementation_id, technology_id } of
       all(`SELECT implementation_id, technology_id FROM implementation_technology`)) {
    if (!implTech.has(implementation_id)) implTech.set(implementation_id, []);
    implTech.get(implementation_id).push(technology_id);
  }

  return {
    tierMeta,
    facetMeta,
    algoMeta,
    implMeta,
    technologies: all(`SELECT id, name, kind, note FROM technology ORDER BY position`),
    algorithms: all(`
      SELECT id, name, concept_tag, year, authors, summary, description, tier, source_type, citation, url
      FROM algorithm ORDER BY year, position`),
    implementations: all(`
      SELECT id, package, ecosystem, concept_tag, role, version, last_release,
             description, repo, license
      FROM implementation ORDER BY concept_tag, ecosystem, package`)
      .map(r => ({ ...r, technologies: implTech.get(r.id) ?? [], algorithms: implAlgo.get(r.id) ?? [] })),
    /** How many distinct domains each tag reaches — the "widespread" test, measured. */
    tagSpread: all(`
      SELECT et.tag_id AS id, COUNT(DISTINCT g.domain_id) AS domains
      FROM entry_tag et
      JOIN entry e ON e.id = et.entry_id
      JOIN grp g   ON g.id = e.group_id
      GROUP BY et.tag_id`),
    tiers: all(`
      SELECT tier AS id, COUNT(*) AS count FROM entry
      WHERE tier IS NOT NULL GROUP BY tier
      ORDER BY CASE tier WHEN 'source' THEN 1 WHEN 'operator' THEN 2 ELSE 3 END`),
    domains: all(`
      SELECT d.id, d.name, d.blurb, COUNT(e.id) AS count
      FROM domain d
      JOIN grp g    ON g.domain_id = d.id
      JOIN entry e  ON e.group_id = g.id
      GROUP BY d.id ORDER BY d.position`),
    tags: all(`
      SELECT t.id, t.name, t.facet, t.what, t.good, t.bad, t.watch,
             (SELECT COUNT(*) FROM entry_tag et WHERE et.tag_id = t.id) AS count
      FROM tag t ORDER BY count DESC`),
    entries: entries(),
    caseStudies: all(`SELECT id, name, description FROM case_study ORDER BY position`)
      .map(c => ({ ...c, tags: caseStudyTags.get(c.id) ?? [] })),
    pitfalls: all(`SELECT name, description FROM pitfall ORDER BY position`),
    tools: all(`SELECT name, description, category FROM tool ORDER BY position`),
    reading: all(`SELECT name, description, category FROM reading ORDER BY position`),
  };
}

/** Read-only SQL console. Rejects anything that isn't a single SELECT/WITH. */
function runQuery(sql) {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (!/^(select|with)\b/i.test(trimmed)) {
    throw new Error('only SELECT and WITH queries are allowed');
  }
  if (trimmed.includes(';')) throw new Error('one statement at a time');
  const rows = db.prepare(trimmed).all();
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { columns, rows: rows.slice(0, 1000), truncated: rows.length > 1000, total: rows.length };
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

// Client-side routes. Any of these serves index.html and the client reads the path.
// Kept in sync with ROUTES in public/app.js.
const ROUTES = new Set([
  '/', '/basic-blocks', '/algorithms', '/implementations', '/catalogue',
  '/definitions', '/case-studies', '/pitfalls', '/tools', '/sql',
]);

async function serveStatic(res, urlPath) {
  const isAsset = extname(urlPath) !== '';
  const rel = normalize(isAsset ? urlPath : '/index.html').replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });

  // Unknown non-asset paths get index.html too, but with a 404 status, so a typo in the
  // address bar is visible to tooling without breaking the page for a human.
  const status = isAsset || ROUTES.has(urlPath) ? 200 : 404;

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
    if (url.pathname === '/api/bootstrap') return send(res, 200, bootstrap());

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
  const { n } = db.prepare('SELECT COUNT(*) n FROM entry').get();
  console.log(`catalogue: ${n} entries`);
  console.log(`listening on http://localhost:${PORT}`);
});
