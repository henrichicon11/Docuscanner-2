import { describe, it, expect } from 'vitest';
import { sortDocs, filterDocs } from '../src/core/search.js';

const docs = [
  { id: 'a', name: 'Invoice 10', createdAt: 1, updatedAt: 5, pageIds: [1], tags: ['work'], favorite: true },
  { id: 'b', name: 'Invoice 2', createdAt: 3, updatedAt: 4, pageIds: [1, 2, 3], tags: [] },
  { id: 'c', name: 'Receipt', createdAt: 2, updatedAt: 9, pageIds: [1, 2], tags: ['shopping'] },
];

describe('library sorting & filtering', () => {
  it('sorts', () => {
    expect(sortDocs(docs, 'updated').map((d) => d.id)).toEqual(['c', 'a', 'b']);
    expect(sortDocs(docs, 'name').map((d) => d.id)).toEqual(['b', 'a', 'c']);
    expect(sortDocs(docs, 'created').map((d) => d.id)).toEqual(['b', 'c', 'a']);
    expect(sortDocs(docs, 'pages').map((d) => d.id)).toEqual(['b', 'c', 'a']);
  });
  it('filters by query, favorites, tags and OCR text', () => {
    expect(filterDocs(docs, { query: 'invoice' }).length).toBe(2);
    expect(filterDocs(docs, { filter: 'favorites' }).map((d) => d.id)).toEqual(['a']);
    expect(filterDocs(docs, { filter: 'tag:shopping' }).map((d) => d.id)).toEqual(['c']);
    expect(filterDocs(docs, { query: 'total due', ocrIndex: { b: 'TOTAL DUE $40' } }).map((d) => d.id)).toEqual(['b']);
  });
});
