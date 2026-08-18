// Generates and reads docs/research-seed.md, the list of subjects a person says they can judge.
//
// The seed set is not a list of favourites. It decides which subjects the audit looks at first,
// and the reason to go first is that they are checkable: on a subject you know, a confidently
// wrong model answer and a confidently right one look different. On the other 173 they look
// identical. So the seed set is what proves the pipeline is worth running before it is pointed
// at anything nobody here can referee.
//
//   node scripts/research-seed.js --generate   write the checklist, preserving existing ticks
//   node scripts/research-seed.js              list what is currently ticked
//   node scripts/research-seed.js --ids        just the ids, one per line

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEED = join(root, 'docs', 'research-seed.md');
const ann = name => JSON.parse(readFileSync(join(root, 'data', 'annotations', `${name}.json`), 'utf8'));

const algorithms = ann('algorithms').algorithms;
const facets = ann('facet').facets;
const concepts = ann('concepts');

// The concepts named as already understood. Everything under them starts ticked; the point of
// the file is to untick what does not belong rather than to tick 70 boxes by hand.
// `pick` is here because it was carved out of `rand`, which is: splitting a concept in two
// does not make half of it unfamiliar. Untick it in the file if that turns out to be wrong.
const KNOWN = ['fractal', 'noise', 'rand', 'pick', 'graph', 'ca', 'vor', 'tile'];

const conceptIds = [...new Set([...Object.keys(concepts.eli5), ...concepts.additions.map(a => a.id)])];

// Concept display names live in the source HTML, so they reach here through the built database
// rather than an annotation file. Falling back to the id keeps this runnable before a migration.
const tagNames = new Map();
try {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(root, 'data', 'catalogue.db'), { readOnly: true });
  for (const r of db.prepare('SELECT id, name FROM tag').all()) tagNames.set(r.id, r.name);
  db.close();
} catch { /* not built yet; ids will do */ }
const conceptName = id => concepts.additions.find(a => a.id === id)?.name ?? tagNames.get(id) ?? id;
const byConcept = new Map();
for (const a of algorithms) {
  if (!byConcept.has(a.concept)) byConcept.set(a.concept, []);
  byConcept.get(a.concept).push(a);
}

// ---- reading ----------------------------------------------------------------

// A line is `- [x] `id` — name`, and the `## layer · ...` heading above it says which layer the
// id belongs to. Concepts and algorithms have separate id spaces, so the heading is not
// decoration.
export function readSeed() {
  if (!existsSync(SEED)) return { ticked: [], missing: true };
  const ticked = [];
  let layer = null;
  for (const line of readFileSync(SEED, 'utf8').split('\n')) {
    const head = line.match(/^##\s+(concept|algorithm)\b/);
    if (head) { layer = head[1]; continue; }
    const item = line.match(/^\s*-\s*\[([ xX])\]\s*`([^`]+)`/);
    if (item && item[1].toLowerCase() === 'x' && layer) ticked.push(`${layer}:${item[2]}`);
  }
  return { ticked, missing: false };
}

// ---- writing ----------------------------------------------------------------

function generate() {
  // Regenerating must never silently discard a decision someone made in this file.
  const previous = readSeed();
  const wasTicked = new Set(previous.ticked);
  const firstRun = previous.missing;
  const tick = key => (firstRun
    ? KNOWN.includes(key.split(':')[1]) || KNOWN.includes(algorithms.find(a => `algorithm:${a.id}` === key)?.concept)
    : wasTicked.has(key));

  const L = [];
  L.push('# Research seed');
  L.push('');
  L.push('Which subjects the audit looks at first. Tick what you could catch a wrong answer about.');
  L.push('');
  L.push('This is a calibration set, not a wishlist. Three models researching `perlin-noise` produce');
  L.push('an answer you can referee; the same three researching `dantzig-wolfe-decomposition` produce');
  L.push('one you cannot, and a confident wrong answer is indistinguishable from a confident right one');
  L.push('until someone knows the difference. So the ticked subjects run first, and what they are');
  L.push('really testing is whether the pipeline is worth pointing at the rest.');
  L.push('');
  L.push('Untick anything inside a concept you know that you do not actually know. Tick anything');
  L.push('outside it that you do. Regenerating this file keeps your ticks.');
  L.push('');
  L.push('Read by `scripts/research-seed.js`, which is read in turn by the rotation in');
  L.push('`scripts/pick-subject.js`. Once every subject has had a first review the seed stops');
  L.push('mattering, because from then on the rotation is driven purely by who is behind.');
  L.push('');

  const line = (key, id, name, extra = '') =>
    `- [${tick(key) ? 'x' : ' '}] \`${id}\` — ${name}${extra}`;

  L.push('## concept');
  L.push('');
  const ordered = [...conceptIds].sort((a, b) => {
    const fa = facets[a] ?? 'added', fb = facets[b] ?? 'added';
    return (fa === 'block' ? 0 : 1) - (fb === 'block' ? 0 : 1) || a.localeCompare(b);
  });
  for (const id of ordered) {
    const facet = facets[id] ?? 'added by this project';
    const n = (byConcept.get(id) ?? []).length;
    L.push(line(`concept:${id}`, id, conceptName(id), ` · ${facet} · ${n} algorithm${n === 1 ? '' : 's'}`));
  }
  L.push('');

  // Algorithms grouped by concept, the concepts named as known first, so the ticked block is
  // together at the top instead of scattered through 195 lines.
  const conceptOrder = [...byConcept.keys()].sort((a, b) => {
    const ka = KNOWN.includes(a), kb = KNOWN.includes(b);
    return (kb ? 1 : 0) - (ka ? 1 : 0) || a.localeCompare(b);
  });
  for (const c of conceptOrder) {
    const list = byConcept.get(c).slice().sort((a, b) => a.name.localeCompare(b.name));
    L.push(`## algorithm · ${c} (${list.length})`);
    L.push('');
    // Year is optional: a technique with no single origin has no honest date, and rendering
    // `· null` next to it would state one anyway.
    for (const a of list) L.push(line(`algorithm:${a.id}`, a.id, a.name, a.year ? ` · ${a.year}` : ''));
    L.push('');
  }

  writeFileSync(SEED, `${L.join('\n')}\n`);
  const after = readSeed();
  console.log(`wrote docs/research-seed.md`);
  console.log(`  ${conceptIds.length} concepts + ${algorithms.length} algorithms`);
  console.log(`  ${after.ticked.length} ticked${firstRun ? ' (pre-ticked from the concepts named as known)' : ' (carried over from the previous file)'}`);
}

// ---- run --------------------------------------------------------------------

// This file is imported by pick-subject.js for readSeed(), so the command-line half must not
// run on import.
const argv = process.argv.slice(2);
const runDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (!runDirectly) { /* imported */ } else if (argv.includes('--generate')) {
  generate();
} else {
  const { ticked, missing } = readSeed();
  if (missing) {
    console.error('docs/research-seed.md does not exist yet — run with --generate');
    process.exit(1);
  }
  if (argv.includes('--ids')) { for (const t of ticked) console.log(t); }
  else {
    const byLayer = { concept: [], algorithm: [] };
    for (const t of ticked) byLayer[t.split(':')[0]]?.push(t.split(':').slice(1).join(':'));
    console.log(`${ticked.length} subjects ticked`);
    console.log(`  concepts   ${byLayer.concept.length}: ${byLayer.concept.join(' ')}`);
    console.log(`  algorithms ${byLayer.algorithm.length}`);
  }
}
