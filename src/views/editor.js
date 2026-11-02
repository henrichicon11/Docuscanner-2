/**
 * Page editor: filters (with live thumbnails), rotation, brightness/contrast,
 * re-crop, apply settings to all pages, and shortcuts to OCR / signature tools.
 *
 * For responsiveness, editing happens on a cropped preview (max 1400px); the
 * full-resolution image is rendered once on save.
 */
import { h, iconBtn, toast, showLoading, hideLoading, confirmDialog } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import * as db from '../core/storage.js';
import { navigate } from '../router.js';
import { FILTERS, applyFilter } from '../core/filters.js';
import { rotate90, warpPerspective, estimateOutputSize, orderCorners, defaultCorners } from '../core/geometry.js';
import { decodeImage, drawableToCanvas, canvasToImageData, imageDataToCanvas, buildPageAssets, MAX_ORIGINAL_SIDE } from '../core/image.js';
import { recropPage } from './capture-helpers.js';

const PREVIEW_SIDE = 1400;

export async function render(root, { id }) {
  let page = await db.getPage(id);
  if (!page) { navigate('/', { replace: true }); return; }
  const doc = await db.getDocument(page.docId);
  const pageIndex = doc.pageIds.indexOf(id);

  const edit = {
    filter: page.filter || 'original',
    brightness: page.brightness || 0,
    contrast: page.contrast || 0,
    rotation: page.rotation || 0,
  };
  const initial = JSON.stringify(edit);
  const dirty = () => JSON.stringify(edit) !== initial;

  const setLoading = showLoading('Loading page…');
  let original;
  let cropped; // ImageData-like of the perspective-corrected preview
  try {
    original = drawableToCanvas(await decodeImage(page.original), MAX_ORIGINAL_SIDE);
    const corners = orderCorners(page.corners || defaultCorners(original.width, original.height, 0));
    const size = estimateOutputSize(corners, PREVIEW_SIDE);
    setLoading('Correcting perspective…');
    cropped = warpPerspective(canvasToImageData(original), corners, size.width, size.height);
  } finally {
    hideLoading();
  }

  const preview = h('canvas');
  const stageEl = h('div.editor-stage', {}, preview);
  const filterStrip = h('div.filter-strip');
  const sliders = h('div.sliders.hidden');
  let activePanel = 'filters';

  const exit = async () => {
    if (dirty() && !(await confirmDialog('Discard changes?', 'Your edits to this page will be lost.', { okText: 'Discard', danger: true }))) return;
    navigate(`/doc/${page.docId}`);
  };

  const header = h('header.appbar', {},
    iconBtn('back', 'Back', exit),
    h('h1', {}, `Page ${pageIndex + 1} of ${doc.pageIds.length}`),
    iconBtn('undo', 'Reset edits', () => {
      Object.assign(edit, { filter: 'original', brightness: 0, contrast: 0, rotation: 0 });
      syncSliders();
      update();
    }),
    h('button.btn.primary', { onclick: save, style: { padding: '8px 14px' } }, 'Save'));

  const tool = (iconName, label, onclick) => {
    const b = h('button.tool', { onclick }, h('span', { html: icons[iconName] }), label);
    return b;
  };
  const filtersTool = tool('filter', 'Filters', () => setPanel('filters'));
  const adjustTool = tool('sliders', 'Adjust', () => setPanel('adjust'));
  const tools = h('div.tools', {},
    tool('crop', 'Crop', async () => {
      if (dirty()) await persist();
      recropPage(await db.getPage(id));
    }),
    tool('rotateLeft', 'Left', () => { edit.rotation = (edit.rotation + 270) % 360; update(); }),
    tool('rotate', 'Right', () => { edit.rotation = (edit.rotation + 90) % 360; update(); }),
    filtersTool,
    adjustTool,
    tool('copy', 'Apply all', applyAll),
    tool('text', 'Text', async () => { if (dirty()) await persist(); navigate(`/ocr/${id}`); }),
    tool('sign', 'Sign', async () => { if (dirty()) await persist(); navigate(`/sign/${id}`); }),
  );

  root.append(header, stageEl, filterStrip, sliders, tools);

  function setPanel(p) {
    activePanel = p;
    filterStrip.classList.toggle('hidden', p !== 'filters');
    sliders.classList.toggle('hidden', p !== 'adjust');
    filtersTool.classList.toggle('active', p === 'filters');
    adjustTool.classList.toggle('active', p === 'adjust');
  }

  // ---- adjustments ----
  const mkSlider = (key, label) => {
    const out = h('span', {}, String(edit[key]));
    const input = h('input', {
      type: 'range', min: -100, max: 100, step: 1, value: edit[key], 'aria-label': label,
      oninput: (e) => { edit[key] = Number(e.target.value); out.textContent = e.target.value; scheduleUpdate(); },
    });
    return { row: h('div.slider-row', {}, h('span', {}, label), input, out), input, out, key };
  };
  const sl = [mkSlider('brightness', 'Brightness'), mkSlider('contrast', 'Contrast')];
  sliders.append(...sl.map((s) => s.row));
  const syncSliders = () => sl.forEach((s) => { s.input.value = edit[s.key]; s.out.textContent = String(edit[s.key]); });

  // ---- filter thumbnails ----
  const thumbSrc = (() => {
    const s = Math.min(1, 160 / Math.max(cropped.width, cropped.height));
    const c = imageDataToCanvas(cropped);
    const t = document.createElement('canvas');
    t.width = Math.round(cropped.width * s);
    t.height = Math.round(cropped.height * s);
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    return canvasToImageData(t);
  })();
  const filterButtons = FILTERS.map((f) => {
    const c = imageDataToCanvas(applyFilter(thumbSrc, f.id));
    const b = h('button.filter-item', { onclick: () => { edit.filter = f.id; update(); } }, c, h('span', {}, f.label));
    b.dataset.id = f.id;
    return b;
  });
  filterStrip.append(...filterButtons);

  // ---- rendering ----
  let raf = 0;
  function scheduleUpdate() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(update);
  }
  function update() {
    let img = applyFilter(cropped, edit.filter, { brightness: edit.brightness, contrast: edit.contrast });
    const turns = Math.round(edit.rotation / 90) % 4;
    if (turns) img = rotate90(img, turns);
    preview.width = img.width;
    preview.height = img.height;
    preview.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    filterButtons.forEach((b) => b.classList.toggle('active', b.dataset.id === edit.filter));
  }

  async function persist() {
    const updated = { ...page, ...edit };
    const assets = await buildPageAssets(updated, { originalCanvas: original });
    page = await db.updatePage(id, { ...edit, ...assets });
  }

  async function save() {
    showLoading('Saving…');
    try {
      await persist();
      toast('Page saved', 'success');
      navigate(`/doc/${page.docId}`);
    } catch (e) {
      console.error(e);
      toast(`Save failed: ${e.message}`, 'error');
    } finally {
      hideLoading();
    }
  }

  async function applyAll() {
    if (!(await confirmDialog('Apply to all pages?', `Use the “${FILTERS.find((f) => f.id === edit.filter).label}” filter and current brightness/contrast on every page of this document.`, { okText: 'Apply' }))) return;
    const set = showLoading('Applying…');
    try {
      const pages = await db.getPages(doc.pageIds);
      for (let i = 0; i < pages.length; i++) {
        set(`Applying ${i + 1}/${pages.length}…`);
        const p = pages[i];
        const patch = { filter: edit.filter, brightness: edit.brightness, contrast: edit.contrast };
        if (p.id === id) patch.rotation = edit.rotation;
        const assets = await buildPageAssets({ ...p, ...patch }, p.id === id ? { originalCanvas: original } : {});
        await db.updatePage(p.id, { ...patch, ...assets });
      }
      toast('Applied to all pages', 'success');
      navigate(`/doc/${page.docId}`);
    } finally {
      hideLoading();
    }
  }

  // swipe/keyboard navigation between pages
  const goTo = async (delta) => {
    const next = doc.pageIds[pageIndex + delta];
    if (!next) return;
    if (dirty()) await persist();
    navigate(`/page/${next}`, { replace: true });
  };
  const onKey = (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight') goTo(1);
    if (e.key === 'ArrowLeft') goTo(-1);
  };
  document.addEventListener('keydown', onKey);
  let touchX = null;
  stageEl.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  stageEl.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 80) goTo(dx < 0 ? 1 : -1);
  });

  setPanel(activePanel);
  update();
  return () => document.removeEventListener('keydown', onKey);
}
