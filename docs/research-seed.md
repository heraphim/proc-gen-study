# Research seed

Which subjects the audit looks at first. Tick what you could catch a wrong answer about.

This is a calibration set, not a wishlist. Three models researching `perlin-noise` produce
an answer you can referee; the same three researching `dantzig-wolfe-decomposition` produce
one you cannot, and a confident wrong answer is indistinguishable from a confident right one
until someone knows the difference. So the ticked subjects run first, and what they are
really testing is whether the pipeline is worth pointing at the rest.

Untick anything inside a concept you know that you do not actually know. Tick anything
outside it that you do. Regenerating this file keeps your ticks.

Read by `scripts/research-seed.js`, which is read in turn by the rotation in
`scripts/pick-subject.js`. Once every subject has had a first review the seed stops
mattering, because from then on the rotation is driven purely by who is behind.

## concept

- [x] `ca` — Cellular automata · block · 4 algorithms
- [ ] `dsp` — Audio synthesis & DSP · block · 4 algorithms
- [ ] `ero` — Erosion models · block · 4 algorithms
- [x] `fractal` — Fractals & IFS · block · 6 algorithms
- [x] `graph` — Graph algorithms · block · 10 algorithms
- [ ] `ik` — Inverse kinematics & procedural rigs · block · 3 algorithms
- [ ] `lsys` — L-systems · block · 3 algorithms
- [ ] `markov` — Markov chains & n-grams · block · 3 algorithms
- [x] `noise` — Noise functions · block · 11 algorithms
- [x] `rand` — Pseudo-random generation · block · 17 algorithms
- [ ] `rd` — Reaction–diffusion · block · 1 algorithm
- [ ] `samp` — Sampling & packing · block · 9 algorithms
- [x] `tile` — Tiling & symmetry · block · 7 algorithms
- [x] `vor` — Voronoi & Delaunay · block · 4 algorithms
- [ ] `wfc` — Wave Function Collapse · block · 2 algorithms
- [ ] `agent` — Agent-based methods · category · 5 algorithms
- [ ] `colour` — Colour spaces & palettes · added by this project · 5 algorithms
- [ ] `cons` — Constraint solving · category · 8 algorithms
- [ ] `csg` — CSG & boolean modelling · representation · 2 algorithms
- [ ] `evo` — Search-based PCG · category · 7 algorithms
- [ ] `field` — Fields & grids · added by this project · 5 algorithms
- [ ] `filter` — Convolution & image-space operators · added by this project · 5 algorithms
- [ ] `gram` — Shape & string grammars · category · 5 algorithms
- [ ] `hydro` — Flow routing & drainage networks · added by this project · 4 algorithms
- [ ] `kit` — Modular kits & kitbashing · deployment · 0 algorithms
- [ ] `mesh` — Meshes & connectivity · added by this project · 5 algorithms
- [ ] `ml` — Machine learning (PCGML) · category · 8 algorithms
- [ ] `morph` — Morphable & statistical shape models · representation · 4 algorithms
- [ ] `part` — Space partitioning · representation · 4 algorithms
- [x] `pick` — Weighted choice & random tables · added by this project · 3 algorithms
- [ ] `sdf` — SDFs & implicit surfaces · representation · 7 algorithms
- [ ] `shader` — Shader-time generation · deployment · 0 algorithms
- [ ] `sim` — Simulation · category · 10 algorithms
- [ ] `spline` — Splines & sweeps · representation · 6 algorithms
- [ ] `subdiv` — Subdivision & refinement · added by this project · 5 algorithms
- [ ] `texsyn` — Example-based texture synthesis · added by this project · 6 algorithms
- [ ] `topopt` — Topology & inverse design · added by this project · 3 algorithms

## algorithm · ca (4)

- [x] `conways-life` — Conway's Game of Life · 1970
- [x] `falling-sand` — Falling-sand automata · 2005
- [x] `neural-cellular-automata` — Neural cellular automata · 2020
- [x] `reiter-snowflake` — Reiter snowflake model · 2005

## algorithm · fractal (6)

- [x] `apollonian-gasket` — Apollonian gasket · 1643
- [x] `fractal-flames` — Fractal flames · 2003
- [x] `hilbert-curve` — Hilbert curve · 1891
- [x] `iterated-function-systems` — Iterated function systems · 1988
- [x] `mandelbrot-set` — Mandelbrot set · 1980
- [x] `midpoint-displacement` — Midpoint displacement / diamond-square · 1982

## algorithm · graph (10)

