// app.js — Startpunkt der App.
import { seedIfEmpty } from './db.js';
import { initUI } from './ui.js';

async function main() {
  await seedIfEmpty();
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
