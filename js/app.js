// app.js — Startpunkt der App.
import { db, seedIfEmpty } from './db.js';
import { installPlanIfNeeded } from './plan.js';
import { initUI } from './ui.js';

async function main() {
  await seedIfEmpty();
  await installPlanIfNeeded(db);
  await initUI();

  // Service Worker für Offline-Betrieb + Installierbarkeit registrieren.
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (err) {
      console.warn('Service Worker konnte nicht registriert werden:', err);
    }
  }
}

main();
