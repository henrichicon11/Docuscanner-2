/** PWA helpers: service worker registration and install prompt. */
import { toast } from './ui/dom.js';

let deferredPrompt = null;

export function initPWA() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    toast('DocuScanner installed', 'success');
  });
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          nw?.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('Update available — reload to get the latest version', 'info', 6000);
            }
          });
        });
      }).catch((e) => console.warn('SW registration failed', e));
    });
  }
  window.addEventListener('offline', () => toast('You are offline — scanning still works'));
}

export const canInstall = () => !!deferredPrompt;

export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  return outcome === 'accepted';
}
