import { describe, it, expect } from 'vitest';
import {
  orderCorners,
  computeHomography,
  applyHomography,
  warpPerspective,
  estimateOutputSize,
  polygonArea,
  isConvexQuad,
  rotate90,
  defaultCorners,
} from '../src/core/geometry.js';

const makeImg = (w, h, fill = () => [0, 0, 0, 255]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) data.set(fill(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
};

describe('orderCorners', () => {
  it('orders shuffled points as tl, tr, br, bl', () => {
    const pts = [
      { x: 90, y: 95 },
      { x: 10, y: 5 },
      { x: 5, y: 100 },
      { x: 100, y: 0 },
    ];
    const o = orderCorners(pts);
    expect(o).toEqual([
      { x: 10, y: 5 },
      { x: 100, y: 0 },
      { x: 90, y: 95 },
      { x: 5, y: 100 },
    ]);
  });
  it('throws on wrong count', () => {
    expect(() => orderCorners([{ x: 0, y: 0 }])).toThrow();
  });
});

describe('homography', () => {
  it('maps source corners to destination corners', () => {
    const src = [
      { x: 10, y: 20 },
      { x: 200, y: 30 },
      { x: 220, y: 300 },
      { x: 5, y: 280 },
    ];
    const dst = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 150 },
      { x: 0, y: 150 },
    ];
    const H = computeHomography(src, dst);
    src.forEach((p, i) => {
      const q = applyHomography(H, p);
      expect(q.x).toBeCloseTo(dst[i].x, 6);
      expect(q.y).toBeCloseTo(dst[i].y, 6);
    });
  });
});

describe('warpPerspective', () => {
  it('extracts a sub-rectangle exactly (identity-like mapping)', () => {
    const img = makeImg(20, 20, (x, y) => [x * 10, y * 10, 0, 255]);
    const corners = [
      { x: 5, y: 5 },
      { x: 14, y: 5 },
      { x: 14, y: 14 },
      { x: 5, y: 14 },
    ];
    const out = warpPerspective(img, corners, 10, 10);
    expect(out.width).toBe(10);
    expect(out.data[0]).toBe(50); // x=5
    expect(out.data[1]).toBe(50); // y=5
    const last = (9 * 10 + 9) * 4;
    expect(out.data[last]).toBe(140);
    expect(out.data[last + 1]).toBe(140);
  });
});

describe('helpers', () => {
  it('estimateOutputSize respects max dimension', () => {
    const c = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 2000 },
      { x: 0, y: 2000 },
    ];
    const s = estimateOutputSize(c, 1000);
    expect(s).toEqual({ width: 1000, height: 500 });
  });
  it('polygonArea and convexity', () => {
    const sq = defaultCorners(100, 100, 0);
    expect(polygonArea(sq)).toBe(10000);
    expect(isConvexQuad(sq)).toBe(true);
    const bow = [sq[0], sq[2], sq[1], sq[3]];
    expect(isConvexQuad(bow)).toBe(false);
  });
  it('rotate90 swaps dimensions and moves pixels', () => {
    const img = makeImg(3, 2, (x, y) => [x, y, 0, 255]);
    const r = rotate90(img, 1);
    expect(r.width).toBe(2);
    expect(r.height).toBe(3);
    // original top-left (0,0) goes to top-right (1,0)
    expect(r.data[(0 * 2 + 1) * 4]).toBe(0);
    // original (2,0) goes to (1,2)
    expect(r.data[(2 * 2 + 1) * 4]).toBe(2);
    const back = rotate90(rotate90(rotate90(r, 1), 1), 1);
    expect(Array.from(back.data)).toEqual(Array.from(img.data));
  });
});
