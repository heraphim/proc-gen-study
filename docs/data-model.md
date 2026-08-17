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
```

### The catalogue side

| Table | Rows | Notes |
|---|---|---|
| `domain` | 23 | Top-level subject areas, from the original reference |
| `grp` | 110 | Sub-groupings within a domain |
| `entry` | 841 | One generatable thing. Carries the classification columns |
| `tag` | 28 | Concepts. `facet` splits them four ways |
| `entry_tag` | 1437 | Which concepts an entry draws on. This is a `uses` edge, not an `is-a` |
| `entry_uses` | 0 | Which sources and operators a generator composes. Not yet populated |

`entry_tag` deserves a note: "cobblestone paving is tagged `vor`" *means* "uses Voronoi". The
1437 assignments are therefore already a composition graph, just at the coarsest possible grain.
Refining it means replacing `vor` with the two or three specific concepts an entry actually
leans on.

### The machinery side

| Table | Rows | Notes |
|---|---|---|
| `algorithm` | 125 | Named methods. `source_type` records how well-sourced |
| `implementation` | 71 | Packages, registry-verified |
| `implementation_algorithm` | 104 | Many-to-many. The important link |
| `technology` | 11 | Languages, runtimes, platforms |
| `implementation_technology` | 71 | Where an implementation can run |

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
| `output_type` | image, vector, mesh, audio, text, data, schedule, plan, field | 0 |
| `input_class` | seed / seed+library / external-data | 0 |
| `compute_cost` | trivial / moderate / heavy / offline-only | 0 |
| `deterministic` | yes / no / conditional | 0 |
| `realtime` | yes / no / with-caveats | 0 |
| `difficulty` | wrap-a-library / weekend / month / research / unsolved | 0 |
| `confidence` | attested / plausible / unverified | 0 |
| `notes` | free text | 0 |

`input_class` is the one that matters most for anything built downstream. A large share of the
catalogue — rostering, radiotherapy planning, patient-specific implants — is a solver over
supplied data. Those cannot run from a seed at all, and no current column records that.

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

This is not defensive decoration. It has caught a phantom npm package, a stale coverage claim,
an id that did not match its content, and several typos that would otherwise have shipped as
silent no-ops.

## API

Two endpoints, both read-only.

`GET /api/bootstrap` returns everything the UI needs in one payload (~380 KB). All filtering
happens client-side; there is no per-query round trip.

`POST /api/query` takes `{ sql }` and runs it. `SELECT` and `WITH` only, one statement at a
time, against a read-only connection. This is what makes the SQL page possible and is the main
payoff of moving off the flat HTML file.

## Adding to the data

**A new algorithm** — add to `data/annotations/algorithms.json` with `id`, `name`, `concept`,
`year`, `authors`, `tier`, `source_type`, `summary`, `description`, `citation`, `url`. Check the
URL resolves before committing. `npm run migrate` will reject it if anything is missing.

**A new implementation** — verify it against its registry first:

```bash
curl -s -o /dev/null -w '%{http_code}' https://registry.npmjs.org/PACKAGE
curl -s -o /dev/null -w '%{http_code}' https://pypi.org/pypi/PACKAGE/json
```

Then add it to `implementations.json` with `verified: true`, and map it in
`implementation-algorithms.json`. An empty algorithm list is acceptable and meaningful — record
why in `_orphan_reason`.

**A judgement call you are unsure about** — put it in the file's `_contested` array rather than
leaving it invisible. Several of those have since been overturned by someone reading them.
