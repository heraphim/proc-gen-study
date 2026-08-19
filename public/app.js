const $ = sel => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** Where the app is mounted: `/` under server.js, `/<repo>/` when published to GitHub
    Pages. Always ends in a slash; every in-app URL and fetch is built from it. */
const BASE = new URL('.', document.baseURI).pathname;

const state = {
  data: null,
  search: '',
  domains: new Set(),
  tags: new Set(),
  tiers: new Set(),
  /* One Set per axis, keyed by axis id. Filled once the bootstrap is in, because the axes
     are data rather than a fixed list — adding one to axes.json must not need a change here. */
  axes: new Map(),
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

/* `subGroupBy` returns an *array* of keys, so an item can appear under more than one — which
   is the point on the implementations page, where scipy implements six algorithms and the
   question "what implements Delaunay?" should be answerable by looking in one place.
   An item with no keys lands in this bucket, which sorts last. */
const NO_SUBGROUP = '(no algorithm)';

function filterablePage({
  toolbar, host, items, searchIn, filters = [], groupBy, groupHeader,
  subGroupBy, subGroupHeader, subGroupOrder, subGroupIntro, extraSubGroups, extraGroups,
  flattenWhenFiltered, flattenNote, flatExtras,
  renderItem, noun, groupOrder, emptyText = 'Nothing matches those filters.',
}) {
  /* Cards start closed. These pages are lists of a few hundred things and the question they
     answer first is "which of these do I want", which the name and the plain-words paragraph
     answer between them — the rest is for after that choice is made. */
  const st = { q: '', active: new Map(filters.map(f => [f.key, new Set()])), collapsed: new Set(), cardsCollapsed: true };
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
  const actions = el('div', 'pt-actions');
  actions.append(toggleGroups, toggleAll);
  bar.append(actions);
  tb.append(bar);

  /* The same disclosure as the catalogue sidebar, for the same reason: these groups wrap
     to roughly 250px of permanently sticky chrome on a phone, which with the header leaves
     under half the viewport for the list they filter. Forced open above 860px, where they
     fit on a line or two and the toolbar reads as a single bar. */
  const filterRow = el('div', 'pt-filters');
  const filterCount = el('span', 'pt-n', '');
  if (filters.length) {
    const drawer = el('details', 'pt-drawer');
    const summary = el('summary');
    summary.append(el('span', null, 'Filters'), filterCount);
    drawer.append(summary, filterRow);
    tb.append(drawer);

    /* The two collapse buttons wrap onto a row of their own on a phone, and a row of a
       sticky toolbar is worth more than a control that gets pressed once a session — so
       they go inside the drawer there, and back on the bar when there is room for them. */
    const wide = window.matchMedia('(min-width: 861px)');
    const syncDrawer = () => {
      if (wide.matches) drawer.open = true;
      (wide.matches ? bar : drawer).append(actions);
    };
    wide.addEventListener('change', syncDrawer);
    syncDrawer();
  }

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

  /* Cards reach the page three ways: renderItem, the reference code a sub-group carries as
     its intro, and the flat view's extras. Only the first went through the collapse, which
     left the implementations page with 24 reference cards open while everything around them
     was shut. */
  const applyCardState = node => {
    if (st.cardsCollapsed && node?.querySelectorAll) {
      for (const c of node.querySelectorAll('.ent-card')) {
        if (c.querySelector('.card-body')) c.classList.add('collapsed');
      }
    }
    return node;
  };

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

    const onCount = [...st.active.values()].reduce((n, set) => n + set.size, 0);
    filterCount.textContent = onCount ? `${onCount} on` : 'none';

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

    const unfiltered = !st.q && [...st.active.values()].every(s => s.size === 0);

    /* Grouping is for browsing. Filtering is a question, and the answer is the items — so when
       a filter or a search is on, drop the hierarchy and show one card per match. On a page
       where one item can sit under several headings this is not cosmetic: narrowing the 120
       implementations to the 14 written in Rust used to render 45 cards, because a package
       repeats under every algorithm it implements, plus ten blocks of reference code belonging
       to algorithms rather than to any of the matches. The count said 14. */
    if (flattenWhenFiltered && !unfiltered) {
      if (flattenNote) listHost.append(el('p', 'flat-note', flattenNote(visible.length)));
      const extras = flatExtras?.(st);
      if (extras) listHost.append(applyCardState(extras));
      const flat = el('div', 'grp-body');
      for (const it of visible) {
        const node = renderItem(it);
        if (st.cardsCollapsed && node.querySelector?.('.card-body')) node.classList.add('collapsed');
        flat.append(node);
      }
      listHost.append(flat);
      syncToggleAll();
      return;
    }

    const groups = new Map();
    for (const it of visible) {
      const g = groupBy ? groupBy(it) : '';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(it);
    }

    /* Groups with no items of their own. Only in the unfiltered view: every filter here is a
       property of an item, so a group holding none cannot satisfy one, and showing it anyway
       would mean a filtered count that does not match what is on screen. */
    if (unfiltered) for (const g of extraGroups?.() ?? []) if (!groups.has(g)) groups.set(g, []);

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
      const place = it => {
        const node = renderItem(it);
        if (st.cardsCollapsed && node.querySelector?.('.card-body')) node.classList.add('collapsed');
        return node;
      };

      if (subGroupBy) {
        const subs = new Map();
        for (const it of rows) {
          const keys = subGroupBy(it);
          for (const sk of keys.length ? keys : [NO_SUBGROUP]) {
            if (!subs.has(sk)) subs.set(sk, []);
            subs.get(sk).push(it);
          }
        }
        // Sub-groups that exist even with no items in them. On the implementations page these
        // are algorithms with reference code and no package — which is information, not a gap:
        // the method is short enough that nobody bothered to wrap it.
        if (unfiltered) {
          for (const extra of extraSubGroups?.(key) ?? []) if (!subs.has(extra)) subs.set(extra, []);
        }

        const subKeys = [...subs.keys()];
        subKeys.sort((a, b) => {
          if (a === NO_SUBGROUP) return 1;                 // the orphan bucket goes last
          if (b === NO_SUBGROUP) return -1;
          return subGroupOrder ? subGroupOrder(a, b, subs) : a.localeCompare(b);
        });
        for (const sk of subKeys) {
          const sub = el('div', 'subgrp');
          const skey = `${key}//${sk}`;
          if (st.collapsed.has(skey)) sub.classList.add('collapsed');
          const shead = el('button', 'subgrp-head');
          shead.append(el('span', 'grp-chevron', '▾'));
          shead.append(subGroupHeader(sk, subs.get(sk)));
          shead.append(el('span', 'grp-n', String(subs.get(sk).length)));
          shead.addEventListener('click', () => {
            st.collapsed.has(skey) ? st.collapsed.delete(skey) : st.collapsed.add(skey);
            sub.classList.toggle('collapsed');
          });
          const sbody = el('div', 'subgrp-body');
          const intro = subGroupIntro?.(sk, subs.get(sk), key);
          if (intro) sbody.append(applyCardState(intro));
          for (const it of subs.get(sk)) sbody.append(place(it));
          sub.append(shead, sbody);
          body.append(sub);
        }
      } else {
        for (const it of rows) body.append(place(it));
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
  /** Clear the search and every filter, returning the page to its grouped browsing state. */
  function reset() {
    st.q = '';
    input.value = '';
    for (const set of st.active.values()) set.clear();
    render();
  }

  return { render, reset, state: st };
}

/* ---------------- shared card ----------------
   One card shape for every page. The header, the relation strip and the plain-words
   paragraph stay visible when collapsed — that is the scanning view: what it is, what kind,
   what it connects to, and what it does in a sentence. The rest of the prose is hidden
   until wanted. */

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

    /* Lifted out of the body so the collapse cannot take it with it. It stays first, and
       directly above the prose it is meant to be checked against, so the reason it was put
       there survives the move. */
    const snippet = b.querySelector('.eli5');
    if (snippet) {
      const box = el('div', 'card-snippet');
      box.append(snippet);
      card.append(box);
    }

    // A card whose body was nothing but that paragraph has nothing left to open.
    if (b.textContent.trim()) {
      card.append(b);
      head.addEventListener('click', () => card.classList.toggle('collapsed'));
    } else {
      head.classList.add('no-body');
    }
  } else {
    head.classList.add('no-body');
  }
  return card;
}

