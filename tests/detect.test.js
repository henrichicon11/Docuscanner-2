import { describe, it, expect } from 'vitest';
import { detectDocument, otsuThreshold, convexHull, maxAreaQuad } from '../src/core/detect.js';

/** Draw a filled convex quad (white) on a dark, slightly noisy background. */
function synthScene(w, h, quad, { bg = 60, fg = 235, noise = 10 } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  const inside = (x, y) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i], b = quad[(i + 1) % 4];
      const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      const s = Math.sign(c);
      if (s === 0) continue;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
    return true;
  };
  let seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = (inside(x, y) ? fg : bg) + rnd() * noise;
      const i = (y * w + x) * 4;
      data[i] = v; data[i + 1] = v * 0.98; data[i + 2] = v * 0.95; data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

const maxErr = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));

describe('detectDocument', () => {
  it('finds an axis-aligned document', () => {
    const quad = [{ x: 100, y: 80 }, { x: 500, y: 80 }, { x: 500, y: 520 }, { x: 100, y: 520 }];
    const res = detectDocument(synthScene(640, 600, quad));
    expect(res).not.toBeNull();
    expect(maxErr(res.corners, quad)).toBeLessThan(12);
  });

  it('finds a rotated / perspective-distorted document', () => {
    const quad = [{ x: 180, y: 60 }, { x: 560, y: 140 }, { x: 470, y: 560 }, { x: 70, y: 470 }];
    const res = detectDocument(synthScene(640, 640, quad));
    expect(res).not.toBeNull();
    expect(maxErr(res.corners, quad)).toBeLessThan(14);
    expect(res.confidence).toBeGreaterThan(0.5);
  });

  it('returns null for a blank image', () => {
    const img = synthScene(300, 300, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], { noise: 0 });
    expect(detectDocument(img)).toBeNull();
  });
});

describe('helpers', () => {
  it('otsu separates bimodal data', () => {
    const vals = new Float32Array(200);
    for (let i = 0; i < 100; i++) vals[i] = 40;
    for (let i = 100; i < 200; i++) vals[i] = 210;
    const t = otsuThreshold(vals);
    expect(t).toBeGreaterThanOrEqual(40);
    expect(t).toBeLessThan(210);
  });
  it('hull + max quad of a square point cloud returns corners', () => {
    const pts = [];
    for (let x = 0; x <= 10; x++) for (let y = 0; y <= 10; y++) pts.push({ x, y });
    const hull = convexHull(pts);
    expect(hull.length).toBe(4);
    const q = maxAreaQuad(hull);
    expect(q.length).toBe(4);
  });
});
