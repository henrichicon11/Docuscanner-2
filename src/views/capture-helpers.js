/**
 * Shared capture pipeline used by the camera, file import and crop views.
 *
 *  images ──prepareCapture──► state.pending ──(crop view)──► savePending() ──► IndexedDB
 */
import { prepareCapture, buildPageAssets, drawableToCanvas, decodeImage } from '../core/image.js';
import * as db from '../core/storage.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import { showLoading, hideLoading, toast } from '../ui/dom.js';

/** Import image files: detect edges and open the crop view. */
export async function startImport(files, target = {}) {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!images.length) {
    toast('Please choose image files', 'error');
    return;
  }
  const set = showLoading(`Analyzing ${images.length} image${images.length > 1 ? 's' : ''}…`);
  try {
    state.pending = [];
    state.target = target;
    for (let i = 0; i < images.length; i++) {
      set(`Detecting edges ${i + 1}/${images.length}…`);
      state.pending.push(await prepareCapture(images[i], { autoDetect: state.settings.autoDetect }));
    }
  } catch (e) {
    console.error(e);
    toast(`Import failed: ${e.message}`, 'error');
    return;
  } finally {
    hideLoading();
  }
  navigate('/crop');
}

/**
 * Persist all pending captures into the target document (creating one if needed).
 * @returns {Promise<string>} document id
 */
export async function savePending() {
  const { pending, target } = state;
  if (!pending.length) throw new Error('Nothing to save');
  const set = showLoading('Saving pages…');
  try {
    let docId = target.docId;
    if (!docId) docId = (await db.createDocument()).id;

    if (target.replacePageId) {
      // Re-crop an existing page: keep its settings, replace the image + corners
      const p = pending[0];
      const page = await db.getPage(target.replacePageId);
      const updated = { ...page, original: p.blob, corners: p.corners, width: p.width, height: p.height };
      const assets = await buildPageAssets(updated, { originalCanvas: p.canvas || undefined });
      await db.updatePage(page.id, { ...updated, ...assets });
    } else {
      let insertAt = target.insertAt;
      for (let i = 0; i < pending.length; i++) {
        set(`Enhancing page ${i + 1}/${pending.length}…`);
        const p = pending[i];
        const page = {
          original: p.blob,
          width: p.width,
          height: p.height,
          corners: p.corners,
          filter: state.settings.defaultFilter || 'magic',
          brightness: 0,
          contrast: 0,
          rotation: 0,
        };
        const assets = await buildPageAssets(page, { originalCanvas: p.canvas || undefined });
        await db.addPage(docId, { ...page, ...assets }, insertAt);
        if (insertAt !== undefined) insertAt++;
      }
    }
    state.pending = [];
    state.target = {};
    return docId;
  } finally {
    hideLoading();
  }
}

/** Load the stored original of a page into state.pending for re-cropping. */
export async function recropPage(page) {
  const canvas = drawableToCanvas(await decodeImage(page.original));
  state.pending = [{ blob: page.original, width: canvas.width, height: canvas.height, corners: page.corners, detected: true, canvas }];
  state.target = { docId: page.docId, replacePageId: page.id };
  navigate('/crop');
}
