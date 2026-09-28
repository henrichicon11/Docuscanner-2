import './styles/main.css';
import { route, startRouter } from './router.js';
import { loadSettings } from './state.js';

route('/', () => import('./views/library.js'));

async function boot() {
  await loadSettings();
  startRouter();
}

boot();
