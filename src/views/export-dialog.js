/**
 * Export & share dialog:
 *  - PDF (fit / A4 / Letter / Legal, margins, quality, optional password protection, page range)
 *  - JPEG / PNG images (single file or ZIP of all pages)
 *  - Plain text (OCR results)
 *  - Web Share API integration (falls back to download), print
 */
import { h, modal, toast, showLoading, hideLoading, formatBytes } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { state } from '../state.js';
import { layoutPage, safeFilename, parseRange, PAGE_SIZES } from '../core/pdf-layout.js';
import { createZip } from '../core/zip.js';
import { decodeImage, drawableToCanvas, canvasToBlob } from '../core/image.js';

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function shareOrDownload(blob, filename, share) {
  if (share) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return 'shared';
      } catch (e) {
        if (e.name === 'AbortError') return 'cancelled';
      }
    } else {
      toast('Sharing not supported on this device — downloading instead');
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

const blobToDataURL = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** Re-encode a page image at the requested JPEG quality. */
async function encodePage(page, quality, type = 'image/jpeg') {
  if (type === 'image/jpeg' && quality >= 0.9) return page.processed;
  const bmp = await decodeImage(page.processed);
  const c = drawableToCanvas(bmp, 4000);
  return canvasToBlob(c, type, quality);
}

async function imageSize(blob) {
  const bmp = await decodeImage(blob);
  const size = { w: bmp.width || bmp.naturalWidth, h: bmp.height || bmp.naturalHeight };
  bmp.close?.();
  return size;
}

export async function buildPdf(doc, pages, { size = 'fit', margin = 0, quality = 0.85, password = '' } = {}, onProgress) {
  const { jsPDF } = await import('jspdf');
  let pdf = null;
  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i, pages.length);
    const blob = await encodePage(pages[i], quality);
    const { w, h: hgt } = await imageSize(blob);
    const L = layoutPage(w, hgt, size, margin);
    if (!pdf) {
      const opts = { orientation: L.orientation, unit: 'pt', format: [L.pageW, L.pageH], compress: true };
      if (password) opts.encryption = { userPassword: password, ownerPassword: password, userPermissions: ['print', 'copy'] };
      pdf = new jsPDF(opts);
    } else {
      pdf.addPage([L.pageW, L.pageH], L.orientation);
    }
    const dataUrl = await blobToDataURL(blob);
    pdf.addImage(dataUrl, 'JPEG', L.x, L.y, L.w, L.h, undefined, 'FAST');
    // Invisible OCR text layer makes the PDF searchable
    if (pages[i].ocrText && !password) {
      pdf.setFontSize(1);
      pdf.setTextColor(255, 255, 255);
      pdf.text(pages[i].ocrText.replace(/[^\x20-\x7E\n]/g, ' ').slice(0, 20000), L.x + 1, L.y + 2, { maxWidth: L.w, renderingMode: 'invisible' });
    }
  }
  pdf.setProperties({ title: doc.name, creator: 'DocuScanner', subject: 'Scanned document' });
  return pdf.output('blob');
}

async function buildImages(doc, pages, { format = 'jpeg', quality = 0.9 }, onProgress) {
  const type = format === 'png' ? 'image/png' : 'image/jpeg';
  const ext = format === 'png' ? 'png' : 'jpg';
  const base = safeFilename(doc.name);
  if (pages.length === 1) {
    return { blob: await encodePage(pages[0], quality, type), filename: `${base}.${ext}` };
  }
  const files = [];
  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i, pages.length);
    const b = await encodePage(pages[i], quality, type);
    files.push({ name: `${base}_page_${String(i + 1).padStart(2, '0')}.${ext}`, data: new Uint8Array(await b.arrayBuffer()) });
  }
  return { blob: new Blob([createZip(files)], { type: 'application/zip' }), filename: `${base}.zip` };
}

async function printDoc(pages) {
  const urls = pages.map((p) => URL.createObjectURL(p.processed));
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  const d = frame.contentDocument;
  d.open();
  d.write(`<!doctype html><html><head><title>Print</title><style>@page{margin:0}body{margin:0}img{width:100%;page-break-after:always;display:block}</style></head><body>${urls.map((u) => `<img src="${u}">`).join('')}</body></html>`);
  d.close();
  await Promise.all([...d.images].map((img) => img.decode().catch(() => {})));
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => { frame.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); }, 60000);
}

