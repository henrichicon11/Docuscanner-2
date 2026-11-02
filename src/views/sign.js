/**
 * Signature tool:
 *  - draw a signature (pressure-smoothed strokes, colour + pen width), saved for reuse
 *  - place it on the page, drag to move, handle to resize
 *  - signatures are stored per page as normalized boxes and burnt in on render
 */
import { h, iconBtn, toast, modal, showLoading, hideLoading, confirmDialog } from '../ui/dom.js';
import * as db from '../core/storage.js';
import { navigate } from '../router.js';
import { buildPageAssets, renderPage } from '../core/image.js';
import { uid } from '../core/storage.js';

const SIG_KEY = 'savedSignatures';
const COLORS = ['#111827', '#1d4ed8', '#b91c1c'];

async function loadSaved() {
  const s = await db.getSettings();
  return Array.isArray(s[SIG_KEY]) ? s[SIG_KEY] : [];
}
const saveSaved = (list) => db.setSetting(SIG_KEY, list);

/** Crop a canvas to its non-transparent bounding box. */
function trimCanvas(c) {
  const ctx = c.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Modal with a drawing pad. Resolves with { dataUrl, aspect } or null. */
function drawSignature() {
  return modal((close) => {
    let color = COLORS[0];
    let width = 3;
    let drawing = false;
    let last = null;
    let hasInk = false;
    const pad = h('canvas.sig-pad');
    const setup = () => {
      const r = pad.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      pad.width = Math.round(r.width * dpr);
      pad.height = Math.round(r.height * dpr);
      const ctx = pad.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    };
    requestAnimationFrame(setup);
    const pos = (e) => { const r = pad.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure || 0.5 }; };
    pad.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); pad.setPointerCapture(e.pointerId); e.preventDefault(); });
    pad.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = pos(e);
      const ctx = pad.getContext('2d');
      ctx.strokeStyle = color;
      ctx.lineWidth = width * (0.6 + p.p * 0.8);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      const mx = (last.x + p.x) / 2;
      const my = (last.y + p.y) / 2;
      ctx.quadraticCurveTo(last.x, last.y, mx, my);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
      hasInk = true;
    });
    const stop = () => { drawing = false; };
    pad.addEventListener('pointerup', stop);
    pad.addEventListener('pointercancel', stop);

    const dots = h('div.color-dots', {}, ...COLORS.map((c, i) => {
      const d = h(`button.color-dot${i === 0 ? '.active' : ''}`, { style: { background: c }, 'aria-label': `Color ${c}`, onclick: () => { color = c; [...dots.children].forEach((n) => n.classList.toggle('active', n === d)); } });
      return d;
    }));
    const widthSel = h('input', { type: 'range', min: 1, max: 8, step: 0.5, value: width, 'aria-label': 'Pen width', oninput: (e) => { width = Number(e.target.value); }, style: { maxWidth: '140px' } });

    return [
      h('h2', {}, 'Draw your signature'),
      pad,
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginTop: '10px' } }, dots, widthSel),
      h('div.actions', {},
        h('button.btn.ghost', { onclick: () => { pad.getContext('2d').clearRect(0, 0, pad.width, pad.height); hasInk = false; } }, 'Clear'),
        h('button.btn.ghost', { onclick: () => close(null) }, 'Cancel'),
        h('button.btn.primary', {
          onclick: () => {
            if (!hasInk) { toast('Please draw a signature first', 'error'); return; }
            const t = trimCanvas(pad);
            if (!t) { close(null); return; }
            close({ id: uid(), dataUrl: t.toDataURL('image/png'), aspect: t.width / t.height });
          },
        }, 'Save')),
    ];
  }).then((v) => v || null);
}

