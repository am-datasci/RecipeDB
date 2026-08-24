import { DATA_BASE, esc, el, getJSON, initTheme, showError } from './common.js';

const mount   = document.getElementById('content');
const toolbar = document.getElementById('toolbar');
const panel   = document.getElementById('filter-panel');
const statsM  = document.getElementById('hero-stats');
const searchI = document.getElementById('search');

let DB = null;
let TAGS = new Map();    // tag -> count
let GROUPS = [];         // [{id,label,description,tags:[...]}]
let COLLECTIONS = [];    // [{label,icon,description,slugs,set}]

const active     = new Set();   // selected tags
const activeCols = new Set();   // selected collection labels
let matchAll = true;
let query = '';
let view = 'all';               // 'all' | 'grouped'
let filtersOpen = false;

const VIEW_KEY = 'recipedb-view';

/* ---------- model ------------------------------------------------------- */

function buildCollections() {
  const known = new Set(DB.recipes.map(r => r.slug));
  COLLECTIONS = (DB.collections || []).map(c => {
    const slugs = (c.slugs || []).filter(s => known.has(s));
    return { label: c.label, icon: c.icon || '★', description: c.description,
             slugs, set: new Set(slugs) };
  }).filter(c => c.slugs.length);
}

/* Groups are ordering hints only. A tag on a recipe but in no group is
   auto-collected, so adding a tag never requires touching config. */
function buildTagModel() {
  TAGS = new Map();
  for (const r of DB.recipes) {
    for (const t of (r.tags || [])) TAGS.set(t, (TAGS.get(t) || 0) + 1);
  }
  const declared = new Set();
  GROUPS = (DB.groups || []).map(g => {
    const tags = (g.tags || []).filter(t => TAGS.has(t));
    tags.forEach(t => declared.add(t));
    return { ...g, tags };
  }).filter(g => g.tags.length);

  const loose = [...TAGS.keys()].filter(t => !declared.has(t))
                                .sort((a, b) => a.localeCompare(b));
  if (loose.length) {
    GROUPS.push({ id: 'more', label: 'More Tags',
                  description: 'Tags not yet filed into a group in data/index.json.',
                  tags: loose });
  }
}

const colsOf = slug => COLLECTIONS.filter(c => c.set.has(slug));
const filterCount = () => active.size + activeCols.size;

function matches(r) {
  if (activeCols.size) {
    const hits = [...activeCols].filter(l => {
      const c = COLLECTIONS.find(x => x.label === l);
      return c && c.set.has(r.slug);
    });
    if (matchAll ? hits.length !== activeCols.size : hits.length === 0) return false;
  }
  if (active.size) {
    const tags = r.tags || [];
    const hits = [...active].filter(t => tags.includes(t));
    if (matchAll ? hits.length !== active.size : hits.length === 0) return false;
  }
  if (query) {
    const hay = (r.title + ' ' + (r.blurb || '') + ' ' + (r.tags || []).join(' ')).toLowerCase();
    if (!hay.includes(query)) return false;
  }
  return true;
}

/* ---------- pieces ------------------------------------------------------ */

function tagChip(tag) {
  const b = el('button', { class: 'chip', type: 'button',
                           'aria-pressed': String(active.has(tag)) },
               esc(tag) + ' <span class="n">' + TAGS.get(tag) + '</span>');
  b.addEventListener('click', () => {
    active.has(tag) ? active.delete(tag) : active.add(tag);
    render();
  });
  return b;
}

function colChip(c) {
  const b = el('button', { class: 'chip chip-col', type: 'button',
                           'aria-pressed': String(activeCols.has(c.label)) },
               esc(c.icon + ' ' + c.label) + ' <span class="n">' + c.slugs.length + '</span>');
  b.addEventListener('click', () => {
    activeCols.has(c.label) ? activeCols.delete(c.label) : activeCols.add(c.label);
    render();
  });
  return b;
}

/* Always-visible control strip. Keeps active filters legible even when the
   filter panel itself is collapsed. */