const data = await fetch(`${BASE}api/bootstrap.json`).then(r => r.json());
state.data = data;

/* The axis layer. Concepts say what an entry is made of; axes say how it behaves, and the
   difference is that nothing implements an axis. Everything below is driven off the data
   rather than a list written here, so a fourth axis needs no change in this file. */
const axisMeta = data.axes ?? { axes: [] };
const axisColumn = new Map(axisMeta.axes.map(a => [a.id, a.column]));
const axisById = Object.fromEntries(axisMeta.axes.map(a => [a.id, a]));
const axisValueName = (axisId, value) =>
  axisById[axisId]?.values.find(v => v.id === value)?.name ?? value;
const notableValues = new Map(axisMeta.axes.map(a =>
  [a.id, new Set(a.values.filter(v => v.notable).map(v => v.id))]));
for (const a of axisMeta.axes) state.axes.set(a.id, new Set());

const tagName = Object.fromEntries(data.tags.map(t => [t.id, t.name]));
const tagById = Object.fromEntries(data.tags.map(t => [t.id, t]));
const technologies = data.technologies ?? [];
const techById = Object.fromEntries(technologies.map(t => [t.id, t]));

/** Cross-layer indexes. Every card shows what it connects to, so relations are visible
    without opening anything. */
const implByAlgorithm = {};
for (const im of data.implementations ?? []) {
  for (const aid of im.algorithms ?? []) (implByAlgorithm[aid] ??= []).push(im);
}
const algoById = Object.fromEntries((data.algorithms ?? []).map(a => [a.id, a]));
const algosByConcept = {};
for (const a of data.algorithms ?? []) (algosByConcept[a.concept_tag] ??= []).push(a);
const implsByConcept = {};
for (const im of data.implementations ?? []) (implsByConcept[im.concept_tag] ??= []).push(im);

/* Provenance. Every card carries the URLs used to check it, kept next to the claim rather than
   on a page of its own, because a source filed elsewhere is a source nobody reads. */
const sourceById = Object.fromEntries((data.sources ?? []).map(s => [s.id, s]));
const sourcesFor = (layer, id) =>
  (data.sourcesFor?.[`${layer}:${id}`] ?? [])
    .map(l => ({ ...(sourceById[l.id] ?? {}), relation: l.relation, note: l.note }))
    .filter(s => s.url);

function externalLink(href, text, cls = 'tl-src') {
  const a = el('a', cls, text);
  a.href = href; a.target = '_blank'; a.rel = 'noreferrer';
  a.addEventListener('click', ev => ev.stopPropagation());
  return a;
}

function provenanceBlock(layer, id) {
  const sources = sourcesFor(layer, id);
  if (!sources.length) return null;

  const box = el('div', 'provenance');
  box.append(el('div', 'prov-head', sources.length === 1 ? 'Source' : `Sources (${sources.length})`));
  for (const s of sources) {
    const row = el('div', 'prov-source');
    const top = el('div', 'prov-title');
    top.append(el('span', `rel-chip r-${s.relation}`, s.relation));
    top.append(externalLink(s.url, s.title, 'prov-link'));
    if (s.year) top.append(el('span', 'prov-year', String(s.year)));
    row.append(top);
    if (s.description) row.append(el('div', 'prov-desc', s.description));
    if (s.note) row.append(el('div', 'prov-note', s.note));
    box.append(row);
  }
  return box;
}

/* Every jump into the catalogue starts from a clean slate — a leftover axis filter from an
   earlier visit would land the reader on "Nothing matches those filters". */
function resetFilters() {
  state.tiers.clear(); state.domains.clear(); state.tags.clear(); state.search = '';
  $('#search').value = '';
  for (const set of state.axes.values()) set.clear();
}

const goToCatalogueTag = tag => () => {
  resetFilters();
  state.tags.add(tag);
  showView('catalogue'); renderAll(); window.scrollTo(0, 0);
};
const goToPage = page => () => { showView(page); window.scrollTo(0, 0); };

/* An axis value is only worth naming if you can see what carries it, so every value on every
   axis card is a link into the catalogue filtered to exactly that value. */
const goToCatalogueAxis = (axisId, value) => () => {
  resetFilters();
  state.axes.get(axisId)?.add(value);
  showView('catalogue'); renderAll(); window.scrollTo(0, 0);
};


/* ---------------- headline ---------------- */

const tiered = data.entries.filter(e => e.tier).length;
const tierCounts = Object.fromEntries((data.tiers ?? []).map(t => [t.id, t.count]));

$('#headline').textContent =
  `${data.entries.length} entries · ${data.domains.length} domains · ${data.tags.length} tags`;

$('#classified-note').textContent = tiered === data.entries.length
  ? `Layer: all ${tiered} classified. Output type, cost, difficulty and confidence are still empty.`
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

/* Below the menu breakpoint the tab row is behind a button. The open state lives as a
   class on the header, so the stylesheet decides what "open" looks like and this only has
   to say whether it is — which means nothing here needs to know the breakpoint. */
const menuToggle = $('#menu-toggle');

function setMenu(open) {
  $('.topbar').classList.toggle('menu-open', open);
  menuToggle.setAttribute('aria-expanded', String(open));
}

