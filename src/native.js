/**
 * Native (Capacitor / Android) helpers.
 *
 * Inside the Android app, `<a download>` for blob URLs and `navigator.share` with files
 * don't work in the WebView, so saving and sharing go through Capacitor plugins instead.
 * In a normal browser `isNative()` is false and callers use the web APIs.
 */
import { Capacitor } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

async function writeFile(blob, path, directory) {
  const { Filesystem } = await import('@capacitor/filesystem');
  const data = await blobToBase64(blob);
  const { uri } = await Filesystem.writeFile({ path, data, directory, recursive: true });
  return uri;
}

/** Share a file (blob + filename) or plain text through the Android share sheet. */
export async function nativeShare({ blob, filename, text, title }) {
  const { Share } = await import('@capacitor/share');
  try {
    if (blob) {
      const { Directory } = await import('@capacitor/filesystem');
      const uri = await writeFile(blob, `share/${filename}`, Directory.Cache);
      await Share.share({ title: title || filename, files: [uri], dialogTitle: 'Share' });
    } else {
      await Share.share({ title, text, dialogTitle: 'Share' });
    }
    return 'shared';
  } catch (e) {
    if (/cancel/i.test(e?.message || '')) return 'cancelled';
    throw e;
  }
}

/** Save a file to Documents/DocuScanner/, falling back to the share sheet if that fails. */
export async function nativeSave(blob, filename) {
  const { Directory } = await import('@capacitor/filesystem');
  try {
    await writeFile(blob, `DocuScanner/${filename}`, Directory.Documents);
    return 'downloaded';
  } catch (e) {
    console.warn('Saving to Documents failed, falling back to share', e);
    return nativeShare({ blob, filename });
  }
}
