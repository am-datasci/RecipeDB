import { DATA_BASE, esc, el, getJSON, initTheme, showError } from './common.js';

const mount   = document.getElementById('content');
const filterM = document.getElementById('filters');
const statsM  = document.getElementById('hero-stats');
const searchI = document.getElementById('search');

let DB = null;           // { collections, groups, recipes }
let TAGS = new Map();    // tag -> count
let GROUPS = [];         // [{id,label,description,tags:[...]}]
let COLLECTIONS = [];    // [{label,icon,description,slugs:[...],set:Set}]

const active = new Set();      // selected tags
const activeCols = new Set();  // selected collection labels
let matchAll = true;
let query = '';

/* Collections are curated, ORDERED slug lists — editorial picks, kept in one
   place so featuring a recipe never means editing the recipe itself. Tags
   describe what a recipe is; collections describe what you think of it. */
function buildCollections() {
  const known = new Set(DB.recipes.map(r => r.slug));
  COLLECTIONS = (DB.collections || []).map(c => {
    const slugs = (c.slugs || []).filter(sl => known.has(sl));
    return { label: c.label, icon: c.icon || '\u2605', description: c.description,
             slugs, set: new Set(slugs) };
  }).filter(c => c.slugs.length);
}

/* Every collection a recipe belongs to (for the card badge). */
function colsOf(slug) {
  return COLLECTIONS.filter(c => c.set.has(slug));
}

/* ---------- tag model ---------------------------------------------------
   Groups in index.json are *hints* for ordering and labelling only.
   Any tag found on a recipe but not listed in a group is collected into an
   auto-generated group, so adding a brand-new tag to a recipe is enough to
   make it appear on this page — no HTML and no config edit required.
------------------------------------------------------------------------- */

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

  const loose = [...TAGS.keys()]
    .filter(t => !declared.has(t))
    .sort((a, b) => a.localeCompare(b));

  if (loose.length) {
    GROUPS.push({
      id: 'more', label: 'More Tags',
      description: 'Tags not yet filed into a group in data/index.json.',
      tags: loose
    });
  }
}

/* ---------- filtering ---------- */

function matches(r) {
  const tags = r.tags || [];
  if (activeCols.size) {
    const hits = [...activeCols].filter(l => {
      const c = COLLECTIONS.find(x => x.label === l);
      return c && c.set.has(r.slug);
    });
    if (matchAll ? hits.length !== activeCols.size : hits.length === 0) return false;
  }
  if (active.size) {
    const hits = [...active].filter(t => tags.includes(t));
    if (matchAll ? hits.length !== active.size : hits.length === 0) return false;
  }
  if (query) {
    const hay = (r.title + ' ' + (r.blurb || '') + ' ' + tags.join(' ')).toLowerCase();
    if (!hay.includes(query)) return false;
  }
  return true;
}

/* ---------- rendering ---------- */

function chip(tag, count, pressed, cls) {
  const b = el('button', {
    class: 'chip' + (cls ? ' ' + cls : ''),
    type: 'button',
    'aria-pressed': String(pressed),
    'data-tag': tag
  }, esc(tag) + (count != null ? ' <span class="n">' + count + '</span>' : ''));
  b.addEventListener('click', () => {
    active.has(tag) ? active.delete(tag) : active.add(tag);
    render();
  });
  return b;
}

