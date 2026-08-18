# Data model

The schema in `db/schema.sql`, and why it is shaped this way.

## Tables

```
domain ──< grp ──< entry ──< entry_tag >── tag
                    │                       │
                    └─< entry_uses          ├─< algorithm ──< implementation_algorithm
                                            │       │                  │
                                            │       └─< code_sample    │
                                            └─< implementation ──< implementation_technology
                                                                       │
                                                                  technology

source ──< source_link ──▶ (concept | algorithm | implementation | technology)
correction ──▶ (concept | algorithm | implementation | source-data | readme)
review ──< review_model
review ──▶ (concept | algorithm)
further_reading ──▶ (concept | algorithm)
```

### The catalogue side

| Table | Rows | Notes |
|---|---|---|
| `domain` | 23 | Top-level subject areas, from the original reference |
| `grp` | 110 | Sub-groupings within a domain |
| `entry` | 841 | One generatable thing. Carries the classification columns and the axis values |
| `tag` | 37 | Concepts. `facet` splits them four ways; `origin` separates the 28 inherited from the 9 added |
| `entry_tag` | 1487 | Which concepts an entry draws on. This is a `uses` edge, not an `is-a` |
| `entry_uses` | 0 | Which sources and operators a generator composes. Not yet populated |

`entry_tag` deserves a note: "cobblestone paving is tagged `vor`" *means* "uses Voronoi". The
1487 assignments are therefore already a composition graph, just at the coarsest possible grain.
Refining it means replacing `vor` with the two or three specific concepts an entry actually
leans on.

Four more tables carry the rest of the original reference through unchanged. They have no
annotation file and nothing is built on top of them; they exist so that migrating to SQLite lost
nothing, and they are what `/case-studies`, `/pitfalls` and `/tools` render.

| Table | Rows | Notes |
|---|---|---|
| `case_study` | 31 | Worked examples from the reference, tagged with concepts via `case_study_tag` (60 rows) |
| `pitfall` | 10 | Named failure modes |
| `tool` | 29 | Software the reference recommended |
| `reading` | 10 | The reference's reading list. A flat list of names with no target — which is why this project's own link table had to be called `further_reading` |

### The axis side

| Column | Values | Question |
|---|---|---|
| `entry.addressing` | positional · replayable · accumulating | Can you compute one piece of the output without computing the rest? |
| `entry.input_class` | seed · seed+library · external-data | What does it need besides a seed? |
| `entry.runs_at` | shader-time · ahead-of-time | Evaluated in the shader every frame, or produced ahead of time and stored? |

An axis is not a concept and is deliberately not in the tag vocabulary. The difference is that
nothing implements an axis: a concept is something you can be told to go and build, an axis is a
property of the work that can only be observed. The two concepts that failed that test — `shader`
and `kit`, the only two with no algorithm rows — are where two of these came from, and their tag
rows are what the classification reads from.

Values come from a rule keyed on concept tag plus per-entry overrides, both in `axes.json`, the
same shape `tier.json` uses. The rule is written down rather than applied silently so it can be
argued with, and where an entry's concepts disagree a stated precedence decides — for
`addressing`, that if any part of a method accumulates state then the whole method does, because
that is the direction the constraint actually runs.

`addressing` occupies the column that used to be `deterministic`. That column was never filled
and was not worth filling: almost everything here is reproducible from a seed, so it sorted 841
rows into one bucket. Whether you can reach a point without replaying to it is the question it
was reaching for, and it is the one that decides whether a technique can serve a streamed world.

### The machinery side

| Table | Rows | Notes |
|---|---|---|
| `algorithm` | 195 | Named methods. `source_type` records how well-sourced |
| `implementation` | 120 | Packages, verified against npm, PyPI, crates.io, NuGet or the GitHub API |
| `implementation_algorithm` | 270 | Many-to-many. The important link |
| `technology` | 11 | Languages, runtimes, platforms |
| `implementation_technology` | 172 | Where an implementation can run |

`implementation` also keeps a `concept_tag`. That is deliberate redundancy: an implementation
with a concept but no algorithm link is a **signal**, not an omission. Either the algorithm it
implements has no row yet, or the package is not a generation library and was mis-roled. Both
cases have been found this way.

