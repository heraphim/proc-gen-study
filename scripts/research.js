// Asks three models about one subject at a time, compares their answers mechanically, and
// records what came of it.
//
// The catalogue's algorithm records were largely written by one model. Checking them with that
// same model repeats its blind spots instead of catching them, so the three here are from three
// labs -- Google, Meta via Groq, and whatever open-weight model Cerebras is serving. Note that
// running the same open weights at two providers would buy nothing: one opinion delivered
// twice is not corroboration.
//
// Two rules do the real work.
//
// Ask blind. A model is never shown what this catalogue currently claims, only asked what it
// knows. Show it the existing answer and it agrees with it, and agreement obtained that way
// carries no information at all.
//
// Compare mechanically. No model adjudicates, because the model that would be judging is the
// one whose output is on trial. The comparison below is a diff, not a verdict, and the four
// outcomes are not equally interesting: two models agreeing against this catalogue is the
// finding, while two models disagreeing with each other says the subject cannot be settled from
// recall -- which is also how the original claim was probably made.
//
//   node scripts/research.js --measure 5      run 5 subjects, report token cost, write nothing
//   node scripts/research.js --dry-run        run the budget's worth, print, write nothing
//   node scripts/research.js                  run the budget's worth and record it
//   node scripts/research.js --subject algorithm:perlin-noise
//
// Needs GEMINI_API_KEY, GROQ_API_KEY and CEREBRAS_API_KEY.

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const annPath = name => join(root, 'data', 'annotations', `${name}.json`);
const ann = name => JSON.parse(readFileSync(annPath(name), 'utf8').replace(/\r\n/g, '\n'));

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const val = f => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1]; };

const today = process.env.RESEARCH_DATE || new Date().toISOString().slice(0, 10);
const UA = 'procgen-catalogue research (https://github.com/heraphim/proc-gen-study)';

// Daily free-tier token allowances. These are starting estimates and the run corrects them from
// response headers where a provider sends them; --measure exists to replace the guesswork with
// this catalogue's own measured cost per subject.
const PROVIDERS = {
  google: {
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    key: () => process.env.GEMINI_API_KEY,
    dailyTokens: Number(process.env.GEMINI_DAILY_TOKENS || 1_000_000),
    canBrowse: true,
  },
  groq: {
    // Not gpt-oss-120b, which Groq also serves — Cerebras is already running those exact
    // weights, and the same weights at two providers is one opinion delivered twice. Qwen is a
    // different lab entirely, which is the only property that matters here.
    model: process.env.GROQ_MODEL || 'qwen/qwen3.6-27b',
    key: () => process.env.GROQ_API_KEY,
    dailyTokens: Number(process.env.GROQ_DAILY_TOKENS || 100_000),
    canBrowse: false,
  },
  cerebras: {
    model: process.env.CEREBRAS_MODEL || 'gpt-oss-120b',
    key: () => process.env.CEREBRAS_API_KEY,
    dailyTokens: Number(process.env.CEREBRAS_DAILY_TOKENS || 1_000_000),
    canBrowse: false,
  },
};

// Half by default, so a day's research does not consume the whole free allowance and leave
// nothing for anything else.
const FRACTION = Number(val('--budget-fraction') ?? 0.5);

// A subject researched by one model is not a three-way comparison, and a subject researched by
// none is not research. Without keys the run would still walk the queue and record every subject
// as `inconclusive`, consuming its place in the rotation and leaving the catalogue looking
// checked when nothing was ever asked. Refuse instead.
const available = Object.entries(PROVIDERS).filter(([, p]) => p.key()).map(([k]) => k);
if (available.length < 2) {
  console.error(`only ${available.length} of 3 providers have an API key${available.length ? ` (${available.join(', ')})` : ''}.`);
  console.error('Set GEMINI_API_KEY, GROQ_API_KEY and CEREBRAS_API_KEY.');
  console.error('Two is the minimum: with one model there is nothing to compare against, and its');
  console.error('agreement with the catalogue would mean nothing.');
  process.exit(1);
}
if (available.length === 2) console.error(`warning: only ${available.join(' and ')} have keys — this run is two-way\n`);

