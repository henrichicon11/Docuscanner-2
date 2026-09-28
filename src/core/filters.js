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
 * "Magic color": flattens uneven illumination by dividing each channel by an
 * estimate of the local background (large box blur of luminance), then boosts contrast
 * and saturation. Result: white paper, vivid ink.
 */
export function magicColor(img, { strength = 50 } = {}) {
  const { width: w, height: h } = img;
  const g = new Float64Array(w * h);
  for (let i = 0, p = 0; p < g.length; i += 4, p++) g[p] = lum(img.data, i);
  const sat = integral(g, w, h);
  const r = Math.max(8, Math.round(Math.min(w, h) / 12));
  const out = clone(img);
  const d = out.data;
  const gain = 1 + strength / 100;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const bg = Math.max(30, boxMean(sat, w, h, x, y, r));
      const k = 245 / bg;
      const i = p * 4;
      for (let c = 0; c < 3; c++) {
        let v = d[i + c] * k;
        // S-curve contrast around paper white
        v = 255 - (255 - v) * gain;
        d[i + c] = clamp(v);
      }
    }
  }
  return adjust(out, { saturation: 25 });
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
