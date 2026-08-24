import { DATA_BASE, esc, rich, el, getJSON, initTheme, showError } from './common.js';

const mount = document.getElementById('sheet');
const navM  = document.getElementById('sheet-nav');

let R = null;
let scale = 1;

const params = new URLSearchParams(location.search);
const slug = params.get('r');

/* ---------- number helpers ---------- */

function fmtMass(g) {
  if (g == null || !isFinite(g)) return null;
  const v = g * scale;
  /* Keep one decimal so source-stated weights like 453.6 g survive round-tripping,
     but drop a trailing .0 so whole numbers stay clean. */
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 1 }) + ' g';
  return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '') + ' g';
}

function fmtPct(p) {
  if (p == null || !isFinite(p)) return null;
  return (Math.round(p * 100) / 100).toFixed(p % 1 === 0 ? 1 : 2) + '%';
}

/* ---------- sections ---------- */

const NAV = [];

function sec(id, title, extra) {
  const s = el('section', { class: 'sec', id });
  s.appendChild(el('h2', null, esc(title) + (extra || '')));
  NAV.push({ id, title });
  return s;
}

/* ---------- header ---------- */

function renderHead() {
  const h = el('header', { class: 'sheet-head' });
  h.appendChild(el('div', { class: 'sheet-kicker' }, 'Recipe Formulation Sheet'));
  h.appendChild(el('h1', null, esc(R.title)));
  if (R.subtitle) h.appendChild(el('div', { class: 'sheet-sub' }, esc(R.subtitle)));

  const m = R.meta || {};
  const dl = el('dl', { class: 'meta-grid' });
  const add = (label, value, full) => {
    if (!value) return;
    const d = el('div', full ? { class: 'full' } : null);
    d.appendChild(el('dt', null, esc(label)));
    d.appendChild(el('dd', null, value));
    dl.appendChild(d);
  };

  add('Project ID', m.projectId ? esc(m.projectId) : null);
  add('Version',    m.version   ? esc(m.version)   : null);
  add('Date',       m.date      ? esc(m.date)      : null);

  if (m.status) {
    const prod = /production/i.test(m.status);
    add('Status', '<span class="status-pill ' + (prod ? 'prod' : 'proto') + '">' +
        esc(m.status) + '</span>');
  }
  if (m.baseTargetScale) add('Base Target Scale', esc(m.baseTargetScale), true);

  /* `source` is either a structured object (preferred) or, on older sheets,
     a plain citation string. Both render. */
  const src = m.source;
  if (typeof src === 'string' && src) {
    const txt = m.sourceUrl
      ? '<a href="' + esc(m.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' +
        esc(src) + '</a>'
      : esc(src);
    add('Source', txt, true);
  } else if (src && typeof src === 'object') {
    // Compose "Publication — \"Title\"", linking whichever parts exist.
    const bits = [];
    if (src.publication) bits.push(esc(src.publication));
    if (src.title) bits.push('&ldquo;' + esc(src.title) + '&rdquo;');
    let label = bits.join(' &mdash; ') || esc(src.url || '');
    const url = src.url || m.sourceUrl;
    if (url) {
      label = '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' +
              label + '</a>';
    }
    if (src.date) label += ' <span style="color:var(--ink-faint)">(' + esc(src.date) + ')</span>';
    if (label) add('Source', label, true);
    if (src.author) add('Author', esc(src.author), true);
    if (src.note) add('Attribution', rich(src.note), true);
  }
  h.appendChild(dl);

  if (R.tags && R.tags.length) {
    const tw = el('div', { class: 'sheet-tags' });
    for (const t of R.tags) {
      tw.appendChild(el('a', { href: 'index.html?tag=' + encodeURIComponent(t) }, esc(t)));
    }
    h.appendChild(tw);
  }
  mount.appendChild(h);

  if (m.reconstruction) {
    mount.appendChild(el('div', { class: 'banner' },
      '<b>Reconstruction notice</b>' + rich(m.reconstruction)));
  }
}

/* ---------- summary + specs ---------- */

function renderSummary() {
  if (!R.summary || !R.summary.length) return;
  const s = sec('summary', 'Summary of Source Findings');
  for (const p of R.summary) s.appendChild(el('p', null, rich(p)));
  mount.appendChild(s);
}

function renderSpecs() {
  if (!R.specs || !R.specs.length) return;
  const dl = el('dl', { class: 'spec-strip' });
  for (const sp of R.specs) {
    const d = el('div');
    d.appendChild(el('dt', null, esc(sp.label)));
    d.appendChild(el('dd', null, rich(sp.value)));
    dl.appendChild(d);
  }
  mount.appendChild(dl);
}

/* ---------- I. formulation matrices ---------- */

const DEFAULT_COLS = ['Item ID', 'Component / Ingredient', 'Volume (Kitchen Unit)',
                      'Mass (Grams / Net)', 'Formula %', 'Functional Role / Specifications'];

function matrixTable(f) {
  const cols = f.columns || DEFAULT_COLS;
  const wrap = el('div', { class: 'table-scroll' });
  const t = el('table', { class: 'fm' });

  const thead = el('thead');
  const tr = el('tr');
  for (const c of cols) tr.appendChild(el('th', null, esc(c)));
  thead.appendChild(tr);
  t.appendChild(thead);

  const tb = el('tbody');
  for (const row of (f.rows || [])) {
    if (row.group) {
      const g = el('tr', { class: 'grp' });
      g.appendChild(el('td', { colspan: String(cols.length) }, esc(row.group)));
      tb.appendChild(g);
      continue;
    }
    const isBase = !!row.baseline;
    const r = el('tr', isBase ? { class: 'is-baseline' } : null);

    r.appendChild(el('td', { class: 'c-id' }, esc(row.id || '')));
    r.appendChild(el('td', { class: 'c-name' }, rich(row.name || '')));
    r.appendChild(el('td', { class: 'c-vol' }, esc(row.volume || '—')));

    const mass = fmtMass(row.mass);
    const est  = row.estimated
      ? ' <span class="est" title="Estimated — not a source-stated weight">*</span>' : '';
    r.appendChild(el('td', { class: 'c-mass', 'data-mass': row.mass != null ? row.mass : '' },
      (mass ? esc(mass) : esc(row.massText || '—')) + est));

    const pct = row.pct != null ? fmtPct(row.pct) : null;
    r.appendChild(el('td', { class: 'c-pct' }, pct ? esc(pct) : esc(row.pctText || '—')));
    r.appendChild(el('td', { class: 'c-role' }, rich(row.role || '')));
    tb.appendChild(r);
  }

  if (f.total) {
    const r = el('tr', { class: 'is-total' });
    r.appendChild(el('td', { class: 'c-id' }, 'TOTAL'));
    r.appendChild(el('td', { class: 'c-name' }, esc(f.total.name || 'Target Batch Footprint')));
    r.appendChild(el('td', { class: 'c-vol' }, '—'));
    const tm = fmtMass(f.total.mass);
    r.appendChild(el('td', { class: 'c-mass', 'data-mass': f.total.mass != null ? f.total.mass : '' },
      (tm ? esc(tm) : esc(f.total.massText || '—')) + (f.total.estimated ? ' <span class="est">*</span>' : '')));
    r.appendChild(el('td', { class: 'c-pct' },
      f.total.pct != null ? esc(fmtPct(f.total.pct)) : esc(f.total.pctText || '—')));
    r.appendChild(el('td', { class: 'c-role' }, rich(f.total.role || '')));
    tb.appendChild(r);
  }

  t.appendChild(tb);
  wrap.appendChild(t);
  return wrap;
}

function renderScaler(baselineMass, baselineName) {
  const bar = el('div', { class: 'scaler' });
  bar.appendChild(el('span', { class: 'scaler-label' }, 'Scale batch'));

  const steps = el('div', { class: 'scale-steps' });
  const opts = [0.5, 1, 1.5, 2, 3];
  const btns = [];
  for (const v of opts) {
    const b = el('button', { type: 'button', 'aria-pressed': String(v === scale) },
                 v === 1 ? '1×' : (v + '×'));
    b.addEventListener('click', () => setScale(v));
    btns.push([b, v]);
    steps.appendChild(b);
  }
  bar.appendChild(steps);

  let input = null;
  if (baselineMass) {
    bar.appendChild(el('span', { class: 'scaler-label' }, 'or baseline'));
    input = el('input', {
      type: 'number', min: '1', step: '1',
      value: String(Math.round(baselineMass * scale)),
      'aria-label': 'Baseline mass in grams'
    });
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (isFinite(v) && v > 0) setScale(v / baselineMass, true);
    });
    bar.appendChild(input);
    bar.appendChild(el('span', { class: 'scaler-label' }, 'g'));
    bar.appendChild(el('span', { class: 'baseline-note' },
      'Baseline <b>' + esc(baselineName || '') + '</b> locked at 100%'));
  }

  function setScale(v, fromInput) {
    scale = v;
    for (const [b, val] of btns) b.setAttribute('aria-pressed', String(Math.abs(val - v) < 1e-9));
    if (input && !fromInput) input.value = String(Math.round(baselineMass * v));
    repaintMasses();
  }
  return bar;
}

