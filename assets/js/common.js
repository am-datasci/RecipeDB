/* Shared helpers: theme toggle, fetch, escaping. */

export const DATA_BASE = new URL('./data/', document.baseURI).href;

export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* Very small inline-markup pass: **bold**, *italic*, `code`.
   Input is escaped first, so this cannot inject markup. */
export function rich(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function el(tag, attrs, html) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (attrs[k] == null) continue;
    if (k === 'class') n.className = attrs[k];
    else n.setAttribute(k, attrs[k]);
  }
  if (html != null) n.innerHTML = html;
  return n;
}

export async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText + ' — ' + url);
  return res.json();
}

export function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/* ---- theme ---- */

const THEME_KEY = 'recipedb-theme';

export function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* private mode */ }
  if (saved === 'light' || saved === 'dark') {
    document.documentElement.setAttribute('data-theme', saved);
  }
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  const paint = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const dark = cur === 'dark' || (!cur && matchMedia('(prefers-color-scheme: dark)').matches);
    btn.textContent = dark ? 'LIGHT' : 'DARK';
    btn.setAttribute('aria-label', 'Switch to ' + (dark ? 'light' : 'dark') + ' theme');
  };
  paint();
  btn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const dark = cur === 'dark' || (!cur && matchMedia('(prefers-color-scheme: dark)').matches);
    const next = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    paint();
  });
}

export function showError(mount, err) {
  const local = location.protocol === 'file:';
  mount.innerHTML =
    '<div class="error-box"><b>Could not load recipe data.</b><br>' +
    esc(err && err.message ? err.message : String(err)) +
    (local
      ? '<br><br>It looks like you opened this file directly from disk. Browsers block ' +
        '<code>fetch()</code> on <code>file://</code> URLs, so the JSON cannot be read. ' +
        'Serve the folder over HTTP instead:<br><br><code>python3 -m http.server 8000</code>' +
        '<br><br>then open <code>http://localhost:8000/</code>.'
      : '') +
    '</div>';
}