### The evidence side

| Table | Notes |
|---|---|
| `code_sample` | Working code for algorithms whose whole mechanism fits in under 100 lines. The limit is enforced by the migration |
| `source` | Every URL consulted while checking a claim, with the question it answered |
| `source_link` | What each source bears on: `layer` + `target_id` + a relation (`defines`, `verifies`, `corrects`, `disputes`, …) |
| `correction` | What this catalogue asserted, what it now says, and why. A row, not a quiet edit |
| `review` | What the scheduled audit found, one row per subject per round. History is kept: a later round contradicting an earlier one is the models being unstable, which is a third finding and only exists while both are here |
| `review_model` | Each model's answer separately, with what it cost in tokens. Two models agreeing against this catalogue and two disagreeing with each other mean opposite things, and a merged verdict cannot tell them apart |
| `further_reading` | Articles and write-ups for a concept or algorithm. Not sources — a source settled a question, this is worth reading. Rejected candidates stay, with a reason: the share of URLs a model invents is the measure of how far to trust it |

The last three are at **0 rows**. `review`, `review_model` and `further_reading` are written by
the nightly audit, which is built and gated but has not yet run against anything — see *The
automations* in the README. Nothing renders them and nothing has populated them, so
`scripts/check-guards.js` is currently the only thing exercising their validation rules at all:
it writes fixtures in, runs the migration against each, and restores. A guard nobody has seen
fail is a guard nobody knows works.

`tag.eli5` and `algorithm.eli5` hold a jargon-free explanation. This is not decoration: a
concept that cannot be explained without its own vocabulary has not been pinned down, and
writing these forced several descriptions to be rewritten rather than translated.

`tag.origin` separates the 28 concepts inherited from the source reference from those this
project named. An added concept starts with no `entry_tag` rows, because the HTML never used
it — so its `applies_to` list in `concepts.json` has to earn them one entry at a time.

## Classification columns on `entry`

| Column | Values | Filled |
|---|---|---|
| `tier` | source / operator / generator | **841 / 841** |
| `addressing` | positional / replayable / accumulating | **841 / 841** — axis |
| `input_class` | seed / seed+library / external-data | **841 / 841** — axis |
| `runs_at` | shader-time / ahead-of-time | **841 / 841** — axis |
| `output_type` | image, vector, mesh, audio, text, data, schedule, plan, field | 0 |
| `compute_cost` | trivial / moderate / heavy / offline-only | 0 |
| `realtime` | yes / no / with-caveats | 0 |
| `difficulty` | wrap-a-library / weekend / month / research / unsolved | 0 |
| `confidence` | attested / plausible / unverified | 0 |
| `notes` | free text | 0 |

`input_class` is the one that matters most for anything built downstream. A large share of the
catalogue — rostering, radiotherapy planning, patient-specific implants — is a solver over
supplied data. Those cannot run from a seed at all, and 123 entries now say so.

The three marked *axis* are not just filled columns; they are rendered and argued for on the
basic blocks page beside the concepts, because how an entry behaves is a different kind of fact
from what it is made of and the page had no way of saying so. There was a `deterministic` column
here and it is gone — see the axis section above for why.

## The annotation pipeline

The database is derived. Never edit `data/catalogue.db`; edit an annotation and re-run
`npm run migrate`.

```
source/*.html  ─┐
                ├─▶ scripts/migrate.js ─▶ data/catalogue.db
data/annotations/*.json ─┘
```

Annotations are JSON so that a pass over 841 entries reads as a diff. `tier.json` in particular
stores a default per domain plus only the exceptions, so the shape of a judgement is visible
rather than buried in 841 opaque rows.

### Build-time validation

The migration aborts and rolls back on any of:

- a tier override matching no entry, or more than one
- an entry left without a tier
- an axis naming a column `entry` does not have, or colliding with a concept id
- an axis with fewer than two values, a value missing its what/buys/costs, a default that is not
  one of its values, or a precedence list that does not name each value exactly once