export async function render(root, { id }) {
  let page = await db.getPage(id);
  if (!page) { navigate('/', { replace: true }); return; }
  const imgUrl = URL.createObjectURL(page.processed);
  // placed signatures (normalized coordinates relative to the page image)
  const placed = (page.signatures || []).map((s) => ({ ...s }));
  let saved = await loadSaved();

  // Base image = page rendered WITHOUT signatures so existing ones can be moved/removed
  const base = h('img', { alt: 'Page', draggable: 'false', style: { maxWidth: '100%', maxHeight: 'calc(100vh - 280px)', display: 'block', background: '#fff', boxShadow: 'var(--shadow)' } });
  const placing = h('div.placing', {}, base);
  const list = h('div.sig-list');

  const header = h('header.appbar', {},
    iconBtn('back', 'Back', async () => {
      if (JSON.stringify(placed) !== JSON.stringify(page.signatures || []) &&
        !(await confirmDialog('Discard signatures?', 'Unsaved changes will be lost.', { okText: 'Discard', danger: true }))) return;
      navigate(`/page/${id}`);
    }),
    h('h1', {}, 'Sign'),
    h('button.btn.primary', { onclick: apply, style: { padding: '8px 14px' } }, 'Apply'));

  root.append(header,
    h('div.editor-stage', {}, placing),
    h('div', { style: { padding: '12px 14px calc(14px + env(safe-area-inset-bottom))', background: 'var(--surface)', borderTop: '1px solid var(--border)', display: 'grid', gap: '10px' } },
      h('div', { style: { fontSize: '0.85rem', color: 'var(--muted)' } }, 'Tap a saved signature to place it. Drag to move, use the corner handle to resize, double-click / double-tap to remove.'),
      h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
        h('button.btn', { onclick: newSignature }, '+ New signature'), list)));

  showLoading('Loading…');
  try {
    const clean = await renderPage({ ...page, signatures: [] }, { skipSignatures: true });
    base.src = clean.toDataURL('image/jpeg', 0.9);
    await base.decode();
  } catch {
    base.src = imgUrl;
  } finally {
    hideLoading();
  }

  function drawList() {
    list.innerHTML = '';
    saved.forEach((s) => {
      list.appendChild(h('div.sig-item', { title: 'Place signature', onclick: () => place(s) },
        h('img', { src: s.dataUrl, alt: 'Saved signature' }),
        h('button.del', { title: 'Delete saved signature', 'aria-label': 'Delete saved signature', onclick: async (e) => {
          e.stopPropagation();
          saved = saved.filter((x) => x.id !== s.id);
          await saveSaved(saved);
          drawList();
        } }, '×')));
    });
  }

  async function newSignature() {
    const s = await drawSignature();
    if (!s) return;
    saved = [s, ...saved].slice(0, 8);
    await saveSaved(saved);
    drawList();
    place(s);
  }

  function place(s) {
    const imgAspect = base.naturalWidth / base.naturalHeight || 0.75;
    const w = 0.35;
    const hgt = (w / s.aspect) * imgAspect;
    placed.push({ id: uid(), dataUrl: s.dataUrl, aspect: s.aspect, x: 0.55, y: Math.max(0, 0.82 - hgt), w, h: hgt });
    drawBoxes();
  }

  function drawBoxes() {
    placing.querySelectorAll('.sig-box').forEach((n) => n.remove());
    const W = base.clientWidth;
    const H = base.clientHeight;
    placed.forEach((s, idx) => {
      const handle = h('div.handle');
      const box = h('div.sig-box', { style: { left: `${s.x * W}px`, top: `${s.y * H}px`, width: `${s.w * W}px`, height: `${s.h * H}px` } },
        h('img', { src: s.dataUrl, alt: 'Signature' }), handle);
      let mode = null;
      let start = null;
      let lastTap = 0;
      box.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const now = Date.now();
        if (now - lastTap < 300) {
          placed.splice(idx, 1);
          drawBoxes();
          return;
        }
        lastTap = now;
        mode = e.target === handle ? 'resize' : 'move';
        start = { x: e.clientX, y: e.clientY, s: { ...s } };
        box.setPointerCapture(e.pointerId);
      });
      box.addEventListener('pointermove', (e) => {
        if (!mode) return;
        const dx = (e.clientX - start.x) / W;
        const dy = (e.clientY - start.y) / H;
        if (mode === 'move') {
          s.x = Math.max(0, Math.min(1 - s.w, start.s.x + dx));
          s.y = Math.max(0, Math.min(1 - s.h, start.s.y + dy));
        } else {
          const nw = Math.max(0.05, Math.min(1 - s.x, start.s.w + dx));
          s.w = nw;
          s.h = Math.min(1 - s.y, (nw / s.aspect) * (W / H));
        }
        Object.assign(box.style, { left: `${s.x * W}px`, top: `${s.y * H}px`, width: `${s.w * W}px`, height: `${s.h * H}px` });
      });
      const end = () => { mode = null; };
      box.addEventListener('pointerup', end);
      box.addEventListener('pointercancel', end);
      placing.appendChild(box);
    });
  }

  async function apply() {
    showLoading('Applying signature…');
    try {
      const signatures = placed.map(({ id: sid, dataUrl, aspect, x, y, w, h: hh }) => ({ id: sid, dataUrl, aspect, x, y, w, h: hh }));
      const assets = await buildPageAssets({ ...page, signatures });
      page = await db.updatePage(id, { signatures, ...assets });
      toast('Signature applied', 'success');
      navigate(`/doc/${page.docId}`);
    } catch (e) {
      console.error(e);
      toast(`Failed: ${e.message}`, 'error');
    } finally {
      hideLoading();
    }
  }

  drawList();
  drawBoxes();
  const ro = new ResizeObserver(drawBoxes);
  ro.observe(base);
  if (!saved.length) setTimeout(newSignature, 200);
  return () => { ro.disconnect(); URL.revokeObjectURL(imgUrl); };
}
