/**
 * Automatic document boundary detection in pure JavaScript.
 *
 * Pipeline:
 *  1. Downscale to a working resolution and convert to grayscale
 *  2. Gaussian blur
 *  3. Build candidate foreground masks:
 *       a) Otsu threshold (bright paper on darker background)
 *       b) Edge-enclosed region (Sobel edges, dilated, flood filled from the border)
 *  4. Morphological closing, largest connected component
 *  5. Convex hull -> maximum-area inscribed quadrilateral
 *  6. Score candidates (rectangularity, size) and return the best quad in original coordinates
 *
 * Works on ImageData-like objects: { width, height, data }.
 */
import { orderCorners, polygonArea, isConvexQuad } from './geometry.js';

/** Convert RGBA ImageData-like to Float32 grayscale, downscaled so max side <= maxSide. */
export function toGrayscaleScaled(img, maxSide = 320) {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const gray = new Float32Array(w * h);
  const sx = img.width / w;
  const sy = img.height / h;
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      // box-average for anti-aliasing (sample at most 4x4)
      let sum = 0;
      let n = 0;
      const stepY = Math.max(1, Math.floor((y1 - y0) / 4));
      const stepX = Math.max(1, Math.floor((x1 - x0) / 4));
      for (let yy = y0; yy < y1 && yy < img.height; yy += stepY) {
        for (let xx = x0; xx < x1 && xx < img.width; xx += stepX) {
          const i = (yy * img.width + xx) * 4;
          sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          n++;
        }
      }
      gray[y * w + x] = n ? sum / n : 0;
    }
  }
  return { gray, width: w, height: h, scale };
}

/** Separable Gaussian blur (5-tap kernel). */
export function gaussianBlur(gray, w, h) {
  const k = [1, 4, 6, 4, 1];
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) {
        const xx = Math.min(w - 1, Math.max(0, x + i));
        s += gray[y * w + xx] * k[i + 2];
      }
      tmp[y * w + x] = s / 16;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) {
        const yy = Math.min(h - 1, Math.max(0, y + i));
        s += tmp[yy * w + x] * k[i + 2];
      }
      out[y * w + x] = s / 16;
    }
  }
  return out;
}

/** Otsu threshold on values in [0,255]. */
export function otsuThreshold(values) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < values.length; i++) hist[Math.max(0, Math.min(255, values[i] | 0))]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

/** Sobel gradient magnitude. */
export function sobel(gray, w, h) {
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] +
        gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
        gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      mag[i] = Math.hypot(gx, gy);
    }
  }
  return mag;
}

function dilate(mask, w, h, r = 1) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -r; dy <= r && !v; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && mask[yy * w + xx]) { v = 1; break; }
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

function erode(mask, w, h, r = 1) {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const d = dilate(inv, w, h, r);
  for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1;
  return d;
}

/** Largest 4-connected component of a binary mask. Returns {mask, area}. */
export function largestComponent(mask, w, h) {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let bestLabel = 0;
  let bestArea = 0;
  let label = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    label++;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;
    let area = 0;
    while (sp) {
      const i = stack[--sp];
      area++;
      const x = i % w;
      const y = (i / w) | 0;
      if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = label; stack[sp++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = label; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - w] && !labels[i - w]) { labels[i - w] = label; stack[sp++] = i - w; }
      if (y < h - 1 && mask[i + w] && !labels[i + w]) { labels[i + w] = label; stack[sp++] = i + w; }
    }
    if (area > bestArea) { bestArea = area; bestLabel = label; }
  }
  const out = new Uint8Array(w * h);
  if (bestLabel) for (let i = 0; i < labels.length; i++) out[i] = labels[i] === bestLabel ? 1 : 0;
  return { mask: out, area: bestArea };
}

/** Collect boundary pixels of a mask (pixels with a background 4-neighbour or at the border). */
function boundaryPoints(mask, w, h) {
  const pts = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
          !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) {
        pts.push({ x, y });
      }
    }
  }
  return pts;
}

/** Andrew's monotone chain convex hull. */
export function convexHull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

const triArea = (a, b, c) => Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;

