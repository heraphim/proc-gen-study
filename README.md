# Procedural Generation Catalogue

A research map of what can be made with procedural generation, and of the machinery that makes
it. **841 catalogued techniques** across 23 domains, **37 concepts** each with a plain-language
explanation, **3 axes** classifying every entry, **195 algorithms** with checked citations, **26 of them with working code short
enough to read**, **120 registry-verified implementations** across five registries, **38
research sources** recording what each one settled, and the relations between all of it.

This is a research artefact, not a product. It exists to understand the territory before
building anything, and it is deliberately honest about what it does not yet know. Where it has
found itself wrong, the fix is applied to the data and the pages show the corrected value; the
record of **22 corrections** stays in the database rather than on the pages.

## Run

```bash
npm start
```

Open <http://localhost:4173>. No dependencies and no build step — it uses Node's built-in
`node:sqlite` and `node:http`. Requires Node 22.5+ (developed on 24.17).

To rebuild the database from source:

```bash
npm run migrate
```

## Publish

`.github/workflows/pages.yml` publishes the catalogue to GitHub Pages on every push to `main`
(or on demand from the Actions tab). It rebuilds the database from source, runs every code
sample, builds `dist/`, and deploys it. **One-time setup:** repo *Settings → Pages → Build and
deployment → Source → GitHub Actions*, otherwise the deploy step fails with a 404.

Builds cancel when a newer commit arrives; deploys do not. That split is not theoretical — a
run of pushes in quick succession had four deploy jobs killed by GitHub answering `429 Too Many
Requests` to the action download, before any step ran. The builds had all passed and the next
successful run published the same content, but the redundant deploys were pure waste.

Pages serves files, not Node, so `npm run build` freezes what the server would have computed:
`/api/bootstrap.json` becomes a real file, each client-side route gets its own copy of the shell
(so deep links are a 200, not a redirect), `404.html` catches everything else, and the `/sql`
console — which needs a live database to POST to — is left out of the published build.

To check that build the way Pages will serve it, mounted at the same base path:

```bash
npm run build && npm run preview
```

The base path defaults to `/` and comes from `BASE_PATH` (`--base=` also works); the workflow
passes the one `actions/configure-pages` reports, so a rename of the repo needs no edit here.

## The model

The catalogue arrived as a flat list of 841 things tagged with 28 labels. That structure mixed
several different kinds of object, which made it impossible to say what any entry actually
*was*. What replaced it:

```
concept ──uses──▶ concept
   │
   ├─ has ──▶ algorithm ──implemented by──▶ implementation ──runs on──▶ technology
   │
   └─ facet: block | representation | category | deployment

entry ──has a value on──▶ axis
                          └─ addressing | input_class | runs_at
```

**Concepts** — ideas about what can be made, at every grain. *Noise* is a coarse concept;
*cobblestone paving* is a fine one. They differ in grain, not in kind. Faceted four ways:

| Facet | Count | Meaning |
|---|---|---|
| block | 22 | Irreducible, used across unrelated domains, and something concrete implements it |
| representation | 7 | A format for holding structure, not a way of making it |
| category | 6 | Fails the importable test — a bag containing blocks that were never named |
| deployment | 2 | Where or how something runs. Not a concept at all |

A fourth test separates a concept from an **axis**: does anything implement it? A concept is
something you can be sent away and told to build. An axis cannot be built, only observed — every
entry has a value on it and nothing implements it. Exactly two of the 37 concepts have zero
algorithm rows, `shader` and `kit`, which are the same two the facet pass had already filed as
"not a concept at all" on the strength of an argument. The algorithm layer turned that argument
into a count, and both are now carried by the axis layer below.

The test that does the work is **importable**: `sim` is used in 21 of 23 domains, wider than
anything but `rand`, and still fails — there is no "simulator" you can import. That is why it
became a dumping ground for everything unclassifiable. The same test is what keeps concepts
out: `motion` was considered and rejected because there is no motion-matching library you can
install, and the package whose name suggests otherwise turns out to be database instrumentation.

28 of the 37 came from the original reference. Nine were added here — `field`, `mesh`,
`filter`, `hydro`, `texsyn`, `subdiv`, `colour`, `topopt`, `pick` — each of which had to name a
real package and say what its absence had been costing. Two were the operator layer's own
substrate going unnamed: everything in the catalogue passes fields and meshes around, and
neither had a word.