function renderToolbar(shown, total) {
  toolbar.innerHTML = '';
  const row = el('div', { class: 'toolbar-row' });

  for (const c of COLLECTIONS) row.appendChild(colChip(c));

  const n = filterCount();
  const fbtn = el('button', {
    class: 'tool-btn' + (filtersOpen ? ' is-open' : '') + (n ? ' has-filters' : ''),
    type: 'button', 'aria-expanded': String(filtersOpen), 'aria-controls': 'filter-panel'
  }, 'Filters' + (n ? ' <span class="badge">' + n + '</span>' : '') +
     ' <span class="caret">' + (filtersOpen ? '▴' : '▾') + '</span>');
  fbtn.addEventListener('click', () => { filtersOpen = !filtersOpen; render(); });
  row.appendChild(fbtn);

  const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'View' });
  for (const [id, label] of [['all', 'All'], ['grouped', 'By category']]) {
    const b = el('button', { type: 'button', 'aria-pressed': String(view === id) }, label);
    b.addEventListener('click', () => {
      view = id;
      try { localStorage.setItem(VIEW_KEY, id); } catch (e) { /* private mode */ }
      render();
    });
    seg.appendChild(b);
  }
  row.appendChild(seg);

  row.appendChild(el('span', { class: 'result-count' },
    shown === total ? total + ' recipes' : '<b>' + shown + '</b> of ' + total));
  toolbar.appendChild(row);

  if (!n && !query) return;

  /* Active filters, each individually removable. */
  const bar = el('div', { class: 'active-bar' });
  for (const l of activeCols) {
    const c = COLLECTIONS.find(x => x.label === l);
    const b = el('button', { class: 'pill', type: 'button',
                             title: 'Remove this filter' },
                 esc((c ? c.icon + ' ' : '') + l) + ' <span class="x">×</span>');
    b.addEventListener('click', () => { activeCols.delete(l); render(); });
    bar.appendChild(b);
  }
  for (const t of active) {
    const b = el('button', { class: 'pill', type: 'button', title: 'Remove this filter' },
                 esc(t) + ' <span class="x">×</span>');
    b.addEventListener('click', () => { active.delete(t); render(); });
    bar.appendChild(b);
  }
  if (query) {
    const b = el('button', { class: 'pill', type: 'button', title: 'Clear search' },
                 'search: ' + esc(query) + ' <span class="x">×</span>');
    b.addEventListener('click', () => { searchI.value = ''; query = ''; render(); });
    bar.appendChild(b);
  }

  if (n > 1) {
    const mode = el('span', { class: 'match-mode' });
    const bAll = el('button', { type: 'button', 'aria-pressed': String(matchAll) }, 'All');
    const bAny = el('button', { type: 'button', 'aria-pressed': String(!matchAll) }, 'Any');
    bAll.addEventListener('click', () => { matchAll = true; render(); });
    bAny.addEventListener('click', () => { matchAll = false; render(); });
    mode.append(bAll, bAny);
    bar.append(el('span', { class: 'match-label' }, 'match'), mode);
  }

  const clear = el('button', { class: 'clear', type: 'button' }, 'Clear all');
  clear.addEventListener('click', () => {
    active.clear(); activeCols.clear();
    searchI.value = ''; query = '';
    render();
  });
  bar.appendChild(clear);
  toolbar.appendChild(bar);
}

function renderPanel() {
  panel.innerHTML = '';
  panel.hidden = !filtersOpen;
  if (!filtersOpen) return;
  for (const g of GROUPS) {
    const b = el('div', { class: 'filter-group' });
    b.appendChild(el('div', { class: 'filter-group-label' }, esc(g.label)));
    const row = el('div', { class: 'chips' });
    for (const t of g.tags) row.appendChild(tagChip(t));
    b.appendChild(row);
    panel.appendChild(b);
  }
}

