/** Pure helpers to sort and filter the document library. */

export function sortDocs(docs, sort) {
  const arr = [...docs];
  switch (sort) {
    case 'name': return arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    case 'created': return arr.sort((a, b) => b.createdAt - a.createdAt);
    case 'pages': return arr.sort((a, b) => b.pageIds.length - a.pageIds.length);
    default: return arr.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

export function filterDocs(docs, { query = '', filter = 'all', ocrIndex = {} } = {}) {
  const q = query.trim().toLowerCase();
  return docs.filter((d) => {
    if (filter === 'favorites' && !d.favorite) return false;
    if (filter.startsWith('tag:') && !(d.tags || []).includes(filter.slice(4))) return false;
    if (!q) return true;
    return d.name.toLowerCase().includes(q) ||
      (d.tags || []).some((t) => t.toLowerCase().includes(q)) ||
      (ocrIndex[d.id] || '').toLowerCase().includes(q);
  });
}