`pick` arrived differently from the other eight. They were holes — subjects with no word at all.
It was a split: `rand` was carrying generators and the tables that consume them under one label,
and the catalogue's own tier column had already recorded the divide without anyone acting on it,
with the six generators filed as `source` and the three selection algorithms as `operator` and
no ambiguous case between them.

Every concept also carries a **plain-language explanation** — the idea stated without its own
vocabulary, for a reader who does not know the field. That is not decoration. A concept that
cannot be explained without its own jargon has not been pinned down, and writing these forced
several descriptions to be rewritten rather than translated.

The first attempt at these read "explain like I'm five" literally and produced 220 explanations
full of tiny arrows, little dots and pretend worlds — which patronised the reader without
explaining any more than the plain version does. All 220 were rewritten, and
`npm run check-register` now fails the build on the specific habit rather than on general tone:
diminutives standing in for explanation, with "a little accuracy" allowed and "a little arrow"
not.

**Algorithms** — named, pinned-down methods. Perlin noise, Fortune's sweepline, FABRIK,
Knuth–Plass. This is the only level that has papers, which is why the original catalogue had no
citations: it never had this layer. Some concepts have algorithms; many, like cobblestone
paving, have none of their own and only wire others together. Every algorithm carries a
plain-language explanation too. 26 of them also have the whole method as **working code under
100 lines** — shown on the implementations page rather than here, above the packages that wrap
the same algorithm, because that juxtaposition is what the code is for.

**Implementations** — runnable code. Linked to algorithms, not concepts, and many-to-many:
`scipy` implements six algorithms across four concepts; simplex noise has a dozen
implementations in six languages.

**Technologies** — languages and runtimes. A separate axis: a property of where code can run,
not of the idea it implements.

**Sources** — every URL consulted while checking a claim, with the question it answered and
what it bears on. 11 of the 65 links are marked `corrects`, meaning that source overturned
something this catalogue had already asserted.

### Cutting across all of it: three layers

Every entry answers one question — *does anything go in?*

| Layer | Count | Test |
|---|---|---|
| source | 28 | Nothing goes in. Seed and parameters only |
| operator | 247 | Something goes in, and you can say what comes out without knowing what it is for |
| generator | 566 | You can only explain it by naming the result |

The shorthand: *can you describe it without saying what it's for?* If yes, it's a source or an
operator. Hydraulic erosion takes a heightfield and returns a heightfield — describable without
ever using the word "terrain", which is why the same code also weathers a texture.

## The pages

| Route | What's there |
|---|---|
| `/` | What procedural generation is, what it buys you, a verified history, how this project structures it |
| `/basic-blocks` | The 37 concepts, faceted, each with a plain-language explanation, the blocks hiding inside each category named, the nine added ones arguing for themselves, and the candidates that were rejected. Then the three axes, in the same card shape, each arguing why it is not a concept |
| `/algorithms` | 195 algorithms, grouped by concept, each with a mechanism description, a plain-language explanation and a checked source |
| `/implementations` | 120 packages, grouped by concept and then by the algorithm they implement, with the technologies they run on and, where the whole method fits in under 100 lines, the reference code above the libraries that wrap it |
| `/catalogue` | The 841 entries, filterable by layer, domain, concept and every axis. Filters serialise into the query string, so a filtered view is a shareable URL |
| `/definitions` | The three layers explained, with a worked terrain pipeline |
| `/sources` | The 38 research sources, split by whether they overturned a claim or confirmed one |
| `/case-studies` `/pitfalls` `/tools` | The original reference material |
| `/sql` | Read-only SQL console over the database. Local only — not in the published build |

Every list page shares one shell: search, horizontal filters (checkbox / radio / dropdown chosen
by what the filter is), live counts that exclude their own filter, and independent collapse for
groups and cards. Grouping is for browsing; filtering is a question, so on the implementations
page — the one page where an item legitimately appears under several headings — a filter or a
search drops the hierarchy and returns one card per match. Every card shows its relations when collapsed, so you can scan structure
without opening anything.

## How things get into the data

Nothing is asserted without a check, and the checks are enforced at build time rather than by
good intentions.

**Algorithms** carry a `source_type`: `paper`, `article`, `reference-implementation` or
`folklore`. The rule was originally paper-only and was widened, because that excluded genuinely
important techniques — domain warping, pity timers, falling-sand — and so misrepresented practice
as more academic than it is. Filter on `source_type = 'paper'` to get the strict set back.

```
paper                    167
folklore                  11
article                    9
reference-implementation   8
```