/* Recompute every rendered mass cell in place from its stored base value. */
function repaintMasses() {
  document.querySelectorAll('table.fm td.c-mass').forEach(td => {
    const raw = td.getAttribute('data-mass');
    if (raw === '' || raw == null) return;
    const base = parseFloat(raw);
    if (!isFinite(base)) return;
    const est = td.querySelector('.est');
    td.textContent = fmtMass(base);
    if (est) td.appendChild(est);
  });
}

function renderFormulations() {
  const list = R.formulations || [];
  if (!list.length) return;

  const s = sec('formulation', R.formulationTitle || 'I. Master Formulation Matrix');

  if (R.scalingPrinciple) {
    s.appendChild(el('div', { class: 'principle' },
      '<b>Scaling Principle.</b> ' + rich(R.scalingPrinciple)));
  }

  /* One scaler drives every matrix on the page. */
  const first = list[0];
  const baseRow = (first.rows || []).find(r => r.baseline);
  s.appendChild(renderScaler(baseRow ? baseRow.mass : null, baseRow ? baseRow.name : null));

  for (const f of list) {
    if (f.title) s.appendChild(el('h3', null, esc(f.title)));
    if (f.intro) s.appendChild(el('p', null, rich(f.intro)));
    s.appendChild(matrixTable(f));
    if (f.note) s.appendChild(el('div', { class: 'footnote' }, rich(f.note)));
  }

  if (R.matrixFootnote) {
    s.appendChild(el('div', { class: 'footnote' }, rich(R.matrixFootnote)));
  }
  mount.appendChild(s);
}