function renderFilters() {
  filterM.innerHTML = '';

  if (COLLECTIONS.length) {
    const g = el('div', { class: 'filter-group' });
    g.appendChild(el('div', { class: 'filter-group-label' }, 'Collections'));
    const row = el('div', { class: 'chips' });
    for (const c of COLLECTIONS) {
      const b = el('button', {
        class: 'chip chip-fav', type: 'button',
        'aria-pressed': String(activeCols.has(c.label))
      }, esc(c.icon + ' ' + c.label) + ' <span class="n">' + c.slugs.length + '</span>');
      b.addEventListener('click', () => {
        activeCols.has(c.label) ? activeCols.delete(c.label) : activeCols.add(c.label);
        render();
      });
      row.appendChild(b);
    }
    g.appendChild(row);
    filterM.appendChild(g);
  }

  for (const grp of GROUPS) {
    const g = el('div', { class: 'filter-group' });
    g.appendChild(el('div', { class: 'filter-group-label' }, esc(grp.label)));
    const row = el('div', { class: 'chips' });
    for (const t of grp.tags) row.appendChild(chip(t, TAGS.get(t), active.has(t)));
    g.appendChild(row);
    filterM.appendChild(g);
  }

  const bar = el('div', { class: 'active-bar' });
  const nSel = active.size + activeCols.size;
  if (nSel) {
    const mode = el('span', { class: 'match-mode' });
    const bAll = el('button', { type: 'button', 'aria-pressed': String(matchAll) }, 'Match all');
    const bAny = el('button', { type: 'button', 'aria-pressed': String(!matchAll) }, 'Match any');
    bAll.addEventListener('click', () => { matchAll = true; render(); });
    bAny.addEventListener('click', () => { matchAll = false; render(); });
    mode.append(bAll, bAny);
    bar.append(
      el('span', null, nSel + ' filter' + (nSel > 1 ? 's' : '') + ' selected'),
      mode
    );
    const clear = el('button', { class: 'clear', type: 'button' }, 'Clear all');
    clear.addEventListener('click', () => { active.clear(); activeCols.clear(); render(); });
    bar.appendChild(clear);
  } else {
    bar.appendChild(el('span', null,
      'Select tags to filter. Recipes appear under every tag they carry.'));
  }
  filterM.appendChild(bar);
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
  for (const t of (r.tags || []).slice(0, 4)) {
    tw.appendChild(el('span', null, esc(t)));
  }
  a.appendChild(tw);
  return a;
}

function grid(list) {
  const g = el('div', { class: 'card-grid' });
  for (const r of list) g.appendChild(card(r));
  return g;
}

function section(title, list, sub, count) {
  const s = el('section', { class: 'group' });
  const h = el('div', { class: 'group-head' });
  h.appendChild(el('h2', null, esc(title)));
  h.appendChild(el('span', { class: 'count' }, (count != null ? count : list.length) + ' recipes'));
  s.appendChild(h);
  if (sub) s.appendChild(el('p', { class: 'group-sub' }, esc(sub)));
  s.appendChild(grid(list));
  return s;
}

function render() {
  renderFilters();

  const visible = DB.recipes.filter(matches);
  mount.innerHTML = '';

  statsM.innerHTML =
    '<span><b>' + visible.length + '</b> of ' + DB.recipes.length + ' recipes</span>' +
    '<span><b>' + TAGS.size + '</b> tags</span>' +
    '<span><b>' + GROUPS.length + '</b> groups</span>' +
    (COLLECTIONS.length ? '<span><b>' + COLLECTIONS.length + '</b> collections</span>' : '');

  if (!visible.length) {
    mount.appendChild(el('div', { class: 'empty' },
      'No recipes match the current filters.'));
    return;
  }

  /* When the reader is actively filtering or searching, a flat result list is
     more useful than the grouped browse view. */
  if (active.size || activeCols.size || query) {
    mount.appendChild(section('Results', visible));
    return;
  }

  const byslug = new Map(visible.map(r => [r.slug, r]));
  for (const c of COLLECTIONS) {
    const list = c.slugs.map(sl => byslug.get(sl)).filter(Boolean);  // curated order
    if (list.length) {
      mount.appendChild(section(c.icon + ' ' + c.label, list, c.description));
    }
  }

  for (const grp of GROUPS) {
    const inGroup = visible.filter(r => grp.tags.some(t => (r.tags || []).includes(t)));
    if (!inGroup.length) continue;

    const s = el('section', { class: 'group' });
    const h = el('div', { class: 'group-head' });
    h.appendChild(el('h2', null, esc(grp.label)));
    h.appendChild(el('span', { class: 'count' }, inGroup.length + ' recipes'));
    s.appendChild(h);
    if (grp.description) s.appendChild(el('p', { class: 'group-sub' }, esc(grp.description)));

    for (const t of grp.tags) {
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

/* ---------- boot ---------- */

initTheme();

searchI.addEventListener('input', () => {
  query = searchI.value.trim().toLowerCase();
  render();
});

getJSON(DATA_BASE + 'index.json').then(db => {
  DB = db;
  DB.recipes.sort((a, b) => a.title.localeCompare(b.title));
  buildCollections();
  buildTagModel();
  render();
}).catch(err => showError(mount, err));
