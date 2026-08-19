// Re-checks every implementation against the registry it came from.
//
// `implementations.json` records a version, a release date, a licence and a repo for 120
// packages. Each was true on the day it was checked and has been decaying since. Nothing
// re-checked them, so the catalogue has been quietly claiming a freshness it stopped having.
// This is the standing version of the pass described in docs/data-model.md.
//
// There is no language model here and there should not be: the registry returns the answer, so
// there is nothing to infer and nothing to get creatively wrong.
//
//   node scripts/poll-registries.js                    check and report, change nothing
//   node scripts/poll-registries.js --write            apply the updates
//   node scripts/poll-registries.js --json out.json    machine-readable report for a workflow
//   node scripts/poll-registries.js --only noise       just the rows whose key matches
//
// GitHub's API allows 60 requests an hour unauthenticated and 5000 with a token, and this makes
// about 115 of them. Set GITHUB_TOKEN, or run somewhere `gh auth token` works.

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMPL = join(root, 'data', 'annotations', 'implementations.json');

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const val = f => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1]; };

const today = process.env.POLL_DATE || new Date().toISOString().slice(0, 10);
const STALE_DAYS = 730;

// crates.io asks for a User-Agent identifying the caller, and npm and PyPI prefer one too.
const UA = 'procgen-catalogue registry poller (https://github.com/heraphim/proc-gen-study)';

function githubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try { return execSync('gh auth token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}
const TOKEN = githubToken();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const date = s => (s ? String(s).slice(0, 10) : null);

async function getJSON(url, extraHeaders = {}) {
  const headers = { accept: 'application/json', 'user-agent': UA, ...extraHeaders };
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try { res = await fetch(url, { headers }); }
    catch (e) { if (attempt === 2) return { error: e.message }; await sleep(500 * (attempt + 1)); continue; }
    if (res.status === 404) return { missing: true };
    // 429 and 5xx are worth waiting out. Anything else is the answer, right or wrong.
    if (res.status === 429 || res.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
    if (!res.ok) return { error: `HTTP ${res.status}` };
    try { return { data: await res.json() }; } catch (e) { return { error: `bad JSON: ${e.message}` }; }
  }
  return { error: 'gave up after 3 attempts' };
}

// Registries hand back git+ssh://, git://, and .git suffixes. The catalogue stores the page a
// person would actually open.
function normaliseRepo(url) {
  if (!url) return null;
  const u = String(url).trim()
    .replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '').replace(/\/+$/, '');
  return /^https?:\/\//.test(u) ? u : null;
}
const ghSlug = url => (normaliseRepo(url) || '').match(/^https:\/\/github\.com\/([^/]+\/[^/]+)/)?.[1] ?? null;

// Where a person would go to look. A report that says a package is gone and makes you work out
// where it used to live is a report that gets ignored: the whole question is whether it moved,
// was renamed, or really went away, and that is answered by opening these.
const REGISTRY_PAGE = {
  npm: p => `https://www.npmjs.com/package/${p}`,
  pypi: p => `https://pypi.org/project/${p}/`,
  cargo: p => `https://crates.io/crates/${p}`,
  nuget: p => `https://www.nuget.org/packages/${p}`,
  github: p => `https://github.com/${p}`,
};
const wherePackage = row => REGISTRY_PAGE[row.ecosystem]?.(row.package) ?? null;
const searchFor = row => `https://duckduckgo.com/?q=${encodeURIComponent(`${row.package} ${row.ecosystem} package`)}`;

// PyPI's `license` field is free text, and a good number of projects paste the entire licence
// into it — scipy ships the full GPL, trimesh the full MIT, both with the copyright headers of
// every vendored dependency. Anything that long or multi-line is a document, not an identifier.
const licenceId = s => {
  if (!s) return null;
  const t = String(s).trim();
  return t.length <= 60 && !t.includes('\n') ? t : null;
};

const ghHeaders = () => (TOKEN ? { authorization: `Bearer ${TOKEN}`, 'x-github-api-version': '2022-11-28' } : {});
const ghRepo = slug => getJSON(`https://api.github.com/repos/${slug}`, ghHeaders());

// ---- one resolver per registry ---------------------------------------------

const resolvers = {
  async npm(pkg) {
    const r = await getJSON(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}`);
    if (!r.data) return r;
    const d = r.data;
    const latest = d['dist-tags']?.latest ?? null;
    return {
      version: latest,
      last_release: date(d.time?.[latest]),
      license: licenceId(typeof d.license === 'string' ? d.license : d.license?.type),
      repo: normaliseRepo(d.repository?.url),
      deprecated: Boolean(latest && d.versions?.[latest]?.deprecated),
    };
  },

  async pypi(pkg) {
    const r = await getJSON(`https://pypi.org/pypi/${pkg}/json`);
    if (!r.data) return r;
    const info = r.data.info ?? {};
    // `license` is frequently null on modern metadata; the expression field or a classifier
    // carries it instead. numpy is the row that made this necessary.
    const fromClassifier = (info.classifiers ?? [])
      .find(c => c.startsWith('License :: '))?.split(' :: ').pop() ?? null;
    // project_urls keys are lowercased by PyPI and the naming varies by project.
    const urls = Object.fromEntries(Object.entries(info.project_urls ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      version: info.version ?? null,
      last_release: date(r.data.urls?.[0]?.upload_time_iso_8601),
      // Prefer the SPDX expression, then the classifier, and only fall back to the free-text
      // field when it is short enough to actually be an identifier.
      license: licenceId(info.license_expression) || fromClassifier || licenceId(info.license),
      repo: normaliseRepo(urls.source ?? urls.repository ?? urls['source code'] ?? urls.homepage ?? null),
      deprecated: Boolean(info.yanked),
    };
  },

  async cargo(pkg) {
    const r = await getJSON(`https://crates.io/api/v1/crates/${pkg}`);
    if (!r.data) return r;
    const latest = r.data.crate?.max_stable_version ?? null;
    const v = (r.data.versions ?? []).find(x => x.num === latest);
    return {
      version: latest,
      last_release: date(v?.created_at ?? r.data.crate?.updated_at),
      license: licenceId(v?.license),
      repo: normaliseRepo(r.data.crate?.repository),
      deprecated: Boolean(v?.yanked),
    };
  },

  async nuget(pkg) {
    const r = await getJSON(`https://api.nuget.org/v3/registration5-gz-semver2/${pkg.toLowerCase()}/index.json`);
    if (!r.data) return r;
    // The index is paged, and a leaf page sometimes inlines its items and sometimes only links
    // them.
    let page = r.data.items?.[r.data.items.length - 1];
    if (page && !page.items) {
      const p = await getJSON(page['@id']);
      if (!p.data) return p;
      page = p.data;
    }
    // Prereleases are published like anything else; the catalogue records stable versions.
    const entries = (page?.items ?? []).map(i => i.catalogEntry).filter(Boolean)
      .filter(e => !String(e.version).includes('-'));
    const latest = entries[entries.length - 1];
    return {
      version: latest?.version ?? null,
      last_release: date(latest?.published),
      license: licenceId(latest?.licenseExpression),
      repo: normaliseRepo(latest?.projectUrl),
      deprecated: latest?.listed === false,
    };
  },

  // Libraries that ship only as a repository. The release, where there is one, is the version.
  async github(pkg) {
    const repo = await ghRepo(pkg);
    if (!repo.data) return repo;
    const rel = await getJSON(`https://api.github.com/repos/${pkg}/releases/latest`, ghHeaders());
    const spdx = repo.data.license?.spdx_id;
    return {
      // Tags are written `v2.6.0` about as often as `2.6.0`; the catalogue records the number.
      version: rel.data?.tag_name ? String(rel.data.tag_name).replace(/^v(?=\d)/, '') : null,
      // Only an actual release sets last_release. Several of these repos publish no releases at
      // all, and standing `pushed_at` in for one would rewrite the row every week on any repo
      // that is merely alive — and would call a commit a release, which it is not.
      last_release: date(rel.data?.published_at),
      last_commit: date(repo.data.pushed_at),
      license: spdx === 'NOASSERTION' ? null : spdx ?? null,
      repo: repo.data.html_url,
      deprecated: false,
    };
  },
};

// ---- run --------------------------------------------------------------------

// Which algorithms each package implements, and how many implementations each algorithm has.
// A missing package matters exactly as much as what it was the only implementation of.
const implAlgos = JSON.parse(readFileSync(join(root, 'data', 'annotations', 'implementation-algorithms.json'), 'utf8')).map ?? {};
const algoImplCount = {};
for (const list of Object.values(implAlgos)) for (const a of list) algoImplCount[a] = (algoImplCount[a] ?? 0) + 1;

const file = JSON.parse(readFileSync(IMPL, 'utf8').replace(/\r\n/g, '\n'));
const rows = file.implementations ?? [];
const only = val('--only');
const targets = only ? rows.filter(r => `${r.ecosystem}:${r.package}`.includes(only)) : rows;

const daysSince = d => (d ? Math.round((Date.parse(today) - Date.parse(d)) / 86400000) : null);
const findings = [];
const dormant = [];

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

if (!TOKEN) console.error('warning: no GitHub token found — star counts will fail after ~60 requests\n');

await pool(targets, Number(val('--concurrency')) || 6, async row => {
  const key = `${row.ecosystem}:${row.package}`;
  const resolve = resolvers[row.ecosystem];
  if (!resolve) { findings.push({ key, row, kind: 'attention', what: `no resolver for ecosystem "${row.ecosystem}"` }); return; }

  const res = await resolve(row.package);
  if (res.missing) { findings.push({ key, row, kind: 'attention', what: 'gone from its registry (404)' }); return; }
  if (res.error) { findings.push({ key, row, kind: 'error', what: res.error }); return; }

  const changes = [];
  const set = (field, next, apply = true) => {
    if (next == null || next === row[field]) return;
    changes.push({ field, was: row[field] ?? null, now: next, apply });
  };
  set('version', res.version);
  set('last_release', res.last_release);
  if (!row.repo && res.repo) set('repo', res.repo);

  // `license` is the catalogue's judgement and is never overwritten: a registry reporting
  // "(BSD-3-Clause AND Apache-2.0)" against a row that says "BSD-3-Clause" is not a disagreement
  // worth acting on. What is worth knowing is when the registry's own answer *changes*, so the
  // raw string is recorded separately and compared against itself. The first run records it
  // quietly; only a later change raises anything.
  const licenceMoved = row.license_registry != null && res.license != null && row.license_registry !== res.license;
  set('license_registry', res.license);

  // Stars come from the repository, whatever registry the package itself lives in.
  const slug = ghSlug(row.repo ?? res.repo);
  let stars = null, archived = false;
  if (slug) {
    const gh = await ghRepo(slug);
    if (gh.data) {
      stars = gh.data.stargazers_count;
      archived = Boolean(gh.data.archived);
      set('stars', stars);
    } else if (gh.missing) {
      findings.push({ key, row, kind: 'attention', what: `repo ${slug} is gone (404)` });
    }
  }

  const flags = [];
  if (archived && !row.archived) flags.push('repo is now archived');
  if (res.deprecated) flags.push('marked deprecated or yanked by its registry');
  // Staleness is a standing property, not news. A package that was already dormant last week is
  // still dormant, and reporting all of them every run buries the handful that just crossed the
  // line. The first run is the exception and will be loud, because it is correcting release
  // dates that were never right.
  const age = daysSince(res.last_release ?? row.last_release ?? res.last_commit);
  const wasStale = (daysSince(row.last_release) ?? 0) > STALE_DAYS;
  const isStale = age != null && age > STALE_DAYS;
  if (isStale && !wasStale) flags.push(`no release in ${Math.floor(age / 365)} years`);
  if (isStale && wasStale) dormant.push(key);
  if (licenceMoved) flags.push(`registry licence changed: ${row.license_registry} -> ${res.license} (recorded: ${row.license ?? '—'})`);

  findings.push({
    key, row, changes, stars, archived, flags,
    kind: flags.length ? 'attention' : changes.length ? 'routine' : 'unchanged',
  });
});

findings.sort((a, b) => a.key.localeCompare(b.key));
const of = k => findings.filter(f => f.kind === k);
const routine = of('routine');

// ---- report -----------------------------------------------------------------

console.log(`${targets.length} implementations checked against their registries on ${today}\n`);

for (const f of of('error')) console.log(`  ERROR  ${f.key.padEnd(34)} ${f.what}`);
if (of('error').length) console.log('');

if (of('attention').length) {
  console.log(`NEEDS A LOOK (${of('attention').length})\n`);
  for (const f of of('attention')) {
    console.log(`  ${f.key}`);
    if (f.what) console.log(`      ${f.what}`);
    if (f.what) console.log(`      look: ${wherePackage(f.row) ?? searchFor(f.row)}${f.row.repo ? ` · ${f.row.repo}` : ''}`);
    for (const x of f.flags ?? []) console.log(`      ${x}`);
    for (const c of f.changes ?? []) console.log(`      ${c.field}: ${c.was ?? '—'} -> ${c.now}${c.apply ? '' : '  (not written)'}`);
  }
  console.log('');
}

if (routine.length) {
  console.log(`ROUTINE UPDATES (${routine.length})\n`);
  for (const f of routine) {
    console.log(`  ${f.key.padEnd(34)} ${f.changes.map(c => `${c.field} ${c.was ?? '—'}->${c.now}`).join(', ')}`);
  }
  console.log('');
}

const starred = findings.filter(f => f.stars != null);
console.log(`unchanged ${of('unchanged').length} · routine ${routine.length} · needs a look ${of('attention').length} · errors ${of('error').length}`);
if (dormant.length) console.log(`${dormant.length} already-dormant packages not re-reported (--dormant lists them)`);
if (has('--dormant')) for (const k of dormant.sort()) console.log(`  dormant  ${k}`);
console.log(`stars resolved for ${starred.length} of ${targets.length} (${starred.reduce((s, f) => s + f.stars, 0).toLocaleString('en-GB')} total)`);

// ---- write ------------------------------------------------------------------

if (has('--write')) {
  let touched = 0;
  for (const f of findings) {
    const apply = (f.changes ?? []).filter(c => c.apply);
    if (!apply.length && !(f.archived && !f.row.archived)) continue;
    for (const c of apply) f.row[c.field] = c.now;
    if (f.archived) f.row.archived = true;
    touched++;
  }
  file._polled = `Registry state as of ${today}, refreshed by scripts/poll-registries.js. Do not hand-edit version, last_release, stars, archived or license_registry — the next run overwrites them. license_registry is the registry's raw licence string, kept so a change in the registry's own answer is detectable; the curated license field is reported against but never written, because the registry's answer and the catalogue's are not always disagreeing.`;
  writeFileSync(IMPL, JSON.stringify(file, null, 2) + '\n');
  console.log(`\nwrote ${touched} updated rows to data/annotations/implementations.json`);
}

if (val('--markdown')) {
  const L = [];

  // Only problems are reported. Versions, release dates and star counts change every week by
  // design -- that is what this exists to keep current -- and listing them turns the one thing
  // that needs a person into a needle in a table nobody reads. They are in the diff.
  const gone = of('attention').filter(f => /gone|404|no resolver/.test(f.what ?? ''));
  const broken = of('attention').filter(f => !gone.includes(f)
    && (f.flags ?? []).some(x => /archived|deprecated|yanked|licence/.test(x)));
  const quiet = of('attention').filter(f => !gone.includes(f) && !broken.includes(f));

  L.push(`Registry state as of ${today}, across ${targets.length} implementations.`);
  L.push('');
  if (!gone.length && !broken.length && !quiet.length && !of('error').length) {
    L.push('Nothing needs a decision. Versions, release dates and star counts were refreshed; the diff has them.');
  } else {
    L.push(`**${gone.length} missing · ${broken.length} archived or deprecated · ${quiet.length} newly dormant**`);
    L.push('');
    L.push(`${routine.length} routine updates -- versions, release dates, star counts -- are applied in the diff and not listed here.`);
  }
  if (dormant.length) L.push(`${dormant.length} packages were already dormant before this run and are not re-reported.`);

  // What the catalogue loses if a package is really gone. Whether it moved, was renamed, or
  // actually went away is a judgement someone has to make, and it needs the links to make it.
  const detail = f => {
    const row = f.row;
    const key = `${row.ecosystem}:${row.package}`;
    const covers = implAlgos[key] ?? [];
    L.push(`### \`${key}\``);
    L.push('');
    if (row.description) L.push(`> ${row.description}`);
    L.push('');
    for (const x of [f.what, ...(f.flags ?? [])].filter(Boolean)) L.push(`- ${x}`);

    const where = wherePackage(row);
    L.push(`- **Look:** ${[
      where ? `[${row.ecosystem} page](${where})` : null,
      row.repo ? `[repo](${row.repo})` : null,
      `[search](${searchFor(row)})`,
    ].filter(Boolean).join(' · ')}`);

    if (row.repo && ghSlug(row.repo)) {
      const slug = ghSlug(row.repo);
      L.push(`- **If it moved:** [forks](https://github.com/${slug}/forks) · [owner](https://github.com/${slug.split('/')[0]}) · [code search](https://github.com/search?q=${encodeURIComponent(row.package)}&type=repositories)`);
    }

    // The consequence, which is the part that decides whether this matters.
    if (covers.length) {
      const orphaned = covers.filter(a => (algoImplCount[a] ?? 0) <= 1);
      L.push(`- **Implements:** ${covers.join(', ')}`);
      if (orphaned.length) {
        L.push(`- **If dropped:** ${orphaned.map(a => `\`${a}\``).join(', ')} would have no implementation left`);
      }
    } else {
      L.push('- **Implements:** nothing recorded — see `_orphan_reason` in implementation-algorithms.json');
    }
    L.push(`- Concept \`${row.concept ?? '—'}\` · ${(row.technologies ?? []).join(', ') || 'no technologies recorded'} · ${row.license ?? 'licence not recorded'}`);
    L.push('');
  };

  if (gone.length) { L.push('', '## Missing', ''); gone.forEach(detail); }
  if (broken.length) { L.push('## Archived or deprecated', ''); broken.forEach(detail); }

  if (quiet.length) {
    L.push('## Newly dormant', '');
    L.push('First run in which these crossed two years without a release. Not a problem in itself -- a finished library stays finished -- but it is the point at which that becomes true.');
    L.push('');
    for (const f of quiet) L.push(`- \`${f.key}\` — ${(f.flags ?? []).join('; ')}`);
    L.push('');
  }

  if (of('error').length) {
    L.push('## Could not be checked', '');
    for (const f of of('error')) L.push(`- \`${f.key}\` — ${f.what}`);
    L.push('');
  }

  L.push('', `Produced by \`scripts/poll-registries.js\`. No language model is involved: every value came from the registry that owns it. Stars resolved for ${starred.length} of ${targets.length}.`);
  writeFileSync(val('--markdown'), `${L.join('\n')}\n`);
}

if (val('--json')) {
  writeFileSync(val('--json'), JSON.stringify({
    date: today,
    counts: {
      checked: targets.length, unchanged: of('unchanged').length,
      routine: routine.length, attention: of('attention').length, errors: of('error').length,
      stars_resolved: starred.length,
    },
    attention: of('attention').map(f => ({ key: f.key, what: f.what ?? null, flags: f.flags ?? [], changes: f.changes ?? [] })),
    routine: routine.map(f => ({ key: f.key, changes: f.changes })),
    errors: of('error').map(f => ({ key: f.key, what: f.what })),
  }, null, 2) + '\n');
}

// A handful of transient failures is normal across five registries; a wall of them means
// something is wrong with the run rather than with the data.
process.exitCode = of('error').length > 5 ? 1 : 0;