// The decorrelation trap, made a hard error because it is invisible when it happens and it
// silently destroys the entire premise. Groq and Cerebras both serve gpt-oss-120b. Point two
// providers at the same weights and you get one model's answer twice, which the comparison then
// reads as two independent models agreeing — the strongest signal it can produce, manufactured
// out of nothing. Different vendor is not different model.
const weights = m => String(m).split('/').pop().toLowerCase();
const seenWeights = new Map();
for (const k of available) {
  const w = weights(PROVIDERS[k].model);
  if (seenWeights.has(w)) {
    console.error(`${seenWeights.get(w)} and ${k} are both set to "${w}".`);
    console.error('Those are the same weights, so their answers are not independent and any');
    console.error('agreement between them is an echo. Set a different model for one of them.');
    process.exit(1);
  }
  seenWeights.set(w, k);
}

// Model names go stale faster than anything else here -- providers retire them on their own
// schedule and a wrong one fails as an opaque 400 or 404. This asks each provider what it
// actually serves today, which is one round trip instead of three guesses.
if (has('--list-models')) {
  const get = async (url, headers) => {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, ...headers } });
      if (!r.ok) return { error: `HTTP ${r.status}: ${(await r.text()).slice(0, 300)}` };
      return { data: await r.json() };
    } catch (e) { return { error: e.message }; }
  };

  const show = (label, r, names) => {
    if (r.error) { console.log(`\n${label}\n  FAILED  ${r.error}`); return; }
    const list = names(r.data) ?? [];
    console.log(`\n${label}  (${list.length})`);
    for (const n of list.slice(0, 40)) console.log(`  ${n}`);
  };

  if (PROVIDERS.google.key()) {
    show('google', await get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
      { 'x-goog-api-key': PROVIDERS.google.key() }),
      d => (d.models ?? []).filter(m => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map(m => m.name?.replace(/^models\//, '')));
  }
  if (PROVIDERS.groq.key()) {
    show('groq', await get('https://api.groq.com/openai/v1/models',
      { authorization: `Bearer ${PROVIDERS.groq.key()}` }), d => (d.data ?? []).map(m => m.id));
  }
  if (PROVIDERS.cerebras.key()) {
    show('cerebras', await get('https://api.cerebras.ai/v1/models',
      { authorization: `Bearer ${PROVIDERS.cerebras.key()}` }), d => (d.data ?? []).map(m => m.id));
  }
  console.log(`\ncurrently configured: google ${PROVIDERS.google.model} · groq ${PROVIDERS.groq.model} · cerebras ${PROVIDERS.cerebras.model}`);
  process.exit(0);
}

const spent = { google: 0, groq: 0, cerebras: 0 };
const budget = Object.fromEntries(
  Object.entries(PROVIDERS).map(([k, p]) => [k, Math.floor(p.dailyTokens * FRACTION)]));

// ---- transport --------------------------------------------------------------

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function post(url, body, headers) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': UA, ...headers },
        body: JSON.stringify(body),
      });
    } catch (e) { if (attempt === 2) return { error: e.message }; await sleep(800 * (attempt + 1)); continue; }

    // 429 is the whole reason this script has a budget. Treat it as the day being over rather
    // than something to retry into.
    if (res.status === 429) return { exhausted: true, error: 'rate limited' };
    if (res.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
    if (!res.ok) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { data: await res.json(), headers: res.headers };
  }
  return { error: 'gave up after 3 attempts' };
}

