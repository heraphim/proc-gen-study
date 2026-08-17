# Procedural Generation Catalogue

A research map of what can be made with procedural generation, and of the machinery that makes
it. **841 catalogued techniques** across 23 domains, **125 algorithms** with checked citations,
**71 registry-verified implementations**, and the relations between them.

This is a research artefact, not a product. It exists to understand the territory before
building anything, and it is deliberately honest about what it does not yet know.

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
(or on demand from the Actions tab). It rebuilds the database from source, builds `dist/`, and
deploys it. **One-time setup:** repo *Settings → Pages → Build and deployment → Source →
GitHub Actions*, otherwise the deploy step fails with a 404.

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
| block | 15 | Irreducible, used across unrelated domains, and something concrete implements it |
| representation | 5 | A format for holding structure, not a way of making it |
| category | 6 | Fails the importable test — a bag containing blocks that were never named |
| deployment | 2 | Where or how something runs. Not a concept at all |

The test that does the work is **importable**: `sim` is used in 21 of 23 domains, wider than
anything but `rand`, and still fails — there is no "simulator" you can import. That is why it
became a dumping ground for everything unclassifiable.

**Algorithms** — named, pinned-down methods. Perlin noise, Fortune's sweepline, FABRIK,
Knuth–Plass. This is the only level that has papers, which is why the original catalogue had no
citations: it never had this layer. Some concepts have algorithms; many, like cobblestone
paving, have none of their own and only wire others together.

**Implementations** — runnable code. Linked to algorithms, not concepts, and many-to-many:
`scipy` implements six algorithms across four concepts; simplex noise has six implementations.

**Technologies** — languages and runtimes. A separate axis: a property of where code can run,
not of the idea it implements.

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
| `/basic-blocks` | The 28 concepts, faceted, with the blocks hiding inside each category named |
| `/algorithms` | 125 algorithms, grouped by concept, each with a mechanism description and a checked source |
| `/implementations` | 71 packages, grouped by concept, with the algorithms they implement and the technologies they run on |
| `/catalogue` | The 841 entries. Filters serialise into the query string, so a filtered view is a shareable URL |
| `/definitions` | The three layers explained, with a worked terrain pipeline |
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
paper                    107
reference-implementation   6
folklore                   6
article                    6
```

**Implementations** were resolved against `registry.npmjs.org` or `pypi.org` before being written
down. Of 83 candidates, six 404ed and five resolved to unrelated projects sharing a name — PyPI
`sdf` is *Scientific Data Format*, `wfc` is *WebForms Core*. Those would have shipped as
confident, checkable lies.

**The build fails on bad annotations.** An override that matches no entry, an algorithm with no
citation or no description, a reference to an unknown concept or technology, an implementation
not marked verified — all abort the migration rather than silently doing nothing. This has caught
four real errors, including a phantom `npm:markovify` that does not exist.

### Annotations

Judgement calls live in `data/annotations/*.json` as text, not in the database, so every pass is
a reviewable diff you can argue with line by line:

| File | Holds |
|---|---|
| `tier.json` | source/operator/generator per entry, as a default per domain plus exceptions |
| `facet.json` | the four-way concept split, with the blocks hiding inside each category |
| `algorithms.json` | 125 algorithms with citations, descriptions and source types |
| `implementations.json` | registry-verified packages |
| `implementation-algorithms.json` | which implementation implements which algorithm |
| `technologies.json` | languages, runtimes, platforms |

Each file carries `_contested` or `_orphan_reason` notes recording calls that could reasonably
go the other way.

## Layout

```
source/     the original single-file HTML reference — still the source of truth for entries
data/       annotations (committed) and catalogue.db (derived, gitignored)
db/         schema
scripts/    migrate.js      — HTML + annotations -> SQLite, idempotent, fails loudly
            build-static.js — the same read layer, frozen into dist/ for Pages
            serve-dist.js   — serves dist/ the way Pages does, for checking a build
lib/        catalogue.js — the read layer: bootstrap payload, SQL console, route list
server.js   static files + /api/bootstrap.json + /api/query
public/     the browser UI
```

## What is not done

Stated plainly so the map doesn't look more finished than it is.

- **`entry_uses` has 0 rows.** Nothing records which generator is built from which sources and
  operators. This is the piece that would make the model do work rather than just describe.
- **8 of 9 entry fields are empty** across all 841: `output_type`, `input_class`, `compute_cost`,
  `deterministic`, `realtime`, `difficulty`, `confidence`, `notes`. `input_class` is the
  consequential one — it splits the catalogue into what a seed-driven engine could serve and
  what it structurally cannot.
- **79 of 125 algorithms have no implementation recorded**, and 13 of 28 concepts have none at
  all. Partly a real gap; partly a method blind spot, since registry verification cannot reach
  GitHub-hosted C++ (FastNoiseLite, mxgmn's WFC, Recast, CGAL). That needs a different check.
- **Only JavaScript and Python are populated.** C++, Rust, C#, GLSL and WASM exist in the
  technologies table with nothing attached.
- **An empty candidate queue is not completeness.** It means nothing currently identified is
  missing. `rand` and `markov` looked finished for exactly that reason until someone asked.
- Gap-hunting outside games, and an honest difficulty distribution, have not been started.

## Known errors carried over from the source data

Left in place deliberately rather than quietly patched, so the provenance stays visible.

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
