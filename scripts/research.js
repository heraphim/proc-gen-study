// Asks three models about one subject at a time, compares their answers mechanically, and
// records what came of it.
//
// The catalogue's algorithm records were largely written by Claude. Checking them with Claude
// repeats its blind spots instead of catching them, so no seat here may run it -- that is
// enforced, not just intended -- and the seats hold models from as many different labs as there
// are keys for.
//
// What must differ between seats is the model family, not the vendor. One vendor may hold two
// seats; two vendors re-hosting the same weights may not, because that is one opinion delivered
// twice and the comparison would read it as corroboration.
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
//   node scripts/research.js --debug --count 2   print every model's raw reply
//   node scripts/research.js --links             also gather links -- see the note in research()
//                                                before using this; it currently finds nothing
//
// Every seat with a key is used. Known: GEMINI_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY,
// COHERE_API_KEY, OPENROUTER_API_KEY, CEREBRAS_API_KEY. Two seats from two families is the
// minimum; a seat whose provider refuses is dropped for the run rather than ending it.

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

// Every seat this can use. Which are active is decided below by which have keys.
//
// dailyRequests is what a run budgets against, because requests are what these providers
// actually ration -- the earlier token budget was never once the thing that stopped a run. The
// numbers are conservative starting points; a 429 disables the seat regardless, so being wrong
// here costs one request rather than a bad run.
const SEATS = {
  google: {
    transport: 'google',
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    key: () => process.env.GEMINI_API_KEY,
    dailyRequests: Number(process.env.GEMINI_DAILY_REQUESTS || 50),
    canBrowse: true,
  },
  groq: {
    transport: 'openai',
    base: 'https://api.groq.com/openai/v1',
    model: process.env.GROQ_MODEL || 'qwen/qwen3.6-27b',
    // Qwen reasons out loud and would otherwise spend the whole reply doing it, returning no
    // JSON at all -- which reads downstream as a model that abstained rather than one cut off.
    extra: { reasoning_format: 'hidden' },
    key: () => process.env.GROQ_API_KEY,
    dailyRequests: Number(process.env.GROQ_DAILY_REQUESTS || 100),
    canBrowse: false,
  },
  'groq-oss': {
    transport: 'openai',
    base: 'https://api.groq.com/openai/v1',
    model: process.env.GROQ_OSS_MODEL || 'openai/gpt-oss-120b',
    key: () => process.env.GROQ_API_KEY,
    dailyRequests: Number(process.env.GROQ_OSS_DAILY_REQUESTS || 100),
    canBrowse: false,
  },
  cerebras: {
    // On hold: every plan including free reports its quota unavailable and it answers 402. Left
    // configured, but out of the default line-up -- with a key present it would otherwise claim
    // a seat and collide with groq-oss, since gpt-oss-120b is the only chat model it serves that
    // this project would want.
    onHold: true,
    transport: 'openai',
    base: 'https://api.cerebras.ai/v1',
    model: process.env.CEREBRAS_MODEL || 'gpt-oss-120b',
    key: () => process.env.CEREBRAS_API_KEY,
    dailyRequests: Number(process.env.CEREBRAS_DAILY_REQUESTS || 100),
    canBrowse: false,
  },
  mistral: {
    transport: 'openai',
    base: 'https://api.mistral.ai/v1',
    model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
    key: () => process.env.MISTRAL_API_KEY,
    dailyRequests: Number(process.env.MISTRAL_DAILY_REQUESTS || 100),
    canBrowse: false,
  },
  cohere: {
    transport: 'openai',
    base: 'https://api.cohere.ai/compatibility/v1',
    model: process.env.COHERE_MODEL || 'command-a-plus-05-2026',
    key: () => process.env.COHERE_API_KEY,
    dailyRequests: Number(process.env.COHERE_DAILY_REQUESTS || 100),
    canBrowse: false,
  },
  // The rotating slot. Reaches whatever is currently free without another secret, at the cost of
  // a catalogue that changes underneath us -- DeepSeek and Mistral both had free variants that
  // have since gone.
  openrouter: {
    transport: 'openai',
    base: 'https://openrouter.ai/api/v1',
    model: process.env.OPENROUTER_MODEL || 'nvidia/nemotron-3.5-lightning:free',
    key: () => process.env.OPENROUTER_API_KEY,
    dailyRequests: Number(process.env.OPENROUTER_DAILY_REQUESTS || 50),
    canBrowse: false,
  },
};