// Everything except Gemini speaks the OpenAI shape, so one caller covers two providers.
async function askOpenAIShape(provider, base, prompt) {
  const p = PROVIDERS[provider];
  const r = await post(`${base}/chat/completions`, {
    model: p.model,
    messages: [
      { role: 'system', content: 'You answer from what you know. If you are not confident, say so by setting unsure to true rather than guessing. Reply with JSON only.' },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
  }, { authorization: `Bearer ${p.key()}` });

  if (!r.data) return r;
  const tokens = r.data.usage?.total_tokens ?? 0;
  spent[provider] += tokens;
  return { answer: parseJSON(r.data.choices?.[0]?.message?.content), tokens };
}

async function askGemini(prompt, { grounded = false } = {}) {
  const p = PROVIDERS.google;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, ...(grounded ? {} : { responseMimeType: 'application/json' }) },
    // Grounding and forced-JSON output cannot both be on, so the link pass asks for grounded
    // text and the JSON is pulled back out of it.
    ...(grounded ? { tools: [{ google_search: {} }] } : {}),
  };
  const r = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent`,
    body, { 'x-goog-api-key': p.key() });

  if (!r.data) return r;
  const tokens = r.data.usageMetadata?.totalTokenCount ?? 0;
  spent.google += tokens;
  const text = (r.data.candidates?.[0]?.content?.parts ?? []).map(x => x.text ?? '').join('');
  return { answer: parseJSON(text), tokens, raw: text };
}

// Models wrap JSON in prose or fences often enough that this is not optional.
function parseJSON(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* give up */ } }
  return null;
}

// ---- the questions ----------------------------------------------------------
//
// Neither prompt mentions what this catalogue says. That is the point: anchoring a model on the
// existing answer turns agreement into an echo.

const attributionPrompt = name => `For the algorithm or method known as "${name}", identify the originating publication.

Answer only with JSON in this exact shape:
{"year": <number or null>, "authors": [<surnames as strings>], "title": <string or null>, "venue": <string or null>, "unsure": <true or false>}

Give the paper that introduced the method, not the paper that popularised it or applied it to a new field. If you are not confident which publication is the original, set "unsure" to true rather than naming a likely-sounding one.`;

const membershipPrompt = name => `List the named, published algorithms or methods that belong to the field of "${name}" in procedural generation and computer graphics.

Answer only with JSON in this exact shape:
{"methods": [<names as strings>], "unsure": <true or false>}

Name at most twelve, most central first. Use the standard name of each method. Do not invent names.`;

const linkPrompt = name => `Find articles, tutorials, talks or write-ups explaining "${name}" for a technical reader.

Answer only with JSON in this exact shape:
{"links": [{"url": <string>, "title": <string>, "kind": "article" | "blog" | "video" | "docs" | "paper"}]}

