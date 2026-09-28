/**
 * OCR view: recognize text on a page with Tesseract.js (loaded lazily).
 * Text is editable, can be copied / shared / downloaded, and is stored with the page
 * (used for library full-text search and the searchable PDF text layer).
 */
import { h, iconBtn, toast, showLoading, hideLoading } from '../ui/dom.js';
import * as db from '../core/storage.js';
import { navigate } from '../router.js';
import { state, updateSetting } from '../state.js';
import { downloadBlob } from './export-dialog.js';
import { isNative, nativeShare } from '../native.js';
import { safeFilename } from '../core/pdf-layout.js';

export const OCR_LANGUAGES = [
  ['eng', 'English'], ['spa', 'Spanish'], ['fra', 'French'], ['deu', 'German'], ['ita', 'Italian'],
  ['por', 'Portuguese'], ['nld', 'Dutch'], ['pol', 'Polish'], ['tur', 'Turkish'], ['rus', 'Russian'],
  ['ukr', 'Ukrainian'], ['ara', 'Arabic'], ['hin', 'Hindi'], ['chi_sim', 'Chinese (Simplified)'],
  ['chi_tra', 'Chinese (Traditional)'], ['jpn', 'Japanese'], ['kor', 'Korean'], ['vie', 'Vietnamese'],
  ['ind', 'Indonesian'], ['tha', 'Thai'],
];

let workerPromise = null;
let workerLang = null;
let progressCb = null;

async function getWorker(lang) {
  if (workerPromise && workerLang === lang) return workerPromise;
  if (workerPromise) (await workerPromise).terminate();
  workerLang = lang;
  workerPromise = (async () => {
    const { createWorker } = await import('tesseract.js');
    return createWorker(lang, 1, {
      logger: (m) => progressCb?.(m),
    });
  })();
  try {
    return await workerPromise;
  } catch (e) {
    workerPromise = null;
    throw e;
  }
}

export async function recognizeBlob(blob, lang, onProgress) {
  progressCb = onProgress;
  const worker = await getWorker(lang);
  const { data } = await worker.recognize(blob);
  progressCb = null;
  return { text: (data.text || '').trim(), confidence: data.confidence };
}

export async function render(root, { id }) {
  let page = await db.getPage(id);
  if (!page) { navigate('/', { replace: true }); return; }
  const doc = await db.getDocument(page.docId);
  const idx = doc.pageIds.indexOf(id);
  let lang = state.settings.ocrLanguage || 'eng';

  const textarea = h('textarea', { placeholder: 'Recognized text will appear here. You can edit it before saving.', value: page.ocrText || '', spellcheck: 'true' });
  const bar = h('div');
  const progress = h('div.progress.hidden', {}, bar);
  const status = h('div', { style: { color: 'var(--muted)', fontSize: '0.85rem' } }, page.ocrText ? 'Saved text loaded.' : 'Tap “Recognize” to extract text from this page.');
  const langSel = h('select.select', { 'aria-label': 'OCR language', onchange: (e) => { lang = e.target.value; updateSetting('ocrLanguage', lang); } },
    ...OCR_LANGUAGES.map(([v, l]) => h('option', { value: v, selected: v === lang }, l)));

  const header = h('header.appbar', {},
    iconBtn('back', 'Back', () => navigate(`/doc/${page.docId}`)),
    h('h1', {}, `Text · Page ${idx + 1}`),
    iconBtn('copy', 'Copy text', copy),
    iconBtn('download', 'Download .txt', () => downloadBlob(new Blob([textarea.value], { type: 'text/plain' }), `${safeFilename(doc.name)}_page_${idx + 1}.txt`)),
    iconBtn('share', 'Share text', share),
    h('button.btn.primary', { onclick: save, style: { padding: '8px 14px' } }, 'Save'));

  const img = h('img', { src: URL.createObjectURL(page.processed), alt: 'Page preview', style: { maxHeight: '180px', maxWidth: '100%', objectFit: 'contain', borderRadius: '8px', boxShadow: 'var(--shadow)', alignSelf: 'center', background: '#fff' } });

  root.append(header, h('div.ocr-wrap', {},
    img,
    h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
      langSel,
      h('button.btn.primary', { onclick: () => run([page]) }, 'Recognize'),
      doc.pageIds.length > 1 && h('button.btn', { onclick: runAll }, 'Recognize all pages')),
    progress, status, textarea));

  function onProgress(m) {
    progress.classList.remove('hidden');
    const pct = Math.round((m.progress || 0) * 100);
    bar.style.width = `${pct}%`;
    const labels = { 'loading tesseract core': 'Loading OCR engine', 'loading language traineddata': 'Downloading language data', 'initializing api': 'Initializing', 'recognizing text': 'Recognizing text' };
    status.textContent = `${labels[m.status] || m.status}… ${pct}%`;
  }

  async function run(list) {
    try {
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const res = await recognizeBlob(p.processed, lang, (m) => {
          onProgress(m);
          if (list.length > 1) status.textContent = `Page ${i + 1}/${list.length}: ${status.textContent}`;
        });
        if (p.id === id) {
          textarea.value = res.text;
          page = await db.updatePage(id, { ocrText: res.text });
        } else {
          await db.updatePage(p.id, { ocrText: res.text });
        }
        status.textContent = res.text
          ? `Done · confidence ${Math.round(res.confidence)}%${list.length > 1 ? ` · ${i + 1}/${list.length} pages` : ''}`
          : 'No text found on this page.';
      }
      if (list.length > 1) toast(`Text extracted from ${list.length} pages`, 'success');
    } catch (e) {
      console.error(e);
      status.textContent = `OCR failed: ${e.message || e}. An internet connection is required the first time to download the language data.`;
      toast('OCR failed', 'error');
    } finally {
      progress.classList.add('hidden');
    }
  }

  async function runAll() {
    const pages = await db.getPages(doc.pageIds);
    await run(pages);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(textarea.value);
      toast('Copied to clipboard', 'success');
    } catch {
      textarea.select();
      document.execCommand('copy');
      toast('Copied');
    }
  }

  async function share() {
    if (isNative()) {
      try { await nativeShare({ title: doc.name, text: textarea.value }); } catch (e) { toast(`Share failed: ${e.message || e}`, 'error'); }
    } else if (navigator.share) {
      try { await navigator.share({ title: doc.name, text: textarea.value }); } catch { /* cancelled */ }
    } else copy();
  }

  async function save() {
    showLoading('Saving…');
    try {
      page = await db.updatePage(id, { ocrText: textarea.value });
      toast('Text saved', 'success');
    } finally {
      hideLoading();
    }
  }

  return () => URL.revokeObjectURL(img.src);
}
