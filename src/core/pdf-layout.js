/** Pure layout helpers for PDF export (units: PDF points, 1pt = 1/72 inch). */

export const PAGE_SIZES = {
  a4: { w: 595.28, h: 841.89, label: 'A4' },
  letter: { w: 612, h: 792, label: 'US Letter' },
  legal: { w: 612, h: 1008, label: 'US Legal' },
};

/**
 * Compute page size and image placement.
 * @param {number} imgW image width (px)
 * @param {number} imgH image height (px)
 * @param {'fit'|'a4'|'letter'|'legal'} size
 * @param {number} margin margin in points (ignored for 'fit')
 * @returns {{pageW:number,pageH:number,orientation:'p'|'l',x:number,y:number,w:number,h:number}}
 */
export function layoutPage(imgW, imgH, size = 'fit', margin = 0) {
  if (size === 'fit' || !PAGE_SIZES[size]) {
    // 1px = 0.75pt at 96dpi; scale so the longer side is ~A4 height for sane physical size
    const longest = Math.max(imgW, imgH);
    const s = 841.89 / longest;
    const pageW = imgW * s;
    const pageH = imgH * s;
    return { pageW, pageH, orientation: pageW > pageH ? 'l' : 'p', x: 0, y: 0, w: pageW, h: pageH };
  }
  const base = PAGE_SIZES[size];
  const landscape = imgW > imgH;
  const pageW = landscape ? base.h : base.w;
  const pageH = landscape ? base.w : base.h;
  const availW = Math.max(1, pageW - margin * 2);
  const availH = Math.max(1, pageH - margin * 2);
  const s = Math.min(availW / imgW, availH / imgH);
  const w = imgW * s;
  const h = imgH * s;
  return { pageW, pageH, orientation: landscape ? 'l' : 'p', x: (pageW - w) / 2, y: (pageH - h) / 2, w, h };
}

/** Make a string safe for use as a filename. */
export function safeFilename(name, fallback = 'document') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

/** Parse a page range like "1-3,5" into sorted zero-based indices (empty = all). */
export function parseRange(str, count) {
  if (!str || !str.trim()) return [...Array(count).keys()];
  const out = new Set();
  for (const part of str.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) continue;
    let a = Number(m[1]);
    let b = m[2] ? Number(m[2]) : a;
    if (a > b) [a, b] = [b, a];
    for (let i = Math.max(1, a); i <= Math.min(count, b); i++) out.add(i - 1);
  }
  return [...out].sort((x, y) => x - y);
}
