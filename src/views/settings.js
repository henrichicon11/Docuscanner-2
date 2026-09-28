/** Settings view: theme, scanning defaults, PDF defaults, OCR language, storage & data management. */
import { h, iconBtn, toast, confirmDialog, formatBytes } from '../ui/dom.js';
import { navigate } from '../router.js';
import { state, updateSetting } from '../state.js';
import { FILTERS } from '../core/filters.js';
import { PAGE_SIZES } from '../core/pdf-layout.js';
import { OCR_LANGUAGES } from './ocr.js';
import * as db from '../core/storage.js';
import { canInstall, promptInstall } from '../pwa.js';
import { isNative } from '../native.js';

export async function render(root) {
  const s = state.settings;

  const toggle = (key, label, hint) => h('div.setting', {},
    h('div.label', {}, label, hint && h('small', {}, hint)),
    h('label.switch', {}, h('input', { type: 'checkbox', checked: !!s[key], onchange: (e) => updateSetting(key, e.target.checked) }), h('span')));

  const select = (key, label, options, hint, cast = (v) => v) => h('div.setting', {},
    h('div.label', {}, label, hint && h('small', {}, hint)),
    h('select.select', { onchange: (e) => updateSetting(key, cast(e.target.value)) },
      ...options.map(([v, l]) => h('option', { value: v, selected: String(s[key]) === String(v) }, l))));

  const usage = h('small', {}, 'Calculating…');
  const docsCount = (await db.listDocuments()).length;
  db.storageEstimate().then((e) => {
    usage.textContent = e.quota ? `${formatBytes(e.usage)} used of ${formatBytes(e.quota)} available` : 'Storage estimate unavailable';
  });

  const installRow = h('div.setting', {},
    h('div.label', {}, 'Install app', h('small', {}, 'Add DocuScanner to your home screen for offline, full-screen use')),
    h('button.btn', { onclick: async () => { if (!(await promptInstall())) toast('Use your browser menu → “Install app” / “Add to Home Screen”'); } }, 'Install'));
  if (!canInstall()) installRow.querySelector('button').textContent = 'How to';

  root.append(
    h('header.appbar', {}, iconBtn('back', 'Back', () => navigate('/')), h('h1', {}, 'Settings')),
    h('div.settings', {},
      h('div.card', {},
        h('h3', {}, 'Appearance'),
        select('theme', 'Theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])),
      h('div.card', {},
        h('h3', {}, 'Scanning'),
        toggle('autoDetect', 'Automatic edge detection', 'Find document borders in captured and imported images'),
        toggle('autoCapture', 'Auto-capture', 'Take the photo automatically when the document is steady'),
        select('defaultFilter', 'Default filter', FILTERS.map((f) => [f.id, f.label]), 'Applied to new pages')),
      h('div.card', {},
        h('h3', {}, 'PDF export'),
        select('pdfPageSize', 'Default page size', [['fit', 'Fit to image'], ...Object.entries(PAGE_SIZES).map(([k, v]) => [k, v.label])]),
        select('pdfQuality', 'Default quality', [[0.6, 'Small file (60%)'], [0.75, 'Balanced (75%)'], [0.85, 'High (85%)'], [0.95, 'Maximum (95%)']], null, Number)),
      h('div.card', {},
        h('h3', {}, 'Text recognition'),
        select('ocrLanguage', 'OCR language', OCR_LANGUAGES, 'Language data is downloaded once and cached')),
      h('div.card', {},
        h('h3', {}, 'Storage'),
        h('div.setting', {}, h('div.label', {}, `${docsCount} document${docsCount === 1 ? '' : 's'}`, usage)),
        h('div.setting', {},
          h('div.label', {}, 'Delete all documents', h('small', {}, 'Removes every scan stored on this device')),
          h('button.btn.danger', { onclick: async () => {
            if (!(await confirmDialog('Delete everything?', 'All documents and pages will be permanently deleted from this device.', { okText: 'Delete all', danger: true }))) return;
            for (const d of await db.listDocuments()) await db.deleteDocument(d.id);
            toast('All documents deleted', 'success');
            navigate('/');
          } }, 'Delete'))),
      h('div.card', {},
        h('h3', {}, 'About'),
        !isNative() && installRow,
        h('div.setting', {}, h('div.label', {}, 'DocuScanner v1.0.0', h('small', {}, 'All processing happens on your device. Your documents never leave it unless you export or share them.'))))));
}
