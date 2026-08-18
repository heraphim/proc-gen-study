// Chooses what the audit looks at next.
//
// The rule is fairness before priority: everything gets one review before anything gets two.
// So the candidates are always whichever subjects have the fewest reviews, and nothing else is
// eligible however interesting it looks. The migration enforces the same invariant from the
// other side, so a bug here fails the build rather than quietly starving a subject.
//
// Within that cohort, order is seeded by the round number. Not random: a run that dies halfway
// has to resume in the same order rather than re-rolling and re-reviewing what it already did.
// Different round, different order; same round, same order, every time.
//
//   node scripts/pick-subject.js                    the next subject, as JSON
//   node scripts/pick-subject.js --count 40         the next 40, as JSON
//   node scripts/pick-subject.js --list 25          the head of the queue, readable
//   node scripts/pick-subject.js --exclude a,b      skip subjects already in an open PR
//   node scripts/pick-subject.js --stats            where the rotation currently stands

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readSeed } from './research-seed.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ann = name => JSON.parse(readFileSync(join(root, 'data', 'annotations', `${name}.json`), 'utf8'));

const algorithms = ann('algorithms').algorithms;
const concepts = ann('concepts');
const reviews = ann('reviews').reviews ?? [];

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const val = f => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1]; };

const subjects = [
  ...new Set([...Object.keys(concepts.eli5), ...concepts.additions.map(a => a.id)]),
].map(id => ({ key: `concept:${id}`, layer: 'concept', id }))
  .concat(algorithms.map(a => ({ key: `algorithm:${a.id}`, layer: 'algorithm', id: a.id, name: a.name, concept: a.concept })));

const counts = new Map(subjects.map(s => [s.key, 0]));
for (const r of reviews) {
  const key = `${r.layer}:${r.target}`;
  if (counts.has(key)) counts.set(key, counts.get(key) + 1);
}

const seeded = new Set(readSeed().ticked);
const excluded = new Set(String(val('--exclude') ?? '').split(',').map(s => s.trim()).filter(Boolean));

// A small deterministic hash. The point is only that it scatters ids consistently for a given
// round, so the order looks arbitrary but replays exactly.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

const eligible = subjects.filter(s => !excluded.has(s.key));
const lowest = Math.min(...eligible.map(s => counts.get(s.key)));

const queue = eligible
  .filter(s => counts.get(s.key) === lowest)
  .map(s => ({
    ...s,
    reviews: counts.get(s.key),
    round: counts.get(s.key) + 1,
    seed: seeded.has(s.key),
  }))
  // Seeded subjects first -- but only as a tiebreak inside the cohort, so this can never let a
  // seeded subject overtake an unseeded one that has had fewer reviews.
  .sort((a, b) => (b.seed ? 1 : 0) - (a.seed ? 1 : 0)
    || hash(`${a.key}#${a.round}`) - hash(`${b.key}#${b.round}`));

if (has('--stats')) {
  const spread = new Map();
  for (const s of subjects) spread.set(counts.get(s.key), (spread.get(counts.get(s.key)) ?? 0) + 1);
  console.log(`${subjects.length} subjects · ${reviews.length} reviews recorded`);
  for (const [n, c] of [...spread].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${String(c).padStart(4)} subjects with ${n} review${n === 1 ? '' : 's'}`);
  }
  const seedRemaining = queue.filter(s => s.seed).length;
  console.log(`\ncurrent round: ${lowest + 1}`);
  console.log(`${queue.length} subjects still owed a review this round, ${seedRemaining} of them seeded`);
  process.exit(0);
}

if (has('--list')) {
  const n = Number(val('--list')) || 25;
  console.log(`round ${lowest + 1} · ${queue.length} subjects still owed a review\n`);
  for (const s of queue.slice(0, n)) {
    console.log(`  ${s.seed ? 'seed' : '    '}  ${s.key.padEnd(44)} ${s.name ?? ''}`);
  }
  process.exit(0);
}

const count = Number(val('--count')) || 1;
const picked = queue.slice(0, count);
console.log(JSON.stringify(count === 1 ? picked[0] ?? null : picked, null, 2));
