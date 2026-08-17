// Read side of the catalogue: the bootstrap payload and the read-only SQL console.
// Shared by server.js (live, on demand) and scripts/build-static.js (frozen into
// api/bootstrap.json for the published site), so the two cannot drift apart.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Definitions and contested calls come from the annotation files, not the database. */
const readJson = p => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {});

export function openCatalogue(root) {
  const annotation = name => readJson(join(root, 'data', 'annotations', `${name}.json`));

  const tierAnn = annotation('tier');
  const tierMeta = {
    definitions: tierAnn._tiers ?? {},
    test: tierAnn._test ?? null,
    contested: tierAnn._contested ?? [],
  };

  const facetAnn = annotation('facet');
  const facetMeta = {
    kinds: facetAnn._kinds ?? {},
    tests: facetAnn._tests ?? {},
    note: facetAnn._note ?? null,
    contains: facetAnn._contains ?? {},
    contested: facetAnn._contested ?? [],
  };

  const conceptAnn = annotation('concepts');
  const conceptMeta = {
    whyEli5: conceptAnn._why_eli5 ?? null,
    rules: conceptAnn._rules ?? {},
    additions: Object.fromEntries((conceptAnn.additions ?? []).map(a => [a.id, {
      why: a.why, importable: a.importable, absence: a.absence ?? null,
    }])),
    rejected: conceptAnn._rejected ?? [],
    contested: conceptAnn._contested ?? [],
  };

  const algoAnn = annotation('algorithms');
  const implAnn = annotation('implementations');
  const algoMeta = {
    rule: algoAnn._rule ?? null,
    coverage: algoAnn._coverage ?? null,
    candidates: algoAnn.candidates ?? {},
  };
  const implAlgoAnn = annotation('implementation-algorithms');
  const implMeta = {
    method: implAnn._method ?? null,
    caveat: implAnn._caveat ?? null,
    resolved: implAnn._resolved ?? null,
    roles: implAnn._roles ?? {},
    orphans: implAlgoAnn._orphans ?? null,
    orphanReasons: implAlgoAnn._orphan_reason ?? {},
  };

  const db = new DatabaseSync(join(root, 'data', 'catalogue.db'), { readOnly: true });
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

    const codeByAlgo = new Map();
    for (const r of all(`
      SELECT algorithm_id, technology, lines, note, code FROM code_sample
      ORDER BY algorithm_id, position`)) {
      if (!codeByAlgo.has(r.algorithm_id)) codeByAlgo.set(r.algorithm_id, []);
      codeByAlgo.get(r.algorithm_id).push({
        technology: r.technology, lines: r.lines, note: r.note, code: r.code,
      });
    }

    /** Sources indexed by what they bear on, so a card can show its own citations. */
    const sourceLinks = all(`SELECT source_id, layer, target_id, relation, note FROM source_link`);
    const sourcesFor = {};
    for (const l of sourceLinks) {
      const key = `${l.layer}:${l.target_id}`;
      (sourcesFor[key] ??= []).push({ id: l.source_id, relation: l.relation, note: l.note });
    }

    return {
      tierMeta,
      facetMeta,
      conceptMeta,
      algoMeta,
      implMeta,
      technologies: all(`SELECT id, name, kind, note FROM technology ORDER BY position`),
      algorithms: all(`
        SELECT id, name, concept_tag, year, authors, summary, description, eli5, tier, source_type, citation, url
        FROM algorithm ORDER BY year, position`)
        .map(a => ({ ...a, code: codeByAlgo.get(a.id) ?? [] })),
      sources: all(`
        SELECT id, url, title, kind, publisher, year, description, retrieved
        FROM source ORDER BY position`),
      sourcesFor,
      corrections: all(`
        SELECT layer, target_id, field, was, now, why, source_url
        FROM correction ORDER BY id`),
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
        SELECT t.id, t.name, t.facet, t.what, t.good, t.bad, t.watch, t.eli5, t.origin,
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

  const entryCount = () => db.prepare('SELECT COUNT(*) n FROM entry').get().n;

  return { bootstrap, runQuery, entryCount };
}

// Client-side routes. Served the shell; the client reads the path and picks a view.
// Kept in sync with ROUTES in public/app.js.
export const ROUTES = [
  '/', '/basic-blocks', '/algorithms', '/implementations', '/catalogue',
  '/definitions', '/case-studies', '/pitfalls', '/tools', '/sql',
];

/** The one route that needs the server: it POSTs SQL back. Dropped from static builds. */
export const SERVER_ONLY_ROUTES = ['/sql'];
