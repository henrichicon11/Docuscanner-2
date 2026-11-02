/**
 * Image enhancement filters for scanned documents.
 * All filters take an ImageData-like {width,height,data} and return a NEW object.
 */

export const FILTERS = [
  { id: 'original', label: 'Original' },
  { id: 'magic', label: 'Magic Color' },
  { id: 'grayscale', label: 'Grayscale' },
  { id: 'bw', label: 'B&W' },
  { id: 'lighten', label: 'Lighten' },
  { id: 'photo', label: 'Photo' },
];

const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const clone = (img) => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });
const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

export function grayscale(img) {
  const out = clone(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = lum(d, i);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  return out;
}

/**
 * Brightness in [-100,100], contrast in [-100,100], saturation in [-100,100].
 */
export function adjust(img, { brightness = 0, contrast = 0, saturation = 0 } = {}) {
  const out = clone(img);
  const d = out.data;
  const b = brightness * 2.55;
  const c = (contrast + 100) / 100;
  const cf = c * c;
  const s = 1 + saturation / 100;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], bl = d[i + 2];
    if (s !== 1) {
      const l = 0.299 * r + 0.587 * g + 0.114 * bl;
      r = l + (r - l) * s;
      g = l + (g - l) * s;
      bl = l + (bl - l) * s;
    }
    d[i] = clamp((r + b - 128) * cf + 128);
    d[i + 1] = clamp((g + b - 128) * cf + 128);
    d[i + 2] = clamp((bl + b - 128) * cf + 128);
  }
  return out;
}

/** Summed area table on a single-channel Float64 buffer. */
function integral(values, w, h) {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += values[y * w + x];
      sat[(y + 1) * (w + 1) + (x + 1)] = sat[y * (w + 1) + (x + 1)] + row;
    }
  }
  return sat;
}

function boxMean(sat, w, h, x, y, r) {
  const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r);
  const x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
  const W = w + 1;
  const sum = sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0];
  return sum / ((x1 - x0) * (y1 - y0));
}

/**
 * Adaptive (Sauvola-like / Bradley) threshold → crisp black & white text.
 * @param {number} strength 0..100 — higher = more aggressive (darker)
 */
export function blackWhite(img, { strength = 50 } = {}) {
  const { width: w, height: h } = img;
  const g = new Float64Array(w * h);
  for (let i = 0, p = 0; p < g.length; i += 4, p++) g[p] = lum(img.data, i);
  const sat = integral(g, w, h);
  const r = Math.max(4, Math.round(Math.min(w, h) / 30));
  const t = 0.05 + (strength / 100) * 0.2; // 5%..25% below local mean
  const out = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  const d = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const mean = boxMean(sat, w, h, x, y, r);
      const v = g[p] < mean * (1 - t) ? 0 : 255;
      const i = p * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  return out;
}

/**
 * Estimate the paper background of one channel: block-wise maximum on a coarse grid
 * (ignores ink), dilated and blurred, then bilinearly upsampled.
 * Returns a function (x, y) -> background value.
 */
export function estimateBackground(src, w, h, channel, cells = 48) {
  const bs = Math.max(4, Math.ceil(Math.max(w, h) / cells));
  const gw = Math.ceil(w / bs);
  const gh = Math.ceil(h / bs);
  let grid = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      // use a high percentile (~90th) instead of the absolute max to resist noise
      const vals = [];
      for (let y = gy * bs; y < Math.min(h, (gy + 1) * bs); y += 2)
        for (let x = gx * bs; x < Math.min(w, (gx + 1) * bs); x += 2) vals.push(src[(y * w + x) * 4 + channel]);
      vals.sort((p, q) => p - q);
      grid[gy * gw + gx] = vals[Math.floor(vals.length * 0.9)] || 255;
    }
  }
  // dilate (3x3 max) to cover blocks fully filled with ink, then 3x3 blur twice
  const pass = (fn) => {
    const out = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const nb = [];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.min(gw - 1, Math.max(0, x + dx));
            const yy = Math.min(gh - 1, Math.max(0, y + dy));
            nb.push(grid[yy * gw + xx]);
          }
        out[y * gw + x] = fn(nb);
      }
    grid = out;
  };
  pass((nb) => Math.max(...nb));
  const mean = (nb) => nb.reduce((t, v) => t + v, 0) / nb.length;
  pass(mean);
  pass(mean);
  return (x, y) => {
    const fx = Math.min(gw - 1, Math.max(0, x / bs - 0.5));
    const fy = Math.min(gh - 1, Math.max(0, y / bs - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const top = grid[y0 * gw + x0] * (1 - tx) + grid[y0 * gw + x1] * tx;
    const bot = grid[y1 * gw + x0] * (1 - tx) + grid[y1 * gw + x1] * tx;
    return top * (1 - ty) + bot * ty;
  };
}

/**
 * "Magic color": flattens uneven illumination and removes colour casts by dividing
 * each channel by its estimated paper background (a local white balance), then boosts
 * ink contrast and adds a little saturation. Result: neutral white paper, vivid ink.
 */
export function magicColor(img, { strength = 50 } = {}) {
  const { width: w, height: h, data: src } = img;
  const bgs = [0, 1, 2].map((c) => estimateBackground(src, w, h, c));
  const out = clone(img);
  const d = out.data;
  const gain = 1 + strength / 100;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const bg = Math.max(30, bgs[c](x, y));
        let v = (src[i + c] / bg) * 255;
        v = 255 - (255 - v) * gain; // push paper to white, deepen ink
        d[i + c] = clamp(v);
      }
    }
  }
  return adjust(out, { saturation: 20 });
}

export function lighten(img) {
  return adjust(img, { brightness: 18, contrast: 12 });
}

export function photo(img) {
  return adjust(img, { contrast: 10, saturation: 15 });
}

/** Invert colours. */
export function invert(img) {
  const out = clone(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
  return out;
}

/**
 * Apply a named filter followed by manual adjustments.
 * @param {object} img ImageData-like
 * @param {string} filterId one of FILTERS ids
 * @param {{brightness?:number, contrast?:number, strength?:number}} opts
 */
export function applyFilter(img, filterId = 'original', opts = {}) {
  let out;
  switch (filterId) {
    case 'grayscale': out = grayscale(img); break;
    case 'bw': out = blackWhite(img, opts); break;
    case 'magic': out = magicColor(img, opts); break;
    case 'lighten': out = lighten(img); break;
    case 'photo': out = photo(img); break;
    default: out = clone(img);
  }
  if (opts.brightness || opts.contrast) {
    out = adjust(out, { brightness: opts.brightness || 0, contrast: opts.contrast || 0 });
  }
  return out;
}