menuToggle.addEventListener('click', () =>
  setMenu(menuToggle.getAttribute('aria-expanded') !== 'true'));

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || menuToggle.getAttribute('aria-expanded') !== 'true') return;
  setMenu(false);
  menuToggle.focus();
});

/* A tap outside it should dismiss it, the way a menu is expected to behave — but not a tap
   on the button itself, which would close and reopen in one gesture. */
document.addEventListener('click', e => {
  if (!e.target.closest('.topbar')) setMenu(false);
});

/* The sidebar and the per-page toolbars stick underneath the header, so they need its
   height — which is not a constant. Eleven tabs sit on one row on a desktop, and on a
   phone they become a single scrolling row of a different height again. Measure it and
   publish it as a custom property rather than baking a number into the stylesheet. */
{
  const topbar = $('.topbar');
  const publishHeight = () => document.documentElement.style.setProperty(
    '--topbar-h', `${Math.round(topbar.getBoundingClientRect().height)}px`);
  new ResizeObserver(publishHeight).observe(topbar);
  publishHeight();
}

/* ---------------- catalogue filtering ---------------- */

/* `skip` names one facet ('tier', 'domain' or an axis id) to leave out of the test. Facet
   counts need that: tier, domain and axis values are alternatives (OR within the facet), so
   an option's count must ignore the facet's own current selection or every sibling of a
   selected value would read as zero. */
function matchesOtherFacets(entry, skip) {
  if (skip !== 'tier' && state.tiers.size && !state.tiers.has(entry.tier)) return false;
  if (skip !== 'domain' && state.domains.size && !state.domains.has(entry.domain_id)) return false;
  for (const t of state.tags) if (!entry.tags.includes(t)) return false;
  for (const [axisId, chosen] of state.axes) {
    if (axisId === skip || !chosen.size) continue;
    const col = axisColumn.get(axisId);
    if (!chosen.has(entry[col])) return false;
  }
  if (state.search) {
    const hay = `${entry.name} ${entry.description ?? ''} ${entry.group_name} ${entry.domain_name}`.toLowerCase();
    if (!state.search.split(/\s+/).every(term => hay.includes(term))) return false;
  }
  return true;
}

function matches(entry) {
  return matchesOtherFacets(entry, null);
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
    /* Axis values are not tags and must not read as tags: a tag says what the entry is made
       of, an axis says how it behaves. Same row, separated, different shape.

       Only the values marked notable print. Every entry has a value on every axis, so
       printing them all put three chips on all 841 rows and tripled the row height to say
       "ordinary" over and over. What prints is a departure from the ordinary case. */
    const notable = axisMeta.axes.filter(ax => notableValues.get(ax.id)?.has(entry[ax.column]));
    if (notable.length) tags.append(el('span', 'chip-split'));
    for (const ax of notable) {
      const v = entry[ax.column];
      const on = state.axes.get(ax.id)?.has(v);
      const b = el('button', `axis-chip${on ? ' on' : ''}`, `${ax.id}: ${v}`);
      b.title = `${ax.question} — ${axisValueName(ax.id, v)}`;
      b.addEventListener('click', () => toggle(state.axes.get(ax.id), v, renderAll));
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
    ...[...state.axes].flatMap(([axisId, chosen]) =>
      [...chosen].map(v => ({ label: axisValueName(axisId, v), set: chosen, key: v }))),
  ];
  for (const c of chips) {
    const chip = el('button', 'chip', `${c.label} ✕`);
    chip.addEventListener('click', () => toggle(c.set, c.key, renderAll));
    host.append(chip);
  }
  $('[data-clear="domain"]').classList.toggle('on', state.domains.size > 0);
  $('[data-clear="tag"]').classList.toggle('on', state.tags.size > 0);
  $('[data-clear="tier"]').classList.toggle('on', state.tiers.size > 0);
  for (const [axisId, chosen] of state.axes)
    $(`[data-clear="axis:${axisId}"]`)?.classList.toggle('on', chosen.size > 0);
}

/** Counts shown in the sidebar reflect what would remain if you added that filter. Tags are
    cumulative (AND), so their counts come from the visible set; tier, domain and axis values
    are alternatives (OR), so their counts ignore the facet's own current selection. */