// What actually has to differ between seats.
//
// The guard used to compare model strings, which caught gpt-oss-120b against gpt-oss-120b and
// would have sailed straight past meta-llama/llama-3.3-70b on one provider against
// meta-llama/llama-3.3-70b-instruct:free on another. Same weights, different string, and the
// comparison would have read one model agreeing with itself as two models agreeing.
//
// There are perhaps eight or ten real families in reach. Everything else is a fine-tune or a
// re-host, so that number -- not the number of API keys -- is the ceiling on how many
// independent opinions this can gather.
const FAMILIES = [
  [/claude/i, 'claude', 'anthropic'],
  [/gemini/i, 'gemini', 'google'],
  [/gemma/i, 'gemma', 'google'],
  [/llama/i, 'llama', 'meta'],
  [/qwen/i, 'qwen', 'alibaba'],
  [/deepseek/i, 'deepseek', 'deepseek'],
  [/mistral|mixtral|ministral|magistral|codestral/i, 'mistral', 'mistral'],
  [/command|cohere|aya/i, 'command', 'cohere'],
  [/gpt-oss/i, 'gpt-oss', 'openai'],
  [/\bgpt-|^o[1-9]\b/i, 'gpt', 'openai'],
  [/phi-/i, 'phi', 'microsoft'],
  [/nemotron/i, 'nemotron', 'nvidia'],
  [/glm-/i, 'glm', 'zhipu'],
  [/kimi/i, 'kimi', 'moonshot'],
];
// An unrecognised model is treated as its own family rather than lumped in with anything else:
// wrongly calling two models the same is the failure that matters, and wrongly calling them
// different only costs a seat.
const familyOf = model => FAMILIES.find(([re]) => re.test(String(model)))
  ?? [null, String(model).split('/').pop().toLowerCase(), 'unknown'];

// Which seats this run uses. By default, every seat that has a key -- so adding a provider means
// adding a secret and nothing else. A seat whose provider refuses is dropped for the run rather
// than ending it, which is what makes that default safe: Cerebras still has a key and still
// answers 402, and it now costs one failed request instead of the whole run.
const ACTIVE = String(val('--providers') || process.env.RESEARCH_PROVIDERS
  || Object.entries(SEATS).filter(([, p]) => p.key() && !p.onHold).map(([k]) => k).join(','))
  .split(',').map(s => s.trim()).filter(Boolean);
const PROVIDERS = Object.fromEntries(Object.entries(SEATS).filter(([k]) => ACTIVE.includes(k)));
for (const k of ACTIVE) if (!SEATS[k]) { console.error(`unknown seat "${k}" — known: ${Object.keys(SEATS).join(', ')}`); process.exit(1); }

// Half by default, so a day's research does not consume the whole free allowance and leave
// nothing for anything else.
const FRACTION = Number(val('--budget-fraction') ?? 0.5);

