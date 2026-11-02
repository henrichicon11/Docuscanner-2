/**
 * Browser-side image pipeline: decoding, canvas conversion, and full page rendering
 * (perspective crop -> filter -> rotate -> signatures) from the stored original.
 */
import { warpPerspective, estimateOutputSize, rotate90, orderCorners, defaultCorners } from './geometry.js';
import { applyFilter } from './filters.js';
import { detectDocument } from './detect.js';

export const MAX_ORIGINAL_SIDE = 3000;
export const MAX_OUTPUT_SIDE = 2480; // ~A4 @ 300dpi
export const THUMB_SIDE = 360;

export function createCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Decode a Blob/File into an ImageBitmap-like drawable, respecting EXIF orientation. */
export async function decodeImage(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      /* fall back to <img> */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Draw a drawable into a canvas limited to maxSide. */
export function drawableToCanvas(src, maxSide = MAX_ORIGINAL_SIDE) {
  const sw = src.videoWidth || src.naturalWidth || src.width;
  const sh = src.videoHeight || src.naturalHeight || src.height;
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}

export const canvasToImageData = (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);

export function imageDataToCanvas(img) {
  const c = createCanvas(img.width, img.height);
  const id = img instanceof ImageData ? img : new ImageData(img.data, img.width, img.height);
  c.getContext('2d').putImageData(id, 0, 0);
  return c;
}

export function canvasToBlob(c, type = 'image/jpeg', quality = 0.9) {
  if (c.convertToBlob) return c.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), type, quality));
}

export function scaleCanvas(c, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(c.width, c.height));
  if (scale === 1) return c;
  const out = createCanvas(Math.round(c.width * scale), Math.round(c.height * scale));
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, out.width, out.height);
  return out;
}

export async function makeThumb(canvas) {
  return canvasToBlob(scaleCanvas(canvas, THUMB_SIDE), 'image/jpeg', 0.8);
}

/**
 * Prepare a captured/imported image: normalise size, run auto-detection.
 * @returns {{ blob: Blob, width:number, height:number, corners, detected:boolean, canvas }}
 */
export async function prepareCapture(source, { autoDetect = true } = {}) {
  const drawable = source instanceof Blob ? await decodeImage(source) : source;
  const canvas = drawableToCanvas(drawable, MAX_ORIGINAL_SIDE);
  drawable.close?.();
  let corners = defaultCorners(canvas.width, canvas.height, 0);
  let detected = false;
  if (autoDetect) {
    const res = detectDocument(canvasToImageData(canvas));
    if (res && res.confidence > 0.35) {
      corners = res.corners;
      detected = true;
    }
  }
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
  return { blob, width: canvas.width, height: canvas.height, corners, detected, canvas };
}

async function loadSignature(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return img;
}

/**
 * Render a page to a canvas.
 * @param {{original:Blob, corners, filter, brightness, contrast, rotation, signatures}} page
 * @param {{ originalCanvas?: HTMLCanvasElement, maxSide?: number, skipSignatures?: boolean }} opts
 */
export async function renderPage(page, opts = {}) {
  const src = opts.originalCanvas || drawableToCanvas(await decodeImage(page.original), MAX_ORIGINAL_SIDE);
  const srcData = canvasToImageData(src);
  const corners = orderCorners(page.corners || defaultCorners(src.width, src.height, 0));
  const { width, height } = estimateOutputSize(corners, opts.maxSide || MAX_OUTPUT_SIDE);
  let img = warpPerspective(srcData, corners, width, height);
  img = applyFilter(img, page.filter || 'original', {
    brightness: page.brightness || 0,
    contrast: page.contrast || 0,
  });
  const turns = Math.round((page.rotation || 0) / 90);
  if (turns % 4) img = rotate90(img, turns);
  const canvas = imageDataToCanvas(img);
  if (!opts.skipSignatures && page.signatures?.length) {
    const ctx = canvas.getContext('2d');
    for (const s of page.signatures) {
      const simg = await loadSignature(s.dataUrl);
      ctx.drawImage(simg, s.x * canvas.width, s.y * canvas.height, s.w * canvas.width, s.h * canvas.height);
    }
  }
  return canvas;
}

/** Render & encode the processed image and thumbnail for storage. */
export async function buildPageAssets(page, opts = {}) {
  const canvas = await renderPage(page, opts);
  const processed = await canvasToBlob(canvas, 'image/jpeg', 0.9);
  const thumb = await makeThumb(canvas);
  return { processed, thumb, outWidth: canvas.width, outHeight: canvas.height };
}