**Implementations** were resolved against a registry before being written down: npm, PyPI,
crates.io, NuGet, or the GitHub API for the C++ and shader libraries that ship only as a
repository. Of the original 83 candidates, six 404ed and five resolved to unrelated projects
sharing a name — PyPI `sdf` is *Scientific Data Format*, `wfc` is *WebForms Core*. The same trap
caught two more later: PyPI `pymo` is MongoClient instrumentation, not motion capture, and PyPI
`meep` is a task runner, not the photonics solver. All of those would have shipped as confident,
checkable lies.

**Code samples are executed on every deploy.** `npm run check-samples` extracts each sample,
runs it, and fails if any does not execute; the workflow runs it before building, and the
migration rejects a sample over 100 lines. So "the whole mechanism fits in under 100 lines and
runs as written" is enforced rather than asserted. One sample disagreed with its own algorithm's
description and the description lost.

**The build fails on bad annotations.** An override that matches no entry, an algorithm with no
citation, description, plain-language explanation or valid tier, a concept missing its
explanation, a correction whose "was" no
longer matches the text it claims to correct, an added concept without a named importable
package, a source with no description or a duplicate URL, a code sample that is empty or too
long, a reference to an unknown concept, algorithm or technology, an implementation not marked
verified — all abort the migration rather than silently doing nothing. This has caught six real
errors, including a phantom `npm:markovify` that does not exist.

### Annotations

Judgement calls live in `data/annotations/*.json` as text, not in the database, so every pass is
a reviewable diff you can argue with line by line:

| File | Holds |
|---|---|
| `tier.json` | source/operator/generator per entry, as a default per domain plus exceptions |
| `facet.json` | the four-way concept split, the four tests, and the blocks hiding inside each category |
| `axes.json` | the axis layer: what each axis asks, what each value buys and costs, and the rule plus overrides it is classified by |
| `concepts.json` | the plain-language explanation per concept, corrections to the prose carried over from the source HTML, the nine added concepts, and the candidates rejected |
| `algorithms.json` | 195 algorithms with citations, descriptions, plain-language explanations and source types |
| `code-samples.json` | 26 working samples, held as arrays of lines so a change reads as a diff |
| `implementations.json` | registry-verified packages across five registries |
| `implementation-algorithms.json` | which implementation implements which algorithm |
| `technologies.json` | languages, runtimes, platforms |
| `sources.json` | every URL consulted, what it settled, and what it is attached to |
| `corrections.json` | what this catalogue said, what it says now, and why — recorded in the `correction` table, not shown on the pages |
| `reviews.json` | what the scheduled audit found, one entry per subject per round, with each model's answer kept separately. Written by the audit and read by the rotation, so it is data the automation depends on rather than a log of it |
| `further-reading.json` | write-ups and talks for a concept or algorithm, each URL fetched and title-matched before it is accepted. Rejected candidates stay, with the reason |

Where a call could reasonably go the other way, the file records it — `tier.json`,
`facet.json`, `concepts.json` and `implementation-algorithms.json` carry `_contested`,
`_rejected` or `_orphan_reason` notes today.

A concept correction has to quote the text it replaces. If the source HTML changes underneath
it, the build fails rather than applying a stale fix.

### The automations

Three workflows besides the Pages deploy. The two that write anything write to a branch and
open a pull request, never to `main` — the whole point of keeping judgement in reviewable text
is lost if a robot can merge it.

`.github/workflows/validate.yml` runs the whole gate on every pull request and every push to a
branch that is not `main` — migrate, `check-samples`, `check-register`, `check-guards`, build.
The migration is this project's test suite, so until this existed a pull request could sit green
and still be rejected the moment it merged.

`.github/workflows/registry-poll.yml` re-resolves all 120 implementations against npm, PyPI,
crates.io, NuGet and the GitHub API every Monday, and proposes whatever moved. There is no
language model anywhere in it: the registry owns the answer, so there is nothing to infer and
nothing to get creatively wrong. Version, release date, stars and archived flags are the
registry's, and hand-editing them only means the next run overwrites you.

```bash
npm run poll
```

`.github/workflows/research.yml` runs nightly and is the audit. It asks every model there is an
API key for about whichever subjects are furthest behind, compares the answers mechanically, and
proposes the result. Four rules do the work, and each is there because the obvious alternative
fails:

- **No Claude seat, enforced rather than intended.** The algorithm records were largely written
  by Claude; checking them with Claude repeats its blind spots instead of catching them. What
  has to differ between seats is the model *family*, not the vendor — two vendors re-hosting the
  same weights is one opinion delivered twice, and the comparison would read it as corroboration.
