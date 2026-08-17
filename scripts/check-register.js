// Keep the plain-language explanations plain, and stop them drifting back into baby talk.
//
// "Explain like I'm five" is an idiom for "drop the jargon". The first pass read it literally
// and produced text full of tiny arrows, little dots and pretend worlds, which patronised the
// reader without explaining any more than the plain version does. This checks the specific
// habit rather than the general tone, because a lint that cries wolf gets switched off.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ann = name => JSON.parse(readFileSync(join(root, 'data', 'annotations', `${name}.json`), 'utf8'));

const algorithms = ann('algorithms');
const concepts = ann('concepts');

const texts = [
  ...algorithms.algorithms.map(a => [`algorithm:${a.id}`, a.eli5]),
  ...Object.entries(concepts.eli5).map(([id, t]) => [`concept:${id}`, t]),
  ...concepts.additions.map(a => [`concept:${a.id}`, a.eli5]),
];

// Never appropriate here: each one is a diminutive or a hedge that adds nothing.
const BANNED = ['tiny', 'teeny', 'itty', 'dumb', 'stupid', 'silly', 'wonky', 'pretend',
  'imaginary', 'magic', 'thingy', 'doohickey'];

// `little` is fine as a quantifier — "a little accuracy", "too little clearance" — and wrong
// as a descriptor: "a little arrow", "little dots". Allow only the quantifier forms.
const LITTLE_OK = /\b(a|too|very|so|how|as)\s+little\b|\blittle\s+(visible|more|less|point|use|difference|reason)\b/i;

const problems = [];
for (const [id, text] of texts) {
  if (!text) { problems.push(`${id}: no explanation`); continue; }
  for (const w of BANNED) {
    const m = text.match(new RegExp(`.{0,50}\\b${w}\\w*.{0,50}`, 'i'));
    if (m) problems.push(`${id}: "${w}" — …${m[0].trim()}…`);
  }
  for (const m of text.matchAll(/.{0,40}\blittle\b.{0,40}/gi)) {
    if (!LITTLE_OK.test(m[0])) problems.push(`${id}: "little" as a descriptor — …${m[0].trim()}…`);
  }
  const words = text.split(/\s+/).length;
  if (words < 20) problems.push(`${id}: ${words} words — too short to explain anything`);
  if (words > 110) problems.push(`${id}: ${words} words — that is a description, not an explanation`);
}

const lens = texts.map(([, t]) => (t ?? '').split(/\s+/).length).sort((a, b) => a - b);
console.log(`${texts.length} explanations checked`);
console.log(`words each: min ${lens[0]}, median ${lens[lens.length >> 1]}, max ${lens[lens.length - 1]}`);

if (problems.length) {
  console.error(`\n${problems.length} problems:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('register ok');