- an axis rule or override naming an unknown concept, an unknown entry, or an unknown value
- an entry left without a value on any axis
- a column listed as both an axis and still empty
- a tag left without a facet, or without an `eli5`
- an algorithm with no citation URL, no description, an invalid `source_type` or an invalid `tier`
- two algorithms sharing an id
- an algorithm or implementation referencing an unknown concept
- an implementation not marked `verified`
- an implementation-to-algorithm mapping naming an unknown package or algorithm
- a concept correction whose `was` no longer matches the text it claims to be correcting
- an added concept missing a facet, a reason, or a named importable package
- an added concept's `applies_to` naming an entry that does not exist
- a code sample over 100 lines, empty, or attached to an unknown algorithm or technology
- a source with no description, a duplicate URL, or a link to a target that does not exist
- a review of a concept or algorithm that does not exist, an unknown agreement value, an unknown
  provider, or a review recording no model answers at all
- review rounds that skip or repeat, rather than running 1, 2, 3 for a subject
- **a rotation that has starved a subject**: no subject may be more than one round ahead of the
  least-reviewed one. Everything reaches 1 before anything reaches 2
- an accepted reading link that was never fetched, did not answer 200, or has no title to have
  been matched against; a rejected one with no reason

This is not defensive decoration. It has caught a phantom npm package, a stale coverage claim,
an id that did not match its content, and several typos that would otherwise have shipped as
silent no-ops.

## API

Two endpoints, both read-only.

`GET /api/bootstrap.json` returns everything the UI needs in one payload. All filtering happens
client-side; there is no per-query round trip. The static build freezes it to a file of the same
name, so the client fetches one path either way.

It is now ~920 KB, up from ~380 KB, and the growth is worth naming because it is the price of
this design rather than a leak: 379 KB is the 841 entries, 382 KB is the algorithm layer, and
within that 59 KB is code samples and 59 KB is plain-language explanations. It gzips to ~238 KB,
which is what actually crosses the wire. If it doubles again, the answer is to split the
algorithm layer into its own lazily-fetched payload rather than to trim the prose.

`POST /api/query` takes `{ sql }` and runs it. `SELECT` and `WITH` only, one statement at a
time, against a read-only connection. This is what makes the SQL page possible and is the main
payoff of moving off the flat HTML file.

## Adding to the data

**A new algorithm** — add to `data/annotations/algorithms.json` with `id`, `name`, `concept`,
`year`, `authors`, `tier`, `source_type`, `summary`, `eli5`, `description`, `citation`, `url`.
Check the URL resolves before committing. `npm run migrate` will reject it if anything is
missing, including the `eli5`.

**A new implementation** — verify it against its registry first, and read what comes back rather
than only the status code. A 200 proves the package exists; it does not prove it is the thing you
meant, and that mistake has been made four times in this file's history:

```bash
curl -s https://registry.npmjs.org/PACKAGE | head -c 400
curl -s https://pypi.org/pypi/PACKAGE/json | head -c 400
curl -s https://crates.io/api/v1/crates/PACKAGE | head -c 400
curl -s https://api.nuget.org/v3-flatcontainer/package/index.json
curl -s https://api.github.com/repos/OWNER/REPO | head -c 400
```

Then add it to `implementations.json` with `verified: true`, and map it in
`implementation-algorithms.json`. An empty algorithm list is acceptable and meaningful — record
why in `_orphan_reason`.

**A new code sample** — write it as a file, run it, and only then add it to
`code-samples.json` as an array of lines. It must be the whole mechanism, must print something
that demonstrates or checks its own claim, and must be under 100 lines. The migration enforces
the last of those; the other two are on you.

**A new source** — add it to `sources.json` with a `description` saying what question it
answered, not what the page is about, and at least one link into the concept, algorithm,
implementation or technology layer. A duplicate URL or a link to a target that does not exist
fails the build.

**A correction** — never edit an assertion silently. Concept-prose corrections go in
`concepts.json` and must quote the text they replace, so a stale correction fails the build
rather than applying. Everything else goes in `corrections.json` with `was`, `now` and `why`.

**A judgement call you are unsure about** — put it in the file's `_contested` array rather than
leaving it invisible. Several of those have since been overturned by someone reading them. If you
considered adding a concept and decided against it, `_rejected` in `concepts.json` is where the
reason goes, so that an empty rejection list never implies nothing was ever turned down.
