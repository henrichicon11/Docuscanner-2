/**
 * Minimal hash router.  Routes look like '#/doc/:id'.  Each view module exports
 * `render(root, params, query)` which may return a cleanup function (or a Promise of one).
 */
const routes = [];
let cleanup = null;
let renderToken = 0;

export function route(pattern, loader) {
  const keys = [];
  const re = new RegExp(
    '^' + pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'
  );
  routes.push({ re, keys, loader });
}

export function navigate(path, { replace = false } = {}) {
  const hash = '#' + path;
  if (replace) {
    history.replaceState(null, '', hash);
    handle();
  } else if (location.hash === hash) {
    handle();
  } else {
    location.hash = hash;
  }
}

export function back(fallback = '/') {
  if (history.length > 1 && document.referrer !== undefined && sessionStorage.getItem('ds-nav') === '1') history.back();
  else navigate(fallback, { replace: true });
}

function parse() {
  const raw = location.hash.slice(1) || '/';
  const [path, qs = ''] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
}

async function handle() {
  const token = ++renderToken;
  const { path, query } = parse();
  const root = document.getElementById('view');
  if (typeof cleanup === 'function') {
    try { cleanup(); } catch (e) { console.error(e); }
  }
  cleanup = null;
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const mod = await r.loader();
    if (token !== renderToken) return;
    root.innerHTML = '';
    window.scrollTo(0, 0);
    try {
      const c = await mod.render(root, params, query);
      if (token !== renderToken) { if (typeof c === 'function') c(); return; }
      cleanup = c;
    } catch (e) {
      console.error(e);
      root.innerHTML = '';
      const div = document.createElement('div');
      div.className = 'empty';
      div.innerHTML = '<h2>Something went wrong</h2><p></p><a class="btn primary" href="#/">Go to library</a>';
      div.querySelector('p').textContent = e.message || String(e);
      root.appendChild(div);
    }
    return;
  }
  navigate('/', { replace: true });
}

export function startRouter() {
  window.addEventListener('hashchange', () => { sessionStorage.setItem('ds-nav', '1'); handle(); });
  handle();
}