At most six. Only include pages you are confident exist at that exact URL. Fewer real ones is better than more invented ones.`;

// ---- comparison -------------------------------------------------------------

const surnames = list => new Set((list ?? [])
  .flatMap(a => String(a).split(/[,&]| and /))
  .map(s => s.trim().split(/\s+/).pop()?.toLowerCase())
  .filter(Boolean));

const sameAuthors = (a, b) => {
  const [x, y] = [surnames(a), surnames(b)];
  if (!x.size || !y.size) return false;
  const shared = [...x].filter(s => y.has(s)).length;
  return shared / Math.min(x.size, y.size) >= 0.5;
};

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Four outcomes, and which one a subject lands in is the whole result.
function classifyAttribution(record, answers) {
  const usable = answers.filter(a => a.answer && !a.answer.unsure && a.answer.year);
  if (usable.length < 2) return { agreement: 'inconclusive', note: `${answers.length - usable.length} of ${answers.length} models abstained or gave no year` };

  // Do at least two models agree with each other?
  let consensus = null;
  for (let i = 0; i < usable.length; i++) {
    const peers = usable.filter((o, j) => j !== i && o.answer.year === usable[i].answer.year);
    if (peers.length) { consensus = usable[i].answer; break; }
  }
  if (!consensus) {
    return {
      agreement: 'models-disagree',
      note: `years offered: ${usable.map(u => `${u.provider} ${u.answer.year}`).join(', ')}. Nothing here settles the record, and the same is probably true of however it was first written.`,
    };
  }

  const yearMatches = Number(record.year) === Number(consensus.year);
  const authorsMatch = sameAuthors(record.authors?.split(/[,;]| and /), consensus.authors);
  if (yearMatches && authorsMatch) {
    return { agreement: 'confirmed', note: `${usable.length} models agree on ${consensus.year}, matching the record` };
  }
  return {
    agreement: 'against-catalogue',
    note: `models agree on ${consensus.year} — ${(consensus.authors ?? []).join(', ')} (${consensus.title ?? 'title not given'}); the record says ${record.year} — ${record.authors}`,
  };
}

function classifyMembership(known, answers) {
  const usable = answers.filter(a => Array.isArray(a.answer?.methods));
  if (usable.length < 2) return { agreement: 'inconclusive', note: 'fewer than two models returned a usable list', missing: [] };

  const haveNorm = new Set(known.map(norm));
  const proposals = new Map();
  for (const u of usable) {
    for (const m of u.answer.methods) {
      const k = norm(m);
      if (!k || haveNorm.has(k)) continue;
      if (!proposals.has(k)) proposals.set(k, { name: m, by: [] });
      proposals.get(k).by.push(u.provider);
    }
  }
  // One model naming something is a suggestion. Two independently naming the same thing is a gap.
  const agreed = [...proposals.values()].filter(p => p.by.length >= 2);
  if (!agreed.length) return { agreement: 'confirmed', note: `no method was named by two models that the catalogue does not already have`, missing: [] };
  return {
    agreement: 'against-catalogue',
    note: `named by two or more models and absent here: ${agreed.map(p => p.name).join(', ')}`,
    missing: agreed.map(p => p.name),
  };
}

// ---- link verification ------------------------------------------------------
//
// A model with no browsing tool answers from memory, so a URL it produces is a claim. Fetching
// it is the check, and a 200 alone is not enough: a live page that is not the page described is
// the same failure as a dead one. This is the rule implementations.json already applies to
// packages, pointed at links.

const titleOf = html => html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1]
  ?.replace(/\s+/g, ' ').trim() ?? null;

async function verifyLink(url, claimed) {
  let res;
  try {
    res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
  } catch (e) { return { http_status: null, rejected: true, reason: 'unreachable', detail: e.message }; }

  if (res.status === 404 || res.status === 410) return { http_status: res.status, rejected: true, reason: 'gone' };
  if (!res.ok) return { http_status: res.status, rejected: true, reason: 'unreachable' };

  const html = (await res.text()).slice(0, 20000);
  const title = titleOf(html);
  if (!title) return { http_status: res.status, rejected: true, reason: 'title-mismatch', detail: 'page has no title' };

  // Loose on purpose: a real page's title often differs in punctuation or a site suffix. What
  // this rejects is a page about something else entirely.
  const a = new Set(norm(claimed).split(' ').filter(w => w.length > 3));
  const b = norm(title);
  const overlap = [...a].filter(w => b.includes(w)).length;
  if (a.size && overlap / a.size < 0.34) {
    return { http_status: res.status, title, rejected: true, reason: 'title-mismatch', detail: `page is titled "${title}"` };
  }
  return { http_status: res.status, title, rejected: false };
}

// ---- one subject ------------------------------------------------------------

const algorithms = ann('algorithms').algorithms;
const concepts = ann('concepts');

async function research(subject) {
  const isAlgorithm = subject.layer === 'algorithm';
  const record = isAlgorithm ? algorithms.find(a => a.id === subject.id) : null;
  const displayName = isAlgorithm ? record.name : (subject.name ?? subject.id);
  const known = isAlgorithm ? [] : algorithms.filter(a => a.concept === subject.id).map(a => a.name);
  const prompt = isAlgorithm ? attributionPrompt(displayName) : membershipPrompt(displayName);

  const models = [];
  const answers = [];
  const failures = [];
  for (const [provider, p] of Object.entries(PROVIDERS)) {
    if (!p.key()) { models.push({ provider, model: p.model, verdict: null, unsure: true, tokens: 0, skipped: 'no key' }); continue; }
    const r = provider === 'google'
      ? await askGemini(prompt)
      : await askOpenAIShape(provider, provider === 'groq' ? 'https://api.groq.com/openai/v1' : 'https://api.cerebras.ai/v1', prompt);
    if (r.exhausted) return { exhausted: provider };
    if (r.error) {
      // Loud, and counted. A failed call is not a model declining to answer, and the difference
      // matters: abstention is a finding, a broken request is a bug wearing its costume.
      console.error(`      ${provider} failed: ${r.error}`);
      failures.push({ provider, error: r.error });
      models.push({ provider, model: p.model, verdict: null, unsure: true, tokens: 0 });
      continue;
    }
    const answer = r.answer ?? null;
    answers.push({ provider, answer });
    models.push({
      provider, model: p.model, verdict: answer,
      unsure: Boolean(answer?.unsure ?? true), tokens: r.tokens ?? 0,
    });
  }

  // A subject where fewer than two models actually answered was not reviewed. Recording it as
  // `inconclusive` would consume its place in the rotation and leave the catalogue looking
  // checked, which is the failure this whole design exists to avoid.
  if (answers.length < 2) {
    return { unanswered: true, failures, subject };
  }

  const verdict = isAlgorithm ? classifyAttribution(record, answers) : classifyMembership(known, answers);

  // Only Gemini can actually look anything up. Asking the other two for URLs would be asking
  // them to invent some.
  const links = [];
  if (PROVIDERS.google.key()) {
    const r = await askGemini(linkPrompt(displayName), { grounded: true });
    for (const l of (r.answer?.links ?? []).slice(0, 6)) {
      if (!l?.url) continue;
      const check = await verifyLink(l.url, l.title ?? displayName);
      links.push({
        layer: subject.layer, target: subject.id, url: l.url,
        title: check.title ?? l.title ?? null, kind: l.kind ?? 'article',
        found_by: PROVIDERS.google.model, verified: today, ...check,
      });
    }
  }

  return {
    review: {
      layer: subject.layer, target: subject.id, round: subject.round,
      reviewed: today, agreement: verdict.agreement, note: verdict.note,
      models: models.map(({ skipped, error, ...m }) => m),
    },
    links, verdict, displayName,
  };
}

// ---- run --------------------------------------------------------------------

const pick = n => JSON.parse(execSync(
  `node scripts/pick-subject.js --count ${n}${val('--exclude') ? ` --exclude ${val('--exclude')}` : ''}`,
  { cwd: root, encoding: 'utf8' }));

const measuring = has('--measure');
const writes = !measuring && !has('--dry-run');
let planned = Number(val('--measure') ?? val('--count') ?? 0);

if (val('--subject')) {
  const [layer, ...rest] = val('--subject').split(':');
  const id = rest.join(':');
  planned = 1;
  var subjects = [{ key: val('--subject'), layer, id, round: 1 }];
} else {
  // Without an explicit count, take the budget's worth. The first run has no measured cost yet,
  // so it starts small and the number below gets real once there is history.
  const measured = measuredCostPerSubject();
  if (!planned) {
    planned = measured
      ? Math.max(1, Math.min(...Object.entries(budget).map(([k, b]) => Math.floor(b / Math.max(1, measured[k] ?? 1)))))
      : 5;
    console.log(measured
      ? `budget allows ${planned} subjects at the measured cost (${FRACTION * 100}% of the daily allowance)`
      : `no measured cost yet — starting with ${planned} subjects to establish one`);
  }
  var subjects = pick(planned);
  if (!Array.isArray(subjects)) subjects = [subjects];
}

function measuredCostPerSubject() {
  const reviews = ann('reviews').reviews ?? [];
  if (reviews.length < 3) return null;
  const totals = {}, counts = {};
  for (const r of reviews) for (const m of r.models ?? []) {
    if (!m.tokens) continue;
    totals[m.provider] = (totals[m.provider] ?? 0) + m.tokens;
    counts[m.provider] = (counts[m.provider] ?? 0) + 1;
  }
  if (!Object.keys(totals).length) return null;
  return Object.fromEntries(Object.entries(totals).map(([k, t]) => [k, Math.ceil(t / counts[k])]));
}

const done = [];
const unanswered = [];
const allLinks = [];
let stopped = null;

for (const s of subjects) {
  const overspent = Object.entries(spent).find(([k, v]) => v >= budget[k]);
  if (overspent) { stopped = `${overspent[0]} reached its ${FRACTION * 100}% budget`; break; }

  const out = await research(s);
  if (out.exhausted) { stopped = `${out.exhausted} is rate limited — the day's allowance is gone`; break; }
  if (out.unanswered) {
    unanswered.push(out);
    console.error(`  SKIPPED            ${s.key.padEnd(42)} fewer than two models answered — not recorded, round not consumed`);
    continue;
  }

  done.push(out);
  allLinks.push(...out.links);
  const cost = out.review.models.reduce((n, m) => n + (m.tokens ?? 0), 0);
  const kept = out.links.filter(l => !l.rejected).length;
  console.log(`  ${out.review.agreement.padEnd(18)} ${s.key.padEnd(42)} ${String(cost).padStart(6)} tokens · ${kept}/${out.links.length} links kept`);
  if (out.verdict.note) console.log(`      ${out.verdict.note}`);
}