// Diagnostics run before the guards below, because their whole purpose is telling you what to
// configure so those guards pass. Refusing to list models until the models are right is a
// locked door with the key inside.
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

  // Every seat with a key, not a hardcoded three. Listing models is one cheap request and is
  // normally metered separately from generation, so this is the way to check a new provider is
  // wired correctly without spending any of the quota the actual research needs.
  const seen = new Set();
  for (const [name, p] of Object.entries(SEATS)) {
    if (!p.key() || seen.has(p.base ?? name)) continue;
    seen.add(p.base ?? name);

    if (p.transport === 'google') {
      show(name, await get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
        { 'x-goog-api-key': p.key() }),
        d => (d.models ?? []).filter(m => (m.supportedGenerationMethods ?? []).includes('generateContent'))
          .map(m => m.name?.replace(/^models\//, '')));
      continue;
    }

    let r = await get(`${p.base}/models`, { authorization: `Bearer ${p.key()}` });
    // Cohere's OpenAI-compatibility layer has no /models; its own API does.
    if (r.error && /cohere/.test(p.base)) {
      r = await get('https://api.cohere.com/v1/models?page_size=100', { authorization: `Bearer ${p.key()}` });
      show(name, r, d => (d.models ?? []).filter(m => (m.endpoints ?? []).includes('chat')).map(m => m.name));
      continue;
    }
    show(name, r, d => (d.data ?? []).map(m => m.id));
  }

  console.log('\nconfigured seats:');
  for (const [k, p] of Object.entries(SEATS)) {
    const [, family, lab] = familyOf(p.model);
    console.log(`  ${k.padEnd(12)} ${String(p.model).padEnd(34)} ${family} / ${lab}${p.key() ? '' : '   (no key — inactive)'}`);
  }
  process.exit(0);
}

// Budget requests, not tokens. Every run so far has died on requests per day while the token
// budget sat almost untouched -- Gemini stopped after using 0.6% of its tokens, and OpenRouter's
// free tier does not meter tokens at all. Tokens are still counted, because the cost per subject
// is worth knowing; they are just not what runs out.
// A subject researched by one model is not a three-way comparison, and a subject researched by
// none is not research. Without keys the run would still walk the queue and record every subject
// as `inconclusive`, consuming its place in the rotation and leaving the catalogue looking
// checked when nothing was ever asked. Refuse instead.
const available = Object.entries(PROVIDERS).filter(([, p]) => p.key()).map(([k]) => k);
if (available.length < 2) {
  console.error(`only ${available.length} of ${ACTIVE.length} active seats have a key${available.length ? ` (${available.join(', ')})` : ''}.`);
  console.error(`active seats: ${ACTIVE.join(', ')}`);
  console.error('Two is the minimum: with one model there is nothing to compare against, and its');
  console.error('agreement with the catalogue would mean nothing.');
  process.exit(1);
}
if (available.length === 2) console.error(`warning: only ${available.join(' and ')} have keys — this run is two-way\n`);

// The decorrelation trap, a hard error because it is invisible while it happens and destroys the
// premise rather than degrading it. Two seats on one family produce one model's answer twice,
// which the comparison then reads as two independent models agreeing -- the strongest signal it
// can emit, manufactured out of nothing.
const seatFamily = new Map();
const seenFamily = new Map(), seenLab = new Map();
for (const k of available) {
  const [, family, lab] = familyOf(PROVIDERS[k].model);
  seatFamily.set(k, family);

  if (lab === 'anthropic') {
    console.error(`${k} is set to a Claude model.`);
    console.error('This catalogue was largely written by Claude, and checking it with Claude');
    console.error('repeats those blind spots rather than catching them. That is the whole reason');
    console.error('this script exists, so the one model it must never ask is that one.');
    process.exit(1);
  }
  if (seenFamily.has(family)) {
    console.error(`${seenFamily.get(family)} and ${k} both run the ${family} family.`);
    console.error('Their answers are not independent, so any agreement between them is an echo.');
    console.error('Point one of them at a different family.');
    process.exit(1);
  }
  seenFamily.set(family, k);

  // Not fatal. Gemma and Gemini are different models trained by the same people on overlapping
  // data, so they are less independent than their names suggest without being duplicates.
  if (lab !== 'unknown' && seenLab.has(lab)) {
    console.error(`note: ${seenLab.get(lab)} and ${k} are both ${lab} models — different families, correlated training`);
  }
  seenLab.set(lab, k);
}

// Model names go stale faster than anything else here -- providers retire them on their own
// schedule and a wrong one fails as an opaque 400 or 404. This asks each provider what it
// actually serves today, which is one round trip instead of three guesses.
const spent = Object.fromEntries(Object.keys(PROVIDERS).map(k => [k, 0]));
const calls = Object.fromEntries(Object.keys(PROVIDERS).map(k => [k, 0]));
const budget = Object.fromEntries(
  Object.entries(PROVIDERS).map(([k, p]) => [k, Math.max(1, Math.floor((p.dailyRequests ?? 100) * FRACTION))]));

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
    if (res.status === 429) return { exhausted: true, error: `rate limited: ${(await res.text()).replace(/\s+/g, ' ').slice(0, 300)}` };
    if (res.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
    if (!res.ok) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { data: await res.json(), headers: res.headers };
  }
  return { error: 'gave up after 3 attempts' };
}

