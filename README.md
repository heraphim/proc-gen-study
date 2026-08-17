# Procedural Generation Catalogue

A research map of what can be made with procedural generation, and of the machinery that makes
it. **841 catalogued techniques** across 23 domains, **36 concepts** each with a plain-language
explanation, **184 algorithms** with checked citations, **26 of them with working code short
enough to read**, **120 registry-verified implementations** across five registries, **37
research sources** recording what each one settled, and the relations between all of it.

This is a research artefact, not a product. It exists to understand the territory before
building anything, and it is deliberately honest about what it does not yet know — and about
what it previously got wrong, which is kept as a ledger of **18 corrections** rather than
quietly edited away.

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
```

**Concepts** — ideas about what can be made, at every grain. *Noise* is a coarse concept;
*cobblestone paving* is a fine one. They differ in grain, not in kind. Faceted four ways:

| Facet | Count | Meaning |
|---|---|---|
| block | 21 | Irreducible, used across unrelated domains, and something concrete implements it |
| representation | 7 | A format for holding structure, not a way of making it |
| category | 6 | Fails the importable test — a bag containing blocks that were never named |
| deployment | 2 | Where or how something runs. Not a concept at all |

The test that does the work is **importable**: `sim` is used in 21 of 23 domains, wider than
anything but `rand`, and still fails — there is no "simulator" you can import. That is why it
became a dumping ground for everything unclassifiable. The same test is what keeps concepts
out: `motion` was considered and rejected because there is no motion-matching library you can
install, and the package whose name suggests otherwise turns out to be database instrumentation.

28 of the 36 came from the original reference. Eight were added here — `field`, `mesh`,
`filter`, `hydro`, `texsyn`, `subdiv`, `colour`, `topopt` — each of which had to name a real
package and say what its absence had been costing. Two were the operator layer's own substrate
going unnamed: everything in the catalogue passes fields and meshes around, and neither had a
word.

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
`scipy` implements six algorithms across four concepts; simplex noise has nine implementations
in seven languages.

**Technologies** — languages and runtimes. A separate axis: a property of where code can run,
not of the idea it implements.

**Sources** — every URL consulted while checking a claim, with the question it answered and
what it bears on. 11 of the 62 links are marked `corrects`, meaning that source overturned
something this catalogue had already asserted.

### Cutting across all of it: three layers

Every entry answers one question — *does anything go in?*

| Layer | Count | Test |
|---|---|---|
| source | 29 | Nothing goes in. Seed and parameters only |
| operator | 246 | Something goes in, and you can say what comes out without knowing what it is for |
| generator | 566 | You can only explain it by naming the result |

The shorthand: *can you describe it without saying what it's for?* If yes, it's a source or an
operator. Hydraulic erosion takes a heightfield and returns a heightfield — describable without
ever using the word "terrain", which is why the same code also weathers a texture.

## The pages

| Route | What's there |
|---|---|
| `/` | What procedural generation is, what it buys you, a verified history, how this project structures it |
| `/basic-blocks` | The 36 concepts, faceted, each with a plain-language explanation, the blocks hiding inside each category named, the eight added ones arguing for themselves, and the candidates that were rejected |
| `/algorithms` | 184 algorithms, grouped by concept, each with a mechanism description, a plain-language explanation and a checked source |
| `/implementations` | 120 packages, grouped by concept and then by the algorithm they implement, with the technologies they run on and, where the whole method fits in under 100 lines, the reference code above the libraries that wrap it |
| `/catalogue` | The 841 entries. Filters serialise into the query string, so a filtered view is a shareable URL |
| `/definitions` | The three layers explained, with a worked terrain pipeline |
| `/sources` | The 37 research sources, split by whether they overturned a claim or confirmed one, plus the full corrections ledger |
| `/case-studies` `/pitfalls` `/tools` | The original reference material |
| `/sql` | Read-only SQL console over the database. Local only — not in the published build |

Every list page shares one shell: search, horizontal filters (checkbox / radio / dropdown chosen
by what the filter is), live counts that exclude their own filter, and independent collapse for
groups and cards. Every card shows its relations when collapsed, so you can scan structure
without opening anything.

## How things get into the data

Nothing is asserted without a check, and the checks are enforced at build time rather than by
good intentions.

**Algorithms** carry a `source_type`: `paper`, `article`, `reference-implementation` or
`folklore`. The rule was originally paper-only and was widened, because that excluded genuinely
important techniques — domain warping, pity timers, falling-sand — and so misrepresented practice
as more academic than it is. Filter on `source_type = 'paper'` to get the strict set back.

```
paper                    160
folklore                   9
article                    9
reference-implementation   6
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
| `facet.json` | the four-way concept split, with the blocks hiding inside each category |
| `concepts.json` | the plain-language explanation per concept, corrections to the prose carried over from the source HTML, the eight added concepts, and the candidates rejected |
| `algorithms.json` | 184 algorithms with citations, descriptions, plain-language explanations and source types |
| `code-samples.json` | 26 working samples, held as arrays of lines so a change reads as a diff |
| `implementations.json` | registry-verified packages across five registries |
| `implementation-algorithms.json` | which implementation implements which algorithm |
| `technologies.json` | languages, runtimes, platforms |
| `sources.json` | every URL consulted, what it settled, and what it is attached to |
| `corrections.json` | what this catalogue said, what it says now, and why |

