import { describe, it, expect } from 'vitest';
import { layoutPage, safeFilename } from '../src/core/pdf-layout.js';
import { createZip, crc32 } from '../src/core/zip.js';

describe('layoutPage', () => {
  it('fit mode matches image aspect', () => {
    const l = layoutPage(1000, 2000, 'fit');
    expect(l.pageW / l.pageH).toBeCloseTo(0.5, 5);
    expect(l.orientation).toBe('p');
    expect(l.w).toBe(l.pageW);
  });
  it('A4 with margins centers and fits image', () => {
    const l = layoutPage(1000, 1000, 'a4', 36);
    expect(l.pageW).toBeCloseTo(595.28);
    expect(l.w).toBeCloseTo(595.28 - 72);
    expect(l.x).toBeCloseTo(36);
    expect(l.y).toBeCloseTo((841.89 - l.h) / 2);
  });
  it('landscape image gets landscape page', () => {
    const l = layoutPage(3000, 2000, 'letter');
    expect(l.orientation).toBe('l');
    expect(l.pageW).toBe(792);
  });
});

describe('safeFilename', () => {
  it('strips illegal characters', () => {
    expect(safeFilename('a/b:c*?"<>|d')).toBe('a_b_c_d');
    expect(safeFilename('   ')).toBe('document');
  });
});

describe('zip', () => {
  it('crc32 of "hello"', () => {
    expect(crc32(new TextEncoder().encode('hello')).toString(16)).toBe('3610a686');
  });
  it('creates a structurally valid archive', () => {
    const files = [
      { name: 'a.txt', data: new TextEncoder().encode('hello') },
      { name: 'b.txt', data: new TextEncoder().encode('world!') },
    ];
    const z = createZip(files);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const eocd = z.length - 22;
    expect(v.getUint32(eocd, true)).toBe(0x06054b50);
    expect(v.getUint16(eocd + 10, true)).toBe(2);
    const cdOffset = v.getUint32(eocd + 16, true);
    expect(v.getUint32(cdOffset, true)).toBe(0x02014b50);
    expect(z.length).toBe(30 + 5 + 5 + 30 + 5 + 6 + 46 + 5 + 46 + 5 + 22);
  });
});

import { parseRange } from '../src/core/pdf-layout.js';
describe('parseRange', () => {
  it('parses ranges and clamps', () => {
    expect(parseRange('', 3)).toEqual([0, 1, 2]);
    expect(parseRange('1-3,5', 10)).toEqual([0, 1, 2, 4]);
    expect(parseRange('4-2, 9, 2', 5)).toEqual([1, 2, 3]);
    expect(parseRange('abc', 5)).toEqual([]);
  });
});
