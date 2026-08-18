-- Procedural generation catalogue.
--
-- Design notes:
--  * Everything the flat HTML held is preserved verbatim. Nothing is invented here.
--  * The columns that are currently empty (entry.tier, entry.output_type, ...) exist so
--    the classification passes have somewhere to land without a migration. They stay NULL
--    until those passes are actually run and reviewed.
--  * tag.facet is likewise NULL until the tag vocabulary is re-faceted into
--    mechanism / representation / deployment.

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS source_link;
DROP TABLE IF EXISTS source;
DROP TABLE IF EXISTS correction;
DROP TABLE IF EXISTS code_sample;
DROP TABLE IF EXISTS implementation_algorithm;
DROP TABLE IF EXISTS implementation_technology;
DROP TABLE IF EXISTS implementation;
DROP TABLE IF EXISTS algorithm;
DROP TABLE IF EXISTS technology;
DROP TABLE IF EXISTS entry_uses;
DROP TABLE IF EXISTS entry_tag;
DROP TABLE IF EXISTS entry;
DROP TABLE IF EXISTS grp;
DROP TABLE IF EXISTS domain;
DROP TABLE IF EXISTS case_study_tag;
DROP TABLE IF EXISTS case_study;
DROP TABLE IF EXISTS pitfall;
DROP TABLE IF EXISTS tool;
DROP TABLE IF EXISTS reading;
DROP TABLE IF EXISTS tag;

CREATE TABLE tag (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  -- 'block' | 'representation' | 'category' | 'deployment' -- NULL until faceted.
  facet    TEXT,
  what     TEXT,
  good     TEXT,
  bad      TEXT,
  watch    TEXT,
  -- Explain-like-I'm-five: the concept with no jargon, in terms a child could picture.
  -- Held in data/annotations/concepts.json, not in the source HTML.
  eli5     TEXT,
  -- 'source' if the concept came from the original reference, 'added' if this project
  -- named it. Added concepts have no entry_tag rows from the HTML, so a count of 0 there
  -- means "not tagged upstream", not "unused".
  origin   TEXT NOT NULL DEFAULT 'source',
  position INTEGER
);

CREATE TABLE domain (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  blurb    TEXT,
  position INTEGER
);

CREATE TABLE grp (
  id        INTEGER PRIMARY KEY,
  domain_id TEXT NOT NULL REFERENCES domain(id),
  name      TEXT NOT NULL,
  position  INTEGER
);

CREATE TABLE entry (
  id          INTEGER PRIMARY KEY,
  group_id    INTEGER NOT NULL REFERENCES grp(id),
  name        TEXT NOT NULL,
  description TEXT,
  position    INTEGER,

  -- The three-layer split: 'source' | 'operator' | 'generator'. NULL until classified.
  tier         TEXT,

  -- Classification metadata. All NULL until the classification pass runs.
  output_type   TEXT,  -- image | vector | mesh | audio | text | data | schedule | plan | field
  input_class   TEXT,  -- seed | seed+library | external-data
  compute_cost  TEXT,  -- trivial | moderate | heavy | offline-only
  deterministic TEXT,  -- yes | no | conditional
  realtime      TEXT,  -- yes | no | with-caveats
  difficulty    TEXT,  -- wrap-a-library | weekend | month | research | unsolved
  confidence    TEXT,  -- attested | plausible | unverified
  notes         TEXT
);

CREATE TABLE entry_tag (
  entry_id INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  tag_id   TEXT    NOT NULL REFERENCES tag(id),
  PRIMARY KEY (entry_id, tag_id)
);

-- Which sources/operators a generator is built from. Empty until the clustering pass.
CREATE TABLE entry_uses (
  entry_id      INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  uses_entry_id INTEGER NOT NULL REFERENCES entry(id) ON DELETE CASCADE,
  PRIMARY KEY (entry_id, uses_entry_id)
);

CREATE TABLE case_study (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  position    INTEGER
);

CREATE TABLE case_study_tag (
  case_study_id INTEGER NOT NULL REFERENCES case_study(id) ON DELETE CASCADE,
  tag_id        TEXT    NOT NULL REFERENCES tag(id),
  PRIMARY KEY (case_study_id, tag_id)
);

CREATE TABLE pitfall (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  position    INTEGER
);

CREATE TABLE tool (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  category    TEXT,
  position    INTEGER
);

CREATE TABLE reading (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  category    TEXT,
  position    INTEGER
);

-- ---------------------------------------------------------------------------
-- The rebuild: algorithms, implementations, technologies.
--
-- concept (tag) --< algorithm --< implementation >-- technology
--
-- An algorithm only exists here if its citation was checked. Unchecked names live
-- in the annotation file's `candidates` list and are deliberately not given rows,
-- so a query over this table never returns something unsourced.

CREATE TABLE technology (
  id       TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  kind     TEXT,            -- language | runtime | platform
  note     TEXT,
  position INTEGER
);