// Everything except Gemini speaks the OpenAI shape, so one caller covers two providers.
async function askOpenAIShape(provider, base, prompt) {
  const p = PROVIDERS[provider];
  const body = strict => ({
    model: p.model,
    messages: [
      { role: 'system', content: 'You answer from what you know. If you are not confident, say so by setting unsure to true rather than guessing. Output the JSON object and nothing else: do not restate the schema, do not explain your reasoning, do not write anything before or after it.' },
      { role: 'user', content: prompt },
    ],
    ...(strict ? { response_format: { type: 'json_object' } } : {}),
    // Hidden reasoning is still generated and still spends the budget, so a tight cap leaves
    // nothing for the answer and the model reads as having abstained.
    max_tokens: 4000,
    temperature: 0,
    // Anything the provider alone understands. reasoning_format is Groq's, and sending it to
    // Mistral returns 422 extra_forbidden -- a provider-specific parameter applied to every
    // provider, which is how a working seat and a broken one end up looking the same.
    ...(p.extra ?? {}),
  });

  let r = await post(`${base}/chat/completions`, body(true), { authorization: `Bearer ${p.key()}` });

  // Strict JSON mode is not uniformly implemented. Groq rejects the whole request with
  // json_validate_failed and an empty generation when the model emits anything before the
  // object -- reasoning models routinely do. Falling back to plain text costs nothing, because
  // parseJSON below already has to cope with fences and preamble anyway.
  if (r.error && /json_validate_failed|response_format/i.test(r.error)) {
    r = await post(`${base}/chat/completions`, body(false), { authorization: `Bearer ${p.key()}` });
  }

  if (!r.data) return r;
  const tokens = r.data.usage?.total_tokens ?? 0;
  spent[provider] += tokens;
  calls[provider]++;
  const raw = r.data.choices?.[0]?.message?.content ?? '';
  return { answer: parseJSON(raw), tokens, raw };
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
  calls.google++;
  const text = (r.data.candidates?.[0]?.content?.parts ?? []).map(x => x.text ?? '').join('');
  return { answer: parseJSON(text), tokens, raw: text };
}

// Models wrap JSON in prose or fences often enough that this is not optional.
//
// The greedy match this used to do took everything from the first brace to the last, which is
// right until a model narrates before it answers. Cohere replies "We need to answer with JSON in
// a specific shape: {"origin_kind": "paper" | "folklore" | ...}" and then gives the real object.
// The first brace opens the restated schema, which is not valid JSON, so the parse failed and a
// model that had answered correctly was recorded as having abstained -- after spending 4,234
// tokens, thirteen times what Mistral spent answering the same question.
//
// So: find every balanced object and try them last-first, because narration comes before the
// answer and a restated schema is never the final object.
function parseJSON(text) {
  if (!text) return null;
  const cleaned = String(text).replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(cleaned); } catch { /* narrated, fenced, or both */ }

  const spans = [];
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i];
    // Braces inside strings are not structure. Titles and venues contain all sorts of things.
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) { spans.push(cleaned.slice(start, i + 1)); start = -1; }
      if (depth < 0) depth = 0;
    }
  }
  for (let i = spans.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(spans[i]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch { /* try the one before */ }
  }
  return null;
}