/* ---------- II. mise en place ---------- */

function renderMise() {
  if (!R.mise || !R.mise.length) return;
  const s = sec('mise', R.miseTitle || 'II. Pre-Assembly Processing (Mise en Place)');
  const ul = el('ul', { class: 'mise' });
  for (const m of R.mise) {
    const li = el('li');
    if (m.label) li.appendChild(el('b', null, rich(m.label)));
    li.appendChild(el('span', null, rich(m.text || '')));
    ul.appendChild(li);
  }
  s.appendChild(ul);
  mount.appendChild(s);
}

/* ---------- III. execution ---------- */

function renderExecution() {
  if (!R.execution || !R.execution.length) return;
  const s = sec('execution', R.executionTitle || 'III. Execution Sequence');
  const ol = el('ol', { class: 'exec' });
  for (const step of R.execution) {
    const li = el('li');
    if (step.name)   li.appendChild(el('span', { class: 'exec-name' }, rich(step.name)));
    if (step.params) li.appendChild(el('span', { class: 'exec-params' }, esc(step.params)));
    const body = el('div', { class: 'exec-body' });
    if (step.text) {
      for (const p of [].concat(step.text)) body.appendChild(el('p', null, rich(p)));
    }
    if (step.items && step.items.length) {
      const ul = el('ul');
      for (const it of step.items) ul.appendChild(el('li', null, rich(it)));
      body.appendChild(ul);
    }
    li.appendChild(body);
    ol.appendChild(li);
  }
  s.appendChild(ol);
  mount.appendChild(s);
}

/* ---------- IV. quality control ---------- */

