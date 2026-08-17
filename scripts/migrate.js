// Migrate the flat HTML reference into SQLite.
//
// Reads the inline `const DATA = {...}` object out of source/procedural-generation-reference.html
// and writes it to data/catalogue.db. Faithful: nothing is added, dropped or reworded.
// Idempotent — re-running rebuilds the database from scratch.

import { readFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'source', 'procedural-generation-reference.html');
const DB_PATH = join(root, 'data', 'catalogue.db');
const SCHEMA = join(root, 'db', 'schema.sql');
const TIER_ANNOTATIONS = join(root, 'data', 'annotations', 'tier.json');
const FACET_ANNOTATIONS = join(root, 'data', 'annotations', 'facet.json');
const ALGO_ANNOTATIONS = join(root, 'data', 'annotations', 'algorithms.json');
const IMPL_ANNOTATIONS = join(root, 'data', 'annotations', 'implementations.json');
const TECH_ANNOTATIONS = join(root, 'data', 'annotations', 'technologies.json');
const IMPL_ALGO_ANNOTATIONS = join(root, 'data', 'annotations', 'implementation-algorithms.json');

/** Pull the DATA object literal out of the HTML by matching braces outside of strings. */
function extractData(html) {
  const marker = html.indexOf('const DATA = ');
  if (marker === -1) throw new Error('could not find `const DATA = ` in source HTML');

  const tail = html.slice(marker);
  const start = tail.indexOf('{');
  let depth = 0, inString = false, escaped = false;

  for (let i = start; i < tail.length; i++) {
    const ch = tail[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      return JSON.parse(tail.slice(start, i + 1));
    }
  }
  throw new Error('unbalanced braces while extracting DATA');
}

const data = extractData(readFileSync(SOURCE, 'utf8'));

const db = new DatabaseSync(DB_PATH);
db.exec(readFileSync(SCHEMA, 'utf8'));

const insert = {
  tag: db.prepare(
    `INSERT INTO tag (id, name, what, good, bad, watch, position)
     VALUES (?, ?, ?, ?, ?, ?, ?)`),
  domain: db.prepare(`INSERT INTO domain (id, name, blurb, position) VALUES (?, ?, ?, ?)`),
  grp: db.prepare(`INSERT INTO grp (domain_id, name, position) VALUES (?, ?, ?)`),
  entry: db.prepare(
    `INSERT INTO entry (group_id, name, description, position) VALUES (?, ?, ?, ?)`),
  entryTag: db.prepare(`INSERT OR IGNORE INTO entry_tag (entry_id, tag_id) VALUES (?, ?)`),
  caseStudy: db.prepare(
    `INSERT INTO case_study (name, description, position) VALUES (?, ?, ?)`),
  caseStudyTag: db.prepare(
    `INSERT OR IGNORE INTO case_study_tag (case_study_id, tag_id) VALUES (?, ?)`),
  pitfall: db.prepare(`INSERT INTO pitfall (name, description, position) VALUES (?, ?, ?)`),
  tool: db.prepare(`INSERT INTO tool (name, description, category, position) VALUES (?, ?, ?, ?)`),
  reading: db.prepare(`INSERT INTO reading (name, description, category, position) VALUES (?, ?, ?, ?)`),
};

db.exec('BEGIN');

// Tags come from the algorithm-family cards, which carry the prose for each id.
data.algorithms.forEach((a, i) =>
  insert.tag.run(a.id, a.name, a.what, a.good, a.bad, a.watch, i));

const knownTags = new Set(data.algorithms.map(a => a.id));
const orphanTags = new Set();

let entryCount = 0;
data.categories.forEach((cat, ci) => {
  insert.domain.run(cat.id, cat.name, cat.blurb ?? null, ci);
  cat.groups.forEach((group, gi) => {
    const groupId = insert.grp.run(cat.id, group.name, gi).lastInsertRowid;
    group.items.forEach((item, ii) => {
      const entryId = insert.entry.run(groupId, item.n, item.d ?? null, ii).lastInsertRowid;
      entryCount++;
      for (const tag of item.t ?? []) {
        if (!knownTags.has(tag)) { orphanTags.add(tag); continue; }
        insert.entryTag.run(entryId, tag);
      }
    });
  });
});

data.caseStudies.forEach((cs, i) => {
  const id = insert.caseStudy.run(cs.n, cs.d ?? null, i).lastInsertRowid;
  for (const tag of cs.tags ?? []) {
    if (!knownTags.has(tag)) { orphanTags.add(tag); continue; }
    insert.caseStudyTag.run(id, tag);
  }
});

data.pitfalls.forEach((p, i) => insert.pitfall.run(p.n, p.d ?? null, i));
data.tools.forEach((t, i) => insert.tool.run(t.n, t.d ?? null, t.c ?? null, i));
data.reading.forEach((r, i) => insert.reading.run(r.n, r.d ?? null, r.c ?? null, i));

