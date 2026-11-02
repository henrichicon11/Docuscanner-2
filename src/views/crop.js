/**
 * Crop view: adjust the four document corners of each pending capture.
 *  - drag corners (with magnifier loupe) or edge midpoints (moves an entire side)
 *  - auto-detect again / reset to full image
 *  - rotate original, discard capture, navigate between batch captures
 */
import { h, iconBtn, toast, confirmDialog } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import { detectDocument } from '../core/detect.js';
import { canvasToImageData, canvasToBlob, createCanvas } from '../core/image.js';
import { defaultCorners, isConvexQuad, orderCorners } from '../core/geometry.js';
import { savePending } from './capture-helpers.js';

export async function render(root) {
  if (!state.pending.length) {
    navigate('/', { replace: true });
    return;
  }
  let index = 0;
  let dragging = null; // { type: 'corner'|'edge', i }
  let view = { scale: 1, ox: 0, oy: 0 };

  const canvas = h('canvas.frame');
  const loupe = h('canvas.magnifier.hidden', { width: 110, height: 110 });
  const stage = h('div.stage', {}, canvas, loupe);
  const title = h('h1', {}, '');
  const counter = h('span', { style: { minWidth: '60px', textAlign: 'center' } });

  const back = async () => {
    if (state.pending.length && !(await confirmDialog('Discard captures?', 'Unsaved captures will be lost.', { okText: 'Discard', danger: true }))) return;
    const docId = state.target.docId;
    state.pending = [];
    navigate(docId ? `/doc/${docId}` : '/');
  };

  const header = h('header.appbar.dark', {},
    iconBtn('back', 'Back', back),
    title,
    iconBtn('auto', 'Auto-detect edges', autoDetect),
    iconBtn('expand', 'Use full image', fullImage),
    iconBtn('rotate', 'Rotate image', rotateOriginal),
    iconBtn('trash', 'Discard this capture', discard));

  const prevBtn = iconBtn('back', 'Previous capture', () => go(-1), { style: { color: '#fff' } });
  const nextBtn = iconBtn('back', 'Next capture', () => go(1), { style: { color: '#fff', transform: 'rotate(180deg)' } });
  const addMore = h('button.btn', { onclick: () => navigate('/camera?keep=1') }, h('span', { html: icons.camera }), 'Add');
  const done = h('button.btn.primary', { onclick: finish }, h('span', { html: icons.check }), 'Done');

  root.append(h('div.dark-view', {}, header, stage,
    h('div.bottom-bar', {}, addMore, h('div', { style: { display: 'flex', alignItems: 'center' } }, prevBtn, counter, nextBtn), done)));

  if (state.target.replacePageId) addMore.classList.add('hidden');

  const cur = () => state.pending[index];

  function layout() {
    const p = cur();
    const r = stage.getBoundingClientRect();
    const pad = 28;
    const scale = Math.min((r.width - pad * 2) / p.width, (r.height - pad * 2) / p.height);
    canvas.width = Math.round(p.width * scale);
    canvas.height = Math.round(p.height * scale);
    view = { scale, ox: canvas.offsetLeft, oy: canvas.offsetTop };
    draw();
  }

  function draw() {
    const p = cur();
    const ctx = canvas.getContext('2d');
    const s = view.scale;
    ctx.drawImage(p.canvas, 0, 0, canvas.width, canvas.height);
    const c = p.corners.map((q) => ({ x: q.x * s, y: q.y * s }));
    // dim outside
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    c.slice().reverse().forEach((q, i) => ctx[i ? 'lineTo' : 'moveTo'](q.x, q.y));
    ctx.closePath();
    ctx.fill('evenodd');
    ctx.restore();
    const valid = isConvexQuad(p.corners);
    ctx.strokeStyle = valid ? '#3b82f6' : '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    c.forEach((q, i) => ctx[i ? 'lineTo' : 'moveTo'](q.x, q.y));
    ctx.closePath();
    ctx.stroke();
    // edge handles
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4];
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(ang);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      roundRect(ctx, -14, -5, 28, 10, 5);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // corner handles
    for (const q of c) {
      ctx.beginPath();
      ctx.arc(q.x, q.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = valid ? '#3b82f6' : '#ef4444';
      ctx.stroke();
    }
    title.textContent = p.detected ? 'Adjust edges' : 'Drag corners to the document edges';
    counter.textContent = `${index + 1} / ${state.pending.length}`;
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === state.pending.length - 1;
    done.disabled = !state.pending.every((q) => isConvexQuad(q.corners));
  }

  function roundRect(ctx, x, y, w, hh, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + hh, r);
    ctx.arcTo(x + w, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const toImg = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / view.scale, y: (e.clientY - r.top) / view.scale };
  };

  function hitTest(pt) {
    const p = cur();
    const tol = 28 / view.scale;
    let best = null;
    let bd = tol;
    p.corners.forEach((c, i) => {
      const d = Math.hypot(c.x - pt.x, c.y - pt.y);
      if (d < bd) { bd = d; best = { type: 'corner', i }; }
    });
    if (best) return best;
    for (let i = 0; i < 4; i++) {
      const a = p.corners[i], b = p.corners[(i + 1) % 4];
      const d = Math.hypot((a.x + b.x) / 2 - pt.x, (a.y + b.y) / 2 - pt.y);
      if (d < bd) { bd = d; best = { type: 'edge', i }; }
    }
    return best;
  }

  const clampPt = (q) => ({ x: Math.max(0, Math.min(cur().width - 1, q.x)), y: Math.max(0, Math.min(cur().height - 1, q.y)) });

  let lastPt = null;
  canvas.addEventListener('pointerdown', (e) => {
    const pt = toImg(e);
    dragging = hitTest(pt);
    if (!dragging) return;
    lastPt = pt;
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    showLoupe(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) {
      canvas.style.cursor = hitTest(toImg(e)) ? 'grab' : 'default';
      return;
    }
    const pt = toImg(e);
    const p = cur();
    if (dragging.type === 'corner') {
      p.corners[dragging.i] = clampPt(pt);
    } else {
      const dx = pt.x - lastPt.x;
      const dy = pt.y - lastPt.y;
      const i = dragging.i;
      const j = (i + 1) % 4;
      p.corners[i] = clampPt({ x: p.corners[i].x + dx, y: p.corners[i].y + dy });
      p.corners[j] = clampPt({ x: p.corners[j].x + dx, y: p.corners[j].y + dy });
    }
    lastPt = pt;
    draw();
    showLoupe(e);
  });
  const end = () => {
    if (!dragging) return;
    dragging = null;
    loupe.classList.add('hidden');
    draw();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  function showLoupe(e) {
    if (!dragging || dragging.type !== 'corner') { loupe.classList.add('hidden'); return; }
    const p = cur();
    const c = p.corners[dragging.i];
    const zoom = 2.5;
    const size = 110;
    const src = size / zoom / view.scale;
    const ctx = loupe.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(p.canvas, c.x - src / 2, c.y - src / 2, src, src, 0, 0, size, size);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size);
    ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2);
    ctx.stroke();
    const sr = stage.getBoundingClientRect();
    let lx = e.clientX - sr.left - size / 2;
    let ly = e.clientY - sr.top - size - 40;
    if (ly < 4) ly = e.clientY - sr.top + 40;
    lx = Math.max(4, Math.min(sr.width - size - 4, lx));
    loupe.style.left = `${lx}px`;
    loupe.style.top = `${ly}px`;
    loupe.classList.remove('hidden');
  }

  function autoDetect() {
    const p = cur();
    const res = detectDocument(canvasToImageData(p.canvas));
    if (res) {
      p.corners = res.corners;
      p.detected = true;
      toast('Edges detected');
    } else toast('No document found — adjust manually', 'error');
    draw();
  }

  function fullImage() {
    const p = cur();
    p.corners = defaultCorners(p.width, p.height, 0);
    draw();
  }

  async function rotateOriginal() {
    const p = cur();
    const c = createCanvas(p.height, p.width);
    const ctx = c.getContext('2d');
    ctx.translate(p.height, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(p.canvas, 0, 0);
    const H = p.height;
    // rotate corners clockwise: (x,y) -> (H - y, x)
    p.corners = orderCorners(p.corners.map((q) => ({ x: H - q.y, y: q.x })));
    p.canvas = c;
    p.width = c.width;
    p.height = c.height;
    p.blob = await canvasToBlob(c, 'image/jpeg', 0.92);
    layout();
  }

  async function discard() {
    state.pending.splice(index, 1);
    if (!state.pending.length) {
      const docId = state.target.docId;
      navigate(docId ? `/doc/${docId}` : '/');
      return;
    }
    index = Math.min(index, state.pending.length - 1);
    layout();
  }

  function go(d) {
    index = Math.max(0, Math.min(state.pending.length - 1, index + d));
    layout();
  }

  async function finish() {
    for (const p of state.pending) p.corners = orderCorners(p.corners);
    try {
      const n = state.pending.length;
      const replaced = !!state.target.replacePageId;
      const docId = await savePending();
      toast(replaced ? 'Page updated' : `${n} page${n > 1 ? 's' : ''} saved`, 'success');
      navigate(`/doc/${docId}`, { replace: true });
    } catch (e) {
      console.error(e);
      toast(`Save failed: ${e.message}`, 'error');
    }
  }

  const ro = new ResizeObserver(() => layout());
  ro.observe(stage);
  requestAnimationFrame(layout);
  const onKey = (e) => {
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
  };
  document.addEventListener('keydown', onKey);
  return () => {
    ro.disconnect();
    document.removeEventListener('keydown', onKey);
  };
}