Each file carries `_contested`, `_rejected` or `_orphan_reason` notes recording calls that could
reasonably go the other way.

A concept correction has to quote the text it replaces. If the source HTML changes underneath
it, the build fails rather than applying a stale fix.

## Layout

```
source/     the original single-file HTML reference — still the source of truth for entries
data/       annotations (committed) and catalogue.db (derived, gitignored)
            annotations/ holds ten files: tier, facet, concepts, algorithms, code-samples,
            implementations, implementation-algorithms, technologies, sources, corrections
db/         schema
scripts/    migrate.js       — HTML + annotations -> SQLite, idempotent, fails loudly
            check-samples.js — runs every code sample; CI fails if one does not execute
            build-static.js  — the same read layer, frozen into dist/ for Pages
            serve-dist.js    — serves dist/ the way Pages does, for checking a build
lib/        catalogue.js — the read layer: bootstrap payload, SQL console, route list
server.js   static files + /api/bootstrap.json + /api/query
public/     the browser UI
```

## What is not done

Stated plainly so the map doesn't look more finished than it is.

- **`entry_uses` has 0 rows.** Nothing records which generator is built from which sources and
  operators. This is the piece that would make the model do work rather than just describe. The
  eight added concepts contributed 41 `entry_tag` rows by naming the entries they apply to,
  which is a start on the same problem at a coarser grain.
- **8 of 9 entry fields are empty** across all 841: `output_type`, `input_class`, `compute_cost`,
  `deterministic`, `realtime`, `difficulty`, `confidence`, `notes`. `input_class` is the
  consequential one — it splits the catalogue into what a seed-driven engine could serve and
  what it structurally cannot.
- **94 of 184 algorithms have no implementation recorded**, and 10 of 36 concepts have none at
  all. The absolute gap grew — it was 79 of 125 — but only because the denominator did: coverage
  went from 36.8% of algorithms to 48.9%, and concepts with nothing attached fell from 13 of 28
  to 10 of 36. The method blind spot this bullet used to name — registry verification not
  reaching GitHub-hosted C++ — is fixed. What remains is a real gap, and it is concentrated in
  the newest concepts and in anything whose reference implementation is a paper.
- **Coverage is still lopsided by language.** Python 51 and JavaScript 47 against C++ 16, Rust
  14, C# 6 and GLSL 3. Those four were at zero and are no longer, but a C#-first reader is still
  much worse served than a Python one.
- **26 of 184 algorithms have code.** The ones without are a mix of genuinely-too-large — marching
  cubes' 256-case table, CP-SAT, anything with a trained model — and simply not done yet.
- **An empty candidate queue is not completeness.** It means nothing currently identified is
  missing. It emptied once and immediately refilled with 44 entries when the concept vocabulary
  widened, which is the same lesson twice. The largest known hole is coding theory —
  Reed–Solomon and the QR symbology, which five catalogue entries depend on and no concept covers.
- **The corrections ledger is not a completeness claim either.** 18 corrections is what has been
  found, not what is there. Six of the seven concept corrections came from reading the concept
  layer against this catalogue's own algorithm layer and finding them contradicting each other,
  which is the cheapest kind of check and had not been run.
- Gap-hunting outside games, and an honest difficulty distribution, have not been started.

## Known errors carried over from the source data

Left in place deliberately rather than quietly patched, so the provenance stays visible. These
are errors in `source/`, not in the layers built on top of it — for those, see the corrections
ledger on `/sources`.

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

The full ledger is on `/sources`; the pattern is worth stating here. The most productive check
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
