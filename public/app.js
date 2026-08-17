const $ = sel => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const state = {
  data: null,
  search: '',
  domains: new Set(),
  tags: new Set(),
  tiers: new Set(),
};

/* ---------------- shared page shell ----------------
   Every list page gets the same affordances: a search box, filter pills, a live
   count, collapse/expand all, and collapsible groups. Written once here rather
   than five times, so the pages cannot drift apart. */

const hashString = str => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
};

function filterablePage({
  toolbar, host, items, searchIn, filters = [], groupBy, groupHeader,
  renderItem, noun, groupOrder, emptyText = 'Nothing matches those filters.',
}) {
  const st = { q: '', active: new Map(filters.map(f => [f.key, new Set()])), collapsed: new Set(), cardsCollapsed: false };
  const tb = $(toolbar);
  const listHost = $(host);

  const bar = el('div', 'pt-row');
  const input = el('input', 'pt-search');
  input.type = 'search';
  input.placeholder = `Search ${items.length} ${noun}…`;
  input.spellcheck = false;
  input.autocomplete = 'off';
  bar.append(input);

  const count = el('span', 'pt-count');
  bar.append(count);

  const toggleGroups = el('button', 'pt-toggle', 'Collapse groups');
  const toggleAll = el('button', 'pt-toggle', 'Collapse cards');
  bar.append(toggleGroups, toggleAll);
  tb.append(bar);

  const filterRow = el('div', 'pt-filters');
  if (filters.length) tb.append(filterRow);

  // Control type per filter. Small multi-selectable sets get checkboxes, mutually
  // exclusive ones get radios, anything longer collapses into a dropdown so the
  // toolbar stays one or two lines regardless of how many options exist.
  const controlFor = f => f.control
    ?? (f.exclusive ? 'radio' : f.options.length > 4 ? 'select' : 'check');

  const inputs = [];

  for (const f of filters) {
    const row = el('div', 'pt-filter');
    row.append(el('span', 'pt-label', f.label));
    const set = st.active.get(f.key);
    const kind = controlFor(f);

    if (kind === 'select') {
      const sel = el('select', 'pt-select');
      const any = el('option', null, `All ${f.label.toLowerCase()}`);
      any.value = '';
      sel.append(any);
      for (const opt of f.options) {
        const o = el('option', null, opt.label);
        o.value = opt.id;
        sel.append(o);
      }
      sel.addEventListener('change', () => {
        set.clear();
        if (sel.value) set.add(sel.value);
        render();
      });
      row.append(sel);
      inputs.push({ f, kind, el: sel });

    } else {
      const opts = el('div', 'pt-opts');
      const name = `f-${f.key}-${Math.abs(hashString(f.label))}`;
      const entries = [];

      if (kind === 'radio') {
        const lbl = el('label', 'pt-opt');
        const input = el('input');
        input.type = 'radio'; input.name = name; input.checked = true;
        input.addEventListener('change', () => { set.clear(); render(); });
        lbl.append(input, el('span', null, 'any'));
        opts.append(lbl);
        entries.push({ id: null, input, countEl: null });
      }

      for (const opt of f.options) {
        const lbl = el('label', 'pt-opt');
        const input = el('input');
        input.type = kind === 'radio' ? 'radio' : 'checkbox';
        if (kind === 'radio') input.name = name;
        input.addEventListener('change', () => {
          if (kind === 'radio') { set.clear(); if (input.checked) set.add(opt.id); }
          else input.checked ? set.add(opt.id) : set.delete(opt.id);
          render();
        });
        const countEl = el('span', 'pt-n', '');
        lbl.append(input, el('span', null, opt.label), countEl);
        opts.append(lbl);
        entries.push({ id: opt.id, input, countEl });
      }
      row.append(opts);
      inputs.push({ f, kind, entries });
    }
    filterRow.append(row);
  }

  const matches = it => {
    for (const f of filters) {
      const set = st.active.get(f.key);
      if (set.size && ![...set].some(id => f.match(it, id))) return false;
    }
    if (!st.q) return true;
    const hay = searchIn(it).toLowerCase();
    return st.q.split(/\s+/).every(t => hay.includes(t));
  };

  function render() {
    const visible = items.filter(matches);
    listHost.textContent = '';

    count.textContent = visible.length === items.length
      ? `${items.length} ${noun}`
      : `${visible.length} / ${items.length} ${noun}`;

    for (const ctl of inputs) {
      const set = st.active.get(ctl.f.key);
      const countOf = id => items.filter(it => ctl.f.match(it, id) && matchesExcept(it, ctl.f.key)).length;

      if (ctl.kind === 'select') {
        ctl.el.value = [...set][0] ?? '';
        for (const o of ctl.el.options) {
          if (!o.value) continue;
          const base = ctl.f.options.find(x => x.id === o.value)?.label ?? o.value;
          const n = countOf(o.value);
          o.textContent = `${base} (${n})`;
          o.disabled = n === 0 && !set.has(o.value);
        }
      } else {
        for (const e of ctl.entries) {
          if (e.id === null) { e.input.checked = set.size === 0; continue; }
          e.input.checked = set.has(e.id);
          const n = countOf(e.id);
          e.countEl.textContent = n;
          e.input.parentElement.classList.toggle('zero', n === 0 && !set.has(e.id));
        }
      }
    }

    if (!visible.length) { listHost.append(el('p', 'empty', emptyText)); return; }

    const groups = new Map();
    for (const it of visible) {
      const g = groupBy ? groupBy(it) : '';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(it);
    }
    const keys = [...groups.keys()];
    if (groupOrder) keys.sort((a, b) => groupOrder(a, b, groups));

    for (const key of keys) {
      const rows = groups.get(key);
      const group = el('section', 'grp');
      group.dataset.key = String(key);
      if (st.collapsed.has(String(key))) group.classList.add('collapsed');

      if (groupBy) {
        const head = el('button', 'grp-head');
        head.append(el('span', 'grp-chevron', '▾'));
        head.append(groupHeader(key, rows));
        head.append(el('span', 'grp-n', String(rows.length)));
        head.addEventListener('click', () => {
          const k = String(key);
          st.collapsed.has(k) ? st.collapsed.delete(k) : st.collapsed.add(k);
          group.classList.toggle('collapsed');
          syncToggleAll();
        });
        group.append(head);
      }

      const body = el('div', 'grp-body');
      for (const it of rows) {
        const node = renderItem(it);
        if (st.cardsCollapsed && node.querySelector?.('.card-body')) node.classList.add('collapsed');
        body.append(node);
      }
      group.append(body);
      listHost.append(group);
    }
    syncToggleAll();
  }

  /** Facet counts should reflect the other filters, not this one. */
  function matchesExcept(it, skipKey) {
    for (const f of filters) {
      if (f.key === skipKey) continue;
      const set = st.active.get(f.key);
      if (set.size && ![...set].some(id => f.match(it, id))) return false;
    }
    if (!st.q) return true;
    return st.q.split(/\s+/).every(t => searchIn(it).toLowerCase().includes(t));
  }

  /** Two independent axes: groups (categories) and the cards inside them. */
  function syncToggleAll() {
    const cards = [...listHost.querySelectorAll('.ent-card')];
    const collapsible = cards.filter(c => c.querySelector('.card-body'));
    toggleAll.style.display = collapsible.length ? '' : 'none';
    toggleAll.textContent = st.cardsCollapsed ? 'Expand cards' : 'Collapse cards';

    const groups = [...listHost.querySelectorAll('.grp')];
    const anyOpen = groups.some(g => !g.classList.contains('collapsed'));
    toggleGroups.style.display = groupBy && groups.length > 1 ? '' : 'none';
    toggleGroups.textContent = anyOpen ? 'Collapse groups' : 'Expand groups';
  }

  toggleGroups.addEventListener('click', () => {
    const groups = [...listHost.querySelectorAll('.grp')];
    const anyOpen = groups.some(g => !g.classList.contains('collapsed'));
    st.collapsed.clear();
    if (anyOpen) for (const g of groups) st.collapsed.add(g.dataset.key);
    for (const g of groups) g.classList.toggle('collapsed', anyOpen);
    syncToggleAll();
  });

  toggleAll.addEventListener('click', () => {
    st.cardsCollapsed = !st.cardsCollapsed;
    for (const c of listHost.querySelectorAll('.ent-card')) {
      if (c.querySelector('.card-body')) c.classList.toggle('collapsed', st.cardsCollapsed);
    }
    syncToggleAll();
  });

  input.addEventListener('input', e => { st.q = e.target.value.trim().toLowerCase(); render(); });

  render();
  return { render, state: st };
}

