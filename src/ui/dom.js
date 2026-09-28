/** Small DOM helper utilities: element builder, toasts, modals, sheets, loading overlay. */
import { icons } from './icons.js';

/**
 * h('div.cls#id', {onclick, ...attrs}, ...children)
 * Children may be strings (text), Nodes, arrays, or null/false.
 * Use { html: '...' } to set trusted innerHTML (icons only).
 */
export function h(tag, props = {}, ...children) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i) || [];
  const el = document.createElement(name || 'div');
  rest.replace(/([.#])([^.#]+)/g, (_, t, v) => {
    if (t === '.') el.classList.add(v);
    else el.id = v;
    return '';
  });
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = {};
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'html') el.innerHTML = v;
    else if (k === 'class') el.className = [el.className, v].filter(Boolean).join(' ');
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const icon = (name) => h('span', { html: icons[name] || '', style: { display: 'inline-flex' } });

export function iconBtn(name, title, onclick, extra = {}) {
  return h('button.icon-btn', { title, 'aria-label': title, onclick, ...extra, html: icons[name] });
}

export function toast(message, type = 'info', ms = 2600) {
  const root = document.getElementById('toast-root');
  const t = h(`div.toast.${type}`, {}, message);
  root.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/** Opens a modal; content(close) returns a Node. Resolves with the value passed to close(). */
export function modal(content, { dismissible = true } = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal-root');
    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(undefined); };
    const box = h('div.modal', { role: 'dialog', 'aria-modal': 'true' }, content(close));
    const backdrop = h('div.backdrop', { onclick: (e) => { if (e.target === backdrop && dismissible) close(undefined); } }, box);
    root.appendChild(backdrop);
    document.addEventListener('keydown', onKey);
    const focusable = box.querySelector('input, textarea, select');
    if (focusable) setTimeout(() => { focusable.focus(); focusable.select?.(); }, 30);
  });
}

export function confirmDialog(title, message, { okText = 'OK', danger = false } = {}) {
  return modal((close) => [
    h('h2', {}, title),
    message && h('p', {}, message),
    h('div.actions', {},
      h('button.btn.ghost', { onclick: () => close(false) }, 'Cancel'),
      h(`button.btn.${danger ? 'danger' : 'primary'}`, { onclick: () => close(true) }, okText)),
  ]).then(Boolean);
}

export function promptDialog(title, value = '', { okText = 'Save', label, placeholder = '' } = {}) {
  return modal((close) => {
    const input = h('input', { type: 'text', value, placeholder, onkeydown: (e) => { if (e.key === 'Enter') close(input.value.trim()); } });
    return [
      h('h2', {}, title),
      label && h('label', {}, label),
      input,
      h('div.actions', {},
        h('button.btn.ghost', { onclick: () => close(null) }, 'Cancel'),
        h('button.btn.primary', { onclick: () => close(input.value.trim()) }, okText)),
    ];
  }).then((v) => (v === undefined ? null : v));
}

/** Action sheet. items: [{icon, label, value, danger}] */
export function actionSheet(title, items) {
  return modal((close) => [
    title && h('h2', {}, title),
    ...items.filter(Boolean).map((it) =>
      h(`button.sheet-item${it.danger ? '.danger' : ''}`, { onclick: () => close(it.value) },
        h('span', { html: icons[it.icon] || '' }), it.label)),
  ]);
}

let loadingEl = null;
export function showLoading(text = 'Processing…') {
  hideLoading();
  loadingEl = h('div.loading', {}, h('div.spinner'), h('div.loading-text', {}, text));
  document.body.appendChild(loadingEl);
  return (t) => { const n = loadingEl?.querySelector('.loading-text'); if (n) n.textContent = t; };
}
export function hideLoading() {
  loadingEl?.remove();
  loadingEl = null;
}

export function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function formatBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

/** Keeps track of object URLs so views can release them on unmount. */
export class UrlPool {
  constructor() { this.urls = []; }
  get(blob) { const u = URL.createObjectURL(blob); this.urls.push(u); return u; }
  revokeAll() { this.urls.forEach((u) => URL.revokeObjectURL(u)); this.urls = []; }
}
