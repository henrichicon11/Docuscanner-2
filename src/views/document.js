/**
 * Document view: multi-page grid.
 *  - open page editor, drag & drop to reorder (plus move left/right for accessibility)
 *  - add pages via camera or import, insert after a page, duplicate, delete
 *  - rename, favorite, reader mode (continuous scroll)
 */
import { h, iconBtn, icon, toast, confirmDialog, promptDialog, actionSheet, formatDate, UrlPool } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import * as db from '../core/storage.js';
import { navigate } from '../router.js';
import { state } from '../state.js';
import { startImport } from './capture-helpers.js';
import { openExport } from './export-dialog.js';

export async function render(root, { id }, query) {
  const pool = new UrlPool();
  let doc = await db.getDocument(id);
  if (!doc) { toast('Document not found', 'error'); navigate('/', { replace: true }); return; }
  let pages = [];
  let reader = false;
  let insertAt;

  const title = h('h1', { title: 'Rename', style: { cursor: 'pointer' }, onclick: rename });
  const favBtn = iconBtn('star', 'Favorite', async () => {
    doc = await db.updateDocument(id, { favorite: !doc.favorite });
    drawHeader();
  });
  const readerBtn = iconBtn('eye', 'Reader mode', () => { reader = !reader; draw(); });
  const header = h('header.appbar', {},
    iconBtn('back', 'Back to library', () => navigate('/')),
    title, favBtn, readerBtn,
    iconBtn('share', 'Export & share', () => openExport(doc, pages)),
    iconBtn('more', 'More', docMenu));

  const info = h('div', { style: { padding: '10px 16px 0', color: 'var(--muted)', fontSize: '0.85rem' } });
  const grid = h('div.page-grid');
  const viewer = h('div.viewer.hidden');

  const fileInput = h('input.hidden', { type: 'file', accept: 'image/*', multiple: true, onchange: async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) await startImport(files, { docId: id, insertAt });
    insertAt = undefined;
  } });

  const fabs = h('div.fab-group', {},
    h('button.fab.secondary', { onclick: () => { insertAt = undefined; fileInput.click(); } }, icon('image'), 'Import'),
    h('button.fab', { onclick: () => scanInto() }, icon('camera'), 'Add page'));

  root.append(header, info, grid, viewer, fabs, fileInput);

  function scanInto(at) {
    state.pending = [];
    state.target = { docId: id, insertAt: at };
    navigate(`/camera?doc=${id}${at !== undefined ? `&at=${at}` : ''}`);
  }

  function drawHeader() {
    title.textContent = doc.name;
    favBtn.innerHTML = icons[doc.favorite ? 'starFill' : 'star'];
    favBtn.style.color = doc.favorite ? '#f59e0b' : '';
    info.textContent = `${pages.length} page${pages.length === 1 ? '' : 's'} · Updated ${formatDate(doc.updatedAt)}${doc.tags?.length ? ' · ' + doc.tags.map((t) => '#' + t).join(' ') : ''}`;
    readerBtn.classList.toggle('active', reader);
  }

  async function rename() {
    const name = await promptDialog('Rename document', doc.name);
    if (!name) return;
    doc = await db.updateDocument(id, { name });
    drawHeader();
  }

  async function docMenu() {
    const choice = await actionSheet(doc.name, [
      { icon: 'edit', label: 'Rename', value: 'rename' },
      { icon: 'tag', label: 'Edit tags', value: 'tags' },
      { icon: 'image', label: 'Import images', value: 'import' },
      { icon: 'copy', label: 'Duplicate document', value: 'dup' },
      { icon: 'trash', label: 'Delete document', value: 'delete', danger: true },
    ]);
    if (choice === 'rename') rename();
    if (choice === 'import') fileInput.click();
    if (choice === 'tags') {
      const t = await promptDialog('Tags', (doc.tags || []).join(', '), { label: 'Comma-separated' });
      if (t !== null) {
        doc = await db.updateDocument(id, { tags: [...new Set(t.split(',').map((s) => s.trim()).filter(Boolean))] });
        drawHeader();
      }
    }
    if (choice === 'dup') {
      const copy = await db.duplicateDocument(id);
      toast('Document duplicated', 'success');
      navigate(`/doc/${copy.id}`);
    }
    if (choice === 'delete') {
      if (await confirmDialog('Delete document?', 'All pages will be removed permanently.', { okText: 'Delete', danger: true })) {
        await db.deleteDocument(id);
        toast('Document deleted', 'success');
        navigate('/');
      }
    }
  }

  async function pageMenu(p, i) {
    const choice = await actionSheet(`Page ${i + 1}`, [
      { icon: 'edit', label: 'Edit', value: 'edit' },
      { icon: 'text', label: 'Extract text (OCR)', value: 'ocr' },
      { icon: 'sign', label: 'Add signature', value: 'sign' },
      { icon: 'camera', label: 'Scan & insert after', value: 'insert' },
      { icon: 'image', label: 'Import & insert after', value: 'insertImport' },
      { icon: 'copy', label: 'Duplicate page', value: 'dup' },
      i > 0 && { icon: 'back', label: 'Move left', value: 'left' },
      i < pages.length - 1 && { icon: 'back', label: 'Move right', value: 'right' },
      { icon: 'trash', label: 'Delete page', value: 'delete', danger: true },
    ]);
    if (choice === 'edit') navigate(`/page/${p.id}`);
    if (choice === 'ocr') navigate(`/ocr/${p.id}`);
    if (choice === 'sign') navigate(`/sign/${p.id}`);
    if (choice === 'insert') scanInto(i + 1);
    if (choice === 'insertImport') { insertAt = i + 1; fileInput.click(); }
    if (choice === 'dup') {
      const { id: _omit, ...rest } = p;
      await db.addPage(id, rest, i + 1);
      toast('Page duplicated', 'success');
      await load();
    }
    if (choice === 'left' || choice === 'right') {
      await db.reorderPages(id, i, choice === 'left' ? i - 1 : i + 1);
      await load();
    }
    if (choice === 'delete') deletePage(p);
  }

  async function deletePage(p) {
    if (!(await confirmDialog('Delete page?', 'This page will be removed from the document.', { okText: 'Delete', danger: true }))) return;
    await db.deletePage(p.id);
    toast('Page deleted');
    await load();
  }

  let dragFrom = null;
  function pageCard(p, i) {
    const src = pool.get(p.thumb || p.processed);
    const card = h('div.page-card', {
      draggable: 'true',
      role: 'button', tabindex: 0,
      'aria-label': `Page ${i + 1}`,
      onclick: () => navigate(`/page/${p.id}`),
      onkeydown: (e) => { if (e.key === 'Enter') navigate(`/page/${p.id}`); },
      oncontextmenu: (e) => { e.preventDefault(); pageMenu(p, i); },
      ondragstart: (e) => { dragFrom = i; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); },
      ondragend: () => { card.classList.remove('dragging'); grid.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target')); },
      ondragover: (e) => { e.preventDefault(); card.classList.add('drop-target'); },
      ondragleave: () => card.classList.remove('drop-target'),
      ondrop: async (e) => {
        e.preventDefault();
        card.classList.remove('drop-target');
        if (dragFrom === null || dragFrom === i) return;
        await db.reorderPages(id, dragFrom, i);
        dragFrom = null;
        await load();
      },
    },
    h('img', { src, alt: `Page ${i + 1}`, loading: 'lazy', draggable: 'false' }),
    h('span.num', {}, String(i + 1)),
    h('div.page-actions', {},
      h('button.icon-btn', { title: 'Page actions', 'aria-label': 'Page actions', html: icons.more, onclick: (e) => { e.stopPropagation(); pageMenu(p, i); } }),
      h('button.icon-btn', { title: 'Delete page', 'aria-label': 'Delete page', html: icons.trash, onclick: (e) => { e.stopPropagation(); deletePage(p); } })));
    attachTouchReorder(card, i);
    return card;
  }

  // Long-press + drag reorder for touch devices (HTML5 DnD doesn't fire on mobile)
  function attachTouchReorder(card, i) {
    let timer = null;
    let active = false;
    card.addEventListener('touchstart', () => {
      timer = setTimeout(() => { active = true; card.classList.add('dragging'); navigator.vibrate?.(20); }, 450);
    }, { passive: true });
    card.addEventListener('touchmove', (e) => {
      if (!active) { clearTimeout(timer); return; }
      e.preventDefault();
      const t = e.touches[0];
      grid.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
      document.elementFromPoint(t.clientX, t.clientY)?.closest('.page-card:not(.add)')?.classList.add('drop-target');
    }, { passive: false });
    card.addEventListener('touchend', async (e) => {
      clearTimeout(timer);
      if (!active) return;
      active = false;
      e.preventDefault();
      card.classList.remove('dragging');
      const t = e.changedTouches[0];
      const over = document.elementFromPoint(t.clientX, t.clientY)?.closest('.page-card:not(.add)');
      grid.querySelectorAll('.drop-target').forEach((n) => n.classList.remove('drop-target'));
      const to = over ? [...grid.children].indexOf(over) : -1;
      if (to >= 0 && to !== i) {
        await db.reorderPages(id, i, to);
        await load();
      }
    });
  }

  function draw() {
    drawHeader();
    grid.classList.toggle('hidden', reader);
    viewer.classList.toggle('hidden', !reader);
    fabs.classList.toggle('hidden', reader);
    if (reader) {
      viewer.innerHTML = '';
      pages.forEach((p, i) => viewer.appendChild(h('img', { src: pool.get(p.processed), alt: `Page ${i + 1}`, loading: 'lazy' })));
      if (!pages.length) viewer.appendChild(h('div.empty', {}, 'No pages'));
      return;
    }
    grid.innerHTML = '';
    pages.forEach((p, i) => grid.appendChild(pageCard(p, i)));
    grid.appendChild(h('button.page-card.add', { onclick: () => scanInto() }, h('span', { html: icons.plus }), 'Add page'));
  }

  async function load() {
    pool.revokeAll();
    doc = await db.getDocument(id);
    pages = await db.getPages(doc.pageIds);
    draw();
  }

  await load();
  if (query.export) setTimeout(() => openExport(doc, pages), 50);
  return () => pool.revokeAll();
}