/** Maximum-area quadrilateral whose vertices are points of the (convex) hull. O(n^3). */
export function maxAreaQuad(hull) {
  let pts = hull;
  // simplify very large hulls by uniform subsampling
  const MAX = 60;
  if (pts.length > MAX) {
    const step = pts.length / MAX;
    pts = Array.from({ length: MAX }, (_, i) => pts[Math.floor(i * step)]);
  }
  const n = pts.length;
  if (n < 4) return null;
  let best = -1;
  let quad = null;
  for (let i = 0; i < n; i++) {
    for (let k = i + 2; k < n; k++) {
      // j between i and k, l between k and i (wrapping)
      let bj = -1, bja = -1;
      for (let j = i + 1; j < k; j++) {
        const a = triArea(pts[i], pts[j], pts[k]);
        if (a > bja) { bja = a; bj = j; }
      }
      let bl = -1, bla = -1;
      for (let l = k + 1; l < n + i; l++) {
        const p = pts[l % n];
        const a = triArea(pts[i], pts[k], p);
        if (a > bla) { bla = a; bl = l % n; }
      }
      if (bj < 0 || bl < 0) continue;
      const area = bja + bla;
      if (area > best) {
        best = area;
        quad = [pts[i], pts[bj], pts[k], pts[bl]];
      }
    }
  }
  return quad;
}

function closeMask(mask, w, h, r) {
  return erode(dilate(mask, w, h, r), w, h, r);
}

/** Evaluate a candidate mask: returns {quad, score} or null. */
function evaluateMask(mask, w, h) {
  const { mask: comp, area } = largestComponent(mask, w, h);
  const total = w * h;
  if (area < total * 0.08 || area > total * 0.995) return null;
  const hull = convexHull(boundaryPoints(comp, w, h));
  if (hull.length < 4) return null;
  const quad = maxAreaQuad(hull);
  if (!quad) return null;
  const ordered = orderCorners(quad);
  if (!isConvexQuad(ordered)) return null;
  const qArea = polygonArea(ordered);
  const hullArea = polygonArea(hull);
  if (qArea < total * 0.08) return null;
  // rectangularity: how well the quad explains the component
  const fill = Math.min(area, qArea) / Math.max(area, qArea);
  const hullFit = qArea / Math.max(1, hullArea);
  const sizeBonus = Math.min(1, qArea / (total * 0.3));
  const fullFramePenalty = qArea > total * 0.97 ? 0.5 : 1;
  const score = fill * 0.5 + hullFit * 0.35 + sizeBonus * 0.15;
  return { quad: ordered, score: score * fullFramePenalty };
}

/**
 * Detect document corners.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} img
 * @returns {{corners: {x:number,y:number}[], confidence:number} | null}
 */
export function detectDocument(img, { maxSide = 320 } = {}) {
  const { gray, width: w, height: h, scale } = toGrayscaleScaled(img, maxSide);
  const blurred = gaussianBlur(gray, w, h);
  const candidates = [];

  // (a) Otsu brightness segmentation (document brighter than background)
  const thr = otsuThreshold(blurred);
  const bright = new Uint8Array(w * h);
  for (let i = 0; i < bright.length; i++) bright[i] = blurred[i] > thr ? 1 : 0;
  const r = Math.max(1, Math.round(Math.min(w, h) / 80));
  const c1 = evaluateMask(closeMask(bright, w, h, r), w, h);
  if (c1) candidates.push(c1);

  // (b) Edge-enclosed region: regions not reachable from the border through non-edge pixels
  const mag = sobel(blurred, w, h);
  const sortedMag = Float32Array.from(mag).sort();
  const edgeThr = Math.max(20, sortedMag[Math.floor(sortedMag.length * 0.9)]);
  let edges = new Uint8Array(w * h);
  for (let i = 0; i < mag.length; i++) edges[i] = mag[i] > edgeThr ? 1 : 0;
  edges = dilate(edges, w, h, r);
  const outside = new Uint8Array(w * h);
  const stack = [];
  const push = (i) => { if (!edges[i] && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  const inside = new Uint8Array(w * h);
  for (let i = 0; i < inside.length; i++) inside[i] = outside[i] ? 0 : 1;
  const c2 = evaluateMask(inside, w, h);
  if (c2) candidates.push({ ...c2, score: c2.score * 0.98 });

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const inv = 1 / scale;
  const corners = best.quad.map((p) => ({
    x: Math.min(img.width - 1, Math.max(0, (p.x + 0.5) * inv)),
    y: Math.min(img.height - 1, Math.max(0, (p.y + 0.5) * inv)),
  }));
  return { corners, confidence: Math.max(0, Math.min(1, best.score)) };
}