// ---- the questions ----------------------------------------------------------
//
// Neither prompt mentions what this catalogue says. That is the point: anchoring a model on the
// existing answer turns agreement into an echo.

// Asking "identify the originating publication" of a method that has none gets an abstention,
// correctly. 24 of the 184 algorithms here are folklore, a write-up, or a reference
// implementation, and the catalogue already records which -- the first run abstained on three
// such subjects and read as three failures.
//
// So the question asks what *kind* of origin the method has before asking for its details. That
// makes the answer checkable in both directions: models agreeing a method is folklore confirms a
// folklore record, and models naming a real paper for something recorded as folklore is a
// finding rather than a shrug.
const attributionPrompt = name => `For the algorithm or method known as "${name}", identify where it comes from.

Answer only with JSON in this exact shape:
{"origin_kind": "paper" | "folklore" | "implementation" | "unknown", "year": <number or null>, "authors": [<surnames as strings>], "title": <string or null>, "venue": <string or null>, "unsure": <true or false>}

"paper" means a specific publication or written article introduced it. "folklore" means it is widely used with no single origin — a standard technique nobody published first. "implementation" means a particular piece of software is its definitive origin rather than any document.

If it is a paper or an article, give the one that introduced the method, not the one that popularised it or carried it into a new field. If you are not confident, set "unsure" to true rather than naming something plausible.`;

const membershipPrompt = name => `List the named, published algorithms or methods that belong to the field of "${name}" in procedural generation and computer graphics.

Answer only with JSON in this exact shape:
{"methods": [<names as strings>], "unsure": <true or false>}

Name at most twelve, most central first. Use the standard name of each method. Do not invent names.`;

const linkPrompt = name => `Find articles, tutorials, talks or write-ups explaining "${name}" for a technical reader.

Answer only with JSON in this exact shape:
{"links": [{"url": <string>, "title": <string>, "kind": "article" | "blog" | "video" | "docs" | "paper"}]}

At most four. Every URL will be fetched and checked against the title you give, so a URL you are not sure about will simply be recorded as invented. Returning one real page is better than four plausible ones. Return an empty list rather than guessing.`;

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
// What the catalogue's own source_type implies the models should say.
const EXPECTED_ORIGIN = {
  paper: 'paper', article: 'paper',
  folklore: 'folklore', 'reference-implementation': 'implementation',
};