console.log('');
const byAgreement = {};
for (const d of done) byAgreement[d.review.agreement] = (byAgreement[d.review.agreement] ?? 0) + 1;
console.log(`${done.length} subjects researched: ${Object.entries(byAgreement).map(([k, v]) => `${v} ${k}`).join(' · ') || 'none'}`);
console.log(`links: ${allLinks.filter(l => !l.rejected).length} verified, ${allLinks.filter(l => l.rejected).length} rejected and kept as evidence`);
if (stopped) console.log(`stopped early: ${stopped}`);

console.log('\ntokens spent, against a budget of ' + `${FRACTION * 100}% of each daily allowance:`);
for (const [k, v] of Object.entries(spent)) {
  const per = done.length ? Math.round(v / done.length) : 0;
  console.log(`  ${k.padEnd(10)} ${String(v).padStart(8)} / ${String(budget[k]).padStart(8)}   ${String(per).padStart(6)} per subject`);
}
// Only meaningful once something was actually spent; otherwise the arithmetic divides by a
// cost of zero and reports that the budget affords everything.
const anySpend = Object.values(spent).some(v => v > 0);
if (done.length && anySpend) {
  const affordable = Math.min(...Object.entries(budget)
    .filter(([k]) => spent[k] > 0)
    .map(([k, b]) => Math.floor(b / (spent[k] / done.length))));
  console.log(`\nat this rate a run affords ${affordable} subjects, so ${Math.ceil(220 / Math.max(1, affordable))} runs complete a round of all 220.`);
}

