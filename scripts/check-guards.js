// Checks that the migration's review and further-reading guards actually reject what they claim
// to reject.
//
// Every other check in this project fails loudly when the data is wrong. These two do not, and
// that is the problem: nothing renders the review tables, and the rotation picks its next
// subject from the review counts. A broken fairness check would mean the audit silently
// re-reviews one algorithm forever while another is never looked at, and no page would show it.
// A guard nobody has seen fail is a guard nobody knows works.
//
// Writes fixtures into the annotation files, runs the migration against each, and restores.
// The restore is in a finally block because a crash halfway through would otherwise leave the
// catalogue holding test data.

import { readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REV = join(root, 'data', 'annotations', 'reviews.json');
const FUR = join(root, 'data', 'annotations', 'further-reading.json');
const results = [];

try {
  copyFileSync(REV, `${REV}.bak`);
  copyFileSync(FUR, `${FUR}.bak`);
  const baseRev = JSON.parse(readFileSync(`${REV}.bak`, 'utf8'));
  const baseFur = JSON.parse(readFileSync(`${FUR}.bak`, 'utf8'));

  const model = { model: 'gemini-3.6-flash', provider: 'google', verdict: { year: 1985 }, unsure: false };
  const review = (target, round, agreement = 'confirmed') =>
    ({ layer: 'algorithm', target, round, reviewed: '2026-08-18', agreement, models: [model] });
  const link = {
    layer: 'algorithm', target: 'perlin-noise', url: 'https://example.com/a', title: 'A',
    kind: 'article', found_by: 'gemini-2.5-flash', http_status: 200, verified: '2026-08-18',
  };

  const run = (label, reviews, reading, expectRejected) => {
    writeFileSync(REV, `${JSON.stringify({ ...baseRev, reviews }, null, 2)}\n`);
    writeFileSync(FUR, `${JSON.stringify({ ...baseFur, reading }, null, 2)}\n`);
    let rejected = false, out = '';
    try { execSync('node scripts/migrate.js', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { rejected = true; out = (e.stdout ?? '') + (e.stderr ?? ''); }
    const ok = rejected === expectRejected;
    const why = out.split('\n').find(l => l.trim().startsWith('- '))?.trim().slice(2) ?? '';
    results.push({ ok, label, expectRejected, why });
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(44)} ${expectRejected ? 'rejected' : 'accepted'}`);
    if (!ok) console.log(`        expected it to be ${expectRejected ? 'rejected' : 'accepted'} and it was not`);
  };

  console.log('review and further-reading guards\n');

  // One subject at round 1 while everything else is at 0. A spread of exactly 1 is the normal
  // state of a round in progress and must be allowed.
  run('one review, round 1', [review('perlin-noise', 1)], [], false);
  run('a subject two rounds ahead of the rest', [review('perlin-noise', 1), review('perlin-noise', 2)], [], true);
  run('rounds 1 and 3 with no 2', [review('perlin-noise', 1), review('perlin-noise', 3)], [], true);
  run('review of an algorithm that does not exist', [review('not-a-real-algorithm', 1)], [], true);
  run('unknown agreement value', [review('perlin-noise', 1, 'looks-fine')], [], true);
  run('review recording no model answers', [{ ...review('perlin-noise', 1), models: [] }], [], true);
  run('unknown provider', [{ ...review('perlin-noise', 1), models: [{ ...model, provider: 'openai' }] }], [], true);

  run('accepted link, fetched and titled', [], [link], false);
  run('accepted link never fetched', [], [{ ...link, http_status: null }], true);
  run('accepted link with a 404', [], [{ ...link, http_status: 404 }], true);
  run('accepted link with no title to match', [], [{ ...link, title: null }], true);
  run('rejected link with no reason', [], [{ ...link, rejected: true, http_status: 404 }], true);
  run('rejected link with a reason', [], [{ ...link, rejected: true, http_status: 404, reason: 'gone' }], false);
  run('the same url twice for one subject', [], [link, { ...link, title: 'B' }], true);
} finally {
  for (const f of [REV, FUR]) {
    if (existsSync(`${f}.bak`)) { copyFileSync(`${f}.bak`, f); rmSync(`${f}.bak`); }
  }
  // Leave the database matching the restored annotations rather than the last fixture. If this
  // fails the database is still holding fixture data, which is exactly what this script exists
  // to prevent — so it is a failure of the whole check, not something to swallow.
  try { execSync('node scripts/migrate.js', { cwd: root, stdio: 'ignore' }); }
  catch { results.push({ ok: false, label: 'restore migration (database may hold fixture data)' }); }
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} guards behaved as specified`);
if (failed.length) {
  console.error(`\n${failed.length} did not:`);
  for (const f of failed) console.error(`  - ${f.label}`);
  process.exit(1);
}