CREATE TABLE algorithm (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  concept_tag TEXT REFERENCES tag(id),
  year        INTEGER,
  authors     TEXT,
  summary     TEXT,
  description TEXT,
  -- Explain-like-I'm-five. Required for every algorithm: if the mechanism cannot be put
  -- in plain words, the description above is probably describing a name, not a method.
  eli5        TEXT,
  tier        TEXT,         -- source | operator | generator
  -- How well-sourced the entry is. Widened from paper-only after the rule proved to
  -- exclude real, widely-used techniques that were simply never published academically.
  source_type TEXT,         -- paper | article | reference-implementation | folklore
  citation    TEXT,
  url         TEXT,
  position    INTEGER
);

CREATE TABLE implementation (
  id           INTEGER PRIMARY KEY,
  package      TEXT NOT NULL,
  -- npm | pypi | cargo | nuget | github. `github` is for libraries that ship only as a
  -- repository, which is where most of the C++ and shader work lives; the row is resolved
  -- against api.github.com rather than a package registry.
  ecosystem    TEXT,
  concept_tag  TEXT REFERENCES tag(id),
  role         TEXT,        -- generation-library | output-surface | solver | model | authoring-app
  version      TEXT,
  last_release TEXT,
  description  TEXT,
  repo         TEXT,
  license      TEXT,
  -- Refreshed weekly by scripts/poll-registries.js, not hand-maintained. `stars` is null where
  -- the project has no GitHub repository -- 12 of them, mostly PyPI packages living on GitLab
  -- or their own domain -- so a null means "not applicable", not "zero".
  stars        INTEGER,
  archived     INTEGER NOT NULL DEFAULT 0,
  verified     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (ecosystem, package)
);

-- Which algorithms an implementation actually implements. Many-to-many: `scipy` covers
-- Voronoi, Halton, Sobol and B-splines; simplex noise has nine implementations.
-- An implementation with no row here is a signal — either the algorithm is missing from
-- the algorithm layer, or the thing is not a generation library and was mis-roled.
CREATE TABLE implementation_algorithm (
  implementation_id INTEGER NOT NULL REFERENCES implementation(id) ON DELETE CASCADE,
  algorithm_id      TEXT    NOT NULL REFERENCES algorithm(id),
  PRIMARY KEY (implementation_id, algorithm_id)
);

CREATE TABLE implementation_technology (
  implementation_id INTEGER NOT NULL REFERENCES implementation(id) ON DELETE CASCADE,
  technology_id     TEXT    NOT NULL REFERENCES technology(id),
  PRIMARY KEY (implementation_id, technology_id)
);

-- ---------------------------------------------------------------------------
-- Code samples. One per (algorithm, language), and only where the whole method
-- fits in 100 lines — the point is to show that the mechanism *is* small, not to
-- ship a library. The migration rejects anything longer, so the claim stays true.

CREATE TABLE code_sample (
  id           INTEGER PRIMARY KEY,
  algorithm_id TEXT NOT NULL REFERENCES algorithm(id) ON DELETE CASCADE,
  technology   TEXT NOT NULL REFERENCES technology(id),
  lines        INTEGER NOT NULL,
  note         TEXT,          -- what the sample leaves out, and how to run it
  code         TEXT NOT NULL,
  position     INTEGER,
  UNIQUE (algorithm_id, technology)
);

-- ---------------------------------------------------------------------------
-- Research sources. Every URL gathered while checking something, with what it
-- settles and what it is attached to. `source_link.layer` says which table
-- `target_id` points into; the migration checks that the target exists.

CREATE TABLE source (
  id          TEXT PRIMARY KEY,
  url         TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  -- paper | article | docs | reference-implementation | registry | wiki | book | thesis | course
  kind        TEXT,
  publisher   TEXT,
  year        INTEGER,
  -- Why this URL is here: what question it answered. Not a summary of the page.
  description TEXT NOT NULL,
  retrieved   TEXT,
  position    INTEGER
);

CREATE TABLE source_link (
  source_id TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  layer     TEXT NOT NULL,   -- concept | algorithm | implementation | technology
  target_id TEXT NOT NULL,
  -- defines | describes | verifies | corrects | disputes | implements | benchmarks
  relation  TEXT NOT NULL,
  note      TEXT,
  PRIMARY KEY (source_id, layer, target_id, relation)
);

-- ---------------------------------------------------------------------------
-- Every correction this project made to something it had previously asserted,
-- kept as a row rather than a quiet edit. `was` is what the catalogue said before.

CREATE TABLE correction (
  id         INTEGER PRIMARY KEY,
  -- concept | algorithm | implementation | source-data | readme
  layer      TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  field      TEXT,
  was        TEXT,
  now        TEXT,
  why        TEXT NOT NULL,
  source_url TEXT,
  position   INTEGER
);

CREATE INDEX idx_algo_concept ON algorithm(concept_tag);
CREATE INDEX idx_impl_concept ON implementation(concept_tag);
CREATE INDEX idx_code_algo    ON code_sample(algorithm_id);
CREATE INDEX idx_srclink_tgt  ON source_link(layer, target_id);
CREATE INDEX idx_corr_target  ON correction(layer, target_id);

CREATE INDEX idx_entry_group ON entry(group_id);
CREATE INDEX idx_grp_domain  ON grp(domain_id);
CREATE INDEX idx_et_tag      ON entry_tag(tag_id);
CREATE INDEX idx_entry_tier  ON entry(tier);