// ---- annotations -----------------------------------------------------------
// Applied on top of the faithful migration. Keyed by (domain, entry name).
// An override that matches no entry is an error, not a silent no-op — that is how
// typos and entries renamed upstream get caught.

const tierStats = { source: 0, operator: 0, generator: 0 };

if (existsSync(TIER_ANNOTATIONS)) {
  const ann = JSON.parse(readFileSync(TIER_ANNOTATIONS, 'utf8'));
  const setTier = db.prepare(`
    UPDATE entry SET tier = ? WHERE id IN (
      SELECT e.id FROM entry e
      JOIN grp g ON g.id = e.group_id
      WHERE g.domain_id = ? AND e.name = ?)`);
  const setDefault = db.prepare(`
    UPDATE entry SET tier = ? WHERE id IN (
      SELECT e.id FROM entry e JOIN grp g ON g.id = e.group_id WHERE g.domain_id = ?)`);
  const domainExists = db.prepare(`SELECT 1 FROM domain WHERE id = ?`);

  const problems = [];
  for (const [domainId, spec] of Object.entries(ann)) {
    if (domainId.startsWith('_')) continue;
    if (!domainExists.get(domainId)) { problems.push(`unknown domain "${domainId}"`); continue; }

    setDefault.run(spec.default, domainId);
    for (const [name, tier] of Object.entries(spec.overrides ?? {})) {
      const { changes } = setTier.run(tier, domainId, name);
      if (changes === 0) problems.push(`${domainId}: no entry named "${name}"`);
      else if (changes > 1) problems.push(`${domainId}: "${name}" matched ${changes} entries`);
    }
  }

  const unclassified = db.prepare(`SELECT COUNT(*) n FROM entry WHERE tier IS NULL`).get().n;
  if (unclassified) problems.push(`${unclassified} entries left without a tier`);

  if (problems.length) {
    db.exec('ROLLBACK');
    console.error('annotation errors:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  for (const r of db.prepare(`SELECT tier, COUNT(*) n FROM entry GROUP BY tier`).all()) {
    tierStats[r.tier] = r.n;
  }
}

const facetStats = {};

if (existsSync(FACET_ANNOTATIONS)) {
  const ann = JSON.parse(readFileSync(FACET_ANNOTATIONS, 'utf8'));
  const setFacet = db.prepare(`UPDATE tag SET facet = ? WHERE id = ?`);
  const problems = [];

  for (const [tagId, facet] of Object.entries(ann.facets ?? {})) {
    const { changes } = setFacet.run(facet, tagId);
    if (changes === 0) problems.push(`no tag with id "${tagId}"`);
  }

  const unfaceted = db.prepare(`SELECT id FROM tag WHERE facet IS NULL`).all().map(r => r.id);
  if (unfaceted.length) problems.push(`tags left without a facet: ${unfaceted.join(', ')}`);

  if (problems.length) {
    db.exec('ROLLBACK');
    console.error('facet annotation errors:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  for (const r of db.prepare(`SELECT facet, COUNT(*) n FROM tag GROUP BY facet`).all()) {
    facetStats[r.facet] = r.n;
  }
}

// ---- technologies, algorithms, implementations -----------------------------

const layerStats = { technologies: 0, algorithms: 0, implementations: 0, links: 0 };
const layerProblems = [];

if (existsSync(TECH_ANNOTATIONS)) {
  const ann = JSON.parse(readFileSync(TECH_ANNOTATIONS, 'utf8'));
  const ins = db.prepare(
    `INSERT INTO technology (id, name, kind, note, position) VALUES (?, ?, ?, ?, ?)`);
  (ann.technologies ?? []).forEach((t, i) => {
    ins.run(t.id, t.name, t.kind ?? null, t.note ?? null, i);
    layerStats.technologies++;
  });
}

if (existsSync(ALGO_ANNOTATIONS)) {
  const ann = JSON.parse(readFileSync(ALGO_ANNOTATIONS, 'utf8'));
  const ins = db.prepare(`
    INSERT INTO algorithm (id, name, concept_tag, year, authors, summary, description, tier, source_type, citation, url, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const SOURCE_TYPES = new Set(['paper', 'article', 'reference-implementation', 'folklore']);
  const tagExists = db.prepare(`SELECT 1 FROM tag WHERE id = ?`);

  (ann.algorithms ?? []).forEach((a, i) => {
    if (a.concept && !tagExists.get(a.concept)) {
      layerProblems.push(`algorithm "${a.id}" references unknown concept "${a.concept}"`);
      return;
    }
    if (!a.url) layerProblems.push(`algorithm "${a.id}" has no citation url`);
    if (!a.description) layerProblems.push(`algorithm "${a.id}" has no description`);
    if (!SOURCE_TYPES.has(a.source_type)) layerProblems.push(`algorithm "${a.id}" has invalid source_type "${a.source_type}"`);
    ins.run(a.id, a.name, a.concept ?? null, a.year ?? null, a.authors ?? null,
      a.summary ?? null, a.description ?? null, a.tier ?? null, a.source_type ?? null,
      a.citation ?? null, a.url ?? null, i);
    layerStats.algorithms++;
  });
}

if (existsSync(IMPL_ANNOTATIONS)) {
  const ann = JSON.parse(readFileSync(IMPL_ANNOTATIONS, 'utf8'));
  const ins = db.prepare(`
    INSERT INTO implementation
      (package, ecosystem, concept_tag, role, version, last_release, description, repo, license, verified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const link = db.prepare(
    `INSERT OR IGNORE INTO implementation_technology (implementation_id, technology_id) VALUES (?, ?)`);
  const tagExists = db.prepare(`SELECT 1 FROM tag WHERE id = ?`);
  const techExists = db.prepare(`SELECT 1 FROM technology WHERE id = ?`);

  for (const im of ann.implementations ?? []) {
    if (im.concept && !tagExists.get(im.concept)) {
      layerProblems.push(`implementation "${im.package}" references unknown concept "${im.concept}"`);
      continue;
    }
    if (!im.verified) {
      layerProblems.push(`implementation "${im.package}" is not marked verified`);
      continue;
    }
    const id = ins.run(im.package, im.ecosystem ?? null, im.concept ?? null, im.role ?? null,
      im.version ?? null, im.last_release ?? null, im.description ?? null,
      im.repo ?? null, im.license ?? null, 1).lastInsertRowid;
    layerStats.implementations++;

    for (const t of im.technologies ?? []) {
      if (!techExists.get(t)) { layerProblems.push(`implementation "${im.package}" references unknown technology "${t}"`); continue; }
      link.run(id, t);
      layerStats.links++;
    }
  }
}

// implementation -> algorithm links
let implAlgoLinks = 0;
if (existsSync(IMPL_ALGO_ANNOTATIONS)) {
  const ann = JSON.parse(readFileSync(IMPL_ALGO_ANNOTATIONS, 'utf8'));
  const findImpl = db.prepare(`SELECT id FROM implementation WHERE ecosystem = ? AND package = ?`);
  const algoExists = db.prepare(`SELECT 1 FROM algorithm WHERE id = ?`);
  const link = db.prepare(
    `INSERT OR IGNORE INTO implementation_algorithm (implementation_id, algorithm_id) VALUES (?, ?)`);

  for (const [key, algos] of Object.entries(ann.map ?? {})) {
    const [eco, ...rest] = key.split(':');
    const pkg = rest.join(':');
    const row = findImpl.get(eco, pkg);
    if (!row) { layerProblems.push(`impl-algo map references unknown implementation "${key}"`); continue; }
    for (const a of algos) {
      if (!algoExists.get(a)) { layerProblems.push(`impl-algo map: "${key}" references unknown algorithm "${a}"`); continue; }
      link.run(row.id, a);
      implAlgoLinks++;
    }
  }
}

if (layerProblems.length) {
  db.exec('ROLLBACK');
  console.error('algorithm / implementation errors:');
  for (const p of layerProblems) console.error(`  - ${p}`);
  process.exit(1);
}

db.exec('COMMIT');

const count = sql => db.prepare(sql).get().n;
console.log(`wrote ${DB_PATH}`);
console.log(`  domains      ${count('SELECT COUNT(*) n FROM domain')}`);
console.log(`  groups       ${count('SELECT COUNT(*) n FROM grp')}`);
console.log(`  entries      ${count('SELECT COUNT(*) n FROM entry')}`);
console.log(`  tags         ${count('SELECT COUNT(*) n FROM tag')}`);
console.log(`  entry_tag    ${count('SELECT COUNT(*) n FROM entry_tag')}`);
console.log(`  case studies ${count('SELECT COUNT(*) n FROM case_study')}`);
console.log(`  pitfalls     ${count('SELECT COUNT(*) n FROM pitfall')}`);
console.log(`  tools        ${count('SELECT COUNT(*) n FROM tool')}`);
console.log(`  reading      ${count('SELECT COUNT(*) n FROM reading')}`);
console.log(`\n  tiers:  ${tierStats.source} source · ${tierStats.operator} operator · ${tierStats.generator} generator`);
console.log(`  facets: ${Object.entries(facetStats).map(([k, v]) => `${v} ${k}`).join(' · ')}`);
console.log(`\n  technologies    ${layerStats.technologies}`);
console.log(`  algorithms      ${layerStats.algorithms}  (verified citations only)`);
console.log(`  implementations ${layerStats.implementations}  (registry-checked)`);
console.log(`  impl↔tech links ${layerStats.links}`);
console.log(`  impl↔algo links ${implAlgoLinks}`);

if (orphanTags.size) {
  console.warn(`\n  WARNING: tag ids used by entries but absent from the algorithm cards: ${[...orphanTags].join(', ')}`);
}
if (entryCount !== 841) {
  console.warn(`\n  NOTE: expected 841 entries, found ${entryCount}.`);
}

db.close();
