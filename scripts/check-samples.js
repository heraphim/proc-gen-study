// Run every code sample and fail if any of them does not execute.
//
// The algorithms page claims each sample is the whole mechanism and runs as written. The
// migration already enforces the line limit; this enforces the other half, so the claim stays
// true after an edit rather than only at the moment it was made.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ann = JSON.parse(readFileSync(join(root, 'data', 'annotations', 'code-samples.json'), 'utf8'));

const RUNNER = {
  js: { ext: 'js', cmd: 'node' },
  python: { ext: 'py', cmd: process.platform === 'win32' ? 'python' : 'python3' },
};

const dir = mkdtempSync(join(tmpdir(), 'procgen-samples-'));
const failures = [];
let ran = 0, skipped = 0;

for (const [algoId, samples] of Object.entries(ann.samples ?? {})) {
  for (const s of samples) {
    const runner = RUNNER[s.technology];
    if (!runner) { skipped++; console.log(`  skip  ${algoId} (${s.technology}: no runner)`); continue; }

    const file = join(dir, `${algoId}.${runner.ext}`);
    const code = Array.isArray(s.code) ? s.code.join('\n') : String(s.code);
    writeFileSync(file, code);

    const started = Date.now();
    try {
      execFileSync(runner.cmd, [file], { cwd: dir, stdio: 'pipe', timeout: 180000 });
      ran++;
      console.log(`  ok    ${algoId} (${s.technology}, ${code.split('\n').length} lines, ${Date.now() - started} ms)`);
    } catch (e) {
      const detail = String(e.stderr ?? e.stdout ?? e.message).trim().split('\n').slice(0, 4).join(' / ');
      failures.push(`${algoId} (${s.technology}): ${detail}`);
      console.log(`  FAIL  ${algoId} (${s.technology})`);
    }
  }
}

rmSync(dir, { recursive: true, force: true });

console.log(`\n${ran} samples ran, ${skipped} skipped, ${failures.length} failed`);
if (failures.length) {
  console.error('\nsamples that did not execute:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