- [x] `a-star` — A* · 1968
- [x] `dijkstra` — Dijkstra's algorithm · 1959
- [x] `ellers-algorithm` — Eller's algorithm · 1982
- [x] `knuth-plass` — Knuth–Plass line breaking · 1981
- [x] `kruskal` — Kruskal's algorithm · 1956
- [x] `prim` — Prim's algorithm · 1957
- [x] `recast-navmesh` — Recast navmesh generation · 2009
- [x] `recursive-backtracker` — Recursive backtracker · 1980
- [x] `straight-skeleton` — Straight skeleton · 1995
- [x] `wilsons-algorithm` — Wilson's algorithm · 1996

## algorithm · noise (11)

- [x] `curl-noise` — Curl noise · 2007
- [x] `domain-warping` — Domain warping · 2008
- [x] `fbm` — fBm / octave summation · 1968
- [x] `gabor-noise` — Gabor noise · 2009
- [x] `improved-perlin` — Improved Perlin noise · 2002
- [x] `perlin-noise` — Perlin noise · 1985
- [x] `ridged-multifractal` — Ridged multifractal · 1994
- [x] `simplex-noise` — Simplex noise · 2001
- [x] `value-noise` — Value noise · 1985
- [x] `wavelet-noise` — Wavelet noise · 2005
- [x] `worley-noise` — Worley / cellular noise · 1996

## algorithm · pick (3)

- [x] `alias-method` — Alias method · 1977
- [x] `fisher-yates` — Fisher–Yates shuffle · 1964
- [x] `shuffle-bag` — Shuffle bags and pity timers · 2000

## algorithm · rand (17)

- [x] `alea` — Alea · 2010
- [ ] `wang-hash` — Integer bit-mix hash (Wang, Jenkins)
- [ ] `lagged-fibonacci` — Lagged Fibonacci and add-with-carry · 1991
- [ ] `lcg` — Linear congruential generator · 1951
- [ ] `lxm` — LXM · 2021
- [x] `mersenne-twister` — Mersenne Twister · 1998
- [ ] `middle-square` — Middle-square method · 1949
- [ ] `murmurhash3` — MurmurHash3 · 2011
- [x] `pcg-random` — PCG · 2014
- [ ] `pcg-hash` — PCG hash (pcg2d, pcg3d, pcg4d) · 2020
- [ ] `philox` — Philox and Threefry (counter-based) · 2011
- [ ] `sine-hash` — Sine hash (shader white noise)
- [x] `splitmix` — SplitMix · 2014
- [ ] `well` — WELL · 2006
- [x] `xorshift` — Xorshift · 2003
- [x] `xoshiro` — xoshiro / xoroshiro · 2018
- [ ] `xxhash` — xxHash · 2012

## algorithm · tile (7)

- [x] `euclidean-rhythms` — Euclidean rhythms (Bjorklund) · 2005
- [x] `histogram-preserving-blending` — Histogram-preserving blending · 2018
- [x] `penrose-tiling` — Penrose tiling · 1974
- [x] `hex-tiling` — Practical real-time hex-tiling · 2022
- [x] `hat-monotile` — The hat — an aperiodic monotile · 2023
- [x] `spectre-monotile` — The spectre — a chiral aperiodic monotile · 2023
- [x] `wang-tiles` — Wang tiles · 1961

## algorithm · vor (4)

- [x] `bowyer-watson` — Bowyer–Watson · 1981
- [x] `chew-ruppert-refinement` — Delaunay refinement · 1995
- [x] `fortune-sweepline` — Fortune's sweepline · 1986
- [x] `lloyd-relaxation` — Lloyd relaxation · 1982

## algorithm · agent (5)

- [ ] `boids` — Boids · 1987
- [ ] `dla` — Diffusion-limited aggregation · 1981
- [ ] `physarum` — Physarum transport networks · 2010
- [ ] `social-force-model` — Social force model · 1995
- [ ] `space-colonisation` — Space colonisation · 2007

## algorithm · colour (5)

- [ ] `ciede2000` — CIEDE2000 colour difference · 2001
- [ ] `cielab` — CIELAB · 1976
- [ ] `median-cut` — Median cut colour quantisation · 1982
- [ ] `oklab` — Oklab · 2020
- [ ] `wcag-contrast` — WCAG relative luminance contrast · 2008

## algorithm · cons (8)

- [ ] `ac-3` — AC-3 arc consistency · 1977
- [ ] `ac-4` — AC-4 arc consistency · 1986
- [ ] `answer-set-programming` — Answer set programming · 1988
- [ ] `cassowary` — Cassowary · 2001
- [ ] `column-generation` — Column generation · 1961
- [ ] `cp-sat` — CP-SAT · 2019
- [ ] `dpll` — DPLL · 1962
- [ ] `simplex-method` — Simplex method / linear programming · 1947