- **Ask blind.** A model is never shown what this catalogue currently claims. Show it the
  existing answer and it agrees with it, and agreement obtained that way carries no information.
- **Compare mechanically.** No model adjudicates, because the model that would judge is the one
  whose output is on trial. The comparison is a diff. Two models agreeing against the catalogue
  is the finding; two disagreeing with each other says the subject cannot be settled from recall,
  which is probably how the original claim was made.
- **Fairness before priority.** Everything gets one review before anything gets two, so the
  rotation always picks from whichever subjects have the fewest. The migration enforces the same
  invariant from the other side, so a bug in the picker fails the build rather than quietly
  starving a subject.

Two limits stop it running away. It spends at most half of any provider's daily request
allowance, and it skips the night entirely once seven unreviewed rounds are already open — a
queue of unread findings is worse than none, because it makes the catalogue look reviewed when
it is only proposed.

Which subjects go first is a person's call, in `docs/research-seed.md`: tick what you could
catch a wrong answer about. That is a calibration set, not a wishlist. Three models researching
`perlin-noise` produce an answer you can referee; the same three on
`dantzig-wolfe-decomposition` produce one you cannot, and a confident wrong answer is
indistinguishable from a confident right one until someone knows the difference. Once every
subject has had a first review the seed stops mattering.

```bash
npm run seed       # regenerate the checklist, keeping existing ticks
npm run pick       # what the rotation would look at next
npm run research   # ask the models locally; --dry-run to record nothing
```

## Layout

```
source/     the original single-file HTML reference — still the source of truth for entries
data/       annotations (committed) and catalogue.db (derived, gitignored)
            annotations/ holds thirteen files: tier, facet, axes, concepts, algorithms,
            code-samples, implementations, implementation-algorithms, technologies,
            sources, corrections, reviews, further-reading
db/         schema
docs/       data-model.md    — the schema, and why it is shaped that way
            research-seed.md — which subjects the audit runs first (generated, ticks kept)
scripts/    migrate.js        — HTML + annotations -> SQLite, idempotent, fails loudly
            check-samples.js  — runs every code sample; CI fails if one does not execute
            check-register.js — keeps the plain-language explanations plain
            check-guards.js   — checks the review guards still reject what they claim to
            build-static.js   — the same read layer, frozen into dist/ for Pages
            serve-dist.js     — serves dist/ the way Pages does, for checking a build
            poll-registries.js — re-resolves every implementation against its registry
            research-seed.js  — generates and reads docs/research-seed.md
            pick-subject.js   — chooses what the audit looks at next
            research.js       — asks the models, compares answers, records the result
lib/        catalogue.js — the read layer: bootstrap payload, SQL console, route list
server.js   static files + /api/bootstrap.json + /api/query
public/     the browser UI
```

## What is not done

Stated plainly so the map doesn't look more finished than it is.

- **`entry_uses` has 0 rows.** Nothing records which generator is built from which sources and
  operators. This is the piece that would make the model do work rather than just describe. The
  nine added concepts contributed 50 `entry_tag` rows by naming the entries they apply to,
  which is a start on the same problem at a coarser grain.
- **6 of 9 entry fields are still empty** across all 841: `output_type`, `compute_cost`,
  `realtime`, `difficulty`, `confidence` and `notes`. Three are now filled and became the axis
  layer — `input_class`, which splits the catalogue into what a seed-driven engine could serve
  and what it structurally cannot; `addressing`, which says whether you can reach a point
  without replaying to it; and `runs_at`. A fourth, `deterministic`, was dropped rather than
  filled: in a procedural generation catalogue the answer is yes almost everywhere, so it would
  have sorted 841 rows into one bucket. `addressing` is the question it was reaching for.
- **The axis classification is a rule with 12 exceptions.** Values are mapped from concept tag
  and then corrected per entry, and the corrections are the part worth reading, because they are
  the cases the rule gets wrong. Twelve is almost certainly too few for 841 rows — it is what one
  pass over the obvious ones found, not what is there.
- **101 of 195 algorithms have no implementation recorded**, and 11 of 37 concepts have none at
  all. The absolute gap grew — it was 79 of 125 — but only because the denominator did: coverage
  went from 36.8% of algorithms to 48.2%, and concepts with nothing attached fell from 13 of 28
  to 11 of 37. The method blind spot this bullet used to name — registry verification not
  reaching GitHub-hosted C++ — is fixed. What remains is a real gap, and it is concentrated in
  the newest concepts and in anything whose reference implementation is a paper.
