import './styles/main.css';
import { route, startRouter } from './router.js';
import { loadSettings } from './state.js';

route('/', () => import('./views/library.js'));
route('/camera', () => import('./views/camera.js'));
route('/crop', () => import('./views/crop.js'));
route('/doc/:id', () => import('./views/document.js'));
route('/page/:id', () => import('./views/editor.js'));

async function boot() {
  await loadSettings();
  startRouter();
}

boot();
