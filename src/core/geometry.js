/**
 * Geometry utilities for document scanning:
 *  - corner ordering
 *  - homography (projective transform) computation
 *  - perspective warp with bilinear sampling
 *
 * Images are handled as ImageData-like objects: { width, height, data: Uint8ClampedArray (RGBA) }
 * so that everything here is testable without a DOM.
 */

/** @typedef {{x:number, y:number}} Point */

export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Orders 4 points as [topLeft, topRight, bottomRight, bottomLeft].
 * @param {Point[]} pts
 * @returns {Point[]}
 */
export function orderCorners(pts) {
  if (!pts || pts.length !== 4) throw new Error('orderCorners requires exactly 4 points');
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  // sort by angle around centroid, starting from top-left quadrant (clockwise in screen coords)
  const sorted = [...pts].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );
  // find the point with smallest x+y -> top-left
  let tlIdx = 0;
  for (let i = 1; i < 4; i++) {
    if (sorted[i].x + sorted[i].y < sorted[tlIdx].x + sorted[tlIdx].y) tlIdx = i;
  }
  const out = [];
  for (let i = 0; i < 4; i++) out.push({ ...sorted[(tlIdx + i) % 4] });
  return out;
}

/** Shoelace polygon area (absolute). */
export function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** True if the quadrilateral is convex (and non-degenerate). */
export function isConvexQuad(pts) {
  if (pts.length !== 4) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const c = pts[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Estimate output size (width, height) of the rectified document from its corners.
 * @param {Point[]} c ordered corners [tl, tr, br, bl]
 */
export function estimateOutputSize(c, maxDim = 2480) {
  const w = Math.max(distance(c[0], c[1]), distance(c[3], c[2]));
  const h = Math.max(distance(c[0], c[3]), distance(c[1], c[2]));
  let width = Math.max(1, Math.round(w));
  let height = Math.max(1, Math.round(h));
  const scale = Math.min(1, maxDim / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));
  return { width, height };
}

/**
 * Solve linear system A x = b by Gaussian elimination with partial pivoting.
 * @param {number[][]} A n x n
 * @param {number[]} b n
 */
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) throw new Error('Singular matrix');
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Compute homography H (3x3, row-major array of 9) mapping src[i] -> dst[i].
 * @param {Point[]} src 4 points
 * @param {Point[]} dst 4 points
 */
export function computeHomography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  return [...h, 1];
}

/** Apply homography to a point. */
export function applyHomography(H, p) {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return {
    x: (H[0] * p.x + H[1] * p.y + H[2]) / w,
    y: (H[3] * p.x + H[4] * p.y + H[5]) / w,
  };
}

/**
 * Perspective-warp the quadrilateral `corners` of `src` into a rectangle of outW x outH.
 * @param {{width:number,height:number,data:Uint8ClampedArray}} src
 * @param {Point[]} corners ordered [tl, tr, br, bl] in src pixel coordinates
 * @param {number} outW
 * @param {number} outH
 * @returns {{width:number,height:number,data:Uint8ClampedArray}}
 */
export function warpPerspective(src, corners, outW, outH) {
  const dstRect = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ];
  // map destination pixels back into source (inverse mapping)
  const H = computeHomography(dstRect, corners);
  const out = new Uint8ClampedArray(outW * outH * 4);
  const sw = src.width;
  const sh = src.height;
  const sd = src.data;
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = H;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const w = h6 * x + h7 * y + h8;
      let sx = (h0 * x + h1 * y + h2) / w;
      let sy = (h3 * x + h4 * y + h5) / w;
      if (sx < 0) sx = 0;
      else if (sx > sw - 1) sx = sw - 1;
      if (sy < 0) sy = 0;
      else if (sy > sh - 1) sy = sh - 1;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, sw - 1);
      const y1 = Math.min(y0 + 1, sh - 1);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const o = (y * outW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx;
        const bot = sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx;
        out[o + c] = top * (1 - fy) + bot * fy;
      }
    }
  }
  return { width: outW, height: outH, data: out };
}

/**
 * Rotate ImageData-like by multiples of 90 degrees (clockwise).
 */
export function rotate90(img, turns = 1) {
  const t = ((turns % 4) + 4) % 4;
  if (t === 0) return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const { width: w, height: h, data } = img;
  const nw = t % 2 === 0 ? w : h;
  const nh = t % 2 === 0 ? h : w;
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx, ny;
      if (t === 1) { nx = h - 1 - y; ny = x; }
      else if (t === 2) { nx = w - 1 - x; ny = h - 1 - y; }
      else { nx = y; ny = w - 1 - x; }
      const si = (y * w + x) * 4;
      const di = (ny * nw + nx) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = data[si + 3];
    }
  }
  return { width: nw, height: nh, data: out };
}

/** Default corners: a small inset of the full image. */
export function defaultCorners(width, height, inset = 0.05) {
  const dx = width * inset;
  const dy = height * inset;
  return [
    { x: dx, y: dy },
    { x: width - dx, y: dy },
    { x: width - dx, y: height - dy },
    { x: dx, y: height - dy },
  ];
}
