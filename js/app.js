// app.js — Startpunkt der App.
import { db, seedIfEmpty } from './db.js';
import { installPlanIfNeeded } from './plan.js';
import { initUI } from './ui.js';

async function main() {
  await seedIfEmpty();
  await installPlanIfNeeded(db);
  await initUI();

  // Service Worker für Offline-Betrieb + Installierbarkeit registrieren.
  // Wichtig: bei einer neuen Version lädt die App automatisch neu, damit man
  // nie auf einer veralteten, zwischengespeicherten Version hängen bleibt.
  if ('serviceWorker' in navigator) {
    try {
      // updateViaCache:'none' -> der SW selbst wird nie aus dem HTTP-Cache geladen.
      const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });

      // Sobald ein neuer SW die Kontrolle übernimmt, einmalig neu laden.
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });

      // Neue Version im Hintergrund gefunden -> aktivieren lassen (skipWaiting im SW).
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            nw.postMessage && nw.postMessage('skip-waiting');
          }
        });
      });

      // Beim Start und bei Rückkehr in die App auf Updates prüfen.
      reg.update();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });
    } catch (err) {
      console.warn('Service Worker konnte nicht registriert werden:', err);
    }
  }
}

main();