if (val('--markdown')) {
  const L = [];
  const order = ['against-catalogue', 'models-disagree', 'inconclusive', 'confirmed'];
  const group = a => done.filter(d => d.review.agreement === a);

  L.push(`Round ${subjects[0]?.round ?? 1} · ${done.length} subjects · ${today}`);
  L.push('');
  L.push(`Asked ${available.join(', ')}. Each model was asked what it knows, never whether this`);
  L.push('catalogue is right — showing it the existing answer would turn agreement into an echo.');
  L.push('The comparison below is a diff, not a verdict: no model judged another.');
  if (stopped) L.push('', `Stopped early: ${stopped}`);

  for (const a of order) {
    const g = group(a);
    if (!g.length) continue;
    const heading = {
      'against-catalogue': 'The models agree with each other and not with this catalogue',
      'models-disagree': 'The models do not agree with each other',
      inconclusive: 'Not enough usable answers',
      confirmed: 'Confirmed',
    }[a];
    if (a === 'confirmed') {
      L.push('', `## ${heading} (${g.length})`, '');
      L.push(g.map(d => `\`${d.review.layer}:${d.review.target}\``).join(', '));
      continue;
    }
    L.push('', `## ${heading} (${g.length})`, '');
    for (const d of g) {
      L.push(`**\`${d.review.layer}:${d.review.target}\`** — ${d.displayName}`);
      L.push('');
      L.push(d.review.note);
      L.push('');
      for (const m of d.review.models) {
        const v = m.verdict;
        const said = v?.year ? `${v.year} — ${(v.authors ?? []).join(', ')}` : v?.methods ? v.methods.slice(0, 8).join(', ') : 'no usable answer';
        L.push(`- ${m.provider} (\`${m.model}\`)${m.unsure ? ', unsure' : ''}: ${said}`);
      }
      L.push('');
    }
  }

  const kept = allLinks.filter(l => !l.rejected);
  const binned = allLinks.filter(l => l.rejected);
  L.push('', `## Further reading`, '');
  L.push(`${kept.length} links verified, ${binned.length} rejected. A link is kept only if it answered 200 and its title matched what it was described as; a live page that is not the page described fails the same way a dead one does.`);
  if (binned.length) {
    L.push('', `Rejected candidates are kept as rows. Two of the three models cannot browse, so the share of URLs they invent is the measure of how far to trust them — and that number is the argument for asking three.`, '');
    const why = {};
    for (const l of binned) why[l.reason] = (why[l.reason] ?? 0) + 1;
    for (const [r, n] of Object.entries(why)) L.push(`- ${n} × ${r}`);
  }

  L.push('', '## Tokens', '');
  L.push('| provider | spent | budget | per subject |');
  L.push('| --- | --- | --- | --- |');
  for (const [k, v] of Object.entries(spent)) {
    L.push(`| ${k} | ${v} | ${budget[k]} | ${done.length ? Math.round(v / done.length) : 0} |`);
  }
  L.push('', `Budget is ${FRACTION * 100}% of each provider's daily free allowance, so a run leaves the rest of the day's quota alone.`);

  writeFileSync(val('--markdown'), `${L.join('\n')}\n`);
}