/* ---------------- shared card ----------------
   One card shape for every page. The header and the relation strip stay visible when
   collapsed — that is the scanning view: what it is, what kind, and what it connects to.
   The body holds the prose and is hidden until wanted. */

function entityCard({ cls = '', title, id, badges = [], metrics = [], relations = [], body }) {
  const card = el('article', `card ent-card ${cls}`.trim());

  const head = el('button', 'card-head');
  head.append(el('span', 'card-chevron', '▾'));

  const titleBox = el('span', 'card-title');
  if (typeof title === 'string') titleBox.append(el('span', 'card-name', title));
  else titleBox.append(title);
  if (id) titleBox.append(el('span', 'id', id));
  for (const b of badges) {
    if (!b) continue;
    const n = el('span', b.cls, b.text);
    if (b.title) n.title = b.title;
    titleBox.append(n);
  }
  head.append(titleBox);

  if (metrics.length) {
    const m = el('span', 'card-metrics');
    metrics.forEach((t, i) => {
      if (i) m.append(el('span', 'sep', '·'));
      m.append(el('span', null, t));
    });
    head.append(m);
  }
  card.append(head);

  if (relations.length) {
    const rel = el('div', 'card-relations');
    for (const r of relations) {
      if (!r || !r.items?.length) continue;
      const grp = el('span', 'rel-grp');
      grp.append(el('span', 'rel-label', r.label));
      for (const item of r.items) {
        const chip = item.onClick ? el('button', `rel-chip ${item.cls ?? ''}`) : el('span', `rel-chip ${item.cls ?? ''}`);
        chip.textContent = item.text;
        if (item.title) chip.title = item.title;
        if (item.onClick) chip.addEventListener('click', ev => { ev.stopPropagation(); item.onClick(); });
        grp.append(chip);
      }
      rel.append(grp);
    }
    if (rel.childNodes.length) card.append(rel);
  }

  if (body) {
    const b = el('div', 'card-body');
    b.append(body);
    card.append(b);
    head.addEventListener('click', () => card.classList.toggle('collapsed'));
  } else {
    head.classList.add('no-body');
  }
  return card;
}

const data = await fetch('/api/bootstrap').then(r => r.json());
state.data = data;

const tagName = Object.fromEntries(data.tags.map(t => [t.id, t.name]));
const tagById = Object.fromEntries(data.tags.map(t => [t.id, t]));

/** Cross-layer indexes. Every card shows what it connects to, so relations are visible
    without opening anything. */
const implByAlgorithm = {};
for (const im of data.implementations ?? []) {
  for (const aid of im.algorithms ?? []) (implByAlgorithm[aid] ??= []).push(im);
}
const algosByConcept = {};
for (const a of data.algorithms ?? []) (algosByConcept[a.concept_tag] ??= []).push(a);
const implsByConcept = {};
for (const im of data.implementations ?? []) (implsByConcept[im.concept_tag] ??= []).push(im);

const goToCatalogueTag = tag => () => {
  state.tiers.clear(); state.domains.clear(); state.search = '';
  $('#search').value = '';
  state.tags.clear(); state.tags.add(tag);
  showView('catalogue'); renderAll(); window.scrollTo(0, 0);
};
const goToPage = page => () => { showView(page); window.scrollTo(0, 0); };


/* ---------------- headline ---------------- */

const tiered = data.entries.filter(e => e.tier).length;
const tierCounts = Object.fromEntries((data.tiers ?? []).map(t => [t.id, t.count]));

$('#headline').textContent =
  `${data.entries.length} entries · ${data.domains.length} domains · ${data.tags.length} tags`;

$('#classified-note').textContent = tiered === data.entries.length
  ? `Layer: all ${tiered} classified. Output type, input class, cost, difficulty and confidence are still empty.`
  : `Layer: ${tiered} of ${data.entries.length} classified.`;

$('#tier-hint').textContent = data.tierMeta?.test ?? '';

for (const note of data.tierMeta?.contested ?? []) {
  $('#contested').append(el('li', null, note));
}

/* ---------------- tabs ---------------- */

$('#tabs').addEventListener('click', e => {
  const btn = e.target.closest('button[data-view]');
  if (btn) showView(btn.dataset.view);
});

/* ---------------- catalogue filtering ---------------- */

function matches(entry) {
  if (state.tiers.size && !state.tiers.has(entry.tier)) return false;
  if (state.domains.size && !state.domains.has(entry.domain_id)) return false;
  for (const t of state.tags) if (!entry.tags.includes(t)) return false;
  if (state.search) {
    const hay = `${entry.name} ${entry.description ?? ''} ${entry.group_name} ${entry.domain_name}`.toLowerCase();
    if (!state.search.split(/\s+/).every(term => hay.includes(term))) return false;
  }
  return true;
}

function highlight(text) {
  if (!state.search) return document.createTextNode(text);
  const frag = document.createDocumentFragment();
  const terms = state.search.split(/\s+/).filter(Boolean)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return document.createTextNode(text);
  const re = new RegExp(`(${terms.join('|')})`, 'gi');
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) frag.append(text.slice(last, m.index));
    frag.append(el('mark', null, m[0]));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