function classifyAttribution(record, answers) {
  const expected = EXPECTED_ORIGIN[record.source_type];

  // For anything the catalogue does not claim a publication for, the question is whether the
  // models agree there is no publication. A model naming one is the interesting case.
  if (expected !== 'paper') {
    const kinds = answers.filter(a => a.answer?.origin_kind && a.answer.origin_kind !== 'unknown');
    if (kinds.length < 2) return { agreement: 'inconclusive', note: `fewer than two models would say what kind of origin this has` };
    const claimPaper = kinds.filter(a => a.answer.origin_kind === 'paper');
    if (claimPaper.length >= 2) {
      return {
        agreement: 'against-catalogue',
        note: `the catalogue records this as ${record.source_type}, but ${claimPaper.length} models name a publication: `
          + claimPaper.map(a => `${a.provider} says ${a.answer.year} ${(a.answer.authors ?? []).join(', ')}`).join('; '),
      };
    }
    const agreeing = kinds.filter(a => a.answer.origin_kind === expected);
    if (agreeing.length >= 2) return { agreement: 'confirmed', note: `${agreeing.length} models agree this has no single publication, matching the record's ${record.source_type}` };
    return { agreement: 'models-disagree', note: `origins offered: ${kinds.map(a => `${a.provider} ${a.answer.origin_kind}`).join(', ')}` };
  }

  // A hedged answer is not a useless one. On ridged-multifractal two models gave 1994 and the
  // second flagged itself unsure, so dropping hedged answers outright turned agreement into a
  // reported dispute. They can corroborate a confident answer; what they cannot do is form a
  // consensus between themselves, because two models that both say they are guessing agreeing
  // is two guesses.
  const confident = answers.filter(a => a.answer && !a.answer.unsure && a.answer.year);
  const hedged = answers.filter(a => a.answer && a.answer.unsure && a.answer.year);
  const usable = [...confident, ...hedged];
  if (!confident.length || usable.length < 2) {
    return { agreement: 'inconclusive', note: `${answers.length - confident.length} of ${answers.length} models abstained, hedged or gave no year` };
  }

  // Two seats agreeing is only two opinions if they are two families. Three Llama re-hosts
  // agreeing is one model agreeing with itself three times, and with more providers that stops
  // being hypothetical.
  let consensus = null;
  for (const c of confident) {
    const peer = usable.find(o => o !== c
      && o.answer.year === c.answer.year
      && seatFamily.get(o.provider) !== seatFamily.get(c.provider));
    if (peer) { consensus = c.answer; break; }
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
  // Same rule: named by two families, not two seats.
  const agreed = [...proposals.values()]
    .filter(p => new Set(p.by.map(prov => seatFamily.get(prov))).size >= 2);
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
    if (disabled.has(provider)) continue;
    if (calls[provider] >= budget[provider]) {
      disabled.add(provider);
      console.error(`      ${provider} has used its ${budget[provider]}-request share for this run`);
      continue;
    }
    const r = p.transport === 'google'
      ? await askGemini(prompt)
      : await askOpenAIShape(provider, p.base, prompt);
    // One seat hitting its provider's daily limit is not the run ending. With several seats the
    // others carry on, and the subject is only skipped if fewer than two of them answered.
    if (r.exhausted) {
      disabled.add(provider);
      console.error(`      ${provider} disabled: ${String(r.error).replace(/\s+/g, ' ').slice(0, 120)}`);
      continue;
    }
    if (r.error) {
      // Loud, and counted. A failed call is not a model declining to answer, and the difference
      // matters: abstention is a finding, a broken request is a bug wearing its costume.
      //
      // A bad key, a refused payment or a forbidden model will not fix itself between subjects,
      // so the seat is dropped for the rest of the run rather than failing identically once per
      // subject and burying everything else in the log.
      if (/HTTP 40[123]/.test(r.error)) {
        disabled.add(provider);
        console.error(`      ${provider} disabled for this run: ${r.error.split('\n')[0].slice(0, 120)}`);
      } else {
        console.error(`      ${provider} failed: ${r.error}`);
      }
      failures.push({ provider, error: r.error });
      models.push({ provider, model: p.model, verdict: null, unsure: true, tokens: 0 });
      continue;
    }
    const answer = r.answer ?? null;
    if (has('--debug')) {
      console.error(`      --- ${provider} (${p.model}) said ---`);
      console.error(String(r.raw ?? '(no text)').slice(0, 1200));
      console.error('      ---');
    }
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
  // Off by default, and the code below is kept so it can be switched back on with --links the
  // moment there is a real source to plug in.
  //
  // No seat can browse. Google Search grounding is not on the free tier -- it answers 429
  // RESOURCE_EXHAUSTED on the first call of a run while plain generation on the same key works
  // -- so every URL a model offers is recalled from training data rather than looked up.
  //
  // Asking anyway was tried and should not be tried again. Three models produced six URLs for
  // one subject and every one of them failed verification: nothing real was found, and the two
  // extra requests per subject exhausted Gemini's daily request quota after a single subject.
  // Verification catching invented URLs was never an argument for asking models to invent them;
  // it is an argument for checking links that came from somewhere real.
  //
  // To plug a source back in, give it a function returning [{url, title, kind}] and call it here
  // instead of the models. Everything downstream -- fetching, title-matching, recording
  // rejections with a reason -- already works and is what the further_reading table is shaped
  // for. Candidates: Gemini grounding with billing enabled, a search API such as Brave, or the
  // arXiv and Wikipedia APIs, which return real URLs by construction but only reach citations
  // and encyclopaedia entries rather than write-ups.
  const links = [];
  const seenUrls = new Set();
  for (const [provider, p] of (has('--links') ? Object.entries(PROVIDERS) : [])) {
    if (!p.key() || disabled.has(provider)) continue;
    const r = p.transport === 'google'
      ? await askGemini(linkPrompt(displayName))
      : await askOpenAIShape(provider, p.base, linkPrompt(displayName));
    // A failed call used to look exactly like a search that found nothing, because the result
    // was read straight through an optional chain. Same swallowing that let the very first run
    // report five successes over zero requests.
    if (r.error) console.error(`      ${provider} link search failed: ${String(r.error).replace(/\s+/g, ' ').slice(0, 160)}`);
    if (has('--debug')) {
      console.error(`      --- ${provider} links ---`);
      console.error(String(r.raw ?? r.error ?? '(nothing)').slice(0, 900));
      console.error('      ---');
    }
    for (const l of (r.answer?.links ?? []).slice(0, 4)) {
      if (!l?.url || seenUrls.has(l.url)) continue;
      seenUrls.add(l.url);
      const check = await verifyLink(l.url, l.title ?? displayName);
      links.push({
        layer: subject.layer, target: subject.id, url: l.url,
        title: check.title ?? l.title ?? null, kind: l.kind ?? 'article',
        found_by: p.model, verified: today, ...check,
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
  // Without an explicit count, take the budget's worth. One request per seat per subject, so the
  // seat with the smallest request allowance sets how far a run can go. No history needed for
  // this, which is the point of budgeting requests rather than tokens: the cost of a subject is
  // known before it is asked.
  if (!planned) {
    planned = Math.max(1, Math.min(...Object.values(budget)));
    console.log(`budget allows ${planned} subjects — ${FRACTION * 100}% of the tightest seat's daily requests`);
  }
  var subjects = pick(planned);
  if (!Array.isArray(subjects)) subjects = [subjects];
}

const disabled = new Set();
const done = [];
const unanswered = [];
const allLinks = [];
let stopped = null;

for (const s of subjects) {
  // Requests against a request budget. This compared tokens against it and stopped a ten-subject
  // run after one, because 1,262 tokens read as far past a budget of 25 requests. A leftover
  // from moving the budget off tokens, and one that looks like a working stop condition.
  //
  // Every seat being out is what ends a run. One seat being out only means the others carry it,
  // and a subject is skipped by the two-answer rule if too few remain -- so a run does not stop
  // because its most limited seat did.
  const spentOut = Object.keys(PROVIDERS).filter(k => calls[k] >= budget[k] || disabled.has(k));
  if (spentOut.length >= Object.keys(PROVIDERS).length - 1) {
    stopped = `only ${Object.keys(PROVIDERS).length - spentOut.length} seat left with budget (${spentOut.join(', ')} spent or disabled)`;
    break;
  }

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

console.log(`\nrequests used, against ${FRACTION * 100}% of each seat's daily allowance:`);
for (const k of Object.keys(PROVIDERS)) {
  const per = done.length ? Math.round(spent[k] / done.length) : 0;
  console.log(`  ${k.padEnd(12)} ${String(calls[k]).padStart(4)} / ${String(budget[k]).padStart(4)} requests`
    + `   ${String(spent[k]).padStart(7)} tokens (${per}/subject)   ${seatFamily.get(k) ?? '—'}`);
}
// Only meaningful once something was actually spent; otherwise the arithmetic divides by a
// cost of zero and reports that the budget affords everything.
const used = Object.keys(PROVIDERS).filter(k => calls[k] > 0);
if (done.length && used.length) {
  const affordable = Math.min(...used.map(k => Math.floor(budget[k] / (calls[k] / done.length))));
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