## algorithm · csg (2)

- [ ] `bsp-booleans` — BSP-tree set operations · 1987
- [ ] `robust-predicates` — Exact geometric predicates · 1997

## algorithm · dsp (4)

- [ ] `digital-waveguide` — Digital waveguide synthesis · 1992
- [ ] `fm-synthesis` — FM synthesis · 1973
- [ ] `granular-synthesis` — Granular synthesis · 1988
- [ ] `karplus-strong` — Karplus–Strong string synthesis · 1983

## algorithm · ero (4)

- [ ] `aeolian-transport` — Aeolian sand transport · 1941
- [ ] `droplet-erosion` — Droplet erosion · 2005
- [ ] `mei-gpu-erosion` — Mei GPU hydraulic erosion · 2007
- [ ] `musgrave-erosion` — Musgrave hydraulic and thermal erosion · 1989

## algorithm · evo (7)

- [ ] `cma-es` — CMA-ES · 2001
- [ ] `genetic-algorithm` — Genetic algorithm · 1975
- [ ] `genetic-programming` — Genetic programming · 1992
- [ ] `map-elites` — MAP-Elites · 2015
- [ ] `mcts` — Monte Carlo tree search · 2006
- [ ] `novelty-search` — Novelty search · 2011
- [ ] `simulated-annealing` — Simulated annealing · 1983

## algorithm · field (5)

- [ ] `felzenszwalb-distance-transform` — Exact Euclidean distance transform · 2012
- [ ] `jump-flood` — Jump flooding · 2006
- [ ] `marching-squares` — Marching squares · 1987
- [ ] `mip-pyramid` — Mip pyramid / pyramidal parametrics · 1983
- [ ] `summed-area-table` — Summed-area table · 1984

## algorithm · filter (5)

- [ ] `bilateral-filter` — Bilateral filter · 1998
- [ ] `gaussian-blur` — Gaussian blur (separable convolution) · 1980
- [ ] `mathematical-morphology` — Morphological operators · 1982
- [ ] `poisson-image-editing` — Poisson image editing · 2003
- [ ] `sobel-operator` — Sobel gradient operator · 1968

## algorithm · gram (5)

- [ ] `cga-shape` — CGA shape grammars · 2006
- [ ] `graph-grammars` — Graph grammars · 1973
- [ ] `liang-hyphenation` — Liang hyphenation patterns · 1983
- [ ] `shape-grammars` — Shape grammars · 1971
- [ ] `tracery` — Tracery · 2015

## algorithm · hydro (4)

- [ ] `dinf-flow` — D-infinity flow routing · 1997
- [ ] `d8-flow-direction` — D8 flow direction and accumulation · 1984
- [ ] `priority-flood` — Priority-flood depression filling · 2014
- [ ] `strahler-order` — Strahler stream ordering · 1952

## algorithm · ik (3)

- [ ] `ccd` — Cyclic coordinate descent (CCD) · 1991
- [ ] `jacobian-dls` — Damped least-squares Jacobian IK · 1986
- [ ] `fabrik` — FABRIK · 2011

## algorithm · lsys (3)

- [ ] `procedural-cities` — L-system road networks · 2001
- [ ] `l-systems` — L-systems · 1968
- [ ] `open-l-systems` — Open L-systems · 1996

## algorithm · markov (3)

- [ ] `katz-backoff` — Katz back-off · 1987
- [ ] `kneser-ney` — Kneser–Ney smoothing · 1995
- [ ] `shannon-ngram` — n-gram models · 1948

## algorithm · mesh (5)

- [ ] `instant-meshes` — Field-aligned quad remeshing · 2015
- [ ] `lscm` — Least-squares conformal maps · 2002
- [ ] `poisson-surface-reconstruction` — Poisson surface reconstruction · 2006
- [ ] `qem-decimation` — Quadric error metric decimation · 1997
- [ ] `winged-edge` — Winged-edge and half-edge structures · 1972

## algorithm · ml (8)

- [ ] `gaussian-splatting` — 3D Gaussian splatting · 2023
- [ ] `ddpm` — Denoising diffusion (DDPM) · 2020
- [ ] `gan` — Generative adversarial network · 2014
- [ ] `latent-diffusion` — Latent diffusion · 2022
- [ ] `nerf` — Neural radiance fields · 2020
- [ ] `pcgrl` — PCGRL — level generation as a reinforcement learning task · 2020
- [ ] `transformer` — Transformer · 2017
- [ ] `vae` — Variational autoencoder · 2013

