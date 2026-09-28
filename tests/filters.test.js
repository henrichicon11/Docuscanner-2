import { describe, it, expect } from 'vitest';
import { applyFilter, grayscale, blackWhite, adjust, invert, FILTERS } from '../src/core/filters.js';

const img = (w, h, f) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
};

describe('filters', () => {
  it('grayscale makes channels equal', () => {
    const out = grayscale(img(2, 2, () => [200, 100, 50, 255]));
    expect(out.data[0]).toBe(out.data[1]);
    expect(out.data[1]).toBe(out.data[2]);
  });
  it('blackWhite yields only 0/255 and keeps dark text dark', () => {
    // white page with a dark stripe in the middle
    const src = img(60, 60, (x) => (x >= 28 && x <= 31 ? [30, 30, 30, 255] : [220, 220, 220, 255]));
    const out = blackWhite(src);
    const vals = new Set();
    for (let i = 0; i < out.data.length; i += 4) vals.add(out.data[i]);
    expect([...vals].every((v) => v === 0 || v === 255)).toBe(true);
    expect(out.data[(30 * 60 + 30) * 4]).toBe(0);
    expect(out.data[(30 * 60 + 5) * 4]).toBe(255);
  });
  it('adjust brightness increases values', () => {
    const out = adjust(img(1, 1, () => [100, 100, 100, 255]), { brightness: 20 });
    expect(out.data[0]).toBeGreaterThan(100);
  });
  it('invert', () => {
    expect(invert(img(1, 1, () => [0, 10, 255, 255])).data.slice(0, 3)).toEqual(new Uint8ClampedArray([255, 245, 0]));
  });
  it('every filter id runs and preserves size, without mutating input', () => {
    const src = img(20, 20, (x, y) => [x * 10, y * 10, 128, 255]);
    const copy = new Uint8ClampedArray(src.data);
    for (const f of FILTERS) {
      const out = applyFilter(src, f.id, { brightness: 5, contrast: 5 });
      expect(out.width).toBe(20);
      expect(out.data.length).toBe(src.data.length);
    }
    expect(src.data).toEqual(copy);
  });
});

import { magicColor } from '../src/core/filters.js';
describe('magicColor', () => {
  it('neutralizes a yellow paper cast and keeps ink dark', () => {
    const src = img(80, 80, (x) => (x >= 38 && x <= 41 ? [40, 38, 30, 255] : [236, 230, 190, 255]));
    const out = magicColor(src);
    const i = (40 * 80 + 10) * 4;
    expect(out.data[i]).toBeGreaterThan(245);
    expect(out.data[i + 2]).toBeGreaterThan(245); // blue channel lifted -> no yellow cast
    expect(out.data[(40 * 80 + 40) * 4]).toBeLessThan(90);
  });
});