function renderQC() {
  if (!R.qc || !R.qc.length) return;
  const s = sec('qc', R.qcTitle || 'IV. Quality Control Parameters');
  const hasAction = R.qc.some(q => q.action);
  const wrap = el('div', { class: 'table-scroll' });
  const t = el('table', { class: 'fm' });
  const thead = el('thead');
  const tr = el('tr');
  ['Evaluation Metric', 'Target Spec Standard',
   hasAction ? 'Corrective Action Directive' : 'Actual Result',
   hasAction ? null : 'Line Rating'].filter(Boolean)
    .forEach(c => tr.appendChild(el('th', null, esc(c))));
  thead.appendChild(tr);
  t.appendChild(thead);

  const tb = el('tbody');
  for (const q of R.qc) {
    const r = el('tr');
    r.appendChild(el('td', { class: 'c-name' }, rich(q.metric || '')));
    r.appendChild(el('td', { class: 'c-role' }, rich(q.target || '')));
    if (hasAction) {
      r.appendChild(el('td', { class: 'c-role' }, rich(q.action || '—')));
    } else {
      r.appendChild(el('td', { class: 'c-vol' }, esc(q.actual || '[Pending Run]')));
      r.appendChild(el('td', { class: 'c-pct' }, esc(q.rating || '/ 10')));
    }
    tb.appendChild(r);
  }
  t.appendChild(tb);
  wrap.appendChild(t);
  s.appendChild(wrap);
  mount.appendChild(s);
}

/* ---------- V. alternatives ---------- */

function renderAlternatives() {
  if (!R.alternatives || !R.alternatives.length) return;
  const s = sec('alternatives', R.alternativesTitle || 'V. Alternative Ingredients & Formulations');
  const ul = el('ul', { class: 'plain' });
  for (const a of R.alternatives) {
    ul.appendChild(el('li', null,
      (a.label ? '<b>' + rich(a.label) + '</b> ' : '') + rich(a.text || '')));
  }
  s.appendChild(ul);
  mount.appendChild(s);
}

/* ---------- extra free-form sections ---------- */

function renderExtraSections() {
  for (const x of (R.sections || [])) {
    const id = 'x-' + (x.id || Math.random().toString(36).slice(2, 7));
    const s = sec(id, x.title || 'Notes');
    if (x.intro) s.appendChild(el('p', null, rich(x.intro)));

    if (x.paragraphs) for (const p of x.paragraphs) s.appendChild(el('p', null, rich(p)));

    if (x.items && x.items.length) {
      const ul = el('ul', { class: 'plain' });
      for (const it of x.items) {
        ul.appendChild(el('li', null,
          typeof it === 'string'
            ? rich(it)
            : (it.label ? '<b>' + rich(it.label) + '</b> ' : '') + rich(it.text || '')));
      }
      s.appendChild(ul);
    }

    if (x.table && x.table.rows) {
      const wrap = el('div', { class: 'table-scroll' });
      const t = el('table', { class: 'fm' });
      if (x.table.columns) {
        const thead = el('thead'), tr = el('tr');
        for (const c of x.table.columns) tr.appendChild(el('th', null, esc(c)));
        thead.appendChild(tr); t.appendChild(thead);
      }
      const tb = el('tbody');
      for (const row of x.table.rows) {
        const r = el('tr');
        row.forEach((cell, i) => r.appendChild(
          el('td', { class: i === 0 ? 'c-name' : 'c-role' }, rich(cell))));
        tb.appendChild(r);
      }
      t.appendChild(tb); wrap.appendChild(t);
      s.appendChild(wrap);
    }
    mount.appendChild(s);
  }
}

/* ---------- directive ---------- */

function renderDirective() {
  if (!R.directive) return;
  mount.appendChild(el('div', { class: 'directive' },
    '<b>Operational Directive</b>' + rich(R.directive)));
}

/* ---------- nav ---------- */

function renderNav() {
  if (NAV.length < 2) return;
  const inner = el('div', { class: 'sheet-nav-in wrap' });
  inner.appendChild(el('a', { href: 'index.html' }, '← All recipes'));
  for (const n of NAV) {
    inner.appendChild(el('a', { href: '#' + n.id }, esc(n.title.replace(/^[IVX]+\.\s*/, ''))));
  }
  const print = el('a', { href: '#', role: 'button' }, 'Print');
  print.addEventListener('click', e => { e.preventDefault(); window.print(); });
  inner.appendChild(print);
  navM.appendChild(inner);
}

/* ---------- boot ---------- */

initTheme();

if (!slug) {
  showError(mount, new Error('No recipe specified. Use recipe.html?r=<slug>'));
} else {
  getJSON(DATA_BASE + 'recipes/' + slug + '.json').then(data => {
    R = data;
    document.title = R.title + ' — Recipe Formulation Sheet';
    mount.innerHTML = '';
    renderHead();
    renderSummary();
    renderSpecs();
    renderFormulations();
    renderMise();
    renderExecution();
    renderQC();
    renderAlternatives();
    renderExtraSections();
    renderDirective();
    renderNav();
  }).catch(err => showError(mount, err));
}