## algorithm · morph (4)

- [ ] `morphable-model-3d` — 3D Morphable Model · 1999
- [ ] `eigenfaces` — Eigenfaces (PCA shape models) · 1991
- [ ] `flame` — FLAME · 2017
- [ ] `smpl` — SMPL · 2015

## algorithm · part (4)

- [ ] `bsp-tree` — BSP trees · 1980
- [ ] `kd-tree` — k-d tree · 1975
- [ ] `quadtree` — Quadtree and octree · 1971
- [ ] `squarified-treemap` — Squarified treemaps · 2000

## algorithm · rd (1)

- [ ] `turing-reaction-diffusion` — Reaction–diffusion · 1952

## algorithm · samp (9)

- [ ] `bridson-poisson-disk` — Bridson Poisson disk sampling · 2007
- [ ] `floyd-steinberg` — Floyd–Steinberg dithering · 1976
- [ ] `halton-sequence` — Halton sequence · 1960
- [ ] `maxrects` — MaxRects bin packing · 2010
- [ ] `mitchell-best-candidate` — Mitchell's best-candidate · 1991
- [ ] `potrace` — Potrace · 2003
- [ ] `sobol-sequence` — Sobol sequence · 1967
- [ ] `void-and-cluster` — Void-and-cluster blue noise · 1993
- [ ] `weighted-voronoi-stippling` — Weighted Voronoi stippling · 2002

## algorithm · sdf (7)

- [ ] `dual-contouring` — Dual contouring · 2002
- [ ] `marching-cubes` — Marching cubes · 1987
- [ ] `marching-tetrahedra` — Marching tetrahedra · 1991
- [ ] `blinn-metaballs` — Metaballs / blobby molecules · 1982
- [ ] `sdf-primitives` — SDF primitive and operator library · 2008
- [ ] `sphere-tracing` — Sphere tracing · 1996
- [ ] `surface-nets` — Surface nets · 1998

## algorithm · sim (10)

- [ ] `discrete-event-simulation` — Discrete-event simulation · 1961
- [ ] `flip` — FLIP · 1986
- [ ] `lotka-volterra` — Lotka–Volterra · 1926
- [ ] `mpm` — Material point method · 1994
- [ ] `position-based-dynamics` — Position-based dynamics · 2007
- [ ] `procedural-tectonic-planets` — Procedural tectonic planets · 2019
- [ ] `sph` — Smoothed particle hydrodynamics · 1977
- [ ] `stable-fluids` — Stable fluids · 1999
- [ ] `tessendorf-ocean` — Tessendorf ocean spectra · 2001
- [ ] `wavelet-turbulence` — Wavelet turbulence · 2008

## algorithm · spline (6)

- [ ] `catenary` — Catenary · 1691
- [ ] `catmull-rom` — Catmull–Rom splines · 1974
- [ ] `euler-spiral` — Clothoid / Euler spiral · 1744
- [ ] `de-boor` — De Boor's algorithm · 1972
- [ ] `de-casteljau` — De Casteljau's algorithm · 1959
- [ ] `douglas-peucker` — Ramer–Douglas–Peucker simplification · 1973

## algorithm · subdiv (5)

- [ ] `sqrt3-subdivision` — √3 subdivision · 2000
- [ ] `catmull-clark` — Catmull–Clark subdivision · 1978
- [ ] `chaikin` — Chaikin's corner cutting · 1974
- [ ] `doo-sabin` — Doo–Sabin subdivision · 1978
- [ ] `loop-subdivision` — Loop subdivision · 1987

## algorithm · texsyn (6)

- [ ] `efros-leung` — Efros–Leung non-parametric synthesis · 1999
- [ ] `graphcut-textures` — Graph-cut textures · 2003
- [ ] `image-quilting` — Image quilting · 2001
- [ ] `patchmatch` — PatchMatch · 2009
- [ ] `portilla-simoncelli` — Portilla–Simoncelli statistics matching · 2000
- [ ] `texture-optimization` — Texture optimization · 2005

## algorithm · topopt (3)

- [ ] `adjoint-inverse-design` — Adjoint-gradient inverse design · 2018
- [ ] `level-set-topology-optimisation` — Level-set topology optimisation · 2004
- [ ] `simp` — SIMP density-based topology optimisation · 1989

## algorithm · wfc (2)

- [ ] `model-synthesis` — Model synthesis · 2007
- [ ] `wave-function-collapse` — Wave Function Collapse · 2016

