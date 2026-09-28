/**
 * App-wide state that lives only for the session (not persisted):
 *  - settings cache (loaded from IndexedDB)
 *  - pending captures awaiting crop confirmation
 */
import { getSettings, setSetting, DEFAULT_SETTINGS } from './core/storage.js';

export const state = {
  settings: { ...DEFAULT_SETTINGS },
  /** @type {{blob:Blob, width:number, height:number, corners:{x:number,y:number}[], detected:boolean}[]} */
  pending: [],
  /** where confirmed captures go: { docId?: string, insertAt?: number, replacePageId?: string } */
  target: {},
};

export async function loadSettings() {
  try {
    state.settings = await getSettings();
  } catch (e) {
    console.warn('Settings unavailable', e);
  }
  applyTheme();
  return state.settings;
}

export async function updateSetting(key, value) {
  state.settings[key] = value;
  await setSetting(key, value);
  if (key === 'theme') applyTheme();
}

const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function applyTheme() {
  const t = state.settings.theme;
  const dark = t === 'dark' || (t === 'system' && mq?.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1120' : '#2563eb');
}
mq?.addEventListener?.('change', applyTheme);
