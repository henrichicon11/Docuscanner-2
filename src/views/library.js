/** Library (home) view: all scanned documents. */
import { h, iconBtn, icon, toast, confirmDialog, promptDialog, actionSheet, formatDate, UrlPool } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import * as db from '../core/storage.js';
import { navigate } from '../router.js';
import { state } from '../state.js';
import { startImport } from './capture-helpers.js';
import { sortDocs, filterDocs } from '../core/search.js';

const ui = {
  query: '',
  sort: 'updated', // updated | created | name | pages
  layout: localStorage.getItem('ds-layout') || 'grid',
  filter: 'all', // all | favorites | tag:<name>
  selecting: false,
  selected: new Set(),
};

export async function render(root) {
  const pool = new UrlPool();
  let docs = [];
  let firstPages = {};
  let ocrIndex = {};

  const layoutBtn = iconBtn(ui.layout === 'grid' ? 'list' : 'grid', 'Toggle layout', () => {
    ui.layout = ui.layout === 'grid' ? 'list' : 'grid';
    localStorage.setItem('ds-layout', ui.layout);
    layoutBtn.innerHTML = icons[ui.layout === 'grid' ? 'list' : 'grid'];
    draw();
  });
  const header = h('header.appbar', {},
    h('div.brand', { html: icons.logo }, h('h1', {}, 'DocuScanner')),
    layoutBtn,
    iconBtn('select', 'Select documents', () => { ui.selecting = true; ui.selected.clear(); draw(); }),
    iconBtn('settings', 'Settings', () => navigate('/settings')),
  );
  const header2 = header;

  const selBar = h('div.selection-bar.hidden');
  const searchInput = h('input', {
    type: 'search', placeholder: 'Search names, tags, and text…', value: ui.query,
    'aria-label': 'Search documents',
    oninput: (e) => { ui.query = e.target.value; draw(); },
  });
  const sortSel = h('select.select', {
    'aria-label': 'Sort',
    onchange: (e) => { ui.sort = e.target.value; draw(); },
  },
  ...[['updated', 'Recent'], ['created', 'Created'], ['name', 'Name'], ['pages', 'Pages']]
    .map(([v, l]) => h('option', { value: v, selected: ui.sort === v }, l)));

  const chips = h('div.chips');
  const grid = h('div.doc-grid');
  const empty = h('div.empty.hidden', {},
    h('span', { html: icons.docs }),
    h('h2', {}, 'No documents yet'),
    h('div', {}, 'Tap “Scan” to capture a document with your camera, or import images from your device.'));

  const fileInput = h('input.hidden', { type: 'file', accept: 'image/*', multiple: true, onchange: async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) await startImport(files, {});
  } });

  const fabs = h('div.fab-group', {},
    h('button.fab.secondary', { onclick: () => fileInput.click() }, icon('image'), 'Import'),
    h('button.fab', { onclick: () => { state.pending = []; state.target = {}; navigate('/camera'); } }, icon('camera'), 'Scan'));

  root.append(header, selBar, h('div.toolbar-row', {}, h('label.search', {}, icon('search'), searchInput), sortSel), chips, grid, empty, fabs, fileInput);

  function drawChips() {
    const tags = [...new Set(docs.flatMap((d) => d.tags || []))].sort();
    chips.innerHTML = '';
    const mk = (id, label) => h(`button.chip${ui.filter === id ? '.active' : ''}`, { onclick: () => { ui.filter = id; draw(); } }, label);
    chips.append(mk('all', `All (${docs.length})`), mk('favorites', '★ Favorites'), ...tags.map((t) => mk(`tag:${t}`, `# ${t}`)));
  }

  function drawSelectionBar() {
    selBar.classList.toggle('hidden', !ui.selecting);
    header2.classList.toggle('hidden', ui.selecting);
    fabs.classList.toggle('hidden', ui.selecting);
    if (!ui.selecting) return;
    selBar.innerHTML = '';
    const n = ui.selected.size;
    selBar.append(
      iconBtn('close', 'Cancel selection', () => { ui.selecting = false; ui.selected.clear(); draw(); }),
      h('span', {}, `${n} selected`),
      iconBtn('merge', 'Merge selected', mergeSelected, { disabled: n < 2 || undefined }),
      iconBtn('trash', 'Delete selected', deleteSelected, { disabled: n < 1 || undefined }),
    );
  }

  async function mergeSelected() {
    const ids = docs.filter((d) => ui.selected.has(d.id)).map((d) => d.id);
    const name = await promptDialog('Merge documents', 'Merged document', { okText: 'Merge', label: 'Name of the new document' });
    if (name === null) return;
    const m = await db.mergeDocuments(ids, name || 'Merged document');
    toast(`Merged ${ids.length} documents`, 'success');
    ui.selecting = false;
    ui.selected.clear();
    navigate(`/doc/${m.id}`);
  }

  async function deleteSelected() {
    const n = ui.selected.size;
    if (!(await confirmDialog(`Delete ${n} document${n > 1 ? 's' : ''}?`, 'This cannot be undone.', { okText: 'Delete', danger: true }))) return;
    for (const id of ui.selected) await db.deleteDocument(id);
    ui.selecting = false;
    ui.selected.clear();
    toast('Deleted', 'success');
    await load();
  }

  async function docMenu(d) {
    const choice = await actionSheet(d.name, [
      { icon: 'eye', label: 'Open', value: 'open' },
      { icon: 'edit', label: 'Rename', value: 'rename' },
      { icon: d.favorite ? 'star' : 'starFill', label: d.favorite ? 'Remove from favorites' : 'Add to favorites', value: 'fav' },
      { icon: 'tag', label: 'Edit tags', value: 'tags' },
      { icon: 'copy', label: 'Duplicate', value: 'dup' },
      { icon: 'pdf', label: 'Export / share', value: 'export' },
      { icon: 'trash', label: 'Delete', value: 'delete', danger: true },
    ]);
    if (!choice) return;
    if (choice === 'open') navigate(`/doc/${d.id}`);
    if (choice === 'export') navigate(`/doc/${d.id}?export=1`);
    if (choice === 'rename') {
      const name = await promptDialog('Rename document', d.name);
      if (name) { await db.updateDocument(d.id, { name }); await load(); }
    }
    if (choice === 'fav') { await db.updateDocument(d.id, { favorite: !d.favorite }); await load(); }
    if (choice === 'tags') {
      const t = await promptDialog('Tags', (d.tags || []).join(', '), { label: 'Comma-separated, e.g. receipts, work' });
      if (t !== null) {
        const tags = [...new Set(t.split(',').map((s) => s.trim()).filter(Boolean))];
        await db.updateDocument(d.id, { tags });
        await load();
      }
    }
    if (choice === 'dup') { await db.duplicateDocument(d.id); toast('Duplicated', 'success'); await load(); }
    if (choice === 'delete') {
      if (await confirmDialog('Delete document?', `“${d.name}” and all its pages will be removed.`, { okText: 'Delete', danger: true })) {
        await db.deleteDocument(d.id);
        toast('Deleted', 'success');
        await load();
      }
    }
  }

  function card(d) {
    const fp = firstPages[d.id];
    const thumbSrc = fp?.thumb ? pool.get(fp.thumb) : null;
    const selected = ui.selected.has(d.id);
    const el = h(`div.doc-card${selected ? '.selected' : ''}`, {
      role: 'button', tabindex: 0,
      onclick: () => {
        if (ui.selecting) {
          if (ui.selected.has(d.id)) ui.selected.delete(d.id); else ui.selected.add(d.id);
          draw();
        } else navigate(`/doc/${d.id}`);
      },
      onkeydown: (e) => { if (e.key === 'Enter') el.click(); },
      oncontextmenu: (e) => { e.preventDefault(); docMenu(d); },
    },
    h('div.thumb', {}, thumbSrc ? h('img', { src: thumbSrc, alt: '', loading: 'lazy' }) : h('span', { html: icons.docs, style: { width: '40px', color: 'var(--muted)' } })),
    h('span.badge', {}, `${d.pageIds.length} pg`),
    d.favorite && h('span.fav', { html: icons.starFill, style: { width: '22px', display: 'inline-flex' } }),
    h('div.meta', {},
      h('div.name', { title: d.name }, d.name),
      h('div.sub', {}, `${formatDate(d.updatedAt)} · ${d.pageIds.length} page${d.pageIds.length === 1 ? '' : 's'}`),
      d.tags?.length ? h('div.sub', {}, d.tags.map((t) => `#${t}`).join(' ')) : null),
    !ui.selecting && h('button.icon-btn.more', {
      title: 'More', 'aria-label': 'More actions', html: icons.more,
      onclick: (e) => { e.stopPropagation(); docMenu(d); },
    }));
    return el;
  }

  function draw() {
    drawChips();
    drawSelectionBar();
    grid.className = `doc-grid${ui.layout === 'list' ? ' list' : ''}`;
    const visible = sortDocs(filterDocs(docs, { query: ui.query, filter: ui.filter, ocrIndex }), ui.sort);
    grid.innerHTML = '';
    visible.forEach((d) => grid.appendChild(card(d)));
    empty.classList.toggle('hidden', visible.length > 0);
    if (!visible.length && docs.length) {
      empty.querySelector('h2').textContent = 'No matching documents';
      empty.querySelector('div').textContent = 'Try a different search or filter.';
    }
  }

  async function load() {
    pool.revokeAll();
    docs = await db.listDocuments();
    firstPages = {};
    ocrIndex = {};
    for (const d of docs) {
      const pages = await db.getPages(d.pageIds);
      if (pages[0]) firstPages[d.id] = pages[0];
      ocrIndex[d.id] = pages.map((p) => p.ocrText || '').join(' ');
    }
    draw();
  }

  await load();
  return () => pool.revokeAll();
}