if (unanswered.length) {
  const why = {};
  for (const u of unanswered) for (const f of u.failures) why[`${f.provider}: ${f.error}`] = (why[`${f.provider}: ${f.error}`] ?? 0) + 1;
  console.error(`
${unanswered.length} subjects were skipped because fewer than two models answered:`);
  for (const [k, n] of Object.entries(why)) console.error(`  ${n} x  ${k}`);
}

if (writes && done.length) {
  const reviews = ann('reviews');
  reviews.reviews = [...(reviews.reviews ?? []), ...done.map(d => d.review)];
  writeFileSync(annPath('reviews'), `${JSON.stringify(reviews, null, 2)}\n`);

  const reading = ann('further-reading');
  reading.reading = [...(reading.reading ?? []), ...allLinks.map(({ detail, ...l }) => l)];
  writeFileSync(annPath('further-reading'), `${JSON.stringify(reading, null, 2)}\n`);

  console.log(`\nrecorded ${done.length} reviews and ${allLinks.length} links`);
} else if (done.length) {
  console.log(`\nnothing written (${measuring ? '--measure' : '--dry-run'})`);
}

// A run where every call failed is a broken run, not a quiet one. Without this it exits 0 and
// the workflow reports success over five subjects nothing was ever asked about.
if (!done.length && unanswered.length) {
  console.error('\nno subject was answered by two models. Nothing was researched.');
  process.exit(1);
}