function renderEntries() {
  const visible = state.data.entries.filter(matches);
  const host = $('#entries');
  host.textContent = '';

  $('#result-count').textContent = visible.length === state.data.entries.length
    ? `${visible.length} entries`
    : `${visible.length} / ${state.data.entries.length} entries`;

  renderActiveFilters();
  renderFacetCounts(visible);

  if (!visible.length) {
    host.append(el('p', 'empty', 'Nothing matches those filters.'));
    return;
  }

  // group by domain, then by group name, preserving source order
  let currentDomain = null, currentGroup = null, block = null;
  for (const entry of visible) {
    if (entry.domain_id !== currentDomain) {
      currentDomain = entry.domain_id;
      currentGroup = null;
      block = el('div', 'domain-block');
      const head = el('div', 'domain-head');
      head.append(el('h3', null, entry.domain_name));
      head.append(el('span', 'n', String(visible.filter(v => v.domain_id === currentDomain).length)));
      block.append(head);
      host.append(block);
    }
    if (entry.group_name !== currentGroup) {
      currentGroup = entry.group_name;
      block.append(el('div', 'group-name', currentGroup));
    }

    const row = el('div', 'entry');
    const name = el('div', 'name');
    if (entry.tier) {
      const badge = el('button', `tier-badge t-${entry.tier}`, entry.tier);
      badge.title = state.data.tierMeta?.definitions?.[entry.tier] ?? '';
      badge.addEventListener('click', () => toggle(state.tiers, entry.tier, renderAll));
      name.append(badge);
    }
    name.append(highlight(entry.name));
    row.append(name);

    const tags = el('div', 'tags');
    for (const t of entry.tags) {
      const b = el('button', `tag${state.tags.has(t) ? ' on' : ''}`, t);
      b.title = tagName[t] ?? t;
      b.addEventListener('click', () => toggle(state.tags, t, renderAll));
      tags.append(b);
    }
    row.append(tags);

    if (entry.description) {
      const d = el('div', 'desc');
      d.append(highlight(entry.description));
      row.append(d);
    }
    block.append(row);
  }
}

function renderActiveFilters() {
  const host = $('#active-filters');
  host.textContent = '';
  const chips = [
    ...[...state.tiers].map(t => ({ label: t, set: state.tiers, key: t })),
    ...[...state.domains].map(d => ({
      label: state.data.domains.find(x => x.id === d)?.name ?? d,
      set: state.domains, key: d,
    })),
    ...[...state.tags].map(t => ({ label: `#${t}`, set: state.tags, key: t })),
  ];
  for (const c of chips) {
    const chip = el('button', 'chip', `${c.label} ✕`);
    chip.addEventListener('click', () => toggle(c.set, c.key, renderAll));
    host.append(chip);
  }
  $('[data-clear="domain"]').classList.toggle('on', state.domains.size > 0);
  $('[data-clear="tag"]').classList.toggle('on', state.tags.size > 0);
  $('[data-clear="tier"]').classList.toggle('on', state.tiers.size > 0);
}