function card(r) {
  const a = el('a', { class: 'card', href: 'recipe.html?r=' + encodeURIComponent(r.slug) });
  const top = el('div', { class: 'card-top' });
  if (r.projectId) top.appendChild(el('span', { class: 'card-id' }, esc(r.projectId)));
  const cols = colsOf(r.slug);
  if (cols.length) {
    top.appendChild(el('span', { class: 'card-fav', title: cols.map(c => c.label).join(', ') },
                       cols.map(c => c.icon).join(' ')));
  }
  if (top.childNodes.length) a.appendChild(top);
  a.appendChild(el('h4', null, esc(r.title)));
  if (r.blurb) a.appendChild(el('p', null, esc(r.blurb)));
  const tw = el('div', { class: 'card-tags' });
  for (const t of (r.tags || []).slice(0, 4)) tw.appendChild(el('span', null, esc(t)));
  a.appendChild(tw);
  return a;
}

const grid = list => {
  const g = el('div', { class: 'card-grid' });
  for (const r of list) g.appendChild(card(r));
  return g;
};

function section(title, list, sub) {
  const s = el('section', { class: 'group' });
  const h = el('div', { class: 'group-head' });
  h.appendChild(el('h2', null, esc(title)));
  h.appendChild(el('span', { class: 'count' }, list.length + ' recipes'));
  s.appendChild(h);
  if (sub) s.appendChild(el('p', { class: 'group-sub' }, esc(sub)));
  s.appendChild(grid(list));
  return s;
}

/* ---------- render ------------------------------------------------------ */

function render() {
  const total = DB.recipes.length;
  const visible = DB.recipes.filter(matches);

  renderToolbar(visible.length, total);
  renderPanel();

  statsM.innerHTML =
    '<span><b>' + total + '</b> recipes</span>' +
    '<span><b>' + TAGS.size + '</b> tags</span>' +
    (COLLECTIONS.length ? '<span><b>' + COLLECTIONS.length + '</b> collections</span>' : '');

  mount.innerHTML = '';
  if (!visible.length) {
    mount.appendChild(el('div', { class: 'empty' },
      'No recipes match these filters.<br><span class="empty-sub">' +
      'Try removing one, or switch match to <b>Any</b>.</span>'));
    return;
  }

  /* Filtering or searching always yields one flat list — grouping a filtered
     set just reintroduces the duplication the flat view exists to avoid. */
  if (filterCount() || query || view === 'all') {
    mount.appendChild(grid(visible));
    return;
  }

  const bySlug = new Map(visible.map(r => [r.slug, r]));
  for (const c of COLLECTIONS) {
    const list = c.slugs.map(s => bySlug.get(s)).filter(Boolean);   // curated order
    if (list.length) mount.appendChild(section(c.icon + ' ' + c.label, list, c.description));
  }
  for (const g of GROUPS) {
    const inGroup = visible.filter(r => g.tags.some(t => (r.tags || []).includes(t)));
    if (!inGroup.length) continue;
    const s = el('section', { class: 'group' });
    const h = el('div', { class: 'group-head' });
    h.appendChild(el('h2', null, esc(g.label)));
    h.appendChild(el('span', { class: 'count' }, inGroup.length + ' recipes'));
    s.appendChild(h);
    if (g.description) s.appendChild(el('p', { class: 'group-sub' }, esc(g.description)));
    for (const t of g.tags) {
      const list = visible.filter(r => (r.tags || []).includes(t));
      if (!list.length) continue;
      const block = el('div', { class: 'tag-block' });
      block.appendChild(el('h3', null, esc(t) + ' <span class="n">' + list.length + '</span>'));
      block.appendChild(grid(list));
      s.appendChild(block);
    }
    mount.appendChild(s);
  }
}

/* ---------- boot -------------------------------------------------------- */

initTheme();
try {
  const v = localStorage.getItem(VIEW_KEY);
  if (v === 'all' || v === 'grouped') view = v;
} catch (e) { /* private mode */ }

searchI.addEventListener('input', () => {
  query = searchI.value.trim().toLowerCase();
  render();
});

getJSON(DATA_BASE + 'index.json').then(db => {
  DB = db;
  DB.recipes.sort((a, b) => a.title.localeCompare(b.title));
  buildCollections();
  buildTagModel();

  /* Deep link: index.html?tag=Vegan, used by recipe-page tag links. */
  const t = new URLSearchParams(location.search).get('tag');
  if (t && TAGS.has(t)) active.add(t);

  render();
}).catch(err => showError(mount, err));