- **Coverage is still lopsided by language.** Python 51 and JavaScript 47 against C++ 16, Rust
  14, C# 6 and GLSL 3. Those four were at zero and are no longer, but a C#-first reader is still
  much worse served than a Python one.
- **26 of 195 algorithms have code.** The ones without are a mix of genuinely-too-large — marching
  cubes' 256-case table, CP-SAT, anything with a trained model — and simply not done yet.
- **An empty candidate queue is not completeness.** It means nothing currently identified is
  missing. It emptied once and immediately refilled with 44 entries when the concept vocabulary
  widened, and stands at 59 across 13 concepts now. The third refill taught something the first
  two did not: `rand` had no queue entry at all, and an absent queue reads as complete coverage
  rather than as unexamined. It was missing the linear congruential generator — the thing behind
  java.util.Random, glibc's rand() and drand48 — while holding six more sophisticated ones. A
  concept is most likely to look finished exactly where nobody has looked. The largest known hole
  is still coding theory — Reed–Solomon and the QR symbology, which five catalogue entries depend
  on and no concept covers.
- **The audit has run nowhere yet.** `review`, `review_model` and `further_reading` are at 0
  rows. The pipeline is built and gated — the rotation, the fairness invariant, the link
  verification and the guards that check the guards all exist and all pass — but nothing has
  been through it, so every algorithm record on the pages is still a single-model claim that
  survived a citation check. `docs/research-seed.md` has 59 of 232 subjects ticked, which is
  where it would start.
- **The corrections record is not a completeness claim either.** 22 corrections is what has been
  found, not what is there. Six of the nine concept corrections came from reading the concept
  layer against this catalogue's own algorithm layer and finding them contradicting each other,
  which is the cheapest kind of check and had not been run.
- Gap-hunting outside games, and an honest difficulty distribution, have not been started.

## Known errors carried over from the source data

Left in place deliberately rather than quietly patched, so the provenance stays visible. These
are errors in `source/`, not in the layers built on top of it — those were fixed where they sat,
and the pages show the corrected value.

- The **AlphaChip** case study reads as settled. Nature added an editor's note in 2023, the paper
  carries an expression of concern, and Cheng & Kahng failed to reproduce it. It is a live dispute.
- `shaders` contains **one technique twice**: "Stochastic / histogram-preserving tiling" and
  "Hex-grid stochastic tile blending" are both Heitz & Neyret 2018.
- **"Layered 2D portrait assembly"** and **"Portraits assembled from layered features"** are the
  same entry twice within `characters`.
- **Liang hyphenation is tagged `markov`** — it is a packed-trie pattern matcher with no
  probabilities anywhere. Now provably wrong rather than suspected.
- **Elite** is described as running on "a 22 KB machine". The BBC Micro had 32 KB, roughly 22 KB
  usable after screen memory. Imprecise rather than wrong.
- **Euclidean rhythms** are said to produce "most world rhythms". Toussaint's claim is that
  *many* traditional rhythms are Euclidean.
- Reading list: "Roguelike Basin / RogueBasin wiki" — only *RogueBasin* is a real name.

## Errors this project made and has since fixed

The full ledger lives in the `correction` table (fed by `data/annotations/corrections.json`
and the concept corrections in `concepts.json`); the pattern is worth stating here. The most productive check
was not reading further into the literature — it was reading the catalogue against itself.

- Two concept cards contradicted the algorithm layer of this same catalogue. `ero` said erosion
  cannot be iterated interactively while listing Mei's GPU erosion, which has been interactive
  since 2007; `lsys` said L-systems have no global awareness while listing open L-systems, which
  exist to give them exactly that.
- Two algorithm records were misattributed. `mpm` was dated to the 2013 graphics paper rather
  than Sulsky 1994 — which hid the fact that it descends from FLIP, already a row here. `quadtree`
  cited Finkel & Bentley's *point* quadtree while describing a *region* quadtree, a different
  structure from a different paper three years earlier.
- The implementations file had noticed one of its own anomalies and explained it wrongly. It
  observed that many npm release dates clustered in mid-2022, guessed at a bulk registry
  operation, and advised the reader not to read them as abandonment. The dates were simply the
  day the original lookup ran; several of those packages last shipped a decade ago.
- The README claimed Knuth–Plass was in the algorithm layer. It was not, until now.