function renderFacetCounts(visible) {
  const domainCounts = {}, tagCounts = {}, tierCounts = {};
  for (const e of visible) {
    for (const t of e.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
  }
  for (const e of state.data.entries) {
    if (matchesOtherFacets(e, 'domain')) domainCounts[e.domain_id] = (domainCounts[e.domain_id] ?? 0) + 1;
    if (e.tier && matchesOtherFacets(e, 'tier')) tierCounts[e.tier] = (tierCounts[e.tier] ?? 0) + 1;
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
  for (const list of document.querySelectorAll('.axis-pills')) {
    const col = axisColumn.get(list.dataset.axis);
    const counts = {};
    for (const e of state.data.entries) {
      if (matchesOtherFacets(e, list.dataset.axis)) counts[e[col]] = (counts[e[col]] ?? 0) + 1;
    }
    for (const btn of list.querySelectorAll('button')) {
      const n = counts[btn.dataset.id] ?? 0;
      btn.querySelector('.n').textContent = n;
      btn.classList.toggle('zero', n === 0 && !state.axes.get(list.dataset.axis).has(btn.dataset.id));
    }
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
  for (const list of document.querySelectorAll('.axis-pills'))
    for (const btn of list.querySelectorAll('button'))
      btn.classList.toggle('on', state.axes.get(list.dataset.axis).has(btn.dataset.id));
  renderFilterSummary();
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

/* One block per axis, built from the data. Values are alternatives rather than
   requirements — picking two of them widens the result the way the layer pills do — so the
   hint says so, because the tag block directly above behaves the opposite way. */
const axisFacetHost = $('#axis-facets');
for (const ax of axisMeta.axes) {
  const box = el('div', 'facet');
  const h = el('h2', null, ax.name);
  const clear = el('button', 'clear', 'clear');
  clear.dataset.clear = `axis:${ax.id}`;
  h.append(clear);
  box.append(h);
  box.append(el('p', 'hint', `${ax.question} Multiple values = entries matching any of them.`));
  const list = el('ul', 'pills axis-pills');
  list.dataset.axis = ax.id;
  for (const v of ax.values) {
    const li = el('li');
    const b = el('button');
    b.dataset.id = v.id;
    b.append(el('span', 'label', v.name), el('span', 'n', String(v.count)));
    b.title = `${v.what} — ${v.buys}`;
    b.addEventListener('click', () => toggle(state.axes.get(ax.id), v.id, renderAll));
    li.append(b);
    list.append(li);
  }
  box.append(list);
  axisFacetHost.append(box);
}

/* The facets run to roughly 2400px — 37 tags, 23 domains, three layers, three axes. On a phone that
   buries the first result three screens under the search box, so they go inside a
   disclosure that starts closed. Above 860px the sidebar is a column of its own and the
   disclosure is forced open with its summary hidden, which is the layout as it was. */
const filterDrawer = el('details', 'filter-drawer');
const filterSummary = el('summary');
filterDrawer.append(filterSummary);
{
  const sidebar = $('.sidebar');
  const facets = [...sidebar.querySelectorAll('.facet')];
  sidebar.append(filterDrawer);
  filterDrawer.append(...facets);

  const wide = window.matchMedia('(min-width: 861px)');
  const syncDrawer = () => { if (wide.matches) filterDrawer.open = true; };
  wide.addEventListener('change', syncDrawer);
  syncDrawer();
}

/** How many facet filters are on, so the closed drawer still says what it is hiding.
    The axis facets live in the same drawer, so they count too. */
function renderFilterSummary() {
  let n = state.tiers.size + state.domains.size + state.tags.size;
  for (const chosen of state.axes.values()) n += chosen.size;
  filterSummary.replaceChildren(
    el('span', null, 'Filters'),
    el('span', 'pt-n', n ? `${n} on` : 'none'),
  );
}

$('#search').addEventListener('input', e => {
  state.search = e.target.value.trim().toLowerCase();
  renderEntries();
  writeUrl(true);
});

// Getters, not the sets themselves: readUrl() replaces every set with a fresh one, so a
// reference captured here would be an orphan by the time a clear button is clicked.
const CLEAR_TARGETS = { domain: () => state.domains, tag: () => state.tags, tier: () => state.tiers };
// Axis blocks are built from data, so their clear buttons register themselves rather than
// being listed above alongside the three the markup hard-codes.
for (const axisId of state.axes.keys()) CLEAR_TARGETS[`axis:${axisId}`] = () => state.axes.get(axisId);
for (const btn of document.querySelectorAll('.clear')) {
  btn.addEventListener('click', () => {
    CLEAR_TARGETS[btn.dataset.clear]?.()?.clear();
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
  + `${(data.caseStudies ?? []).length} shipped case studies · research phase, nothing built`;

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
    resetFilters();
    state.domains.add(d.id);
    showView('catalogue'); renderAll(); window.scrollTo(0, 0);
  });
  spreadHost.append(row);
}

/* ---------------- definitions page ---------------- */

const byName = new Map(data.entries.map(e => [e.name, e]));

/* ---------------- routing ---------------- */
// path <-> view id. Kept in sync with ROUTES in lib/catalogue.js.
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
  '/sources': 'sources',
  '/sql': 'sql',
};
const PATHS = Object.fromEntries(Object.entries(ROUTES).map(([p, v]) => [v, p]));

/** Route <-> address bar. Under a base path the published site serves `/repo/catalogue/`,
    so the trailing slash comes off before the route table is consulted. */
const routeToUrl = route => BASE + route.slice(1);
const urlToRoute = () => {
  const p = location.pathname.startsWith(BASE)
    ? `/${location.pathname.slice(BASE.length)}`
    : location.pathname;
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
};

let currentView = 'overview';

function showView(name, { push = true } = {}) {
  currentView = name;
  document.querySelectorAll('#tabs button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));

  /* Picking a view is the end of the menu's job, whether it was picked from the menu or
     from a link in the page. */
  setMenu(false);
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.id === `view-${name}`));
  if (push) writeUrl();
}

/** The catalogue's filters live in the query string, so a filtered view is a shareable URL. */
function writeUrl(replace = false) {
  const path = routeToUrl(PATHS[currentView] ?? '/');
  const q = new URLSearchParams();
  if (currentView === 'catalogue') {
    if (state.search) q.set('q', state.search);
    for (const t of state.tiers) q.append('tier', t);
    for (const d of state.domains) q.append('domain', d);
    for (const t of state.tags) q.append('tag', t);
    for (const [axisId, chosen] of state.axes) for (const v of chosen) q.append(axisId, v);
  }
  const url = q.size ? `${path}?${q}` : path;
  if (url === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
}

function readUrl() {
  const view = ROUTES[urlToRoute()] ?? 'overview';
  const q = new URLSearchParams(location.search);
  // Lowercased like every other writer of state.search — matches() only lowercases the haystack.
  state.search = (q.get('q') ?? '').toLowerCase();
  $('#search').value = state.search;
  state.tiers = new Set(q.getAll('tier'));
  state.domains = new Set(q.getAll('domain'));
  state.tags = new Set(q.getAll('tag'));
  for (const a of axisMeta.axes) state.axes.set(a.id, new Set(q.getAll(a.id)));
  showView(view, { push: false });
  renderAll();
}

window.addEventListener('popstate', readUrl);

/** A clickable entry reference: jumps to the catalogue with that entry isolated. */
function entryRef(entry, label) {
  const b = el('button', 'entry-ref', label ?? entry.name);
  b.title = entry.description ?? '';
  b.addEventListener('click', () => {
    resetFilters();
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
    resetFilters();
    state.tiers.add(tier);
    showView('catalogue'); renderAll(); window.scrollTo(0, 0);
  });
  layerHost.append(card);
}

for (const b of document.querySelectorAll('[data-goto]')) {
  b.addEventListener('click', () => { showView(b.dataset.goto); window.scrollTo(0, 0); });
}

/* What is still empty. `input_class`, `addressing` and `runs_at` used to be here and are now
   filled and explained on the basic blocks page, so they are listed there instead — with the
   rest of the empty columns beside them, where the comparison is useful. This list is what is
   left over: the two that are not axis-shaped at all. */
const PENDING = [
  ['tag.facet', 'block · representation · category · deployment', 'Filled, and the deployment two turned out not to be concepts. Kept here because the facet vocabulary itself is still a judgement rather than a measurement, apart from the implemented test.'],
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
const conceptMeta = data.conceptMeta ?? {};
const facetCounts = {};
for (const t of data.tags) facetCounts[t.facet] = (facetCounts[t.facet] ?? 0) + 1;

const addedCount = data.tags.filter(t => t.origin === 'added').length;
$('#blocks-stats').textContent =
  `${facetCounts.block ?? 0} blocks · ${facetCounts.representation ?? 0} representations · `
  + `${facetCounts.category ?? 0} categories · ${facetCounts.deployment ?? 0} deployment`
  + (addedCount ? ` · ${data.tags.length - addedCount} inherited, ${addedCount} added here` : '');

const testHost = $('#block-tests');
for (const [name, desc] of Object.entries(facetMeta.tests ?? {})) {
  const t = el('div', 'test-card');
  t.append(el('h4', null, name), el('p', null, desc));
  testHost.append(t);
}

const FACET_ORDER = ['block', 'representation', 'category', 'deployment'];
const FACET_TITLE = {
  block: 'Blocks',
  representation: 'Representations',
  category: 'Categories — not blocks',
  deployment: 'Deployment — not concepts',
};

/* Concepts sort the same way wherever they are grouped: substrate first, then how much of the
   catalogue leans on the concept. Sorting by the size of the group instead ranks how much
   research a concept has had rather than how much it carries — it put `rand`, which every
   entry here ultimately depends on, eighth on the algorithms page, below four categories that
   are not blocks at all. */
const facetRank = id => {
  const i = FACET_ORDER.indexOf(tagById[id]?.facet);
  return i === -1 ? FACET_ORDER.length : i;
};
const conceptOrder = (a, b) =>
  facetRank(a) - facetRank(b)
  || (tagById[b]?.count ?? 0) - (tagById[a]?.count ?? 0)
  || a.localeCompare(b);

/* The plain-language explanation. Deliberately the first thing in the body: if this and the
   technical prose disagree, one of them is wrong, and putting them adjacent makes that visible.
   The heading used to read "Explain like I'm five", which was inviting the register that had to
   be rewritten out of all 220 of these — so it says what it means instead. */
function eli5Block(text) {
  if (!text) return null;
  const box = el('div', 'eli5');
  box.append(el('div', 'eli5-head', 'In plain words'));
  box.append(el('p', 'eli5-text', text));
  return box;
}

function conceptCard(t) {
  const dl = el('dl');
  for (const [label, key] of [['What', 'what'], ['Good at', 'good'], ['Weak at', 'bad'], ['Watch', 'watch']]) {
    if (!t[key]) continue;
    dl.append(el('dt', null, label), el('dd', key === 'watch' ? 'watch' : null, t[key]));
  }
  const body = el('div');
  const eli5 = eli5Block(t.eli5);
  if (eli5) body.append(eli5);
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

  /* An added concept has to argue for itself on its own card: what the absence of the word
     was costing, and what you would actually import if you accepted it. */
  const added = conceptMeta.additions?.[t.id];
  if (added) {
    const box = el('div', 'addition');
    box.append(el('div', 'prov-head', 'Why this was added'));
    box.append(el('p', 'add-why', added.why));
    const dl = el('dl');
    dl.append(el('dt', null, 'Importable'), el('dd', null, added.importable));
    if (added.absence) dl.append(el('dt', null, 'What its absence did'), el('dd', 'watch', added.absence));
    box.append(dl);
    body.append(box);
  }

  const prov = provenanceBlock('concept', t.id);
  if (prov) body.append(prov);

  const algos = algosByConcept[t.id] ?? [];
  const impls = implsByConcept[t.id] ?? [];

  return entityCard({
    cls: `block-card f-${t.facet}`,
    title: t.name,
    id: t.id,
    badges: [
      { cls: `facet-chip f-${t.facet}`, text: t.facet },
      t.origin === 'added'
        ? { cls: 'src-badge s-added', text: 'added',
            title: 'Named by this project. The original 28-label vocabulary had no word for it.' }
        : null,
    ],
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
  searchIn: t => [t.id, t.name, t.what, t.good, t.bad, t.watch, t.eli5].filter(Boolean).join(' '),
  filters: [
    {
      key: 'facet', label: 'Kind',
      options: FACET_ORDER.map(f => ({ id: f, label: FACET_TITLE[f].split(' — ')[0] })),
      match: (t, id) => t.facet === id,
    },
    {
      key: 'origin', label: 'Origin', exclusive: true,
      options: [{ id: 'source', label: 'from the reference' }, { id: 'added', label: 'added here' }],
      match: (t, id) => (t.origin ?? 'source') === id,
    },
  ],
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

/* ---------------- axes ----------------
   Rendered below the concepts on the same page and in the same card shape, because the point
   that has to land is the contrast: these sit next to the concepts and are not concepts. Not
   a filterable page of its own — there are three of them, and a search box over three rows
   would be furniture. */

$('#axis-about').textContent = axisMeta.about ?? '';
$('#axis-why').textContent = axisMeta.test ?? '';

const axisHost = $('#axis-list');
for (const ax of axisMeta.axes) {
  const body = el('div');
  const eli5 = eli5Block(ax.eli5);
  if (eli5) body.append(eli5);

  const dl = el('dl');
  dl.append(el('dt', null, 'The question'), el('dd', null, ax.question));
  body.append(dl);

  /* Each value gets what it is, what it buys and what it costs. The cost line is the one
     worth having: an axis whose values all sound good is not sorting anything. */
  const vals = el('div', 'axis-values');
  for (const v of ax.values) {
    const row = el('div', 'axis-value');
    const head = el('div', 'axis-value-head');
    const pick = el('button', 'axis-value-name', v.name);
    pick.title = `Show the ${v.count} entries with ${ax.id} = ${v.id}`;
    pick.addEventListener('click', goToCatalogueAxis(ax.id, v.id));
    head.append(pick);
    head.append(el('code', 'id', v.id));
    head.append(el('span', 'axis-value-n', v.count === 0 ? 'none' : `${v.count} entries`));
    row.append(head);
    const vdl = el('dl');
    vdl.append(el('dt', null, 'What'), el('dd', null, v.what));
    vdl.append(el('dt', null, 'Buys'), el('dd', null, v.buys));
    vdl.append(el('dt', null, 'Costs'), el('dd', 'watch', v.costs));
    row.append(vdl);
    vals.append(row);
  }
  body.append(vals);

  /* An axis argues for itself the way an added concept does, and for the same reason: it was
     not in the original vocabulary, so the case for it has to be readable next to it. */
  const box = el('div', 'addition');
  box.append(el('div', 'prov-head', 'Why this is an axis and not a concept'));
  box.append(el('p', 'add-why', ax.why));
  const rdl = el('dl');
  rdl.append(el('dt', null, 'How it is classified'), el('dd', null,
    `${ax.rule.about ?? ''} Default ${ax.rule.default}; where an entry's concepts disagree, `
    + `${ax.rule.precedence.join(' beats ')}.`));
  rdl.append(el('dt', null, 'Hand-corrected'), el('dd', ax.overrides ? null : 'orphan',
    ax.overrides
      ? `${ax.overrides} ${ax.overrides === 1 ? 'entry' : 'entries'} where the rule was wrong.`
      : 'Nothing. Either the rule is exactly right or nobody has checked it yet.'));
  box.append(rdl);
  body.append(box);

  const total = ax.values.reduce((n, v) => n + v.count, 0);
  axisHost.append(entityCard({
    cls: 'block-card f-axis',
    title: ax.name,
    id: ax.column,
    badges: [{ cls: 'facet-chip f-axis', text: 'axis' }],
    metrics: [`${ax.values.length} values`, `${total} entries`],
    relations: [{
      label: 'Catalogue',
      items: ax.values.map(v => ({
        text: `${v.name} ${v.count}`, title: v.what, onClick: goToCatalogueAxis(ax.id, v.id),
      })),
    }],
    body,
  }));
}

/* Columns that exist and hold nothing. Kept beside the filled axes rather than on the
   definitions page, so one place knows what the axis layer covers and what it does not. */
const axisEmptyHost = $('#axis-empty');
for (const [field, why] of Object.entries(axisMeta.stillEmpty ?? {})) {
  if (field.startsWith('_')) continue;
  const row = el('div', 'field-def');
  row.append(el('code', 'fname', field));
  row.append(el('div', 'fwhy', why));
  axisEmptyHost.append(row);
}

const rejectedHost = $('#concept-rejected');
for (const r of conceptMeta.rejected ?? []) {
  const group = el('div', 'cand-group');
  group.append(el('div', 'cand-head', `${r.name}  (${r.id})`));
  const dl = el('dl');
  dl.append(el('dt', null, 'Considered because'), el('dd', null, r.why_considered));
  dl.append(el('dt', null, 'Rejected because'), el('dd', 'watch', r.why_rejected));
  group.append(dl);
  rejectedHost.append(group);
}

/* ---------------- algorithms page ---------------- */

const algoMeta = data.algoMeta ?? {};
const algorithms = data.algorithms ?? [];



$('#algo-stats').textContent =
  `${algorithms.length} with checked citations · `
  + `${algorithms.filter(a => (a.code ?? []).length).length} with working code, on the implementations page · `
  + `${Object.values(algoMeta.candidates ?? {}).reduce((n, a) => n + a.length, 0)} candidates awaiting a citation`;

function algoCard(a) {
  const body = el('div');
  if (a.summary) body.append(el('p', 'algo-summary', a.summary));
  const eli5 = eli5Block(a.eli5);
  if (eli5) body.append(eli5);
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

  const prov = provenanceBlock('algorithm', a.id);
  if (prov) body.append(prov);

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
      (a.code ?? []).length
        ? { cls: 'src-badge s-code', text: 'has code',
            title: 'Working code for this algorithm is on the implementations page, under this algorithm\'s heading.' }
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

/* A code sample is collapsed by default and opens on its own, independently of the card:
   the point of the card is the mechanism, and the point of the code is that the mechanism
   really is that small. Both should be reachable without scrolling past the other. */
function codeBlock(sample) {
  const box = el('details', 'code-sample');
  const sum = el('summary', 'code-head');
  sum.append(el('span', 'code-chevron', '▸'));
  sum.append(el('span', 'code-show', 'Show the code'));
  sum.append(el('span', 'code-lines', `${sample.lines} lines`));
  box.append(sum);
  const pre = el('pre', 'code-body');
  pre.append(el('code', null, sample.code));
  box.append(pre);
  // Belt and braces: the collapse listener sits on the card header, a sibling, so this
  // click should never reach it — kept in case the toggle ever moves back to the card.
  box.addEventListener('click', ev => ev.stopPropagation());
  return box;
}

/** The reference code as a card, shaped like the implementation cards it sits beside. */
function codeCard(algo, sample) {
  const body = el('div');
  if (sample.note) body.append(el('p', 'algo-summary', sample.note));

  const facts = el('dl');
  for (const [label, val] of [
    ['Language', techById[sample.technology]?.name ?? sample.technology],
    ['Length', `${sample.lines} lines`],
    ['Implements', algo.name],
    ['Checked', 'executed on every deploy'],
  ]) facts.append(el('dt', null, label), el('dd', null, String(val)));
  body.append(facts);
  body.append(codeBlock(sample));

  const tag = tagById[algo.concept_tag];
  return entityCard({
    cls: tag?.facet ? `block-card f-${tag.facet} ref-card` : 'block-card ref-card',
    title: 'Reference implementation',
    id: sample.technology,
    badges: [{ cls: 'src-badge s-code', text: 'the whole method' }],
    metrics: [`${sample.lines} lines`, techById[sample.technology]?.name ?? sample.technology],
    relations: [
      { label: 'Concept', items: [{ text: tag?.name ?? algo.concept_tag, onClick: goToCatalogueTag(algo.concept_tag) }] },
      { label: 'Algorithms', items: [{ text: algo.name, onClick: goToPage('algorithms') }] },
      { label: 'Runs on', items: [{ text: techById[sample.technology]?.name ?? sample.technology,
                                    title: techById[sample.technology]?.note ?? '' }] },
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
  searchIn: a => [a.name, a.authors, a.summary, a.description, a.eli5, a.citation, a.concept_tag,
    a.year].filter(Boolean).join(' '),
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
  groupOrder: conceptOrder,
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
const techFilter = new Set();

const coveredAlgos = new Set(implementations.flatMap(i => i.algorithms ?? []));
$('#impl-stats').textContent =
  `${implementations.length} registry-checked across `
  + `${new Set(implementations.map(i => i.concept_tag)).size} concepts and `
  + `${new Set(implementations.map(i => i.ecosystem)).size} registries · `
  + `covering ${coveredAlgos.size} of ${algorithms.length} algorithms · `
  + `${algorithms.filter(a => (a.code ?? []).length).length} with reference code shown here · `
  + `${new Set(implementations.flatMap(i => i.technologies)).size} technologies`;

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

  const algos = (im.algorithms ?? []).map(id => algoById[id]).filter(Boolean);
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
    ...(i.algorithms ?? []),
    // The code shown under an algorithm heading is searchable from the packages under it.
    ...(i.algorithms ?? []).flatMap(a => (algoById[a]?.code ?? []).map(c => c.code)),
  ].filter(Boolean).join(' '),
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
    {
      key: 'code', label: 'Reference code', exclusive: true,
      options: [{ id: 'yes', label: 'shown here' }, { id: 'no', label: 'not yet' }],
      match: (i, id) => (id === 'yes')
        === (i.algorithms ?? []).some(a => (algoById[a]?.code ?? []).length > 0),
    },
  ],
  /* Two levels, but only while browsing. A package with several algorithms appears under each
     of them, which is what makes the inner heading answer "what implements Delaunay?" rather
     than "what is about Voronoi?" — and which would make any filtered count a lie, since one
     match can produce seven cards. Filtering therefore drops to a flat list of the matches. */
  flattenWhenFiltered: true,
  /* The code belongs to an algorithm, not to a package, so it hangs off the algorithm headings
     — which the flat list does not have. Asking for it therefore has to bring it along, or the
     filter named after it would return everything except it. Technology and search still narrow
     the samples; registry, role and algorithm link are properties of a package and say nothing
     about a block of code. */
  flatExtras: st => {
    if (!st.active.get('code')?.has('yes')) return null;
    const tech = st.active.get('tech');
    const terms = st.q ? st.q.split(/\s+/) : [];
    const samples = algorithms
      .filter(a => (a.code ?? []).length)
      .flatMap(a => a.code.map(s => ({ a, s })))
      .filter(({ s }) => !tech.size || tech.has(s.technology))
      .filter(({ a, s }) => {
        const hay = `${a.name} ${s.note ?? ''} ${s.code}`.toLowerCase();
        return terms.every(t => hay.includes(t));
      })
      .sort((x, y) => (tagById[x.a.concept_tag]?.name ?? '').localeCompare(tagById[y.a.concept_tag]?.name ?? '')
        || x.a.name.localeCompare(y.a.name));
    if (!samples.length) return null;
    const box = el('div', 'flat-code');
    box.append(el('h3', 'flat-code-head', `Reference code (${samples.length})`));
    const body = el('div', 'grp-body');
    for (const { a, s } of samples) body.append(codeCard(a, s));
    box.append(body);
    return box;
  },
  groupBy: i => i.concept_tag,
  groupHeader: (concept, rows) => {
    const box = el('span', 'grp-title');
    box.append(el('span', 'grp-name', tagById[concept]?.name ?? concept));
    box.append(el('span', 'id', concept));
    if (tagById[concept]?.facet) {
      box.append(el('span', `facet-chip f-${tagById[concept].facet}`, tagById[concept].facet));
    }
    const algos = new Set(rows.flatMap(r => r.algorithms ?? []));
    if (algos.size) box.append(el('span', 'grp-note', `${algos.size} algorithm${algos.size === 1 ? '' : 's'} covered`));
    return box;
  },
  groupOrder: (a, b, groups) => groups.get(b).length - groups.get(a).length || a.localeCompare(b),
  subGroupBy: i => (i.algorithms ?? []),
  subGroupHeader: (algoId, rows) => {
    const box = el('span', 'grp-title');
    if (algoId === NO_SUBGROUP) {
      box.append(el('span', 'subgrp-name orphan', 'No algorithm recorded'));
      box.append(el('span', 'grp-note',
        implMeta.orphans ?? 'Either the algorithm has no row yet, or this is not a generation library.'));
      return box;
    }
    const a = algoById[algoId];
    box.append(el('span', 'subgrp-name', a?.name ?? algoId));
    if (a?.year) box.append(el('span', 'subgrp-year', String(a.year)));
    if (a?.tier) box.append(el('span', `tier-badge t-${a.tier}`, a.tier));
    const techs = new Set(rows.flatMap(r => r.technologies ?? []));
    if (techs.size) {
      box.append(el('span', 'grp-note',
        [...techs].map(t => techById[t]?.name?.split(' /')[0] ?? t).join(' · ')));
    } else if ((a?.code ?? []).length) {
      // A heading with no packages under it means one of two different things. Say which.
      const elsewhere = implByAlgorithm[algoId] ?? [];
      box.append(elsewhere.length
        ? el('span', 'grp-note', `implemented by ${elsewhere.map(i => i.package).join(', ')}, `
            + `filed under ${[...new Set(elsewhere.map(i => i.concept_tag))].join(' and ')}`)
        : el('span', 'grp-note warn-text',
            'nothing on any registry wraps this — the code below is the whole method'));
    }
    return box;
  },
  // Most-implemented algorithm first inside each concept; then oldest first, since the
  // order things were invented in is usually the order they build on each other.
  // Undated last, not first — same rule as the bootstrap query in lib/catalogue.js.
  subGroupOrder: (a, b, subs) => subs.get(b).length - subs.get(a).length
    || (algoById[a]?.year ?? Infinity) - (algoById[b]?.year ?? Infinity)
    || a.localeCompare(b),
  /* Reference code sits above the packages that implement the same algorithm, because that is
     the comparison it exists for: this is the mechanism, and these are the libraries that wrap
     it. On the algorithms page it was next to the citation, where it read as an illustration. */
  /* Every algorithm with code gets a heading under its own concept, whether or not a package
     lands there. Two separate reasons it might not: nothing implements it at all (Conway's
     Life, Tracery), or the packages that do are filed under a different concept — scipy
     implements the Halton sequence but is filed under `vor`, so `samp` would never have shown
     it. Existing headings are left alone; this only fills gaps. */
  extraSubGroups: concept => algorithms
    .filter(a => a.concept_tag === concept && (a.code ?? []).length)
    .map(a => a.id),
  // ...and the concepts those algorithms belong to, which may have no packages at all — `ca`,
  // `fractal`, `gram`, `rd` and `tile` all have code and nothing on any registry.
  extraGroups: () => [...new Set(algorithms
    .filter(a => (a.code ?? []).length && !(implByAlgorithm[a.id] ?? []).length)
    .map(a => a.concept_tag))],
  /* Only under the algorithm's own concept. A package carries its own concept, so `lygia` —
     filed under `shader` — drags fBm, Worley, domain warping, SDF primitives and Oklab into a
     second group each. The packages belong in both places; 60 lines of code does not. */
  subGroupIntro: (algoId, rows, concept) => {
    const a = algoById[algoId];
    if (!a || a.concept_tag !== concept) return null;
    const samples = a.code ?? [];
    if (!samples.length) return null;
    const box = el('div', 'subgrp-code');
    for (const s of samples) box.append(codeCard(a, s));
    return box;
  },
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
  items: data.caseStudies ?? [],
  noun: 'case studies',
  searchIn: c => [c.name, c.description, ...(c.tags ?? [])].join(' '),
  filters: [{
    key: 'tag', label: 'Concept',
    options: [...new Set((data.caseStudies ?? []).flatMap(c => c.tags ?? []))].sort()
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
  items: data.pitfalls ?? [],
  noun: 'pitfalls',
  searchIn: p => `${p.name} ${p.description ?? ''}`,
  renderItem: p => entityCard({
    title: p.name,
    body: el('p', 'algo-summary', p.description ?? ''),
  }),
});

const refs = [
  ...(data.tools ?? []).map(t => ({ ...t, kind: 'tool' })),
  ...(data.reading ?? []).map(r => ({ ...r, kind: 'reading' })),
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

/* ---------------- sources ---------------- */

const sources = data.sources ?? [];
const sourceMeta = data.sourceMeta ?? {};

/** Reverse the sourcesFor index: source id -> the things it is attached to. */
const linksBySource = {};
for (const [key, entries] of Object.entries(data.sourcesFor ?? {})) {
  const [layer, ...rest] = key.split(':');
  const target = rest.join(':');
  for (const e of entries) (linksBySource[e.id] ??= []).push({ layer, target, relation: e.relation, note: e.note });
}

const LAYER_LABEL = {
  concept: id => tagById[id]?.name ?? id,
  algorithm: id => algoById[id]?.name ?? id,
  technology: id => techById[id]?.name ?? id,
  implementation: id => id,
};
const jumpTo = { concept: 'blocks', algorithm: 'algorithms', implementation: 'implementations', technology: 'implementations' };

$('#sources-stats').textContent =
  `${sources.length} sources · ${Object.values(linksBySource).flat().length} links · `
  + `${Object.values(linksBySource).flat().filter(l => l.relation === 'corrects').length} of them overturned something`;
$('#sources-rule').textContent = sourceMeta.rule ?? '';

const relHost = $('#sources-relations');
for (const [name, desc] of Object.entries(sourceMeta.relations ?? {})) {
  const t = el('div', 'test-card');
  t.append(el('h4', null, name), el('p', null, desc));
  relHost.append(t);
}

filterablePage({
  toolbar: '#toolbar-sources',
  host: '#sources-list',
  items: sources,
  noun: 'sources',
  searchIn: s => [s.id, s.title, s.description, s.publisher, s.kind, s.year,
    ...(linksBySource[s.id] ?? []).flatMap(l => [l.target, l.relation, l.note])].filter(Boolean).join(' '),
  filters: [
    {
      key: 'kind', label: 'Kind',
      options: [...new Set(sources.map(s => s.kind).filter(Boolean))].sort().map(k => ({ id: k, label: k })),
      match: (s, id) => s.kind === id,
    },
    {
      key: 'rel', label: 'Did what',
      options: Object.keys(sourceMeta.relations ?? {}).map(r => ({ id: r, label: r })),
      match: (s, id) => (linksBySource[s.id] ?? []).some(l => l.relation === id),
    },
    {
      key: 'layer', label: 'Bears on',
      options: ['concept', 'algorithm', 'implementation', 'technology'].map(l => ({ id: l, label: l })),
      match: (s, id) => (linksBySource[s.id] ?? []).some(l => l.layer === id),
    },
  ],
  groupBy: s => {
    const rels = (linksBySource[s.id] ?? []).map(l => l.relation);
    return rels.includes('corrects') || rels.includes('disputes') ? 'corrects' : 'supports';
  },
  groupHeader: (key, rows) => {
    const box = el('span', 'grp-title');
    box.append(el('span', 'grp-name', key === 'corrects'
      ? 'Overturned something this catalogue asserted'
      : 'Established or verified a claim'));
    box.append(el('span', 'grp-note', key === 'corrects'
      ? 'The expensive ones. Each of these changed a row.'
      : 'Checked and held.'));
    return box;
  },
  groupOrder: a => (a === 'corrects' ? -1 : 1),
  renderItem: s => {
    const body = el('div');
    body.append(el('p', 'algo-summary', s.description));
    const facts = el('dl');
    for (const [label, v] of [['Publisher', s.publisher], ['Year', s.year],
      ['Kind', s.kind], ['Retrieved', s.retrieved], ['Id', s.id]]) {
      if (!v) continue;
      facts.append(el('dt', null, label), el('dd', null, String(v)));
    }
    body.append(facts);
    const cite = el('div', 'algo-cite');
    cite.append(externalLink(s.url, s.url.replace(/^https?:\/\//, '').slice(0, 78)));
    body.append(cite);

    const links = linksBySource[s.id] ?? [];
    return entityCard({
      cls: 'block-card',
      title: s.title,
      badges: [s.kind ? { cls: 'src-badge s-role', text: s.kind } : null],
      metrics: [s.publisher, s.year ? String(s.year) : ''].filter(Boolean),
      relations: ['concept', 'algorithm', 'implementation', 'technology'].map(layer => {
        const of = links.filter(l => l.layer === layer);
        if (!of.length) return null;
        return {
          label: layer,
          items: of.map(l => ({
            text: `${l.relation} · ${LAYER_LABEL[layer](l.target)}`,
            cls: l.relation === 'corrects' || l.relation === 'disputes' ? 'orphan' : '',
            title: l.note ?? '',
            onClick: goToPage(jumpTo[layer]),
          })),
        };
      }).filter(Boolean),
      body,
    });
  },
});

/* ---------------- SQL console ----------------
   The console POSTs SQL back to the server, so the static build ships neither the tab
   nor the view. When they are absent this section stays inert and /sql stops routing. */

const sqlEnabled = Boolean($('#view-sql'));
if (!sqlEnabled) delete ROUTES['/sql'];

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

if (sqlEnabled) {
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
}

async function runSql() {
  const host = $('#sql-result');
  host.textContent = '';
  let res;
  try {
    res = await fetch(`${BASE}api/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sql: $('#sql-input').value }),
    }).then(r => r.json());
  } catch (err) {
    host.append(el('div', 'sql-error', `request failed: ${err.message}`));
    return;
  }

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

if (sqlEnabled) {
  $('#sql-run').addEventListener('click', runSql);
  $('#sql-input').addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') runSql();
  });

  // Kept in step with db/schema.sql by hand — when a column moves there, it moves here.
  $('#schema-text').textContent = `entry(id, group_id, name, description, position, tier,
      output_type, input_class, compute_cost, addressing, runs_at,
      realtime, difficulty, confidence, notes)
grp(id, domain_id, name, position)
domain(id, name, blurb, position)
tag(id, name, facet, what, good, bad, watch, eli5, origin, position)
entry_tag(entry_id, tag_id)
algorithm(id, name, concept_tag, year, authors, summary, description,
      eli5, tier, source_type, citation, url, position)
implementation(id, package, ecosystem, concept_tag, role, version,
      last_release, description, repo, license, stars, archived, verified)
implementation_algorithm(implementation_id, algorithm_id)
implementation_technology(implementation_id, technology_id)
technology(id, name, kind, note, position)
code_sample(id, algorithm_id, technology, lines, note, code, position)
source(id, url, title, kind, publisher, year, description, retrieved, position)
source_link(source_id, layer, target_id, relation, note)
correction(id, layer, target_id, field, was, now, why, source_url, position)
review(id, layer, target_id, round, reviewed, agreement, note)
review_model(review_id, model, provider, verdict, unsure, tokens)
further_reading(id, layer, target_id, url, title, kind, found_by,
      http_status, verified, rejected, reason)
case_study(id, name, description, position)
case_study_tag(case_study_id, tag_id)
pitfall(id, name, description, position)
tool(id, name, description, category, position)
reading(id, name, description, category, position)
entry_uses(entry_id, uses_entry_id)   -- planned, still empty

Filled classifications:
  entry.tier          source | operator | generator
  entry.input_class   seed | seed+library | external-data
  entry.addressing    positional | replayable | accumulating
  entry.runs_at       shader-time | ahead-of-time
  tag.facet           block | representation | category | deployment

Still NULL (see _still_empty in axes.json):
  entry.output_type   image | vector | mesh | audio | text | data | schedule | plan | field
  entry.compute_cost  trivial | moderate | heavy | offline-only
  entry.realtime      yes | no | with-caveats
  entry.difficulty    wrap-a-library | weekend | month | research | unsolved
  entry.confidence    attested | plausible | unverified`;
}

readUrl();
if (sqlEnabled) runSql();