export function openExport(doc, pages) {
  if (!pages.length) {
    toast('This document has no pages', 'error');
    return Promise.resolve();
  }
  const opts = {
    format: 'pdf',
    size: state.settings.pdfPageSize || 'fit',
    margin: 0,
    quality: state.settings.pdfQuality || 0.85,
    password: '',
    range: '',
  };
  const approxSize = pages.reduce((s, p) => s + (p.processed?.size || 0), 0);

  return modal((close) => {
    const body = h('div');
    const seg = (items, key, onchange) => {
      const wrap = h('div.seg');
      items.forEach(([v, label]) => {
        const b = h(`button${opts[key] === v ? '.active' : ''}`, { type: 'button', onclick: () => { opts[key] = v; [...wrap.children].forEach((c) => c.classList.toggle('active', c === b)); onchange?.(); } }, label);
        wrap.appendChild(b);
      });
      return wrap;
    };
    const pdfOpts = h('div', {},
      h('label', {}, 'Page size'),
      seg([['fit', 'Fit'], ...Object.entries(PAGE_SIZES).map(([k, v]) => [k, v.label])], 'size', drawMargin),
      h('div.margin-row', {}, h('label', {}, 'Margins'), seg([[0, 'None'], [18, 'Small'], [36, 'Normal']], 'margin')),
      h('label', {}, 'Password (optional)'),
      h('input', { type: 'password', placeholder: 'Protect PDF with a password', autocomplete: 'new-password', oninput: (e) => { opts.password = e.target.value; } }));
    const marginRow = pdfOpts.querySelector('.margin-row');
    function drawMargin() { marginRow.classList.toggle('hidden', opts.size === 'fit'); }
    drawMargin();

    const qualityOut = h('span', {}, `${Math.round(opts.quality * 100)}%`);
    const qualityRow = h('div', {},
      h('label', {}, 'Quality'),
      h('div.slider-row', { style: { gridTemplateColumns: '1fr 48px' } },
        h('input', { type: 'range', min: 0.4, max: 1, step: 0.05, value: opts.quality, oninput: (e) => { opts.quality = Number(e.target.value); qualityOut.textContent = `${Math.round(opts.quality * 100)}%`; } }),
        qualityOut));

    const rangeRow = pages.length > 1 ? h('div', {},
      h('label', {}, `Pages (1–${pages.length}, e.g. 1-3,5; empty = all)`),
      h('input', { type: 'text', placeholder: 'All pages', oninput: (e) => { opts.range = e.target.value; } })) : null;

    const drawFormat = () => {
      pdfOpts.classList.toggle('hidden', opts.format !== 'pdf');
      qualityRow.classList.toggle('hidden', opts.format === 'png' || opts.format === 'txt');
    };

    const run = async (share) => {
      const selected = parseRange(opts.range, pages.length).map((i) => pages[i]);
      if (!selected.length) { toast('No pages in range', 'error'); return; }
      const set = showLoading('Preparing…');
      const progress = (i, n) => set(`Processing page ${i + 1} of ${n}…`);
      try {
        let blob;
        let filename;
        const base = safeFilename(doc.name);
        if (opts.format === 'pdf') {
          blob = await buildPdf(doc, selected, opts, progress);
          filename = `${base}.pdf`;
        } else if (opts.format === 'txt') {
          const text = selected.map((p, i) => `--- Page ${i + 1} ---\n${p.ocrText || '(no text recognized — run OCR on this page first)'}`).join('\n\n');
          blob = new Blob([text], { type: 'text/plain' });
          filename = `${base}.txt`;
        } else {
          ({ blob, filename } = await buildImages(doc, selected, opts, progress));
        }
        hideLoading();
        const res = await shareOrDownload(blob, filename, share);
        if (res !== 'cancelled') toast(`${res === 'shared' ? 'Shared' : 'Saved'} ${filename} (${formatBytes(blob.size)})`, 'success');
        close(true);
      } catch (e) {
        console.error(e);
        toast(`Export failed: ${e.message}`, 'error');
      } finally {
        hideLoading();
      }
    };

    body.append(...[
      h('h2', {}, 'Export & share'),
      h('p', {}, `${doc.name} · ${pages.length} page${pages.length > 1 ? 's' : ''} · ~${formatBytes(approxSize)}`),
      h('label', {}, 'Format'),
      seg([['pdf', 'PDF'], ['jpeg', 'JPEG'], ['png', 'PNG'], ['txt', 'Text']], 'format', drawFormat),
      pdfOpts, qualityRow, rangeRow,
      h('div.actions', { style: { flexWrap: 'wrap' } },
        h('button.btn.ghost', { onclick: () => { close(false); printDoc(pages); } }, h('span', { html: icons.pdf }), 'Print'),
        h('button.btn', { onclick: () => run(true) }, h('span', { html: icons.share }), 'Share'),
        h('button.btn.primary', { onclick: () => run(false) }, h('span', { html: icons.download }), 'Download')),
    ].filter(Boolean));
    drawFormat();
    return body;
  });
}
