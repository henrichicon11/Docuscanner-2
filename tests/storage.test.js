import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import * as db from '../src/core/storage.js';

beforeEach(() => db._setIndexedDB(new IDBFactory()));

describe('storage', () => {
  it('creates, lists, renames and deletes documents', async () => {
    const a = await db.createDocument('Alpha');
    await new Promise((r) => setTimeout(r, 2));
    const b = await db.createDocument();
    expect(b.name).toMatch(/^Scan \d{4}-\d{2}-\d{2}/);
    let list = await db.listDocuments();
    expect(list.map((d) => d.id)).toEqual([b.id, a.id]);
    await db.updateDocument(a.id, { name: 'Renamed' });
    expect((await db.getDocument(a.id)).name).toBe('Renamed');
    await db.deleteDocument(a.id);
    list = await db.listDocuments();
    expect(list.length).toBe(1);
  });

  it('adds, reorders and deletes pages', async () => {
    const d = await db.createDocument('Doc');
    const p1 = await db.addPage(d.id, { width: 1 });
    const p2 = await db.addPage(d.id, { width: 2 });
    const p0 = await db.addPage(d.id, { width: 0 }, 0);
    expect((await db.getDocument(d.id)).pageIds).toEqual([p0.id, p1.id, p2.id]);
    await db.reorderPages(d.id, 0, 2);
    expect((await db.getDocument(d.id)).pageIds).toEqual([p1.id, p2.id, p0.id]);
    await db.updatePage(p1.id, { filter: 'bw' });
    expect((await db.getPage(p1.id)).filter).toBe('bw');
    await db.deletePage(p2.id);
    expect((await db.getDocument(d.id)).pageIds).toEqual([p1.id, p0.id]);
    await db.deleteDocument(d.id);
    expect(await db.getPage(p1.id)).toBeUndefined();
  });

  it('duplicates and merges documents', async () => {
    const a = await db.createDocument('A');
    await db.addPage(a.id, { width: 1 });
    const b = await db.createDocument('B');
    await db.addPage(b.id, { width: 2 });
    await db.addPage(b.id, { width: 3 });
    const dup = await db.duplicateDocument(a.id);
    expect(dup.name).toBe('A (copy)');
    expect(dup.pageIds.length).toBe(1);
    const m = await db.mergeDocuments([a.id, b.id], 'AB');
    const pages = await db.getPages(m.pageIds);
    expect(pages.map((p) => p.width)).toEqual([1, 2, 3]);
    expect(pages.every((p) => p.docId === m.id)).toBe(true);
  });

  it('settings default and persist', async () => {
    expect((await db.getSettings()).theme).toBe('system');
    await db.setSetting('theme', 'dark');
    expect((await db.getSettings()).theme).toBe('dark');
  });
});
