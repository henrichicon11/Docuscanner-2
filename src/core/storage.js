/**
 * Persistent storage on top of IndexedDB.
 *
 * Stores:
 *  - documents: { id, name, createdAt, updatedAt, pageIds: string[], favorite, tags: string[] }
 *  - pages:     { id, docId, original: Blob, processed: Blob, thumb: Blob,
 *                 corners, filter, brightness, contrast, rotation, width, height,
 *                 ocrText, signatures: [] }
 *  - settings:  { key, value }
 */

const DB_NAME = 'docuscanner';
const DB_VERSION = 1;

let dbPromise = null;
let idbFactory = typeof indexedDB !== 'undefined' ? indexedDB : null;

/** Allows injecting a custom IndexedDB implementation (used in tests). */
export function _setIndexedDB(factory) {
  idbFactory = factory;
  dbPromise = null;
}

export const uid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function openDB() {
  if (dbPromise) return dbPromise;
  if (!idbFactory) return Promise.reject(new Error('IndexedDB is not available'));
  dbPromise = new Promise((resolve, reject) => {
    const req = idbFactory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('documents')) {
        const s = db.createObjectStore('documents', { keyPath: 'id' });
        s.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('pages')) {
        const s = db.createObjectStore('pages', { keyPath: 'id' });
        s.createIndex('docId', 'docId');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const promisify = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function tx(storeNames, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    const stores = Array.isArray(storeNames) ? storeNames.map((n) => t.objectStore(n)) : [t.objectStore(storeNames)];
    let result;
    Promise.resolve(fn(...stores)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

// ---------- Documents ----------

export async function listDocuments() {
  const docs = await tx('documents', 'readonly', (s) => promisify(s.getAll()));
  return docs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getDocument(id) {
  return tx('documents', 'readonly', (s) => promisify(s.get(id)));
}

export function defaultDocName(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `Scan ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}`;
}

export async function createDocument(name) {
  const now = Date.now();
  const doc = { id: uid(), name: name || defaultDocName(new Date(now)), createdAt: now, updatedAt: now, pageIds: [], favorite: false, tags: [] };
  await tx('documents', 'readwrite', (s) => promisify(s.put(doc)));
  return doc;
}

export async function updateDocument(id, patch) {
  return tx('documents', 'readwrite', async (s) => {
    const doc = await promisify(s.get(id));
    if (!doc) throw new Error(`Document ${id} not found`);
    const updated = { ...doc, ...patch, id, updatedAt: Date.now() };
    await promisify(s.put(updated));
    return updated;
  });
}

export async function deleteDocument(id) {
  return tx(['documents', 'pages'], 'readwrite', async (docs, pages) => {
    const doc = await promisify(docs.get(id));
    if (!doc) return;
    for (const pid of doc.pageIds) await promisify(pages.delete(pid));
    await promisify(docs.delete(id));
  });
}

/** Duplicates a document with all of its pages. */
export async function duplicateDocument(id) {
  const doc = await getDocument(id);
  if (!doc) throw new Error(`Document ${id} not found`);
  const copy = await createDocument(`${doc.name} (copy)`);
  const pages = await getPages(doc.pageIds);
  const newIds = [];
  for (const p of pages) {
    const np = { ...p, id: uid(), docId: copy.id };
    await tx('pages', 'readwrite', (s) => promisify(s.put(np)));
    newIds.push(np.id);
  }
  return updateDocument(copy.id, { pageIds: newIds, tags: [...(doc.tags || [])] });
}

/** Merge pages of `sourceIds` documents into a new document (sources are kept). */
export async function mergeDocuments(sourceIds, name) {
  const target = await createDocument(name || 'Merged document');
  const ids = [];
  for (const sid of sourceIds) {
    const d = await getDocument(sid);
    if (!d) continue;
    const pages = await getPages(d.pageIds);
    for (const p of pages) {
      const np = { ...p, id: uid(), docId: target.id };
      await tx('pages', 'readwrite', (s) => promisify(s.put(np)));
      ids.push(np.id);
    }
  }
  return updateDocument(target.id, { pageIds: ids });
}

// ---------- Pages ----------

export function getPage(id) {
  return tx('pages', 'readonly', (s) => promisify(s.get(id)));
}

export async function getPages(ids) {
  const all = await tx('pages', 'readonly', (s) => Promise.all(ids.map((id) => promisify(s.get(id)))));
  return all.filter(Boolean);
}

/** Adds a page to a document at `index` (default: end). */
export async function addPage(docId, pageData, index) {
  const page = {
    id: uid(),
    docId,
    filter: 'original',
    brightness: 0,
    contrast: 0,
    rotation: 0,
    ocrText: '',
    signatures: [],
    ...pageData,
  };
  await tx(['documents', 'pages'], 'readwrite', async (docs, pages) => {
    const doc = await promisify(docs.get(docId));
    if (!doc) throw new Error(`Document ${docId} not found`);
    await promisify(pages.put(page));
    const pageIds = [...doc.pageIds];
    if (index === undefined || index < 0 || index > pageIds.length) pageIds.push(page.id);
    else pageIds.splice(index, 0, page.id);
    await promisify(docs.put({ ...doc, pageIds, updatedAt: Date.now() }));
  });
  return page;
}

export async function updatePage(id, patch) {
  return tx(['pages', 'documents'], 'readwrite', async (pages, docs) => {
    const page = await promisify(pages.get(id));
    if (!page) throw new Error(`Page ${id} not found`);
    const updated = { ...page, ...patch, id };
    await promisify(pages.put(updated));
    const doc = await promisify(docs.get(page.docId));
    if (doc) await promisify(docs.put({ ...doc, updatedAt: Date.now() }));
    return updated;
  });
}

export async function deletePage(id) {
  return tx(['pages', 'documents'], 'readwrite', async (pages, docs) => {
    const page = await promisify(pages.get(id));
    if (!page) return;
    await promisify(pages.delete(id));
    const doc = await promisify(docs.get(page.docId));
    if (doc) {
      await promisify(docs.put({ ...doc, pageIds: doc.pageIds.filter((p) => p !== id), updatedAt: Date.now() }));
    }
  });
}

/** Move page from index `from` to index `to` within a document. */
export async function reorderPages(docId, from, to) {
  const doc = await getDocument(docId);
  if (!doc) throw new Error(`Document ${docId} not found`);
  const ids = [...doc.pageIds];
  if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return doc;
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  return updateDocument(docId, { pageIds: ids });
}

// ---------- Settings ----------

export const DEFAULT_SETTINGS = {
  theme: 'system', // 'light' | 'dark' | 'system'
  defaultFilter: 'magic',
  autoDetect: true,
  autoCapture: false,
  pdfPageSize: 'fit', // 'fit' | 'a4' | 'letter'
  pdfQuality: 0.85,
  ocrLanguage: 'eng',
};

export async function getSettings() {
  const rows = await tx('settings', 'readonly', (s) => promisify(s.getAll()));
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function setSetting(key, value) {
  return tx('settings', 'readwrite', (s) => promisify(s.put({ key, value })));
}

/** Rough storage usage estimate. */
export async function storageEstimate() {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
    return navigator.storage.estimate();
  }
  return { usage: 0, quota: 0 };
}
