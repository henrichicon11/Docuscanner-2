/**
 * Camera capture view.
 *  - live document edge detection overlay (runs ~6 fps on a downscaled frame)
 *  - auto-capture when the detected quad is stable
 *  - torch/flash toggle, front/back camera switch
 *  - single or batch mode, import from gallery
 */
import { h, iconBtn, toast } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { detectDocument } from '../core/detect.js';
import { prepareCapture } from '../core/image.js';
import { state, updateSetting } from '../state.js';
import { navigate } from '../router.js';
import { startImport } from './capture-helpers.js';

export async function render(root, _params, query) {
  const target = { ...state.target };
  if (query.doc) target.docId = query.doc;
  if (query.at !== undefined) target.insertAt = Number(query.at);
  state.target = target;
  if (!query.keep) state.pending = [];

  let stream = null;
  let facing = 'environment';
  let torch = false;
  let batch = query.batch !== '0';
  let running = true;
  let busy = false;
  let lastQuad = null;
  let stableSince = 0;
  let detectTimer = null;

  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  const overlay = h('canvas.overlay');
  const flash = h('div.flash');
  const hint = h('div.cam-hint', {}, 'Starting camera…');
  const stage = h('div.stage', {}, video, overlay, hint, flash);

  const autoBtn = iconBtn('auto', 'Auto-capture', () => {
    const v = !state.settings.autoCapture;
    updateSetting('autoCapture', v);
    autoBtn.classList.toggle('active', v);
    toast(`Auto-capture ${v ? 'on' : 'off'}`);
  });
  autoBtn.classList.toggle('active', !!state.settings.autoCapture);
  const torchBtn = iconBtn('flashOff', 'Flash', toggleTorch);
  torchBtn.classList.add('hidden');
  const switchBtn = iconBtn('switchCam', 'Switch camera', () => { facing = facing === 'environment' ? 'user' : 'environment'; start(); });

  const header = h('header.appbar.dark', {},
    iconBtn('close', 'Close camera', () => navigate(target.docId ? `/doc/${target.docId}` : '/')),
    h('h1', {}, 'Scan'),
    autoBtn, torchBtn, switchBtn);

  const thumb = h('button.cam-thumb', { title: 'Review captures', onclick: review });
  const fileInput = h('input.hidden', { type: 'file', accept: 'image/*', multiple: true, onchange: async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    stop();
    await startImport(files, target);
  } });
  const galleryBtn = h('button.icon-btn', { title: 'Import from gallery', 'aria-label': 'Import from gallery', html: icons.image, style: { color: '#fff', width: '54px', height: '54px' }, onclick: () => fileInput.click() });
  const shutter = h('button.shutter', { title: 'Capture', 'aria-label': 'Capture', onclick: () => capture() });

  const modeSingle = h('button.chip', { onclick: () => setMode(false) }, 'Single');
  const modeBatch = h('button.chip', { onclick: () => setMode(true) }, 'Batch');
  const setMode = (b) => {
    batch = b;
    modeSingle.classList.toggle('active', !b);
    modeBatch.classList.toggle('active', b);
  };
  setMode(batch);

  root.append(h('div.dark-view', {}, header, stage,
    h('div.cam-mode', {}, modeSingle, modeBatch),
    h('div.camera-controls', {}, galleryBtn, shutter, thumb), fileInput));
  updateThumb();

  function updateThumb() {
    const n = state.pending.length;
    thumb.innerHTML = '';
    thumb.style.visibility = n ? 'visible' : 'hidden';
    if (n) {
      const last = state.pending[n - 1];
      thumb.style.backgroundImage = `url(${last.canvas.toDataURL('image/jpeg', 0.5)})`;
      thumb.appendChild(h('span.count', {}, String(n)));
    }
  }

  async function start() {
    stop(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      hint.textContent = 'Camera not available — use the gallery button to import images.';
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      });
      if (!running) { stop(); return; }
      video.srcObject = stream;
      await video.play().catch(() => {});
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities?.() || {};
      torchBtn.classList.toggle('hidden', !caps.torch);
      hint.textContent = 'Point the camera at a document';
      scheduleDetect();
    } catch (e) {
      console.warn(e);
      hint.textContent = e.name === 'NotAllowedError'
        ? 'Camera permission denied — use the gallery button to import images.'
        : 'Could not start camera — use the gallery button to import images.';
    }
  }

  function stop(all = true) {
    clearTimeout(detectTimer);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    if (all) running = false;
  }

  async function toggleTorch() {
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    torch = !torch;
    try {
      await track.applyConstraints({ advanced: [{ torch }] });
      torchBtn.innerHTML = icons[torch ? 'flash' : 'flashOff'];
    } catch {
      toast('Flash not supported', 'error');
    }
  }

  // --- live detection ---
  const work = document.createElement('canvas');
  function scheduleDetect() {
    clearTimeout(detectTimer);
    if (!running || !stream) return;
    detectTimer = setTimeout(detectFrame, 160);
  }

  function detectFrame() {
    if (!running || !video.videoWidth) return scheduleDetect();
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const s = Math.min(1, 240 / Math.max(vw, vh));
    work.width = Math.round(vw * s);
    work.height = Math.round(vh * s);
    const ctx = work.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, work.width, work.height);
    const res = detectDocument(ctx.getImageData(0, 0, work.width, work.height), { maxSide: 240 });
    const quad = res && res.confidence > 0.45 ? res.corners.map((p) => ({ x: p.x / work.width, y: p.y / work.height })) : null;
    drawOverlay(quad);
    handleAutoCapture(quad);
    scheduleDetect();
  }

  function drawOverlay(quad) {
    const rect = video.getBoundingClientRect();
    const srect = stage.getBoundingClientRect();
    overlay.width = rect.width;
    overlay.height = rect.height;
    overlay.style.left = `${rect.left - srect.left}px`;
    overlay.style.top = `${rect.top - srect.top}px`;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!quad) return;
    ctx.beginPath();
    quad.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](p.x * rect.width, p.y * rect.height));
    ctx.closePath();
    ctx.fillStyle = 'rgba(37,99,235,0.22)';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();
  }

  function handleAutoCapture(quad) {
    if (!quad) {
      lastQuad = null;
      hint.textContent = 'Point the camera at a document';
      return;
    }
    const moved = lastQuad ? Math.max(...quad.map((p, i) => Math.hypot(p.x - lastQuad[i].x, p.y - lastQuad[i].y))) : 1;
    lastQuad = quad;
    if (moved > 0.02) stableSince = performance.now();
    if (!state.settings.autoCapture) {
      hint.textContent = 'Document detected';
      return;
    }
    const held = performance.now() - stableSince;
    hint.textContent = held > 400 ? 'Hold still…' : 'Document detected';
    if (held > 1300 && !busy) {
      stableSince = performance.now() + 1500; // cooldown
      capture();
    }
  }

  async function capture() {
    if (busy) return;
    if (!video.videoWidth) {
      fileInput.click();
      return;
    }
    busy = true;
    shutter.classList.add('busy');
    flash.classList.add('on');
    setTimeout(() => flash.classList.remove('on'), 120);
    try {
      const shot = await prepareCapture(video, { autoDetect: state.settings.autoDetect });
      state.pending.push(shot);
      navigator.vibrate?.(30);
      updateThumb();
      if (!batch) review();
    } catch (e) {
      console.error(e);
      toast('Capture failed', 'error');
    } finally {
      busy = false;
      shutter.classList.remove('busy');
    }
  }

  function review() {
    if (!state.pending.length) return;
    stop();
    navigate('/crop');
  }

  start();
  return () => stop();
}
