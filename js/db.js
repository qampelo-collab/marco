// db.js — Lokale Datenbank (IndexedDB) mit Promise-Wrapper.
// Alle Daten bleiben auf dem Gerät. Kein Server, offline nutzbar.

const DB_NAME = 'kraft-tracker';
const DB_VERSION = 1;

// Object Stores (Tabellen):
//  exercises   – Übungskatalog: {id, name, category, equipment, unit}
//  workouts    – Trainingseinheiten: {id, date, notes}
//  sets        – Einzelsätze: {id, workoutId, exerciseId, weight, reps, rpe, photo, ts}
//  body        – Körpermaße/-gewicht: {id, date, weight, chest, waist, arm, thigh, hip, notes}
//  nutrition   – Ernährung: {id, date, protein, calories, notes}
//  activity    – Aktivität: {id, date, steps, notes}
//  meta        – Einstellungen/Metadaten: {key, value}

const STORES = {
  exercises:  { keyPath: 'id', autoIncrement: true, indexes: [['name', 'name', { unique: false }]] },
  workouts:   { keyPath: 'id', autoIncrement: true, indexes: [['date', 'date', { unique: false }]] },
  sets:       { keyPath: 'id', autoIncrement: true, indexes: [['workoutId', 'workoutId'], ['exerciseId', 'exerciseId']] },
  body:       { keyPath: 'id', autoIncrement: true, indexes: [['date', 'date']] },
  nutrition:  { keyPath: 'id', autoIncrement: true, indexes: [['date', 'date']] },
  activity:   { keyPath: 'id', autoIncrement: true, indexes: [['date', 'date']] },
  meta:       { keyPath: 'key' },
};

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const [name, cfg] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, {
            keyPath: cfg.keyPath,
            autoIncrement: !!cfg.autoIncrement,
          });
          for (const [idxName, keyPath, opts] of (cfg.indexes || [])) {
            store.createIndex(idxName, keyPath, opts || {});
          }
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(storeName, mode = 'readonly') {
  return openDB().then((db) => {
    const t = db.transaction(storeName, mode);
    return t.objectStore(storeName);
  });
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const db = {
  async add(store, value) {
    const s = await tx(store, 'readwrite');
    return reqToPromise(s.add(value));
  },
  async put(store, value) {
    const s = await tx(store, 'readwrite');
    return reqToPromise(s.put(value));
  },
  async get(store, key) {
    const s = await tx(store);
    return reqToPromise(s.get(key));
  },
  async delete(store, key) {
    const s = await tx(store, 'readwrite');
    return reqToPromise(s.delete(key));
  },
  async all(store) {
    const s = await tx(store);
    return reqToPromise(s.getAll());
  },
  async byIndex(store, indexName, value) {
    const s = await tx(store);
    const idx = s.index(indexName);
    return reqToPromise(idx.getAll(value));
  },
  async clear(store) {
    const s = await tx(store, 'readwrite');
    return reqToPromise(s.clear());
  },
  // Meta-Helfer für einfache Einstellungen
  async getMeta(key, fallback = null) {
    const row = await this.get('meta', key);
    return row ? row.value : fallback;
  },
  async setMeta(key, value) {
    return this.put('meta', { key, value });
  },
};

// Standard-Übungen beim ersten Start anlegen.
const SEED_EXERCISES = [
  { name: 'Bankdrücken',        category: 'push',  equipment: 'Langhantel', unit: 'kg' },
  { name: 'Schrägbankdrücken',  category: 'push',  equipment: 'Langhantel', unit: 'kg' },
  { name: 'Schulterdrücken',    category: 'push',  equipment: 'Kurzhantel', unit: 'kg' },
  { name: 'Trizepsdrücken',     category: 'push',  equipment: 'Kabel',      unit: 'kg' },
  { name: 'Klimmzüge',          category: 'pull',  equipment: 'Körper',     unit: 'kg' },
  { name: 'Latzug',             category: 'pull',  equipment: 'Kabel',      unit: 'kg' },
  { name: 'Rudern',             category: 'pull',  equipment: 'Langhantel', unit: 'kg' },
  { name: 'Bizepscurls',        category: 'pull',  equipment: 'Kurzhantel', unit: 'kg' },
  { name: 'Kniebeugen',         category: 'legs',  equipment: 'Langhantel', unit: 'kg' },
  { name: 'Kreuzheben',         category: 'legs',  equipment: 'Langhantel', unit: 'kg' },
  { name: 'Beinpresse',         category: 'legs',  equipment: 'Maschine',   unit: 'kg' },
  { name: 'Beinbeuger',         category: 'legs',  equipment: 'Maschine',   unit: 'kg' },
  { name: 'Wadenheben',         category: 'legs',  equipment: 'Maschine',   unit: 'kg' },
  { name: 'Plank',              category: 'core',  equipment: 'Körper',     unit: 's' },
];

export async function seedIfEmpty() {
  const existing = await db.all('exercises');
  if (existing.length === 0) {
    for (const ex of SEED_EXERCISES) {
      await db.add('exercises', ex);
    }
  }
  const seededFlag = await db.getMeta('seeded');
  if (!seededFlag) await db.setMeta('seeded', true);
}

// ---------- Backup: Export / Import als JSON ----------

export async function exportAll() {
  const dump = { version: DB_VERSION, exportedAt: new Date().toISOString(), data: {} };
  for (const store of Object.keys(STORES)) {
    dump.data[store] = await db.all(store);
  }
  return dump;
}

export async function importAll(dump, { replace = true } = {}) {
  if (!dump || !dump.data) throw new Error('Ungültige Backup-Datei');
  for (const store of Object.keys(STORES)) {
    const rows = dump.data[store];
    if (!Array.isArray(rows)) continue;
    if (replace) await db.clear(store);
    for (const row of rows) {
      await db.put(store, row);
    }
  }
}
