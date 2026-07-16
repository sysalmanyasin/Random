import { Actions } from './actions.js';
import { initPages } from './pages.js';

/* ══════════════════════════════════════════════════════════════
   MAIN — app bootstrap
   The only call that starts the
   User → Action → Repository → Data → State → Event Bus → Pages → Components
   flow. Nothing else in the app is attached to `window`, except the
   browser-mandated hooks below (service worker registration is required
   to live on `window`/`navigator` — there is no non-global way to do it).
   ══════════════════════════════════════════════════════════════ */

initPages();
Actions.bootstrap();

// ── Service worker registration (browser-required global hook) ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' })
      .then(reg => console.log('PWA Service Worker tracking active on scope:', reg.scope))
      .catch(err => console.error('PWA Initialization rejected:', err));
  });
}