/** Counts shown in the sidebar reflect what would remain if you added that filter. */
function renderFacetCounts(visible) {
  const domainCounts = {}, tagCounts = {}, tierCounts = {};
  for (const e of visible) {
    domainCounts[e.domain_id] = (domainCounts[e.domain_id] ?? 0) + 1;
    if (e.tier) tierCounts[e.tier] = (tierCounts[e.tier] ?? 0) + 1;
    for (const t of e.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
  }
  for (const btn of document.querySelectorAll('#tier-list button')) {
    const n = tierCounts[btn.dataset.id] ?? 0;
    btn.querySelector('.n').textContent = n;
    btn.classList.toggle('zero', n === 0 && !state.tiers.has(btn.dataset.id));
  }
  for (const btn of document.querySelectorAll('#domain-list button')) {
    const n = domainCounts[btn.dataset.id] ?? 0;
    btn.querySelector('.n').textContent = n;
    btn.classList.toggle('zero', n === 0 && !state.domains.has(btn.dataset.id));
  }
  for (const btn of document.querySelectorAll('#tag-list button')) {
    const n = tagCounts[btn.dataset.id] ?? 0;
    btn.querySelector('.n').textContent = n;
    btn.classList.toggle('zero', n === 0 && !state.tags.has(btn.dataset.id));
  }
}

function toggle(set, value, after) {
  set.has(value) ? set.delete(value) : set.add(value);
  after();
}

function renderAll() {
  for (const btn of document.querySelectorAll('#tier-list button'))
    btn.classList.toggle('on', state.tiers.has(btn.dataset.id));
  for (const btn of document.querySelectorAll('#domain-list button'))
    btn.classList.toggle('on', state.domains.has(btn.dataset.id));
  for (const btn of document.querySelectorAll('#tag-list button'))
    btn.classList.toggle('on', state.tags.has(btn.dataset.id));
  renderEntries();
  writeUrl(true);
}

/* ---------------- sidebar construction ---------------- */

for (const t of data.tiers ?? []) {
  const li = el('li');
  const b = el('button');
  b.dataset.id = t.id;
  b.append(el('span', `label tier-label t-${t.id}`, t.id), el('span', 'n', String(t.count)));
  b.title = data.tierMeta?.definitions?.[t.id] ?? '';
  b.addEventListener('click', () => toggle(state.tiers, t.id, renderAll));
  li.append(b);
  $('#tier-list').append(li);
}

for (const d of data.domains) {
  const li = el('li');
  const b = el('button');
  b.dataset.id = d.id;
  b.append(el('span', 'label', d.name), el('span', 'n', String(d.count)));
  b.title = d.blurb ?? '';
  b.addEventListener('click', () => toggle(state.domains, d.id, renderAll));
  li.append(b);
  $('#domain-list').append(li);
}

for (const t of data.tags) {
  const li = el('li');
  const b = el('button');
  b.dataset.id = t.id;
  b.append(el('span', 'label', `${t.id} · ${t.name}`), el('span', 'n', String(t.count)));
  b.title = t.what ?? '';
  b.addEventListener('click', () => toggle(state.tags, t.id, renderAll));
  li.append(b);
  $('#tag-list').append(li);
}

$('#search').addEventListener('input', e => {
  state.search = e.target.value.trim().toLowerCase();
  renderEntries();
  writeUrl(true);
});

const CLEAR_TARGETS = { domain: state.domains, tag: state.tags, tier: state.tiers };
for (const btn of document.querySelectorAll('.clear')) {
  btn.addEventListener('click', () => {
    CLEAR_TARGETS[btn.dataset.clear]?.clear();
    renderAll();
  });
}

/* ---------------- overview page ---------------- */

// Every date and citation below was checked against a source before being written down.
// `src` is the reference used. Anything unverifiable was left out rather than guessed.
const TIMELINE = [
  {
    year: '1952', title: 'Turing, "The Chemical Basis of Morphogenesis"',
    text: 'Two chemicals diffusing at different rates produce spots and stripes. Reaction–diffusion — still the textbook method for animal coat patterns, forty years before anyone rendered one.',
    // doi:10.1098/rstb.1952.0012 — linking the freely readable copy rather than the paywall
    src: 'https://www.dna.caltech.edu/courses/cs191/paperscs191/turing.pdf',
  },
  {
    year: '1968', title: 'Lindenmayer proposes L-systems',
    text: 'A theoretical biologist describes algae growth as parallel string rewriting, in the Journal of Theoretical Biology. Not a graphics paper. Becomes the foundation of every procedural plant since.',
    // J. Theoretical Biology 18 (1968), 280–299 and 300–315; link is the open commentary reprint
    src: 'https://algorithmicbotany.org/papers/Lindenmayer2025.pdf',
  },
  {
    year: '1971', title: 'Stiny & Gips introduce shape grammars',
    text: 'Rule-driven transformation of geometric configurations, presented at IFIP Congress \'71 as a way to specify paintings and sculpture. Thirty years later it generates cities.',
    src: 'https://en.wikipedia.org/wiki/George_Stiny',
  },
  {
    year: '1978', title: 'Beneath Apple Manor',
    text: 'Don Worth\'s Apple II dungeon crawler generates a different dungeon every play from a PRNG. Predates Rogue by two years; neither author knew of the other.',
    src: 'https://en.wikipedia.org/wiki/Beneath_Apple_Manor',
  },
  {
    year: '1980', title: 'Rogue, and Vol Libre',
    text: 'Toy and Wichman\'s Rogue founds a genre. The same year, Loren Carpenter shows Vol Libre at SIGGRAPH \'80 — fractal mountains, generated, in motion.',
    src: 'https://en.wikipedia.org/wiki/Diamond-square_algorithm',
  },
  {
    year: '1982', title: 'Fournier, Fussell & Carpenter publish midpoint displacement',
    text: '"Computer rendering of stochastic models", CACM 25(6). Detail at any zoom without storing it — the first widely used terrain algorithm.',
    src: 'https://dl.acm.org/doi/10.1145/358523.358553',
  },
  {
    year: '1984', title: 'Elite',
    text: 'Bell and Braben fit eight galaxies of 256 star systems — names, economies, governments — into a 32 KB BBC Micro, unpacked from a six-byte seed. The canonical demonstration that a process is smaller than its output.',
    src: 'https://en.wikipedia.org/wiki/Elite_(video_game)',
  },
  {
    year: '1985', title: 'Perlin noise',
    text: 'Ken Perlin publishes "An Image Synthesizer" at SIGGRAPH, having built it in 1983 out of frustration with how machine-like Tron looked. Wins a Technical Achievement Academy Award in 1997.',
    src: 'https://history.siggraph.org/learning/an-image-synthesizer-by-perlin/',
  },
  {
    year: '1990', title: 'The Algorithmic Beauty of Plants',
    text: 'Prusinkiewicz and Lindenmayer turn L-systems into a complete modelling discipline. Still free online, still the reference.',
    src: 'http://algorithmicbotany.org/papers/abop/abop.pdf',
  },
  {
    year: '2001', title: 'Parish & Müller, "Procedural Modeling of Cities"',
    text: 'L-systems for street networks plus shape grammars for buildings, driven by population and terrain maps. Becomes CityEngine, now Esri\'s.',
    src: 'https://dl.acm.org/doi/abs/10.1145/383259.383292',
  },
  {
    year: '2004', title: '.kkrieger',
    text: 'A complete first-person shooter in 96 KB — every texture, mesh, and piece of music synthesised at load time. The compression argument taken to its limit.',
    src: null,
  },
  {
    year: '2006', title: 'Dwarf Fortress',
    text: 'Simulates world geology, then centuries of history, then lets you read the stories out of it. Shifts the ambition from generating space to generating events.',
    src: null,
  },
  {
    year: '2016', title: 'Wave Function Collapse',
    text: 'Maxim Gumin releases WFC — learn adjacency rules from one example image, propagate constraints, generate forever. Closely related to Paul Merrell\'s model synthesis (2007). Forked over a thousand times.',
    src: 'https://en.wikipedia.org/wiki/Model_synthesis',
  },
  {
    year: '2020s', title: 'Learned generation',
    text: 'Diffusion and transformer models take over faces, textures, motion, music and text. They buy fidelity and cost control — the open problems are guarantees, consistency and provenance.',
    src: null,
  },
];

const tl = $('#timeline');
for (const item of TIMELINE) {
  const li = el('li', 'tl-item');
  li.append(el('div', 'tl-year', item.year));
  const body = el('div', 'tl-body');
  const h = el('h3', null, item.title);
  body.append(h, el('p', null, item.text));
  if (item.src) {
    const a = el('a', 'tl-src', 'source');
    a.href = item.src; a.target = '_blank'; a.rel = 'noreferrer';
    body.append(a);
  }
  li.append(body);
  tl.append(li);
}

$('#hero-stats').textContent =
  `${data.entries.length} catalogued techniques · ${data.domains.length} domains · `
  + `${data.caseStudies.length} shipped case studies · research phase, nothing built`;

// domain spread strip, widest first
const spreadHost = $('#domain-spread');
const maxDomain = Math.max(...data.domains.map(d => d.count));
for (const d of [...data.domains].sort((a, b) => b.count - a.count)) {
  const row = el('div', 'ds-row');
  row.append(el('div', 'ds-name', d.name));
  const barWrap = el('div', 'ds-bar-wrap');
  const bar = el('div', 'ds-bar');
  bar.style.width = `${(d.count / maxDomain) * 100}%`;
  barWrap.append(bar);
  row.append(barWrap, el('div', 'ds-n', String(d.count)));
  row.title = d.blurb ?? '';
  row.addEventListener('click', () => {
    state.tiers.clear(); state.tags.clear(); state.search = '';
    $('#search').value = '';
    state.domains.clear(); state.domains.add(d.id);
    showView('catalogue'); renderAll(); window.scrollTo(0, 0);
  });
  spreadHost.append(row);
}

/* ---------------- definitions page ---------------- */

const byName = new Map(data.entries.map(e => [e.name, e]));

/* ---------------- routing ---------------- */
// path <-> view id. Kept in sync with ROUTES in server.js.
const ROUTES = {
  '/': 'overview',
  '/basic-blocks': 'blocks',
  '/algorithms': 'algorithms',
  '/implementations': 'implementations',
  '/catalogue': 'catalogue',
  '/definitions': 'definitions',
  '/case-studies': 'cases',
  '/pitfalls': 'pitfalls',
  '/tools': 'refs',
  '/sql': 'sql',
};
const PATHS = Object.fromEntries(Object.entries(ROUTES).map(([p, v]) => [v, p]));

let currentView = 'overview';

function showView(name, { push = true } = {}) {
  currentView = name;
  document.querySelectorAll('#tabs button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.id === `view-${name}`));
  if (push) writeUrl();
}

/** The catalogue's filters live in the query string, so a filtered view is a shareable URL. */
function writeUrl(replace = false) {
  const path = PATHS[currentView] ?? '/';
  const q = new URLSearchParams();
  if (currentView === 'catalogue') {
    if (state.search) q.set('q', state.search);
    for (const t of state.tiers) q.append('tier', t);
    for (const d of state.domains) q.append('domain', d);
    for (const t of state.tags) q.append('tag', t);
  }
  const url = q.size ? `${path}?${q}` : path;
  if (url === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

function readUrl() {
  const view = ROUTES[location.pathname] ?? 'overview';
  const q = new URLSearchParams(location.search);
  state.search = q.get('q') ?? '';
  $('#search').value = state.search;
  state.tiers = new Set(q.getAll('tier'));
  state.domains = new Set(q.getAll('domain'));
  state.tags = new Set(q.getAll('tag'));
  showView(view, { push: false });
  renderAll();
}

window.addEventListener('popstate', readUrl);

/** A clickable entry reference: jumps to the catalogue with that entry isolated. */
function entryRef(entry, label) {
  const b = el('button', 'entry-ref', label ?? entry.name);
  b.title = entry.description ?? '';
  b.addEventListener('click', () => {
    state.tiers.clear(); state.domains.clear(); state.tags.clear();
    state.search = entry.name.toLowerCase();
    $('#search').value = entry.name;
    showView('catalogue');
    renderAll();
    window.scrollTo(0, 0);
  });
  return b;
}

function tierBadge(tier) {
  const s = el('span', `tier-badge t-${tier}`, tier);
  s.title = data.tierMeta?.definitions?.[tier] ?? '';
  return s;
}

// headline counts under each of the three questions
for (const p of document.querySelectorAll('[data-stat]')) {
  const tier = p.dataset.stat;
  const n = tierCounts[tier] ?? 0;
  p.textContent = `${n} of ${data.entries.length} entries — ${Math.round(100 * n / data.entries.length)}%.`;
}

// worked pipeline
const PIPELINE = [
  ['Perlin noise', 'a scalar field from a seed'],
  ['fBm (fractal Brownian motion)', 'field → field, sum octaves'],
  ['Domain warping', 'field → field, feed noise its own coordinates'],
  ['Hydraulic erosion simulation', 'heightfield → heightfield'],
  ['Thermal erosion & talus slopes', 'heightfield → heightfield'],
  ['River networks, watersheds & deltas', 'heightfield → flow graph'],
  ['Temperature & precipitation fields', 'heightfield + latitude → fields'],
  ['Whittaker-style biome assignment', 'fields → categorical field'],
  ['Marching cubes / dual contouring / surface nets', '3D field → mesh'],
  ['Vegetation scattering by biome & slope', 'masks → point set'],
];

const pipeHost = $('#pipeline');
for (const [name, signature] of PIPELINE) {
  const entry = byName.get(name);
  const step = el('div', 'step');
  if (!entry) { step.append(el('span', 'missing', `${name} (not in catalogue)`)); pipeHost.append(step); continue; }
  step.append(tierBadge(entry.tier));
  step.append(entryRef(entry));
  step.append(el('span', 'sig', signature));
  step.append(el('span', 'dom', entry.domain_name));
  pipeHost.append(step);
}
const result = el('div', 'step result');
result.append(tierBadge('generator'), el('span', 'result-label', '"3D terrain"'),
  el('span', 'sig', 'the wiring, the order, the parameters'));
pipeHost.append(result);

/** Small table of entries, showing domain and tier. */
function exampleTable(host, names, note) {
  const wrap = el('div', 'table-wrap');
  const table = el('table');
  const thead = el('thead'); const hr = el('tr');
  for (const c of ['Entry', 'Domain', 'Layer']) hr.append(el('th', null, c));
  thead.append(hr); table.append(thead);
  const tbody = el('tbody');
  for (const name of names) {
    const entry = byName.get(name);
    if (!entry) continue;
    const tr = el('tr');
    const td = el('td'); td.append(entryRef(entry)); tr.append(td);
    tr.append(el('td', null, entry.domain_name));
    const tt = el('td'); tt.append(tierBadge(entry.tier)); tr.append(tt);
    tbody.append(tr);
  }
  table.append(tbody); wrap.append(table); host.append(wrap);
  if (note) host.append(el('p', 'aside', note));
}

exampleTable($('#same-maths'), [
  'Voronoi diagrams',
  'Voronoi fracture & shattering',
  'Cobblestone & flagstone paving',
]);

// every entry tagged `ero`, to show the scattering
exampleTable(
  $('#reuse-table'),
  data.entries.filter(e => e.tags.includes('ero')).map(e => e.name),
  `The ${data.entries.filter(e => e.tags.includes('ero')).length} entries tagged \`ero\`, spread across `
  + `${new Set(data.entries.filter(e => e.tags.includes('ero')).map(e => e.domain_name)).size} domains. `
  + `Only the operators are erosion itself; the rest are landforms produced by it.`);

for (const note of data.tierMeta?.contested ?? []) {
  $('#contested-full').append(el('li', null, note));
}

// layer summary strip on the overview page
const layerHost = $('#layer-summary');
for (const [tier, question] of [
  ['source', 'Nothing goes in. Seed and parameters only.'],
  ['operator', 'Something goes in, and you can say what comes out without knowing what it is for.'],
  ['generator', 'You can only explain it by naming the result.'],
]) {
  const card = el('div', `layer-card t-${tier}`);
  const head = el('div', 'layer-head');
  head.append(tierBadge(tier), el('span', 'layer-n', `${tierCounts[tier] ?? 0}`));
  card.append(head, el('p', null, question));
  card.addEventListener('click', () => {
    state.domains.clear(); state.tags.clear(); state.search = '';
    $('#search').value = '';
    state.tiers.clear(); state.tiers.add(tier);
    showView('catalogue'); renderAll(); window.scrollTo(0, 0);
  });
  layerHost.append(card);
}

for (const b of document.querySelectorAll('[data-goto]')) {
  b.addEventListener('click', () => { showView(b.dataset.goto); window.scrollTo(0, 0); });
}

const PENDING = [
  ['output_type', 'image · vector · mesh · audio · text · data · schedule · plan · field', 'What actually comes out.'],
  ['input_class', 'seed · seed+library · external-data', 'Whether it can run from a seed alone. `external-data` entries cannot live in a seed-driven engine at all — a roster needs a staff list, an implant needs a scan. This is the split that `tier` does not capture.'],
  ['compute_cost', 'trivial · moderate · heavy · offline-only', 'Rough order of magnitude.'],
  ['deterministic', 'yes · no · conditional', 'Same seed, same result — across platforms and versions.'],
  ['realtime', 'yes · no · with-caveats', 'Whether it can run inside a frame budget.'],
  ['difficulty', 'wrap-a-library · weekend · month · research · unsolved', 'Honest effort estimate. Judgement, not fact.'],
  ['confidence', 'attested · plausible · unverified', 'How much the entry can be trusted. The catalogue was partly written from recall, so some entries name things nobody actually does.'],
  ['tag.facet', 'mechanism · representation · deployment', 'The current 28 tags mix all three axes. `shader` is not an algorithm family — it is a place of execution.'],
  ['entry_uses', 'entry → entry', 'Which sources and operators each generator is built from. This is what turns the worked example above into data rather than prose.'],
];

const pendHost = $('#pending-fields');
for (const [field, values, why] of PENDING) {
  const row = el('div', 'field-def');
  row.append(el('code', 'fname', field));
  row.append(el('div', 'fvalues', values));
  row.append(el('div', 'fwhy', why));
  pendHost.append(row);
}

/* ---------------- reference views ---------------- */

/* ---------------- basic blocks page ---------------- */

const spread = Object.fromEntries((data.tagSpread ?? []).map(s => [s.id, s.domains]));
const facetMeta = data.facetMeta ?? {};
const facetCounts = {};
for (const t of data.tags) facetCounts[t.facet] = (facetCounts[t.facet] ?? 0) + 1;

$('#blocks-stats').textContent =
  `${facetCounts.block ?? 0} blocks · ${facetCounts.representation ?? 0} representations · `
  + `${facetCounts.category ?? 0} categories · ${facetCounts.deployment ?? 0} deployment`;

const testHost = $('#block-tests');
for (const [name, desc] of Object.entries(facetMeta.tests ?? {})) {
  const t = el('div', 'test-card');
  t.append(el('h4', null, name), el('p', null, desc));
  testHost.append(t);
}
$('#block-note').textContent = facetMeta.note ?? '';

const FACET_ORDER = ['block', 'representation', 'category', 'deployment'];
const FACET_TITLE = {
  block: 'Blocks',
  representation: 'Representations',
  category: 'Categories — not blocks',
  deployment: 'Deployment — not concepts',
};

function conceptCard(t) {
  const dl = el('dl');
  for (const [label, key] of [['What', 'what'], ['Good at', 'good'], ['Weak at', 'bad'], ['Watch', 'watch']]) {
    if (!t[key]) continue;
    dl.append(el('dt', null, label), el('dd', key === 'watch' ? 'watch' : null, t[key]));
  }
  const body = el('div');
  body.append(dl);

  const contains = facetMeta.contains?.[t.id];
  if (Array.isArray(contains) && contains.length) {
    const box = el('div', 'contains');
    box.append(el('div', 'contains-head', `Blocks inside it that were never named (${contains.length})`));
    const list = el('div', 'contains-list');
    for (const c of contains) list.append(el('span', 'contains-item', c));
    box.append(list);
    body.append(box);
  }

  const algos = algosByConcept[t.id] ?? [];
  const impls = implsByConcept[t.id] ?? [];

  return entityCard({
    cls: `block-card f-${t.facet}`,
    title: t.name,
    id: t.id,
    badges: [{ cls: `facet-chip f-${t.facet}`, text: t.facet }],
    metrics: [`${t.count} entries`, `${spread[t.id] ?? 0}/${data.domains.length} domains`],
    relations: [
      { label: 'Catalogue', items: [{ text: `${t.count} entries`, onClick: goToCatalogueTag(t.id) }] },
      { label: 'Algorithms', items: algos.length
          ? [{ text: `${algos.length}`, title: algos.map(a => a.name).join(', '), onClick: goToPage('algorithms') }]
          : [{ text: 'none', cls: 'orphan' }] },
      { label: 'Implementations', items: impls.length
          ? [{ text: `${impls.length}`, title: impls.map(i => i.package).join(', '), onClick: goToPage('implementations') }]
          : [{ text: 'none', cls: 'orphan' }] },
    ],
    body,
  });
}

filterablePage({
  toolbar: '#toolbar-blocks',
  host: '#facet-groups',
  items: data.tags,
  noun: 'concepts',
  searchIn: t => [t.id, t.name, t.what, t.good, t.bad, t.watch].filter(Boolean).join(' '),
  filters: [{
    key: 'facet', label: 'Kind',
    options: FACET_ORDER.map(f => ({ id: f, label: FACET_TITLE[f].split(' — ')[0] })),
    match: (t, id) => t.facet === id,
  }],
  groupBy: t => t.facet,
  groupHeader: (facet, rows) => {
    const box = el('span', 'grp-title');
    box.append(el('span', 'grp-name', FACET_TITLE[facet]));
    box.append(el('span', 'grp-note', facetMeta.kinds?.[facet] ?? ''));
    return box;
  },
  groupOrder: (a, b) => FACET_ORDER.indexOf(a) - FACET_ORDER.indexOf(b),
  renderItem: conceptCard,
});

for (const note of facetMeta.contested ?? []) {
  $('#facet-contested').append(el('li', null, note));
}

/* ---------------- algorithms page ---------------- */

const algoMeta = data.algoMeta ?? {};
const algorithms = data.algorithms ?? [];



$('#algo-stats').textContent =
  `${algorithms.length} with checked citations · `
  + `${Object.values(algoMeta.candidates ?? {}).reduce((n, a) => n + a.length, 0)} candidates awaiting one`;
$('#algo-rule').textContent = algoMeta.rule ?? '';

function algoCard(a) {
  const body = el('div');
  if (a.summary) body.append(el('p', 'algo-summary', a.summary));
  if (a.description) body.append(el('p', 'algo-description', a.description));
  if (a.citation) {
    const cite = el('div', 'algo-cite');
    cite.append(el('span', null, a.citation));
    if (a.url) {
      const link = el('a', 'tl-src', 'source');
      link.href = a.url; link.target = '_blank'; link.rel = 'noreferrer';
      link.addEventListener('click', ev => ev.stopPropagation());
      cite.append(link);
    }
    body.append(cite);
  }

  const impls = implByAlgorithm[a.id] ?? [];
  const tag = tagById[a.concept_tag];

  return entityCard({
    cls: tag?.facet ? `block-card f-${tag.facet}` : 'block-card',
    title: a.name,
    id: a.concept_tag,
    badges: [
      a.tier ? { cls: `tier-badge t-${a.tier}`, text: a.tier } : null,
      a.source_type && a.source_type !== 'paper'
        ? { cls: `src-badge s-${a.source_type}`,
            text: a.source_type.replace('reference-implementation', 'ref impl'),
            title: 'Not academically published — admitted deliberately, and labelled.' }
        : null,
    ],
    metrics: [String(a.year ?? '—'), a.authors ?? ''].filter(Boolean),
    relations: [
      { label: 'Concept', items: [{ text: tag?.name ?? a.concept_tag, onClick: goToCatalogueTag(a.concept_tag) }] },
      { label: 'Implementations', items: impls.length
          ? impls.map(i => ({ text: i.package, title: `${i.ecosystem} — ${i.description ?? ''}`,
                              onClick: goToPage('implementations') }))
          : [{ text: 'none recorded', cls: 'orphan' }] },
    ],
    body,
  });
}

const SOURCE_TYPES = ['paper', 'article', 'reference-implementation', 'folklore'];

filterablePage({
  toolbar: '#toolbar-algorithms',
  host: '#algo-list',
  items: algorithms,
  noun: 'algorithms',
  searchIn: a => [a.name, a.authors, a.summary, a.description, a.citation, a.concept_tag, a.year]
    .filter(Boolean).join(' '),
  filters: [
    {
      key: 'facet', label: 'Concept kind',
      options: ['block', 'representation', 'category'].map(f => ({ id: f, label: f })),
      match: (a, id) => tagById[a.concept_tag]?.facet === id,
    },
    {
      key: 'tier', label: 'Layer',
      options: ['source', 'operator', 'generator'].map(t => ({ id: t, label: t })),
      match: (a, id) => a.tier === id,
    },
    {
      key: 'src', label: 'Source',
      options: SOURCE_TYPES.map(t => ({ id: t, label: t.replace('reference-implementation', 'ref impl') })),
      match: (a, id) => a.source_type === id,
    },
    {
      key: 'impl', label: 'Implementations', exclusive: true,
      options: [{ id: 'yes', label: 'has one' }, { id: 'no', label: 'none' }],
      match: (a, id) => (id === 'yes') === ((implByAlgorithm[a.id] ?? []).length > 0),
    },
  ],
  groupBy: a => a.concept_tag ?? '—',
  groupHeader: (concept) => {
    const box = el('span', 'grp-title');
    box.append(el('span', 'grp-name', tagById[concept]?.name ?? concept));
    box.append(el('span', 'id', concept));
    if (tagById[concept]?.facet) {
      box.append(el('span', `facet-chip f-${tagById[concept].facet}`, tagById[concept].facet));
    }
    return box;
  },
  groupOrder: (a, b, groups) => groups.get(b).length - groups.get(a).length || a.localeCompare(b),
  renderItem: algoCard,
});

const candHost = $('#algo-candidates');
for (const [concept, names] of Object.entries(algoMeta.candidates ?? {})) {
  const group = el('div', 'cand-group');
  const label = tagById[concept]?.name ?? concept;
  group.append(el('div', 'cand-head', `${label}  (${names.length})`));
  const list = el('div', 'contains-list');
  for (const n of names) list.append(el('span', 'contains-item', n));
  group.append(list);
  candHost.append(group);
}

/* ---------------- implementations page ---------------- */

const implMeta = data.implMeta ?? {};
const implementations = data.implementations ?? [];
const technologies = data.technologies ?? [];
const techById = Object.fromEntries(technologies.map(t => [t.id, t]));
const techFilter = new Set();

$('#impl-stats').textContent =
  `${implementations.length} registry-checked across `
  + `${new Set(implementations.map(i => i.concept_tag)).size} concepts · `
  + `${technologies.length} technologies`;
$('#impl-method').textContent = implMeta.method ?? '';
$('#impl-caveat').textContent = implMeta.caveat ?? '';

function implRow(im) {
  const body = el('div');
  if (im.description) body.append(el('p', 'algo-summary', im.description));
  const facts = el('dl');
  for (const [label, val] of [
    ['Version', im.version], ['Last release', im.last_release],
    ['Licence', im.license], ['Registry', im.ecosystem], ['Role', im.role],
  ]) {
    if (!val) continue;
    facts.append(el('dt', null, label), el('dd', null, String(val)));
  }
  body.append(facts);
  if (im.repo) {
    const link = el('a', 'tl-src', 'repository');
    link.href = im.repo.replace(/^git:\/\//, 'https://');
    link.target = '_blank'; link.rel = 'noreferrer';
    link.addEventListener('click', ev => ev.stopPropagation());
    const wrap = el('div', 'algo-cite'); wrap.append(link); body.append(wrap);
  }

  const algos = (im.algorithms ?? []).map(id => algorithms.find(x => x.id === id)).filter(Boolean);
  const tag = tagById[im.concept_tag];

  return entityCard({
    cls: tag?.facet ? `block-card f-${tag.facet}` : 'block-card',
    title: im.package,
    id: im.ecosystem,
    badges: [{ cls: 'src-badge s-role', text: im.role ?? 'unknown' }],
    metrics: [`v${im.version ?? '?'}`, im.last_release ?? ''].filter(Boolean),
    relations: [
      { label: 'Concept', items: [{ text: tag?.name ?? im.concept_tag, onClick: goToCatalogueTag(im.concept_tag) }] },
      { label: 'Algorithms', items: algos.length
          ? algos.map(a => ({ text: a.name, onClick: goToPage('algorithms') }))
          : [{ text: 'no algorithm recorded', cls: 'orphan' }] },
      { label: 'Runs on', items: im.technologies.map(t => ({ text: techById[t]?.name ?? t, title: techById[t]?.note ?? '' })) },
    ],
    body,
  });
}

const usedTech = new Set(implementations.flatMap(i => i.technologies));
const usedRoles = [...new Set(implementations.map(i => i.role).filter(Boolean))];

filterablePage({
  toolbar: '#toolbar-implementations',
  host: '#impl-groups',
  items: implementations,
  noun: 'implementations',
  searchIn: i => [i.package, i.description, i.ecosystem, i.role, i.concept_tag,
    ...(i.algorithms ?? [])].filter(Boolean).join(' '),
  filters: [
    {
      key: 'tech', label: 'Technology',
      options: technologies.filter(t => usedTech.has(t.id)).map(t => ({ id: t.id, label: t.name })),
      match: (i, id) => i.technologies.includes(id),
    },
    {
      key: 'eco', label: 'Registry',
      options: [...new Set(implementations.map(i => i.ecosystem))].map(e => ({ id: e, label: e })),
      match: (i, id) => i.ecosystem === id,
    },
    {
      key: 'role', label: 'Role',
      options: usedRoles.map(r => ({ id: r, label: r })),
      match: (i, id) => i.role === id,
    },
    {
      key: 'algo', label: 'Algorithm link', exclusive: true,
      options: [{ id: 'yes', label: 'linked' }, { id: 'no', label: 'orphan' }],
      match: (i, id) => (id === 'yes') === ((i.algorithms ?? []).length > 0),
    },
  ],
  groupBy: i => i.concept_tag,
  groupHeader: (concept) => {
    const box = el('span', 'grp-title');
    box.append(el('span', 'grp-name', tagById[concept]?.name ?? concept));
    box.append(el('span', 'id', concept));
    if (tagById[concept]?.facet) {
      box.append(el('span', `facet-chip f-${tagById[concept].facet}`, tagById[concept].facet));
    }
    return box;
  },
  groupOrder: (a, b, groups) => groups.get(b).length - groups.get(a).length || a.localeCompare(b),
  renderItem: implRow,
});

const techListHost = $('#tech-list');
for (const t of technologies) {
  const row = el('div', 'tech-row');
  row.append(el('div', 'tech-name', t.name));
  row.append(el('div', 'tech-kind', t.kind ?? ''));
  row.append(el('div', 'tech-note', t.note ?? ''));
  const n = implementations.filter(i => i.technologies.includes(t.id)).length;
  row.append(el('div', 'tech-n', n ? `${n} impl` : '—'));
  techListHost.append(row);
}


filterablePage({
  toolbar: '#toolbar-cases',
  host: '#cases',
  items: data.caseStudies,
  noun: 'case studies',
  searchIn: c => [c.name, c.description, ...(c.tags ?? [])].join(' '),
  filters: [{
    key: 'tag', label: 'Concept',
    options: [...new Set(data.caseStudies.flatMap(c => c.tags ?? []))].sort()
      .map(t => ({ id: t, label: t })),
    match: (c, id) => (c.tags ?? []).includes(id),
  }],
  renderItem: c => entityCard({
    title: c.name,
    relations: [{
      label: 'Concepts',
      items: (c.tags ?? []).map(t => ({
        text: tagById[t]?.name ?? t, onClick: goToCatalogueTag(t),
      })),
    }],
    body: c.description ? el('p', 'algo-summary', c.description) : null,
  }),
});

filterablePage({
  toolbar: '#toolbar-pitfalls',
  host: '#pitfalls',
  items: data.pitfalls,
  noun: 'pitfalls',
  searchIn: p => `${p.name} ${p.description ?? ''}`,
  renderItem: p => entityCard({
    title: p.name,
    body: el('p', 'algo-summary', p.description ?? ''),
  }),
});

const refs = [
  ...data.tools.map(t => ({ ...t, kind: 'tool' })),
  ...data.reading.map(r => ({ ...r, kind: 'reading' })),
];

filterablePage({
  toolbar: '#toolbar-refs',
  host: '#refs-list',
  items: refs,
  noun: 'references',
  searchIn: r => `${r.name} ${r.description ?? ''} ${r.category ?? ''}`,
  filters: [
    {
      key: 'kind', label: 'Kind', exclusive: true,
      options: [{ id: 'tool', label: 'tools' }, { id: 'reading', label: 'reading' }],
      match: (r, id) => r.kind === id,
    },
    {
      key: 'cat', label: 'Category',
      options: [...new Set(refs.map(r => r.category).filter(Boolean))].sort()
        .map(c => ({ id: c, label: c })),
      match: (r, id) => r.category === id,
    },
  ],
  groupBy: r => r.kind,
  groupHeader: kind => el('span', 'grp-name', kind === 'tool' ? 'Tools' : 'Reading'),
  groupOrder: (a, b) => (a === 'tool' ? -1 : 1) - (b === 'tool' ? -1 : 1),
  renderItem: r => entityCard({
    title: r.name,
    badges: [{ cls: 'src-badge s-role', text: r.kind }],
    metrics: r.category ? [r.category] : [],
    body: r.description ? el('p', 'algo-summary', r.description) : null,
  }),
});

/* ---------------- SQL console ---------------- */

const EXAMPLES = [
  ['Entries per domain', `SELECT d.name AS domain, COUNT(*) AS entries
FROM entry e
JOIN grp g ON g.id = e.group_id
JOIN domain d ON d.id = g.domain_id
GROUP BY d.id
ORDER BY entries DESC`],

  ['Tag frequency', `SELECT t.id, t.name, COUNT(et.entry_id) AS entries
FROM tag t
LEFT JOIN entry_tag et ON et.tag_id = t.id
GROUP BY t.id
ORDER BY entries DESC`],

  ['cons/sim share by domain — where the vocabulary collapses', `SELECT d.name AS domain,
       COUNT(*) AS entries,
       SUM(CASE WHEN EXISTS (
         SELECT 1 FROM entry_tag et
         WHERE et.entry_id = e.id AND et.tag_id IN ('cons','sim')
       ) THEN 1 ELSE 0 END) AS cons_or_sim,
       ROUND(100.0 * SUM(CASE WHEN EXISTS (
         SELECT 1 FROM entry_tag et
         WHERE et.entry_id = e.id AND et.tag_id IN ('cons','sim')
       ) THEN 1 ELSE 0 END) / COUNT(*), 0) AS pct
FROM entry e
JOIN grp g ON g.id = e.group_id
JOIN domain d ON d.id = g.domain_id
GROUP BY d.id
ORDER BY pct DESC`],

  ['Entries with only one tag', `SELECT e.name, d.name AS domain, MIN(et.tag_id) AS tag
FROM entry e
JOIN grp g ON g.id = e.group_id
JOIN domain d ON d.id = g.domain_id
JOIN entry_tag et ON et.entry_id = e.id
GROUP BY e.id
HAVING COUNT(et.tag_id) = 1
ORDER BY tag, d.position`],

  ['Tag co-occurrence pairs', `SELECT a.tag_id AS tag_a, b.tag_id AS tag_b, COUNT(*) AS together
FROM entry_tag a
JOIN entry_tag b ON b.entry_id = a.entry_id AND b.tag_id > a.tag_id
GROUP BY a.tag_id, b.tag_id
HAVING together >= 8
ORDER BY together DESC`],

  ['Layer split by domain — where the reusable machinery lives', `SELECT d.name AS domain,
       SUM(e.tier = 'source')    AS sources,
       SUM(e.tier = 'operator')  AS operators,
       SUM(e.tier = 'generator') AS generators,
       ROUND(100.0 * SUM(e.tier IN ('source','operator')) / COUNT(*), 0) AS pct_machinery
FROM entry e
JOIN grp g ON g.id = e.group_id
JOIN domain d ON d.id = g.domain_id
GROUP BY d.id
ORDER BY pct_machinery DESC`],

  ['Operators shared across the most domains, by tag', `SELECT et.tag_id,
       COUNT(DISTINCT g.domain_id) AS domains,
       COUNT(*) AS operators
FROM entry e
JOIN grp g ON g.id = e.group_id
JOIN entry_tag et ON et.entry_id = e.id
WHERE e.tier = 'operator'
GROUP BY et.tag_id
ORDER BY domains DESC, operators DESC`],

  ['Classification progress', `SELECT
  COUNT(*) AS total,
  SUM(tier IS NOT NULL) AS tiered,
  SUM(output_type IS NOT NULL) AS typed,
  SUM(difficulty IS NOT NULL) AS graded,
  SUM(confidence IS NOT NULL) AS confidence_flagged
FROM entry`],
];

const sel = $('#sql-examples');
EXAMPLES.forEach(([label, sql], i) => {
  const o = el('option', null, label);
  o.value = String(i);
  sel.append(o);
});
sel.addEventListener('change', () => {
  if (sel.value === '') return;
  $('#sql-input').value = EXAMPLES[Number(sel.value)][1];
  sel.value = '';
  runSql();
});

$('#sql-input').value = EXAMPLES[0][1];

async function runSql() {
  const host = $('#sql-result');
  host.textContent = '';
  const res = await fetch('/api/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql: $('#sql-input').value }),
  }).then(r => r.json());

  if (res.error) {
    host.append(el('div', 'sql-error', res.error));
    return;
  }
  host.append(el('div', 'sql-meta',
    `${res.total} row${res.total === 1 ? '' : 's'}${res.truncated ? ' (showing first 1000)' : ''}`));

  if (!res.rows.length) return;

  const wrap = el('div', 'table-wrap');
  const table = el('table');
  const thead = el('thead');
  const hr = el('tr');
  for (const c of res.columns) hr.append(el('th', null, c));
  thead.append(hr);
  table.append(thead);

  const tbody = el('tbody');
  for (const row of res.rows) {
    const tr = el('tr');
    for (const c of res.columns) {
      const v = row[c];
      const td = el('td', v == null ? 'null' : typeof v === 'number' ? 'num' : null,
        v == null ? 'null' : String(v));
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  host.append(wrap);
}

$('#sql-run').addEventListener('click', runSql);
$('#sql-input').addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') runSql();
});

$('#schema-text').textContent = `entry(id, group_id, name, description, position,
      tier, output_type, input_class, compute_cost,
      deterministic, realtime, difficulty, confidence, notes)
grp(id, domain_id, name, position)
domain(id, name, blurb, position)
tag(id, name, facet, what, good, bad, watch, position)
entry_tag(entry_id, tag_id)
entry_uses(entry_id, uses_entry_id)
case_study(id, name, description, position)
case_study_tag(case_study_id, tag_id)
pitfall(id, name, description, position)
tool(id, name, description, category, position)
reading(id, name, description, category, position)

Empty until the classification passes run:
  entry.tier            source | operator | generator
  entry.output_type     image | vector | mesh | audio | text | data | schedule | plan | field
  entry.input_class     seed | seed+library | external-data
  entry.compute_cost    trivial | moderate | heavy | offline-only
  entry.deterministic   yes | no | conditional
  entry.realtime        yes | no | with-caveats
  entry.difficulty      wrap-a-library | weekend | month | research | unsolved
  entry.confidence      attested | plausible | unverified
  tag.facet             mechanism | representation | deployment
  entry_uses            which sources/operators a generator is built from`;

readUrl();
runSql();
