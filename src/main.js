import './styles/main.css';
import { route, startRouter } from './router.js';
import { loadSettings } from './state.js';
import { initPWA } from './pwa.js';

route('/', () => import('./views/library.js'));
route('/camera', () => import('./views/camera.js'));
route('/crop', () => import('./views/crop.js'));
route('/doc/:id', () => import('./views/document.js'));
route('/page/:id', () => import('./views/editor.js'));
route('/ocr/:id', () => import('./views/ocr.js'));
route('/sign/:id', () => import('./views/sign.js'));
route('/settings', () => import('./views/settings.js'));

async function boot() {
  initPWA();
  await loadSettings();
  startRouter();
}

boot();
